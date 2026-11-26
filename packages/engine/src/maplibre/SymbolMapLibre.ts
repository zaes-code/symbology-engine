/**
 * # The MapLibre renderer
 *
 * Draws a collection of one family's graphics on a MapLibre map, with the marks the family's
 * {@link SymbolPainter} gives. A family subclasses this with its own painter; the
 * renderer knows no standard. It is also a {@link MapHost}: it reports pointer and key events, sets
 * a cursor and draws an overlay, which is everything an add-on such as an editor needs. It holds
 * no editing logic.
 *
 * MapLibre styles are data, not functions, so the marks are recomputed in JavaScript whenever the
 * resolution changes (every zoom frame) and pushed as GeoJSON. Three things follow from that:
 *
 * - **Dashes are cut here, per frame, in pixels.** A MapLibre `line-dasharray` stretches up to 2×
 *   between integer zooms, and rewriting a live layer's dash array breaks its line rendering. Cut
 *   per frame from the paint layer's pixel pattern, a dash is the same on screen as on OpenLayers.
 * - **Text is drawn to images.** No glyph server is needed: each distinct label becomes one small
 *   canvas image, painted with its halo, rotated by the symbol layer.
 * - **Nothing here imports `maplibre-gl` at run time.** The map arrives as an argument, so this entry
 *   costs a consumer nothing beyond the map they already have.
 */

import type {Feature, FeatureCollection, Position} from 'geojson';
import type {ExpressionSpecification, GeoJSONSource, Map as MapLibreMap, MapLayerMouseEvent, MapLayerTouchEvent, MapMouseEvent} from 'maplibre-gl';
import {
    dashRuns,
    paintAll,
    walker,
    drawLabelImage,
    drawPointLeaderImage,
    drawPaintsImage,
    POINT_LEADER_DEFAULTS,
    toMercator,
    fromMercator,
    isTypingTarget,
    wrapLongitude,
    labelImageKey,
    drawHandleImage,
    handleImageKey,
    isPlainHandle,
    PAINT_BANDS,
    paintBands,
    resolutionAtZoom,
    type FeatureSource,
    type HostOverlay,
    type OverlayHandle,
    type MapHost,
    type MapHostHandlers,
    type Paint,
    type Pixel,
    type PointLeader,
    type ProjectedPosition,
    type SymbolPainter,
    type ViewAdapter,
} from '../index.js';

export interface SymbolMapLibreOptions<F = unknown> {
    /** Insert the layers below this layer id. */
    beforeId?: string;
    /**
     * Prefix for the source, layer and image ids (default `'symbol'`), when a map shows more than
     * one collection.
     */
    idPrefix?: string;
    /**
     * Stand each point symbol on a leader line (a lollipop), upright on screen: for a tilted map
     * with terrain, where a symbol drawn on the ground lies flat and a ridge hides it. Off, every
     * graphic lies on the map as before.
     */
    pointLeaders?: MapLibrePointLeaders<F>;
    /**
     * Draw each point symbol as one image, stacked in the collection's order. MapLibre draws every
     * graphic's fills in one layer under every graphic's lines, so two point symbols that overlap
     * interleave (one's lines over the other's fill); as images they cover each other whole, the later
     * over the earlier. Lines and areas are drawn as before, under the point symbols.
     */
    pointImages?: MapLibrePointImages<F>;
}

/** Which graphics are point symbols drawn as images. */
export interface MapLibrePointImages<F> {
    /** A point symbol's location, or `null` for a graphic drawn as marks (a line, an area). */
    pointOf(feature: F): readonly number[] | null;
    /** What its picture depends on, for the image cache. Default: its properties. */
    imageKey?(feature: F): string;
    /**
     * How much a point image is scaled at a resolution (projected meters a CSS pixel), as when symbols
     * shrink as the map zooms out. Default 1. Sampled at every whole zoom and interpolated between
     * (exponentially, base the square root of two); `refresh()` applies a change.
     */
    scaleAt?(resolution: number): number;
}

/** Which graphics stand on leader lines, and how. */
export interface MapLibrePointLeaders<F> extends PointLeader {
    /** A point symbol's location, or `null` for a graphic that lies on the map (a line, an area, a barb). */
    pointOf(feature: F): readonly number[] | null;
    /** What its picture depends on, for the image cache. Default: its properties. */
    imageKey?(feature: F): string;
    /**
     * How much a symbol on its leader line (with the line) is scaled at a resolution (projected meters a CSS pixel), as when symbols
     * shrink as the map zooms out. Default 1. Sampled at every whole zoom and interpolated between
     * (exponentially, base the square root of two); `refresh()` applies a change.
     */
    scaleAt?(resolution: number): number;
}

const ll = (p: readonly number[]): Position => fromMercator(p);

/** Two point feature property values alike: equal, or arrays of equal values (an image's offset). */
function sameValue(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => v === b[i]);
}

