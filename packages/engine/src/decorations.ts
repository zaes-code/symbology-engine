/**
 * # Decoration geometry
 *
 * The pips, dots, chevrons, waves and rungs that only exist at paint time. Everything here is:
 *
 * - **Planar.** EPSG:3857 meters and plain Euclidean vector math. No geodesy: the inputs are
 *   already projected, and mixing degrees in is the mistake this split exists to prevent.
 * - **Pure.** No DOM, no canvas, no renderer.
 * - **Measured along the path.** Positions are distances along the (smoothed) line, so a pip
 *   sits on the curve the operator sees, not on a chord of it.
 */

import type {ProjectedPosition as P} from './mercator.js';

/** A path you can ask for the point and direction at any distance along it. */
export interface PathWalker {
    readonly path: readonly P[];
    readonly length: number;
    at(distance: number): {point: P; dir: P};
    /** The part of the path between two distances, as a polyline. */
    slice(from: number, to: number): P[];
}

/** Drop repeated points, which have no direction. */
export function dedupe(path: readonly P[]): P[] {
    const out: P[] = [];
    for (const p of path) {
        const last = out[out.length - 1];
        if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-9) out.push([p[0], p[1]]);
    }
    return out;
}

export function walker(input: readonly P[]): PathWalker {
    const path = dedupe(input);
    const cum: number[] = [0];
    for (let i = 0; i < path.length - 1; i++) cum.push(cum[i] + Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]));
    const length = cum[cum.length - 1] ?? 0;

    const segmentAt = (d: number): number => {
        let lo = 0;
        let hi = path.length - 2;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (cum[mid] <= d) lo = mid;
            else hi = mid - 1;
        }
        return Math.max(0, lo);
    };

    const at = (distance: number) => {
        if (path.length < 2) return {point: (path[0] ?? [0, 0]) as P, dir: [1, 0] as P};
        const d = Math.max(0, Math.min(length, distance));
        const i = segmentAt(d);
        const a = path[i];
        const b = path[i + 1];
        const seg = cum[i + 1] - cum[i];
        const t = seg > 0 ? (d - cum[i]) / seg : 0;
        return {point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] as P, dir: [(b[0] - a[0]) / seg, (b[1] - a[1]) / seg] as P};
    };

    const slice = (from: number, to: number): P[] => {
        const f = Math.max(0, Math.min(length, from));
        const t = Math.max(0, Math.min(length, to));
        if (t <= f || path.length < 2) return [];
        const out: P[] = [at(f).point];
        for (let i = 1; i < path.length - 1; i++) if (cum[i] > f && cum[i] < t) out.push(path[i]);
        out.push(at(t).point);
        return out;
    };

    return {path, length, at, slice};
}

/** The unit normal to the left of travel (y is up in projected space). */
export function leftNormal(dir: P): P {
    return [-dir[1], dir[0]];
}

/** `point` moved `along` the direction and `side` meters to its left (negative is right). */
export function offset(point: P, dir: P, along: number, side: number): P {
    const n = leftNormal(dir);
    return [point[0] + dir[0] * along + n[0] * side, point[1] + dir[1] * along + n[1] * side];
}

/**
 * A triangular pip on the line at distance `d`: its base runs along the curve, its apex points
 * to `side` (+1 left, -1 right).
 */
export function triangleRing(w: PathWalker, d: number, base: number, height: number, side: number): P[] {
    const a = w.at(d - base / 2).point;
    const b = w.at(d + base / 2).point;
    const mid = w.at(d);
    const apex = offset(mid.point, mid.dir, 0, side * height);
    return [a, apex, b, a];
}

/** A half-circle pip of radius `r`, bulging to `side`. */
export function semicircleRing(w: PathWalker, d: number, r: number, side: number, steps = 12): P[] {
    const {point, dir} = w.at(d);
    const ring: P[] = [];
    for (let i = 0; i <= steps; i++) {
        const phi = (Math.PI * i) / steps;
        ring.push(offset(point, dir, -r * Math.cos(phi), side * r * Math.sin(phi)));
    }
    ring.push(ring[0]);
    return ring;
}

/** A small filled circle. */
export function circleRing(center: P, r: number, steps = 12): P[] {
    const ring: P[] = [];
    for (let i = 0; i <= steps; i++) {
        const a = (2 * Math.PI * i) / steps;
        ring.push([center[0] + r * Math.cos(a), center[1] + r * Math.sin(a)]);
    }
    return ring;
}

