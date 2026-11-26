/**
 * # Marks as styled GeoJSON
 *
 * For a consumer with no renderer of ours: the same marks the renderers draw, as EPSG:4326 GeoJSON
 * with simplestyle-spec properties.
 */

import type {Feature, FeatureCollection, Geometry, Position} from 'geojson';
import {fromMercator} from './mercator.js';
import type {Paint} from './paint.js';

/**
 * Marks as EPSG:4326 GeoJSON, styled with simplestyle-spec properties (`stroke`, `stroke-width`,
 * `fill`, …) plus `stroke-dasharray` (pixels), `role`, and for labels `text`, `text-size`,
 * `text-color`, `text-halo` and `text-rotation` (degrees clockwise from the map's east).
 */
export function paintsToGeoJSON(paints: readonly Paint[]): FeatureCollection {
    const features: Feature[] = paints.map((p) => {
        let geometry: Geometry;
        if (p.geometry.type === 'Point') geometry = {type: 'Point', coordinates: fromMercator(p.geometry.coordinates)};
        else if (p.geometry.type === 'LineString') geometry = {type: 'LineString', coordinates: p.geometry.coordinates.map(fromMercator)};
        else geometry = {type: 'Polygon', coordinates: p.geometry.coordinates.map((r) => r.map(fromMercator) as Position[])};
        const properties: Record<string, unknown> = {role: p.role};
        if (p.stroke) {
            properties.stroke = p.stroke.color;
            properties['stroke-width'] = p.stroke.widthPx;
            if (p.stroke.dashPx) properties['stroke-dasharray'] = [...p.stroke.dashPx];
        }
        if (p.fill) {
            properties.fill = p.fill.color;
            properties['fill-opacity'] = p.fill.opacity ?? 1;
        }
        if (p.text) {
            properties.text = p.text.text;
            properties['text-size'] = p.text.sizePx;
            properties['text-color'] = p.text.color;
            properties['text-halo'] = p.text.haloColor;
            properties['text-rotation'] = (-p.text.rotation * 180) / Math.PI;
            if (p.text.boxColor) properties['text-box'] = p.text.boxColor;
        }
        return {type: 'Feature', geometry, properties};
    });
    return {type: 'FeatureCollection', features};
}
