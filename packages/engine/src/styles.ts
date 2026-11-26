/**
 * # Lines and areas drawn from data
 *
 * Most of a family's lines and areas need no painter of their own: a {@link LineStyleDef} (color,
 * width, dash, a casing, decorations along it) or an {@link AreaStyleDef} (fill, outline, pattern,
 * dots, glyphs along the outline, a center glyph or text) says how one looks, and these draw it.
 * Everything stays screen-sized and computed per paint.
 *
 * The engine knows no color names and no standard. A family hands in a {@link StyleContext}: the
 * path to draw along, its main color, its palette (as for glyphs), its line width and label style.
 * What a standard decides per graphic — an operator's fill, an operator's dash, a value written in
 * the middle — arrives as {@link AreaStyleOptions}, already decided.
 */

import {boundsOf, displacedPath, estimateTextHeight, estimateTextWidth, evenSlots, labelAnchorInRing, offset, outwardSide, pointInRing, type PathWalker} from './decorations.js';
import {GLYPH_PX, glyphStamp, paintGlyph, resolveGlyphColor, type GlyphColor, type GlyphColors, type GlyphDef} from './glyph.js';
import type {ProjectedPosition as P} from './mercator.js';
import type {Paint} from './paint.js';

/** A mark repeated along, or placed on, a line. */
export type LineDecoration<C extends string = string> =
    /**
     * A glyph repeated along the line, turned to follow it. `upright`: where the line runs leftward
     * on screen, turned a half turn more, so a letter or a mark drawn "as shown" never reads upside
     * down and stays on the same side of the line on the page.
     */
    | {kind: 'glyph'; glyph: GlyphDef<C>; spacingPx: number; at?: 'repeat' | 'middle' | 'end' | 'both-ends'; upright?: boolean; /** At an end, set this far in from it. */ insetPx?: number}
    /** An arrowhead at the last point: open (two strokes) or solid. `feathers` draws that many barbs at the tail (current flow). */
    | {kind: 'arrow'; solid?: boolean; feathers?: number; sizePx?: number}
    /** The line itself drawn as a zigzag. */
    | {kind: 'zigzag'; amplitudePx: number; wavelengthPx: number; /** Swing to both sides of the line, half the amplitude each way, not to one side. */ centered?: boolean}
    /** The line itself drawn as a smooth wave (a submarine cable). */
    | {kind: 'wave'; amplitudePx: number; wavelengthPx: number}
    /** Short strokes across or to one side of the line. */
    | {kind: 'ticks'; side: 1 | -1 | 0; lengthPx: number; spacingPx: number}
    /** The line drawn solid for its first part and dashed for the rest (a leading line). */
    | {kind: 'solidThenDashed'; split?: number};

/** A plain line: color, width, dash, a casing for a double line, and decorations. */
export interface LineStyleDef<C extends string = string> {
    color: GlyphColor<C>;
    widthPx?: number;
    dash?: readonly number[];
    /**
     * Stretch the dash so a whole number of its periods fits the line, starting at the line's start:
     * a glyph decoration spaced one period apart then keeps step with it (a pipeline's dash and circle).
     */
    dashFit?: boolean;
    /** A second, wider stroke underneath: a double line (a canal) when its color is the halo. */
    casing?: {color: GlyphColor<C>; widthPx: number};
    decorations?: readonly LineDecoration<C>[];
    /** Draw only the decorations: a limit drawn as a chain of marks with no line of its own. */
    hideLine?: boolean;
}

/** A plain area: fill, outline, pattern, dots, outline glyphs and centered content. */
export interface AreaStyleDef<C extends string = string> {
    fill?: {color: GlyphColor<C>; opacity?: number};
    /** `null` for no outline. Default: a solid line in the main color. */
    outline?: {color: GlyphColor<C>; widthPx?: number; dash?: readonly number[]} | null;
    /**
     * Bands drawn inside the outline, each a stroke following the ring `insetPx` in from it (a depth
     * area's pale inner band). Screen-sized; the same whichever way the area was traced.
     */
    bands?: readonly {color: GlyphColor<C>; widthPx: number; insetPx: number}[];
    pattern?: {glyph: GlyphDef<C>; spacingPx: number};
    /** A dot grid; staggered every other row unless `aligned`. */
    dots?: {color: GlyphColor<C>; spacingPx: number; radiusPx: number; aligned?: boolean};
    /**
     * Parallel lines across the area, clipped to it: one set for a hatch, two crossed for a
     * cross-hatch, two of different colors offset for stripes. Screen-sized, like everything.
     */
    hatch?: readonly AreaHatch<C>[];
    /** Text written in the middle (a category letter), fitted to the ring like any centered label. */
    centerText?: string;
    /**
     * Glyphs placed along the outline (anchors along an anchorage area), turned to follow it with the
     * glyph's top toward the outside whichever way the area was traced.
     */
    outlineGlyph?: {glyph: GlyphDef<C>; spacingPx: number};
    /** A glyph at the middle of the area (the anchor of an anchorage, the "!" of a training area). */
    centerGlyph?: GlyphDef<C>;
}

