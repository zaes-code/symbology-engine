/**
 * Spherical Mercator (EPSG:3857), as plain math so the paint layer needs no map library.
 * Paint works in these projected meters because a screen pixel is a fixed number of them at a
 * given resolution, everywhere on the map — which is what makes a decoration screen-sized.
 */

import type {Position} from 'geojson';

export const EARTH_RADIUS = 6378137;
const MAX_LAT = 85.0511287798066;

/** A position in EPSG:3857 meters. */
export type ProjectedPosition = [number, number];

/** One trip round the world in projected meters: the x span of one copy of the world. */
export const WORLD_WIDTH = 2 * Math.PI * EARTH_RADIUS;

// ── The antimeridian ──────────────────────────────────────────────────────────
//
// A graphic drawn across ±180° has points either side of it: 179° then -179°. Projected as they
// are, the segment between them runs 358° the long way round the world. So a graphic's points are
// made **continuous** before anything is measured or painted — each longitude within 180° of the
// one before, running past 180 where the drawing does (179°, 181°). Files and TAK cannot hold
// 181°: what leaves the library is folded back with {@link wrapLongitude}.

/**
 * A longitude in [-180, 180). One already in range comes back exactly as it was: the arithmetic
 * would move it by a rounding error, and a flipped front would no longer hold its own points
 * reversed.
 */
export function wrapLongitude(lon: number): number {
    if (lon >= -180 && lon < 180) return lon;
    return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/**
 * Points made continuous across the antimeridian: each longitude moved by whole turns to within
 * 180° of the one before, and the whole set moved so the first point is in [-180, 180).
 */
export function continuousLonLat<T extends Position>(points: readonly T[]): [number, number][] {
    const out: [number, number][] = [];
    for (const p of points) {
        if (out.length === 0) {
            out.push([wrapLongitude(p[0]), p[1]]);
            continue;
        }
        const prev = out[out.length - 1][0];
        // Within half a turn already: the longitude as it is, not `prev + (p - prev)`, which can
        // come back a rounding error off.
        const d = p[0] - prev;
        out.push([d >= -180 && d < 180 ? p[0] : prev + wrapLongitude(d), p[1]]);
    }
    return out;
}

/** An x moved by whole worlds to the copy nearest `ref`: where a point is on the world a view shows. */
export function nearestWorldX(x: number, ref: number): number {
    return x - Math.round((x - ref) / WORLD_WIDTH) * WORLD_WIDTH;
}

/** A lon/lat projected onto the world copy nearest a projected reference point. */
export function toMercatorNear(lonLat: Position, ref: readonly number[]): ProjectedPosition {
    const m = toMercator(lonLat);
    return [nearestWorldX(m[0], ref[0]), m[1]];
}

export function toMercator(lonLat: Position): ProjectedPosition {
    const lat = Math.max(-MAX_LAT, Math.min(MAX_LAT, lonLat[1]));
    return [(EARTH_RADIUS * lonLat[0] * Math.PI) / 180, EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))];
}

export function fromMercator(p: readonly number[]): [number, number] {
    return [(p[0] / EARTH_RADIUS) * (180 / Math.PI), (2 * Math.atan(Math.exp(p[1] / EARTH_RADIUS)) - Math.PI / 2) * (180 / Math.PI)];
}

/**
 * Meters per CSS pixel at a MapLibre zoom level. MapLibre's zoom 0 is one 512-pixel world, so
 * this is what OpenLayers calls the resolution at the same view.
 */
export function resolutionAtZoom(zoom: number): number {
    return (2 * Math.PI * EARTH_RADIUS) / (512 * Math.pow(2, zoom));
}
