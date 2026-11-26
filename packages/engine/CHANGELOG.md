# Changelog

All notable changes to `@zaes/symbology-engine`.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Dates are
the npm publish dates — when a version actually became installable.

> **Versions 0.1.0 – 0.2.0 were reconstructed from the commit history after the fact.**
> This file was added afterwards, so those entries summarize what each release contained
> rather than being written alongside it. They are accurate but not exhaustive.

---

## [Unreleased]

### Changed

- **The npm page links to the source and the issue tracker** (`repository`, `homepage`, `bugs`).
- **Moving point symbols on MapLibre costs less.** A symbol that only moved is sent to MapLibre as its new
  position alone (`updateData` with no properties), keeps its place in the stacking order, and leaves the count of
  images in use alone: with 30,000 symbols moving, each update's repaint takes well under half the time.

## [0.7.0] — 2026-11-23

### Added

- **Point images scale with the map**: `pointImages.scaleAt(resolution)` (MapLibre and OpenLayers) and
  `pointLeaders.scaleAt` (MapLibre) size each image at the view's resolution, so a family can shrink its symbols
  as the map zooms out. MapLibre samples it every quarter zoom; `refresh()` applies a change.
- **A point drawn away from its location**: `SymbolPainter.drawnOffset(feature, resolution)` says where, in CSS
  pixels (a unit in its place in a group at one location); the editor (`@zaes/symbology-editor`) takes it.
