/**
 * # A point symbol on a leader line
 *
 * On a tilted 3D map a point symbol drawn on the ground lies flat, and terrain in front of it hides
 * it. Standing on a leader line — a lollipop — it stays upright and clear of the ground: the symbol
 * a fixed number of pixels up, a line down to a dot on its true location. It is drawn as one image
 * whose foot is the location, so an engine places it as it places any billboard or icon, anchored
 * at the image's bottom: the same picture on Cesium and on a MapLibre map with terrain. `document`
 * is read only when an image is drawn.
 */

import type {ProjectedPosition} from './mercator.js';
import type {Paint} from './paint.js';
import {imageContext} from './labelImage.js';
import {drawPaintsImage} from './paintsImage.js';

export interface PointLeader {
    /** From the location to the symbol's anchor, in CSS pixels. Default 48. */
    lengthPx?: number;
    /** The line's and dot's color. Default a dark slate. */
    color?: string;
    /** The halo round the line and dot, so they read on dark and light ground alike. */
    halo?: string;
    /** The line's width in CSS pixels. Default 2. */
    widthPx?: number;
    /** The dot's radius on the location, in CSS pixels. Default 3. */
    footRadiusPx?: number;
    /**
     * Dash and gap lengths in CSS pixels, laid from the location up, each dash on its own halo. Default
     * empty: a solid line.
     */
    dashPx?: readonly number[];
}

export const POINT_LEADER_DEFAULTS: Required<PointLeader> = {
    lengthPx: 48,
    color: 'rgb(31, 41, 51)',
    halo: 'rgba(255, 255, 255, 0.9)',
    widthPx: 2,
    footRadiusPx: 3,
    dashPx: [],
};

export interface PointLeaderImage {
    canvas: HTMLCanvasElement;
    /** The image's size in CSS pixels (the canvas is `ratio` times larger). */
    widthPx: number;
    heightPx: number;
    /** From the image's bottom edge up to the location (the dot's center), in CSS pixels. */
    footPx: number;
}

/** A pixel at least this opaque is the symbol's, for where the line starts. */
const INKED_ALPHA = 32;

/**
 * A point symbol's marks (painted at `resolution` around `anchor`) standing on a leader line, at
 * `ratio` device pixels per CSS pixel. The symbol's anchor is `lengthPx` above the location, which is
 * the image's bottom center, `footPx` up. The image is symmetric about the line, so a label to the
 * symbol's right keeps the line under its anchor.
 *
 * The line runs from the location up to the lowest ink of the symbol's picture straight under its
 * anchor (the bottom of a frame, or of a value written below it), never into the picture. It is not
 * measured on the picture's box: a symbol whose text or marks reach `lengthPx` from its anchor
 * anywhere would have no line at all.
 */
