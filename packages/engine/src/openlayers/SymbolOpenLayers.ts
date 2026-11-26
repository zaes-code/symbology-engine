/**
 * # The OpenLayers renderer
 *
 * Draws a collection of one family's graphics on an OpenLayers map. The style function asks the
 * family's {@link SymbolPainter} for marks at the frame's own resolution, so every decoration is
 * re-sized on every frame and nothing is baked in meters. A family subclasses this with its own
 * painter; the renderer knows no standard.
 *
 * It is also a {@link MapHost}: it reports pointer and key events, sets a cursor and draws an
 * overlay, which is everything an add-on such as an editor needs. It holds no editing logic.
 *
 * The view must be EPSG:3857, the projection the paint layer works in.
 */

import Feature from 'ol/Feature.js';
import type OlMap from 'ol/Map.js';
import type MapBrowserEvent from 'ol/MapBrowserEvent.js';
import LineString from 'ol/geom/LineString.js';
import Point from 'ol/geom/Point.js';
import PointerInteraction from 'ol/interaction/Pointer.js';
import VectorLayer from 'ol/layer/Vector.js';
import {fromLonLat, toLonLat} from 'ol/proj.js';
import VectorSource from 'ol/source/Vector.js';
import CircleStyle from 'ol/style/Circle.js';
import Fill from 'ol/style/Fill.js';
import Icon from 'ol/style/Icon.js';
import Stroke from 'ol/style/Stroke.js';
import Style from 'ol/style/Style.js';
import {drawHandleImage, drawPaintsImage, handleImageKey, isPlainHandle, isTypingTarget, nearestWorldX, paintAll, PAINT_BANDS, toMercator, type FeatureSource, type HostOverlay, type OverlayHandle, type MapHost, type MapHostHandlers, type Paint, type Pixel, type PointerInput, type SymbolPainter, type ViewAdapter} from '../index.js';
import {paintsToStyles} from './styles.js';

export interface SymbolOpenLayersOptions {
    /** Layer z-index; the overlay goes one above, its "under" part one below. */
    zIndex?: number;
    /**
     * The layers' CSS class (default `'symbol-layer'`). OpenLayers shares one canvas among
     * consecutive layers with the same className, so a host's CSS filter on its basemap (a dark
     * mode) would otherwise repaint the symbols too; with their own, the layers get their own canvas.
     */
    className?: string;
    /** The renderer's name in error messages (default `'SymbolOpenLayers'`). */
    rendererName?: string;
    /**
     * Draw each point symbol as one image, drawn once per look and shared by every symbol that looks the
     * same, over the lines and areas and stacked in the collection's order (as MapLibre's `pointImages`).
     * Marks per symbol are costly in numbers: OpenLayers replays every mark of every symbol each frame,
     * where an image is one draw. A point's underlay (marks in map units) is still drawn as marks, under it.
     */
    pointImages?: OpenLayersPointImages<unknown>;
}

/** Which graphics are point symbols drawn as images. */
export interface OpenLayersPointImages<F> {
    /** A point symbol's location, or `null` for a graphic drawn as marks (a line, an area). */
    pointOf(feature: F): readonly number[] | null;
    /** What its picture depends on, for the image cache. Default: its properties. */
    imageKey?(feature: F): string;
    /**
     * How much a point image is scaled at a resolution (projected meters a CSS pixel), as when symbols
     * shrink as the map zooms out. Default 1.
     */
    scaleAt?(resolution: number): number;
}

/**
 * Point images draw at one z-index, over every graphic's marks (their z-indexes are the stack's ranks),
 * and among themselves in the source's order, which is the collection's: OpenLayers keeps one batch per
 * z-index, so a z-index per symbol would cost a batch per symbol.
 */
const POINT_IMAGE_Z = 2 ** 30;
/** The most point image styles kept (see `pointStyles`). */
const MAX_POINT_STYLES = 4000;

/** Where an OpenLayers feature keeps the graphic it draws. */
const GRAPHIC_KEY = 'symbol';

