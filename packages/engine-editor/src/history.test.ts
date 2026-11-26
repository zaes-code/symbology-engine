import {expect, it} from 'vitest';
import {SymbolHistory} from './history.js';
import {SymbolCollection} from '@zaes/symbology-engine';
const schema = {key: 'm', idPrefix: 'm', label: 'm', isName: () => true, geometryOf: () => 'point', displayName: (n: string) => n, clean: (p: any) => ({...p})} as any;
it('keeps an edit made after an undo, not yet checkpointed, when redo is asked for', () => {
    const c = new SymbolCollection(schema);
    const h = new SymbolHistory(c);
    c.add({type: 'Feature', id: 'a', geometry: {type: 'Point', coordinates: [1, 1]}, properties: {m: {name: 'A'}}} as any);
    h.checkpoint();
    h.undo();
    c.add({type: 'Feature', id: 'b', geometry: {type: 'Point', coordinates: [2, 2]}, properties: {m: {name: 'B'}}} as any);
    // The edit is committed first: there is nothing left to redo, and b stays.
    expect(h.redo()).toBe(false);
    expect(c.has('b')).toBe(true);
    // Undoing it removes b, and redo brings it back (it was once lost from both).
    h.undo();
    expect(c.has('b')).toBe(false);
    h.redo();
    expect(c.has('b')).toBe(true);
});