/**
 * A point image's `icon-size`: 1, or its `scaleAt` sampled every quarter zoom from 0 to 24, interpolated
 * exponentially (base the square root of two, so a scale that follows the square root of the resolution
 * is followed exactly between the samples).
 */
/** Stops of a point image's `icon-size` curve per zoom level. */
const ICON_SIZE_STOPS_PER_ZOOM = 4;

function iconSize(images: {scaleAt?(resolution: number): number} | undefined): number | ExpressionSpecification {
    if (!images?.scaleAt) return 1;
    const stops: number[] = [];
    // Every quarter zoom: between whole zooms the exponential interpolation follows a square root exactly, but
    // not the bends where a scale starts to shrink or reaches its floor, where drawing and picking parted.
    for (let q = 0; q <= 24 * ICON_SIZE_STOPS_PER_ZOOM; q++) {
        const z = q / ICON_SIZE_STOPS_PER_ZOOM;
        const k = images.scaleAt(resolutionAtZoom(z));
        stops.push(z, Number.isFinite(k) && k > 0 ? k : 1);
    }
    if (stops.every((v, i) => i % 2 === 0 || v === 1)) return 1;
    return ['interpolate', ['exponential', Math.SQRT2], ['zoom'], ...stops] as unknown as ExpressionSpecification;
}

export function paintsToMapLibreFeatures(paints: readonly Paint[], resolution: number, imageKey: (p: Paint) => string): Feature[] {
    const out: Feature[] = [];
    // One fill layer under one line layer would put a mark painted on a line under it: each band
    // has its own pair of layers (installLayers), so the painter's order holds.
    const bands = paintBands(paints);
    let band = 0;
    const lineFeature = (coords: readonly number[][], color: string, width: number, ends: {cap?: string; join?: string} = {}): Feature => ({
        type: 'Feature',
        geometry: {type: 'LineString', coordinates: coords.map(ll)},
        properties: {kind: 'line', color, width, band, ...(ends.cap ? {cap: ends.cap} : {}), ...(ends.join ? {join: ends.join} : {})},
    });
    // The line layer draws round caps, which reach half a width past each end of a run: a dashed
    // stroke's runs are shortened by that much, so its dashes and gaps are the lengths asked for
    // (a dash shorter than the width is a dot), as a butt-capped dash draws them in OpenLayers.
    const stroked = (coords: readonly ProjectedPosition[], stroke: NonNullable<Paint['stroke']>) => {
        if (!stroke.dashPx) {
            out.push(lineFeature(coords, stroke.color, stroke.widthPx, stroke));
            return;
        }
        const cap = (stroke.widthPx / 2) * resolution;
        for (const run of dashRuns(coords, stroke.dashPx, resolution)) {
            const w = walker(run);
            // A dash that trims to under half a pixel (one about as long as the width) is a dot: a run
            // half a pixel long, which its caps round off. Shorter, MapLibre's tiling rounds it to
            // nothing and drops it.
            const mid = Math.max(0, w.length / 2 - resolution * 0.25);
            const trimmed = w.length - 2 * cap >= resolution * 0.5 ? w.slice(cap, w.length - cap) : [w.at(mid).point, w.at(Math.min(w.length, mid + resolution * 0.5)).point];
            if (trimmed.length >= 2) out.push(lineFeature(trimmed, stroke.color, stroke.widthPx));
        }
    };
    for (const [i, p] of paints.entries()) {
        band = bands[i];
        if (p.geometry.type === 'LineString' && p.stroke) {
            stroked(p.geometry.coordinates, p.stroke);
        } else if (p.geometry.type === 'Polygon') {
            if (p.fill) {
                out.push({
                    type: 'Feature',
                    geometry: {type: 'Polygon', coordinates: p.geometry.coordinates.map((r) => r.map(ll))},
                    properties: {kind: 'fill', color: p.fill.color, opacity: p.fill.opacity ?? 1, band},
                });
            }
            if (p.stroke) for (const ring of p.geometry.coordinates) stroked(ring, p.stroke);
        } else if (p.geometry.type === 'Point' && p.text) {
            out.push({
                type: 'Feature',
                geometry: {type: 'Point', coordinates: ll(p.geometry.coordinates)},
                // icon-rotate is clockwise in degrees; paint rotation is counter-clockwise in radians.
                properties: {kind: 'label', image: imageKey(p), rotation: (-p.text.rotation * 180) / Math.PI},
            });
        }
    }
    return out;
}

const EMPTY: FeatureCollection = {type: 'FeatureCollection', features: []};

/** A collection graphic's id, as the collection's change events name it. */
const graphicId = (f: unknown): string => String((f as {id?: string | number}).id);