/** Longer than OpenLayers' own double-click window (250 ms), so its dblclick after a taken click is caught. */
const DOUBLE_CLICK_MS = 600;

/** A feature that carries ready-made marks; its geometry is their extent, so OpenLayers never culls it early. */
function marksFeature(paints: readonly Paint[]): Feature | null {
    if (paints.length === 0) return null;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const visit = (c: readonly number[]) => {
        x0 = Math.min(x0, c[0]);
        y0 = Math.min(y0, c[1]);
        x1 = Math.max(x1, c[0]);
        y1 = Math.max(y1, c[1]);
    };
    for (const p of paints) {
        const g = p.geometry;
        if (g.type === 'Point') visit(g.coordinates);
        else if (g.type === 'LineString') g.coordinates.forEach(visit);
        else g.coordinates.forEach((r) => r.forEach(visit));
    }
    const f = new Feature({geometry: new LineString([[x0, y0], [x1, y1]])});
    const styles = paintsToStyles(paints);
    f.setStyle(styles);
    return f;
}

export class SymbolOpenLayers<F extends {id?: string | number}> implements MapHost {
    readonly layer: VectorLayer<VectorSource>;
    readonly overlayLayer: VectorLayer<VectorSource>;
    /** The overlay's "under" marks (a selection highlight), below the graphics so they never tint a symbol. */
    readonly underLayer: VectorLayer<VectorSource>;
    readonly view: ViewAdapter;
    private readonly source = new VectorSource();
    private readonly overlaySource = new VectorSource();
    private readonly underSource = new VectorSource();
    private readonly features = new Map<string, Feature>();
    private readonly images: OpenLayersPointImages<F> | undefined;
    private readonly disposers: (() => void)[] = [];

    constructor(
        readonly map: OlMap,
        readonly collection: FeatureSource<F>,
        readonly painter: SymbolPainter<F>,
        options: SymbolOpenLayersOptions = {},
    ) {
        const code = map.getView().getProjection().getCode();
        if (code !== 'EPSG:3857') throw new Error(`${options.rendererName ?? 'SymbolOpenLayers'} needs an EPSG:3857 view; this one is ${code}`);

        const z = options.zIndex ?? 10;
        const common = {className: options.className ?? 'symbol-layer', updateWhileInteracting: true, updateWhileAnimating: true};
        // The style function every graphic uses: marks at this frame's resolution, in the graphic's
        // own z-index range so it draws as a unit, stacked in the collection's order.
        const images = options.pointImages as OpenLayersPointImages<F> | undefined;
        this.images = images;
        const style = (feature: Feature | import('ol/render/Feature.js').default, resolution: number): Style[] => {
            const graphic = feature.get(GRAPHIC_KEY) as F | undefined;
            if (!graphic) return [];
            const base = (this.rank.get(String(graphic.id)) ?? 0) * (PAINT_BANDS + 1);
            const at = images?.pointOf(graphic);
            if (images && at) {
                const icon = this.pointStyle(graphic, at, images, resolution);
                const under = painter.underlay?.(graphic, {resolution});
                if (!under?.length) return icon ? [icon] : [];
                return [...paintsToStyles(under, base), ...(icon ? [icon] : [])];
            }
            return paintsToStyles(paintAll(painter, graphic, {resolution}), base);
        };
        this.layer = new VectorLayer({...common, source: this.source, style, zIndex: z});
        this.overlayLayer = new VectorLayer({...common, source: this.overlaySource, zIndex: z + 1});
        this.underLayer = new VectorLayer({...common, source: this.underSource, zIndex: z - 1});
        map.addLayer(this.underLayer);
        map.addLayer(this.layer);
        map.addLayer(this.overlayLayer);
        this.view = this.viewAdapter();

        this.ranks();
        this.syncAll();
        this.disposers.push(
            collection.subscribe((change) => {
                // A change to one graphic keeps every place in the stack. An addition goes on top and a
                // removal leaves a gap (the order is kept), so only a new order (a reset) ranks them all:
                // ranked on every change, thirty thousand moving symbols cost nine hundred million steps an
                // update, and thirty thousand added one by one as many again.
                if (change.type === 'add') this.rank.set(change.id, this.nextRank++);
                else if (change.type === 'remove') this.rank.delete(change.id);
                else if (change.type === 'reset') this.ranks();
                if (change.type === 'reset') this.syncAll();
                else this.sync(change.id);
            }),
        );
    }

