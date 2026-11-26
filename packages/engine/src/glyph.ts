/**
 * # Glyphs
 *
 * A point symbol drawn as the standard draws its icon: paths, circles and text in a small square
 * box, scaled to {@link GLYPH_PX} CSS pixels per unit and placed on the anchor. Paths are SVG path
 * data, so an icon is authored the way an icon is authored anywhere, and flattened here into the
 * same line, polygon and text marks every other graphic paints with — so both renderers, the
 * thumbnails and the GeoJSON output draw it with no glyph support of their own.
 *
 * Pure and planar, like the rest of the paint layer: no DOM, no canvas, projected meters out.
 *
 * The engine knows no color names. A family's glyphs name colors in its own vocabulary (a
 * standard's color roles, or CSS colors), and the family hands {@link GlyphPlacement.colors} in
 * to turn them into CSS.
 */

import {pointInRing} from './decorations.js';
import type {ProjectedPosition as P} from './mercator.js';
import type {LineCap, LineJoin, Paint} from './paint.js';

// ── the glyph format ───────────────────────────────────────────────────────────

/**
 * A color inside a glyph: `'main'` is the graphic's own color, `'halo'` the label halo, `'none'`
 * nothing; anything else is a color in the family's vocabulary `C` (by default any string, which
 * {@link GlyphColors.resolve} turns into CSS).
 */
export type GlyphColor<C extends string = string> = 'main' | C | 'halo' | 'none';

interface GlyphShapeBase<C extends string> {
    fill?: GlyphColor<C>;
    /** Default `'main'` for a path or circle with no fill; `'none'` for no outline. */
    stroke?: GlyphColor<C>;
    /** Stroke width in glyph units (default 1.6). */
    width?: number;
    /** Dash pattern in glyph units. */
    dash?: readonly number[];
    /** How the stroke's open ends are drawn, as SVG's `stroke-linecap`. Absent: `'round'`. */
    cap?: LineCap;
    /** How the stroke turns a corner, as SVG's `stroke-linejoin` (miter limit 4). Absent: `'round'`. */
    join?: LineJoin;
}

/** An SVG path (M L H V C S Q T A Z, absolute or relative), y down, in the glyph's box. */
export interface GlyphPath<C extends string = string> extends GlyphShapeBase<C> {
    d: string;
    /**
     * Fill the subpaths even-odd, as one shape: a subpath inside another is a hole in it, one
     * inside that hole is filled again. Off, each subpath is filled on its own — two nested
     * subpaths both solid — which is what hand-written glyphs rely on.
     */
    evenOdd?: boolean;
}

export interface GlyphCircle<C extends string = string> extends GlyphShapeBase<C> {
    circle: readonly [cx: number, cy: number, r: number];
}

/** Text centered on (x, y). `'$value'` is replaced by the graphic's value, and skipped when it has none. */
export interface GlyphText<C extends string = string> {
    text: string;
    x: number;
    y: number;
    /** Font size in glyph units. */
    size: number;
    color?: GlyphColor<C>;
    /** Slanted, as a chart writes a bottom-character abbreviation. */
    italic?: boolean;
    /** In a serif face, not the label font's sans-serif. */
    serif?: boolean;
    /** The font weight, 100-900 (400 regular, 700 bold). Absent: 600, the labels' weight. */
    weight?: number;
    /**
     * A line along the letters' edges, drawn over them (SVG's stroke on text): `width` in glyph units,
     * centered on the edge, as an outlined letter in an icon is drawn. Not a halo, which lies under them.
     */
    outline?: {color: GlyphColor<C>; width: number};
    /**
     * `false`: no halo. Text drawn inside a symbol (a letter on its icon) needs none, and a halo there
     * cuts into the lines around it. Absent: the label halo, as every text on a map.
     */
    halo?: boolean;
    /**
     * Text that starts or ends at `x` (glyph units), as SVG's `text-anchor` places it: a column of labels
     * aligned on one edge. (x, y) stays its center as estimated, for a renderer that only centers text; one
     * that measures the letters places them from this edge, so every line of the column meets it.
     */
    edge?: {align: 'start' | 'end'; x: number};
}

export type GlyphPart<C extends string = string> = GlyphPath<C> | GlyphCircle<C> | GlyphText<C>;

