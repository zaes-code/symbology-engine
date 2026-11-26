/**
 * # Drawn points and the geometry they make
 *
 * A graphic is one GeoJSON feature: a point is a `Point`, a line a `LineString`, an area a
 * `Polygon` with one closed ring, as any GeoJSON consumer expects. The coordinates are the points
 * the operator drew, in drawing order — for a line the order can be information (a front's pips
 * go by it) — so nothing here reorders them.
 *
 * Code that edits a graphic works on its *drawn points* — {@link drawnPoints} and
 * {@link geometryForKind} — and never on the raw coordinates, so it needs no branch for areas: the
 * ring's closing point is the geometry's business, not the editor's.
 */

import type {Feature, LineString, Point, Polygon, Position} from 'geojson';
import {continuousLonLat} from './mercator.js';

/** How a symbol is drawn: one anchor, a line, or an area. */
export type GeometryKind = 'point' | 'line' | 'area';

/** A graphic as saved: its drawn geometry, and its properties under one key (`properties[key]`). */
export type SymbolFeature<K extends string, P> = Feature<Point | LineString | Polygon, Record<K, P>>;

const copy = (points: readonly Position[]): [number, number][] => points.map((c) => [c[0], c[1]]);

/** The fewest points a saved graphic has: one for a point, two for a line, three for an area. */
export function minimumPointsFor(kind: GeometryKind): number {
    return kind === 'area' ? 3 : kind === 'line' ? 2 : 1;
}

/** The GeoJSON geometry type a kind is saved as. */
export function geometryTypeFor(kind: GeometryKind): 'Point' | 'LineString' | 'Polygon' {
    return kind === 'area' ? 'Polygon' : kind === 'point' ? 'Point' : 'LineString';
}

/** The geometry for drawn points: a point's first point, a line as is, an area as a closed ring. */
export function geometryForKind(kind: GeometryKind, points: readonly Position[]): Point | LineString | Polygon {
    // Kept continuous across the antimeridian, the first point in [-180, 180): a line drawn from
    // 179° to -179° is saved as 179° to 181°, two degrees long, not 358° (mercator.ts).
    const drawn = continuousLonLat(points);
    if (kind === 'point') return {type: 'Point', coordinates: drawn[0] ?? [0, 0]};
    if (kind === 'line') return {type: 'LineString', coordinates: drawn};
    const ring = copy(drawn);
    if (ring.length > 0) ring.push([ring[0][0], ring[0][1]]);
    return {type: 'Polygon', coordinates: [ring]};
}

/**
 * The points the operator drew, in order: a point's anchor, a line's coordinates, or an area's
 * outer ring without its closing point — **made continuous across the antimeridian**, since a file
 * from elsewhere folds longitudes into ±180 (179° then -179°), and every measure and paint reads
 * these. A graphic that does not cross is unchanged.
 */
export function drawnPoints(feature: Feature<Point | LineString | Polygon>): [number, number][] {
    const g = feature.geometry;
    if (g.type === 'Point') return continuousLonLat([g.coordinates]);
    if (g.type === 'LineString') return continuousLonLat(g.coordinates);
    const ring = copy(g.coordinates[0] ?? []);
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (ring.length > 1 && first[0] === last[0] && first[1] === last[1]) ring.pop();
    return continuousLonLat(ring);
}
