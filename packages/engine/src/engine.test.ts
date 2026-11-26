import {PAINT_BANDS, paintBands, type Paint} from './paint';
import {estimateTextHeight, estimateTextWidth, labelAnchorInRing, pointInRing, walker} from './decorations';
import {paintAreaStyle, paintLineStyle} from './styles';
import {pointSizeScale} from './sizes';
import {SymbolCollection, type CollectionSchema} from './collection';
import {drawnPoints, geometryForKind, minimumPointsFor} from './geometry';
import {CSS_GLYPH_COLORS, GLYPH_PX, paintGlyph, type GlyphDef} from './glyph';
import type {SymbolFeature} from './geometry';

// A toy family that is not METOC: the engine must hold a family it has never heard of.
type ToyName = 'Pin' | 'Fence' | 'Zone';
interface ToyProps {
    name: ToyName;
    label?: string;
}
const KINDS = {Pin: 'point', Fence: 'line', Zone: 'area'} as const;
const TOY: CollectionSchema<'toy', ToyProps> = {
    key: 'toy',
    idPrefix: 'toy',
    label: 'Toy',
    isName: (n): n is ToyName => typeof n === 'string' && n in KINDS,
    geometryOf: (n) => KINDS[n],
    displayName: (n) => `The ${n}`,
    clean: (raw) => (typeof raw.label === 'string' && raw.label !== '' ? {name: raw.name, label: raw.label} : {name: raw.name}),
};
const toy = (name: ToyName, points: number[][], props: Omit<ToyProps, 'name'> = {}): SymbolFeature<'toy', ToyProps> => ({
    type: 'Feature',
    geometry: geometryForKind(KINDS[name], points),
    properties: {toy: {name, ...props}},
});

describe('geometry', () => {
    it('saves each kind as the GeoJSON a consumer expects, and gives back the drawn points', () => {
        expect(geometryForKind('point', [[1, 2], [3, 4]])).toEqual({type: 'Point', coordinates: [1, 2]});
        expect(geometryForKind('line', [[0, 0], [1, 1]])).toEqual({type: 'LineString', coordinates: [[0, 0], [1, 1]]});
        const area = geometryForKind('area', [[0, 0], [1, 0], [1, 1]]);
        expect(area).toEqual({type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]]});
        expect(drawnPoints({type: 'Feature', geometry: area, properties: {}})).toEqual([[0, 0], [1, 0], [1, 1]]);
        expect([minimumPointsFor('point'), minimumPointsFor('line'), minimumPointsFor('area')]).toEqual([1, 2, 3]);
    });
});