/**
 * A point symbol, drawn as its icon: parts in a `box`-unit square (default 24), the anchor at the
 * center unless `anchor` moves it. One unit is {@link GLYPH_PX} CSS pixels times `scale`.
 */
export interface GlyphDef<C extends string = string> {
    parts: readonly GlyphPart<C>[];
    box?: number;
    scale?: number;
    /** The anchor inside the box (default its center). */
    anchor?: readonly [number, number];
}

/** How a family's color names become CSS. */
export interface GlyphColors {
    /** A color name to CSS; an exact CSS color should pass through unchanged. */
    resolve(color: string): string;
    /** The label halo, for `'halo'` and behind every text part. */
    halo: string;
}

/** With no palette, color names are taken as CSS and the halo is white. */
export const CSS_GLYPH_COLORS: GlyphColors = {resolve: (c) => c, halo: 'rgba(255, 255, 255, 0.9)'};

/** CSS pixels per glyph unit at scale 1: a 24-unit icon is 30 px across. */
export const GLYPH_PX = 1.25;

// ── SVG path data ──────────────────────────────────────────────────────────────

export interface Subpath {
    points: [number, number][];
    closed: boolean;
}

const CURVE_STEPS = 10;

/** Parse SVG path data into flattened subpaths. Curves and arcs become short straight runs. */
export function parsePath(d: string): Subpath[] {
    const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? [];
    const out: Subpath[] = [];
    let cur: Subpath | null = null;
    let x = 0;
    let y = 0;
    let sx = 0;
    let sy = 0;
    let cmd = '';
    let lastCtrl: [number, number] | null = null;
    let lastQ: [number, number] | null = null;
    let i = 0;
    const num = () => Number(tokens[i++]);
    const isNum = () => i < tokens.length && !/^[a-zA-Z]$/.test(tokens[i]);
    const push = (px: number, py: number) => {
        if (!cur) {
            cur = {points: [[x, y]], closed: false};
            out.push(cur);
        }
        cur.points.push([px, py]);
        x = px;
        y = py;
    };
    const cubic = (x1: number, y1: number, x2: number, y2: number, ex: number, ey: number) => {
        const [x0, y0] = [x, y];
        for (let k = 1; k <= CURVE_STEPS; k++) {
            const t = k / CURVE_STEPS;
            const u = 1 - t;
            push(
                u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * ex,
                u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * ey,
            );
        }
    };
    const quad = (x1: number, y1: number, ex: number, ey: number) => {
        const [x0, y0] = [x, y];
        for (let k = 1; k <= CURVE_STEPS; k++) {
            const t = k / CURVE_STEPS;
            const u = 1 - t;
            push(u * u * x0 + 2 * u * t * x1 + t * t * ex, u * u * y0 + 2 * u * t * y1 + t * t * ey);
        }
    };
    // SVG arc, endpoint form to center form (SVG 1.1, appendix F.6.5).
    const arc = (rx: number, ry: number, phiDeg: number, large: number, sweep: number, ex: number, ey: number) => {
        if (rx === 0 || ry === 0) return push(ex, ey);
        rx = Math.abs(rx);
        ry = Math.abs(ry);
        const phi = (phiDeg * Math.PI) / 180;
        const cos = Math.cos(phi);
        const sin = Math.sin(phi);
        const dx = (x - ex) / 2;
        const dy = (y - ey) / 2;
        const x1p = cos * dx + sin * dy;
        const y1p = -sin * dx + cos * dy;
        const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
        if (lambda > 1) {
            rx *= Math.sqrt(lambda);
            ry *= Math.sqrt(lambda);
        }
        const num2 = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
        const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
        let coef = Math.sqrt(Math.max(0, num2 / den));
        if (large === sweep) coef = -coef;
        const cxp = (coef * rx * y1p) / ry;
        const cyp = (-coef * ry * x1p) / rx;
        const cx = cos * cxp - sin * cyp + (x + ex) / 2;
        const cy = sin * cxp + cos * cyp + (y + ey) / 2;
        const angle = (ux: number, uy: number, vx: number, vy: number) => {
            const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
            return a;
        };
        const t1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
        let dt = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
        if (!sweep && dt > 0) dt -= 2 * Math.PI;
        if (sweep && dt < 0) dt += 2 * Math.PI;
        const steps = Math.max(4, Math.ceil((Math.abs(dt) / (Math.PI / 2)) * 6));
        for (let k = 1; k <= steps; k++) {
            const t = t1 + (dt * k) / steps;
            const px = cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin;
            const py = cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos;
            if (k === steps) push(ex, ey);
            else push(px, py);
        }
    };

    while (i < tokens.length) {
        if (!isNum()) cmd = tokens[i++];
        const rel = cmd === cmd.toLowerCase();
        const ox = rel ? x : 0;
        const oy = rel ? y : 0;
        switch (cmd.toUpperCase()) {
            case 'M': {
                const nx = num() + ox;
                const ny = num() + oy;
                x = nx;
                y = ny;
                sx = nx;
                sy = ny;
                cur = {points: [[nx, ny]], closed: false};
                out.push(cur);
                // Further pairs after M are line-tos.
                cmd = rel ? 'l' : 'L';
                lastCtrl = lastQ = null;
                break;
            }
            case 'L':
                push(num() + ox, num() + oy);
                lastCtrl = lastQ = null;
                break;
            case 'H':
                push(num() + (rel ? x : 0), y);
                lastCtrl = lastQ = null;
                break;
            case 'V':
                push(x, num() + (rel ? y : 0));
                lastCtrl = lastQ = null;
                break;
            case 'C': {
                const x1 = num() + ox;
                const y1 = num() + oy;
                const x2 = num() + ox;
                const y2 = num() + oy;
                const ex = num() + ox;
                const ey = num() + oy;
                cubic(x1, y1, x2, y2, ex, ey);
                lastCtrl = [x2, y2];
                lastQ = null;
                break;
            }
            case 'S': {
                const x1 = lastCtrl ? 2 * x - lastCtrl[0] : x;
                const y1 = lastCtrl ? 2 * y - lastCtrl[1] : y;
                const x2 = num() + ox;
                const y2 = num() + oy;
                const ex = num() + ox;
                const ey = num() + oy;
                cubic(x1, y1, x2, y2, ex, ey);
                lastCtrl = [x2, y2];
                lastQ = null;
                break;
            }
            case 'Q': {
                const x1 = num() + ox;
                const y1 = num() + oy;
                const ex = num() + ox;
                const ey = num() + oy;
                quad(x1, y1, ex, ey);
                lastQ = [x1, y1];
                lastCtrl = null;
                break;
            }
            case 'T': {
                const x1: number = lastQ ? 2 * x - lastQ[0] : x;
                const y1: number = lastQ ? 2 * y - lastQ[1] : y;
                const ex = num() + ox;
                const ey = num() + oy;
                quad(x1, y1, ex, ey);
                lastQ = [x1, y1];
                lastCtrl = null;
                break;
            }
            case 'A': {
                const rx = num();
                const ry = num();
                const rot = num();
                const large = num();
                const sweep = num();
                const ex = num() + ox;
                const ey = num() + oy;
                arc(rx, ry, rot, large, sweep, ex, ey);
                lastCtrl = lastQ = null;
                break;
            }
            case 'Z':
                if (cur) {
                    cur.closed = true;
                    if (cur.points.length && (x !== sx || y !== sy)) cur.points.push([sx, sy]);
                }
                x = sx;
                y = sy;
                cur = null;
                lastCtrl = lastQ = null;
                break;
            default:
                // An unknown command: skip its number to avoid looping forever.
                i++;
        }
    }
    return out.filter((s) => s.points.length >= 2);
}