/** One set of parallel lines across an area. */
export interface AreaHatch<C extends string = string> {
    color: GlyphColor<C>;
    /** Degrees counter-clockwise from the screen's horizontal. */
    angle: number;
    /** Between neighbouring lines, in CSS pixels. */
    spacingPx: number;
    /** Line width in CSS pixels (default 1). */
    widthPx?: number;
    /** Shift across the lines, in CSS pixels: two sets of one spacing, one offset by half, make stripes. */
    offsetPx?: number;
}

/** What a style is drawn with: the path, and the family's choices for this graphic. */
export interface StyleContext {
    /** The painted path: a line, or an area's closed ring. */
    walker: PathWalker;
    /** Projected meters per CSS pixel. */
    resolution: number;
    /** The graphic's main color, as CSS: what `'main'` means. */
    main: string;
    /** The family's palette, for every other color name. */
    colors: GlyphColors;
    /** The family's line width, in CSS pixels, where a style states none. */
    lineWidth: number;
    /** The family's label style, for an area's centered text. */
    label: {size: number; halo: string};
}

/** What a family decided about one area, beyond its style. */
export interface AreaStyleOptions {
    /** The operator asked for the area color-filled, with no outline: filled in the main color at this opacity. */
    filled?: {opacity: number};
    /** A dash for the outline in place of the style's (an operator-dashed area). */
    dash?: readonly number[];
    /** Text for the middle, when the style states none (a graphic's value). */
    text?: string;
}

/**
 * A closed ring moved `d` meters to the left of travel (right when negative), each corner mitred
 * (a miter at most four times `d` long, so a spike stays bounded).
 */
