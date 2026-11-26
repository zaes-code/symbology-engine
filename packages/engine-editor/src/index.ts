/**
 * # @zaes/symbology-editor
 *
 * Drawing and editing for any symbol family on `@zaes/symbology-engine`: the editor
 * ({@link SymbolInteraction}), undo and redo ({@link SymbolHistory}), and {@link attachEditor},
 * which puts it on any renderer that implements the engine's `MapHost`. The gestures are the same
 * for every family; what differs comes from an {@link EditorFamily} — the family's store schema
 * and painter, plus the direction rule for a directional point and which areas pick inside.
 *
 * The engine never imports it: a family binds it in its own editor package.
 *
 * @module @zaes/symbology-editor
 */

export {HANDLE_RADIUS_PX, HIT_TOLERANCE_PX, INSERT_HANDLE_RADIUS_PX, SymbolInteraction} from './interaction.js';
export type {EditMode, EditorAction, EditorChange, EditorListener, EditorOptions, EditorOverlay, HandleMark} from './interaction.js';
export {DEFAULT_EDITOR_CHROME} from './family.js';
export type {DirectionRule, EditorChrome, EditorFamily, HandleLook, HandleRole, SizeRule} from './family.js';
export {attachEditor, editorOverlay} from './attach.js';
export {SymbolHistory} from './history.js';
export type {HistoryListener, Snapshottable} from './history.js';