export function drawPointLeaderImage(paints: readonly Paint[], anchor: ProjectedPosition, resolution: number, ratio = 1, leader: PointLeader = {}): PointLeaderImage | null {
    const l = {...POINT_LEADER_DEFAULTS, ...defined(leader)};
    const symbol = drawPaintsImage(paints, anchor, resolution, ratio);
    if (!symbol) return null;
    const [ax, ay] = symbol.anchorPx;
    // Exactly `lengthPx`, whatever the symbol's size, so a host can pick the symbol where it is drawn
    // (pointLeaderLiftPx). A symbol reaching further below its anchor covers its own line.
    const foot = ay + l.lengthPx;
    const half = Math.max(ax, symbol.widthPx - ax, l.footRadiusPx + l.widthPx);
    // The symbol is drawn on whole device pixels (a fractional offset would resample it, softening
    // every line), and the image is as wide as twice its anchor's x, so the line and the location,
    // at the image's center, sit within half a device pixel of the anchor.
    const shift = Math.ceil((half - ax) * ratio);
    const deviceWidth = Math.ceil(2 * (shift + ax * ratio));
    const widthPx = deviceWidth / ratio;
    const heightPx = Math.ceil(Math.max(foot + l.footRadiusPx + l.widthPx, symbol.heightPx));
    const footPx = heightPx - foot;
    const lineTop = Math.min(foot, ay + inkBelow(symbol.canvas, ax, ay, ratio));
    const canvas = document.createElement('canvas');
    canvas.width = deviceWidth;
    canvas.height = Math.ceil(heightPx * ratio);
    const ctx = imageContext(canvas);
    ctx.scale(ratio, ratio);
    const x = widthPx / 2;
    const dash = dashPattern(l.dashPx);
    // The line and the dot, each on its halo, then the symbol.
    for (const [color, grow] of [
        [l.halo, 1.5],
        [l.color, 0],
    ] as const) {
        ctx.strokeStyle = color;
        ctx.lineWidth = l.widthPx + 2 * grow;
        if (dash.length && !(grow && dash.some((d, i) => i % 2 === 1 && d <= 2 * grow))) {
            // Each dash's halo reaches `grow` past both of its ends (a gap too short for that: one halo).
            ctx.lineCap = 'butt';
            ctx.setLineDash(dash.map((d, i) => (i % 2 ? d - 2 * grow : d + 2 * grow)));
            ctx.lineDashOffset = grow;
        } else if (dash.length && grow) {
            ctx.lineCap = 'butt';
            ctx.setLineDash([]);
        } else {
            ctx.lineCap = 'round';
            ctx.setLineDash([]);
        }
        if (lineTop < foot) {
            ctx.beginPath();
            ctx.moveTo(x, foot);
            ctx.lineTo(x, lineTop);
            ctx.stroke();
        }
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, foot, l.footRadiusPx + grow, 0, 2 * Math.PI);
        ctx.fill();
    }
    ctx.drawImage(symbol.canvas, shift / ratio, 0, symbol.widthPx, symbol.heightPx);
    return {canvas, widthPx, heightPx, footPx};
}

/** A leader's options less those given as `undefined`, which would hide the defaults. */
function defined(leader: PointLeader): PointLeader {
    return Object.fromEntries(Object.entries(leader).filter(([, v]) => v !== undefined)) as PointLeader;
}

/**
 * The dash pattern as dash, gap pairs (an odd list repeated, as a canvas repeats it, so every even
 * entry is a dash), or empty for a solid line: negative lengths are 0, and a pattern of no length is
 * solid.
 */
function dashPattern(dashPx: readonly number[]): number[] {
    const d = dashPx.map((v) => (Number.isFinite(v) ? Math.max(0, v) : 0));
    if (!d.some((v, i) => i % 2 === 0 && v > 0)) return [];
    return d.length % 2 ? [...d, ...d] : d;
}

/**
 * How far below its anchor (CSS pixels) the picture's lowest ink lies in the column under the anchor,
 * 0 for none: where the leader line meets the symbol.
 */
function inkBelow(canvas: HTMLCanvasElement, ax: number, ay: number, ratio: number): number {
    const cx = Math.round(ax * ratio);
    const top = Math.max(0, Math.floor(ay * ratio));
    const x0 = Math.max(0, cx - 1);
    const w = Math.min(canvas.width, cx + 2) - x0;
    const h = canvas.height - top;
    if (w <= 0 || h <= 0) return 0;
    const data = canvas.getContext('2d', {willReadFrequently: true})!.getImageData(x0, top, w, h).data;
    for (let row = h - 1; row >= 0; row--) {
        for (let col = 0; col < w; col++) if (data[(row * w + col) * 4 + 3] >= INKED_ALPHA) return (top + row + 1) / ratio - ay;
    }
    return 0;
}

/** How far up the screen a point symbol on a leader line is drawn, for picking it. */
export function pointLeaderLiftPx(leader: PointLeader = {}): number {
    return leader.lengthPx ?? POINT_LEADER_DEFAULTS.lengthPx;
}
