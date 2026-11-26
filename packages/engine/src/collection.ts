/**
 * # A set of graphics, and how it is saved
 *
 * The renderers draw from one of these and an editor writes to it, so switching engines, or
 * showing one collection in two views, needs no copying. A change is announced once, after it is
 * made; listeners repaint from the collection, never from the change itself.
 *
 * Saving writes one GeoJSON feature per graphic — the drawn points and the family's properties
 * object (under the schema's key), nothing derived — and loading rebuilds the same graphics,
 * editable. What a family's properties may hold, and which names it knows, is its
 * {@link CollectionSchema}; the store itself is the same for every family.
 */

import type {FeatureCollection, Position} from 'geojson';
import {drawnPoints, geometryForKind, geometryTypeFor, minimumPointsFor, type GeometryKind, type SymbolFeature} from './geometry.js';

export type CollectionChange = {type: 'add' | 'update' | 'remove'; id: string} | {type: 'reset'};
export type CollectionListener = (change: CollectionChange) => void;

/** Why a feature in a file was not loaded. */
export interface SkippedFeature {
    index: number;
    reason: string;
}

/** What a renderer reads a collection through. It never writes. */
export interface FeatureSource<F> {
    get(id: string): F | undefined;
    list(): F[];
    /** Listen for changes. Returns the unsubscribe function. */
    subscribe(listener: CollectionListener): () => void;
}

/** What a family tells the store about its graphics. */
export interface CollectionSchema<K extends string, P extends {name: string}> {
    /** The properties key a graphic's object is saved under: `properties[key]`. */
    readonly key: K;
    /** Prefix for generated ids. */
    readonly idPrefix: string;
    /** The family's name in messages: "unknown weather graphic …". */
    readonly label: string;
    /** True when `name` is a graphic the family knows. Used on anything read from a file. */
    isName(name: unknown): name is P['name'];
    geometryOf(name: P['name']): GeometryKind;
    displayName(name: P['name']): string;
    /** Copy only the fields the schema knows, so nothing a renderer stamped travels on. */
    clean(raw: P): P;
}

let nextId = 1;

const isPosition = (p: unknown): p is Position =>
    Array.isArray(p) && p.length >= 2 && typeof p[0] === 'number' && typeof p[1] === 'number' && isFinite(p[0]) && isFinite(p[1]);

export class SymbolCollection<K extends string, P extends {name: string}> implements FeatureSource<SymbolFeature<K, P>> {
    private readonly features = new Map<string, SymbolFeature<K, P>>();
    private readonly listeners = new Set<CollectionListener>();

    constructor(readonly schema: CollectionSchema<K, P>) {}

    private newId(): string {
        return `${this.schema.idPrefix}-${Date.now().toString(36)}-${(nextId++).toString(36)}`;
    }

    private propsOf(feature: SymbolFeature<K, P>): P {
        return feature.properties[this.schema.key];
    }

    /** A stored graphic: cleaned properties, and the geometry its kind makes from the drawn points. */
    private make(id: string, props: P, points: readonly Position[]): SymbolFeature<K, P> {
        const clean = this.schema.clean(props);
        return {
            type: 'Feature',
            id,
            geometry: geometryForKind(this.schema.geometryOf(clean.name), points),
            properties: {[this.schema.key]: clean} as Record<K, P>,
        };
    }

    /** Add a graphic; returns its id. A feature without one is given one. */
    add(feature: SymbolFeature<K, P>): string {
        const id = feature.id !== undefined && !this.features.has(String(feature.id)) ? String(feature.id) : this.newId();
        this.features.set(id, this.make(id, this.propsOf(feature), drawnPoints(feature)));
        this.emit({type: 'add', id});
        return id;
    }

    get(id: string): SymbolFeature<K, P> | undefined {
        return this.features.get(id);
    }

    has(id: string): boolean {
        return this.features.has(id);
    }

    list(): SymbolFeature<K, P>[] {
        return [...this.features.values()];
    }

    get size(): number {
        return this.features.size;
    }

    /**
     * Replace a graphic's drawn points — a line's points, or an area's ring without its closing
     * point. The geometry is rebuilt to match the graphic, so a caller never closes a ring.
     */
    setPoints(id: string, points: readonly Position[]): void {
        const f = this.features.get(id);
        if (!f) return;
        this.features.set(id, {...f, geometry: geometryForKind(this.schema.geometryOf(this.propsOf(f).name), points)});
        this.emit({type: 'update', id});
    }

