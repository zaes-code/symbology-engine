import {describe, expect, it} from 'vitest';
import type {Paint} from '../paint';
import {paintsToMapLibreFeatures} from './SymbolMapLibre';

describe('MapLibre dashes', () => {
    it('draws a dash as long as the line is wide as a dot half a pixel long, never as nothing', () => {
        // 2 px dots, 2 px wide: trimmed by their caps they would be empty, and the tiler drops them.
        const paints: Paint[] = [{role: 'line', geometry: {type: 'LineString', coordinates: [[0, 0], [100, 0]]}, stroke: {color: 'red', widthPx: 2, dashPx: [2, 4]}}];
        const runs = paintsToMapLibreFeatures(paints, 1, () => '').map((f) => (f.geometry as {coordinates: number[][]}).coordinates);
        expect(runs.length).toBeGreaterThan(15);
        for (const r of runs.slice(0, -1)) expect(r[r.length - 1][0] - r[0][0]).toBeCloseTo((0.5 / 6378137) * (180 / Math.PI), 9);
    });
    it('shortens each dash by its round caps, so the gaps stay open', () => {
        const paints: Paint[] = [{role: 'line', geometry: {type: 'LineString', coordinates: [[0, 0], [100, 0]]}, stroke: {color: 'red', widthPx: 4, dashPx: [10, 6]}}];
        const runs = paintsToMapLibreFeatures(paints, 1, () => '').map((f) => (f.geometry as {coordinates: number[][]}).coordinates);
        expect(runs.length).toBeGreaterThan(5);
        // 10 px dashes less a 2 px cap at each end, in degrees at the equator.
        const len = runs[0][runs[0].length - 1][0] - runs[0][0][0];
        expect(len).toBeCloseTo((6 / 6378137) * (180 / Math.PI), 9);
    });

    it('dashes a closed shape too', () => {
        const ring = [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]] as [number, number][];
        const paints: Paint[] = [{role: 'decoration', geometry: {type: 'Polygon', coordinates: [ring]}, stroke: {color: 'red', widthPx: 1, dashPx: [5, 5]}}];
        expect(paintsToMapLibreFeatures(paints, 1, () => '').length).toBeGreaterThan(10);
    });
});
