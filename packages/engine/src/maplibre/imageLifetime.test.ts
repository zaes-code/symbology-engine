import {describe, expect, it, vi} from 'vitest';
import {SymbolMapLibre} from './SymbolMapLibre.js';
import {SymbolCollection} from '../collection.js';

vi.mock('../paintsImage.js', () => ({
    drawPaintsImage: () => ({canvas: {width: 4, height: 4, getContext: () => ({getImageData: () => ({})})}, anchorPx: [2, 2], widthPx: 4, heightPx: 4}),
}));

function fakeMap() {
    const handlers = new Map<string, ((...a: unknown[]) => void)[]>();
    const images = new Set<string>();
    const sources = new Map<string, any>();
    const layers = new Map<string, any>();
    const log: any[] = [];
    const map = {
        on: (e: string, f: any) => handlers.set(e, [...(handlers.get(e) ?? []), f]),
        off: () => {}, once: () => {},
        isStyleLoaded: () => true, getZoom: () => 10, getPitch: () => 0,
        getLayoutProperty: () => undefined, setLayoutProperty: () => {},
        getSource: (id: string) => sources.get(id),
        addSource: (id: string) => sources.set(id, {setData: (d: any) => log.push([id, 'set', d]), updateData: async (d: any) => void log.push([id, 'upd', d])}),
        getLayer: (id: string) => layers.get(id), addLayer: (l: any) => layers.set(l.id, l),
        hasImage: (k: string) => images.has(k), addImage: (k: string) => images.add(k), removeImage: (k: string) => images.delete(k),
        getCanvas: () => ({style: {}}), getContainer: () => ({addEventListener() {}, removeEventListener() {}}),
        project: () => ({x: 0, y: 0}), unproject: () => ({lng: 0, lat: 0}), getCenter: () => ({lng: 0, lat: 0}),
    };
    return {map, images, log};
}
const schema = {key: 'm', idPrefix: 'm', label: 'm', isName: () => true, geometryOf: () => 'point', displayName: (n: string) => n, clean: (p: any) => ({...p})} as any;
const pointOf = (f: any) => f.geometry.coordinates;

describe('MapLibre point images over many updates', () => {
    it('drops the images of looks a symbol no longer has, without waiting for a full paint', () => {
        const {map, images} = fakeMap();
        const c = new SymbolCollection(schema);
        const id = c.add({type: 'Feature', geometry: {type: 'Point', coordinates: [1, 1]}, properties: {m: {name: 'x', dir: 0}}} as any);
        new SymbolMapLibre(map as never, c as never, {paint: () => [], outline: () => []}, {pointImages: {pointOf}});
        for (let d = 1; d <= 50; d++) c.setProperties(id, {dir: d} as any);
        expect(images.size, 'after 50 updates').toBe(1);
        c.add({type: 'Feature', geometry: {type: 'Point', coordinates: [2, 2]}, properties: {m: {name: 'x', dir: 0}}} as any);
        // The new symbol has a look of its own (direction 0): two images, the old looks still gone.
        expect(images.size, 'after add').toBe(2);
    });
});