    /**
     * Merge properties. A field set to `undefined` is removed, so "no value" stays absent rather
     * than becoming an empty string a reader would treat as filed.
     */
    setProperties(id: string, patch: Partial<Omit<P, 'name'>>): void {
        const f = this.features.get(id);
        if (!f) return;
        const merged = {...this.propsOf(f), ...patch} as P;
        for (const key of Object.keys(patch)) if ((patch as Record<string, unknown>)[key] === undefined) delete (merged as Record<string, unknown>)[key];
        this.features.set(id, {...f, properties: {[this.schema.key]: this.schema.clean(merged)} as Record<K, P>});
        this.emit({type: 'update', id});
    }

    /**
     * Change a graphic's place in the stacking order, which is the list's order: later graphics draw
     * over earlier ones, and a saved file keeps the order. `forward` and `backward` move it one place,
     * `front` and `back` to the end. Renderers redraw the whole stack (a reset).
     */
    move(id: string, to: 'front' | 'back' | 'forward' | 'backward'): void {
        const ids = [...this.features.keys()];
        const i = ids.indexOf(id);
        if (i < 0) return;
        const j = to === 'front' ? ids.length - 1 : to === 'back' ? 0 : to === 'forward' ? Math.min(ids.length - 1, i + 1) : Math.max(0, i - 1);
        if (i === j) return;
        ids.splice(i, 1);
        ids.splice(j, 0, id);
        const all = new Map(this.features);
        this.features.clear();
        for (const k of ids) this.features.set(k, all.get(k)!);
        this.emit({type: 'reset'});
    }

    remove(id: string): void {
        if (this.features.delete(id)) this.emit({type: 'remove', id});
    }

    clear(): void {
        this.features.clear();
        this.emit({type: 'reset'});
    }

    /** Listen for changes. Returns the unsubscribe function. */
    subscribe(listener: CollectionListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /** One GeoJSON feature per graphic: the drawn points and the family's properties object. */
    toGeoJSON(): FeatureCollection {
        return {type: 'FeatureCollection', features: this.list().map((f) => JSON.parse(JSON.stringify(f)))};
    }

    /**
     * Load graphics from GeoJSON. Anything that is not a graphic of this family, with the geometry
     * its kind is saved as and enough valid points, is skipped and reported, never half-loaded.
     * With `replace`, the collection is cleared first.
     */
    load(input: unknown, options: {replace?: boolean} = {}): {loaded: string[]; skipped: SkippedFeature[]} {
        const {key, label} = this.schema;
        const loaded: string[] = [];
        const skipped: SkippedFeature[] = [];
        const isCollection = !!input && typeof input === 'object' && (input as FeatureCollection).type === 'FeatureCollection';
        const features: unknown[] = isCollection ? (input as FeatureCollection).features : Array.isArray(input) ? input : [input];
        if (options.replace) this.features.clear();
        features.forEach((raw, index) => {
            const f = raw as Partial<SymbolFeature<K, P>> | null;
            const props = (f?.properties as Partial<Record<K, P>> | null | undefined)?.[key];
            if (!f || f.type !== 'Feature') return void skipped.push({index, reason: 'not a GeoJSON feature'});
            if (!props || !this.schema.isName(props.name)) return void skipped.push({index, reason: `unknown ${label} graphic ${JSON.stringify(props?.name)}`});
            const kind = this.schema.geometryOf(props.name);
            const want = geometryTypeFor(kind);
            if (f.geometry?.type !== want) return void skipped.push({index, reason: `${this.schema.displayName(props.name)} needs a ${want} geometry`});
            const ring = f.geometry.type === 'Polygon' ? f.geometry.coordinates?.[0] : f.geometry.type === 'Point' ? [f.geometry.coordinates] : f.geometry.coordinates;
            if (!Array.isArray(ring) || !ring.every(isPosition)) return void skipped.push({index, reason: 'has invalid coordinates'});
            const points = drawnPoints(f as SymbolFeature<K, P>);
            const min = minimumPointsFor(kind);
            if (points.length < min) return void skipped.push({index, reason: `needs at least ${min} points`});
            const id = f.id !== undefined && !this.features.has(String(f.id)) ? String(f.id) : this.newId();
            this.features.set(id, this.make(id, props, points));
            loaded.push(id);
        });
        this.emit({type: 'reset'});
        return {loaded, skipped};
    }

    private emit(change: CollectionChange): void {
        for (const l of [...this.listeners]) l(change);
    }
}
