import {SymbolCollection, drawnPoints, fromMercator, toMercator, type CollectionSchema, type Paint, type Pixel, type SymbolFeature, type ViewAdapter} from '@zaes/symbology-engine';
import {editorOverlay} from './attach';
import type {EditorFamily} from './family';
import {SymbolInteraction, type EditorChange, type EditorOptions} from './interaction';

// A made-up family: a pin that turns and scales after it is placed, and a fence (a line).
type ToyName = 'Pin' | 'Fence';
interface ToyProps {
    name: ToyName;
    angle?: number;
    scale?: number;
}
type ToyFeature = SymbolFeature<'toy', ToyProps>;
const KINDS = {Pin: 'point', Fence: 'line'} as const;
const schema: CollectionSchema<'toy', ToyProps> = {
    key: 'toy',
    idPrefix: 'toy',
    label: 'Toy',
    isName: (n): n is ToyName => typeof n === 'string' && n in KINDS,
    geometryOf: (n) => KINDS[n],
    displayName: (n) => n,
    clean: (raw) => raw,
};
const RES = 1000;
const family: EditorFamily<'toy', ToyProps> = {
    schema,
    painter: {
        paint: (f: ToyFeature): Paint[] => [{role: 'line', geometry: {type: 'LineString', coordinates: drawnPoints(f).map(toMercator)}, stroke: {color: 'black', widthPx: 1}}],
        outline: (f: ToyFeature) => drawnPoints(f).map(toMercator),
    },
    // The pin turns with a handle 30 px out along its angle, and scales in steps of a half.
    rotation: (name) =>
        name === 'Pin'
            ? {get: (p) => p.angle, set: (d) => ({angle: d}), tip: (a, d, res) => [a[0] + Math.sin((d * Math.PI) / 180) * 30 * res, a[1] + Math.cos((d * Math.PI) / 180) * 30 * res]}
            : undefined,
    size: (name) => (name === 'Pin' ? {get: (p) => p.scale ?? 1, set: (s) => ({scale: Math.max(0.5, Math.round(s * 2) / 2)}), radiusPx: 20} : undefined),
    chrome: () => ({handleColor: 'lime', selectionColor: 'pink', lineWidth: 3, rotateHandleColor: 'red', resizeHandleColor: 'blue', guideDashPx: [], selectionWidthPx: 6}),
};
const view: ViewAdapter = {
    toPixel: (ll) => {
        const m = toMercator(ll);
        return [m[0] / RES, -m[1] / RES];
    },
    toLonLat: (px) => fromMercator([px[0] * RES, -px[1] * RES]),
};
const at = (x: number, y: number) => ({pixel: [x, y] as Pixel});
const px = (ll: readonly number[]) => view.toPixel(ll as [number, number]).map((v) => Math.round(v));
function setup(options: EditorOptions<ToyFeature> = {}) {
    const collection = new SymbolCollection(schema);
    const editor = new SymbolInteraction(family, collection, view, options);
    return {collection, editor};
}
const click = (editor: SymbolInteraction<'toy', ToyProps>, x: number, y: number) => {
    editor.pointerDown(at(x, y));
    editor.pointerUp(at(x, y));
};
const drag = (editor: SymbolInteraction<'toy', ToyProps>, from: number[], to: number[]) => {
    editor.pointerDown(at(from[0], from[1]));
    editor.pointerMove(at(to[0], to[1]));
    editor.pointerUp(at(to[0], to[1]));
};
function fence(editor: SymbolInteraction<'toy', ToyProps>, points: number[][]): string {
    editor.startDrawing('Fence');
    for (const [x, y] of points) click(editor, x, y);
    return editor.finishDrawing()!;
}

describe('rotation and size handles', () => {
    it('places a rotatable point with one click, then turns it with its handle', () => {
        const {collection, editor} = setup();
        editor.startDrawing('Pin');
        click(editor, 100, 100);
        const id = editor.selectedId!;
        expect(collection.get(id)!.properties.toy.angle).toBeUndefined();
        const rotate = editor.overlay().handles.find((h) => h.kind === 'rotate')!;
        expect(px(rotate.lonLat)).toEqual([100, 70]);
        drag(editor, [100, 70], [130, 100]);
        expect(collection.get(id)!.properties.toy.angle).toBe(90);
    });

    it('resizes a point with its corner handle, in the steps the family allows', () => {
        const {collection, editor} = setup();
        editor.startDrawing('Pin');
        click(editor, 100, 100);
        const id = editor.selectedId!;
        const resize = editor.overlay().handles.find((h) => h.kind === 'resize')!;
        expect(px(resize.lonLat)).toEqual([114, 114]);
        drag(editor, [114, 114], [128, 128]);
        expect(collection.get(id)!.properties.toy.scale).toBe(2);
        expect(editor.cursor()).toBe('');
    });

    it('colors each handle kind from the chrome', () => {
        const {editor} = setup();
        editor.startDrawing('Pin');
        click(editor, 100, 100);
        const fills = editorOverlay(editor, RES).handles.map((h) => h.fill);
        expect(fills).toEqual(expect.arrayContaining(['red', 'blue', 'lime']));
    });
});

