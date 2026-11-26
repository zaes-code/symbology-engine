/**
 * # @zaes/symbology-engine
 *
 * A map-symbology engine: what every symbol family needs and no standard decides. It knows how to
 * draw marks, never what a symbol looks like — every symbology fact belongs to a family.
 *
 * - **Marks** ({@link Paint}): lines, filled shapes and text in EPSG:3857 meters, sized for one
 *   resolution. A family's painter makes them; renderers translate them and nothing else.
 * - **Geometry for painters**: Web Mercator, Catmull-Rom and Chaikin smoothing, and the path toolkit decorations
 *   are made from (walker, pips, rings, dash runs, label fitting).
 * - **Glyphs** ({@link GlyphDef}): a point icon as SVG path data, circles and text in a small box,
 *   painted as marks in the family's own color vocabulary.
 * - **Line and area styles** ({@link LineStyleDef}, {@link AreaStyleDef}): a plain line or area as
 *   data — color, dash, casing, decorations, fill, pattern — drawn by {@link paintLineStyle} and
 *   {@link paintAreaStyle} with a family's {@link StyleContext}.
 * - **The saved object and the store**: a graphic is one GeoJSON feature with its drawn points and
 *   one properties object; {@link SymbolCollection} holds them, saves and loads, given a family's
 *   {@link CollectionSchema}.
 * - **The map-host seam** ({@link MapHost}): what every renderer offers an add-on — view, events,
 *   cursor, overlay. An editor attaches to a host, never to a renderer.
 *
 * This root entry is map-agnostic: it never imports a map library, a DOM or a framework, and reads
 * no global at module load. The renderers are `@zaes/symbology-engine/openlayers` and
 * `@zaes/symbology-engine/maplibre`, each generic over a family's {@link SymbolPainter}.
 *
 * @module @zaes/symbology-engine
 */

export type {LineCap, LineJoin, Paint, PaintContext, PaintFill, PaintGeometry, PaintStroke, PaintText} from './paint.js';
export {MITER_LIMIT, PAINT_BANDS, fillRun, paintBands} from './paint.js';
export type {SymbolPainter} from './painter.js';
export {paintAll} from './painter.js';
export {paintsToGeoJSON} from './paintsGeoJSON.js';

export {EARTH_RADIUS, WORLD_WIDTH, continuousLonLat, fromMercator, nearestWorldX, resolutionAtZoom, toMercator, toMercatorNear, wrapLongitude} from './mercator.js';
export type {ProjectedPosition} from './mercator.js';
export {catmullRom, catmullRomClosed, chaikin, chaikinClosed} from './smoothing.js';
export {
    DECORATION_MIN_PX,
    arcOver,
    boundsOf,
    circleRing,
    dashRuns,
    decorationFit,
    dedupe,
    displacedPath,
    TEXT_LINE_HEIGHT,
    estimateTextHeight,
    estimateTextWidth,
    evenSlots,
    fitScaleInRing,
    labelAnchorInRing,
    leftNormal,
    offset,
    outwardSide,
    pointInRing,
    ringCentroid,
    ringInteriorPoint,
    ringSelfIntersects,
    runsOutside,
    semicircleRing,
    signedArea2,
    textLines,
    triangleRing,
    uprightAngle,
    walker,
} from './decorations.js';
export type {PathWalker} from './decorations.js';

export {CSS_GLYPH_COLORS, GLYPH_PX, paintGlyph, parsePath, resolveGlyphColor} from './glyph.js';
export {glyphsAlong, paintAreaStyle, paintLineStyle} from './styles.js';
export {POINT_SIZES, isPointSize, mapScaleOf, pointSizeScale, pointZoomFactor} from './sizes.js';
export type {PointSize} from './sizes.js';
export type {AreaHatch, AreaStyleDef, AreaStyleOptions, LineDecoration, LineStyleDef, StyleContext} from './styles.js';
export type {GlyphCircle, GlyphColor, GlyphColors, GlyphDef, GlyphPart, GlyphPath, GlyphPlacement, GlyphText, Subpath} from './glyph.js';

export {drawnPoints, geometryForKind, geometryTypeFor, minimumPointsFor} from './geometry.js';
export type {GeometryKind, SymbolFeature} from './geometry.js';
export {SymbolCollection} from './collection.js';
export type {CollectionChange, CollectionListener, CollectionSchema, FeatureSource, SkippedFeature} from './collection.js';

export {isTypingTarget} from './host.js';
export type {HandleShape, HostOverlay, KeyInput, MapHost, MapHostHandlers, OverlayHandle, Pixel, PointerInput, ViewAdapter} from './host.js';
export {drawHandleImage, handleImageKey, isPlainHandle} from './handleImage.js';
export {drawLabelImage, labelFont, labelHaloPx, labelImageKey, labelImageSize} from './labelImage.js';
export {drawPaintsImage} from './paintsImage.js';
export type {PaintsImage} from './paintsImage.js';
export {POINT_LEADER_DEFAULTS, drawPointLeaderImage, pointLeaderLiftPx} from './pointLeader.js';
export type {PointLeader, PointLeaderImage} from './pointLeader.js';