describe('SymbolCollection with a family it has never heard of', () => {
    it('stores under the family key, ids with its prefix, and keeps only what the family cleans', () => {
        const c = new SymbolCollection(TOY);
        const id = c.add(toy('Zone', [[0, 0], [1, 0], [1, 1]], {label: 'A', stray: 1} as never));
        expect(id.startsWith('toy-')).toBe(true);
        expect(c.get(id)!.properties).toEqual({toy: {name: 'Zone', label: 'A'}});
        expect(c.get(id)!.geometry.type).toBe('Polygon');
    });

    it('rebuilds the geometry from drawn points, and removes a field set to undefined', () => {
        const c = new SymbolCollection(TOY);
        const id = c.add(toy('Zone', [[0, 0], [1, 0], [1, 1]], {label: 'A'}));
        c.setPoints(id, [[0, 0], [2, 0], [2, 2], [0, 2]]);
        expect(drawnPoints(c.get(id)!)).toEqual([[0, 0], [2, 0], [2, 2], [0, 2]]);
        c.setProperties(id, {label: undefined});
        expect(c.get(id)!.properties.toy).toEqual({name: 'Zone'});
    });

    it('changes the stacking order, which is the list order and the saved order', () => {
        const c = new SymbolCollection(TOY);
        const [a, b, d] = ['A', 'B', 'D'].map((label) => c.add(toy('Pin', [[0, 0]], {label})));
        const order = () => c.list().map((f) => f.properties.toy.label);
        const seen: string[] = [];
        c.subscribe((change) => seen.push(change.type));
        c.move(a, 'front');
        expect(order()).toEqual(['B', 'D', 'A']);
        c.move(a, 'backward');
        expect(order()).toEqual(['B', 'A', 'D']);
        c.move(d, 'back');
        expect(order()).toEqual(['D', 'B', 'A']);
        c.move(d, 'forward');
        expect(order()).toEqual(['B', 'D', 'A']);
        c.move(b, 'back'); // already at the back: nothing changes, nothing is announced
        expect(seen).toEqual(['reset', 'reset', 'reset', 'reset']);
        expect(c.toGeoJSON().features.map((f) => (f.properties as {toy: ToyProps}).toy.label)).toEqual(['B', 'D', 'A']);
    });

    it('announces each change once, after it is made', () => {
        const c = new SymbolCollection(TOY);
        const seen: string[] = [];
        c.subscribe((change) => seen.push(`${change.type}:${c.size}`));
        const id = c.add(toy('Pin', [[5, 5]]));
        c.setProperties(id, {label: 'here'});
        c.remove(id);
        c.clear();
        expect(seen).toEqual(['add:1', 'update:1', 'remove:0', 'reset:0']);
    });

    it('round-trips through GeoJSON and reports what it skips, in the family\'s words', () => {
        const c = new SymbolCollection(TOY);
        c.add(toy('Fence', [[0, 0], [1, 1]], {label: 'north'}));
        const again = new SymbolCollection(TOY);
        const {loaded, skipped} = again.load({
            type: 'FeatureCollection',
            features: [
                ...c.toGeoJSON().features,
                {type: 'Feature', geometry: {type: 'Point', coordinates: [0, 0]}, properties: {toy: {name: 'Gate'}}},
                {type: 'Feature', geometry: {type: 'Point', coordinates: [0, 0]}, properties: {toy: {name: 'Fence'}}},
                {type: 'Feature', geometry: {type: 'LineString', coordinates: [[0, 0]]}, properties: {toy: {name: 'Fence'}}},
                {type: 'Feature', geometry: {type: 'Point', coordinates: [0, 0]}, properties: {metoc: {name: 'Pin'}}},
            ],
        });
        expect(loaded).toHaveLength(1);
        expect(again.list()[0].properties.toy).toEqual({name: 'Fence', label: 'north'});
        expect(skipped.map((s) => s.reason)).toEqual(['unknown Toy graphic "Gate"', 'The Fence needs a LineString geometry', 'needs at least 2 points', 'unknown Toy graphic undefined']);
    });
});

describe('glyphs in a family palette', () => {
    const glyph: GlyphDef<'ink'> = {parts: [{d: 'M0,0 L24,24', stroke: 'ink'}, {circle: [12, 12, 4], fill: 'main'}, {text: 'X', x: 12, y: 12, size: 8}]};
    const at: [number, number] = [0, 0];

    it('resolves color names through the palette it is handed', () => {
        const paints = paintGlyph(glyph, {at, resolution: 1, main: 'red', colors: {resolve: (c) => (c === 'ink' ? 'rgb(1, 2, 3)' : c), halo: 'yellow'}});
        expect(paints[0].stroke?.color).toBe('rgb(1, 2, 3)');
        expect(paints[1].fill?.color).toBe('red');
        expect(paints[2].text).toMatchObject({text: 'X', color: 'red', haloColor: 'yellow'});
    });

    it('takes color names as CSS when no palette is given', () => {
        const paints = paintGlyph(glyph as GlyphDef, {at, resolution: 1, main: 'red'});
        expect(paints[0].stroke?.color).toBe('ink');
        expect(paints[2].text?.haloColor).toBe(CSS_GLYPH_COLORS.halo);
    });
});