    /**
     * The view adapter. It works from the view, not the last rendered frame: OpenLayers' own pixel
     * conversions return `null` until a frame has been drawn, which a host that draws right after
     * creating the map — or a page in a background tab — runs into.
     */
    viewAdapter(): ViewAdapter {
        const map = this.map;
        const frame = () => {
            const view = map.getView();
            const size = map.getSize() ?? [map.getViewport()!.clientWidth, map.getViewport()!.clientHeight];
            return {c: view.getCenter() ?? [0, 0], res: view.getResolution() ?? 1, rot: view.getRotation(), w: size[0], h: size[1]};
        };
        return {
            toPixel: (lonLat) => {
                const {c, res, rot, w, h} = frame();
                const m = fromLonLat([lonLat[0], lonLat[1]]);
                // The copy of the world the view shows: a point at -179° seen from 179° is two
                // degrees east, not a world away, so handles and hit tests stay on the graphic.
                const dx = nearestWorldX(m[0], c[0]) - c[0];
                const dy = m[1] - c[1];
                const cos = Math.cos(-rot);
                const sin = Math.sin(-rot);
                return [w / 2 + (dx * cos - dy * sin) / res, h / 2 - (dx * sin + dy * cos) / res];
            },
            toLonLat: (pixel) => {
                const {c, res, rot, w, h} = frame();
                const x = (pixel[0] - w / 2) * res;
                const y = (h / 2 - pixel[1]) * res;
                const cos = Math.cos(rot);
                const sin = Math.sin(rot);
                const ll = toLonLat([c[0] + x * cos - y * sin, c[1] + x * sin + y * cos]);
                return [ll[0], ll[1]];
            },
        };
    }

    /** Each graphic's place in the stack: the collection's order. */
    /** By id: a change replaces a graphic's object, never its place. */
    private readonly rank = new Map<string, number>();
    private nextRank = 0;
    private ranks(): void {
        this.rank.clear();
        this.collection.list().forEach((g, i) => this.rank.set(String(g.id), i));
        this.nextRank = this.rank.size;
    }

    /**
     * Point images by look; emptied by `refresh`, when a configuration change may redraw them all. At most
     * MAX_POINT_STYLES are kept, the oldest dropped first: tracks whose direction or text keeps changing
     * draw a new look for each value (a dropped look still in use is drawn again when next needed).
     */
    private readonly pointStyles = new Map<string, Style | null>();

    /**
     * A point symbol's image as an icon style, drawn once per look at the device's pixel ratio: painted at
     * one meter a pixel, so its marks in meters are its size in pixels; the anchor sits on the location.
     */
    private pointStyle(f: F, at: readonly number[], images: OpenLayersPointImages<F>, resolution: number): Style | null {
        const key = images.imageKey ? images.imageKey(f) : JSON.stringify((f as {properties?: unknown}).properties);
        const ratio = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
        const known = this.pointStyles.get(key);
        // The style is shared by every symbol of one look, all drawn in a frame at one resolution.
        const scale = (k: number) => (Number.isFinite(k) && k > 0 ? k : 1) / ratio;
        if (known !== undefined) {
            if (known && images.scaleAt) known.getImage()?.setScale(scale(images.scaleAt(resolution)));
            return known;
        }
        const drawn = drawPaintsImage(this.painter.paint(f, {resolution: 1}), toMercator([at[0], at[1]]), 1, ratio);
        const style = drawn
            ? new Style({
                  image: new Icon({img: drawn.canvas, scale: scale(images.scaleAt ? images.scaleAt(resolution) : 1), anchor: [drawn.anchorPx[0] * ratio, drawn.anchorPx[1] * ratio], anchorXUnits: 'pixels', anchorYUnits: 'pixels'}),
                  zIndex: POINT_IMAGE_Z,
              })
            : null;
        if (this.pointStyles.size >= MAX_POINT_STYLES) this.pointStyles.delete(this.pointStyles.keys().next().value as string);
        this.pointStyles.set(key, style);
        return style;
    }

