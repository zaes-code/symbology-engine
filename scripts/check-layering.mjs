#!/usr/bin/env node
/**
 * The boundary gate, run on source. `typecheck` and the tests both pass with a deep import in
 * place — the path resolves and neither tool has an opinion — so this states the rules once.
 *
 * The engine knows no symbol family; a family (such as `../metoc`) depends on it, never the other
 * way round. The packages are tiers:
 *
 * 1. `@zaes/symbology-engine` (packages/engine) imports nothing of ours. Its root imports no map
 *    library; `src/openlayers/` reaches only `ol`, and `src/maplibre/` imports `maplibre-gl` for
 *    types only. The renderers reach the root by relative path, never by name.
 * 2. `@zaes/symbology-editor` imports the engine's root and nothing else of ours, and no map
 *    library: it edits through the engine's `MapHost`.
 * 3. No package reaches into another by path, and nothing names a deep path such as
 *    `@zaes/symbology-engine/src/...`: a deep import means a barrel is missing an export.
 * 4. Nothing published reads `document`, `window` or `process` at module scope.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];

const walk = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, {recursive: true}).filter((f) => f.endsWith('.ts')).map((f) => path.join(dir, f)) : []);
const importsOf = (text) => [...text.matchAll(/^\s*(?:import|export)\s+(type\s+)?[^'";]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => ({typeOnly: !!m[1], spec: m[2]}));
const isOl = (s) => s === 'ol' || s.startsWith('ol/');
const isMapLibre = (s) => s === 'maplibre-gl' || s.startsWith('maplibre-gl/');
const isCesium = (s) => s === 'cesium' || s.startsWith('cesium/') || s.startsWith('@cesium/');
const isOurs = (s) => s.startsWith('@zaes/');
const ENGINE = '@zaes/symbology-engine';
const PUBLISHED = new Set([
    ENGINE,
    `${ENGINE}/openlayers`,
    `${ENGINE}/maplibre`,
    '@zaes/symbology-editor',
]);

/** Which part of the workspace a file is in: `engine`, `engine-openlayers`, `engine-maplibre`, or a tier's name. */
function areaOf(rel) {
    const parts = rel.split('/');
    if (parts[0] !== 'packages') return null;
    if (parts[1] === 'engine') return ['openlayers', 'maplibre'].includes(parts[3]) ? `engine-${parts[3]}` : 'engine';
    return parts[1] === 'engine-editor' ? 'editor' : null;
}

const files = fs.readdirSync(path.join(root, 'packages')).flatMap((p) => walk(path.join(root, 'packages', p, 'src')));

for (const file of files) {
    const rel = path.relative(root, file).replace(/\\/g, '/');
    const area = areaOf(rel);
    if (!area) continue;
    const text = fs.readFileSync(file, 'utf8');
    const isTest = rel.endsWith('.test.ts');
    const bad = (why) => problems.push(`${rel}: ${why}`);
    for (const {typeOnly, spec} of importsOf(text)) {
        const target = spec.startsWith('.') ? areaOf(path.relative(root, path.resolve(path.dirname(file), spec)).replace(/\\/g, '/')) : null;
        const isPackage = (s) => PUBLISHED.has(s.split('/').slice(0, 2).join('/'));
        if (isOurs(spec) && !PUBLISHED.has(spec)) bad(isPackage(spec) ? `deep import ${spec}; export it from the package instead` : `imports ${spec}; the engine depends on no symbol family`);
        // The bridge's browser half may read the bridge's HTTP types, and nothing else of it.
        const rootOfMine = (target === 'engine' && ['engine-openlayers', 'engine-maplibre'].includes(area)) || (area === 'bridge-client' && target === 'bridge' && typeOnly && spec.endsWith('/protocol.js'));
        if (spec.startsWith('.') && target !== area && !rootOfMine) bad(`reaches into ${target ?? 'another area'} by path (${spec})`);
        if (isOurs(spec) && !PUBLISHED.has(spec)) continue;
        if (area.startsWith('engine')) {
            if (isOurs(spec)) bad(PUBLISHED.has(spec) && spec.startsWith(ENGINE) ? `imports its own package by name (${spec}); use a relative path` : `the engine imports ${spec}; it depends on no symbol family`);
            if (isCesium(spec)) bad(`imports ${spec}`);
            if (area === 'engine' && (isOl(spec) || isMapLibre(spec))) bad(`the engine root imports ${spec}`);
            if (area === 'engine-openlayers' && isMapLibre(spec)) bad(`imports ${spec}`);
            if (area === 'engine-maplibre' && isOl(spec)) bad(`imports ${spec}`);
            if (area === 'engine-maplibre' && isMapLibre(spec) && !typeOnly) bad('imports maplibre-gl at run time; use `import type`');
            continue;
        }
        // A tier, such as the editor.
        if (isOurs(spec) && spec !== ENGINE) bad(`the ${area} tier imports ${spec}; a tier needs the engine's root alone`);
        if (isOl(spec) || isMapLibre(spec)) bad(`the ${area} tier imports ${spec}${area === 'editor' ? '; it edits through MapHost' : ''}`);
        if (isCesium(spec) && (area !== 'cesium' || !typeOnly)) bad(area === 'cesium' ? 'imports cesium at run time; the Cesium module is passed in, use `import type`' : `imports ${spec}`);
    }
    if (!isTest) {
        text.split('\n').forEach((line, i) => {
            if (/^(const|let|var|export const|export let)\b.*\b(document|window|process)\b/.test(line) || /^(document|window|process)\./.test(line)) {
                problems.push(`${rel}:${i + 1}: reads a global at module load`);
            }
        });
    }
}

if (problems.length) {
    console.error('Layering violations:\n' + problems.map((p) => `  ${p}`).join('\n'));
    process.exit(1);
}
console.log(`Layering ok (${files.length} files).`);