function offsetRing(ring: readonly P[], d: number): P[] {
    const pts = ring.slice(0, ring.length - 1);
    const n = pts.length;
    if (n < 3) return [...ring];
    const normal = (a: P, b: P): P => {
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        return [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
    };
    const out: P[] = [];
    for (let i = 0; i < n; i++) {
        const n1 = normal(pts[(i - 1 + n) % n], pts[i]);
        const n2 = normal(pts[i], pts[(i + 1) % n]);
        const k = Math.min(4, 1 / Math.max(0.0625, (1 + n1[0] * n2[0] + n1[1] * n2[1]) / 2));
        const mx = ((n1[0] + n2[0]) / 2) * k;
        const my = ((n1[1] + n2[1]) / 2) * k;
        out.push([pts[i][0] + mx * d, pts[i][1] + my * d]);
    }
    out.push(out[0]);
    return out;
}

/** A color name as CSS, with the main color for `'main'`. */
const css = (c: GlyphColor | undefined, ctx: StyleContext) => resolveGlyphColor(c, ctx.main, ctx.colors);

/** A plain line, with its decorations. */
export function paintLineStyle<C extends string>(style: LineStyleDef<C>, ctx: StyleContext): Paint[] {
    const {walker: w, resolution: res, main} = ctx;
    const color = css(style.color, ctx) ?? main;
    const widthPx = style.widthPx ?? ctx.lineWidth;
    const zig = style.decorations?.find((d) => d.kind === 'zigzag') as Extract<LineDecoration, {kind: 'zigzag'}> | undefined;
    const wave = style.decorations?.find((d) => d.kind === 'wave') as Extract<LineDecoration, {kind: 'wave'}> | undefined;
    const split = style.decorations?.find((d) => d.kind === 'solidThenDashed') as Extract<LineDecoration, {kind: 'solidThenDashed'}> | undefined;
    const paints: Paint[] = [];
    let dash = style.dash;
    if (dash && style.dashFit) {
        const period = dash.reduce((a, b) => a + b, 0);
        const slots = evenSlots(w.length, period * res);
        if (slots.count > 0) dash = dash.map((v) => (v * slots.spacing) / (period * res));
    }

    let path = w.slice(0, w.length);
    if (zig) {
        // A zigzag along the line, its teeth screen-sized.
        const half = (zig.wavelengthPx / 2) * res;
        const slots = evenSlots(w.length, half);
        path = [];
        for (let i = 0; i <= slots.count; i++) {
            const {point, dir} = w.at(i * slots.spacing);
            const swing = zig.centered ? (i % 2 ? 0.5 : -0.5) : i % 2 ? 1 : 0;
            path.push(offset(point, dir, 0, swing * zig.amplitudePx * res));
        }
    }
    if (wave) {
        const lambda = wave.wavelengthPx * res;
        const amp = wave.amplitudePx * res;
        path = displacedPath(w, 0, w.length, lambda / 12, (s) => amp * Math.sin((2 * Math.PI * s) / lambda));
    }
    const stroke = (coords: P[], dash?: readonly number[]): Paint => ({
        role: 'line',
        geometry: {type: 'LineString', coordinates: coords},
        stroke: {color, widthPx, ...(dash ? {dashPx: dash} : {})},
    });
    // Marks drawn on a double line (a frozen lead's ticks) take the casing's color: the line
    // itself is the halo between the two strokes, and a tick in that color vanishes.
    const caseColor = style.casing ? (css(style.casing.color, ctx) ?? main) : undefined;
    const markColor = caseColor ?? color;
    if (style.casing && caseColor) {
        paints.push({role: 'decoration', geometry: {type: 'LineString', coordinates: path}, stroke: {color: caseColor, widthPx: style.casing.widthPx}});
    }
    if (style.hideLine) {
        // A chain of marks with no line of its own.
    } else if (split) {
        const at = w.length * (split.split ?? 0.5);
        paints.push(stroke(w.slice(0, at)), stroke(w.slice(at, w.length), dash ?? [8, 6]));
    } else {
        paints.push(stroke(path, dash));
    }

    for (const deco of style.decorations ?? []) {
        if (deco.kind === 'glyph') paints.push(...glyphsAlong(deco.glyph, deco.spacingPx, deco.at ?? 'repeat', ctx, deco.upright, deco.insetPx));
        else if (deco.kind === 'ticks') {
            const slots = evenSlots(w.length, deco.spacingPx * res);
            for (let i = 0; i < slots.count; i++) {
                const {point, dir} = w.at((i + 0.5) * slots.spacing);
                const len = deco.lengthPx * res;
                const a = deco.side === 0 ? offset(point, dir, 0, -len / 2) : point;
                const b = offset(point, dir, 0, deco.side === 0 ? len / 2 : deco.side * len);
                paints.push({role: 'decoration', geometry: {type: 'LineString', coordinates: [a, b]}, stroke: {color: markColor, widthPx: Math.min(widthPx, 2)}});
            }
        } else if (deco.kind === 'arrow') {
            const size = (deco.sizePx ?? 10) * res;
            const {point, dir} = w.at(w.length);
            const left = offset(point, dir, -size, size * 0.55);
            const right = offset(point, dir, -size, -size * 0.55);
            if (deco.solid) paints.push({role: 'decoration', geometry: {type: 'Polygon', coordinates: [[left, point, right, left]]}, fill: {color}, stroke: {color, widthPx: 1}});
            else paints.push({role: 'decoration', geometry: {type: 'LineString', coordinates: [left, point, right]}, stroke: {color, widthPx}});
            // Feathers at the tail: one per stroke, slanted back, as a flood current draws them.
            for (let i = 0; i < (deco.feathers ?? 0); i++) {
                const t = w.at(Math.min(w.length, (4 + i * 5) * res));
                paints.push({
                    role: 'decoration',
                    geometry: {type: 'LineString', coordinates: [t.point, offset(t.point, t.dir, -size * 0.6, size * 0.6)]},
                    stroke: {color, widthPx},
                });
            }
        }
    }
    return paints;
}

/**
 * Glyphs along a path: repeated, at the middle, or at the ends, each turned to follow it, and a half
 * turn more where the path runs leftward when `upright`.
 */
export function glyphsAlong<C extends string>(glyph: GlyphDef<C>, spacingPx: number, at: 'repeat' | 'middle' | 'end' | 'both-ends', ctx: StyleContext, upright = false, insetPx = 0): Paint[] {
    const {walker: w, resolution: res} = ctx;
    const positions: number[] = [];
    const inset = Math.min(insetPx * res, w.length / 2);
    if (at === 'middle') positions.push(w.length / 2);
    else if (at === 'end') positions.push(w.length - inset);
    else if (at === 'both-ends') positions.push(inset, w.length - inset);
    else {
        const slots = evenSlots(w.length, spacingPx * res);
        for (let i = 0; i < slots.count; i++) positions.push((i + 0.5) * slots.spacing);
    }
    const out: Paint[] = [];
    for (const d of positions) {
        const {point, dir} = w.at(d);
        let rotation = Math.atan2(dir[1], dir[0]);
        if (upright && dir[0] < 0) rotation += Math.PI;
        out.push(...paintGlyph(glyph, {at: point, resolution: res, main: ctx.main, rotation, colors: ctx.colors}));
    }
    return out;
}

/** The most hatch lines one set may draw before its spacing is widened to keep a paint cheap. */
const MAX_HATCH_LINES = 300;

/**
 * Parallel lines at `angle` (radians), `spacing` apart and shifted by `shift`, clipped to a ring
 * even-odd: each line is cut where it crosses the ring's edges, and the runs inside are kept.
 */
function hatchLines(ring: readonly P[], angle: number, spacing: number, shift: number): P[][] {
    if (!(spacing > 0) || ring.length < 4) return [];
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    // Across the lines: the normal. A line is every point p with p · n = c.
    const nx = -uy;
    const ny = ux;
    const across = ring.map((p) => p[0] * nx + p[1] * ny);
    const lo = Math.min(...across);
    const hi = Math.max(...across);
    let s = spacing;
    while ((hi - lo) / s > MAX_HATCH_LINES) s *= 1.5;
    const out: P[][] = [];
    for (let c = Math.ceil((lo - shift) / s) * s + shift; c <= hi; c += s) {
        // Where the line crosses each edge, as a distance along the line.
        const ts: number[] = [];
        for (let i = 0; i < ring.length - 1; i++) {
            const a = across[i] - c;
            const b = across[i + 1] - c;
            if ((a < 0 && b >= 0) || (a >= 0 && b < 0)) {
                const f = a / (a - b);
                const x = ring[i][0] + f * (ring[i + 1][0] - ring[i][0]);
                const y = ring[i][1] + f * (ring[i + 1][1] - ring[i][1]);
                ts.push(x * ux + y * uy);
            }
        }
        ts.sort((a, b) => a - b);
        for (let i = 0; i + 1 < ts.length; i += 2) {
            const at = (t: number): P => [ux * t + nx * c, uy * t + ny * c];
            out.push([at(ts[i]), at(ts[i + 1])]);
        }
    }
    return out;
}

/** The most pattern marks one area may carry before its spacing is widened to keep a paint cheap. */
const MAX_PATTERN_MARKS = 400;

/**
 * Where the horizontal line at `y` crosses the ring, ascending: the crossings {@link pointInRing}
 * counts for a point at that height, computed as it computes them.
 */
function crossingsAt(ring: readonly P[], y: number): number[] {
    const xs: number[] = [];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if (yi > y !== yj > y) xs.push(((xj - xi) * (y - yi)) / (yj - yi) + xi);
    }
    return xs.sort((a, b) => a - b);
}

