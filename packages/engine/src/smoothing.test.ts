/**
 * # Smoothing
 *
 * Catmull-Rom passes through every point it is given, which is what an operator expects of a line
 * "connected with a curved line"; Chaikin does not.
 */

import {catmullRom, catmullRomClosed, chaikin} from './smoothing';
import type {ProjectedPosition as P} from './mercator';

const passesThrough = (curve: P[], p: P) => curve.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-9);
const front: P[] = [[0, 0], [1000, 1200], [2400, 400], [3600, 1600]];

describe('catmullRom', () => {
    it('passes through every point, from the first to the last', () => {
        const curve = catmullRom(front);
        for (const p of front) expect(passesThrough(curve, p)).toBe(true);
        expect(curve[0]).toEqual(front[0]);
        expect(curve[curve.length - 1]).toEqual(front[front.length - 1]);
        expect(curve.length).toBe((front.length - 1) * 8 + 1);
    });

    it('is what Chaikin is not', () => {
        expect(passesThrough(chaikin(front), front[1])).toBe(false);
    });

    it('keeps a straight line straight, and does not loop between uneven points', () => {
        const straight = catmullRom([[0, 0], [10, 0], [1000, 0]]);
        expect(straight.every((p) => Math.abs(p[1]) < 1e-9)).toBe(true);
        expect(straight.every((p, i) => i === 0 || p[0] >= straight[i - 1][0])).toBe(true);
    });

    it('drops a repeated point, and leaves two points as they are', () => {
        expect(catmullRom([[0, 0], [0, 0], [10, 10], [20, 0]]).length).toBe(17);
        expect(catmullRom([[0, 0], [5, 5]])).toEqual([[0, 0], [5, 5]]);
    });
});

describe('catmullRomClosed', () => {
    const ring: P[] = [[0, 0], [1000, 0], [1200, 900], [-100, 1000]];

    it('passes through every corner and closes on the first', () => {
        const curve = catmullRomClosed(ring);
        for (const p of ring) expect(passesThrough(curve, p)).toBe(true);
        expect(curve[curve.length - 1]).toEqual(curve[0]);
        expect(curve.length).toBe(ring.length * 8 + 1);
    });

    it('takes a ring that is already closed the same way', () => {
        expect(catmullRomClosed([...ring, ring[0]])).toEqual(catmullRomClosed(ring));
    });
});
