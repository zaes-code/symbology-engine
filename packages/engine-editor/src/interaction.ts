/**
 * # The editor
 *
 * Draw, select, move, reshape and delete, written once against a small view adapter so every map
 * engine edits identically: each renderer only forwards its pointer and key events here and paints
 * what {@link SymbolInteraction.overlay} returns. A gesture rule stated in two renderers drifts;
 * stated here it cannot. It is written once for every family, too: what differs between them
 * comes from an {@link EditorFamily}.
 *
 * Everything is measured in screen pixels — hit tolerance, handle size, the "same point" rule —
 * because those are about the operator's hand, not about the ground. The editor works on a
 * graphic's *drawn points* ({@link drawnPoints}), so lines and areas share every rule below and
 * differ only where geometry makes them: an area needs three points, and its last point joins
 * its first.
 *
 * | Gesture | Effect |
 * |---|---|
 * | Drawing: click | add a point |
 * | Drawing: double-click, Enter | finish (a line needs two distinct points, an area three) |
 * | Drawing: Backspace | remove the last point |
 * | Drawing: Escape | cancel |
 * | Drag a vertex handle | move that point |
 * | Drag a "+" handle | insert a point there and move it (an area has one on its closing edge too) |
 * | Alt-click a vertex | remove it (never below the minimum) |
 * | Drag the outline (or inside an area the family picks inside) | select it and move the whole graphic |
 * | Drag a point's rotate or resize handle | turn it, or change its size |
 * | Click empty map | deselect (the map pans as usual) |
 * | Delete | remove the selected graphic |
 * | Arrow keys (Shift: ×10) | nudge the selected graphic a pixel at a time |
 * | Ctrl/Cmd+D | duplicate the selected graphic, offset so the copy is visible |
 *
 * Points finish on their own: one click places a point graphic; one with a direction (a wind
 * barb) takes two, the anchor and then the direction, with the graphic following the pointer in
 * between. A selected one has a rotate handle where the family puts it (the barb's shaft tip). A
 * family may also let a point be turned after it is placed ({@link EditorFamily.rotation}) and
 * resized ({@link EditorFamily.size}), each with a handle of its own.
 *
 * An area whose outline would cross itself cannot be finished: the editor emits `rejected` with
 * the reason and keeps drawing, so the operator can move on or take the last point back.
 *
 * A host shapes the editor with {@link EditorOptions}: handle and hit sizes, snapping, which
 * actions are allowed, a veto on every change, and whether the editor answers keys at all.
 */

import type {Position} from 'geojson';
import {
    circleRing,
    drawnPoints,
    fromMercator,
    geometryForKind,
    minimumPointsFor,
    pointInRing,
    ringSelfIntersects,
    toMercator,
    toMercatorNear,
    continuousLonLat,
    type Pixel,
    type PointerInput,
    type SymbolCollection,
    type SymbolFeature,
    type ViewAdapter,
} from '@zaes/symbology-engine';
import type {DirectionRule, EditorFamily, SizeRule} from './family.js';

export type {Pixel, PointerInput, ViewAdapter};

export type EditMode = 'idle' | 'drawing' | 'dragVertex' | 'dragGraphic' | 'rotate' | 'resize';

export interface HandleMark {
    lonLat: [number, number];
    /** `rotate`: a point's direction or rotation handle (a wind barb's shaft tip). `resize`: a point's size handle. */
    kind: 'vertex' | 'insert' | 'rotate' | 'resize';
    /** The point index, or for an insert handle the index the new point will take. */
    index: number;
    hot: boolean;
    /** A point graphic's one vertex: its anchor. */
    anchor?: boolean;
    /**
     * A point's location handle put where the symbol is drawn, away from its location (a unit in its place in
     * a group at one location): over the symbol, so it shows which one is selected. Dragging it moves the
     * location there.
     */
    centered?: boolean;
    /** Drawn this far from `lonLat` on the screen, in CSS pixels (y down): over a symbol up its leader line. */
    offsetPx?: [number, number];
    /** A rotate handle's direction from the anchor, degrees clockwise from north. */
    rotation?: number;
}

export interface EditorOverlay<F = SymbolFeature<string, {name: string}>> {
    /** The graphic being drawn, including the rubber-band point, once it has enough points to paint. */
    draft?: F;
    /** The selected graphic. */
    selection?: F;
    /** The selected graphic's painted outline in EPSG:4326, for a renderer that highlights it. */
    selectionOutline?: [number, number][];
    /**
     * The construction line: the drawn points joined straight, closed for an area. Shown while
     * drawing and on a selection, because a smoothed graphic does not pass through its points.
     */
    guide?: [number, number][];
    handles: HandleMark[];
}

/**
 * `change`: repaint the overlay. `drawend`: a graphic was finished. `commit`: a gesture that changed
 * the collection has ended — the moment a host records an undo step. `rejected`: a graphic could not
 * be finished, with the reason (`refused` when {@link EditorOptions.beforeChange} turned it down).
 */
export type EditorListener = (
    event: {type: 'change'} | {type: 'drawend'; id: string} | {type: 'commit'} | {type: 'rejected'; reason: string},
) => void;

/** What the operator can do to graphics, each of which a host may forbid. */
export type EditorAction = 'draw' | 'move' | 'reshape' | 'rotate' | 'resize' | 'delete' | 'duplicate';

/**
 * A change the editor is about to make. `before` is the graphic as it is (`null` for a new one),
 * `after` as it would be (`null` for a deletion).
 */
export interface EditorChange<F> {
    action: EditorAction;
    id: string | null;
    before: F | null;
    after: F | null;
}

