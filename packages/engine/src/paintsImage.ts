/**
 * # A point graphic's marks as one image
 *
 * A point symbol — a pressure center, a weather icon, a wind barb — is a screen-sized picture
 * around an anchor. An engine that cannot draw marks in screen space around a point (Cesium, whose
 * ground primitives are in meters) shows it as one billboard instead. This draws the marks into a
 * canvas, anchor at a known pixel, with the same strokes, fills, dashes and text the 2D renderers
 * draw. `document` is read only when an image is drawn.
 */

import {drawLabelImage, imageContext, labelTextWidth} from './labelImage.js';
import type {ProjectedPosition} from './mercator.js';
import {MITER_LIMIT, fillRun, type Paint} from './paint.js';

export interface PaintsImage {
    canvas: HTMLCanvasElement;
    /** The anchor's position in the image, in CSS pixels from its top-left corner. */
    anchorPx: [number, number];
    /** The image's size in CSS pixels (the canvas is `ratio` times larger). */
    widthPx: number;
    heightPx: number;
}

/**
 * Draw marks painted at `resolution` (projected meters per CSS pixel) around `anchor`, at `ratio`
 * device pixels per CSS pixel. North is up in the image. Nothing to draw gives `null`.
 *
 * `centered` puts the anchor in the middle of the image, for a host that can only center an image
 * on a point that turns with the view (a billboard aligned to north).
 */