const pathCache = new Map<string, Subpath[]>();
/** Parsed path data is pure in its input, so it is parsed once per string. */
function parsed(d: string): Subpath[] {
    let p = pathCache.get(d);
    if (!p) {
        p = parsePath(d);
        pathCache.set(d, p);
    }
    return p;
}

// ── painting ───────────────────────────────────────────────────────────────────

export interface GlyphPlacement {
    /** Where the glyph's anchor goes, in projected meters. */
    at: P;
    /** Projected meters per CSS pixel. */
    resolution: number;
    /** The graphic's main color, for `'main'`. */
    main: string;
    /** Radians counter-clockwise: turn the glyph to follow a line. */
    rotation?: number;
    /** Extra scale on top of the glyph's own (a pattern drawn smaller). */
    scale?: number;
    /** The graphic's value, for a `'$value'` text part. */
    value?: string;
    /** The family's palette; {@link CSS_GLYPH_COLORS} when absent. */
    colors?: GlyphColors;
}

export function resolveGlyphColor(c: GlyphColor | undefined, main: string, colors: GlyphColors = CSS_GLYPH_COLORS): string | undefined {
    if (c === undefined || c === 'none') return undefined;
    if (c === 'main') return main;
    if (c === 'halo') return colors.halo;
    return colors.resolve(c);
}