- **`OverlayHandle.offsetPx`**: a handle drawn that far from its place on the ground, on the screen. MapLibre draws
  it upright in a layer of its own; Cesium as an element over the canvas, placed every frame (a billboard lay under
  the symbol's own, both ignoring depth).
- **Text aligned on an edge**: `GlyphText.edge` (`{align: 'start' | 'end', x}`, SVG's `text-anchor`) passes to the
  paint as `PaintText.align` and `alignAt`; `drawPaintsImage` measures the letters and places them from that edge, so
  a column of labels meets one edge. The geometry stays the estimated center for renderers that only center text.

### Fixed

- **Cesium: shaped handles show as soon as they are made.** Each overlay paint makes their billboards again, and
  their images loaded after the frame; frames now follow until they have.
- **Cesium: an overlay follows the camera** (the editor's handles). The renderer told its view listeners
  only once the camera settled and only of a change of scale, so while the camera turned, handles kept
  their old places on the ground and jumped when it stopped. It tells them after every frame the camera
  moved in, as MapLibre does.

## [0.6.0] — 2026-11-20

Dashed leader lines, a leader line under every lifted symbol, and lifted symbols picked where they are drawn.

### Added

- **Dashed leader lines**: `PointLeader.dashPx` (dash and gap lengths in CSS pixels, laid from the location up,
  each dash on its own halo). Default solid, as before.

### Fixed

- **A point symbol on a leader line always has its line.** The line ran up only to the bottom of the symbol's
  picture box, centered on its anchor, so a symbol with text or marks reaching the line's length from its anchor
  (48 px by default) showed only the dot. It now runs up to the symbol's lowest ink straight under its anchor.

- **No light line where two pieces of a symbol meet on OpenLayers.** Fill-only polygons of one color, one after
  another, are filled as one shape, as point images already fill them; each was anti-aliased alone and let the
  background through along an edge they share.

- **A symbol on a leader line is drawn on whole device pixels**, no longer resampled (softened) by a
  fractional offset; the line and location sit within half a device pixel of its anchor.
- **Dash patterns of odd length** halo every dash, as the canvas repeats them; a gap too short for two
  halos gets one solid halo; negative or non-finite lengths count as 0.
- **Leader options given as `undefined`** keep their defaults (`{dashPx: undefined}` threw).
- **Cesium: a point symbol's underlay text** is laid out when the symbol is painted, so a repaint after a
  zoom no longer loses it until the camera moves again.
- **Cesium: a leader given without a length** tells the editor the symbol stands at the default length
  (48 px). It said 0, so lifted symbols were picked at their location: a headquarters by its staff alone.

## [0.5.0] — 2026-11-19

Line caps and joins per stroke, text weight and outline, and no seams between the pieces of a point image.

### Added

- **Line caps and joins per stroke.** `PaintStroke.cap` (`butt`, `round`, `square`) and `join` (`miter`,
  `round`, `bevel`; a miter is beveled past 4 widths, as SVG's default), and the same on a glyph's paths
  (`cap`, `join`). OpenLayers, MapLibre's line layers and `drawPaintsImage` draw them. Absent, lines stay
  round as before.
- **Text weight and outline.** `PaintText.fontWeight` (absent: 600, as before) and `PaintText.outline`, a
  line along the letters' edges drawn over them, as SVG strokes text (the halo still lies under them).
  Glyph text takes `weight` and `outline` (in glyph units). Drawn by OpenLayers, label images (MapLibre,
  Cesium) and `drawPaintsImage`; WinTAK marks draw text bold only from weight 600.

### Fixed

- **No light line where two pieces of a point symbol meet** in `drawPaintsImage` (MapLibre's point images,
  Cesium billboards). Fill-only polygons of one color, one after another, are filled as one shape, their
  union, instead of one by one: each was anti-aliased alone and let the background through along an edge
  they share.

## [0.4.1] — 2026-11-16

### Fixed

- **MapLibre point images no longer pile up while symbols change.** A symbol whose look keeps changing
  (direction, speed, a label) left every image it had drawn on the map until something was added or
  removed; each update now drops the looks no symbol has.
- **The editor's overlay follows a turned or tilted map.** A resize handle or a selection box stayed
  where it was drawn when the map rotated (both renderers) or tilted (MapLibre), while picking used
  the new position.
- **A disposed MapLibre renderer draws nothing more.** A pending repaint once wrote its old overlay into
  the sources of a new renderer on the same map, and could remove images the new one used.
- Handle images are drawn on in-memory canvases, as point and label images are.
- **An even-odd glyph keeps its shape when it is turned, moved or zoomed.** Which ring is a hole was
  worked out again at every placement, from each ring's first vertex in map coordinates; a vertex lying
  on another ring's edge fell in or out by rounding, so a symbol could lose its holes at some rotations
  and zooms. The grouping is now worked out once per glyph path, which also makes painting glyphs with
  even-odd parts several times faster (a catalog of 884 incident symbols: 909 to 255 ms).

### Changed

- **Pattern-filled and dotted areas paint several times faster, the marks unchanged.** Each grid row
  finds where it crosses the outline once, where every grid point and every pattern mark's corners were
  tested against every edge, and an unturned pattern glyph is worked out once and copied to each place.
  In a METOC catalog benchmark a kelp area went from 19 to 3 ms, and the 408 graphics from 151 to 106 ms.

- **OpenLayers keeps its stacking order without ranking every graphic on each addition or removal**
  (thirty thousand added one by one took as many full passes), reloads add every feature in one bulk
  load, and point image styles are bounded (4,000 looks, the oldest dropped first).

## [0.4.0] — 2026-11-12

Shaped edit handles with a center cross.

### Added

- **Shaped edit handles.** `OverlayHandle` takes `shape` (`circle`, `square`, `diamond`, `arrow`),
  `rotation` (an arrow's direction, turning with the map), `cross` (a + through the center) and
  `strokeWidthPx`. OpenLayers, MapLibre and Cesium draw them from one image (`drawHandleImage`), so
  they look the same on each; a plain round handle is drawn as before.

## [0.3.1] — 2026-11-12

Text in point images drawn complete and sharp.

### Fixed

- **Small text in point images and label images no longer loses letters.** Chrome's GPU canvas, with
  many small canvases drawn in a burst (a map loading its symbols), at times drew small text from blank
  glyphs: whole letters dropped out and their halo showed in their place, on MapLibre and OpenLayers
  alike, mostly at a device pixel ratio of 1. These images are now drawn on canvases kept in memory
  (`willReadFrequently`), which also makes them much faster to read back: 30,000 labeled symbols load
  on MapLibre in about a quarter of the time.
- **Sharper text in point images.** An upright label is placed on whole device pixels instead of being
  resampled between them, and MapLibre's point images are aligned to the viewport while the map is not
  tilted, so MapLibre draws them pixel for pixel instead of blurring them between screen pixels. Tilted,
  they lie on the map as before; a map's bearing still turns them.

## [0.3.0] — 2026-11-12

Many point symbols drawn quickly, on both map libraries, standing still or moving.

### Added

- **`pointImages` on the OpenLayers renderer** (`SymbolOpenLayersOptions.pointImages`,
  `OpenLayersPointImages`), as MapLibre has: each point symbol drawn once per look as an image and
  shared by every symbol that looks the same, on a point geometry, over every graphic's marks and
  stacked in the collection's order. Its underlay is still drawn as marks under it. Off unless a
  family turns it on; with 100,000 symbols a family measured the first render going from about 20 s
  to 2 s and memory from about 750 MB to 240 MB.

### Changed

- **MapLibre point symbols have a source of their own** (`<idPrefix>-points`, read by the `point`
  and `leader` layers), so MapLibre parses each once rather than once per layer of the marks'
  source.
- **MapLibre stacks point symbols by source order** (`symbol-z-order: source`) instead of a
  `symbol-sort-key` per symbol, which made MapLibre sort and draw by key. The collection's order
  still decides which symbol covers which. With 30,000 symbols the first render went from 6.6 s to
  1.5 s and panning from 9 to 24 frames a second.
- **A zoom no longer redraws MapLibre's point symbols**: images and leader lines are the same size
  on screen at any zoom, so only the marks and the overlay are repainted.
- **MapLibre sends only what changed.** A change to one graphic sends its point feature alone
  (`updateData`, keyed by numeric feature ids), and repaints the marks only when that graphic draws
  some; additions, removals and reloads are full paints as before. Hosts on MapLibre older than 3.5,
  which has no `updateData`, get the whole source as before. 30,000 symbols moving once a second draw
  at about 46 frames a second.

### Fixed

- **OpenLayers: moving many graphics no longer stalls.** Every change recomputed every graphic's
  stacking rank, so 30,000 moves took nearly a minute; ranks now change only on an addition, a removal
  or a reset, and an update applies in about 230 ms. A moved point image keeps its geometry, moved.
- **OpenLayers: a moved graphic keeps its place in the stack.** Ranks were kept by object, and a change
  replaces the object, so a moved graphic drew at the bottom of the stack until the next reset.

## [0.2.0] — 2026-11-10

Stacking order, and point symbols that are drawn whole, picked whole and keep their ground marks.

### Added

- **A stacking order.** `SymbolCollection.move(id, 'front' | 'back' | 'forward' | 'backward')`
  changes a graphic's place; the list's order is the stacking order and the saved order. On
  OpenLayers each graphic gets its own z-index range so graphics draw whole, one over another,
  instead of one's lines over another's fill.
- **`pointImages` on the MapLibre renderer**: point symbols drawn as one image each, so overlapping
  symbols cover each other whole.
- **A painter underlay** (`SymbolPainter.underlay`): marks in map units under a point symbol, such
  as an area of uncertainty or a trailer, drawn as marks however the point is drawn (under MapLibre's
  point images and leader lines, and first in `paintAll` elsewhere).
- **Picking by drawn box** (`SymbolPainter.pickBox(feature, resolution)`): a point symbol's drawn box
  around its anchor, so the editor picks it anywhere it is drawn, for example a headquarters drawn
  above its location.
- **Glyph text without a halo** (`GlyphText.halo: false`), for letters drawn inside a symbol, where a
  halo would cut into the lines around them.

### Fixed

- **MapLibre: leader lines win over point images** when both are set, so a symbol stands on its
  leader line instead of lying flat.
- **MapLibre draws dots**: a dash as long as the line is wide keeps a half-pixel run, and sources are
  not simplified, so dotted lines no longer lose their dots.

## [0.1.1] — 2026-11-01

Fixes from a quality audit, and more line and area options.

### Added

- **Line and area options**: a zigzag `centered` on its line, an `aligned` (not staggered) dot grid,
  end glyphs set in from the ends (`insetPx`), area `bands` drawn inset from the outline, `dashFit`
  to keep glyphs in step with a dash, and line glyphs that stay `upright`.
- **Glyph text in italic and serif** (`PaintText.fontStyle`).

### Fixed

- **MapLibre dashes**: each run is shortened by its round caps, so the gaps stay open, and a closed
  shape's ring is dashed too.
- **Labels**: label images draw multi-line text, `estimateTextWidth` uses per-character widths and the
  widest line, and an area's label goes where `labelAnchorInRing` says, so concave areas keep it.
- **Area outline glyphs face outward** whatever way the ring was traced.
- **OpenLayers does not zoom on a double click** after a click a host's editor took.
- **Leader lines start under the symbol's picture**, not through text written below it.

## [0.1.0] — 2026-10-30

The first public release: what a symbol family needs to draw and edit its graphics on OpenLayers and
MapLibre, with no symbology of its own.

### Added

- **Marks** (`Paint`): lines, areas and text in Web Mercator meters, the one form every renderer and
  exporter takes, with the Web Mercator helpers (`toMercator`, `fromMercator`, `wrapLongitude`,
  `continuousLonLat`).
- **The store**: `SymbolCollection` with a family's `CollectionSchema` (GeoJSON in and out, cleaning,
  change events, a report of features it could not read), and the saved form's helpers
  (`drawnPoints`, `geometryForKind`).
- **The painter interface** (`SymbolPainter`) and `paintAll`, through which a family says what its
  graphics look like.
- **Line and area styles from data** (`LineStyleDef`, `AreaStyleDef`): color, width, dashes, casing,
  glyphs along a line, ticks, zigzags, waves, arrows, fills, hatching, patterns and dots, outline and
  center glyphs, fitted text.
- **Glyphs and point symbols**: the glyph format (paths filled nonzero or even-odd, text) and
  `paintGlyph`; point sizes small, medium and large (`POINT_SIZES`); `mapScaleOf` and
  `pointZoomFactor` for point symbols that shrink as the map zooms out.
- **Smooth curves** through every drawn point (centripetal Catmull-Rom).
- **Renderers**: `SymbolOpenLayers` (`/openlayers`) and `SymbolMapLibre` (`/maplibre`), each a map
  host an editor can attach to; paint bands keep a mark painted on a line on top of it; on MapLibre,
  point symbols on leader lines for tilted 3D maps (`pointLeaders`, switchable while running), and text
  drawn to images so no glyph server is needed.
- **Across the antimeridian**: graphics drawn across ±180° keep their points continuous, and every
  renderer draws them the short way.
- **Text marks carry their font and halo** (`PaintText.fontFamily`, `haloPx`).
- **Packaging**: ES module and CommonJS builds with declarations; nothing reads `document`, `window` or
  `process` at load, and `ol` and `maplibre-gl` are needed only for their renderer.