/** `pointInRing([x, y], ring)` from the ring's crossings at `y`: inside when an odd number lie right of `x`. */
function insideAt(xs: readonly number[], x: number): boolean {
    let lo = 0;
    let hi = xs.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (xs[mid] > x) hi = mid;
        else lo = mid + 1;
    }
    return (xs.length - lo) % 2 === 1;
}

/** {@link insideAt} for any height, each height's crossings worked out once. */
function scanlines(ring: readonly P[]): (x: number, y: number) => boolean {
    const rows = new Map<number, number[]>();
    return (x, y) => {
        let xs = rows.get(y);
        if (!xs) rows.set(y, (xs = crossingsAt(ring, y)));
        return insideAt(xs, x);
    };
}

/**
 * Grid points inside a ring, `spacing` apart, offset every other row unless `aligned`. Each row
 * finds where it crosses the ring once, rather than testing every point against every edge.
 */
function gridInside(ring: readonly P[], spacing: number, aligned = false): P[] {
    const [x0, y0, x1, y1] = boundsOf(ring as P[]);
    let s = spacing;
    while (((x1 - x0) / s) * ((y1 - y0) / s) > MAX_PATTERN_MARKS * 2) s *= 1.5;
    const out: P[] = [];
    let row = 0;
    for (let y = y0 + s / 2; y < y1; y += s, row++) {
        const xs = crossingsAt(ring, y);
        for (let x = x0 + (row % 2 && !aligned ? s : s / 2); x < x1; x += s) {
            if (insideAt(xs, x)) out.push([x, y]);
            if (out.length >= MAX_PATTERN_MARKS) return out;
        }
    }
    return out;
}

