/**
 * # Point symbol sizes
 *
 * One vocabulary for how large a point symbol is drawn, shared by every family, so a host offers
 * the same choice for every family: **small**, **medium** and **large**, as multiples of the
 * family's own size (its standard's or its source's). Medium is the family's size. A family takes
 * a default from its configuration and lets a graphic override it.
 */

export const POINT_SIZES = Object.freeze({small: 0.75, medium: 1, large: 1.5} as const);
export type PointSize = keyof typeof POINT_SIZES;

export const isPointSize = (s: unknown): s is PointSize => typeof s === 'string' && Object.prototype.hasOwnProperty.call(POINT_SIZES, s);

/** The scale for a graphic's size, or the default's when it states none (or one not known). */
export function pointSizeScale(size: unknown, fallback: PointSize = 'medium'): number {
    return POINT_SIZES[isPointSize(size) ? size : fallback];
}

/** CSS pixels per meter: 96 to the inch. */
const CSS_PX_PER_M = 96 / 0.0254;

/** The map scale's denominator at a resolution in projected meters a CSS pixel: 1:N at 96 pixels an inch. */
export function mapScaleOf(resolution: number): number {
    return resolution * CSS_PX_PER_M;
}

/**
 * How large a point symbol is drawn at a resolution when it shrinks as the map zooms out: full size
 * at map scale `fullSizeScale` (1:N) and anything closer in; past it, the square root of how far
 * out the map is, so half size at four times the scale; never below `min`. Without a
 * `fullSizeScale` a symbol never shrinks.
 */
export function pointZoomFactor(resolution: number, fullSizeScale?: number, min = 0.4): number {
    if (!fullSizeScale || !(fullSizeScale > 0) || !(resolution > 0)) return 1;
    const scale = mapScaleOf(resolution);
    return scale <= fullSizeScale ? 1 : Math.max(min, Math.sqrt(fullSizeScale / scale));
}
