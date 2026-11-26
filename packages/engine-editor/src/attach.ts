/**
 * # Attaching the editor to a map
 *
 * `attachEditor(host, editor)` is the whole integration: any renderer that implements
 * {@link MapHost} — OpenLayers, MapLibre, Cesium — gets drawing and editing, with no editing
 * code of its own. The host reports events; this forwards them to the editor and paints the
 * editor's overlay back as plain marks: the selection highlight under the graphics, the
 * construction guide and the draft over them, the handles on top.
 */

import {continuousLonLat, paintAll, toMercator, type HostOverlay, type MapHost, type OverlayHandle, type Paint} from '@zaes/symbology-engine';
import {DEFAULT_EDITOR_CHROME, type HandleLook} from './family.js';
import type {HandleMark, SymbolInteraction} from './interaction.js';

/** The editor's overlay as marks at a resolution, in the family's chrome colors. */
export function editorOverlay<K extends string, P extends {name: string}>(editor: SymbolInteraction<K, P>, resolution: number): HostOverlay {
    const cfg = editor.family.chrome?.() ?? DEFAULT_EDITOR_CHROME;
    const outline = cfg.handleOutlineColor ?? 'white';
    const {draft, selectionOutline, guide, handles} = editor.overlay();
    const under: Paint[] = [];
    const over: Paint[] = [];
    if (selectionOutline) {
        const widthPx = cfg.selectionWidthPx ?? cfg.lineWidth + 10;
        under.push({role: 'decoration', geometry: {type: 'LineString', coordinates: continuousLonLat(selectionOutline).map(toMercator)}, stroke: {color: cfg.selectionColor, widthPx}});
    }
    if (guide) {
        // The drawn points joined straight: the construction line a smoothed graphic is built from.
        const dashPx = cfg.guideDashPx ?? [4, 4];
        const stroke = {color: cfg.guideColor ?? cfg.handleColor, widthPx: 1, ...(dashPx.length ? {dashPx} : {})};
        over.push({role: 'decoration', geometry: {type: 'LineString', coordinates: continuousLonLat(guide).map(toMercator)}, stroke});
    }
    if (draft) over.push(...paintAll(editor.family.painter, draft, {resolution}));
    // Vertex, rotate and resize handles are solid in their color, ringed; an insert handle is hollow. A
    // family's look for a kind of handle goes over that.
    const solid: Record<Exclude<HandleMark['kind'], 'insert'>, string> = {
        vertex: cfg.handleColor,
        rotate: cfg.rotateHandleColor ?? cfg.handleColor,
        resize: cfg.resizeHandleColor ?? cfg.handleColor,
    };
    return {
        under,
        over,
        handles: handles.map((h): OverlayHandle => {
            // A location handle over its symbol (`centered`) is a reticle unless the family gives the anchor a look: a
            // dot in the middle of a frame is lost in it.
            const look = (h.anchor ? (cfg.handles?.anchor ?? (h.centered ? centerReticle(cfg.handleColor) : cfg.handles?.vertex)) : cfg.handles?.[h.kind]) ?? {};
            const r = look.radiusPx ?? (h.kind === 'vertex' ? editor.handleRadiusPx : editor.insertHandleRadiusPx);
            const insert = h.kind === 'insert';
            const fill = look.fill ?? (insert ? (cfg.handleOutlineColor ?? 'rgba(255,255,255,0.9)') : solid[h.kind as Exclude<HandleMark['kind'], 'insert'>]);
            const stroke = look.stroke ?? (insert ? (cfg.insertHandleColor ?? cfg.handleColor) : outline);
            return {
                lonLat: h.lonLat,
                radiusPx: h.hot ? r + 2 : r,
                fill,
                stroke,
                ...(look.shape && look.shape !== 'circle' ? {shape: look.shape} : {}),
                ...(h.rotation !== undefined && look.shape === 'arrow' ? {rotation: h.rotation} : {}),
                ...(look.cross ? {cross: look.cross === true ? stroke : look.cross} : {}),
                ...(look.strokeWidthPx !== undefined ? {strokeWidthPx: look.strokeWidthPx} : {}),
                ...(h.offsetPx ? {offsetPx: h.offsetPx} : {}),
            };
        }),
    };
}

/** A see-through ring with a + through its center, in the handles' color: where a symbol drawn over others is selected. */
function centerReticle(color: string): HandleLook {
    return {radiusPx: 11, fill: 'rgba(255, 255, 255, 0.18)', stroke: color, strokeWidthPx: 2, cross: color};
}

/**
 * Edit on a map. Returns the function that detaches: the host's events stop reaching the editor
 * and its overlay is cleared. The editor itself, its collection and its selection survive, so a
 * host can switch engines and attach the same editor to the next one.
 */
export function attachEditor<K extends string, P extends {name: string}>(host: MapHost, editor: SymbolInteraction<K, P>): () => void {
    editor.setView(host.view);
    const render = () => host.setOverlay(editorOverlay(editor, host.resolution()));
    const cursor = (pixel?: [number, number]) => host.setCursor(editor.cursor() || (pixel && editor.isOverGraphic(pixel) ? 'pointer' : ''));

    const stopListening = host.listen({
        pointerDown: (e) => {
            const consumed = editor.pointerDown(e);
            cursor();
            return consumed;
        },
        pointerMove: (e) => {
            const consumed = editor.pointerMove(e);
            if (Number.isFinite(e.pixel[0])) cursor(e.pixel);
            return consumed;
        },
        pointerUp: (e) => {
            const consumed = editor.pointerUp(e);
            if (Number.isFinite(e.pixel[0])) cursor(e.pixel);
            return consumed;
        },
        doubleClick: (e) => editor.doubleClick(e),
        keyDown: (e) => editor.keyDownWith(e.key, e),
        wantsKeys: () => editor.mode === 'drawing' || editor.selectedId !== null,
        capturesDoubleClick: () => editor.mode === 'drawing',
    });
    const stopEditor = editor.subscribe(() => {
        render();
        cursor();
    });
    const stopView = host.onViewChange(render);
    render();
    return () => {
        stopListening();
        stopEditor();
        stopView();
        host.setOverlay(null);
        host.setCursor('');
    };
}