/** A plain area: fill, outline, pattern, dots, outline glyphs and centered content. */
export function paintAreaStyle<C extends string>(style: AreaStyleDef<C>, ctx: StyleContext, options: AreaStyleOptions = {}): Paint[] {
    const {walker: w, resolution: res, main} = ctx;
    const ring = w.slice(0, w.length);
    const paints: Paint[] = [];
    const filledByOperator = options.filled !== undefined;
    const place = {resolution: res, main, colors: ctx.colors};

    const fill = style.fill ? css(style.fill.color, ctx) : filledByOperator ? main : undefined;
    if (fill) {
        const opacity = style.fill?.opacity ?? options.filled?.opacity;
        paints.push({role: 'decoration', geometry: {type: 'Polygon', coordinates: [ring]}, fill: {color: fill, ...(opacity !== undefined ? {opacity} : {})}});
    }
    if (style.dots) {
        const c = css(style.dots.color, ctx) ?? main;
        const r = style.dots.radiusPx * res;
        for (const p of gridInside(ring, style.dots.spacingPx * res, style.dots.aligned)) {
            const circle: P[] = [];
            for (let i = 0; i <= 8; i++) circle.push([p[0] + r * Math.cos((i * Math.PI) / 4), p[1] + r * Math.sin((i * Math.PI) / 4)]);
            paints.push({role: 'decoration', geometry: {type: 'Polygon', coordinates: [circle]}, fill: {color: c}});
        }
    }
    if (style.pattern) {
        const glyph = style.pattern.glyph;
        const extent = (glyph.box ?? 24) * GLYPH_PX * (glyph.scale ?? 1) * res * 0.5;
        const d = extent * 0.7;
        const inside = scanlines(ring);
        const stamp = glyphStamp(glyph, place);
        for (const p of gridInside(ring, style.pattern.spacingPx * res)) {
            // Only marks wholly inside, so a pattern never spills over the outline.
            const [x, y] = p;
            if (!(inside(x - d, y - d) && inside(x + d, y - d) && inside(x + d, y + d) && inside(x - d, y + d))) continue;
            for (const m of stamp(p)) paints.push(m);
        }
    }
    for (const h of style.hatch ?? []) {
        const c = css(h.color, ctx) ?? main;
        // One mark per run inside the ring, so every renderer draws them as plain lines.
        for (const seg of hatchLines(ring, (h.angle * Math.PI) / 180, h.spacingPx * res, (h.offsetPx ?? 0) * res)) paints.push({role: 'decoration', geometry: {type: 'LineString', coordinates: seg}, stroke: {color: c, widthPx: h.widthPx ?? 1}});
    }
    const outline = style.outline === undefined ? {color: 'main' as const} : style.outline;
    if (outline && !filledByOperator) {
        const c = css(outline.color, ctx) ?? main;
        const dash = options.dash ?? outline.dash;
        paints.push({role: 'line', geometry: {type: 'LineString', coordinates: ring}, stroke: {color: c, widthPx: outline.widthPx ?? ctx.lineWidth, ...(dash ? {dashPx: dash} : {})}});
    }
    if (style.bands?.length) {
        const inward = -outwardSide(ring);
        for (const b of style.bands) {
            const band = offsetRing(ring, inward * b.insetPx * res);
            paints.push({role: 'decoration', geometry: {type: 'LineString', coordinates: band}, stroke: {color: css(b.color, ctx) ?? main, widthPx: b.widthPx}});
        }
    }
    if (style.outlineGlyph) {
        const slots = evenSlots(w.length, style.outlineGlyph.spacingPx * res);
        // A glyph's top is left of travel; on a ring traced with the outside to the right, a half turn more.
        const turn = outwardSide(ring) === 1 ? 0 : Math.PI;
        for (let i = 0; i < slots.count; i++) {
            const {point, dir} = w.at((i + 0.5) * slots.spacing);
            paints.push(...paintGlyph(style.outlineGlyph.glyph, {at: point, ...place, rotation: Math.atan2(dir[1], dir[0]) + turn}));
        }
    }
    if (style.centerGlyph) {
        const half = (style.centerGlyph.box ?? 24) * GLYPH_PX * (style.centerGlyph.scale ?? 1) * res * 0.5;
        paints.push(...paintGlyph(style.centerGlyph, {at: labelAnchorInRing(ring, half, half).at, ...place}));
    }
    const text = style.centerText ?? options.text;
    if (text) {
        let size = ctx.label.size + 2;
        const fit = labelAnchorInRing(ring, (estimateTextWidth(text, size) / 2 + 2) * res, (estimateTextHeight(text, size) / 2 + 1) * res);
        const at = fit.at;
        size *= fit.scale;
        if (size >= 7) paints.push({role: 'label', geometry: {type: 'Point', coordinates: at}, text: {text, color: main, sizePx: size, haloColor: ctx.label.halo, rotation: 0}});
    }
    return paints;
}
