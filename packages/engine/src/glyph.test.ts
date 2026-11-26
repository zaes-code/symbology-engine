import {paintGlyph, type GlyphDef} from './glyph';

type Rings = number[][][];

// The even-odd parts of a published incident symbol (Close Exposure). Some of its ring
// vertices lie exactly on another ring's edge, so which ring holds which depends on how the test
// point is rounded: it must be read once, in the frame the glyph is drawn in (y up on the map), and
// not again at each placement.
const BOX = 13.2;
const PARTS = [
    "M10.06,6.56L9.83,6.56L9.74,6.51L9.72,6.1L9.73,5.47L9.74,5.23L10.26,5.23L10.26,5.27L10.27,5.88L10.28,6.51L10.28,6.56ZM10.56,6.44L10.58,5.23L10.84,5.23L11.1,5.24L11.11,5.81L11.12,6.46L11.12,6.56L10.56,6.56ZM10.56,8.09L10.56,7.43L11.12,7.43L11.12,8.74L10.56,8.74ZM9.71,8.09L9.71,7.43L10.28,7.43L10.28,8.74L9.71,8.74ZM8.87,8.09L8.87,7.43L8.93,7.43L9.21,7.45L9.44,7.45L9.45,8.09L9.45,8.72L9.29,8.73L8.87,8.74ZM9.18,10.04L9.74,10.04L9.74,9.82L10.26,9.82L10.26,9.93L10.26,10.04L11.39,8.74L11.39,5.97L11.39,4.63L10.8,4.63L9.42,4.62L8.62,4.61L8.62,4.76L8.62,4.94L8.62,4.98L8.72,4.84L8.76,4.77L8.78,4.75L8.81,4.74L8.87,4.8L8.87,4.98L8.88,5.17L8.9,5.23L8.97,5.24L9.38,5.24L9.46,5.49L9.46,6.08L9.44,6.54L9.22,6.56L8.98,6.57L8.89,6.68L8.76,6.83L8.66,6.92L8.6,6.98L8.6,7.2L8.61,8.74L8.62,10.04ZM9.36,11.07L9.71,10.67L9.73,10.15L9.74,10.04L8.62,10.04L8.62,11.09Z",
    "M3.6,6.46L3.09,6.44L3.07,5.82L3.07,5.21L3.3,5.19L3.6,5.19L3.69,5.31L3.69,6.39ZM4.04,6.46L3.99,5.72L4.01,5.21L4.21,5.19L4.61,5.24L4.59,6.42L4.32,6.47ZM2.16,6.45L2.14,5.81L2.14,5.2L2.77,5.21L2.77,6.47L2.48,6.47ZM2.15,8.5L2.13,7.88L2.13,7.31L2.78,7.31L2.78,7.92L2.76,8.53L2.22,8.56ZM4.06,8.56L3.99,8.41L3.98,7.79L3.98,7.29L4.21,7.31L4.53,7.32L4.62,7.32L4.62,8.54L4.43,8.56ZM3.14,8.55L3.07,8.39L3.05,7.76L3.05,7.29L3.28,7.31L3.6,7.32L3.69,7.32L3.69,8.55L3.63,8.55L3.39,8.56ZM4.92,10.83L4.9,9.52L4.89,6.42L4.89,4.62L1.87,4.62L1.87,8.44L3.06,9.62L3.68,9.6L3.7,9.79L3.71,10.32L4.24,10.86Z",
    "M6.59,2.66L6.61,2.58L6.14,1.7L6.07,1.97L6.27,2.42Z",
];

const glyph = (d: string): GlyphDef => ({box: BOX, parts: [{d, fill: 'black', stroke: 'none', evenOdd: true}]});
/** Polygons as ring sizes: the grouping, whatever the placement. */
const shape = (d: string, rotation: number, resolution: number, at: [number, number] = [0, 0]) =>
    paintGlyph(glyph(d), {at, resolution, rotation, main: 'red'}).map((p) => (p.geometry as {coordinates: Rings}).coordinates.map((r) => r.length));

describe('even-odd glyph parts', () => {
    it('group their rings as the glyph is drawn', () => {
        expect(PARTS.map((d) => shape(d, 0, 1))).toEqual([
            [[38, 12, 9, 6, 6, 10], [7]], // one outline with five holes, and the small ring beside it
            [[12, 9, 8, 7, 8, 10, 11]],
            [[6]],
        ]);
    });

    it('group their rings the same at every placement', () => {
        const placements: [number, number, [number, number]][] = [];
        for (let deg = 0; deg < 360; deg += 3) for (const res of [0.07, 1, 13.7, 611.5]) placements.push([(deg * Math.PI) / 180, res, [deg * 1013.3, -deg * 77.1]]);
        for (const d of PARTS) {
            const at0 = shape(d, 0, 1);
            const differ = placements.filter(([rot, res, at]) => JSON.stringify(shape(d, rot, res, at)) !== JSON.stringify(at0));
            expect(differ).toEqual([]);
        }
    });
});

describe('text aligned on an edge', () => {
    it('keeps its estimated center and passes the edge, mapped as the center is', () => {
        const glyph: GlyphDef = {box: 100, anchor: [50, 50], parts: [{text: 'ABC', x: 30, y: 50, size: 10, edge: {align: 'end', x: 40}}]};
        const [p] = paintGlyph(glyph, {at: [1000, 2000], resolution: 1, main: '#000'});
        expect(p!.text!.align).toBe('end');
        const center = p!.geometry.coordinates as number[];
        // The center is 20 glyph units left of the anchor, the edge 10: half as far, on the same line.
        expect((p!.text!.alignAt![0] - 1000) / (center[0]! - 1000)).toBeCloseTo(0.5);
        expect(p!.text!.alignAt![1]).toBeCloseTo(center[1]!);
    });
});