describe('options', () => {
    it('readOnly selects but never changes, and shows no handles', () => {
        const {collection, editor} = setup();
        const id = fence(editor, [[0, 0], [100, 0]]);
        editor.select(null);
        editor.setOptions({readOnly: true});
        drag(editor, [50, 0], [50, 50]);
        expect(editor.selectedId).toBe(id);
        expect(px(drawnPoints(collection.get(id)!)[0])).toEqual([0, 0]);
        expect(editor.overlay().handles).toEqual([]);
        expect(editor.deleteSelected()).toBe(false);
        editor.startDrawing('Fence');
        expect(editor.drawing).toBeNull();
    });

    it('allow forbids one action and leaves the others', () => {
        const {collection, editor} = setup({allow: {delete: false, reshape: false}});
        const id = fence(editor, [[0, 0], [100, 0]]);
        expect(editor.overlay().handles.filter((h) => h.kind === 'vertex' || h.kind === 'insert')).toEqual([]);
        expect(editor.deleteSelected()).toBe(false);
        drag(editor, [50, 0], [50, 20]);
        expect(px(drawnPoints(collection.get(id)!)[0])).toEqual([0, 20]);
    });

    it('beforeChange refuses a drag step, and the graphic stays where it was last allowed', () => {
        const seen: EditorChange<ToyFeature>[] = [];
        // Nothing may go below y = 50 on screen.
        const {collection, editor} = setup({
            beforeChange: (c) => {
                seen.push(c);
                return !c.after || drawnPoints(c.after).every((p) => view.toPixel(p as [number, number])[1] <= 50);
            },
        });
        const id = fence(editor, [[0, 0], [100, 0]]);
        expect(seen[0]).toMatchObject({action: 'draw', id: null, before: null});
        editor.pointerDown(at(25, 0));
        editor.pointerMove(at(25, 40));
        editor.pointerMove(at(25, 90));
        editor.pointerUp(at(25, 90));
        expect(px(drawnPoints(collection.get(id)!)[0])).toEqual([0, 40]);
        expect(seen.map((c) => c.action)).toContain('move');
    });

    it('beforeChange refusing a new graphic reports it and draws nothing', () => {
        const reasons: string[] = [];
        const {collection, editor} = setup({beforeChange: (c) => c.action !== 'draw'});
        editor.subscribe((e) => e.type === 'rejected' && reasons.push(e.reason));
        expect(fence(editor, [[0, 0], [100, 0]])).toBeNull();
        expect(collection.list()).toHaveLength(0);
        expect(reasons).toEqual(['refused']);
    });

    it('snaps a drawn point onto another graphic\'s point within snapPx', () => {
        const {collection, editor} = setup({snapPx: 10});
        const a = fence(editor, [[0, 0], [100, 0]]);
        const b = fence(editor, [[106, 4], [200, 50]]);
        expect(drawnPoints(collection.get(b)!)[0]).toEqual(drawnPoints(collection.get(a)!)[1]);
        const c = fence(editor, [[120, 0], [200, 0]]);
        expect(px(drawnPoints(collection.get(c)!)[0])).toEqual([120, 0]);
    });

    it('snaps a dragged vertex, but never to its own graphic', () => {
        const {collection, editor} = setup({snapPx: 10});
        const a = fence(editor, [[0, 0], [100, 0]]);
        const b = fence(editor, [[0, 100], [50, 100]]);
        drag(editor, [50, 100], [97, 3]);
        expect(drawnPoints(collection.get(b)!)[1]).toEqual(drawnPoints(collection.get(a)!)[1]);
        drag(editor, [100, 0], [3, 97]);
        expect(px(drawnPoints(collection.get(b)!)[1])).toEqual([3, 97]);
    });

    it('keyboard: false leaves every key to the host', () => {
        const {collection, editor} = setup({keyboard: false});
        fence(editor, [[0, 0], [100, 0]]);
        expect(editor.keyDown('Delete')).toBe(false);
        expect(editor.keyDownWith('d', {ctrlKey: true})).toBe(false);
        expect(collection.list()).toHaveLength(1);
    });

    it('handle and hit sizes are the host\'s', () => {
        const {editor} = setup({handleRadiusPx: 12, hitTolerancePx: 2});
        const id = fence(editor, [[0, 0], [100, 0]]);
        editor.select(null);
        expect(editorOverlay(editor, RES).handles).toEqual([]);
        click(editor, 50, 5);
        expect(editor.selectedId).toBeNull();
        click(editor, 50, 1);
        expect(editor.selectedId).toBe(id);
        expect(editorOverlay(editor, RES).handles.find((h) => h.radiusPx === 12)).toBeDefined();
        expect(editor.insertHandleRadiusPx).toBe(9);
    });

    it('draws the chrome: a solid guide and the selection width', () => {
        const {editor} = setup();
        fence(editor, [[0, 0], [100, 0]]);
        const o = editorOverlay(editor, RES);
        expect(o.under[0].stroke?.widthPx).toBe(6);
        expect(o.over[0].stroke?.dashPx).toBeUndefined();
    });
});

