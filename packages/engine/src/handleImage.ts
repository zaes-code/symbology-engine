/**
 * Edit handles as images, for a renderer whose own marker cannot draw a handle's shape or cross. Each
 * renderer draws a plain round handle natively and every other one from this image, so the shapes look
 * the same on every map.
 */
import type {OverlayHandle} from './host.js';
import {imageContext} from './labelImage.js';

/** Whether a handle is a plain dot, which every renderer draws with its own circle marker. */
export function isPlainHandle(h: OverlayHandle): boolean {
    return (h.shape ?? 'circle') === 'circle' && !h.cross && (h.strokeWidthPx ?? 2) === 2 && !h.offsetPx;
}

/** A key for a handle's image: handles that look alike share it. Rotation is not part of it (the map turns the image). */
export function handleImageKey(h: OverlayHandle): string {
    return `handle:${h.shape ?? 'circle'}:${h.radiusPx}:${h.fill}:${h.stroke}:${h.strokeWidthPx ?? 2}:${h.cross ?? ''}`;
}

/**
 * The handle drawn pointing up (north), centered on its canvas, at `ratio` device pixels a CSS pixel.
 * `sizePx` is the canvas's side in CSS pixels; the handle's center is the canvas's center.
 */
export function drawHandleImage(h: OverlayHandle, ratio = 1): {canvas: HTMLCanvasElement; sizePx: number} {
    const r = h.radiusPx;
    const line = h.strokeWidthPx ?? 2;
    const shape = h.shape ?? 'circle';
    // A diamond's and an arrow's corners reach further than their half width.
    const reach = shape === 'diamond' ? r * Math.SQRT2 : shape === 'arrow' ? r * 1.25 : r;
    const sizePx = Math.ceil(2 * (reach + line + 1));
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(sizePx * ratio);
    canvas.height = canvas.width;
    // In memory, as the label and point images are: MapLibre reads it back with getImageData.
    const ctx = imageContext(canvas);
    ctx.scale(ratio, ratio);
    ctx.translate(sizePx / 2, sizePx / 2);
    ctx.beginPath();
    if (shape === 'square') ctx.rect(-r, -r, 2 * r, 2 * r);
    else if (shape === 'diamond') {
        const d = r * Math.SQRT2;
        ctx.moveTo(0, -d);
        ctx.lineTo(d, 0);
        ctx.lineTo(0, d);
        ctx.lineTo(-d, 0);
        ctx.closePath();
    } else if (shape === 'arrow') {
        // An arrowhead pointing up, its tip a quarter beyond the radius, notched at the back.
        const t = r * 1.25;
        ctx.moveTo(0, -t);
        ctx.lineTo(r, t * 0.8);
        ctx.lineTo(0, t * 0.35);
        ctx.lineTo(-r, t * 0.8);
        ctx.closePath();
    } else ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = h.fill;
    ctx.fill();
    ctx.lineJoin = 'round';
    ctx.lineWidth = line;
    ctx.strokeStyle = h.stroke;
    ctx.stroke();
    if (h.cross) {
        // The reticle: a + reaching most of the way to the outline, with a gap at the center so the exact
        // point under it stays visible.
        const arm = r * 0.8;
        const gap = Math.min(2, r * 0.25);
        ctx.beginPath();
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            ctx.moveTo(dx * gap, dy * gap);
            ctx.lineTo(dx * arm, dy * arm);
        }
        ctx.lineCap = 'butt';
        ctx.lineWidth = Math.max(1, line * 0.75);
        ctx.strokeStyle = h.cross;
        ctx.stroke();
    }
    return {canvas, sizePx};
}
