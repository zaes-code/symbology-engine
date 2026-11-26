# @zaes/symbology-editor

Drawing, editing and undo/redo for symbol families on
[`@zaes/symbology-engine`](https://www.npmjs.com/package/@zaes/symbology-engine). The editor works
on any renderer that implements the engine's `MapHost`.

```bash
npm install @zaes/symbology-editor
```

```ts
import {SymbolHistory, SymbolInteraction, attachEditor} from '@zaes/symbology-editor';

const editor = new SymbolInteraction(family, collection, renderer.view); // your family's EditorFamily
const detach = attachEditor(renderer, editor);

const history = new SymbolHistory(collection);
editor.subscribe((e) => e.type === 'commit' && history.checkpoint());

editor.startDrawing(name); // a name your family's schema knows
```

Click to place points and double-click or press Enter to finish. Drag handles to reshape, drag a
graphic to move it, and use the arrow keys to nudge it. Delete removes the selected graphic, and
Ctrl/Cmd+D duplicates it.

## License

MIT