describe('allowFor: actions per graphic', () => {
    it('hides one graphic’s handles and refuses its actions, leaving the others alone', () => {
        // Pins at x 100 may not turn, resize, move or be deleted; every other pin may.
        const {collection, editor} = setup({allowFor: (f, action) => !(px(drawnPoints(f)[0])[0] === 100 && ['rotate', 'resize', 'delete', 'move', 'reshape'].includes(action))});
        editor.startDrawing('Pin');
        click(editor, 100, 100);
        const locked = editor.selectedId!;
        expect(editor.overlay().handles).toEqual([]);
        expect(editor.deleteSelected()).toBe(false);
        expect(editor.nudgeSelected(5, 0)).toBe(false);
        drag(editor, [100, 100], [150, 150]);
        expect(px(drawnPoints(collection.get(locked)!)[0])).toEqual([100, 100]);
        editor.startDrawing('Pin');
        click(editor, 300, 100);
        expect(editor.overlay().handles.map((h) => h.kind).sort()).toEqual(['resize', 'rotate', 'vertex']);
        expect(editor.deleteSelected()).toBe(true);
    });
});

describe('handle looks', () => {
    const looks = (handles: NonNullable<ReturnType<NonNullable<EditorFamily<'toy', ToyProps>['chrome']>>['handles']>) => ({
        ...family,
        chrome: () => ({...family.chrome!(), handles}),
    });

    it('draws each kind of handle as the family says: shapes, a cross on the anchor, an arrow along the direction', () => {
        const collection = new SymbolCollection(schema);
        const editor = new SymbolInteraction(looks({anchor: {cross: true, fill: 'rgba(0,0,0,0)', radiusPx: 12}, rotate: {shape: 'arrow'}, resize: {shape: 'square', fill: 'navy'}}), collection, view);
        editor.startDrawing('Pin');
        click(editor, 100, 100);
        drag(editor, [100, 70], [130, 100]);
        const handles = editorOverlay(editor, RES).handles;
        const anchor = handles.find((h) => h.cross)!;
        expect(anchor).toMatchObject({radiusPx: 12, fill: 'rgba(0,0,0,0)', stroke: 'white', cross: 'white'});
        expect(handles.find((h) => h.shape === 'arrow')).toMatchObject({fill: 'red', rotation: 90});
        expect(handles.find((h) => h.shape === 'square')).toMatchObject({fill: 'navy'});
    });

    it('picks a handle drawn larger over all of it', () => {
        const collection = new SymbolCollection(schema);
        const editor = new SymbolInteraction(looks({rotate: {radiusPx: 20}}), collection, view);
        editor.startDrawing('Pin');
        click(editor, 100, 100);
        // The rotate handle is at (100, 70): 18 px to its right is outside the default 9 but inside 22.
        drag(editor, [118, 70], [130, 100]);
        expect(collection.get(editor.selectedId!)!.properties.toy.angle).toBe(90);
    });

    it('leaves handles as they were with no looks', () => {
        const {editor} = setup();
        editor.startDrawing('Pin');
        click(editor, 100, 100);
        for (const h of editorOverlay(editor, RES).handles) expect(Object.keys(h).sort()).toEqual(['fill', 'lonLat', 'radiusPx', 'stroke']);
    });
});