export function drawPaintsImage(paints: readonly Paint[], anchor: ProjectedPosition, resolution: number, ratio = 1, centered = false): PaintsImage | null {
    // The marks in CSS pixels from the anchor, y down.
    const px = (p: readonly number[]): [number, number] => [(p[0] - anchor[0]) / resolution, (anchor[1] - p[1]) / resolution];
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const grow = (x: number, y: number, r = 0) => {
        x0 = Math.min(x0, x - r);
        y0 = Math.min(y0, y - r);
        x1 = Math.max(x1, x + r);
        y1 = Math.max(y1, y + r);
    };
    const labels = new Map<Paint, HTMLCanvasElement>();
    // Where a label's center is: its geometry, or for text aligned on an edge, that edge plus half its measured
    // width along its line (the estimated center drifts with every line's letters).
    const labelAt = (p: Paint, g: {coordinates: readonly number[]}): [number, number] => {
        const t = p.text;
        const w = t?.align && t.alignAt ? labelTextWidth(t) : undefined;
        if (!t || w === undefined || !t.alignAt) return px(g.coordinates as ProjectedPosition);
        const [ex, ey] = px(t.alignAt as ProjectedPosition);
        const half = (t.align === 'start' ? w : -w) / 2;
        const r = t.rotation ?? 0;
        // Along the text's line: counter-clockwise from east, the canvas's y down.
        return [ex + half * Math.cos(r), ey - half * Math.sin(r)];
    };
    for (const p of paints) {
        const g = p.geometry;
        // A miter reaches out to its limit times half the width, a square cap half the width diagonally.
        const reach = p.stroke?.join === 'miter' ? MITER_LIMIT : p.stroke?.cap === 'square' ? Math.SQRT2 : 1;
        const pad = ((p.stroke?.widthPx ?? 0) / 2) * reach + 1;
        if (g.type === 'LineString') g.coordinates.forEach((c) => grow(...px(c), pad));
        else if (g.type === 'Polygon') g.coordinates.forEach((r) => r.forEach((c) => grow(...px(c), pad)));
        else if (p.text) {
            const image = drawLabelImage(p.text, ratio);
            labels.set(p, image);
            const [x, y] = labelAt(p, g);
            // A turned label fits in the circle round its box.
            grow(x, y, Math.hypot(image.width, image.height) / ratio / 2);
        }
    }
    if (!Number.isFinite(x0)) return null;
    if (centered) {
        const rx = Math.max(-x0, x1);
        const ry = Math.max(-y0, y1);
        [x0, x1, y0, y1] = [-rx, rx, -ry, ry];
    }
    const widthPx = Math.ceil(x1 - x0) + 2;
    const heightPx = Math.ceil(y1 - y0) + 2;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(widthPx * ratio);
    canvas.height = Math.ceil(heightPx * ratio);
    const ctx = imageContext(canvas);
    ctx.scale(ratio, ratio);
    ctx.translate(1 - x0, 1 - y0);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.miterLimit = MITER_LIMIT;
    const path = (coords: readonly ProjectedPosition[], close: boolean) => {
        coords.forEach((c, i) => (i ? ctx.lineTo(...px(c)) : ctx.moveTo(...px(c))));
        if (close) ctx.closePath();
    };
    for (let i = 0; i < paints.length; i++) {
        const p = paints[i];
        const g = p.geometry;
        // Polygons filled alike, one after another, are one fill: each ring wound so that nonzero fills
        // every polygon's own area (outer ring one way, holes the other), which is their union. Filled one
        // by one, two polygons meeting edge to edge (the pieces of a glyph drawn as several shapes) were
        // each anti-aliased alone, and the background showed through along the edge they share.
        const run = fillRun(paints, i);
        if (run > 1) {
            ctx.beginPath();
            for (let j = i; j < i + run; j++) {
                (paints[j].geometry as {coordinates: ProjectedPosition[][]}).coordinates.forEach((ring, k) => path(wound(ring, k === 0), true));
            }
            ctx.fillStyle = p.fill!.color;
            ctx.fill('nonzero');
            i += run - 1;
            continue;
        }
        if (g.type === 'Point') {
            const image = labels.get(p);
            if (!image) continue;
            const [x, y] = labelAt(p, g);
            if (!p.text?.rotation) {
                // An upright label lands on whole device pixels. Between them, the canvas resamples it and
                // small text blurs; a renderer that samples the image between pixels again (MapLibre) blurs
                // it twice, and thin letters fade into their halo.
                const left = Math.round((x + 1 - x0) * ratio - image.width / 2);
                const top = Math.round((y + 1 - y0) * ratio - image.height / 2);
                ctx.save();
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.drawImage(image, left, top);
                ctx.restore();
                continue;
            }
            ctx.save();
            ctx.translate(x, y);
            // Paint rotation is counter-clockwise; a canvas turns clockwise.
            ctx.rotate(-(p.text?.rotation ?? 0));
            ctx.drawImage(image, -image.width / ratio / 2, -image.height / ratio / 2, image.width / ratio, image.height / ratio);
            ctx.restore();
            continue;
        }
        ctx.beginPath();
        if (g.type === 'LineString') path(g.coordinates, false);
        else g.coordinates.forEach((r) => path(r, true));
        if (p.fill && g.type === 'Polygon') {
            ctx.globalAlpha = p.fill.opacity ?? 1;
            ctx.fillStyle = p.fill.color;
            ctx.fill('evenodd');
            ctx.globalAlpha = 1;
        }
        if (p.stroke) {
            ctx.setLineDash(p.stroke.dashPx ? [...p.stroke.dashPx] : []);
            ctx.lineWidth = p.stroke.widthPx;
            ctx.lineCap = p.stroke.cap ?? 'round';
            ctx.lineJoin = p.stroke.join ?? 'round';
            ctx.strokeStyle = p.stroke.color;
            ctx.stroke();
        }
    }
    return {canvas, anchorPx: [1 - x0, 1 - y0], widthPx, heightPx};
}

/** A ring wound counterclockwise in projected coordinates (y up) when `outer`, clockwise when a hole. */
function wound(ring: readonly ProjectedPosition[], outer: boolean): readonly ProjectedPosition[] {
    let area = 0;
    for (let i = 0; i < ring.length; i++) {
        const [x0, y0] = ring[i];
        const [x1, y1] = ring[(i + 1) % ring.length];
        area += x0 * y1 - x1 * y0;
    }
    return area > 0 === outer ? ring : [...ring].reverse();
}
