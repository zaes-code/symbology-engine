/**
 * # Editing across the antimeridian
 *
 * On a view centered on the antimeridian, a click east of it comes back folded (-179.99, as
 * OpenLayers' `toLonLat` and MapLibre's `unproject` give it) while the point before it is 179.99.
 * Every gesture must still treat the two as neighbours: a "+" handle between them, a drag that
 * carries a graphic across, an area that crosses without being called self-crossing.
 */

import type {Position} from 'geojson';
import {SymbolCollection, drawnPoints, fromMercator, toMercator, wrapLongitude, type CollectionSchema, type Pixel, type SymbolFeature, type ViewAdapter} from '@zaes/symbology-engine';
import {editorOverlay} from './attach';
import type {EditorFamily} from './family';
import {SymbolInteraction} from './interaction';

type Name = 'Line' | 'Area' | 'Arrow';
interface Props {
    name: Name;
    heading?: number;
}
const KINDS = {Line: 'line', Area: 'area', Arrow: 'point'} as const;
const schema: CollectionSchema<'toy', Props> = {
    key: 'toy',
    idPrefix: 'toy',
    label: 'Toy',
    isName: (n): n is Name => typeof n === 'string' && n in KINDS,
    geometryOf: (n) => KINDS[n],
    displayName: (n) => n,
    clean: (raw) => raw,
};
const family: EditorFamily<'toy', Props> = {
    schema,
    painter: {paint: () => [], outline: (f: SymbolFeature<'toy', Props>) => {
        const m = drawnPoints(f).map(toMercator);
        return f.geometry.type === 'Polygon' ? [...m, m[0]] : m;
    }},
    direction: (n) => (n === 'Arrow' ? {get: (p) => p.heading, set: (d) => ({heading: d}), tip: (a) => [a[0], a[1] + 1000]} : undefined),
};

/** 100 m per pixel, centered on the antimeridian at 10°N; lon/lat out folded, like a real map. */
const RES = 100;
const CENTER = toMercator([180, 10]);
const view: ViewAdapter = {
    toPixel: (ll) => {
        const m = toMercator([180 + wrapLongitude(ll[0] - 180), ll[1]]);
        return [(m[0] - CENTER[0]) / RES, -(m[1] - CENTER[1]) / RES];
    },
    toLonLat: (px) => {
        const ll = fromMercator([CENTER[0] + px[0] * RES, CENTER[1] - px[1] * RES]);
        return [wrapLongitude(ll[0]), ll[1]];
    },
};
const at = (x: number, y: number) => ({pixel: [x, y] as Pixel});
const click = (e: SymbolInteraction<'toy', Props>, x: number, y: number) => (e.pointerDown(at(x, y)), e.pointerUp(at(x, y)));
const setup = () => {
    const collection = new SymbolCollection(schema);
    return {collection, editor: new SymbolInteraction(family, collection, view)};
};
const round = (v: number) => Math.round(v) + 0;
const pixelsOf = (points: Position[]) => points.map((p) => view.toPixel(p).map(round));

describe('editing across the antimeridian', () => {
    it('draws a line across, with its "+" handle between the two points', () => {
        const {collection, editor} = setup();
        editor.startDrawing('Line');
        click(editor, -100, 0);
        click(editor, 100, 0);
        const id = editor.finishDrawing()!;
        expect(pixelsOf(drawnPoints(collection.get(id)!))).toEqual([[-100, 0], [100, 0]]);
        const insert = editor.overlay().handles.find((h) => h.kind === 'insert')!;
        expect(view.toPixel(insert.lonLat).map(round)).toEqual([0, 0]);
    });

    it('draws the construction guide across, not around the world', () => {
        const {editor} = setup();
        editor.startDrawing('Line');
        click(editor, -100, 0);
        editor.pointerMove(at(100, 0));
        // The guide is the dashed construction line among the overlay's marks, in meters.
        const guide = editorOverlay(editor, RES).over.find((p) => p.stroke?.dashPx && p.geometry.type === 'LineString')!;
        const [a, b] = guide.geometry.coordinates as number[][];
        expect(Math.abs(b[0] - a[0]) / RES).toBeLessThan(250);
    });

    it('finishes an area across without calling it self-crossing', () => {
        const {collection, editor} = setup();
        const rejected: string[] = [];
        editor.subscribe((e) => e.type === 'rejected' && rejected.push(e.reason));
        editor.startDrawing('Area');
        for (const [x, y] of [[-100, -100], [100, -100], [100, 100], [-100, 100]]) click(editor, x, y);
        expect(editor.finishDrawing()).not.toBeNull();
        expect(rejected).toEqual([]);
        expect(collection.size).toBe(1);
    });

    it('drags a graphic across without it jumping a world', () => {
        const {collection, editor} = setup();
        editor.startDrawing('Line');
        click(editor, -300, 0);
        click(editor, -200, 0);
        const id = editor.finishDrawing()!;
        editor.select(null);
        editor.pointerDown(at(-250, 0));
        editor.pointerMove(at(250, 0));
        editor.pointerUp(at(250, 0));
        expect(pixelsOf(drawnPoints(collection.get(id)!))).toEqual([[200, 0], [300, 0]]);
    });

    it('nudges and duplicates across', () => {
        const {collection, editor} = setup();
        editor.startDrawing('Line');
        click(editor, -20, 0);
        click(editor, -5, 0);
        const id = editor.finishDrawing()!;
        editor.nudgeSelected(10, 0);
        expect(pixelsOf(drawnPoints(collection.get(id)!))).toEqual([[-10, 0], [5, 0]]);
        const copy = editor.duplicateSelected(16)!;
        expect(pixelsOf(drawnPoints(collection.get(copy)!))).toEqual([[6, 16], [21, 16]]);
    });

    it('aims a directional point across', () => {
        const {collection, editor} = setup();
        editor.startDrawing('Arrow');
        click(editor, -5, 0);
        click(editor, 50, 0);
        expect(collection.list()[0].properties.toy.heading).toBe(90);
    });
});