export interface EditorOptions<F> {
    /** A vertex handle's radius in CSS pixels; insert handles are drawn smaller. Default 7. */
    handleRadiusPx?: number;
    /** How near the pointer must come to a line or outline to pick it, in CSS pixels. Default 8. */
    hitTolerancePx?: number;
    /**
     * Snap a point being drawn or dragged onto another graphic's point within this many CSS
     * pixels, so lines meet exactly (fronts at a low). Default 0: off.
     */
    snapPx?: number;
    /** Forbid every change: graphics can be selected, never drawn, moved or deleted. */
    readOnly?: boolean;
    /** Forbid single actions; an action left out is allowed. A forbidden action's handles are not shown. */
    allow?: Partial<Record<EditorAction, boolean>>;
    /**
     * Forbid an action for one graphic: return `false` and it is refused, and its handles are not shown,
     * while that graphic is selected. Asked after `allow`, for every action but `draw`.
     */
    allowFor?(feature: F, action: EditorAction): boolean;
    /**
     * Called before every change, during a drag as well as at its end: return `false` to refuse
     * it. A refused drag step is skipped and the graphic stays where it last was allowed to be.
     */
    beforeChange?(change: EditorChange<F>): boolean;
    /** Whether the editor answers keys (Enter, Escape, Delete, the arrows, Ctrl+D). Default true. */
    keyboard?: boolean;
}

/** Default pixel sizes. */
export const HIT_TOLERANCE_PX = 8;
export const HANDLE_RADIUS_PX = 7;
export const INSERT_HANDLE_RADIUS_PX = 5;
const SAME_POINT_PX = 4;
/** Projected meters of the step the view's scale is read over at a place (see `resolutionAt`). */
const RESOLUTION_STEP_M = 50;

function distanceToSegment(p: Pixel, a: Pixel, b: Pixel): number {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
    return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t));
}

const near = (a: Pixel, b: Pixel, r: number) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= r;

/** Arrow keys, as a one-pixel screen offset (y down). */
const NUDGE: Record<string, [number, number]> = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]};

/** Degrees clockwise from north, from `a` toward `b`, measured in projected space. */
function bearing(a: Position, b: Position): number {
    // b on a's side of the antimeridian: the short way, not round the world.
    const ma = toMercator(a);
    const mb = toMercatorNear(b, ma);
    const deg = (Math.atan2(mb[0] - ma[0], mb[1] - ma[1]) * 180) / Math.PI;
    return Math.round(((deg % 360) + 360) % 360);
}

/** How close a click must be to a point graphic's anchor to pick it. */
const POINT_HIT_PX = 18;

/** The resize handle sits down and to the right of a point symbol, on the diagonal. */
const RESIZE_DIAGONAL = Math.SQRT1_2;

/** The point pairs that are edges: consecutive points, plus last-to-first for an area. */
function edges(count: number, closed: boolean): [number, number][] {
    const out: [number, number][] = [];
    for (let i = 0; i < count - 1; i++) out.push([i, i + 1]);
    if (closed && count >= 3) out.push([count - 1, 0]);
    return out;
}

export class SymbolInteraction<K extends string, P extends {name: string}> {
    private modeValue: EditMode = 'idle';
    private selectedIdValue: string | null = null;
    private drawName: P['name'] | null = null;
    private drawProps = {} as Omit<P, 'name'>;
    private drawPoints: [number, number][] = [];
    private rubber: [number, number] | null = null;
    private dragIndex = -1;
    /**
     * A drag under way: where it was pressed, the graphic's points then, and for a point symbol its
     * location's offset from the press on screen (`grab`).
     */
    private dragStart: {pixel: Pixel; points: Position[]; grab?: Pixel} | null = null;
    /** Whether the gesture in progress has changed anything, so a click without a drag commits nothing. */
    private dragMoved = false;
    private hover: {kind: HandleMark['kind']; index: number} | null = null;
    private options: EditorOptions<SymbolFeature<K, P>>;
    private readonly listeners = new Set<EditorListener>();
    private readonly unsubscribe: () => void;

    constructor(
        readonly family: EditorFamily<K, P>,
        readonly collection: SymbolCollection<K, P>,
        private view: ViewAdapter,
        options: EditorOptions<SymbolFeature<K, P>> = {},
    ) {
        this.options = {...options};
        this.unsubscribe = collection.subscribe(() => {
            if (this.selectedIdValue && !collection.has(this.selectedIdValue)) this.select(null);
        });
    }

    /** Point the editor at another view, as when the host switches map engines. */
    setView(view: ViewAdapter): void {
        this.view = view;
    }

    /** Change some options; the rest keep their values. Drawing in progress is canceled if drawing is now forbidden. */
    setOptions(options: EditorOptions<SymbolFeature<K, P>>): void {
        this.options = {...this.options, ...options};
        if (this.modeValue === 'drawing' && !this.may('draw')) this.resetDraw();
        this.hover = null;
        this.changed();
    }

    getOptions(): Readonly<EditorOptions<SymbolFeature<K, P>>> {
        return {...this.options};
    }

    /** A vertex handle's radius in CSS pixels. */
    get handleRadiusPx(): number {
        return this.options.handleRadiusPx ?? HANDLE_RADIUS_PX;
    }

    /** An insert handle's radius in CSS pixels. */
    get insertHandleRadiusPx(): number {
        return Math.max(2, Math.round((this.handleRadiusPx * INSERT_HANDLE_RADIUS_PX) / HANDLE_RADIUS_PX));
    }