/** The parts of [0, length] outside every gap, as polylines along the path. */
export function runsOutside(w: PathWalker, gaps: ReadonlyArray<readonly [number, number]>): P[][] {
    const sorted = [...gaps].filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
    const runs: P[][] = [];
    let from = 0;
    for (const [a, b] of sorted) {
        if (a > from) runs.push(w.slice(from, a));
        from = Math.max(from, b);
    }
    if (from < w.length) runs.push(w.slice(from, w.length));
    return runs.filter((r) => r.length >= 2);
}

/** Points along the path displaced sideways by `f(s)` meters, sampled every `step` meters. */
export function displacedPath(w: PathWalker, from: number, to: number, step: number, f: (s: number) => number): P[] {
    const out: P[] = [];
    const n = Math.max(1, Math.ceil((to - from) / step));
    for (let i = 0; i <= n; i++) {
        const s = from + ((to - from) * i) / n;
        const {point, dir} = w.at(s);
        out.push(offset(point, dir, 0, f(s)));
    }
    return out;
}

/**
 * `count` evenly spaced positions along the path: the pattern stretches a little so a line
 * always ends on a whole number of repeats rather than a clipped one.
 */
export function evenSlots(length: number, spacing: number): {count: number; spacing: number} {
    if (spacing <= 0 || length <= 0) return {count: 0, spacing: 0};
    const count = Math.max(1, Math.round(length / spacing));
    return {count, spacing: length / count};
}

/**
 * How much to shrink screen-sized decorations on a graphic that is small on screen: 1 once the
 * line is at least `minRepeats` pattern repeats long, then proportionally less, and 0 (draw the
 * plain line) once a pip would be smaller than {@link DECORATION_MIN_PX}. The rule is about the
 * graphic's size on screen, not the zoom: a short line looks the same drawn small or zoomed away.
 */
export const DECORATION_MIN_PX = 3;

export function decorationFit(lengthPx: number, periodPx: number, sizePx: number, minRepeats = 2): number {
    const want = periodPx * minRepeats;
    if (lengthPx >= want) return 1;
    const s = lengthPx / want;
    return s * sizePx < DECORATION_MIN_PX ? 0 : s;
}

/** Dash runs for a renderer that cannot dash a stroke natively, in the given pixel pattern. */
export function dashRuns(path: readonly P[], dashPx: readonly number[], resolution: number): P[][] {
    const w = walker(path);
    const pattern = dashPx.map((v) => v * resolution);
    const period = pattern.reduce((a, b) => a + b, 0);
    if (period <= 0 || w.length === 0) return [w.slice(0, w.length)];
    const runs: P[][] = [];
    let d = 0;
    let i = 0;
    while (d < w.length) {
        const len = pattern[i % pattern.length];
        if (i % 2 === 0) {
            const run = w.slice(d, Math.min(w.length, d + len));
            if (run.length >= 2) runs.push(run);
        }
        d += len;
        i++;
    }
    return runs;
}

/** The direction of `dir` as an angle, turned so text along it reads left to right. */
export function uprightAngle(dir: P): number {
    let a = Math.atan2(dir[1], dir[0]);
    if (a > Math.PI / 2) a -= Math.PI;
    else if (a <= -Math.PI / 2) a += Math.PI;
    return a;
}

/**
 * Advance widths of a bold sans-serif (Arial Bold's metrics, in em), by character. A character not
 * listed is 0.62 em, or a full em where it is East Asian or an emoji.
 */
const ADVANCE: Record<string, number> = (() => {
    const t: Record<string, number> = {};
    const set = (chars: string, w: number) => {
        for (const c of chars) t[c] = w;
    };
    set(" !'.,:;|/\\Iijlf", 0.28);
    set('t()[]-`', 0.34);
    set('rJ*{}"°', 0.4);
    set('z', 0.5);
    set('0123456789#$_aceksvxy+<=>^~±', 0.56);
    set('bdghnopqu?FLTZ', 0.61);
    set('EPSVXY', 0.67);
    set('ABCDHKNRU&', 0.72);
    set('GOQw', 0.78);
    set('M', 0.83);
    set('m%', 0.89);
    set('W@', 0.95);
    return t;
})();

