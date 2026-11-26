/**
 * Paint lists as OpenLayers styles. A translation and nothing more: every decision about what a
 * symbol looks like was made by the paint layer, so this file must not grow symbol knowledge.
 */

import LineString from 'ol/geom/LineString.js';
import MultiPolygon from 'ol/geom/MultiPolygon.js';
import Point from 'ol/geom/Point.js';
import Polygon from 'ol/geom/Polygon.js';
import Fill from 'ol/style/Fill.js';
import Stroke from 'ol/style/Stroke.js';
import Style from 'ol/style/Style.js';
import Text from 'ol/style/Text.js';
import {asArray} from 'ol/color.js';
import {MITER_LIMIT, PAINT_BANDS, fillRun, labelFont, labelHaloPx, paintBands, type Paint} from '../index.js';

/** A color with an opacity applied, as OpenLayers takes it. */
function withOpacity(color: string, opacity: number | undefined): string | number[] {
    if (opacity === undefined || opacity >= 1) return color;
    const [r, g, b, a] = asArray(color);
    return [r, g, b, a * opacity];
}

/**
 * Fills a multipolygon's polygons as one path, non-zero, each outer ring wound one way and its holes the
 * other: the fill is their union with their holes kept. The coordinates are the canvas's pixels.
 */
function unionRenderer(color: string) {
    const wound = (ring: number[][], outer: boolean): number[][] => {
        let area = 0;
        for (let k = 0; k < ring.length; k++) {
            const [x0, y0] = ring[k];
            const [x1, y1] = ring[(k + 1) % ring.length];
            area += x0 * y1 - x1 * y0;
        }
        return area > 0 === outer ? ring : [...ring].reverse();
    };
    return (coordinates: unknown, state: {context: CanvasRenderingContext2D}) => {
        const ctx = state.context;
        ctx.beginPath();
        for (const polygon of coordinates as number[][][][]) {
            polygon.forEach((ring, k) => {
                wound(ring, k === 0).forEach(([x, y], j) => (j ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
                ctx.closePath();
            });
        }
        ctx.fillStyle = color;
        ctx.fill('nonzero');
    };
}

/**
 * `base` lifts the whole graphic: OpenLayers draws by z-index across all features, all polygons of
 * one z-index before all lines of it, so two graphics at the same z-index interleave (one's lines over
 * the other's fill). A graphic given its own range (its rank in the stack times PAINT_BANDS + 1) draws
 * as a unit, over the ones below it.
 */
export function paintsToStyles(paints: readonly Paint[], base = 0): Style[] {
    const styles: Style[] = [];
    // OpenLayers draws a feature's polygons before its lines whatever the order: the bands keep the
    // painter's (a mark on a line stays on it). Labels above every band.
    const bands = paintBands(paints);
    for (let i = 0; i < paints.length; i++) {
        const p = paints[i];
        const zIndex = base + bands[i];
        // A band's fills come before its lines (a fill after a line starts a new band), and OpenLayers draws
        // a custom renderer after the polygons and lines of its z-index: so fill-only polygons, merged or
        // not, draw half a step under their band's lines, in the painter's order among themselves.
        const fillOnly = p.geometry.type === 'Polygon' && !!p.fill && !p.stroke;
        // Polygons filled alike, one after another, are one fill (their union), as drawPaintsImage fills
        // them: OpenLayers fills each polygon on its own, anti-aliased alone, and a seam showed where two
        // pieces of a glyph meet.
        const run = fillRun(paints, i);
        if (run > 1) {
            const polygons = paints.slice(i, i + run).map((q) => (q.geometry as {coordinates: number[][][]}).coordinates);
            styles.push(new Style({geometry: new MultiPolygon(polygons), zIndex: zIndex - 0.5, renderer: unionRenderer(p.fill!.color)}));
            i += run - 1;
            continue;
        }
        const stroke = p.stroke
            ? new Stroke({
                  color: p.stroke.color,
                  width: p.stroke.widthPx,
                  lineCap: p.stroke.cap ?? (p.stroke.dashPx ? 'butt' : 'round'),
                  lineJoin: p.stroke.join ?? 'round',
                  miterLimit: MITER_LIMIT,
                  ...(p.stroke.dashPx ? {lineDash: [...p.stroke.dashPx]} : {}),
              })
            : undefined;
        if (p.geometry.type === 'LineString') {
            styles.push(new Style({geometry: new LineString(p.geometry.coordinates), stroke, zIndex}));
        } else if (p.geometry.type === 'Polygon') {
            styles.push(
                new Style({
                    geometry: new Polygon(p.geometry.coordinates),
                    stroke,
                    zIndex: fillOnly ? zIndex - 0.5 : zIndex,
                    fill: p.fill ? new Fill({color: withOpacity(p.fill.color, p.fill.opacity)}) : undefined,
                }),
            );
        } else if (p.text) {
            styles.push(
                new Style({
                    geometry: new Point(p.geometry.coordinates),
                    zIndex: base + PAINT_BANDS,
                    text: new Text({
                        text: p.text.text,
                        font: labelFont(p.text, p.text.sizePx),
                        fill: new Fill({color: p.text.color}),
                        stroke: p.text.boxColor || labelHaloPx(p.text) <= 0 ? undefined : new Stroke({color: p.text.haloColor, width: labelHaloPx(p.text)}),
                        ...(p.text.boxColor
                            ? {
                                  backgroundFill: new Fill({color: p.text.haloColor}),
                                  backgroundStroke: new Stroke({color: p.text.boxColor, width: 1.5}),
                                  padding: [2, 4, 1, 4],
                              }
                            : {}),
                        // Paint rotation is counter-clockwise in map space; OpenLayers turns text clockwise.
                        rotation: -p.text.rotation,
                        rotateWithView: true,
                        textAlign: 'center',
                        textBaseline: 'middle',
                        overflow: true,
                    }),
                }),
            );
            // An outline lies over the letters: the same text again, stroked only, drawn after them.
            if (p.text.outline && p.text.outline.widthPx > 0) {
                styles.push(
                    new Style({
                        geometry: new Point(p.geometry.coordinates),
                        zIndex: base + PAINT_BANDS,
                        text: new Text({
                            text: p.text.text,
                            font: labelFont(p.text, p.text.sizePx),
                            fill: null,
                            stroke: new Stroke({color: p.text.outline.color, width: p.text.outline.widthPx, lineJoin: 'miter', miterLimit: MITER_LIMIT}),
                            rotation: -p.text.rotation,
                            rotateWithView: true,
                            textAlign: 'center',
                            textBaseline: 'middle',
                            overflow: true,
                        }),
                    }),
                );
            }
        }
    }
    return styles;
}