describe('glyphs filled even-odd', () => {
    // A 24-unit box with a ring, a hole in it, and an island in the hole.
    const d = 'M2,2 H22 V22 H2 Z M6,6 H18 V18 H6 Z M10,10 H14 V14 H10 Z';
    const at: [number, number] = [0, 0];

    it('makes a ring inside another a hole, and one inside that hole an island', () => {
        const paints = paintGlyph({parts: [{d, fill: 'black', evenOdd: true}]}, {at, resolution: 1, main: 'red'});
        expect(paints).toHaveLength(2);
        const [outer, island] = paints.map((p) => (p.geometry as {coordinates: number[][][]}).coordinates);
        expect(outer).toHaveLength(2);
        expect(island).toHaveLength(1);
    });

    it('still fills each subpath on its own without it', () => {
        expect(paintGlyph({parts: [{d, fill: 'black'}]}, {at, resolution: 1, main: 'red'})).toHaveLength(3);
    });
});

describe('lines and areas drawn from data', () => {
    const ctx = (path: [number, number][], res = 1) => ({walker: walker(path), resolution: res, main: 'red', colors: {resolve: (c: string) => (c === 'ink' ? 'blue' : c), halo: 'white'}, lineWidth: 3, label: {size: 12, halo: 'white'}});
    const line: [number, number][] = [[0, 0], [200, 0]];
    const square: [number, number][] = [[0, 0], [200, 0], [200, 200], [0, 200], [0, 0]];

    it('strokes a line in its color at the family width, dashed when it says so', () => {
        const [p] = paintLineStyle<'ink'>({color: 'ink', dash: [4, 2]}, ctx(line));
        expect(p.stroke).toEqual({color: 'blue', widthPx: 3, dashPx: [4, 2]});
    });

    it('spaces ticks along a line, screen-sized', () => {
        const at = (res: number) => paintLineStyle({color: 'main', decorations: [{kind: 'ticks', side: 1, lengthPx: 6, spacingPx: 20}]}, ctx(line, res)).filter((p) => p.role === 'decoration').length;
        expect(at(1)).toBe(10);
        expect(at(2)).toBe(5);
    });

    it('fills an area the operator filled, with no outline, and dashes one the family dashed', () => {
        const filled = paintAreaStyle({}, ctx(square), {filled: {opacity: 0.4}});
        expect(filled).toHaveLength(1);
        expect(filled[0].fill).toEqual({color: 'red', opacity: 0.4});
        const dashed = paintAreaStyle({}, ctx(square), {dash: [10, 6]});
        expect(dashed[0].stroke).toMatchObject({color: 'red', dashPx: [10, 6]});
    });

    it('writes centered text inside the ring, and none when it does not fit', () => {
        expect(paintAreaStyle({outline: null}, ctx(square, 0.5), {text: 'A'}).find((p) => p.role === 'label')?.text?.text).toBe('A');
        expect(paintAreaStyle({outline: null}, ctx(square, 50), {text: 'A long name'}).some((p) => p.role === 'label')).toBe(false);
    });

    it('keeps the label of a concave area whose centroid falls outside it', () => {
        // A C: its centroid lies in the opening.
        const c: [number, number][] = [[0, 0], [300, 0], [300, 60], [60, 60], [60, 240], [300, 240], [300, 300], [0, 300], [0, 0]];
        const label = paintAreaStyle({outline: null}, ctx(c, 0.5), {text: 'Oak Fire'}).find((p) => p.role === 'label');
        expect(label).toBeDefined();
        expect(pointInRing(label!.geometry.coordinates as number[], c)).toBe(true);
        // A convex area keeps its label at the centroid.
        expect(labelAnchorInRing(square, 10, 5).at).toEqual([100, 100]);
    });

    it('turns an upright glyph a half turn on a line drawn leftward, and only then', () => {
        const glyph: GlyphDef = {parts: [{d: 'M12 12 L12 4', stroke: 'main'}]};
        const tip = (path: [number, number][], upright: boolean) => {
            const [p] = paintLineStyle({color: 'main', hideLine: true, decorations: [{kind: 'glyph', glyph, spacingPx: 400, at: 'middle', upright}]}, ctx(path));
            const coords = p.geometry.coordinates as number[][];
            return Math.sign(coords[coords.length - 1][1] - coords[0][1]);
        };
        const leftward: [number, number][] = [[200, 0], [0, 0]];
        expect(tip(line, true)).toBe(tip(line, false));
        expect(tip(leftward, true)).toBe(tip(line, true));
        expect(tip(leftward, false)).toBe(-tip(line, true));
    });

    it('turns glyphs along an outline the same way whichever way the area was traced', () => {
        const glyph: GlyphDef = {parts: [{d: 'M12 12 L12 4', stroke: 'main'}]};
        const reversed = [...square].reverse() as [number, number][];
        const outward = (ring: [number, number][]) =>
            paintAreaStyle({outline: null, outlineGlyph: {glyph, spacingPx: 50}}, ctx(ring)).every((p) => {
                const coords = p.geometry.coordinates as number[][];
                const [a, b] = [coords[0], coords[coords.length - 1]];
                // The stroke's far end lies farther from the center than its near end.
                return Math.hypot(b[0] - 100, b[1] - 100) > Math.hypot(a[0] - 100, a[1] - 100);
            });
        expect(outward(square)).toBe(outward(reversed));
    });
});

