import {SymbolCollection, drawnPoints, fromMercator, toMercator, type CollectionSchema, type Paint, type Pixel, type SymbolFeature, type ViewAdapter} from '@zaes/symbology-engine';
import {editorOverlay} from './attach';
import type {EditorFamily} from './family';
import {SymbolHistory} from './history';
import {SymbolInteraction} from './interaction';

// A made-up family, so a METOC assumption in the editor shows up here.
type ToyName = 'Pin' | 'Arrow' | 'Fence' | 'Zone';
interface ToyProps {
    name: ToyName;
    heading?: number;
    solid?: boolean;
}
type ToyFeature = SymbolFeature<'toy', ToyProps>;
const KINDS = {Pin: 'point', Arrow: 'point', Fence: 'line', Zone: 'area'} as const;
const schema: CollectionSchema<'toy', ToyProps> = {
    key: 'toy',
    idPrefix: 'toy',
    label: 'Toy',
    isName: (n): n is ToyName => typeof n === 'string' && n in KINDS,
    geometryOf: (n) => KINDS[n],
    displayName: (n) => n,
    clean: (raw) => ({name: raw.name, ...(raw.heading !== undefined ? {heading: raw.heading} : {}), ...(raw.solid ? {solid: true} : {})}),
};
const painted: string[] = [];
const family: EditorFamily<'toy', ToyProps> = {
    schema,
    painter: {
        paint: (f: ToyFeature): Paint[] => {
            painted.push(f.properties.toy.name);
            return [{role: 'line', geometry: {type: 'LineString', coordinates: drawnPoints(f).map(toMercator)}, stroke: {color: 'black', widthPx: 1}}];
        },
        outline: (f: ToyFeature) => {
            const pts = drawnPoints(f).map(toMercator);
            return f.geometry.type === 'Polygon' ? [...pts, pts[0]] : pts;
        },
    },
    // The arrow keeps its direction in `heading`; its handle is 50 px out along it.
    direction: (name) =>
        name === 'Arrow'
            ? {
                  get: (p) => p.heading,
                  set: (d) => ({heading: d}),
                  tip: (a, d, res) => [a[0] + Math.sin((d * Math.PI) / 180) * 50 * res, a[1] + Math.cos((d * Math.PI) / 180) * 50 * res],
              }
            : undefined,
    pickInside: (p) => p.solid === true,
    chrome: () => ({handleColor: 'lime', selectionColor: 'pink', lineWidth: 3}),
};

const RES = 1000;
const view: ViewAdapter = {
    toPixel: (ll) => {
        const m = toMercator(ll);
        return [m[0] / RES, -m[1] / RES];
    },
    toLonLat: (px) => fromMercator([px[0] * RES, -px[1] * RES]),
};
const at = (x: number, y: number) => ({pixel: [x, y] as Pixel});
function setup() {
    const collection = new SymbolCollection(schema);
    return {collection, editor: new SymbolInteraction(family, collection, view)};
}
const click = (editor: SymbolInteraction<'toy', ToyProps>, x: number, y: number) => {
    editor.pointerDown(at(x, y));
    editor.pointerUp(at(x, y));
};