    /** Repaint everything, as after a change to the family's configuration. */
    refresh(): void {
        this.pointStyles.clear();
        this.syncAll();
        this.layer.changed();
        this.overlayLayer.changed();
    }

    dispose(): void {
        for (const d of this.disposers.splice(0)) d();
        this.map.removeLayer(this.underLayer);
        this.map.removeLayer(this.layer);
        this.map.removeLayer(this.overlayLayer);
        this.map.getViewport()!.style.cursor = '';
    }

    // ── MapHost ──────────────────────────────────────────────────────────

    resolution(): number {
        return this.map.getView().getResolution() ?? 1;
    }

    setCursor(cursor: string): void {
        this.map.getViewport()!.style.cursor = cursor;
    }

    setOverlay(overlay: HostOverlay | null): void {
        this.underSource.clear(true);
        this.overlaySource.clear(true);
        if (!overlay) return;
        const under = marksFeature(overlay.under);
        if (under) this.underSource.addFeature(under);
        const over = marksFeature(overlay.over);
        const handles = overlay.handles.map((h) => {
            const f = new Feature({geometry: new Point(fromLonLat(h.lonLat))});
            f.setStyle(new Style({image: this.handleImage(h), zIndex: 10}));
            return f;
        });
        this.overlaySource.addFeatures([...(over ? [over] : []), ...handles]);
    }

    private readonly handleIcons = new Map<string, {canvas: HTMLCanvasElement; ratio: number}>();

    /** A handle's marker: OpenLayers' own circle for a plain dot, else its image, turning with the map. */
    private handleImage(h: OverlayHandle): CircleStyle | Icon {
        if (isPlainHandle(h)) return new CircleStyle({radius: h.radiusPx, fill: new Fill({color: h.fill}), stroke: new Stroke({color: h.stroke, width: 2})});
        const ratio = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
        const key = handleImageKey(h);
        let drawn = this.handleIcons.get(key);
        if (!drawn || drawn.ratio !== ratio) {
            drawn = {canvas: drawHandleImage(h, ratio).canvas, ratio};
            this.handleIcons.set(key, drawn);
        }
        return new Icon({img: drawn.canvas, scale: 1 / ratio, rotation: ((h.rotation ?? 0) * Math.PI) / 180, rotateWithView: true});
    }

    onViewChange(listener: () => void): () => void {
        // A zoom or a turn: either moves what the overlay places in pixels (a resize handle, a selection box).
        const view = this.map.getView();
        const keys = [view.on('change:resolution', listener), view.on('change:rotation', listener)];
        return () => {
            for (const k of keys) view.un(k.type as 'change:resolution', k.listener);
        };
    }

