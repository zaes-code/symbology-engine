import {boundsOf, pointInRing, walker} from './decorations';
import {GLYPH_PX, paintGlyph, type GlyphDef} from './glyph';
import type {Paint} from './paint';
import {paintAreaStyle} from './styles';

type P = [number, number];

// A pattern glyph with a filled ring, a dashed stroke and a letter.
const MARK: GlyphDef<'ink'> = {
    box: 12,
    parts: [
        {d: 'M2,2 L10,2 L10,10 Z', fill: 'ink'},
        {d: 'M1,11 L11,11', stroke: 'main', dash: [1, 1]},
        {text: 'K', x: 6, y: 6, size: 5},
    ],
};
const ctx = (ring: P[], resolution: number) => ({walker: walker(ring), resolution, main: 'red', colors: {resolve: (c: string) => (c === 'ink' ? 'blue' : c), halo: 'white'}, lineWidth: 2, label: {size: 12, halo: 'white'}});

/** Pattern and dot marks as they were painted with a point-in-ring test per grid point and per corner. */
function reference(ring: P[], resolution: number, spacingPx: number, dots: boolean, aligned: boolean): Paint[] {
    const grid = (spacing: number, al: boolean) => {
        const [x0, y0, x1, y1] = boundsOf(ring);
        let s = spacing;
        while (((x1 - x0) / s) * ((y1 - y0) / s) > 800) s *= 1.5;
        const out: P[] = [];
        let row = 0;
        for (let y = y0 + s / 2; y < y1; y += s, row++) {
            for (let x = x0 + (row % 2 && !al ? s : s / 2); x < x1; x += s) {
                if (pointInRing([x, y], ring)) out.push([x, y]);
                if (out.length >= 400) return out;
            }
        }
        return out;
    };
    const out: Paint[] = [];
    if (dots) {
        for (const p of grid(spacingPx * resolution, aligned)) {
            const r = 1.5 * resolution;
            const circle: P[] = [];
            for (let i = 0; i <= 8; i++) circle.push([p[0] + r * Math.cos((i * Math.PI) / 4), p[1] + r * Math.sin((i * Math.PI) / 4)]);
            out.push({role: 'decoration', geometry: {type: 'Polygon', coordinates: [circle]}, fill: {color: 'blue'}});
        }
        return out;
    }
    const extent = 12 * GLYPH_PX * resolution * 0.5;
    for (const p of grid(spacingPx * resolution, false)) {
        if (![[-1, -1], [1, -1], [1, 1], [-1, 1]].every(([fx, fy]) => pointInRing([p[0] + fx * extent * 0.7, p[1] + fy * extent * 0.7], ring))) continue;
        out.push(...paintGlyph(MARK, {at: p, resolution, main: 'red', colors: ctx(ring, resolution).colors}));
    }
    return out;
}

/** A seeded star-shaped ring: concave, its vertices often level with grid rows. */
function star(seed: number): P[] {
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const n = 4 + Math.floor(rnd() * 20);
    const cx = rnd() * 2e6 - 1e6;
    const cy = rnd() * 2e6 - 1e6;
    const r = 50 + rnd() * 5e4;
    const ring: P[] = Array.from({length: n}, (_, i) => {
        const a = (i / n) * 2 * Math.PI;
        const rr = r * (0.3 + rnd());
        // Some vertices on round numbers, so rows and corners meet them exactly.
        return [Math.round(cx + rr * Math.cos(a)), rnd() < 0.3 ? Math.round(cy) : cy + rr * Math.sin(a)];
    });
    return [...ring, ring[0]];
}

describe('area patterns', () => {
    it('place the same marks as a point-in-ring test per grid point and per corner', () => {
        let marks = 0;
        for (let seed = 1; seed <= 150; seed++) {
            const ring = star(seed);
            const [x0, , x1] = boundsOf(ring);
            for (const res of [(x1 - x0) / 300, (x1 - x0) / 80, (x1 - x0) / 20]) {
                const pattern = paintAreaStyle<'ink'>({outline: null, pattern: {glyph: MARK, spacingPx: 14}}, ctx(ring, res));
                expect(JSON.stringify(pattern)).toBe(JSON.stringify(reference(ring, res, 14, false, false)));
                marks += pattern.length;
                for (const aligned of [false, true]) {
                    const dots = paintAreaStyle<'ink'>({outline: null, dots: {color: 'ink', radiusPx: 1.5, spacingPx: 6, aligned}}, ctx(ring, res));
                    expect(JSON.stringify(dots)).toBe(JSON.stringify(reference(ring, res, 6, true, aligned)));
                }
            }
        }
        expect(marks).toBeGreaterThan(10_000);
    });

    it('give each mark its own geometry and style objects', () => {
        const ring: P[] = [[0, 0], [1000, 0], [1000, 1000], [0, 1000], [0, 0]];
        const paints = paintAreaStyle<'ink'>({outline: null, pattern: {glyph: MARK, spacingPx: 20}}, ctx(ring, 1));
        const lines = paints.filter((p) => p.geometry.type === 'LineString');
        expect(lines.length).toBeGreaterThan(1);
        (lines[0].stroke!.dashPx as number[])[0] = 99;
        (lines[0].geometry.coordinates as P[])[0][0] = -1;
        expect(lines[1].stroke!.dashPx![0]).not.toBe(99);
        expect(new Set(paints.map((p) => p.fill ?? p.stroke ?? p.text)).size).toBe(paints.length);
    });
});