describe('SymbolInteraction with a family it has never heard of', () => {
    it('draws an area under the family key, and refuses one that crosses itself', () => {
        const {collection, editor} = setup();
        const reasons: string[] = [];
        editor.subscribe((e) => e.type === 'rejected' && reasons.push(e.reason));
        editor.startDrawing('Zone', {solid: true});
        for (const [x, y] of [[0, 0], [100, 100], [100, 0], [0, 100]]) click(editor, x, y);
        expect(editor.finishDrawing()).toBeNull();
        expect(reasons).toHaveLength(1);
        editor.keyDown('Backspace');
        editor.keyDown('Backspace');
        click(editor, 0, 100);
        const id = editor.finishDrawing()!;
        expect(collection.get(id)!.properties).toEqual({toy: {name: 'Zone', solid: true}});
        expect(collection.get(id)!.geometry.type).toBe('Polygon');
    });

    it('finishes a plain point on one click, and a directional one on two, setting its direction', () => {
        const {collection, editor} = setup();
        editor.startDrawing('Pin');
        click(editor, 10, 10);
        expect(collection.size).toBe(1);
        editor.startDrawing('Arrow');
        click(editor, 200, 200);
        expect(collection.size).toBe(1);
        click(editor, 300, 200);
        expect(collection.size).toBe(2);
        expect(collection.list()[1].properties.toy).toEqual({name: 'Arrow', heading: 90});
    });

    it('picks a point symbol standing on a leader line where it is drawn, up the screen', () => {
        const collection = new SymbolCollection(schema);
        const lifted: ViewAdapter = {...view, pointLiftPx: () => 48};
        const editor = new SymbolInteraction(family, collection, lifted);
        editor.startDrawing('Pin');
        click(editor, 100, 100);
        editor.select(null);
        // The symbol's center is 48 px up from its location; its location alone no longer picks it from afar.
        click(editor, 100, 52);
        expect(editor.selectedId).toBe(collection.list()[0].id);
        editor.select(null);
        click(editor, 100, 120);
        expect(editor.selectedId).toBeNull();
        // The dot on its location still picks it.
        click(editor, 100, 100);
        expect(editor.selectedId).toBe(collection.list()[0].id);
    });

    it('picks a symbol on a leader line anywhere in its box, a headquarters frame high above its anchor', () => {
        const above: EditorFamily<'toy', ToyProps> = {...family, painter: {...family.painter, pickBox: () => ({x: -30, y: -90, width: 60, height: 50})}};
        const collection = new SymbolCollection(schema);
        const editor = new SymbolInteraction(above, collection, {...view, pointLiftPx: () => 48});
        editor.startDrawing('Pin');
        click(editor, 100, 100);
        editor.select(null);
        // Drawn 48 px up: the box runs y 100-48-90 = -38 to 12, x 70 to 130.
        click(editor, 125, -30);
        expect(editor.selectedId).toBe(collection.list()[0].id);
        editor.select(null);
        click(editor, 100, 40);
        expect(editor.selectedId).toBeNull();
        click(editor, 100, 100);
        expect(editor.selectedId).toBe(collection.list()[0].id);
    });

    it('drags a symbol on a leader line so its location stays under the cursor, however the ground stretches', () => {
        // A tilted view: the ground per pixel grows up the screen, as toward a 3D map's horizon.
        const k = 50;
        const tilted: ViewAdapter = {
            toPixel: (ll) => {
                const m = toMercator(ll);
                return [m[0] / RES, k * Math.log(-m[1] / RES / k + 1)];
            },
            toLonLat: (px) => fromMercator([px[0] * RES, -k * (Math.exp(px[1] / k) - 1) * RES]),
            pointLiftPx: () => 48,
        };
        const collection = new SymbolCollection(schema);
        const editor = new SymbolInteraction(family, collection, tilted);
        editor.startDrawing('Pin');
        click(editor, 100, 100);
        const id = collection.list()[0].id as string;
        editor.select(null);
        // Pressed on the symbol, 48 px up its leader line, and moved 30 px right and 10 px down.
        editor.pointerDown(at(100, 52));
        editor.pointerMove(at(130, 62));
        editor.pointerUp(at(130, 62));
        const [x, y] = tilted.toPixel(collection.get(id)!.geometry.coordinates as [number, number]);
        expect(x).toBeCloseTo(130, 6);
        expect(y).toBeCloseTo(110, 6);
    });

    it('picks a point symbol anywhere in the box its painter says it is drawn in, away from its anchor', () => {
        // A symbol drawn above its anchor, as a headquarters stands on a staff whose foot is the anchor.
        const above: EditorFamily<'toy', ToyProps> = {...family, painter: {...family.painter, pickBox: () => ({x: -30, y: -90, width: 60, height: 50})}};
        const collection = new SymbolCollection(schema);
        const editor = new SymbolInteraction(above, collection, view);
        editor.startDrawing('Pin');
        click(editor, 100, 100);
        editor.select(null);
        // The frame, 60 px above the anchor, picks it; a click beside the box does not.
        click(editor, 120, 40);
        expect(editor.selectedId).toBe(collection.list()[0].id);
        editor.select(null);
        click(editor, 150, 40);
        expect(editor.selectedId).toBeNull();
    });

    it('places a handle by the scale at the symbol, not by the ground beside it on the screen', () => {
        // A ridge just right of x = 200: the ground under the pixels past it lies far behind.
        const ridge: ViewAdapter = {
            toPixel: view.toPixel,
            toLonLat: (px) => (px[0] > 200.5 ? view.toLonLat([px[0] + 5000, px[1]]) : view.toLonLat(px)),
        };
        const collection = new SymbolCollection(schema);
        const editor = new SymbolInteraction(family, collection, ridge);
        editor.startDrawing('Arrow');
        click(editor, 200, 200);
        click(editor, 300, 200);
        const rotate = editor.overlay().handles.find((h) => h.kind === 'rotate')!;
        expect(view.toPixel(rotate.lonLat).map(Math.round)).toEqual([250, 200]);
    });

    it('rotates a selected directional point by its handle, where the family puts it', () => {
        const {collection, editor} = setup();
        editor.startDrawing('Arrow');
        click(editor, 200, 200);
        click(editor, 200, 100);
        const id = collection.list()[0].id as string;
        expect(collection.get(id)!.properties.toy.heading).toBe(0);
        const rotate = editor.overlay().handles.find((h) => h.kind === 'rotate')!;
        expect(view.toPixel(rotate.lonLat).map(Math.round)).toEqual([200, 150]);
        editor.pointerDown(at(200, 150));
        editor.pointerMove(at(250, 200));
        editor.pointerUp(at(250, 200));
        expect(collection.get(id)!.properties.toy.heading).toBe(90);
    });

    it('picks inside only the areas the family says, and otherwise by the outline', () => {
        const {collection, editor} = setup();
        for (const solid of [false, true]) {
            editor.startDrawing('Zone', {solid});
            const x0 = solid ? 400 : 0;
            for (const [x, y] of [[x0, 0], [x0 + 100, 0], [x0 + 100, 100], [x0, 100]]) click(editor, x, y);
            editor.finishDrawing();
        }
        const [hollow, solid] = collection.list().map((f) => f.id as string);
        editor.select(null);
        expect(editor.isOverGraphic([50, 50])).toBe(false);
        expect(editor.isOverGraphic([50, 1])).toBe(true);
        expect(editor.isOverGraphic([450, 50])).toBe(true);
        editor.pointerDown(at(450, 50));
        expect(editor.selectedId).toBe(solid);
        editor.pointerUp(at(450, 50));
        expect(hollow).not.toBe(solid);
    });

    it('paints the draft with the family painter, in the family chrome', () => {
        const {editor} = setup();
        painted.length = 0;
        editor.startDrawing('Fence');
        click(editor, 0, 0);
        editor.pointerMove(at(100, 0));
        const overlay = editorOverlay(editor, RES);
        expect(painted).toEqual(['Fence']);
        expect(overlay.over.some((p) => p.stroke?.color === 'lime' && p.stroke.dashPx)).toBe(true);
        expect(overlay.handles[0]).toMatchObject({fill: 'lime'});
    });

    it('undoes and redoes through the family store', () => {
        const {collection, editor} = setup();
        const history = new SymbolHistory(collection);
        editor.subscribe((e) => e.type === 'commit' && history.checkpoint());
        editor.startDrawing('Pin');
        click(editor, 10, 10);
        expect(collection.size).toBe(1);
        history.undo();
        expect(collection.size).toBe(0);
        history.redo();
        expect(collection.list()[0].properties.toy.name).toBe('Pin');
    });
});