    listen(handlers: MapHostHandlers): () => void {
        const input = (e: MapBrowserEvent<PointerEvent | KeyboardEvent | WheelEvent>): PointerInput => ({
            pixel: [e.pixel[0], e.pixel[1]] as Pixel,
            altKey: (e.originalEvent as PointerEvent).altKey,
        });
        // When the handler last took a press: a click that placed a point or a vertex.
        let consumedAt = -Infinity;
        const pointer = new PointerInteraction({
            handleDownEvent: (e) => {
                const consumed = handlers.pointerDown?.(input(e)) ?? false;
                if (consumed) consumedAt = performance.now();
                return consumed;
            },
            handleDragEvent: (e) => {
                handlers.pointerMove?.(input(e));
            },
            handleUpEvent: (e) => {
                handlers.pointerUp?.(input(e));
                return false;
            },
            handleMoveEvent: (e) => {
                handlers.pointerMove?.(input(e));
            },
        });
        // OpenLayers raises its own 'dblclick' for any two clicks inside its timeout, however far
        // apart. It stops the zoom when the handler claims double-clicks, and when the handler took
        // either click: a point finishes on its own click, so placing two in a row, or a wind barb's
        // two clicks, is no longer "drawing" by the second. The browser's own dblclick, which needs
        // the two clicks close together, is what reaches `doubleClick`.
        const handleEvent = pointer.handleEvent.bind(pointer);
        pointer.handleEvent = (e) =>
            e.type === 'dblclick' && (handlers.capturesDoubleClick?.() || performance.now() - consumedAt < DOUBLE_CLICK_MS) ? false : handleEvent(e);
        this.map.addInteraction(pointer);

        const viewport = this.map.getViewport()!;
        let hovered = false;
        const onDblClick = (e: MouseEvent) => {
            const px = this.map.getEventPixel(e);
            if (handlers.doubleClick?.({pixel: [px[0], px[1]]})) e.preventDefault();
        };
        const enter = () => (hovered = true);
        const leave = () => (hovered = false);
        const onKey = (e: KeyboardEvent) => {
            if (isTypingTarget(e.target)) return;
            if (!hovered && !handlers.wantsKeys?.()) return;
            if (handlers.keyDown?.(e)) e.preventDefault();
        };
        viewport.addEventListener('dblclick', onDblClick);
        viewport.addEventListener('pointerenter', enter);
        viewport.addEventListener('pointerleave', leave);
        window.addEventListener('keydown', onKey);
        const stop = () => {
            this.map.removeInteraction(pointer);
            viewport.removeEventListener('dblclick', onDblClick);
            viewport.removeEventListener('pointerenter', enter);
            viewport.removeEventListener('pointerleave', leave);
            window.removeEventListener('keydown', onKey);
        };
        this.disposers.push(stop);
        return stop;
    }

    // ── graphics ──────────────────────────────────────────────────────────────

    private olGeometry(f: F): LineString | Point {
        // A point symbol drawn as an image stands on its location: OpenLayers places an icon on a point,
        // and draws none for a line (a one-point outline drew nothing).
        const at = this.images?.pointOf(f);
        if (at) return new Point(fromLonLat([at[0], at[1]]));
        // The painted outline is the feature's geometry, so OpenLayers culls and sizes the extent
        // by the shape the operator sees. Decorations stay within the layer's render buffer.
        return new LineString(this.painter.outline(f));
    }

    private sync(id: string): void {
        const f = this.collection.get(id);
        const existing = this.features.get(id);
        if (!f) {
            if (existing) this.source.removeFeature(existing);
            this.features.delete(id);
            return;
        }
        if (existing) {
            // A point image that moved keeps its geometry object, moved: cheaper than a new one per move.
            const at = this.images?.pointOf(f);
            const geometry = existing.getGeometry();
            if (at && geometry instanceof Point) geometry.setCoordinates(fromLonLat([at[0], at[1]]));
            else existing.setGeometry(this.olGeometry(f));
            existing.set(GRAPHIC_KEY, f);
            return;
        }
        const olf = new Feature({geometry: this.olGeometry(f)});
        olf.setId(id);
        olf.set(GRAPHIC_KEY, f);
        this.features.set(id, olf);
        this.source.addFeature(olf);
    }

    private syncAll(): void {
        this.source.clear();
        this.features.clear();
        // Added together: one bulk load of the spatial index rather than an insert and two events each.
        const batch: Feature[] = [];
        for (const f of this.collection.list()) {
            const id = String(f.id);
            const olf = new Feature({geometry: this.olGeometry(f)});
            olf.setId(id);
            olf.set(GRAPHIC_KEY, f);
            this.features.set(id, olf);
            batch.push(olf);
        }
        this.source.addFeatures(batch);
    }
}