/** The circle part as a path: four arcs, so it goes through the same flattening. */
function circlePath(cx: number, cy: number, r: number): string {
    return `M${cx - r},${cy} A${r},${r} 0 1 0 ${cx + r},${cy} A${r},${r} 0 1 0 ${cx - r},${cy} Z`;
}

/** The marks for a glyph at a placement. */
export function paintGlyph(glyph: GlyphDef, place: GlyphPlacement): Paint[] {
    const colors = place.colors ?? CSS_GLYPH_COLORS;
    const box = glyph.box ?? 24;
    const [ax, ay] = glyph.anchor ?? [box / 2, box / 2];
    const k = GLYPH_PX * (glyph.scale ?? 1) * (place.scale ?? 1) * place.resolution;
    const cos = Math.cos(place.rotation ?? 0);
    const sin = Math.sin(place.rotation ?? 0);
    // Box units, y down, to projected meters, y up, turned by the rotation.
    const map = (gx: number, gy: number): P => {
        const u = (gx - ax) * k;
        const v = -(gy - ay) * k;
        return [place.at[0] + u * cos - v * sin, place.at[1] + u * sin + v * cos];
    };
    const unitPx = GLYPH_PX * (glyph.scale ?? 1) * (place.scale ?? 1);
    const out: Paint[] = [];
    for (const part of glyph.parts) {
        if ('text' in part) {
            const text = part.text === '$value' ? place.value?.trim() : part.text;
            if (!text) continue;
            const outlineColor = part.outline && part.outline.width > 0 ? resolveGlyphColor(part.outline.color, place.main, colors) : undefined;
            const outline = outlineColor ? {color: outlineColor as string, widthPx: part.outline!.width * unitPx} : undefined;
            out.push({
                role: 'label',
                geometry: {type: 'Point', coordinates: map(part.x, part.y)},
                text: {
                    text,
                    color: resolveGlyphColor(part.color ?? 'main', place.main, colors) as string,
                    sizePx: part.size * unitPx,
                    haloColor: colors.halo,
                    rotation: place.rotation ?? 0,
                    ...(part.text === '$value' ? {} : {symbol: true}),
                    ...(part.italic ? {fontStyle: 'italic' as const} : {}),
                    ...(part.serif ? {fontFamily: 'serif'} : {}),
                    ...(part.halo === false ? {haloPx: 0} : {}),
                    ...(part.weight !== undefined ? {fontWeight: part.weight} : {}),
                    ...(outline ? {outline} : {}),
                    ...(part.edge ? {align: part.edge.align, alignAt: map(part.edge.x, part.y)} : {}),
                },
            });
            continue;
        }
        const d = 'd' in part ? part.d : circlePath(part.circle[0], part.circle[1], part.circle[2]);
        const fill = resolveGlyphColor(part.fill, place.main, colors);
        const stroke = resolveGlyphColor(part.stroke ?? (fill ? 'none' : 'main'), place.main, colors);
        const widthPx = (part.width ?? 1.6) * unitPx;
        const dashPx = part.dash?.map((v) => v * unitPx);
        const ends = {...(part.cap ? {cap: part.cap} : {}), ...(part.join ? {join: part.join} : {})};
        if (fill && 'evenOdd' in part && part.evenOdd) {
            for (const group of evenOddGroups(parsed(d))) {
                const coordinates = group.map((sub) => {
                    const pts = sub.points.map(([gx, gy]) => map(gx, gy));
                    return closedRing(sub.points) ? pts : [...pts, pts[0]];
                });
                out.push({role: 'decoration', geometry: {type: 'Polygon', coordinates}, fill: {color: fill}, ...(stroke ? {stroke: {color: stroke, widthPx, ...ends}} : {})});
            }
            continue;
        }
        for (const sub of parsed(d)) {
            const pts = sub.points.map(([gx, gy]) => map(gx, gy));
            if (fill && pts.length >= 3) {
                const ring = sub.closed ? pts : [...pts, pts[0]];
                out.push({role: 'decoration', geometry: {type: 'Polygon', coordinates: [ring]}, fill: {color: fill}, ...(stroke ? {stroke: {color: stroke, widthPx, ...ends}} : {})});
            } else if (stroke) {
                out.push({role: 'decoration', geometry: {type: 'LineString', coordinates: pts}, stroke: {color: stroke, widthPx, ...(dashPx ? {dashPx} : {}), ...ends}});
            }
        }
    }
    return out;
}

