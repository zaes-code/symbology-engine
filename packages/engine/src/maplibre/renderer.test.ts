import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {Paint} from '../paint';
import {SymbolMapLibre} from './SymbolMapLibre';

// Point images need a canvas, which Node has not: a stand-in that MapLibre's addImage accepts.
vi.mock('../paintsImage.js', () => ({
    drawPaintsImage: () => ({canvas: {width: 4, height: 4, getContext: () => ({getImageData: () => ({})})}, anchorPx: [2, 2], widthPx: 4, heightPx: 4}),
}));

/** Just enough of a MapLibre map to install layers and record what each source is sent. */
function fakeMap() {
    const handlers = new Map<string, ((...a: unknown[]) => void)[]>();
    const sent = new Map<string, number>();
    const updated: unknown[] = [];
    const sources = new Map<string, {setData: (d: unknown) => void; updateData: (d: unknown) => Promise<void>}>();
    const layers = new Map<string, {id: string; source?: string; layout?: Record<string, unknown>}>();
    const layoutChanges: string[] = [];
    let zoom = 10;
    let pitch = 0;
    const map = {
        on: (e: string, f: (...a: unknown[]) => void) => handlers.set(e, [...(handlers.get(e) ?? []), f]),
        off: () => {},
        isStyleLoaded: () => true,
        getZoom: () => zoom,
        getPitch: () => pitch,
        getLayoutProperty: (id: string, name: string) => layers.get(id)?.layout?.[name],
        setLayoutProperty: (id: string, name: string, value: unknown) => {
            const l = layers.get(id)!;
            l.layout = {...l.layout, [name]: value};
            layoutChanges.push(`${id} ${name} ${String(value)}`);
        },
        getSource: (id: string) => sources.get(id),
        addSource: (id: string) =>
            sources.set(id, {
                setData: () => sent.set(id, (sent.get(id) ?? 0) + 1),
                updateData: async (d: unknown) => void updated.push(d),
            }),
        getLayer: (id: string) => layers.get(id),
        addLayer: (l: {id: string}) => layers.set(l.id, l),
        hasImage: () => false,
        addImage: () => {},
        removeImage: () => {},
        getCanvas: () => ({style: {}}),
        getContainer: () => ({addEventListener: () => {}, removeEventListener: () => {}}),
        project: () => ({x: 0, y: 0}),
        unproject: () => ({lng: 0, lat: 0}),
        getCenter: () => ({lng: 0, lat: 0}),
    };
    return {
        map,
        sent,
        updated,
        layers,
        layoutChanges,
        pitchTo(p: number) {
            pitch = p;
            for (const f of handlers.get('pitch') ?? []) f();
        },
        zoomTo(z: number) {
            zoom = z;
            for (const f of handlers.get('zoom') ?? []) f();
        },
    };
}

const line: Paint = {role: 'line', geometry: {type: 'LineString', coordinates: [[0, 0], [1000, 0]]}, stroke: {color: 'red', widthPx: 2}};

