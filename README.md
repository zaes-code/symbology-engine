# ZAES symbology engine

A map-symbology engine for OpenLayers and MapLibre. It draws marks and knows no symbology standard:
a symbol family supplies its catalog, its painter and a few rules, and gets display on both map
libraries and an editor. [`@zaes/metoc`](https://github.com/zaes-code/metoc) and
[`@zaes/military-symbols`](https://github.com/zaes-code/military-symbols) are built on it.

| Package | What it does |
|---|---|
| [`@zaes/symbology-engine`](packages/engine) | Marks, glyphs, the store, the map-host seam, OpenLayers and MapLibre renderers |
| [`@zaes/symbology-editor`](packages/engine-editor) | Drawing, selecting, reshaping, moving and undo on any map host |

Both are on npm:

```bash
npm install @zaes/symbology-engine @zaes/symbology-editor
```

## Building from source

```bash
npm install
npm run check   # typecheck, tests, import boundaries, build
```

## License

MIT
