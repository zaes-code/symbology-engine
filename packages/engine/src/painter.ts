/**
 * # What a renderer asks a family
 *
 * A renderer knows how to draw marks and nothing about any standard. A family tells it two things
 * about each of its graphics: the marks at a resolution, and the outline the operator sees, which
 * a renderer uses for its extent and picking. Every symbology fact stays on the family's side of
 * this interface.
 */

import type {ProjectedPosition} from './mercator.js';
import type {Paint, PaintContext} from './paint.js';

export interface SymbolPainter<F> {
    /** What a graphic looks like at one resolution, in EPSG:3857 meters. */
    paint(feature: F, context: PaintContext): Paint[];
    /** The painted outline in projected meters: a point's anchor, a line, or an area's closed ring. */
    outline(feature: F): ProjectedPosition[];
    /**
     * A point symbol's drawn box in CSS pixels, relative to its anchor (y down), as drawn at this
     * resolution. The editor picks the symbol anywhere in it and outlines it when selected. Without it
     * a point is picked within a small circle round its anchor, which misses a symbol drawn away from
     * its anchor (a headquarters stands on a staff whose foot is the anchor).
     */
    pickBox?(feature: F, resolution: number): {x: number; y: number; width: number; height: number} | null;
    /**
     * How far from its location a point symbol is drawn, in CSS pixels (y down): a unit drawn in its place in
     * a group at one location. The editor measures the drawn box from there, keeps a dragged symbol where it
     * was drawn under the cursor, and puts its handles round it. Default none.
     */
    drawnOffset?(feature: F, resolution: number): {x: number; y: number} | null;
    /**
     * Marks in map units under a point symbol: an area of uncertainty, a trailer, a line to another
     * position. They are drawn as marks however the symbol itself is drawn, so a renderer that draws a
     * point as one image (MapLibre's point images, a symbol standing on a leader line) still lays them
     * on the map at their size, under it. Elsewhere they come first in the graphic's marks.
     */
    underlay?(feature: F, context: PaintContext): Paint[];
}

/** Everything a graphic draws at one resolution: its underlay, then its own marks. */
export function paintAll<F>(painter: SymbolPainter<F>, feature: F, context: PaintContext): Paint[] {
    const under = painter.underlay?.(feature, context);
    const marks = painter.paint(feature, context);
    return under?.length ? [...under, ...marks] : marks;
}
