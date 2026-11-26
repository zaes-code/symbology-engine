import {PAINT_BANDS, type Paint} from '../paint';
import {paintsToStyles} from './styles';

const square: Paint = {role: 'decoration', geometry: {type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]]}, fill: {color: 'red'}, stroke: {color: 'black', widthPx: 2}};
const label: Paint = {role: 'label', geometry: {type: 'Point', coordinates: [0, 0]}, text: {text: 'A', color: 'black', sizePx: 10, haloColor: 'white', rotation: 0}};

describe('paintsToStyles', () => {
    it('puts a graphic in its own z-index range above `base`, labels at the top of it', () => {
        const below = paintsToStyles([square, label], 0).map((s) => s.getZIndex());
        const above = paintsToStyles([square, label], PAINT_BANDS + 1).map((s) => s.getZIndex());
        expect(below).toEqual([0, PAINT_BANDS]);
        expect(above).toEqual([PAINT_BANDS + 1, 2 * PAINT_BANDS + 1]);
        // Everything of the upper graphic draws over everything of the lower one, its label included.
        expect(Math.min(...(above as number[]))).toBeGreaterThan(Math.max(...(below as number[])));
    });

    it('strokes with the cap and join of the paint, round when it gives none', () => {
        const line: Paint = {role: 'line', geometry: {type: 'LineString', coordinates: [[0, 0], [1, 1]]}, stroke: {color: 'black', widthPx: 2, cap: 'butt', join: 'miter'}};
        const [given] = paintsToStyles([line]);
        expect([given.getStroke()?.getLineCap(), given.getStroke()?.getLineJoin(), given.getStroke()?.getMiterLimit()]).toEqual(['butt', 'miter', 4]);
        const [plain] = paintsToStyles([square]);
        expect([plain.getStroke()?.getLineCap(), plain.getStroke()?.getLineJoin()]).toEqual(['round', 'round']);
    });

    it('fills polygons of one color, one after another, as one shape under the lines of their band', () => {
        type Ring = [number, number][];
        const outer = (x: number): Ring => [[x, 0], [x + 1, 0], [x + 1, 1], [x, 1], [x, 0]];
        const inner = (x: number): Ring => [[x + 0.25, 0.25], [x + 0.25, 0.75], [x + 0.75, 0.75], [x + 0.75, 0.25], [x + 0.25, 0.25]];
        const piece = (x: number, hole = false): Paint => ({
            role: 'decoration',
            geometry: {type: 'Polygon', coordinates: hole ? [outer(x), inner(x)] : [outer(x)]},
            fill: {color: 'black'},
        });
        const line: Paint = {role: 'line', geometry: {type: 'LineString', coordinates: [[0, 0], [2, 1]]}, stroke: {color: 'black', widthPx: 1}};
        const styles = paintsToStyles([piece(0, true), piece(1), line]);
        expect(styles).toHaveLength(2);
        const [fill, stroke] = styles;
        expect(fill.getGeometry()?.constructor.name).toBe('MultiPolygon');
        expect(fill.getZIndex()).toBe(-0.5);
        expect(stroke.getZIndex()).toBe(0);
        // Drawn as one path, non-zero, the outer rings wound one way and the hole the other.
        const calls: string[] = [];
        const signed: number[] = [];
        let ring: number[][] = [];
        const close = () => {
            let a = 0;
            ring.forEach(([x0, y0], k) => {
                const [x1, y1] = ring[(k + 1) % ring.length];
                a += x0 * y1 - x1 * y0;
            });
            signed.push(Math.sign(a));
            ring = [];
        };
        const context = {
            beginPath: () => calls.push('begin'),
            moveTo: (x: number, y: number) => (ring = [[x, y]]),
            lineTo: (x: number, y: number) => ring.push([x, y]),
            closePath: close,
            fill: (rule: string) => calls.push(`fill ${rule}`),
            fillStyle: '',
        };
        const coordinates = (fill.getGeometry() as unknown as {getCoordinates(): number[][][][]}).getCoordinates();
        (fill.getRenderer() as (c: unknown, s: unknown) => void)(coordinates, {context});
        expect(calls).toEqual(['begin', 'fill nonzero']);
        expect(signed).toHaveLength(3);
        expect(signed[1]).toBe(-signed[0]);
        expect(signed[2]).toBe(signed[0]);
        // A stroked polygon is drawn on its own, as before.
        expect(paintsToStyles([square, square])).toHaveLength(2);
    });

    it('draws a text outline over the letters: the text again, stroked only', () => {
        const outlined: Paint = {...label, text: {...label.text!, fontWeight: 400, outline: {color: 'black', widthPx: 1}}};
        const [letters, outline] = paintsToStyles([outlined]);
        expect(letters.getText()?.getFont()).toContain('400 ');
        expect(outline.getText()?.getFill()).toBeNull();
        expect(outline.getText()?.getStroke()?.getWidth()).toBe(1);
        expect(paintsToStyles([label])).toHaveLength(1);
    });
});
