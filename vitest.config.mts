import {defineConfig} from 'vitest/config';
import {fileURLToPath} from 'node:url';

const pkg = (p: string) => fileURLToPath(new URL(`./packages/${p}`, import.meta.url));

// The tests import the packages by their published names, resolved to source. Anchored regexes: a
// plain `{name: path}` alias is a prefix match and would send `@zaes/symbology-engine/openlayers`
// to `index.ts/openlayers`. tsconfig.json `paths` states the same mapping for the compiler.
const alias = [
    {find: /^@zaes\/symbology-engine$/, replacement: pkg('engine/src/index.ts')},
    {find: /^@zaes\/symbology-engine\/openlayers$/, replacement: pkg('engine/src/openlayers/index.ts')},
    {find: /^@zaes\/symbology-engine\/maplibre$/, replacement: pkg('engine/src/maplibre/index.ts')},
    {find: /^@zaes\/symbology-editor$/, replacement: pkg('engine-editor/src/index.ts')},
];

export default defineConfig({
    resolve: {alias},
    test: {globals: true, environment: 'node', alias, include: ['packages/*/src/**/*.test.ts']},
});