export class SymbolMapLibre<F> implements MapHost {
    readonly view: ViewAdapter;
    private readonly prefix: string;
    private readonly disposers: (() => void)[] = [];
    /** Label images on the map, and the ones the latest paint of each source used. */
    private readonly images = new Set<string>();
    private usedByGraphics = new Set<string>();
    private usedByPoints = new Set<string>();
    private usedByOverlay = new Set<string>();
    private usedNow: Set<string> | null = null;
    private usedPointsNow: Set<string> | null = null;
    private disposed = false;
    private frame = 0;
    private dirtyGraphics = true;
    /** Point symbols (images, leaders) are a fixed size on screen: only a change to the collection or the configuration redraws them, never a zoom. */
    private dirtyPoints = true;
    /**
     * Graphics changed one by one since the last paint (moved, restyled), sent to the points source alone
     * (`updateData`) when nothing else needs a full paint: a thousand moving symbols send a thousand
     * features, not the whole collection.
     */
    private readonly changed = new Set<string>();
    /** Each graphic's point feature as last sent, and its numeric id in the points source. */
    private readonly pointFeatures = new Map<string, Feature>();
    private readonly pointIds = new Map<string, number>();
    private nextPointId = 1;
    /** Graphics that drew marks (lines, areas, underlays) at the last full paint: a change to one repaints the marks too. */
    private withMarks = new Set<string>();
    private dirtyOverlay = true;
    private overlay: HostOverlay | null = null;
    private readonly viewListeners = new Set<() => void>();
    /** Bumped by refresh(): a configuration change redraws every leader image under a new key. */
    private generation = 0;
    private readonly leaderFeet = new Map<string, number>();
    /** The leader lines point symbols stand on now, or none: `setPointLeaders`. */
    private leaders: MapLibrePointLeaders<F> | undefined;

    constructor(
        readonly map: MapLibreMap,
        readonly collection: FeatureSource<F>,
        readonly painter: SymbolPainter<F>,
        private readonly options: SymbolMapLibreOptions<F> = {},
    ) {
        this.prefix = options.idPrefix ?? 'symbol';
        this.leaders = options.pointLeaders;
        this.view = this.viewAdapter();

        // 'style.load' fires for the first style and again whenever a host swaps the basemap
        // style, which drops every source, layer and image; one handler covers both. Listening
        // for 'load' as well installed everything twice, and the second pass forgot the images
        // the first had added, so they could never be pruned.
        const install = () => {
            for (const key of this.images) if (!map.hasImage(key)) this.images.delete(key);
            this.installLayers();
            this.repaintNow();
        };
        if (map.isStyleLoaded()) install();
        map.on('style.load', install);
        this.disposers.push(() => map.off('style.load', install));

        // A zoom redraws the marks (their sizes are in pixels, so their meters change) and the overlay,
        // not the point symbols: an image is the same on screen at any zoom.
        const onZoom = () => {
            this.repaint(true, true);
            for (const l of [...this.viewListeners]) l();
        };
        map.on('zoom', onZoom);
        this.disposers.push(() => map.off('zoom', onZoom));
        // A turn or a tilt moves what the overlay places in pixels (a resize handle, a selection box).
        const onView = () => {
            for (const l of [...this.viewListeners]) l();
        };
        const onPitch = () => {
            this.alignPointImages();
            onView();
        };
        map.on('pitch', onPitch);
        map.on('rotate', onView);
        this.disposers.push(() => map.off('pitch', onPitch));
        this.disposers.push(() => map.off('rotate', onView));
        this.disposers.push(
            collection.subscribe((change) => {
                // One graphic changed: only it is sent again. Anything else (an addition, a removal, a new
                // order, a reload) is a full paint.
                if (change.type === 'update') {
                    this.changed.add(change.id);
                    this.repaint(false, false);
                } else this.repaint(true, false, true);
            }),
        );
    }

    /** The view adapter. */
    viewAdapter(): ViewAdapter {
        const map = this.map;
        return {
            toPixel: (lonLat) => {
                // The copy of the world the view shows, as on OpenLayers: nearest the center.
                const center = map.getCenter().lng;
                const p = map.project([center + wrapLongitude(lonLat[0] - center), lonLat[1]]);
                return [p.x, p.y];
            },
            toLonLat: (pixel) => {
                const c = map.unproject([pixel[0], pixel[1]]);
                return [c.lng, c.lat];
            },
            pointLiftPx: () => (this.leaders ? (this.leaders.lengthPx ?? POINT_LEADER_DEFAULTS.lengthPx) : 0),
        };
    }

    /**
     * Stand point symbols on leader lines, or lay them on the map again (`undefined`), as a host's
     * setting changes: a tilted map with terrain wants them, a flat one does not.
     */
    setPointLeaders(leaders: MapLibrePointLeaders<F> | undefined): void {
        this.leaders = leaders;
        this.refresh();
    }

