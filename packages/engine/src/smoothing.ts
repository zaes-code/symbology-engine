/**
 * Chaikin corner cutting. It rounds the corners and does not pass through the inner points, so
 * the drawn points stay the handles while the symbol follows the curve (Appendix M: fronts are
 * "typically connected with a curved line"). The ends are kept, so a line still starts and stops
 * where the operator clicked.
 */

import type {ProjectedPosition} from './mercator.js';

export function chaikin(path: readonly ProjectedPosition[], iterations = 3): ProjectedPosition[] {
    let pts = path.map((p) => [p[0], p[1]] as ProjectedPosition);
    if (pts.length < 3) return pts;
    for (let k = 0; k < iterations; k++) {
        const next: ProjectedPosition[] = [pts[0]];
        for (let i = 0; i < pts.length - 1; i++) {
            const a = pts[i];
            const b = pts[i + 1];
            const q: ProjectedPosition = [0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]];
            const r: ProjectedPosition = [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]];
            if (i > 0) next.push(q);
            if (i < pts.length - 2) next.push(r);
        }
        next.push(pts[pts.length - 1]);
        pts = next;
    }
    return pts;
}

/**
 * Chaikin on a closed ring: every corner is cut, the seam included, so an area has no kink where
 * the operator started drawing. Takes the ring without its closing point and returns it closed.
 */
export function chaikinClosed(ring: readonly ProjectedPosition[], iterations = 3): ProjectedPosition[] {
    let pts = ring.map((p) => [p[0], p[1]] as ProjectedPosition);
    if (pts.length < 3) return [...pts, ...(pts.length ? [pts[0]] : [])];
    for (let k = 0; k < iterations; k++) {
        const next: ProjectedPosition[] = [];
        for (let i = 0; i < pts.length; i++) {
            const a = pts[i];
            const b = pts[(i + 1) % pts.length];
            next.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
        }
        pts = next;
    }
    return [...pts, pts[0]];
}

/**
 * A centripetal Catmull-Rom spline through every point: the curve passes through each point the
 * operator placed, where Chaikin cut the corners and left the inner points beside the line (an
 * operator's front missed its own anchors by 15-20 px). Centripetal parameterisation never loops
 * or overshoots at a sharp turn or between unevenly spaced points. `samples` points per segment.
 */
export function catmullRom(path: readonly ProjectedPosition[], samples = 8): ProjectedPosition[] {
    const pts = dedupe(path);
    if (pts.length < 3) return pts;
    const n = pts.length;
    // The ends continue straight on, mirrored, so the curve leaves the first point and reaches the
    // last along their own segments.
    const at = (i: number): ProjectedPosition => (i < 0 ? mirror(pts[0], pts[1]) : i >= n ? mirror(pts[n - 1], pts[n - 2]) : pts[i]);
    const out: ProjectedPosition[] = [pts[0]];
    for (let i = 0; i < n - 1; i++) segment(at(i - 1), pts[i], pts[i + 1], at(i + 2), samples, out);
    return out;
}

/**
 * Catmull-Rom on a closed ring, the seam included, so an area has no kink where the operator
 * started drawing. Takes the ring without its closing point and returns it closed.
 */
export function catmullRomClosed(ring: readonly ProjectedPosition[], samples = 8): ProjectedPosition[] {
    const pts = dedupe(ring);
    if (pts.length > 1 && same(pts[0], pts[pts.length - 1])) pts.pop();
    if (pts.length < 3) return [...pts, ...(pts.length ? [pts[0]] : [])];
    const n = pts.length;
    const at = (i: number) => pts[((i % n) + n) % n];
    const out: ProjectedPosition[] = [pts[0]];
    for (let i = 0; i < n; i++) segment(at(i - 1), at(i), at(i + 1), at(i + 2), samples, out);
    out[out.length - 1] = out[0];
    return out;
}

const same = (a: ProjectedPosition, b: ProjectedPosition) => a[0] === b[0] && a[1] === b[1];
const mirror = (p: ProjectedPosition, q: ProjectedPosition): ProjectedPosition => [2 * p[0] - q[0], 2 * p[1] - q[1]];

/** Copies, dropping a point equal to the one before it: a repeated point has no direction. */
function dedupe(path: readonly ProjectedPosition[]): ProjectedPosition[] {
    const out: ProjectedPosition[] = [];
    for (const p of path) if (!out.length || !same(out[out.length - 1], p)) out.push([p[0], p[1]]);
    return out;
}

/** The segment from p1 to p2, without p1 (already out), by Barry and Goldman's pyramid. */
function segment(p0: ProjectedPosition, p1: ProjectedPosition, p2: ProjectedPosition, p3: ProjectedPosition, samples: number, out: ProjectedPosition[]): void {
    const knot = (a: ProjectedPosition, b: ProjectedPosition) => Math.max(Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])), 1e-9);
    const t1 = knot(p0, p1);
    const t2 = t1 + knot(p1, p2);
    const t3 = t2 + knot(p2, p3);
    const lerp = (a: ProjectedPosition, b: ProjectedPosition, ta: number, tb: number, t: number): ProjectedPosition => {
        const u = (t - ta) / (tb - ta);
        return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
    };
    for (let k = 1; k <= samples; k++) {
        const t = t1 + ((t2 - t1) * k) / samples;
        const a1 = lerp(p0, p1, 0, t1, t);
        const a2 = lerp(p1, p2, t1, t2, t);
        const a3 = lerp(p2, p3, t2, t3, t);
        const b1 = lerp(a1, a2, 0, t2, t);
        const b2 = lerp(a2, a3, t1, t3, t);
        out.push(k === samples ? [p2[0], p2[1]] : lerp(b1, b2, t1, t2, t));
    }
}
