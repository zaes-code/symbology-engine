/**
 * # Paint lists — what a graphic looks like, as data
 *
 * A paint function turns a graphic into marks: lines, filled shapes and text, in EPSG:3857
 * meters, sized for one resolution. Renderers translate marks into their own styles and nothing
 * else; every decision about a symbol's appearance is made before a renderer sees it, so two
 * renderers cannot disagree about a symbol.
 */

import type {ProjectedPosition} from './mercator.js';

/** How a line's open ends are drawn, as SVG's `stroke-linecap`. */
export type LineCap = 'butt' | 'round' | 'square';
/** How a line turns a corner, as SVG's `stroke-linejoin`; a miter longer than 4 widths is beveled, as SVG's default limit. */
export type LineJoin = 'miter' | 'round' | 'bevel';
/** SVG's default miter limit, which every renderer draws a miter join with. */
export const MITER_LIMIT = 4;

export interface PaintStroke {
    color: string;
    widthPx: number;
    /**
     * A dash pattern, in CSS pixels. A dash is a stroke property and never cut into the geometry
     * in meters, where it would grow without limit on zoom-in.
     */
    dashPx?: readonly number[];
    /** Absent: `'round'` (`'butt'` for a dashed line on OpenLayers, whose round dashes run together). */
    cap?: LineCap;
    /** Absent: `'round'`. */
    join?: LineJoin;
}

export interface PaintFill {
    color: string;
    /** 0-1; absent means opaque. */
    opacity?: number;
}

export interface PaintText {
    text: string;
    color: string;
    sizePx: number;
    haloColor: string;
    /** Radians, counter-clockwise from east in projected space, already turned upright. */
    rotation: number;
    /** Draw the text in a box with this border color, on the halo color (a boxed DTG). */
    boxColor?: string;
    /** A CSS font-family list. Absent: `sans-serif`. */
    fontFamily?: string;
    /** The font weight, 100-900. Absent: 600. */
    fontWeight?: number;
    /**
     * A line along the letters' edges, over them, centered on the edge (SVG's stroke on text): an
     * outlined letter. The halo, if any, still lies under the letters.
     */
    outline?: {color: string; widthPx: number};
    /** `'italic'` for slanted text. Absent: upright. */
    fontStyle?: 'italic';
    /** The halo's stroke width in CSS pixels. Absent: 3. 0 draws no halo. */
    haloPx?: number;
    /**
     * Text that starts or ends at `alignAt` (projected meters, on its baseline's middle line), as SVG's
     * `text-anchor`: a renderer that measures the letters places them from there. The geometry stays the
     * text's estimated center, for one that does not.
     */
    align?: 'start' | 'end';
    alignAt?: readonly [number, number];
    /**
     * The text is part of the symbol (a pressure center's H, a glyph's fixed letters), not a label
     * on it: a family's label settings — color, hiding labels — leave it as the symbol draws it.
     */
    symbol?: boolean;
}

export type PaintGeometry =
    | {type: 'LineString'; coordinates: ProjectedPosition[]}
    | {type: 'Polygon'; coordinates: ProjectedPosition[][]}
    | {type: 'Point'; coordinates: ProjectedPosition};

/**
 * One mark. `role` tells line work from decoration and labels by what the paint layer decided,
 * so a test or a renderer never has to guess it from a width or a color a host can change.
 */
export interface Paint {
    role: 'line' | 'decoration' | 'label';
    geometry: PaintGeometry;
    stroke?: PaintStroke;
    fill?: PaintFill;
    text?: PaintText;
}

export interface PaintContext {
    /** Projected meters per CSS pixel. */
    resolution: number;
}

/** How many paint bands a renderer draws: line work, marks on it, and marks on those. */
export const PAINT_BANDS = 3;

/** A fill-only polygon at full opacity: what may share a fill with its neighbors. */
const plainFill = (p: Paint): boolean => p.geometry.type === 'Polygon' && !!p.fill && (p.fill.opacity ?? 1) === 1 && !p.stroke;

/**
 * How many paints from `i` on are plain fills of one color (1 when `i` is not one). A renderer fills such a
 * run as one shape, their union: filled one by one, polygons meeting edge to edge (the pieces of a glyph)
 * are each anti-aliased alone, and the background shows through along the edge they share.
 */
export function fillRun(paints: readonly Paint[], i: number): number {
    const first = paints[i];
    if (!plainFill(first)) return 1;
    let n = 1;
    while (i + n < paints.length && plainFill(paints[i + n]) && paints[i + n].fill!.color === first.fill!.color) n++;
    return n;
}

/**
 * The band each paint draws in, so a renderer that groups marks by kind keeps the painter's order.
 * OpenLayers draws all of a feature's polygons before its lines, and MapLibre has one fill layer
 * under one line layer, so a mark painted *on* a line (a no-entry roundel's white bar, a retardant
 * drop's square) went *under* it. A new band starts where a filled mark follows line work; within a
 * band, fills under lines is the painter's order anyway. Bands past the last fold into it.
 */
export function paintBands(paints: readonly Paint[]): number[] {
    let band = 0;
    let line = false;
    return paints.map((p) => {
        const filled = p.geometry.type === 'Polygon' && !!p.fill;
        if (filled && line) {
            band = Math.min(band + 1, PAINT_BANDS - 1);
            line = false;
        }
        if (p.geometry.type === 'LineString' || (p.geometry.type === 'Polygon' && p.stroke)) line = true;
        return band;
    });
}
