import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {Paint} from './paint.js';
import {drawPaintsImage} from './paintsImage.js';

/** Where each drawImage put its image's top-left corner and its size, in the canvas's device pixels. */
type Drawn = {x: number; y: number; w: number; h: number};

/** A 2D context that keeps its transform (no skew: scale, translate, rotate by 0) and records drawImage. */
function fakeCanvas(drawn: Drawn[], fills: {style: string; rule?: string; rings: number[][][]}[] = []) {
    let rings: number[][][] = [];
    const canvas = {width: 0, height: 0, getContext: () => ctx};
    let m = [1, 0, 0, 1, 0, 0];
    const stack: number[][] = [];
    const apply = (x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    const ctx = {
        font: '',
        measureText: (s: string) => ({width: s.length * 5.3}),
        save: () => stack.push([...m]),
        restore: () => (m = stack.pop()!),
        scale: (sx: number, sy: number) => (m = [m[0] * sx, m[1] * sx, m[2] * sy, m[3] * sy, m[4], m[5]]),
        translate: (tx: number, ty: number) => {
            const [x, y] = apply(tx, ty);
            m = [m[0], m[1], m[2], m[3], x, y];
        },
        rotate: (a: number) => expect(a === 0 || Object.is(a, -0)).toBe(true),
        setTransform: (...t: number[]) => (m = t),
        drawImage: (img: {width: number; height: number}, x: number, y: number, w = img.width, h = img.height) => {
            const [x0, y0] = apply(x, y);
            const [x1, y1] = apply(x + w, y + h);
            drawn.push({x: x0, y: y0, w: x1 - x0, h: y1 - y0});
        },
        fillStyle: '',
        setLineDash() {},
        beginPath: () => (rings = []),
        moveTo: (x: number, y: number) => rings.push([[x, y]]),
        lineTo: (x: number, y: number) => rings[rings.length - 1].push([x, y]),
        closePath() {},
        fill(rule?: string) {
            fills.push({style: ctx.fillStyle, rule, rings});
        },
        stroke() {},
        strokeText() {},
        fillText() {},
        strokeRect() {},
        fillRect() {},
    };
    return canvas;
}

const label = (x: number, y: number, rotation = 0): Paint => ({
    role: 'label',
    geometry: {type: 'Point', coordinates: [x, y]},
    text: {text: 'MAIN EFFORT', color: '#000', sizePx: 11, haloColor: 'rgba(255,255,255,0.9)', rotation},
});

describe('drawPaintsImage', () => {
    const drawn: Drawn[] = [];
    beforeEach(() => {
        drawn.length = 0;
        vi.stubGlobal('document', {createElement: () => fakeCanvas(drawn)});
    });
    afterEach(() => vi.unstubAllGlobals());

    it.each([1, 2, 1.25])('puts upright labels on whole device pixels at ratio %s, unscaled', (ratio) => {
        // Fractional positions, and a line that makes the image's own origin fractional.
        const line: Paint = {role: 'line', geometry: {type: 'LineString', coordinates: [[-13.37, 4.21], [2.6, -7.9]]}, stroke: {color: '#000', widthPx: 1.5}};
        const image = drawPaintsImage([line, label(3.3, -2.45), label(17.71, 9.5)], [0, 0], 1, ratio);
        expect(image).not.toBeNull();
        expect(drawn).toHaveLength(2);
        for (const d of drawn) {
            expect(Number.isInteger(d.x) && Number.isInteger(d.y)).toBe(true);
            // Drawn at its own size: no resampling.
            expect(Number.isInteger(d.w) && Number.isInteger(d.h)).toBe(true);
        }
        // Each label within half a device pixel of where it belongs: centered on its point.
        const [ax, ay] = image!.anchorPx;
        const center = (d: Drawn) => [(d.x + d.w / 2) / ratio - ax, (d.y + d.h / 2) / ratio - ay];
        const [c0, c1] = drawn.map(center);
        expect(Math.abs(c0[0] - 3.3)).toBeLessThanOrEqual(0.5 / ratio + 1e-9);
        expect(Math.abs(c0[1] - 2.45)).toBeLessThanOrEqual(0.5 / ratio + 1e-9);
        expect(Math.abs(c1[0] - 17.71)).toBeLessThanOrEqual(0.5 / ratio + 1e-9);
        expect(Math.abs(c1[1] + 9.5)).toBeLessThanOrEqual(0.5 / ratio + 1e-9);
    });

    it('fills neighboring polygons of one color as one shape, each ring wound for nonzero', () => {
        const fills: {style: string; rule?: string; rings: number[][][]}[] = [];
        vi.stubGlobal('document', {createElement: () => fakeCanvas(drawn, fills)});
        const square = (x: number, y: number, s: number, clockwise = false): number[][] => {
            const r = [[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]];
            return clockwise ? r.reverse() : r;
        };
        const fill = (rings: number[][][], color = '#000'): Paint => ({role: 'decoration', geometry: {type: 'Polygon', coordinates: rings as never}, fill: {color}});
        // Two pieces meeting edge to edge, one wound each way, the second with a hole wound as its outer ring.
        const paints = [fill([square(0, 0, 10)]), fill([square(10, 0, 10, true), square(12, 2, 2, true)]), fill([square(30, 0, 5)], '#f00')];
        drawPaintsImage(paints, [0, 0], 1);
        expect(fills.map((f) => [f.style, f.rule, f.rings.length])).toEqual([
            ['#000', 'nonzero', 3],
            ['#f00', 'evenodd', 1],
        ]);
        // On the canvas (y down) an outer ring of a counterclockwise polygon turns clockwise: both outer rings
        // one way, the hole the other.
        const turn = (r: number[][]) => r.reduce((s, [x0, y0], i) => s + x0 * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * y0, 0);
        const [a, b, hole] = fills[0].rings.map(turn);
        expect(Math.sign(a)).toBe(Math.sign(b));
        expect(Math.sign(hole)).toBe(-Math.sign(a));
    });

    it('keeps a stroked or translucent polygon a fill of its own', () => {
        const fills: {style: string; rule?: string; rings: number[][][]}[] = [];
        vi.stubGlobal('document', {createElement: () => fakeCanvas(drawn, fills)});
        const ring = [[0, 0], [5, 0], [5, 5], [0, 5], [0, 0]];
        const p = (extra: Partial<Paint>): Paint => ({role: 'decoration', geometry: {type: 'Polygon', coordinates: [ring] as never}, fill: {color: '#000'}, ...extra});
        drawPaintsImage([p({}), p({stroke: {color: '#000', widthPx: 1}}), p({fill: {color: '#000', opacity: 0.5}}), p({})], [0, 0], 1);
        expect(fills.map((f) => f.rule)).toEqual(['evenodd', 'evenodd', 'evenodd', 'evenodd']);
    });
});