describe('bands, fitted dashes and italic glyph text', () => {
    const ctx = (path: [number, number][], res = 1) => ({walker: walker(path), resolution: res, main: 'red', colors: {resolve: (c: string) => c, halo: 'white'}, lineWidth: 3, label: {size: 12, halo: 'white'}});
    const square: [number, number][] = [[0, 0], [200, 0], [200, 200], [0, 200], [0, 0]];

    it('draws a band inside the outline, whichever way the area was traced', () => {
        for (const ring of [square, [...square].reverse() as [number, number][]]) {
            const band = paintAreaStyle({outline: null, bands: [{color: 'white', widthPx: 2, insetPx: 5}]}, ctx(ring))[0];
            const pts = band.geometry.coordinates as number[][];
            expect(pts.every(([x, y]) => x >= 4.9 && x <= 195.1 && y >= 4.9 && y <= 195.1)).toBe(true);
        }
    });

    it('centers a zigzag on its line, aligns a dot grid, and sets end marks in', () => {
        const zig = paintLineStyle({color: 'main', decorations: [{kind: 'zigzag', amplitudePx: 10, wavelengthPx: 20, centered: true}]}, ctx([[0, 0], [200, 0]]))[0];
        const ys = (zig.geometry.coordinates as number[][]).map((p) => p[1]);
        expect(Math.min(...ys)).toBeCloseTo(-5, 6);
        expect(Math.max(...ys)).toBeCloseTo(5, 6);
        const dots = paintAreaStyle({outline: null, dots: {color: 'k', spacingPx: 20, radiusPx: 1, aligned: true}}, ctx(square));
        const xs = new Set(dots.map((d) => Math.round((d.geometry.coordinates as number[][][])[0][0][0])));
        expect(xs.size).toBe(10);
        const glyph: GlyphDef = {parts: [{circle: [12, 12, 2], fill: 'main'}]};
        const ends = paintLineStyle({color: 'main', hideLine: true, decorations: [{kind: 'glyph', glyph, spacingPx: 0, at: 'both-ends', insetPx: 10}]}, ctx([[0, 0], [200, 0]]));
        const cx = ends.map((p) => (p.geometry.coordinates as number[][][])[0].reduce((s, q) => s + q[0], 0) / (p.geometry.coordinates as number[][][])[0].length);
        expect(cx[0]).toBeCloseTo(10, 0);
        expect(cx[1]).toBeCloseTo(190, 0);
    });

    it('stretches a fitted dash to whole periods', () => {
        const [p] = paintLineStyle({color: 'main', dash: [10, 10], dashFit: true}, ctx([[0, 0], [210, 0]]));
        const period = p.stroke!.dashPx!.reduce((a, b) => a + b, 0);
        expect(210 / period).toBeCloseTo(Math.round(210 / period), 9);
    });

    it('slants and serifs glyph text that asks for it', () => {
        const [t] = paintGlyph({parts: [{text: 'Co', x: 12, y: 12, size: 8, italic: true, serif: true}]}, {at: [0, 0], resolution: 1, main: 'black'});
        expect(t.text).toMatchObject({fontStyle: 'italic', fontFamily: 'serif'});
    });

    it('carries a glyph text weight and outline, scaled to pixels', () => {
        const [t] = paintGlyph({parts: [{text: 'CTA', x: 12, y: 12, size: 8, weight: 400, outline: {color: 'black', width: 0.5}}]}, {at: [0, 0], resolution: 1, main: 'white'});
        expect(t.text).toMatchObject({fontWeight: 400, outline: {color: 'black', widthPx: 0.5 * GLYPH_PX}});
        const [plain] = paintGlyph({parts: [{text: 'X', x: 12, y: 12, size: 8}]}, {at: [0, 0], resolution: 1, main: 'black'});
        expect(plain.text?.fontWeight).toBeUndefined();
        expect(plain.text?.outline).toBeUndefined();
    });

    it('carries a glyph path cap and join to its strokes, and leaves them absent otherwise', () => {
        const [open] = paintGlyph({parts: [{d: 'M2 20 L12 4 L22 20', fill: 'none', cap: 'butt', join: 'miter'}]}, {at: [0, 0], resolution: 1, main: 'black'});
        expect(open.stroke).toMatchObject({cap: 'butt', join: 'miter'});
        const [shape] = paintGlyph({parts: [{d: 'M2 2 H22 V22 H2 Z', fill: 'red', stroke: 'black', join: 'miter'}]}, {at: [0, 0], resolution: 1, main: 'black'});
        expect(shape.stroke).toMatchObject({join: 'miter'});
        const [plain] = paintGlyph({parts: [{d: 'M2 20 L22 20'}]}, {at: [0, 0], resolution: 1, main: 'black'});
        expect(plain.stroke?.cap).toBeUndefined();
        expect(plain.stroke?.join).toBeUndefined();
    });

    it('draws glyph text with no halo when it asks for none, and with the label halo otherwise', () => {
        const [inside, label] = paintGlyph({parts: [{text: 'F', x: 12, y: 8, size: 6, halo: false}, {text: 'T', x: 12, y: 20, size: 6}]}, {at: [0, 0], resolution: 1, main: 'black'});
        expect(inside.text?.haloPx).toBe(0);
        expect(label.text?.haloPx).toBeUndefined();
    });
});

