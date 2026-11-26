/**
 * # Text marks as images
 *
 * Renderers whose text cannot carry a halo or a box the way the paint layer asks (MapLibre without a
 * glyph server, Cesium billboards) draw each label to a canvas. One drawing serves them all, so a
 * label looks the same on every engine. `document` is read only when a label is drawn.
 */

import {TEXT_LINE_HEIGHT, textLines} from './decorations.js';
import {MITER_LIMIT, type PaintText} from './paint.js';

/** Label size rounded to half a pixel: labels shrink continuously, and each size is a new image. */
export function labelImageSize(t: PaintText): number {
    return Math.round(t.sizePx * 2) / 2;
}

/** The CSS font a text mark is drawn in at a pixel size: its style, its weight (600 unless given), its family or `sans-serif`. */
export function labelFont(t: PaintText, sizePx: number): string {
    return `${t.fontStyle ? `${t.fontStyle} ` : ''}${t.fontWeight ?? 600} ${sizePx}px ${t.fontFamily ?? 'sans-serif'}`;
}

/** A text mark's halo width in CSS pixels. */
export function labelHaloPx(t: PaintText): number {
    return t.haloPx ?? 3;
}

/** A stable key for a label image: two labels with the same key draw the same pixels. */
export function labelImageKey(t: PaintText): string {
    return `${labelImageSize(t)}|${t.color}|${t.haloColor}|${labelHaloPx(t)}|${t.fontStyle ?? ''}|${t.fontFamily ?? ''}|${t.fontWeight ?? ''}|${t.outline ? `${t.outline.color} ${t.outline.widthPx}` : ''}|${t.boxColor ?? ''}|${t.text}`;
}

/**
 * A 2D context for an image drawn once and then copied (into another image, a texture, a billboard):
 * one the browser keeps in memory rather than on the GPU. Chrome's GPU canvas, with many small
 * canvases made in a burst (a map's symbols as it loads), at times fills small text from blank glyph
 * masks: whole letters drop out and their halo, stroked as paths, shows in their place. A canvas in
 * memory draws them every time, and MapLibre's `getImageData` reads it without a GPU readback.
 */
export function imageContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
    return canvas.getContext('2d', {willReadFrequently: true})!;
}

/**
 * Draw a text mark at `ratio` device pixels per CSS pixel: its halo, or its box for a boxed label, then
 * the letters, then their outline if any (over them, mitered as SVG strokes text).
 * A newline breaks the text into centered lines, {@link TEXT_LINE_HEIGHT} apart, as OpenLayers draws it.
 */
let measurer: CanvasRenderingContext2D | null | undefined;

/** The widest line of a label's text, in CSS pixels, as `drawLabelImage` sets it; undefined with no canvas. */
export function labelTextWidth(t: PaintText): number | undefined {
    if (measurer === undefined) measurer = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
    if (!measurer) return undefined;
    measurer.font = labelFont(t, labelImageSize(t));
    return Math.max(...textLines(t.text).map((l) => measurer!.measureText(l).width));
}

export function drawLabelImage(t: PaintText, ratio = 1): HTMLCanvasElement {
    const sizePx = labelImageSize(t);
    const canvas = document.createElement('canvas');
    const ctx = imageContext(canvas);
    const font = labelFont(t, sizePx * ratio);
    ctx.font = font;
    const halo = Math.max(labelHaloPx(t) * ratio, t.outline ? t.outline.widthPx * ratio : 0);
    const pad = t.boxColor ? 4 * ratio : 0;
    const lines = textLines(t.text);
    const lineH = sizePx * ratio * TEXT_LINE_HEIGHT;
    const w = Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width)) + halo * 2 + 2 + pad * 2);
    const h = Math.ceil(sizePx * ratio * 1.4 + lineH * (lines.length - 1) + halo * 2);
    canvas.width = w;
    canvas.height = h;
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    if (t.boxColor) {
        // A boxed label: the box replaces the halo, as OpenLayers' background fill does.
        const bw = 1.5 * ratio;
        ctx.fillStyle = t.haloColor;
        ctx.fillRect(bw, bw, w - bw * 2, h - bw * 2);
        ctx.lineWidth = bw;
        ctx.strokeStyle = t.boxColor;
        ctx.strokeRect(bw / 2, bw / 2, w - bw, h - bw);
    } else if (labelHaloPx(t) > 0) {
        ctx.lineWidth = labelHaloPx(t) * ratio;
        ctx.strokeStyle = t.haloColor;
        lines.forEach((l, i) => ctx.strokeText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * lineH));
    }
    ctx.fillStyle = t.color;
    lines.forEach((l, i) => ctx.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * lineH));
    if (t.outline && t.outline.widthPx > 0) {
        ctx.lineJoin = 'miter';
        ctx.miterLimit = MITER_LIMIT;
        ctx.lineWidth = t.outline.widthPx * ratio;
        ctx.strokeStyle = t.outline.color;
        lines.forEach((l, i) => ctx.strokeText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * lineH));
    }
    return canvas;
}
