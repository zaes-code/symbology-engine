/**
 * # A graphic across the antimeridian draws where it was placed
 *
 * A graphic drawn across ±180° has points either side of it: 179.99 then -179.99. Projected as
 * they are, the segment between them runs the long way round the world. So the engine keeps a
 * graphic's points **continuous** — each longitude within 180° of the one before, the first in
 * [-180, 180) — when it saves them and when it hands them to a painter, the editor or an exporter;
 * what leaves for a file or TAK is folded back. METOC's sweep of all its graphics, its editor test
 * and the drive exercise the same rules end to end; these pin the engine's own pieces.
 */

import type {Position} from 'geojson';
import {SymbolCollection, type CollectionSchema} from './collection';
import {drawnPoints, geometryForKind, type SymbolFeature} from './geometry';
import {WORLD_WIDTH, continuousLonLat, nearestWorldX, toMercator, toMercatorNear, wrapLongitude} from './mercator';

type Name = 'Line' | 'Area';
const schema: CollectionSchema<'toy', {name: Name}> = {
    key: 'toy',
    idPrefix: 'toy',
    label: 'Toy',
    isName: (n): n is Name => n === 'Line' || n === 'Area',
    geometryOf: (n) => (n === 'Line' ? 'line' : 'area'),
    displayName: (n) => n,
    clean: (raw) => raw,
};
const feature = (name: Name, points: Position[]): SymbolFeature<'toy', {name: Name}> => ({
    type: 'Feature',
    geometry: geometryForKind(name === 'Line' ? 'line' : 'area', points),
    properties: {toy: {name}},
});
/** The longest stretch, in km, between neighbouring points in Mercator. */
const longestKm = (points: Position[]) => {
    const m = points.map(toMercator);
    return Math.max(...m.slice(1).map((p, i) => Math.hypot(p[0] - m[i][0], p[1] - m[i][1]) / 1000));
};

describe('longitudes', () => {
    it('wrap into [-180, 180)', () => {
        expect([180, 180.5, -180, -180.5, 540, 10].map(wrapLongitude)).toEqual([-180, -179.5, -180, 179.5, -180, 10]);
    });

    it('come back exactly when they need no moving, so a flipped graphic holds its points reversed', () => {
        const lons = [-97.12345678901234, 0.1 + 0.2, 179.99999999999997, -180];
        expect(lons.map(wrapLongitude)).toEqual(lons);
        const pts: Position[] = [[-97.123456789, 38.1], [-96.98765, 38.4], [-95.5555, 38.2]];
        expect(continuousLonLat(pts)).toEqual(pts);
        const c = new SymbolCollection(schema);
        const id = c.add(feature('Line', pts));
        c.setPoints(id, drawnPoints(c.get(id)!).reverse());
        expect((c.get(id)!.geometry as {coordinates: Position[]}).coordinates).toEqual([...pts].reverse());
    });

    it('are made continuous, the first in range and each next within half a turn', () => {
        expect(continuousLonLat([[179.99, 10], [-179.99, 10], [-179.98, 11]]).map((p) => +p[0].toFixed(2))).toEqual([179.99, 180.01, 180.02]);
        expect(continuousLonLat([[190, 0], [200, 0]]).map((p) => p[0])).toEqual([-170, -160]);
    });

    it('project onto the world copy nearest a reference', () => {
        const east = toMercator([179.99, 0]);
        expect(nearestWorldX(toMercator([-179.99, 0])[0], east[0])).toBeCloseTo(toMercator([180.01, 0])[0]);
        expect(toMercatorNear([-179.99, 0], east)[0] - east[0]).toBeCloseTo((0.02 / 360) * WORLD_WIDTH);
    });
});

describe('a graphic across the antimeridian', () => {
    it('has continuous drawn points, a line and an area alike', () => {
        expect(longestKm(drawnPoints(feature('Line', [[179.99, 10], [-179.99, 10.01]])))).toBeLessThan(5);
        const area = drawnPoints(feature('Area', [[179.98, 10], [-179.98, 10], [-179.98, 10.02], [179.98, 10.02]]));
        expect(area).toHaveLength(4);
        expect(longestKm([...area, area[0]])).toBeLessThan(5);
    });

    it('is stored continuous, whichever side of 180 the points were handed in', () => {
        const c = new SymbolCollection(schema);
        c.load({type: 'FeatureCollection', features: [feature('Line', [[-179.99, 10], [179.99, 10.01]]), feature('Line', [[179.99, 10], [180.01, 10.01]])]});
        for (const f of c.list()) {
            const saved = (f.geometry as {coordinates: Position[]}).coordinates;
            expect(saved[0][0]).toBeGreaterThanOrEqual(-180);
            expect(saved[0][0]).toBeLessThan(180);
            expect(longestKm(saved)).toBeLessThan(5);
            expect(longestKm(drawnPoints(f))).toBeLessThan(5);
        }
    });
});
