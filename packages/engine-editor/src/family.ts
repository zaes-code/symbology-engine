/**
 * # What the editor asks a family
 *
 * The editor's gestures are the same for every family; what differs is a handful of facts about
 * each graphic, and they come from here. The store's {@link CollectionSchema} says which geometry
 * each name has (and so how many points it needs); the {@link SymbolPainter} draws the draft and
 * gives the outline a click is tested against. The rest is optional:
 *
 * - {@link EditorFamily.direction}: a point graphic that has a direction (a wind barb). It
 *   takes two clicks — the anchor, then the direction — and has a rotate handle once selected.
 * - {@link EditorFamily.rotation}: a point graphic the operator may turn after placing it with one
 *   click: a rotate handle, and nothing else changes.
 * - {@link EditorFamily.size}: a point graphic the operator may resize with a corner handle.
 * - {@link EditorFamily.pickInside}: whether an area is picked anywhere inside it, not only on its
 *   outline. Off by default, so a large unfilled area never swallows the clicks meant to pan the map.
 * - {@link EditorFamily.chrome}: the colors of handles, guide and selection, read at each paint.
 */

import type {CollectionSchema, HandleShape, ProjectedPosition, SymbolFeature, SymbolPainter} from '@zaes/symbology-engine';

/** A point graphic's direction: where it is kept, and where its rotate handle goes. */
export interface DirectionRule<P> {
    /** The direction in degrees clockwise from north, or `undefined` when the graphic has none yet. */
    get(props: P): number | undefined;
    /** The properties that set it. */
    set(degrees: number): Partial<Omit<P, 'name'>>;
    /**
     * The rotate handle, in projected meters, for an anchor, a direction and a resolution; `props`
     * for anything else that moves it (a graphic drawn at a larger size).
     */
    tip(anchor: ProjectedPosition, degrees: number, resolution: number, props: P): ProjectedPosition;
}

/** A point graphic's size, changed with its resize handle. */
export interface SizeRule<P> {
    /**
     * The scale the graphic is drawn at on screen: 1 is the family's own size. `resolution` (projected
     * meters a pixel) for a family whose symbols also shrink as the map zooms out.
     */
    get(props: P, resolution?: number): number;
    /** The properties for the on-screen scale the operator dragged to; the family may round it to the sizes it offers. */
    set(scale: number, resolution?: number): Partial<Omit<P, 'name'>>;
    /** How far from the symbol's center its handle sits at scale 1, in CSS pixels: about half the symbol. */
    radiusPx: number;
}

/**
 * The editor's own marks: handles, the construction guide and the selection highlight. The first
 * three are required; every other field falls back to one of them.
 */
export interface EditorChrome {
    /** Vertex, rotate and resize handles, and the guide. */
    handleColor: string;
    selectionColor: string;
    /** The family's line width in CSS pixels; the selection highlight is drawn wider than it. */
    lineWidth: number;
    /** The ring round a solid handle, and the fill of an insert ("+") handle. Default white. */
    handleOutlineColor?: string;
    /** The ring of an insert handle. Default `handleColor`. */
    insertHandleColor?: string;
    /** The rotate handle. Default `handleColor`. */
    rotateHandleColor?: string;
    /** The resize handle. Default `handleColor`. */
    resizeHandleColor?: string;
    /** The construction line through the drawn points. Default `handleColor`. */
    guideColor?: string;
    /** The construction line's dash, in CSS pixels. Default `[4, 4]`; `[]` draws it solid. */
    guideDashPx?: number[];
    /** The selection highlight's width in CSS pixels. Default `lineWidth + 10`. */
    selectionWidthPx?: number;
    /**
     * Each kind of handle's own look, over the colors above: `anchor` is a point graphic's one vertex
     * (it takes `vertex`'s look when not given), `vertex` a line's or area's points, `insert` the
     * hollow handle between them, `rotate` and `resize` a point's direction and size handles.
     */
    handles?: Partial<Record<HandleRole, HandleLook>>;
}

/** Which handle a look is for: `anchor` is a point graphic's one vertex. */
export type HandleRole = 'anchor' | 'vertex' | 'insert' | 'rotate' | 'resize';

/** How one kind of handle looks. Every field falls back to the chrome's colors and the editor's sizes. */
export interface HandleLook {
    /** `circle` (default), `square`, `diamond`, or `arrow` (pointing along a rotate handle's direction). */
    shape?: HandleShape;
    fill?: string;
    /** The outline. */
    stroke?: string;
    strokeWidthPx?: number;
    /** Half its width, in CSS pixels; it grows by 2 under the pointer. The area that picks it grows with it. */
    radiusPx?: number;
    /** A + through its center, as a scope's reticle: `true` in the outline's color, or a color. */
    cross?: boolean | string;
}

export const DEFAULT_EDITOR_CHROME: EditorChrome = {handleColor: 'rgb(255, 140, 0)', selectionColor: 'rgba(0, 153, 255, 0.55)', lineWidth: 2};

export interface EditorFamily<K extends string, P extends {name: string}> {
    readonly schema: CollectionSchema<K, P>;
    readonly painter: SymbolPainter<SymbolFeature<K, P>>;
    /**
     * The direction rule for a point graphic whose direction is part of drawing it (a wind barb):
     * two clicks, the anchor then the direction. `undefined` for every other name.
     */
    direction?(name: P['name']): DirectionRule<P> | undefined;
    /**
     * The rotation rule for a point graphic the operator may turn once placed: one click to place
     * it, then a rotate handle. Ignored for a name that has a {@link direction}.
     */
    rotation?(name: P['name']): DirectionRule<P> | undefined;
    /** The size rule for a point graphic the operator may resize with a handle. */
    size?(name: P['name']): SizeRule<P> | undefined;
    /** Whether a click anywhere inside this area picks it. */
    pickInside?(props: P): boolean;
    chrome?(): EditorChrome;
}