describe('the MapLibre renderer', () => {
    beforeEach(() => {
        vi.stubGlobal('requestAnimationFrame', (f: () => void) => setTimeout(f, 0));
        vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
    });
    afterEach(() => vi.unstubAllGlobals());

    it('draws point symbols from a source of their own, in source order, with no per-symbol sort key', () => {
        const {map, layers} = fakeMap();
        const collection = {list: () => [], get: () => undefined, subscribe: () => () => {}};
        new SymbolMapLibre(map as never, collection, {paint: () => [], outline: () => []}, {pointImages: {pointOf: () => null}});
        const point = layers.get('symbol-point')!;
        expect(point.source).toBe('symbol-points');
        expect(point.layout?.['symbol-z-order']).toBe('source');
        expect(point.layout).not.toHaveProperty('symbol-sort-key');
        expect(layers.get('symbol-leader')!.source).toBe('symbol-points');
    });

    it('aligns point images to the viewport untilted, so MapLibre draws them pixel for pixel, and to the map tilted', () => {
        const {map, layers, layoutChanges, pitchTo} = fakeMap();
        const collection = {list: () => [], get: () => undefined, subscribe: () => () => {}};
        new SymbolMapLibre(map as never, collection, {paint: () => [], outline: () => []}, {pointImages: {pointOf: () => null}});
        const alignment = () => layers.get('symbol-point')!.layout?.['icon-pitch-alignment'];
        expect(alignment()).toBe('viewport');
        expect(layers.get('symbol-point')!.layout?.['icon-rotation-alignment']).toBe('map');
        pitchTo(10);
        expect(alignment()).toBe('map');
        // Only a crossing of zero changes the layout (each change reloads the source).
        pitchTo(45);
        pitchTo(60);
        pitchTo(0);
        expect(alignment()).toBe('viewport');
        expect(layoutChanges).toEqual(['symbol-point icon-pitch-alignment map', 'symbol-point icon-pitch-alignment viewport']);
    });

    it('sends the point symbols again on a change to the collection, never on a zoom', async () => {
        const {map, sent, zoomTo} = fakeMap();
        let listener: (c: unknown) => void = () => {};
        const collection = {list: () => [{id: 'a'}], get: () => undefined, subscribe: (l: (c: unknown) => void) => ((listener = l), () => {})};
        new SymbolMapLibre(map as never, collection as never, {paint: () => [line], outline: () => []});
        const before = {graphics: sent.get('symbol-graphics') ?? 0, points: sent.get('symbol-points') ?? 0};
        zoomTo(11);
        await new Promise((r) => setTimeout(r, 5));
        expect(sent.get('symbol-graphics')).toBe(before.graphics + 1);
        expect(sent.get('symbol-points') ?? 0).toBe(before.points);
        listener({type: 'add', id: 'b'});
        await new Promise((r) => setTimeout(r, 5));
        expect(sent.get('symbol-points')).toBe(before.points + 1);
    });

    it('sends a moved point symbol alone, through updateData, and leaves the marks alone', async () => {
        const {map, sent, updated} = fakeMap();
        let listener: (c: unknown) => void = () => {};
        const graphics = [
            {id: 'a', at: [1, 1]},
            {id: 'b', at: [2, 2]},
        ];
        const collection = {list: () => graphics, get: (id: string) => graphics.find((g) => g.id === id), subscribe: (l: (c: unknown) => void) => ((listener = l), () => {})};
        new SymbolMapLibre(map as never, collection as never, {paint: () => [line], outline: () => []}, {pointImages: {pointOf: (g: {at: number[]}) => g.at, imageKey: () => 'same'}});
        await new Promise((r) => setTimeout(r, 5));
        const before = {graphics: sent.get('symbol-graphics') ?? 0, points: sent.get('symbol-points') ?? 0};
        graphics[1].at = [3, 3];
        listener({type: 'update', id: 'b'});
        await new Promise((r) => setTimeout(r, 5));
        expect(sent.get('symbol-points') ?? 0).toBe(before.points);
        expect(sent.get('symbol-graphics') ?? 0).toBe(before.graphics);
        expect(updated).toEqual([{add: [], remove: [], update: [expect.objectContaining({id: 2, newGeometry: {type: 'Point', coordinates: [3, 3]}})]}]);
    });

    it('sends a move as its position alone, a new look with the properties that changed, and keeps the stacking order', async () => {
        const {map, updated} = fakeMap();
        let listener: (c: unknown) => void = () => {};
        const graphics = [
            {id: 'a', at: [1, 1], look: 'x'},
            {id: 'b', at: [2, 2], look: 'x'},
        ];
        const collection = {list: () => graphics, get: (id: string) => graphics.find((g) => g.id === id), subscribe: (l: (c: unknown) => void) => ((listener = l), () => {})};
        new SymbolMapLibre(map as never, collection as never, {paint: () => [line], outline: () => []}, {pointImages: {pointOf: (g: {at: number[]; look: string}) => g.at, imageKey: (g: {at: number[]; look: string}) => g.look}});
        await new Promise((r) => setTimeout(r, 5));
        graphics[1].at = [3, 3];
        listener({type: 'update', id: 'b'});
        await new Promise((r) => setTimeout(r, 5));
        expect(updated.at(-1)).toEqual({add: [], remove: [], update: [{id: 2, newGeometry: {type: 'Point', coordinates: [3, 3]}}]});
        graphics[1].look = 'y';
        listener({type: 'update', id: 'b'});
        await new Promise((r) => setTimeout(r, 5));
        const changed = (updated.at(-1) as {update: {addOrUpdateProperties?: {key: string; value: unknown}[]}[]}).update[0]!.addOrUpdateProperties;
        expect(changed?.map((p) => p.key)).toEqual(['image']);
        expect(String(changed?.[0]!.value)).toContain('y');
    });
});
