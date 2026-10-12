import type { Vec3 } from '../geom/vec';
import type { TagStore } from './reader/tagStore';

export type { Vec3 } from '../geom/vec';

export type DiagnosticLevel = 'info' | 'warning' | 'error';

export interface Diagnostic {
  level: DiagnosticLevel;
  code: string;
  message: string;
  /** 1-based line number in the source file (ASCII) or byte offset (binary) */
  line?: number;
  handle?: string;
}

export interface EncodingInfo {
  /** WHATWG encoding label used for decoding */
  encoding: string;
  /** Why this encoding was chosen (shown in the UI) */
  reason: string;
  /** $DWGCODEPAGE value if present */
  codepage?: string;
  /** Number of U+FFFD replacement characters after decoding */
  replacements: number;
  overridden: boolean;
}

export interface SourceInfo {
  name: string;
  size: number;
  binary: boolean;
  version?: string; // $ACADVER
  release?: string; // e.g. "R2018"
  encoding: EncodingInfo;
  lineCount: number;
}

export type HeaderValue = { codes: number[]; values: (string | number)[]; tag: number };

/** Common data of every graphical entity. */
export interface EntityBase {
  /** index into DxfDocument.entities */
  id: number;
  type: string;
  handle: string;
  owner?: string;
  layer: string;
  /** undefined = BYLAYER */
  linetype?: string;
  /** ACI: 256 = BYLAYER, 0 = BYBLOCK */
  color: number;
  trueColor?: number;
  colorName?: string;
  /** raw 440 value */
  transparency?: number;
  /** 1/100 mm; -1 BYLAYER, -2 BYBLOCK, -3 DEFAULT */
  lineweight: number;
  ltscale: number;
  invisible: boolean;
  paperSpace: boolean;
  layoutName?: string;
  subclasses?: string[];
  extrusion?: Vec3;
  thickness?: number;
  /** tag index range [tagStart, tagEnd) including sub-entities (VERTEX/ATTRIB/SEQEND) */
  tagStart: number;
  tagEnd: number;
  xdataStart?: number;
  xdataApps?: string[];
  reactors?: string[];
  xdict?: string;
  /** name of the block this entity is defined in (undefined for ENTITIES section) */
  block?: string;
  /** set when the record could not be fully interpreted */
  partial?: boolean;
  [key: string]: unknown;
}

export interface LineEntity extends EntityBase {
  type: 'LINE';
  start: Vec3;
  end: Vec3;
}

export interface PointEntity extends EntityBase {
  type: 'POINT';
  position: Vec3;
  angle: number;
}

export interface CircleEntity extends EntityBase {
  type: 'CIRCLE';
  center: Vec3;
  radius: number;
}

export interface ArcEntity extends EntityBase {
  type: 'ARC';
  center: Vec3;
  radius: number;
  /** degrees */
  startAngle: number;
  endAngle: number;
}

export interface EllipseEntity extends EntityBase {
  type: 'ELLIPSE';
  center: Vec3;
  majorAxis: Vec3;
  ratio: number;
  startParam: number;
  endParam: number;
}

export interface LwPolylineEntity extends EntityBase {
  type: 'LWPOLYLINE';
  flags: number;
  closed: boolean;
  elevation: number;
  constantWidth: number;
  /** x0,y0,x1,y1,... (OCS) */
  points: number[];
  bulges: number[];
  startWidths: number[];
  endWidths: number[];
}

export interface Vertex {
  position: Vec3;
  bulge: number;
  startWidth: number;
  endWidth: number;
  flags: number;
  /** polyface face indices (71..74, 1-based, negative = invisible edge) */
  face?: number[];
}

export interface PolylineEntity extends EntityBase {
  type: 'POLYLINE';
  flags: number;
  elevation: Vec3;
  defaultStartWidth: number;
  defaultEndWidth: number;
  meshM: number;
  meshN: number;
  smoothM: number;
  smoothN: number;
  curveType: number;
  vertices: Vertex[];
}

export interface FaceEntity extends EntityBase {
  type: 'SOLID' | 'TRACE' | '3DFACE';
  corners: Vec3[];
  /** 3DFACE invisible edge flags */
  edgeFlags: number;
}

export interface TextEntity extends EntityBase {
  type: 'TEXT' | 'ATTRIB' | 'ATTDEF';
  text: string;
  insert: Vec3;
  align?: Vec3;
  height: number;
  /** degrees */
  rotation: number;
  widthFactor: number;
  /** degrees */
  oblique: number;
  style: string;
  generation: number;
  halign: number;
  valign: number;
  /** ATTRIB/ATTDEF */
  tag?: string;
  prompt?: string;
  attribFlags?: number;
  /** R2018 multi-line attribute stored as embedded MTEXT */
  mtext?: MTextEntity;
}

