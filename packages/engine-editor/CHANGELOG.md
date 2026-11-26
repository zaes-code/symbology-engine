# Changelog

All notable changes to `@zaes/symbology-editor`.

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

## [0.7.0] — 2026-11-23

### Added

- **A point drawn away from its location**: the editor follows a painter's `drawnOffset` (a unit in its place in a
  group at one location): it measures the pick box from there, puts the
  handles round it, and keeps a dragged symbol where it was drawn under the cursor. Its location handle is drawn
  over it (`HandleMark.centered`), a reticle unless the family's chrome gives the anchor a look. On leader lines it
  stands on the location, moved up to the symbol on the screen (`OverlayHandle.offsetPx`); pressed, it drags the
  symbol, held where it is drawn. A location's dot picks the symbol standing on it before any picture drawn over it.
  Its rotate handle and direction are measured from where the symbol is drawn too.

### Fixed

- **Dragging a point symbol keeps it under the cursor on a tilted 3D map.** A symbol on a leader line is
  pressed up its line, and the drag moved it by the ground under the cursor, which there lies far past
  its location and across the terrain: the symbol jumped unevenly and drifted from the cursor. A point now
  keeps its location where it was against the cursor when pressed. Flat maps are unchanged.
- **Handles stay put on a 3D map with terrain.** The scale handles are placed by (the direction handle,
  the size handle's reach) was read from the ground under the pixels beside the symbol, which on a ridge
  lie one on the slope in front and one far behind: it jumped fivefold as a symbol moved. It is read at the
  symbol's own place now. Flat maps are unchanged.

## [0.6.0] — 2026-11-20

Requires `@zaes/symbology-engine` 0.6.0.

### Fixed

- **A point symbol on a leader line is picked anywhere in its drawn box** (frame, staff, amplifiers), up
  the screen where it stands, as on a flat map; it was picked only within a circle round its anchor, out
  of reach of a headquarters' frame, which stands a staff's length above it. The dot on its location
  still picks it.

## [0.5.0] — 2026-11-19

Requires `@zaes/symbology-engine` 0.5.0. No changes of its own.

## [0.4.1] — 2026-11-16

Requires `@zaes/symbology-engine` 0.4.1.

### Fixed

- **Redo no longer loses an edit made after an undo.** An edit not yet checkpointed is committed first,
  so it can be undone and redone; restoring the redone state over it once discarded it from both.

## [0.4.0] — 2026-11-12

Handle looks per kind of handle, and `allowFor` per graphic. Requires `@zaes/symbology-engine` 0.4.0.

### Added

- **`allowFor(feature, action)`** in the editor's options: refuse an action for one graphic, and hide
  its handles while it is selected, after `allow`'s rule for every graphic.
- **Handle looks.** `EditorChrome.handles` gives each kind of handle (`anchor`, a point's location;
  `vertex`, `insert`, `rotate`, `resize`) its own shape, fill, outline, outline width, size and a
  center cross. A rotate handle drawn as an arrow points along the direction. A handle drawn larger
  picks over all of itself. With no looks, handles are as before.

## [0.3.1] — 2026-11-12

Released alongside `@zaes/symbology-engine` 0.3.1, which it now depends on; no changes of its own.

## [0.3.0] — 2026-11-12

Released alongside `@zaes/symbology-engine` 0.3.0, which it now depends on; no changes of its own.

## [0.2.0] — 2026-11-10

Point symbols are picked anywhere they are drawn.

### Changed

- **Picking by drawn box.** When a family's painter gives `pickBox`, the editor picks a point symbol
  anywhere in that box and outlines the box when it is selected; otherwise it picks within a circle
  around the anchor, as before. A symbol drawn away from its anchor (a headquarters above its
  location) could be missed.

## [0.1.1] — 2026-11-01

Released alongside `@zaes/symbology-engine` 0.1.1, with no changes of its own.

## [0.1.0] — 2026-10-30

The first public release: drawing and editing for any family built on `@zaes/symbology-engine`,
with no map library of its own.

### Added

- **`SymbolInteraction`**: draws, selects, moves, reshapes, rotates, resizes, deletes and duplicates
  graphics, with handles drawn as an overlay. A point is placed with one click; a family may give it
  a `direction` rule (two clicks), a `rotation` rule (a rotate handle) and a `size` rule (a resize
  handle on its diagonal).
- **`attachEditor(host, editor)`**: connects it to any renderer that is a map host
  (`SymbolOpenLayers`, `SymbolMapLibre`), so a new renderer gets editing for nothing.
- **`SymbolHistory`**: undo and redo by snapshots taken at checkpoints, so a drag is one step.
- **Editor options** (`EditorOptions`), each defaulting to the plain behavior: handle radius and hit
  tolerance in pixels, `snapPx` (a drawn or dragged point lands on another graphic's point),
  `readOnly` and per-action `allow`, a `beforeChange` veto called on every change and drag step, and
  `keyboard: false`.
- **Colors** (`EditorChrome`, `DEFAULT_EDITOR_CHROME`): per handle kind, the guide and its dash, and
  the selection width.