    /** Repaint everything, as after a change to the family's configuration. */
    refresh(): void {
        this.generation++;
        for (const [id, images] of [[this.id('point'), this.options.pointImages], [this.id('leader'), this.leaders]] as const) {
            if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'icon-size', iconSize(images));
        }
        this.repaintNow();
        for (const l of [...this.viewListeners]) l();
    }

    dispose(): void {
        this.disposed = true;
        cancelAnimationFrame(this.frame);
        for (const d of this.disposers.splice(0)) d();
        const map = this.map;
        for (const id of this.layerIds()) if (map.getLayer(id)) map.removeLayer(id);
        for (const s of [this.id('graphics'), this.id('points'), this.id('overlay'), this.id('under')]) if (map.getSource(s)) map.removeSource(s);
        for (const img of [...this.images, ...this.handleImages]) if (map.hasImage(img)) map.removeImage(img);
        this.images.clear();
        this.handleImages.clear();
        map.getCanvas().style.cursor = '';
    }

    // ── MapHost ──────────────────────────────────────────────────────────

    resolution(): number {
        return resolutionAtZoom(this.map.getZoom());
    }

    setCursor(cursor: string): void {
        this.map.getCanvas().style.cursor = cursor;
    }

    setOverlay(overlay: HostOverlay | null): void {
        this.overlay = overlay;
        this.repaint(false, true);
    }

    onViewChange(listener: () => void): () => void {
        this.viewListeners.add(listener);
        return () => {
            this.viewListeners.delete(listener);
        };
    }

    listen(handlers: MapHostHandlers): () => void {
        const map = this.map;
        const px = (e: MapMouseEvent | MapLayerMouseEvent | MapLayerTouchEvent): Pixel => [e.point.x, e.point.y];
        // Whether a gesture the handler claimed is in progress, so a release outside the canvas still ends it.
        let claimed = false;
        const down = (e: MapMouseEvent) => {
            if (e.originalEvent.button !== 0) return;
            claimed = handlers.pointerDown?.({pixel: px(e), altKey: e.originalEvent.altKey}) ?? false;
            if (claimed) e.preventDefault();
        };
        const move = (e: MapMouseEvent) => {
            handlers.pointerMove?.({pixel: px(e)});
        };
        const up = (e: MapMouseEvent) => {
            claimed = false;
            handlers.pointerUp?.({pixel: px(e)});
        };
        const dbl = (e: MapMouseEvent) => {
            const captured = handlers.capturesDoubleClick?.() ?? false;
            const consumed = handlers.doubleClick?.({pixel: px(e)}) ?? false;
            if (captured || consumed) e.preventDefault();
        };
        const touchStart = (e: MapLayerTouchEvent) => {
            if (e.points.length === 1 && handlers.pointerDown?.({pixel: px(e)})) e.preventDefault();
        };
        const touchMove = (e: MapLayerTouchEvent) => {
            if (e.points.length === 1 && handlers.pointerMove?.({pixel: px(e)})) e.preventDefault();
        };
        const touchEnd = (e: MapLayerTouchEvent) => {
            handlers.pointerUp?.({pixel: px(e)});
        };
        const windowUp = () => {
            if (claimed) {
                claimed = false;
                handlers.pointerUp?.({pixel: [NaN, NaN]});
            }
        };
        const container = map.getContainer();
        let hovered = false;
        const enter = () => (hovered = true);
        const leave = () => (hovered = false);
        const onKey = (e: KeyboardEvent) => {
            if (isTypingTarget(e.target)) return;
            if (!hovered && !handlers.wantsKeys?.()) return;
            if (handlers.keyDown?.(e)) e.preventDefault();
        };

        map.on('mousedown', down);
        map.on('mousemove', move);
        map.on('mouseup', up);
        map.on('dblclick', dbl);
        map.on('touchstart', touchStart);
        map.on('touchmove', touchMove);
        map.on('touchend', touchEnd);
        window.addEventListener('mouseup', windowUp);
        container.addEventListener('pointerenter', enter);
        container.addEventListener('pointerleave', leave);
        window.addEventListener('keydown', onKey);
        const stop = () => {
            map.off('mousedown', down);
            map.off('mousemove', move);
            map.off('mouseup', up);
            map.off('dblclick', dbl);
            map.off('touchstart', touchStart);
            map.off('touchmove', touchMove);
            map.off('touchend', touchEnd);
            window.removeEventListener('mouseup', windowUp);
            container.removeEventListener('pointerenter', enter);
            container.removeEventListener('pointerleave', leave);
            window.removeEventListener('keydown', onKey);
        };
        this.disposers.push(stop);
        return stop;
    }

    // ── layers ────────────────────────────────────────────────────────────────

    private id(name: string): string {
        return `${this.prefix}-${name}`;
    }

    private layerIds(): string[] {
        const banded = (prefix: string) => Array.from({length: PAINT_BANDS}, (_, b) => [`${prefix}fill-${b}`, `${prefix}line-${b}`]).flat();
        return [...banded('under-'), ...banded(''), 'label', 'leader', 'point', ...banded('overlay-'), 'overlay-label', 'handles', 'handle-images', 'handle-offsets'].map((n) => this.id(n));
    }

    /**
     * The point images' pitch alignment: on the map when the view is tilted (they lie on the ground),
     * the viewport when it is not. Untilted the two draw alike, but MapLibre samples an image aligned
     * to the map between its pixels, and a symbol's small text, landing between screen pixels, blurred
     * to its halo; aligned to the viewport it is drawn pixel for pixel.
     */
    private pointPitchAlignment(): 'map' | 'viewport' {
        return this.map.getPitch() > 0 ? 'map' : 'viewport';
    }

    /** Follow the view's tilt (see {@link pointPitchAlignment}); a change only when it crosses zero. */
    private alignPointImages(): void {
        const id = this.id('point');
        const alignment = this.pointPitchAlignment();
        if (!this.map.getLayer(id) || this.map.getLayoutProperty(id, 'icon-pitch-alignment') === alignment) return;
        this.map.setLayoutProperty(id, 'icon-pitch-alignment', alignment);
    }

    private installLayers(): void {
        const map = this.map;
        const before = this.options.beforeId;
        // No simplification: every mark is already made for the resolution it is drawn at, and the
        // tiler's default tolerance drops runs under about half a pixel at a fractional zoom (a
        // dotted line's dots).
        // Point symbols have a source of their own: MapLibre's worker parses a source's features once for
        // every layer that reads it, and the marks' sources feed many (a fill and a line layer per band).
        for (const s of [this.id('under'), this.id('graphics'), this.id('points'), this.id('overlay')]) if (!map.getSource(s)) map.addSource(s, {type: 'geojson', data: EMPTY, tolerance: 0});
        const kind = (k: string) => ['==', ['get', 'kind'], k] as ['==', ['get', string], string];
        const inBand = (k: string, b: number) => ['all', kind(k), ['==', ['coalesce', ['get', 'band'], 0], b]] as never;
        const add = (layer: Parameters<MapLibreMap['addLayer']>[0]) => {
            if (!map.getLayer(layer.id)) map.addLayer(layer, before);
        };
        // Each line's own cap and join (round unless its paint says otherwise).
        const lineLayout = {'line-cap': ['coalesce', ['get', 'cap'], 'round'], 'line-join': ['coalesce', ['get', 'join'], 'round'], 'line-miter-limit': 4} as never;
        const linePaint = {'line-color': ['get', 'color'], 'line-width': ['get', 'width']} as never;
        const fillPaint = {'fill-color': ['get', 'color'], 'fill-opacity': ['get', 'opacity']} as never;
        const labelLayout = {
            'icon-image': ['get', 'image'],
            'icon-rotate': ['get', 'rotation'],
            'icon-rotation-alignment': 'map',
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
        } as never;
        // Three stacks of the same kinds: the overlay's "under" marks, the graphics, the overlay.
        for (const [prefix, source] of [['under-', 'under'], ['', 'graphics'], ['overlay-', 'overlay']] as const) {
            for (let b = 0; b < PAINT_BANDS; b++) {
                add({id: this.id(`${prefix}fill-${b}`), type: 'fill', source: this.id(source), filter: inBand('fill', b), paint: fillPaint});
                add({id: this.id(`${prefix}line-${b}`), type: 'line', source: this.id(source), filter: inBand('line', b), layout: lineLayout, paint: linePaint});
            }
            if (source !== 'under') add({id: this.id(`${prefix}label`), type: 'symbol', source: this.id(source), filter: kind('label'), layout: labelLayout});
            // Point symbols as images, each whole, stacked in the collection's order, over the graphics' marks
            // and under the overlay. The order is the source's (`symbol-z-order: source`, the features are
            // written in the collection's order): a `symbol-sort-key` per symbol made MapLibre sort and draw by
            // key, five times slower to load and half the frame rate with thirty thousand symbols.
            if (source === 'graphics') {
                add({
                    id: this.id('point'),
                    type: 'symbol',
                    source: this.id('points'),
                    filter: kind('point'),
                    layout: {
                        'icon-image': ['get', 'image'],
                        'icon-anchor': 'top-left',
                        'icon-offset': ['get', 'offset'],
                        'icon-rotation-alignment': 'map',
                        'icon-pitch-alignment': this.pointPitchAlignment(),
                        'icon-size': iconSize(this.options.pointImages),
                        'icon-allow-overlap': true,
                        'icon-ignore-placement': true,
                        'symbol-z-order': 'source',
                    } as never,
                });
            }
            // Point symbols on leader lines, upright on screen, over the graphics and under the overlay.
            if (source === 'graphics') {
                add({
                    id: this.id('leader'),
                    type: 'symbol',
                    source: this.id('points'),
                    filter: kind('leader'),
                    layout: {
                        'icon-image': ['get', 'image'],
                        'icon-anchor': 'bottom',
                        'icon-offset': ['get', 'offset'],
                        'icon-pitch-alignment': 'viewport',
                        'icon-rotation-alignment': 'viewport',
                        'icon-size': iconSize(this.leaders),
                        'icon-allow-overlap': true,
                        'icon-ignore-placement': true,
                        // No sort key: tilted, MapLibre's own order (nearer over farther) is the one to keep.
                    } as never,
                });
            }
        }
        add({
            id: this.id('handles'),
            type: 'circle',
            source: this.id('overlay'),
            filter: kind('handle'),
            paint: {
                'circle-radius': ['get', 'radius'],
                'circle-color': ['get', 'color'],
                'circle-stroke-color': ['get', 'strokeColor'],
                'circle-stroke-width': 2,
            },
        });
        // Handles with a shape or a cross, as images; an arrow turns with the map.
        add({
            id: this.id('handle-images'),
            type: 'symbol',
            source: this.id('overlay'),
            filter: kind('handleImage'),
            layout: {
                'icon-image': ['get', 'image'],
                'icon-rotate': ['get', 'rotation'],
                'icon-rotation-alignment': 'map',
                'icon-pitch-alignment': 'viewport',
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
            } as never,
        });
        // Handles drawn away from their place on the ground (over a symbol up its leader line): upright on the
        // screen, so the offset is not turned by the map.
        add({
            id: this.id('handle-offsets'),
            type: 'symbol',
            source: this.id('overlay'),
            filter: kind('handleOffset'),
            layout: {
                'icon-image': ['get', 'image'],
                'icon-offset': ['get', 'offset'],
                'icon-rotation-alignment': 'viewport',
                'icon-pitch-alignment': 'viewport',
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
            } as never,
        });
    }

    // ── painting ──────────────────────────────────────────────────────────────

    /** Repaint on the next frame; several changes in one frame cost one paint. */
    private repaint(graphics: boolean, overlay: boolean, points = false): void {
        // A renderer disposed of draws nothing more: a new one on the same map may use its sources.
        if (this.disposed) return;
        this.dirtyGraphics ||= graphics;
        this.dirtyOverlay ||= overlay;
        this.dirtyPoints ||= points;
        if (this.frame) return;
        if (typeof requestAnimationFrame === 'undefined') return this.paintDirty();
        this.frame = requestAnimationFrame(() => {
            this.frame = 0;
            this.paintDirty();
        });
    }

    private repaintNow(): void {
        this.dirtyGraphics = true;
        this.dirtyOverlay = true;
        this.dirtyPoints = true;
        this.paintDirty();
    }

    private paintDirty(): void {
        if (this.disposed) return;
        const map = this.map;
        const graphics = map.getSource(this.id('graphics')) as GeoJSONSource | undefined;
        const points = map.getSource(this.id('points')) as GeoJSONSource | undefined;
        if (!graphics || !points) return;
        const resolution = resolutionAtZoom(map.getZoom());
        // Changed graphics alone, when nothing needs a full paint of the points.
        if (!this.dirtyPoints && this.changed.size) this.paintChanged(points, resolution);
        this.changed.clear();
        if (this.dirtyGraphics || this.dirtyPoints) {
            this.usedNow = new Set();
            const marks: Feature[] = [];
            const symbols: Feature[] | null = this.dirtyPoints ? [] : null;
            const withMarks = new Set<string>();
            if (symbols) {
                this.usedPointsNow = new Set();
                this.pointFeatures.clear();
            }
            this.collection.list().forEach((f, order) => {
                const id = graphicId(f);
                const [m, n] = [marks.length, symbols?.length ?? 0];
                this.paintFeature(f, resolution, order, marks, symbols);
                if (marks.length > m) withMarks.add(id);
                if (symbols && symbols.length > n) this.pointFeatures.set(id, this.numbered(id, symbols[symbols.length - 1]));
            });
            graphics.setData({type: 'FeatureCollection', features: marks});
            this.usedByGraphics = this.usedNow;
            this.withMarks = withMarks;
            if (symbols) {
                for (const id of [...this.pointIds.keys()]) if (!this.pointFeatures.has(id)) this.pointIds.delete(id);
                points.setData({type: 'FeatureCollection', features: [...this.pointFeatures.values()]});
                this.usedByPoints = this.usedPointsNow!;
                this.usedPointsNow = null;
            }
        }
        if (this.dirtyOverlay) {
            this.usedNow = new Set();
            this.newHandleImage = false;
            this.paintOverlay(resolution);
            this.usedByOverlay = this.usedNow;
        }
        this.usedNow = null;
        this.dirtyGraphics = false;
        this.dirtyOverlay = false;
        this.dirtyPoints = false;
        this.pruneImages();
        if (this.newHandleImage) {
            this.newHandleImage = false;
            this.map.once('idle', () => this.repaint(false, true));
        }
    }

    /**
     * Drop label images no source uses any more. Area labels change size continuously with the
     * zoom, so without this every zoom frame left a few more images on the map for good.
     */
    private pruneImages(): void {
        for (const key of [...this.images]) {
            if (this.usedByGraphics.has(key) || this.usedByPoints.has(key) || this.usedByOverlay.has(key)) continue;
            if (this.map.hasImage(key)) this.map.removeImage(key);
            this.images.delete(key);
            this.leaderFeet.delete(key);
            this.pointOffsets.delete(key);
        }
    }

    /** A point feature with its graphic's numeric id, which the points source keys `updateData` by. */
    private numbered(id: string, feature: Feature): Feature {
        let n = this.pointIds.get(id);
        if (n === undefined) this.pointIds.set(id, (n = this.nextPointId++));
        feature.id = n;
        return feature;
    }

    /**
     * Sends the graphics changed since the last paint to the points source alone. A changed graphic that
     * draws marks (a line, an area, an underlay), or drew them before, needs the marks repainted too.
     */
    private paintChanged(points: GeoJSONSource, resolution: number): void {
        const add: Feature[] = [];
        const remove: number[] = [];
        const update: {id: number; newGeometry: Feature['geometry']; addOrUpdateProperties?: {key: string; value: unknown}[]}[] = [];
        // Whether any symbol's image may have changed: a move alone keeps every image in use.
        let looks = false;
        this.usedPointsNow = new Set();
        for (const id of this.changed) {
            const f = this.collection.get(id);
            const before = this.pointFeatures.get(id);
            const marks: Feature[] = [];
            const symbols: Feature[] = [];
            // A changed symbol keeps its place in the stack.
            if (f) this.paintFeature(f, resolution, Number(before?.properties?.order ?? 0), marks, symbols);
            if (marks.length || this.withMarks.has(id)) this.dirtyGraphics = true;
            const now = symbols[0] ? this.numbered(id, symbols[0]) : undefined;
            if (before && now) {
                // Only the properties that changed: for a move, none, and MapLibre has less to compare and send.
                const props = now.properties ?? {};
                const was = before.properties ?? {};
                const changed = Object.keys(props).filter((key) => !sameValue(props[key], was[key]));
                if (changed.length) looks = true;
                update.push({id: now.id as number, newGeometry: now.geometry, ...(changed.length ? {addOrUpdateProperties: changed.map((key) => ({key, value: props[key]}))} : {})});
                this.pointFeatures.set(id, now);
            } else if (now) {
                add.push(now);
                this.pointFeatures.set(id, now);
            } else if (before) {
                remove.push(before.id as number);
                this.pointFeatures.delete(id);
                this.pointIds.delete(id);
            }
        }
        this.usedPointsNow = null;
        // The images the points source uses now, from every point feature: a look a changed symbol no
        // longer has is dropped (a track whose direction keeps changing once kept every image it drew).
        // Symbols that only moved use the images they used: nothing to count again.
        if (looks || add.length || remove.length) {
            const used = new Set<string>();
            for (const p of this.pointFeatures.values()) {
                const image = (p.properties as {image?: unknown} | null)?.image;
                if (typeof image === 'string') used.add(image);
            }
            this.usedByPoints = used;
        }
        if (!add.length && !remove.length && !update.length) return;
        // MapLibre before 3.5 has no updateData: the whole source, as before.
        if (typeof points.updateData === 'function') void points.updateData({add: add as never, remove, update: update as never});
        else points.setData({type: 'FeatureCollection', features: [...this.pointFeatures.values()]});
    }

    /**
     * A graphic's marks into `marks`, and, when `symbols` is given, its point symbol (an image or a symbol on
     * a leader line) into `symbols`. A point drawn as an image keeps its underlay (marks in map units) on
     * the map, under it, among the marks.
     */
    private paintFeature(f: F, resolution: number, order: number, marks: Feature[], symbols: Feature[] | null): void {
        const under = () => {
            const u = this.painter.underlay?.(f, {resolution});
            if (u?.length) marks.push(...paintsToMapLibreFeatures(u, resolution, (p) => this.textImage(p)));
        };
        // Leader lines first: switched on, they stand the point symbols up, images or not.
        const leaders = this.leaders;
        const at = leaders?.pointOf(f);
        if (leaders && at) {
            under();
            if (!symbols) return;
            const image = this.leaderImage(f, at, leaders);
            if (image) symbols.push({type: 'Feature', geometry: {type: 'Point', coordinates: [at[0], at[1]]}, properties: {kind: 'leader', image: image.key, offset: [0, image.footPx], order}});
            return;
        }
        const points = this.options.pointImages;
        const pointAt = points?.pointOf(f);
        if (points && pointAt) {
            under();
            if (!symbols) return;
            const image = this.pointImage(f, pointAt, points);
            if (image) symbols.push({type: 'Feature', geometry: {type: 'Point', coordinates: [pointAt[0], pointAt[1]]}, properties: {kind: 'point', image: image.key, offset: image.offset, order}});
            return;
        }
        marks.push(...paintsToMapLibreFeatures(paintAll(this.painter, f, {resolution}), resolution, (p) => this.textImage(p)));
    }

    private paintOverlay(resolution: number): void {
        const over = this.map.getSource(this.id('overlay')) as GeoJSONSource | undefined;
        const under = this.map.getSource(this.id('under')) as GeoJSONSource | undefined;
        if (!over || !under) return;
        const o = this.overlay;
        under.setData({type: 'FeatureCollection', features: o ? paintsToMapLibreFeatures(o.under, resolution, (p) => this.textImage(p)) : []});
        const features: Feature[] = o ? paintsToMapLibreFeatures(o.over, resolution, (p) => this.textImage(p)) : [];
        for (const h of o?.handles ?? []) {
            features.push({
                type: 'Feature',
                geometry: {type: 'Point', coordinates: h.lonLat},
                properties: isPlainHandle(h)
                    ? {kind: 'handle', radius: h.radiusPx, color: h.fill, strokeColor: h.stroke}
                    : h.offsetPx
                      ? {kind: 'handleOffset', image: this.handleImage(h), offset: h.offsetPx}
                      : {kind: 'handleImage', image: this.handleImage(h), rotation: h.rotation ?? 0},
            });
        }
        over.setData({type: 'FeatureCollection', features});
    }

    private readonly pointOffsets = new Map<string, [number, number]>();

    /**
     * A point symbol as one image, drawn once per look: painted at one meter a pixel, so its marks in
     * meters are its size in pixels. The offset puts its anchor on the location.
     */
    private pointImage(f: F, at: readonly number[], points: MapLibrePointImages<F>): {key: string; offset: [number, number]} | null {
        const look = points.imageKey ? points.imageKey(f) : JSON.stringify((f as {properties?: unknown}).properties);
        const key = `${this.prefix}-point:${this.generation}:${look}`;
        this.usedPointsNow?.add(key);
        const known = this.pointOffsets.get(key);
        if (known && this.images.has(key) && this.map.hasImage(key)) return {key, offset: known};
        const ratio = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
        const drawn = drawPaintsImage(this.painter.paint(f, {resolution: 1}), toMercator([at[0], at[1]]), 1, ratio);
        if (!drawn) return null;
        const ctx = drawn.canvas.getContext('2d')!;
        if (!this.map.hasImage(key)) this.map.addImage(key, ctx.getImageData(0, 0, drawn.canvas.width, drawn.canvas.height), {pixelRatio: ratio});
        this.images.add(key);
        const offset: [number, number] = [-drawn.anchorPx[0], -drawn.anchorPx[1]];
        this.pointOffsets.set(key, offset);
        return {key, offset};
    }

    /**
     * A point symbol on its leader line, drawn once per look: painted at one meter a pixel, so its
     * marks in meters are its size in pixels, as on Cesium.
     */
    private leaderImage(f: F, at: readonly number[], leaders: MapLibrePointLeaders<F>): {key: string; footPx: number} | null {
        const look = leaders.imageKey ? leaders.imageKey(f) : JSON.stringify((f as {properties?: unknown}).properties);
        const key = `${this.prefix}-leader:${this.generation}:${look}`;
        this.usedPointsNow?.add(key);
        const known = this.leaderFeet.get(key);
        if (known !== undefined && this.images.has(key) && this.map.hasImage(key)) return {key, footPx: known};
        const ratio = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
        const drawn = drawPointLeaderImage(this.painter.paint(f, {resolution: 1}), toMercator([at[0], at[1]]), 1, ratio, leaders);
        if (!drawn) return null;
        const ctx = drawn.canvas.getContext('2d')!;
        if (!this.map.hasImage(key)) this.map.addImage(key, ctx.getImageData(0, 0, drawn.canvas.width, drawn.canvas.height), {pixelRatio: ratio});
        this.images.add(key);
        this.leaderFeet.set(key, drawn.footPx);
        return {key, footPx: drawn.footPx};
    }

    /**
     * One image per distinct label look, drawn once and reused. The size is rounded to half a
     * pixel, so a label that shrinks continuously reuses a handful of images, not one per frame.
     */
    /**
     * A shaped handle's image, drawn once per look and kept: a handful of looks at most, and an image
     * removed and added again under the same name was not drawn until the map moved.
     */
    private handleImage(h: OverlayHandle): string {
        const key = `${this.prefix}-${handleImageKey(h)}`;
        if (this.map.hasImage(key)) return key;
        const ratio = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
        const {canvas} = drawHandleImage(h, ratio);
        const ctx = canvas.getContext('2d')!;
        this.map.addImage(key, ctx.getImageData(0, 0, canvas.width, canvas.height), {pixelRatio: ratio});
        this.handleImages.add(key);
        // The overlay's layout may already have asked for the image: lay it out again once it is there.
        this.newHandleImage = true;
        return key;
    }

    private newHandleImage = false;
    private readonly handleImages = new Set<string>();

    private textImage(p: Paint): string {
        const t = p.text!;
        const key = `${this.prefix}-text:${labelImageKey(t)}`;
        this.usedNow?.add(key);
        if (this.images.has(key) && this.map.hasImage(key)) return key;
        const ratio = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
        const canvas = drawLabelImage(t, ratio);
        const [w, h] = [canvas.width, canvas.height];
        const ctx = canvas.getContext('2d')!;
        if (!this.map.hasImage(key)) this.map.addImage(key, ctx.getImageData(0, 0, w, h), {pixelRatio: ratio});
        this.images.add(key);
        return key;
    }
}