export interface MTextEntity extends EntityBase {
  type: 'MTEXT';
  text: string;
  insert: Vec3;
  height: number;
  refWidth: number;
  attachment: number;
  direction: number;
  style: string;
  xAxis?: Vec3;
  /** radians */
  rotation: number;
  lineSpacingStyle: number;
  lineSpacingFactor: number;
  bgFlags: number;
  bgColor?: number;
  bgTrueColor?: number;
  bgScale: number;
  bgTransparency?: number;
  columnType: number;
  columnCount: number;
  columnWidth: number;
  columnGutter: number;
  columnHeights: number[];
}

export interface InsertEntity extends EntityBase {
  type: 'INSERT';
  name: string;
  insert: Vec3;
  scale: Vec3;
  /** degrees */
  rotation: number;
  columns: number;
  rows: number;
  columnSpacing: number;
  rowSpacing: number;
  attribs: TextEntity[];
}

export interface DimensionEntity extends EntityBase {
  type: 'DIMENSION' | 'ARC_DIMENSION' | 'LARGE_RADIAL_DIMENSION';
  dimType: number;
  dimStyle: string;
  defPoint: Vec3;
  textMidpoint: Vec3;
  cloneInsert: Vec3;
  defPoint2?: Vec3;
  defPoint3?: Vec3;
  defPoint4?: Vec3;
  defPoint5?: Vec3;
  measurement?: number;
  textOverride: string;
  leaderLength?: number;
  angle?: number;
  textRotation?: number;
  obliqueAngle?: number;
  horizontalDirection?: number;
  attachment?: number;
  /** the *D block name; kept separately because `block` is the container */
  blockName: string;
}

export interface SplineEntity extends EntityBase {
  type: 'SPLINE' | 'HELIX';
  flags: number;
  degree: number;
  knots: number[];
  weights: number[];
  ctrl: Vec3[];
  fit: Vec3[];
  startTangent?: Vec3;
  endTangent?: Vec3;
  normal?: Vec3;
}

export type Entity = EntityBase;

export interface Layer {
  name: string;
  handle?: string;
  flags: number;
  /** ACI; negative = off */
  color: number;
  trueColor?: number;
  linetype: string;
  lineweight: number;
  plot: boolean;
  transparency?: number;
  tag: number;
  xdict?: string;
}

export interface Linetype {
  name: string;
  handle?: string;
  description: string;
  totalLength: number;
  /** dash lengths: positive = dash, negative = gap, 0 = dot */
  pattern: number[];
  complex: boolean;
  tag: number;
}

export interface TextStyle {
  name: string;
  handle?: string;
  flags: number;
  height: number;
  widthFactor: number;
  oblique: number;
  generation: number;
  font: string;
  bigFont: string;
  /** TrueType family from XDATA ACAD 1000 */
  family?: string;
  ttfFlags?: number;
  tag: number;
}

export interface TableRecord {
  table: string;
  name: string;
  handle?: string;
  tag: number;
  tagEnd: number;
  [key: string]: unknown;
}

export interface BlockDef {
  name: string;
  handle?: string;
  recordHandle?: string;
  flags: number;
  base: Vec3;
  xrefPath?: string;
  description?: string;
  layer: string;
  /** entity ids in definition order */
  entities: number[];
  tag: number;
  tagEnd: number;
}

export interface DxfObject {
  type: string;
  handle: string;
  owner?: string;
  tagStart: number;
  tagEnd: number;
  [key: string]: unknown;
}

export interface Layout {
  name: string;
  handle: string;
  tabOrder: number;
  blockRecord?: string;
  blockName?: string;
}

export interface DxfDocument {
  source: SourceInfo;
  tags: TagStore;
  header: Map<string, HeaderValue>;
  classes: { name: string; cppName: string; app: string; flags: number; tag: number }[];
  layers: Map<string, Layer>;
  linetypes: Map<string, Linetype>;
  styles: Map<string, TextStyle>;
  /** all other table records (VPORT, VIEW, UCS, APPID, DIMSTYLE, BLOCK_RECORD) */
  tableRecords: TableRecord[];
  blocks: Map<string, BlockDef>;
  entities: Entity[];
  modelSpace: number[];
  /** paper space entity ids (ENTITIES section with 67=1) */
  paperSpace: number[];
  objects: DxfObject[];
  layouts: Layout[];
  handles: Map<string, { kind: 'entity' | 'object' | 'table' | 'block'; index: number }>;
  thumbnail?: Uint8Array;
  diagnostics: Diagnostic[];
}

/** Case-insensitive key used for table and block lookups. */
export function nameKey(name: string): string {
  return name.toUpperCase();
}