const closedRing = (r: P[]) => r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1];

const evenOddCache = new WeakMap<Subpath[], Subpath[][]>();
/**
 * A glyph to paint at many places with one placement otherwise (a pattern's marks): its marks are
 * worked out once, and each place gets a copy moved there. Unturned, moving a mark is adding the
 * place to each point, which is what {@link paintGlyph} computes there; a turned glyph is painted
 * at each place.
 */
export function glyphStamp(glyph: GlyphDef, place: Omit<GlyphPlacement, 'at'>): (at: P) => Paint[] {
    if (place.rotation) return (at) => paintGlyph(glyph, {...place, at});
    const marks = paintGlyph(glyph, {...place, at: [0, 0]});
    return (at) => marks.map((m) => movedMark(m, at));
}

function movedMark(m: Paint, [x, y]: P): Paint {
    const g = m.geometry;
    const move = (c: P): P => [x + c[0], y + c[1]];
    const geometry =
        g.type === 'Point'
            ? {type: g.type, coordinates: move(g.coordinates)}
            : g.type === 'LineString'
              ? {type: g.type, coordinates: g.coordinates.map(move)}
              : {type: 'Polygon' as const, coordinates: (g as {coordinates: P[][]}).coordinates.map((r) => r.map(move))};
    const out: Paint = {...m, geometry};
    if (m.stroke) out.stroke = {...m.stroke, ...(m.stroke.dashPx ? {dashPx: [...m.stroke.dashPx]} : {})};
    if (m.fill) out.fill = {...m.fill};
    if (m.text) out.text = {...m.text, ...(m.text.outline ? {outline: {...m.text.outline}} : {})};
    return out;
}

/**
 * Rings filled even-odd, as polygons with holes: a ring's depth is how many others contain it; an
 * even-depth ring is an outer boundary, and an odd-depth ring a hole in the smallest even ring that
 * holds it. Containment is read from a ring's first vertex, which is enough for rings that do not
 * cross, as drawn symbols' rings do not.
 *
 * Moving, turning or scaling a glyph does not change which ring holds which, so the grouping is
 * worked out once per parsed path, in box units with y flipped up as on the map. Read at each
 * placement instead, a first vertex lying on another ring's edge was in or out by rounding, and the
 * same glyph changed shape as it turned.
 */
function evenOddGroups(subpaths: Subpath[]): Subpath[][] {
    let groups = evenOddCache.get(subpaths);
    if (groups) return groups;
    const subs = subpaths.filter((s) => s.points.length >= 3);
    const rings = subs.map((s) => {
        const r = s.points.map(([gx, gy]): P => [gx, -gy]);
        return closedRing(r) ? r : [...r, r[0]];
    });
    const area = (r: P[]) => Math.abs(r.reduce((a, p, i) => (i ? a + (r[i - 1][0] * p[1] - p[0] * r[i - 1][1]) : a), 0)) / 2;
    const containers = rings.map((r, i) => rings.map((_, j) => j).filter((j) => j !== i && pointInRing(r[0], rings[j])));
    const polygons = new Map<number, Subpath[]>();
    subs.forEach((s, i) => {
        if (containers[i].length % 2 === 0) polygons.set(i, [s]);
    });
    subs.forEach((s, i) => {
        if (containers[i].length % 2 === 0) return;
        // The smallest outer that holds it: its immediate container.
        const outer = containers[i].filter((j) => containers[j].length % 2 === 0).sort((a, b) => area(rings[a]) - area(rings[b]))[0];
        if (outer !== undefined) polygons.get(outer)!.push(s);
    });
    groups = [...polygons.values()];
    evenOddCache.set(subpaths, groups);
    return groups;
}