describe('a point drawn away from its location (drawnOffset)', () => {
    // Pins whose name says nothing: a `solid` pin is drawn 40 px right and 20 px down of its location, with a
    // 20 px box round where it is drawn; the others are drawn on their location.
    const offsetFamily: EditorFamily<'toy', ToyProps> = {
        ...family,
        painter: {
            ...family.painter,
            pickBox: () => ({x: -10, y: -10, width: 20, height: 20}),
            drawnOffset: (f: ToyFeature) => (f.properties.toy.solid ? {x: 40, y: 20} : null),
        },
    };
    const pin = (collection: SymbolCollection<'toy', ToyProps>, solid: boolean) =>
        collection.add({type: 'Feature', geometry: {type: 'Point', coordinates: view.toLonLat([100, 100])}, properties: {toy: {name: 'Pin', ...(solid ? {solid: true} : {})}}});

    it('is picked where it is drawn, its location handle over it as a reticle', () => {
        const collection = new SymbolCollection(schema);
        const editor = new SymbolInteraction(offsetFamily, collection, view);
        const id = pin(collection, true);
        click(editor, 100, 100);
        expect(editor.selectedId).toBeNull();
        click(editor, 140, 120);
        expect(editor.selectedId).toBe(id);
        const handle = editor.overlay().handles.find((h) => h.anchor)!;
        expect(handle.centered).toBe(true);
        expect(view.toPixel(handle.lonLat).map(Math.round)).toEqual([140, 120]);
        const look = editorOverlay(editor, RES).handles.find((h) => h.cross);
        expect(look?.radiusPx).toBe(11);
    });

    it('measures its direction from where it is drawn', () => {
        const collection = new SymbolCollection(schema);
        const editor = new SymbolInteraction(offsetFamily, collection, view);
        const id = collection.add({type: 'Feature', geometry: {type: 'Point', coordinates: view.toLonLat([100, 100])}, properties: {toy: {name: 'Arrow', heading: 90, solid: true}}});
        editor.select(id);
        // The arrow's handle is 50 px along its heading (east) from where it is drawn (140, 120), not its location.
        const rotate = editor.overlay().handles.find((h) => h.kind === 'rotate')!;
        expect(view.toPixel(rotate.lonLat).map(Math.round)).toEqual([190, 120]);
    });

    it('stays under the cursor when dragged', () => {
        const collection = new SymbolCollection(schema);
        const editor = new SymbolInteraction(offsetFamily, collection, view);
        const id = pin(collection, true);
        editor.pointerDown(at(145, 125));
        editor.pointerMove(at(195, 175));
        editor.pointerUp(at(195, 175));
        // The location goes where the symbol was drawn, moved with the cursor: the painter here still draws
        // it 40, 20 away, as a unit still in its group would be.
        expect(view.toPixel(drawnPoints(collection.get(id)!)[0]).map(Math.round)).toEqual([190, 170]);
    });

    it("on leader lines picks a location's dot before a line drawn over it", () => {
        const collection = new SymbolCollection(schema);
        const editor = new SymbolInteraction(offsetFamily, collection, {...view, pointLiftPx: () => 48});
        const standing = pin(collection, false);
        // A fence through the dot, on top of the pin.
        collection.add({type: 'Feature', geometry: {type: 'LineString', coordinates: [view.toLonLat([50, 100]), view.toLonLat([150, 100])]}, properties: {toy: {name: 'Fence'}}});
        click(editor, 100, 100);
        expect(editor.selectedId).toBe(standing);
        // Away from the dot, the fence is picked.
        click(editor, 60, 100);
        expect(editor.selectedId).not.toBe(standing);
        expect(editor.selectedId).not.toBeNull();
    });

    it('on leader lines leaves its location dot to the symbol standing there; its handle is up by it, offset', () => {
        const collection = new SymbolCollection(schema);
        const editor = new SymbolInteraction(offsetFamily, collection, {...view, pointLiftPx: () => 48});
        const standing = pin(collection, false);
        const away = pin(collection, true);
        click(editor, 100, 100);
        expect(editor.selectedId).toBe(standing);
        click(editor, 140, 72);
        expect(editor.selectedId).toBe(away);
        // On the location, drawn 40 right and 20 - 48 up, where the symbol is: a reticle, offset on the screen.
        const [handle] = editor.overlay().handles;
        expect(editor.overlay().handles).toHaveLength(1);
        expect(view.toPixel(handle!.lonLat).map(Math.round)).toEqual([100, 100]);
        expect(handle!.offsetPx).toEqual([40, -28]);
        expect(editorOverlay(editor, RES).handles[0]!.offsetPx).toEqual([40, -28]);
        // Pressed, it moves the symbol as a drag of the symbol does: the location goes where the symbol was
        // drawn (its offset, not the lift), moved with the cursor, so a symbol that leaves its group, drawn 48 px
        // up from there, is under the cursor (190, 122).
        editor.pointerDown(at(140, 72));
        editor.pointerMove(at(190, 122));
        editor.pointerUp(at(190, 122));
        expect(view.toPixel(drawnPoints(collection.get(away)!)[0]).map(Math.round)).toEqual([190, 170]);
    });
});
