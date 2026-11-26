/**
 * # Undo and redo
 *
 * Snapshots of a collection, taken at *checkpoints* rather than on every change. A
 * drag moves a point dozens of times; the operator thinks of it as one edit, so the host
 * checkpoints when the editor announces a `commit` (the end of a gesture), and after a properties
 * edit settles. A checkpoint that changes nothing records nothing.
 *
 * Snapshots are the saved form — `toGeoJSON()` — so undo restores exactly what a save and load
 * would, ids included, and needs no knowledge of what changed.
 */
export type HistoryListener = () => void;

/** What undo needs of a store: its saved form, and a load that replaces it. */
export interface Snapshottable {
    toGeoJSON(): unknown;
    load(input: unknown, options: {replace?: boolean}): unknown;
}

export class SymbolHistory {
    private past: string[] = [];
    private future: string[] = [];
    private current: string;
    private readonly listeners = new Set<HistoryListener>();

    constructor(
        private readonly collection: Snapshottable,
        /** How many steps back to keep. */
        private readonly limit = 100,
    ) {
        this.current = this.snapshot();
    }

    get canUndo(): boolean {
        return this.past.length > 0;
    }

    get canRedo(): boolean {
        return this.future.length > 0;
    }

    /** Record the collection as it is now. Returns whether anything had changed. */
    checkpoint(): boolean {
        const now = this.snapshot();
        if (now === this.current) return false;
        this.past.push(this.current);
        if (this.past.length > this.limit) this.past.shift();
        this.current = now;
        this.future = [];
        this.emit();
        return true;
    }

    undo(): boolean {
        // Anything changed since the last checkpoint is committed first, so it can be redone.
        this.checkpoint();
        const previous = this.past.pop();
        if (previous === undefined) return false;
        this.future.push(this.current);
        this.restore(previous);
        return true;
    }

    redo(): boolean {
        // An edit not yet checkpointed is committed first: it then clears what could be redone, as any new
        // edit does, rather than being lost when the redone state is restored over it.
        this.checkpoint();
        const next = this.future.pop();
        if (next === undefined) return false;
        this.past.push(this.current);
        this.restore(next);
        return true;
    }

    /** Forget everything before now, as after loading a file the operator does not want to undo into. */
    reset(): void {
        this.past = [];
        this.future = [];
        this.current = this.snapshot();
        this.emit();
    }

    subscribe(listener: HistoryListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private restore(snapshot: string): void {
        this.current = snapshot;
        this.collection.load(JSON.parse(snapshot), {replace: true});
        this.emit();
    }

    private snapshot(): string {
        return JSON.stringify(this.collection.toGeoJSON());
    }

    private emit(): void {
        for (const l of [...this.listeners]) l();
    }
}
