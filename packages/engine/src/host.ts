/**
 * # The map host: the seam the add-ons attach to
 *
 * Every renderer — OpenLayers and MapLibre here, Cesium in a family's add-on — implements
 * {@link MapHost}: where a lon/lat is on screen, what the pointer and the keyboard do, a cursor,
 * and an overlay of marks drawn with the graphics. That is all an add-on needs. An editor
 * (`@zaes/symbology-editor`) attaches to a host and never to a renderer, so it edits on any engine,
 * and the engine carries no editing logic of its own: the host only reports events and draws
 * what it is handed.
 *
 * Nothing here is an editing rule. A host never decides what a click means; a handler does.
 */

import type {Position} from 'geojson';
import type {Paint} from './paint.js';

export type Pixel = [number, number];

/** Where things are on the current view. */
export interface ViewAdapter {
    /** EPSG:4326 to a CSS-pixel position in the map viewport. */
    toPixel(lonLat: Position): Pixel;
    /** A CSS-pixel position in the viewport to EPSG:4326. */
    toLonLat(pixel: Pixel): [number, number];
    /**
     * How far up the screen point symbols are drawn from their location, in CSS pixels: a host
     * that stands them on leader lines (a 3D map). An editor picks a point symbol there. Absent or
     * 0: on the location.
     */
    pointLiftPx?(): number;
}

export interface PointerInput {
    pixel: Pixel;
    altKey?: boolean;
}

export interface KeyInput {
    key: string;
    shiftKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
}

/**
 * What a host reports. Each returns `true` when it consumed the event: the host then stops the
 * map's own reaction (a drag pan, a double-click zoom, a browser shortcut).
 */
export interface MapHostHandlers {
    pointerDown?(e: PointerInput): boolean;
    pointerMove?(e: PointerInput): boolean;
    pointerUp?(e: PointerInput): boolean;
    doubleClick?(e: PointerInput): boolean;
    keyDown?(e: KeyInput): boolean;
    /**
     * Whether keys should reach `keyDown` while the pointer is off the map (something is being
     * drawn or is selected). By default a host passes keys only while the map is hovered.
     */
    wantsKeys?(): boolean;
    /**
     * Whether a double-click belongs to the handler right now, so the map must not zoom on it. A
     * host asks *before* the gesture is complete — OpenLayers raises its own double-click ahead of
     * the browser's, for any two quick clicks however far apart — so it cannot wait to learn
     * whether `doubleClick` consumed it.
     */
    capturesDoubleClick?(): boolean;
}

/** A handle's outline: a dot, a square, a diamond, or an arrowhead pointing along `rotation`. */
export type HandleShape = 'circle' | 'square' | 'diamond' | 'arrow';

/** A mark drawn on top of everything, in screen pixels: an edit handle. */
export interface OverlayHandle {
    lonLat: [number, number];
    /** Half the handle's width: a circle's radius, the distance from the center to a square's side. */
    radiusPx: number;
    fill: string;
    stroke: string;
    /** Default `circle`. */
    shape?: HandleShape;
    /** Degrees clockwise from north, turning with the map: where an arrow points. Default 0. */
    rotation?: number;
    /** A + through the center in this color, as a scope's reticle marks the exact point. */
    cross?: string;
    /** The outline's width. Default 2. */
    strokeWidthPx?: number;
    /**
     * Drawn this far from its place on the ground, in CSS pixels on the screen (y down): over a symbol drawn
     * up its leader line. A renderer draws such a handle as an image, upright, its offset not turned by the map.
     */
    offsetPx?: [number, number];
}

/** Marks a host draws with its graphics: `under` them (a highlight), `over` them, and handles on top. */
export interface HostOverlay {
    under: Paint[];
    over: Paint[];
    handles: OverlayHandle[];
}

/** What every renderer offers an add-on. */
export interface MapHost {
    readonly view: ViewAdapter;
    /** Projected meters per CSS pixel on the current view, for painting an overlay. */
    resolution(): number;
    /** Listen for pointer and key events. Returns the function that stops listening. */
    listen(handlers: MapHostHandlers): () => void;
    setCursor(cursor: string): void;
    /** Replace the overlay, or clear it with `null`. */
    setOverlay(overlay: HostOverlay | null): void;
    /** Called when the view's resolution changes, so an overlay painted for it can be repainted. */
    onViewChange(listener: () => void): () => void;
}

/** True while the focus is in a text field, where keys belong to the field and never to the map. */
export function isTypingTarget(target: EventTarget | null): boolean {
    const el = target as {isContentEditable?: boolean; tagName?: string} | null;
    return !!el && (el.isContentEditable === true || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName ?? ''));
}