function advanceOf(ch: string): number {
    const w = ADVANCE[ch];
    if (w !== undefined) return w;
    const code = ch.codePointAt(0) ?? 0;
    // Hangul, CJK, full-width forms, and emoji and other pictographs draw a full em wide.
    return code >= 0x1100 && (code <= 0x115f || (code >= 0x2e80 && code <= 0xa4cf) || (code >= 0xac00 && code <= 0xd7a3) || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xfe30 && code <= 0xfe4f) || (code >= 0xff00 && code <= 0xff60) || (code >= 0xffe0 && code <= 0xffe6) || code >= 0x1f000)
        ? 1
        : 0.62;
}

/** A label's lines: text is broken at each newline, as every renderer draws it. */
export function textLines(text: string): string[] {
    return text.split(/\r?\n/);
}

/**
 * An estimate of a label's width: its widest line, from per-character widths of a bold sans-serif.
 * The paint layer has no canvas; this errs a little wide, never much narrow.
 */
export function estimateTextWidth(text: string, sizePx: number): number {
    let widest = 0;
    for (const line of textLines(text)) {
        let w = 0;
        for (const ch of line) w += advanceOf(ch);
        widest = Math.max(widest, w);
    }
    return widest * sizePx * 1.05;
}

/** The line height a label is drawn with, as a multiple of its size. */
export const TEXT_LINE_HEIGHT = 1.2;

/** An estimate of a label's height: its lines at {@link TEXT_LINE_HEIGHT}. */
export function estimateTextHeight(text: string, sizePx: number): number {
    return textLines(text).length * sizePx * TEXT_LINE_HEIGHT;
}

// ── rings ──────────────────────────────────────────────────────────────────────

/** Twice the signed area of a ring: positive when it runs counter-clockwise (y up). */
export function signedArea2(ring: readonly P[]): number {
    let a = 0;
    for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    return a;
}

/**
 * Which side of travel is outside a closed ring: +1 left, -1 right. Inside is to the left of a
 * counter-clockwise ring, so outside is to its right — and the reverse for a clockwise one. An
 * operator may trace an area either way round; nothing drawn on it may depend on which.
 */
export function outwardSide(ring: readonly P[]): 1 | -1 {
    return signedArea2(ring) >= 0 ? -1 : 1;
}

