# @zaes/symbology-engine

A map-symbology engine. A symbol family supplies its schema and a painter; the engine stores the
graphics as GeoJSON and draws them on OpenLayers or MapLibre, with every decoration sized in screen
pixels and recomputed for each view.

```bash
npm install @zaes/symbology-engine
```

```ts
import {SymbolCollection} from '@zaes/symbology-engine';
import {SymbolOpenLayers} from '@zaes/symbology-engine/openlayers';

const collection = new SymbolCollection(schema); // your family's CollectionSchema
const renderer = new SymbolOpenLayers(map, collection, painter); // your family's SymbolPainter

collection.load(geojson);
```

The MapLibre renderer is `SymbolMapLibre` from `@zaes/symbology-engine/maplibre`, with the same
arguments. `ol` and `maplibre-gl` are optional peer dependencies; install the one you use.

Most applications use a symbol family built on the engine, such as `@zaes/metoc`, rather than the
engine directly.

## License

MIT