describe('text estimates', () => {
    it('measures the widest line, wide letters wider than narrow ones', () => {
        expect(estimateTextWidth('WWWW', 10)).toBeGreaterThan(estimateTextWidth('iiii', 10) * 2.5);
        expect(estimateTextWidth('AB\nABCD', 10)).toBe(estimateTextWidth('ABCD', 10));
        expect(estimateTextHeight('A\nB', 10)).toBe(2 * estimateTextHeight('A', 10));
        expect(estimateTextWidth('火災', 10)).toBeGreaterThanOrEqual(20);
    });
});

describe('point sizes', () => {
    it('scale small, medium and large, falling back to the default', () => {
        expect([pointSizeScale('small'), pointSizeScale('medium'), pointSizeScale('large')]).toEqual([0.75, 1, 1.5]);
        expect(pointSizeScale(undefined, 'large')).toBe(1.5);
        expect(pointSizeScale('huge')).toBe(1);
    });
});

describe('hatching an area', () => {
    const ctx = (res = 1) => ({walker: walker([[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]]), resolution: res, main: 'red', colors: CSS_GLYPH_COLORS, lineWidth: 2, label: {size: 12, halo: 'white'}});
    /** Each hatch run as its two end points. */
    const runs = (paints: Paint[]) => paints.filter((p) => p.role === 'decoration').map((p) => (p.geometry as {coordinates: number[][]}).coordinates);

    it('draws parallel lines across the area, clipped to it, screen-sized', () => {
        const flat = runs(paintAreaStyle({outline: null, hatch: [{color: 'green', angle: 0, spacingPx: 10}]}, ctx()));
        expect(flat).toHaveLength(10);
        for (const [a, b] of flat) {
            expect(a[1]).toBeCloseTo(b[1], 9);
            expect(Math.abs(b[0] - a[0])).toBeCloseTo(100, 6);
        }
        expect(runs(paintAreaStyle({outline: null, hatch: [{color: 'green', angle: 0, spacingPx: 10}]}, ctx(2)))).toHaveLength(5);
    });

    it('crosses two sets for a cross-hatch, and offsets one for stripes', () => {
        expect(runs(paintAreaStyle({outline: null, hatch: [{color: 'k', angle: 45, spacingPx: 10}, {color: 'k', angle: -45, spacingPx: 10}]}, ctx())).length).toBeGreaterThan(20);
        const a = runs(paintAreaStyle({outline: null, hatch: [{color: 'y', angle: 0, spacingPx: 20}]}, ctx()))[0][0][1];
        const b = runs(paintAreaStyle({outline: null, hatch: [{color: 'r', angle: 0, spacingPx: 20, offsetPx: 10}]}, ctx()))[0][0][1];
        expect(Math.abs(a - b)).toBeCloseTo(10, 6);
    });

    it('keeps runs inside a concave ring', () => {
        // A U shape: a horizontal line through both arms is two runs, not one across the gap.
        const u = walker([[0, 0], [100, 0], [100, 100], [70, 100], [70, 30], [30, 30], [30, 100], [0, 100], [0, 0]]);
        const lines = runs(paintAreaStyle({outline: null, hatch: [{color: 'k', angle: 0, spacingPx: 25, offsetPx: 0}]}, {...ctx(), walker: u}));
        const at75 = lines.filter((run) => Math.abs(run[0][1] - 75) < 1e-6);
        expect(at75).toHaveLength(2);
    });
});