    get mode(): EditMode {
        return this.modeValue;
    }

    get selectedId(): string | null {
        return this.selectedIdValue;
    }

    /** What is being drawn, if anything. */
    get drawing(): P['name'] | null {
        return this.modeValue === 'drawing' ? this.drawName : null;
    }

    /** Whether the host allows an action now, and for `feature` when given. */
    may(action: EditorAction, feature?: SymbolFeature<K, P>): boolean {
        if (this.options.readOnly || this.options.allow?.[action] === false) return false;
        return !feature || !this.options.allowFor || this.options.allowFor(feature, action) !== false;
    }

    subscribe(listener: EditorListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    dispose(): void {
        this.unsubscribe();
        this.listeners.clear();
    }

    // ── commands ──────────────────────────────────────────────────────────────

    /** Start drawing a graphic. Does nothing when drawing is not allowed. */
    startDrawing(name: P['name'], props = {} as Omit<P, 'name'>): void {
        if (!this.may('draw')) return;
        this.selectedIdValue = null;
        this.modeValue = 'drawing';
        this.drawName = name;
        this.drawProps = {...props};
        this.drawPoints = [];
        this.rubber = null;
        this.changed();
    }

    cancelDrawing(): void {
        if (this.modeValue !== 'drawing') return;
        this.resetDraw();
        this.changed();
    }

    /** Take back the last point drawn. Returns whether there was one. */
    removeLastPoint(): boolean {
        if (this.modeValue !== 'drawing' || this.drawPoints.length === 0) return false;
        this.drawPoints.pop();
        this.changed();
        return true;
    }

    /** Finish the graphic being drawn. Returns its id, or `null` if it had too few points or was refused. */
    finishDrawing(): string | null {
        if (this.modeValue !== 'drawing' || !this.drawName) return null;
        const kind = this.kindOf(this.drawName);
        const points = this.distinctPoints(this.drawPoints);
        let feature: SymbolFeature<K, P>;
        if (kind === 'point') {
            if (points.length < this.pointClicks(this.drawName)) return null;
            const rule = this.directionOf(this.drawName);
            const extra = rule ? rule.set(bearing(points[0], points[1])) : {};
            feature = this.feature(this.drawName, points.slice(0, 1), {...this.drawProps, ...extra});
        } else {
            if (points.length < minimumPointsFor(kind)) return null;
            if (kind === 'area' && ringSelfIntersects(continuousLonLat(points).map(toMercator))) {
                this.reject('The outline crosses itself. Add a point that untangles it, or press Backspace to take the last one back.');
                return null;
            }
            feature = this.feature(this.drawName, points, this.drawProps);
        }
        if (!this.vet('draw', null, null, feature)) {
            // A point would be refused again on the next click, so it stops; a line keeps drawing.
            if (kind === 'point') this.resetDraw();
            this.changed();
            this.reject('refused');
            return null;
        }
        const id = this.collection.add(feature);
        this.resetDraw();
        this.selectedIdValue = id;
        this.changed();
        for (const l of [...this.listeners]) l({type: 'drawend', id});
        this.commit();
        return id;
    }

    select(id: string | null): void {
        if (this.selectedIdValue === id) return;
        this.selectedIdValue = id && this.collection.has(id) ? id : null;
        this.hover = null;
        this.changed();
    }

    /**
     * Copy the selected graphic, `offsetPx` screen pixels down and right so it does not hide under
     * the original, and select the copy. Returns the copy's id.
     */
    duplicateSelected(offsetPx = 16): string | null {
        const f = this.selectedFeature();
        if (!f || !this.may('duplicate', f)) return null;
        const {name, ...rest} = this.propsOf(f);
        const copy = this.feature(name, this.shifted(drawnPoints(f), offsetPx, offsetPx), rest as Omit<P, 'name'>);
        if (!this.vet('duplicate', null, null, copy)) return null;
        const id = this.collection.add(copy);
        this.selectedIdValue = id;
        this.changed();
        this.commit();
        return id;
    }

    /** Move the selected graphic by a screen offset, keeping its shape. */
    nudgeSelected(dxPx: number, dyPx: number): boolean {
        const f = this.selectedFeature();
        if (!f || !this.may('move', f)) return false;
        if (!this.setPoints('move', f, this.shifted(drawnPoints(f), dxPx, dyPx))) return false;
        this.changed();
        this.commit();
        return true;
    }

    deleteSelected(): boolean {
        const f = this.selectedFeature();
        if (!f || !this.may('delete', f)) return false;
        const id = f.id as string;
        if (!this.vet('delete', id, f, null)) return false;
        this.selectedIdValue = null;
        this.collection.remove(id);
        this.changed();
        this.commit();
        return true;
    }

    // ── events; each returns true when it consumed the event ───────────────────

    pointerDown(e: PointerInput): boolean {
        if (this.modeValue === 'drawing') {
            const ll = this.snapped(e.pixel, null);
            const last = this.drawPoints[this.drawPoints.length - 1];
            if (!last || !near(this.view.toPixel(last), e.pixel, SAME_POINT_PX)) this.drawPoints.push(ll);
            this.rubber = null;
            this.changed();
            // A point graphic is done on its last click.
            if (this.drawName && this.kindOf(this.drawName) === 'point' && this.drawPoints.length >= this.pointClicks(this.drawName)) this.finishDrawing();
            return true;
        }

        const selected = this.selectedFeature();
        if (selected) {
            const points = drawnPoints(selected);
            const handle = this.handleAt(selected, e.pixel);
            if (handle?.kind === 'rotate' || handle?.kind === 'resize') {
                this.modeValue = handle.kind;
                this.dragMoved = false;
                this.changed();
                return true;
            }
            // A location handle over its symbol moves the symbol as a drag of it does: held where it is drawn.
            if (handle?.kind === 'vertex' && handle.centered && this.may('move', selected)) {
                this.modeValue = 'dragGraphic';
                this.dragMoved = false;
                const loc = this.drawnAnchor(selected);
                this.dragStart = {pixel: e.pixel, points, grab: [loc[0] - e.pixel[0], loc[1] - e.pixel[1]]};
                this.changed();
                return true;
            }
            if (handle?.kind === 'vertex') {
                if (e.altKey) {
                    if (points.length > minimumPointsFor(this.kindOf(this.propsOf(selected).name)) && this.setPoints('reshape', selected, points.filter((_, i) => i !== handle.index))) {
                        this.commit();
                    }
                    this.changed();
                    return true;
                }
                this.beginVertexDrag(handle.index);
                return true;
            }
            if (handle?.kind === 'insert') {
                const next = [...points];
                next.splice(handle.index, 0, this.view.toLonLat(e.pixel));
                if (!this.setPoints('reshape', selected, next)) return true;
                this.beginVertexDrag(handle.index);
                // An inserted point is a change even if it is never dragged.
                this.dragMoved = true;
                return true;
            }
        }

        const hit = this.graphicAt(e.pixel);
        if (hit) {
            this.selectedIdValue = hit;
            if (this.may('move', this.collection.get(hit))) {
                this.modeValue = 'dragGraphic';
                this.dragMoved = false;
                const points = drawnPoints(this.collection.get(hit)!);
                const kind = this.kindOf(this.propsOf(this.collection.get(hit)!).name);
                // A point keeps its location where it was against the cursor: on a 3D map the symbol
                // is pressed up its leader line, and the ground under the cursor there is far off.
                // A symbol drawn away from its location (in a group's place) is held where it is drawn.
                const loc = kind === 'point' && points.length === 1 ? this.drawnAnchor(this.collection.get(hit)!) : null;
                this.dragStart = {pixel: e.pixel, points, ...(loc ? {grab: [loc[0] - e.pixel[0], loc[1] - e.pixel[1]] as Pixel} : {})};
            }
            this.changed();
            return true;
        }

        if (this.selectedIdValue) {
            this.selectedIdValue = null;
            this.changed();
        }
        return false;
    }

    pointerMove(e: PointerInput): boolean {
        switch (this.modeValue) {
            case 'drawing':
                if (this.drawPoints.length > 0) {
                    this.rubber = this.snapped(e.pixel, null);
                    this.changed();
                }
                return false;
            case 'rotate': {
                const f = this.selectedFeature();
                const rule = f ? this.rotationOf(this.propsOf(f).name) : undefined;
                if (!f || !rule) return false;
                const dir = bearing(this.drawnLocation(f), this.view.toLonLat(e.pixel));
                if (dir !== rule.get(this.propsOf(f)) && this.setProperties('rotate', f, rule.set(dir))) this.dragMoved = true;
                this.changed();
                return true;
            }
            case 'resize': {
                const f = this.selectedFeature();
                const rule = f ? this.sizeOf(this.propsOf(f).name) : undefined;
                if (!f || !rule) return false;
                const center = this.symbolCenter(f);
                const res = this.resolutionAt(drawnPoints(f)[0]);
                const scale = Math.hypot(e.pixel[0] - center[0], e.pixel[1] - center[1]) / rule.radiusPx;
                const patch = rule.set(Math.max(0.1, scale), res);
                const props = this.propsOf(f);
                if (rule.get({...props, ...patch} as P, res) !== rule.get(props, res) && this.setProperties('resize', f, patch)) this.dragMoved = true;
                this.changed();
                return true;
            }
            case 'dragVertex': {
                const f = this.selectedFeature();
                if (!f) return false;
                const next = drawnPoints(f);
                next[this.dragIndex] = this.snapped(e.pixel, f.id as string);
                if (this.setPoints('reshape', f, next)) this.dragMoved = true;
                this.changed();
                return true;
            }
            case 'dragGraphic': {
                const f = this.selectedFeature();
                if (!f || !this.dragStart) return false;
                const grab = this.dragStart.grab;
                if (grab) {
                    // A point symbol: its location is the ground under the cursor plus the offset it
                    // was pressed at, so it stays under the cursor on a tilted map as on a flat one.
                    // Moving the cursor by the ground under it instead made a lifted symbol jump:
                    // that ground lies far past the location, across the terrain.
                    const from = toMercator(this.dragStart.points[0]);
                    const to = toMercatorNear(this.view.toLonLat([e.pixel[0] + grab[0], e.pixel[1] + grab[1]]), from);
                    if (this.setPoints('move', f, [fromMercator(to)])) this.dragMoved = true;
                    this.changed();
                    return true;
                }
                // Translate in projected meters, so the shape is unchanged wherever it is dragged.
                // A drag across the antimeridian is a short one: b on a's side of it.
                const a = toMercator(this.view.toLonLat(this.dragStart.pixel));
                const b = toMercatorNear(this.view.toLonLat(e.pixel), a);
                const dx = b[0] - a[0];
                const dy = b[1] - a[1];
                const moved = this.dragStart.points.map((c) => {
                    const m = toMercator(c);
                    return fromMercator([m[0] + dx, m[1] + dy]);
                });
                if (this.setPoints('move', f, moved)) this.dragMoved = true;
                this.changed();
                return true;
            }
            default: {
                const before = JSON.stringify(this.hover);
                const f = this.selectedFeature();
                const handle = f ? this.handleAt(f, e.pixel) : null;
                this.hover = handle ? {kind: handle.kind, index: handle.index} : null;
                if (JSON.stringify(this.hover) !== before) this.changed();
                return false;
            }
        }
    }

    pointerUp(_e?: PointerInput): boolean {
        if (this.modeValue === 'dragVertex' || this.modeValue === 'dragGraphic' || this.modeValue === 'rotate' || this.modeValue === 'resize') {
            this.modeValue = 'idle';
            this.dragIndex = -1;
            this.dragStart = null;
            const moved = this.dragMoved;
            this.dragMoved = false;
            this.changed();
            if (moved) this.commit();
            return true;
        }
        return this.modeValue === 'drawing';
    }

    doubleClick(_e?: PointerInput): boolean {
        if (this.modeValue !== 'drawing') return false;
        this.finishDrawing();
        return true;
    }

    /** Keys, by `KeyboardEvent.key`. Nothing when {@link EditorOptions.keyboard} is false. */
    keyDown(key: string): boolean {
        if (this.options.keyboard === false) return false;
        if (this.modeValue === 'drawing') {
            if (key === 'Escape') return this.cancelDrawing(), true;
            if (key === 'Enter') return this.finishDrawing(), true;
            if (key === 'Backspace') return this.removeLastPoint(), true;
            return false;
        }
        if ((key === 'Delete' || key === 'Backspace') && this.selectedIdValue) return this.deleteSelected();
        if (key === 'Escape' && this.selectedIdValue) {
            this.select(null);
            return true;
        }
        const step = this.selectedIdValue ? NUDGE[key] : undefined;
        if (step) return this.nudgeSelected(step[0], step[1]);
        return false;
    }

    /** Keys with modifiers: Shift-nudges ten pixels, Ctrl/Cmd+D duplicates. */
    keyDownWith(key: string, modifiers: {shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean}): boolean {
        if (this.options.keyboard === false) return false;
        if (this.modeValue !== 'idle') return this.keyDown(key);
        if ((modifiers.ctrlKey || modifiers.metaKey) && key.toLowerCase() === 'd') return this.duplicateSelected() !== null;
        if (modifiers.ctrlKey || modifiers.metaKey) return false;
        const step = this.selectedIdValue ? NUDGE[key] : undefined;
        if (step && modifiers.shiftKey) return this.nudgeSelected(step[0] * 10, step[1] * 10);
        return this.keyDown(key);
    }

    /** The cursor a renderer should show for the last pointer position. */
    cursor(): string {
        if (this.modeValue === 'drawing') return 'crosshair';
        if (this.modeValue === 'resize') return 'nwse-resize';
        if (this.modeValue === 'dragVertex' || this.modeValue === 'dragGraphic' || this.modeValue === 'rotate') return 'grabbing';
        if (this.hover) return {insert: 'copy', rotate: 'alias', resize: 'nwse-resize', vertex: 'grab'}[this.hover.kind];
        return '';
    }

    /** Whether a pixel is over a graphic, for a renderer's hover cursor. */
    isOverGraphic(pixel: Pixel): boolean {
        return this.graphicAt(pixel) !== null;
    }

    /** What a renderer draws with the graphics. */
    overlay(): EditorOverlay<SymbolFeature<K, P>> {
        const handles: HandleMark[] = [];
        const out: EditorOverlay<SymbolFeature<K, P>> = {handles};
        if (this.modeValue === 'drawing' && this.drawName && this.drawPoints.length > 0) {
            const kind = this.kindOf(this.drawName);
            const pts = this.rubber ? [...this.drawPoints, this.rubber] : [...this.drawPoints];
            if (kind === 'point') {
                // A directional point between its two clicks: the graphic, pointing at the pointer.
                const rule = this.directionOf(this.drawName);
                if (rule && pts.length >= 2) {
                    out.draft = this.feature(this.drawName, pts.slice(0, 1), {...this.drawProps, ...rule.set(bearing(pts[0], pts[1]))});
                }
            } else {
                const area = kind === 'area';
                if (pts.length >= minimumPointsFor(kind)) out.draft = this.feature(this.drawName, pts, this.drawProps);
                if (pts.length >= 2) out.guide = area && pts.length >= 3 ? [...pts, pts[0]] : pts;
            }
            this.drawPoints.forEach((p, index) => handles.push({lonLat: p, kind: 'vertex', index, hot: false}));
        }
        const f = this.selectedFeature();
        if (f) {
            const points = drawnPoints(f);
            const kind = this.kindOf(this.propsOf(f).name);
            const area = kind === 'area';
            const hot = (kind: HandleMark['kind'], index: number) => this.hover?.kind === kind && this.hover.index === index;
            out.selection = f;
            // Outlined by its drawn box on the ground; lifted, the box is up in the air, not on the ground.
            const box = kind === 'point' && (this.view.pointLiftPx?.() ?? 0) === 0 ? this.pickBoxOf(f, this.drawnAnchor(f)) : null;
            if (box) {
                // The symbol's drawn box, where the family draws it round its anchor.
                const [x0, y0, x1, y1] = box;
                out.selectionOutline = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]].map((p) => this.view.toLonLat(p as Pixel));
            } else if (kind === 'point') {
                // A point has no outline: a ring around it is its highlight, round the symbol where it is drawn.
                const center = this.view.toLonLat(this.symbolCenter(f));
                const res = this.resolutionAt(center);
                out.selectionOutline = circleRing(toMercator(center), POINT_HIT_PX * this.scaleOf(f) * res, 32).map(fromMercator);
            } else {
                out.selectionOutline = this.family.painter.outline(f).map(fromMercator);
                out.guide = area ? [...points, points[0]] : points;
            }
            for (const h of this.handlesOf(f)) handles.push({...h, hot: hot(h.kind, h.index)});
        }
        return out;
    }

    // ── internals ─────────────────────────────────────────────────────────────

    private selectedFeature(): SymbolFeature<K, P> | undefined {
        return this.selectedIdValue ? this.collection.get(this.selectedIdValue) : undefined;
    }

    private propsOf(f: SymbolFeature<K, P>): P {
        return f.properties[this.family.schema.key];
    }

    private kindOf(name: P['name']) {
        return this.family.schema.geometryOf(name);
    }

    private directionOf(name: P['name']): DirectionRule<P> | undefined {
        return this.kindOf(name) === 'point' ? this.family.direction?.(name) : undefined;
    }

    /** The rule the rotate handle follows: a drawn direction, else a rotation set after placing. */
    private rotationOf(name: P['name']): DirectionRule<P> | undefined {
        if (this.kindOf(name) !== 'point') return undefined;
        return this.directionOf(name) ?? this.family.rotation?.(name);
    }

    private sizeOf(name: P['name']): SizeRule<P> | undefined {
        return this.kindOf(name) === 'point' ? this.family.size?.(name) : undefined;
    }

    /** A point's on-screen scale, as its family draws it at the current view. */
    private scaleOf(f: SymbolFeature<K, P>): number {
        return this.sizeOf(this.propsOf(f).name)?.get(this.propsOf(f), this.resolutionAt(drawnPoints(f)[0])) ?? 1;
    }

    /** How many clicks draw a point graphic: one, or two for one with a direction. */
    private pointClicks(name: P['name']): number {
        return this.directionOf(name) ? 2 : 1;
    }

    /** A graphic of this family from drawn points. */
    private feature(name: P['name'], points: readonly Position[], props: Omit<P, 'name'>): SymbolFeature<K, P> {
        return {
            type: 'Feature',
            geometry: geometryForKind(this.kindOf(name), points),
            properties: {[this.family.schema.key]: {name, ...props}} as Record<K, P>,
        };
    }

    private vet(action: EditorAction, id: string | null, before: SymbolFeature<K, P> | null, after: SymbolFeature<K, P> | null): boolean {
        return this.options.beforeChange?.({action, id, before, after}) !== false;
    }

    /** New points for a graphic, if the host allows them. */
    private setPoints(action: EditorAction, f: SymbolFeature<K, P>, points: Position[]): boolean {
        const id = f.id as string;
        const after: SymbolFeature<K, P> = {...f, geometry: geometryForKind(this.kindOf(this.propsOf(f).name), points)};
        if (!this.vet(action, id, f, after)) return false;
        this.collection.setPoints(id, points);
        return true;
    }

    /** New properties for a graphic, if the host allows them. */
    private setProperties(action: EditorAction, f: SymbolFeature<K, P>, patch: Partial<Omit<P, 'name'>>): boolean {
        const id = f.id as string;
        const after = {...f, properties: {...f.properties, [this.family.schema.key]: {...this.propsOf(f), ...patch}}} as SymbolFeature<K, P>;
        if (!this.vet(action, id, f, after)) return false;
        this.collection.setProperties(id, patch);
        return true;
    }

    private beginVertexDrag(index: number): void {
        this.modeValue = 'dragVertex';
        this.dragIndex = index;
        this.dragMoved = false;
        this.changed();
    }

    /**
     * Where a pixel lands: on another graphic's point within {@link EditorOptions.snapPx}, else
     * under the pointer. `exclude` is the graphic being reshaped, which never snaps to itself.
     */
    private snapped(pixel: Pixel, exclude: string | null): [number, number] {
        const snapPx = this.options.snapPx ?? 0;
        if (snapPx > 0) {
            let best: [number, number] | null = null;
            let bestD = snapPx;
            for (const f of this.collection.list()) {
                if (f.id === exclude) continue;
                for (const c of drawnPoints(f)) {
                    const p = this.view.toPixel(c);
                    const d = Math.hypot(p[0] - pixel[0], p[1] - pixel[1]);
                    if (d <= bestD) {
                        bestD = d;
                        best = [c[0], c[1]];
                    }
                }
            }
            if (best) return best;
        }
        return this.view.toLonLat(pixel);
    }

    /** Points moved by a screen offset, translated in projected meters so the shape is kept. */
    private shifted(points: Position[], dxPx: number, dyPx: number): [number, number][] {
        if (points.length === 0) return [];
        const a = this.view.toPixel(points[0]);
        const m0 = toMercator(this.view.toLonLat(a));
        const m1 = toMercatorNear(this.view.toLonLat([a[0] + dxPx, a[1] + dyPx]), m0);
        const dx = m1[0] - m0[0];
        const dy = m1[1] - m0[1];
        return points.map((c) => {
            const m = toMercator(c);
            return fromMercator([m[0] + dx, m[1] + dy]);
        });
    }

    /**
     * Projected meters per screen pixel at a place on the current view: a short step east of it, on
     * the screen. Not the ground under the pixels beside it: on a 3D map those can lie past a ridge
     * (one on the slope in front, one far behind), and the scale read there jumped fivefold as a
     * symbol moved, throwing the handles placed by it.
     */
    private resolutionAt(lonLat: Position): number {
        const m = toMercator(lonLat);
        const a = this.view.toPixel(lonLat);
        const b = this.view.toPixel(fromMercator([m[0] + RESOLUTION_STEP_M, m[1]]));
        const px = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (px > 0 && Number.isFinite(px)) return RESOLUTION_STEP_M / px;
        // Off the view (the step behind the camera): the ground beside the place on the screen.
        const g = toMercator(this.view.toLonLat(a));
        const h = toMercatorNear(this.view.toLonLat([a[0] + 1, a[1]]), g);
        return Math.hypot(h[0] - g[0], h[1] - g[1]) || 1;
    }

    /** Where a point symbol is drawn on screen: its anchor, or up its leader line in 3D. */
    /** A point symbol's drawn box on screen [x0, y0, x1, y1], when its painter gives one. */
    private pickBoxOf(f: SymbolFeature<K, P>, anchor: Pixel): [number, number, number, number] | null {
        const b = this.family.painter.pickBox?.(f, this.resolutionAt(drawnPoints(f)[0]));
        return b ? [anchor[0] + b.x, anchor[1] + b.y, anchor[0] + b.x + b.width, anchor[1] + b.y + b.height] : null;
    }

    private symbolCenter(f: SymbolFeature<K, P>): Pixel {
        const lift = this.view.pointLiftPx?.() ?? 0;
        const a = this.drawnAnchor(f);
        return [a[0], a[1] - lift];
    }

    /** Where a point symbol's anchor is drawn on screen: its location, moved by the painter's drawn offset. */
    private drawnAnchor(f: SymbolFeature<K, P>): Pixel {
        const at = drawnPoints(f)[0];
        const a = this.view.toPixel(at);
        const o = this.family.painter.drawnOffset?.(f, this.resolutionAt(at));
        return o ? [a[0] + o.x, a[1] + o.y] : a;
    }

    /** A point's rotate handle, where its family puts it (north when it has no direction yet). */
    private rotateHandle(f: SymbolFeature<K, P>): [number, number] | null {
        const rule = this.rotationOf(this.propsOf(f).name);
        if (!rule) return null;
        const anchor = this.drawnLocation(f);
        const props = this.propsOf(f);
        return fromMercator(rule.tip(toMercator(anchor), rule.get(props) ?? 0, this.resolutionAt(anchor), props));
    }

    /**
     * Where a point's direction is measured from: its location, or on a flat map where the painter draws it
     * away from its location, the ground under where it is drawn (on leader lines the ground under the drawing is
     * far off: the location).
     */
    private drawnLocation(f: SymbolFeature<K, P>): Position {
        const at = drawnPoints(f)[0];
        if ((this.view.pointLiftPx?.() ?? 0) > 0 || !this.family.painter.drawnOffset?.(f, this.resolutionAt(at))) return at;
        return this.view.toLonLat(this.drawnAnchor(f));
    }

    /** A point's resize handle: on the diagonal down and to the right, at its size's radius. */
    private resizeHandle(f: SymbolFeature<K, P>): [number, number] | null {
        const rule = this.sizeOf(this.propsOf(f).name);
        if (!rule) return null;
        const c = this.symbolCenter(f);
        const r = rule.radiusPx * this.scaleOf(f) * RESIZE_DIAGONAL;
        return this.view.toLonLat([c[0] + r, c[1] + r]);
    }

    /** The handles a selected graphic offers, for the actions the host allows. */
    private handlesOf(f: SymbolFeature<K, P>): Omit<HandleMark, 'hot'>[] {
        const out: Omit<HandleMark, 'hot'>[] = [];
        const points = drawnPoints(f);
        const kind = this.kindOf(this.propsOf(f).name);
        if (kind === 'point') {
            const tip = this.may('rotate', f) ? this.rotateHandle(f) : null;
            if (tip) out.push({lonLat: tip, kind: 'rotate', index: 0, rotation: bearing(this.drawnLocation(f), tip)});
            const corner = this.may('resize', f) ? this.resizeHandle(f) : null;
            if (corner) out.push({lonLat: corner, kind: 'resize', index: 0});
        }
        if (!this.may('reshape', f)) return out;
        // A point's only vertex is its anchor: shown, since in 3D it marks where the symbol stands. A point
        // drawn away from its location (on a flat map) has it where it is drawn, over the symbol.
        const offset = kind === 'point' && this.family.painter.drawnOffset?.(f, this.resolutionAt(points[0]));
        if (offset) {
            if ((this.view.pointLiftPx?.() ?? 0) === 0) out.push({lonLat: this.view.toLonLat(this.drawnAnchor(f)), kind: 'vertex', index: 0, anchor: true, centered: true});
            else {
                // On leader lines the location is shared with the others drawn there (its dot is theirs), and the
                // ground under the symbol is far off: the handle stands on the location, moved up to the symbol.
                const loc = this.view.toPixel(points[0]);
                const c = this.symbolCenter(f);
                out.push({lonLat: [points[0][0], points[0][1]], kind: 'vertex', index: 0, anchor: true, centered: true, offsetPx: [c[0] - loc[0], c[1] - loc[1]]});
            }
            return out;
        }
        points.forEach((c, index) => out.push({lonLat: [c[0], c[1]], kind: 'vertex', index, ...(kind === 'point' ? {anchor: true} : {})}));
        if (kind === 'point') return out;
        for (const [a, b] of edges(points.length, kind === 'area')) out.push({lonLat: this.midpoint(points[a], points[b]), kind: 'insert', index: b === 0 ? points.length : b});
        return out;
    }

    /** The handle under a pixel: rotate and resize first, then vertices, then insert handles. */
    private handleAt(f: SymbolFeature<K, P>, pixel: Pixel): Omit<HandleMark, 'hot'> | null {
        const order: HandleMark['kind'][] = ['rotate', 'resize', 'vertex', 'insert'];
        const handles = this.handlesOf(f);
        const looks = this.family.chrome?.().handles;
        for (const kind of order) {
            const base = kind === 'insert' ? this.insertHandleRadiusPx : this.handleRadiusPx;
            // The last vertex wins a tie, as it is drawn on top.
            const list = handles.filter((h) => h.kind === kind).reverse();
            // A handle drawn larger than the default picks over all of itself.
            const r = (h: Omit<HandleMark, 'hot'>) => Math.max(base, (h.anchor ? (looks?.anchor ?? looks?.vertex) : looks?.[kind])?.radiusPx ?? 0) + 2;
            const at = (h: Omit<HandleMark, 'hot'>): Pixel => {
                const p = this.view.toPixel(h.lonLat);
                return h.offsetPx ? [p[0] + h.offsetPx[0], p[1] + h.offsetPx[1]] : p;
            };
            const h = list.find((h) => near(at(h), pixel, r(h)));
            if (h) return h;
        }
        return null;
    }

    private reject(reason: string): void {
        for (const l of [...this.listeners]) l({type: 'rejected', reason});
    }

    private commit(): void {
        for (const l of [...this.listeners]) l({type: 'commit'});
    }

    private resetDraw(): void {
        this.modeValue = 'idle';
        this.drawName = null;
        this.drawProps = {} as Omit<P, 'name'>;
        this.drawPoints = [];
        this.rubber = null;
    }

    private distinctPoints(points: [number, number][]): [number, number][] {
        const out: [number, number][] = [];
        for (const p of points) {
            const last = out[out.length - 1];
            if (!last || !near(this.view.toPixel(last), this.view.toPixel(p), SAME_POINT_PX)) out.push(p);
        }
        return out;
    }

    private midpoint(a: Position, b: Position): [number, number] {
        const ma = toMercator(a);
        const mb = toMercatorNear(b, ma);
        return fromMercator([(ma[0] + mb[0]) / 2, (ma[1] + mb[1]) / 2]);
    }

    /**
     * The topmost graphic under a pixel: within the hit tolerance of its painted outline, or
     * anywhere inside an area the family picks inside (a filled one). Any other area is picked by
     * its outline only, so a large one does not swallow every click meant to pan the map.
     */
    private graphicAt(pixel: Pixel): string | null {
        const tolerance = this.options.hitTolerancePx ?? HIT_TOLERANCE_PX;
        const list = this.collection.list();
        const lifted = (this.view.pointLiftPx?.() ?? 0) > 0;
        // On leader lines, a location's dot picks the symbol standing on it before any picture drawn over the
        // dot (a group's lower units hang below its location, over its dot): a picture hit is kept while the
        // rest are looked through for a dot, in the same pass.
        let pictureHit: string | null = null;
        const hit = (id: string): string | null => {
            if (!lifted) return id;
            pictureHit ??= id;
            return null;
        };
        for (let k = list.length - 1; k >= 0; k--) {
            const f = list[k];
            const props = this.propsOf(f);
            const kind = this.kindOf(props.name);
            if (kind === 'point') {
                const a = this.view.toPixel(drawnPoints(f)[0]);
                // A symbol drawn away from its location shares that location's dot with others (a unit in a
                // group): the dot is not its to pick.
                const away = lifted && this.family.painter.drawnOffset?.(f, this.resolutionAt(drawnPoints(f)[0]));
                if (lifted && !away && near(a, pixel, this.handleRadiusPx + 2)) return f.id as string;
                if (pictureHit) continue;
                // On a leader line the symbol is drawn up the screen: picked there, or by the dot on its location.
                const c = this.symbolCenter(f);
                // The whole drawn symbol (a headquarters' frame stands a staff's length above its
                // anchor, out of reach of a circle round the anchor), lifted or not.
                const box = this.pickBoxOf(f, c);
                if (box) {
                    if (pixel[0] >= box[0] - 2 && pixel[0] <= box[2] + 2 && pixel[1] >= box[1] - 2 && pixel[1] <= box[3] + 2 && hit(f.id as string)) return f.id as string;
                } else if (near(c, pixel, POINT_HIT_PX * this.scaleOf(f)) && hit(f.id as string)) return f.id as string;
                if (pictureHit) continue;
                const rule = this.directionOf(props.name);
                const tip = rule && rule.get(props) !== undefined ? this.rotateHandle(f) : null;
                if (tip && distanceToSegment(pixel, this.view.toPixel(this.drawnLocation(f)), this.view.toPixel(tip)) <= tolerance && hit(f.id as string)) return f.id as string;
                continue;
            }
            if (pictureHit) continue;
            // A line or area under the pointer: on leader lines, kept like a picture, so a dot further down wins.
            const path = this.family.painter.outline(f).map((m) => this.view.toPixel(fromMercator(m)));
            let on = false;
            for (let i = 0; i < path.length - 1 && !on; i++) on = distanceToSegment(pixel, path[i], path[i + 1]) <= tolerance;
            if (!on) on = kind === 'area' && !!this.family.pickInside?.(props) && pointInRing(pixel, path);
            if (on && hit(f.id as string)) return f.id as string;
        }
        return pictureHit;
    }

    private changed(): void {
        for (const l of [...this.listeners]) l({type: 'change'});
    }
}