/** Ray casting. The ring may be closed or not. */
export function pointInRing(p: readonly number[], ring: readonly (readonly number[])[]): boolean {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

/** The ring's bounding box: [minX, minY, maxX, maxY]. */
export function boundsOf(ring: readonly P[]): [number, number, number, number] {
    const xs = ring.map((c) => c[0]);
    const ys = ring.map((c) => c[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** The centroid of a ring's area (falls back to the vertex mean for a degenerate ring). */
export function ringCentroid(ring: readonly P[]): P {
    const a2 = signedArea2(ring);
    if (Math.abs(a2) < 1e-9) {
        const n = Math.max(1, ring.length - 1);
        return [ring.slice(0, n).reduce((s, c) => s + c[0], 0) / n, ring.slice(0, n).reduce((s, c) => s + c[1], 0) / n];
    }
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < ring.length - 1; i++) {
        const f = ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
        cx += (ring[i][0] + ring[i + 1][0]) * f;
        cy += (ring[i][1] + ring[i + 1][1]) * f;
    }
    return [cx / (3 * a2), cy / (3 * a2)];
}

/** The distance from a point to a ring's outline. */
function distanceToRing(p: P, ring: readonly P[]): number {
    let best = Infinity;
    for (let i = 0; i + 1 < ring.length; i++) {
        const [ax, ay] = ring[i];
        const [bx, by] = ring[i + 1];
        const dx = bx - ax;
        const dy = by - ay;
        const l2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / l2));
        best = Math.min(best, Math.hypot(p[0] - ax - t * dx, p[1] - ay - t * dy));
    }
    return best;
}

/**
 * The point inside a ring farthest from its outline (its pole of inaccessibility), found by a grid
 * search refined around the best cell. Where a concave area's centroid falls outside it (a C, an L,
 * a U), this is where its label and center mark go.
 */
export function ringInteriorPoint(ring: readonly P[]): P {
    const [x0, y0, x1, y1] = boundsOf(ring as P[]);
    let best: P = ring[0];
    let bestD = -1;
    let cx = (x0 + x1) / 2;
    let cy = (y0 + y1) / 2;
    let hw = (x1 - x0) / 2;
    let hh = (y1 - y0) / 2;
    const N = 16;
    for (let round = 0; round < 4; round++) {
        for (let i = 0; i <= N; i++) {
            for (let j = 0; j <= N; j++) {
                const p: P = [cx - hw + (2 * hw * i) / N, cy - hh + (2 * hh * j) / N];
                if (!pointInRing(p, ring)) continue;
                const d = distanceToRing(p, ring);
                if (d > bestD) {
                    bestD = d;
                    best = p;
                }
            }
        }
        [cx, cy] = best;
        hw /= N / 4;
        hh /= N / 4;
    }
    return best;
}

/**
 * Where to center a label of `halfW` × `halfH` meters in a ring: the centroid where the label fits
 * there as well as anywhere, else the interior point that holds it larger. Returns the point and
 * its {@link fitScaleInRing}.
 */
export function labelAnchorInRing(ring: readonly P[], halfW: number, halfH: number): {at: P; scale: number} {
    const c = ringCentroid(ring);
    const atCentroid = pointInRing(c, ring) ? fitScaleInRing(c, halfW, halfH, ring) : 0;
    if (atCentroid >= 1) return {at: c, scale: 1};
    const pole = ringInteriorPoint(ring);
    const atPole = fitScaleInRing(pole, halfW, halfH, ring);
    // A centered label stays centered unless the interior point holds it clearly larger.
    return atPole > atCentroid * 1.15 ? {at: pole, scale: atPole} : {at: atCentroid > 0 ? c : pole, scale: atCentroid > 0 ? atCentroid : atPole};
}

/** A half-circle arc over the stretch [from, to] of the path, bulging to `side`, as a polyline. */
export function arcOver(w: PathWalker, from: number, to: number, side: number, steps = 10): P[] {
    const mid = w.at((from + to) / 2);
    const r = (to - from) / 2;
    const out: P[] = [];
    for (let i = 0; i <= steps; i++) {
        const phi = (Math.PI * i) / steps;
        out.push(offset(mid.point, mid.dir, -r * Math.cos(phi), side * r * Math.sin(phi)));
    }
    return out;
}

/**
 * The largest scale (0–1) at which a text box of `halfW` × `halfH` meters, centered at `at`, lies
 * inside the ring — tested at its corners and edge midpoints, because a box can straddle a
 * concave notch with no corner in it. A search, not a geometric shrink: a shrink has a floor, and
 * a long label in a thin area needs a scale below it.
 */
export function fitScaleInRing(at: P, halfW: number, halfH: number, ring: readonly P[]): number {
    const samples: [number, number][] = [
        [-1, -1], [0, -1], [1, -1],
        [-1, 0], [1, 0],
        [-1, 1], [0, 1], [1, 1],
    ];
    const fits = (s: number) => samples.every(([fx, fy]) => pointInRing([at[0] + fx * halfW * s, at[1] + fy * halfH * s], ring));
    if (!pointInRing(at, ring)) return 0;
    if (fits(1)) return 1;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 20; i++) {
        const mid = (lo + hi) / 2;
        if (fits(mid)) lo = mid;
        else hi = mid;
    }
    return lo;
}

/** Whether segments ab and cd cross (touching at an end does not count). */
function segmentsCross(a: readonly number[], b: readonly number[], c: readonly number[], d: readonly number[]): boolean {
    const o = (p: readonly number[], q: readonly number[], r: readonly number[]) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    const d1 = o(c, d, a);
    const d2 = o(c, d, b);
    const d3 = o(a, b, c);
    const d4 = o(a, b, d);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/**
 * Whether a ring's outline crosses itself — a figure eight, a bow tie. The ring may be given open
 * or closed. Planar: pass projected meters (or screen pixels), not degrees.
 */
export function ringSelfIntersects(ring: readonly (readonly number[])[]): boolean {
    const pts = [...ring];
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (pts.length > 1 && first[0] === last[0] && first[1] === last[1]) pts.pop();
    const n = pts.length;
    if (n < 4) return false;
    for (let i = 0; i < n; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % n];
        for (let j = i + 2; j < n; j++) {
            if (i === 0 && j === n - 1) continue; // the closing edge shares a point with the first
            if (segmentsCross(a, b, pts[j], pts[(j + 1) % n])) return true;
        }
    }
    return false;
}