describe('paint bands', () => {
    const line = (): Paint => ({role: 'line', geometry: {type: 'LineString', coordinates: [[0, 0], [1, 0]]}, stroke: {color: 'red', widthPx: 3}});
    const mark = (): Paint => ({role: 'decoration', geometry: {type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]]}, fill: {color: 'white'}});

    it('starts a band where a filled mark follows line work, so a renderer keeps the painter order', () => {
        // A road closure: casing, line, then roundel disc and bar on top of them.
        expect(paintBands([line(), line(), mark(), mark()])).toEqual([0, 0, 1, 1]);
        // An area: fill, then its outline, then hatching lines: one band.
        expect(paintBands([mark(), line(), line()])).toEqual([0, 0, 0]);
        // Marks on marks on a line: a third band, and no more.
        expect(paintBands([line(), mark(), line(), mark(), line(), mark()])).toEqual([0, 1, 1, 2, 2, 2]);
        expect(PAINT_BANDS).toBe(3);
    });
});

describe('a painter underlay', () => {
    const line = (x: number): Paint => ({role: 'line', geometry: {type: 'LineString', coordinates: [[x, 0], [x + 1, 0]]}, stroke: {color: '#000', widthPx: 1}});
    it('comes first in everything a graphic draws, and is optional', async () => {
        const {paintAll} = await import('./painter');
        const painter = {paint: () => [line(1)], outline: () => [], underlay: () => [line(0)]};
        expect(paintAll(painter, {}, {resolution: 1}).map((p) => (p.geometry.coordinates as number[][])[0][0])).toEqual([0, 1]);
        expect(paintAll({paint: () => [line(1)], outline: () => []}, {}, {resolution: 1})).toHaveLength(1);
    });
});
