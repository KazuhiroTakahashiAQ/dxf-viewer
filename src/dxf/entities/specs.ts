import type { Vec3 } from '../../geom/vec';
import type { EntityBase, MTextEntity, Vertex } from '../model';
import type { EntitySpec, TagReader } from './common';
import { ACAD_TABLE, ACIS, IMAGE, LEADER, MESH, MLINE, MULTILEADER, OLE2FRAME, PROXY, SHAPE, TOLERANCE, UNDERLAY, XLINE } from './complexSpecs';
import { HATCH, MPOLYGON } from './hatch';

/* eslint-disable @typescript-eslint/no-explicit-any */
type E = any;

/** Assign a point read from x/y/z codes; returns tags used. */
function pt(e: E, key: string, i: number, r: TagReader): number {
  const { p, used } = r.point(i);
  e[key] = p;
  return used;
}

const extrusion = (e: E, code: number, i: number, r: TagReader): number =>
  code === 210 ? pt(e, 'extrusion', i, r) : 0;

const LINE: EntitySpec = {
  init(e: E) {
    e.start = [0, 0, 0];
    e.end = [0, 0, 0];
  },
  tag(e: E, code, i, r) {
    switch (code) {
      case 10: return pt(e, 'start', i, r);
      case 11: return pt(e, 'end', i, r);
      case 39: e.thickness = r.n(i); return 1;
      default: return extrusion(e, code, i, r);
    }
  },
};

const POINT: EntitySpec = {
  init(e: E) {
    e.position = [0, 0, 0];
    e.angle = 0;
  },
  tag(e: E, code, i, r) {
    switch (code) {
      case 10: return pt(e, 'position', i, r);
      case 39: e.thickness = r.n(i); return 1;
      case 50: e.angle = r.n(i); return 1;
      default: return extrusion(e, code, i, r);
    }
  },
};

const CIRCLE: EntitySpec = {
  init(e: E) {
    e.center = [0, 0, 0];
    e.radius = 0;
  },
  tag(e: E, code, i, r) {
    switch (code) {
      case 10: return pt(e, 'center', i, r);
      case 40: e.radius = r.n(i); return 1;
      case 39: e.thickness = r.n(i); return 1;
      default: return extrusion(e, code, i, r);
    }
  },
};

const ARC: EntitySpec = {
  init(e: E) {
    CIRCLE.init(e);
    e.startAngle = 0;
    e.endAngle = 360;
  },
  tag(e: E, code, i, r) {
    if (code === 50) { e.startAngle = r.n(i); return 1; }
    if (code === 51) { e.endAngle = r.n(i); return 1; }
    return CIRCLE.tag(e, code, i, r);
  },
};

const ELLIPSE: EntitySpec = {
  init(e: E) {
    e.center = [0, 0, 0];
    e.majorAxis = [1, 0, 0];
    e.ratio = 1;
    e.startParam = 0;
    e.endParam = Math.PI * 2;
  },
  tag(e: E, code, i, r) {
    switch (code) {
      case 10: return pt(e, 'center', i, r);
      case 11: return pt(e, 'majorAxis', i, r);
      case 40: e.ratio = r.n(i); return 1;
      case 41: e.startParam = r.n(i); return 1;
      case 42: e.endParam = r.n(i); return 1;
      default: return extrusion(e, code, i, r);
    }
  },
};

const LWPOLYLINE: EntitySpec = {
  init(e: E) {
    e.flags = 0;
    e.closed = false;
    e.elevation = 0;
    e.constantWidth = 0;
    e.points = [];
    e.bulges = [];
    e.startWidths = [];
    e.endWidths = [];
  },
  tag(e: E, code, i, r) {
    switch (code) {
      case 90: return 1;
      case 70: e.flags = r.n(i); e.closed = (e.flags & 1) !== 0; return 1;
      case 43: e.constantWidth = r.n(i); return 1;
      case 38: e.elevation = r.n(i); return 1;
      case 39: e.thickness = r.n(i); return 1;
      case 10: {
        e.points.push(r.n(i));
        let used = 1;
        if (i + 1 < r.end && r.tags.code(i + 1) === 20) {
          e.points.push(r.n(i + 1));
          used = 2;
        } else e.points.push(0);
        e.bulges.push(0);
        e.startWidths.push(-1);
        e.endWidths.push(-1);
        return used;
      }
      case 91: return 1;
      case 40: if (e.startWidths.length) e.startWidths[e.startWidths.length - 1] = r.n(i); return 1;
      case 41: if (e.endWidths.length) e.endWidths[e.endWidths.length - 1] = r.n(i); return 1;
      case 42: if (e.bulges.length) e.bulges[e.bulges.length - 1] = r.n(i); return 1;
      default: return extrusion(e, code, i, r);
    }
  },
};

const POLYLINE: EntitySpec = {
  init(e: E) {
    e.flags = 0;
    e.elevation = [0, 0, 0];
    e.defaultStartWidth = 0;
    e.defaultEndWidth = 0;
    e.meshM = 0;
    e.meshN = 0;
    e.smoothM = 0;
    e.smoothN = 0;
    e.curveType = 0;
    e.vertices = [];
  },
  tag(e: E, code, i, r) {
    switch (code) {
      case 66: return 1;
      case 10: return pt(e, 'elevation', i, r);
      case 39: e.thickness = r.n(i); return 1;
      case 70: e.flags = r.n(i); return 1;
      case 40: e.defaultStartWidth = r.n(i); return 1;
      case 41: e.defaultEndWidth = r.n(i); return 1;
      case 71: e.meshM = r.n(i); return 1;
      case 72: e.meshN = r.n(i); return 1;
      case 73: e.smoothM = r.n(i); return 1;
      case 74: e.smoothN = r.n(i); return 1;
      case 75: e.curveType = r.n(i); return 1;
      default: return extrusion(e, code, i, r);
    }
  },
};

/** VERTEX records are parsed into plain Vertex objects. */
export const VERTEX: EntitySpec = {
  init(e: E) {
    e.position = [0, 0, 0];
    e.bulge = 0;
    e.startWidth = -1;
    e.endWidth = -1;
    e.flags = 0;
  },
  tag(e: E, code, i, r) {
    switch (code) {
      case 10: return pt(e, 'position', i, r);
      case 40: e.startWidth = r.n(i); return 1;
      case 41: e.endWidth = r.n(i); return 1;
      case 42: e.bulge = r.n(i); return 1;
      case 70: e.flags = r.n(i); return 1;
      case 71:
      case 72:
      case 73:
      case 74: {
        e.face ??= [0, 0, 0, 0];
        e.face[code - 71] = Math.trunc(r.n(i));
        return 1;
      }
      default: return 0;
    }
  },
};

export function vertexFrom(e: E): Vertex {
  const v: Vertex = {
    position: e.position,
    bulge: e.bulge,
    startWidth: e.startWidth,
    endWidth: e.endWidth,
    flags: e.flags,
  };
  if (e.face) v.face = e.face;
  return v;
}

const FACE: EntitySpec = {
  init(e: E) {
    e.corners = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    e.edgeFlags = 0;
    e._cornersSet = 0;
  },
  tag(e: E, code, i, r) {
    if (code >= 10 && code <= 13) {
      const { p, used } = r.point(i);
      e.corners[code - 10] = p;
      e._cornersSet |= 1 << (code - 10);
      return used;
    }
    if (code === 70) { e.edgeFlags = r.n(i); return 1; }
    if (code === 39) { e.thickness = r.n(i); return 1; }
    return extrusion(e, code, i, r);
  },
  finish(e: E) {
    // a triangle omits the 4th corner: it repeats the 3rd
    if (!(e._cornersSet & 8)) e.corners[3] = [...e.corners[2]];
    delete e._cornersSet;
  },
};

const TEXT: EntitySpec = {
  init(e: E) {
    e.text = '';
    e.insert = [0, 0, 0];
    e.height = 0;
    e.rotation = 0;
    e.widthFactor = 1;
    e.oblique = 0;
    e.style = 'STANDARD';
    e.generation = 0;
    e.halign = 0;
    e.valign = 0;
  },
  tag(e: E, code, i, r) {
    const isAttr = e.type === 'ATTRIB' || e.type === 'ATTDEF';
    // R2018 multi-line attribute: embedded MTEXT after "101 Embedded Object"
    if (code === 101) {
      if (isAttr) return parseEmbeddedMText(e, i, r);
      return 1;
    }
    switch (code) {
      case 1: e.text = r.raw(i); return 1;
      case 10: return pt(e, 'insert', i, r);
      case 11: return pt(e, 'align', i, r);
      case 40: e.height = r.n(i); return 1;
      case 50: e.rotation = r.n(i); return 1;
      case 41: e.widthFactor = r.n(i) || 1; return 1;
      case 51: e.oblique = r.n(i); return 1;
      case 7: e.style = r.s(i).trim(); return 1;
      case 71: e.generation = r.n(i); return 1;
      case 72: e.halign = r.n(i); return 1;
      case 39: e.thickness = r.n(i); return 1;
      case 73:
        if (!isAttr) { e.valign = r.n(i); return 1; }
        e.fieldLength = r.n(i);
        return 1;
      case 74:
        if (isAttr) { e.valign = r.n(i); return 1; }
        return 0;
      case 2: if (isAttr) { e.tag = r.s(i); return 1; } return 0;
      case 3: if (isAttr) { e.prompt = r.s(i); return 1; } return 0;
      case 70: if (isAttr) { e.attribFlags = r.n(i); return 1; } return 0;
      case 280: return 1;
      default: return extrusion(e, code, i, r);
    }
  },
};

/** Column data of an R2018 MTEXT "Embedded Object" (layout as read by ezdxf). */
function parseMTextColumnsObject(e: E, i: number, r: TagReader): number {
  let j = i + 1;
  const heights: number[] = [];
  while (j < r.end) {
    const code = r.tags.code(j);
    if (code >= 1000) break;
    if (code === 71) e.columnType = r.n(j);
    else if (code === 72) e.columnCount = r.n(j);
    else if (code === 44) e.columnWidth = r.n(j);
    else if (code === 45) e.columnGutter = r.n(j);
    else if (code === 73) e.columnAutoHeight = r.n(j);
    else if (code === 74) e.columnFlowReversed = r.n(j);
    else if (code === 46) heights.push(r.n(j));
    j++;
  }
  if (heights.length) e.columnHeights = heights;
  return j - i;
}

function parseEmbeddedMText(e: E, i: number, r: TagReader): number {
  const m: E = { type: 'MTEXT', layer: e.layer, color: e.color };
  MTEXT.init(m);
  let j = i + 1;
  while (j < r.end) {
    const code = r.tags.code(j);
    if (code >= 1000) break;
    const used = MTEXT.tag(m, code, j, r);
    j += used > 0 ? used : 1;
  }
  MTEXT.finish?.(m, r);
  e.mtext = m as MTextEntity;
  return j - i;
}

const MTEXT: EntitySpec = {
  init(e: E) {
    e.text = '';
    e._chunks = [];
    e.insert = [0, 0, 0];
    e.height = 0;
    e.refWidth = 0;
    e.attachment = 1;
    e.direction = 1;
    e.style = 'STANDARD';
    e.rotation = 0;
    e.lineSpacingStyle = 1;
    e.lineSpacingFactor = 1;
    e.bgFlags = 0;
    e.bgScale = 1.5;
    e.columnType = 0;
    e.columnCount = 0;
    e.columnWidth = 0;
    e.columnGutter = 0;
    e.columnHeights = [];
  },
  tag(e: E, code, i, r) {
    switch (code) {
      case 1: e._last = r.raw(i); return 1;
      case 3: e._chunks.push(r.raw(i)); return 1;
      case 10: return pt(e, 'insert', i, r);
      case 11: return pt(e, 'xAxis', i, r);
      case 40: e.height = r.n(i); return 1;
      case 41: e.refWidth = r.n(i); return 1;
      case 46: e.definedHeight = r.n(i); return 1;
      case 71: e.attachment = r.n(i) || 1; return 1;
      case 72: e.direction = r.n(i); return 1;
      case 7: e.style = r.s(i).trim(); return 1;
      case 42: e.horizontalWidth = r.n(i); return 1;
      case 43: e.verticalHeight = r.n(i); return 1;
      case 50:
        if (e.columnType > 0 && e._afterColumns) { e.columnHeights.push(r.n(i)); return 1; }
        e.rotation = r.n(i);
        e.hasRotation = true;
        return 1;
      case 73: e.lineSpacingStyle = r.n(i); return 1;
      case 44: e.lineSpacingFactor = r.n(i) || 1; return 1;
      case 90: e.bgFlags = r.n(i); return 1;
      case 63: e.bgColor = r.n(i); return 1;
      case 421: e.bgTrueColor = r.n(i) & 0xffffff; return 1;
      case 45: e.bgScale = r.n(i); return 1;
      case 441: e.bgTransparency = r.n(i); return 1;
      // R2018: column settings live in an "Embedded Object" after the MTEXT data;
      // its codes (10, 11, 40, 41, …) must not overwrite the main properties
      case 101: return parseMTextColumnsObject(e, i, r);
      case 75: e.columnType = r.n(i); e._afterColumns = true; return 1;
      case 76: e.columnCount = r.n(i); return 1;
      case 78: e.columnFlowReversed = r.n(i); return 1;
      case 79: e.columnAutoHeight = r.n(i); return 1;
      case 48: e.columnWidth = r.n(i); return 1;
      case 49: e.columnGutter = r.n(i); return 1;
      default: return extrusion(e, code, i, r);
    }
  },
  finish(e: E) {
    e.text = e._chunks.join('') + (e._last ?? '');
    delete e._chunks;
    delete e._last;
    delete e._afterColumns;
  },
};

const INSERT: EntitySpec = {
  init(e: E) {
    e.name = '';
    e.insert = [0, 0, 0];
    e.scale = [1, 1, 1];
    e.rotation = 0;
    e.columns = 1;
    e.rows = 1;
    e.columnSpacing = 0;
    e.rowSpacing = 0;
    e.attribs = [];
  },
  tag(e: E, code, i, r) {
    switch (code) {
      case 66: return 1;
      case 2: e.name = r.s(i).trim(); return 1;
      case 10: return pt(e, 'insert', i, r);
      case 41: e.scale[0] = r.n(i); return 1;
      case 42: e.scale[1] = r.n(i); return 1;
      case 43: e.scale[2] = r.n(i); return 1;
      case 50: e.rotation = r.n(i); return 1;
      case 70: e.columns = Math.max(1, Math.trunc(r.n(i))); return 1;
      case 71: e.rows = Math.max(1, Math.trunc(r.n(i))); return 1;
      case 44: e.columnSpacing = r.n(i); return 1;
      case 45: e.rowSpacing = r.n(i); return 1;
      default: return extrusion(e, code, i, r);
    }
  },
};

const DIMENSION: EntitySpec = {
  init(e: E) {
    e.blockName = '';
    e.dimType = 0;
    e.dimStyle = 'STANDARD';
    e.defPoint = [0, 0, 0];
    e.textMidpoint = [0, 0, 0];
    e.cloneInsert = [0, 0, 0];
    e.textOverride = '';
  },
  tag(e: E, code, i, r) {
    switch (code) {
      case 2: e.blockName = r.s(i).trim(); return 1;
      case 3: e.dimStyle = r.s(i).trim(); return 1;
      case 1: e.textOverride = r.raw(i); return 1;
      case 70: e.dimType = r.n(i); return 1;
      case 71: e.attachment = r.n(i); return 1;
      case 10: return pt(e, 'defPoint', i, r);
      case 11: return pt(e, 'textMidpoint', i, r);
      case 12: return pt(e, 'cloneInsert', i, r);
      case 13: return pt(e, 'defPoint2', i, r);
      case 14: return pt(e, 'defPoint3', i, r);
      case 15: return pt(e, 'defPoint4', i, r);
      case 16: return pt(e, 'defPoint5', i, r);
      case 40: e.leaderLength = r.n(i); return 1;
      case 42: e.measurement = r.n(i); return 1;
      case 50: e.angle = r.n(i); return 1;
      case 51: e.horizontalDirection = r.n(i); return 1;
      case 52: e.obliqueAngle = r.n(i); return 1;
      case 53: e.textRotation = r.n(i); return 1;
      default: return extrusion(e, code, i, r);
    }
  },
};

const SPLINE: EntitySpec = {
  init(e: E) {
    e.flags = 0;
    e.degree = 3;
    e.knots = [];
    e.weights = [];
    e.ctrl = [];
    e.fit = [];
  },
  tag(e: E, code, i, r) {
    switch (code) {
      case 70: e.flags = r.n(i); return 1;
      case 71: e.degree = Math.trunc(r.n(i)); return 1;
      case 72: case 73: case 74: return 1;
      case 42: e.knotTolerance = r.n(i); return 1;
      case 43: e.ctrlTolerance = r.n(i); return 1;
      case 44: e.fitTolerance = r.n(i); return 1;
      case 40: e.knots.push(r.n(i)); return 1;
      case 41: e.weights.push(r.n(i)); return 1;
      case 10: { const { p, used } = r.point(i); e.ctrl.push(p); return used; }
      case 11: { const { p, used } = r.point(i); e.fit.push(p); return used; }
      case 12: return pt(e, 'startTangent', i, r);
      case 13: return pt(e, 'endTangent', i, r);
      case 210: return pt(e, 'normal', i, r);
      default: return 0;
    }
  },
};

const HELIX: EntitySpec = {
  init: SPLINE.init,
  tag(e: E, code, i, r) {
    if (r.subclass === 'AcDbHelix') {
      switch (code) {
        case 10: return pt(e, 'axisBase', i, r);
        case 11: return pt(e, 'startPoint', i, r);
        case 12: return pt(e, 'axisVector', i, r);
        case 40: e.helixRadius = r.n(i); return 1;
        case 41: e.turns = r.n(i); return 1;
        case 42: e.turnHeight = r.n(i); return 1;
        case 290: e.handedness = r.n(i); return 1;
        case 280: e.constraint = r.n(i); return 1;
        default: return 0;
      }
    }
    return SPLINE.tag(e, code, i, r);
  },
};

const VIEWPORT: EntitySpec = {
  init(e: E) {
    e.center = [0, 0, 0];
    e.width = 0;
    e.height = 0;
    e.status = 0;
    e.vpId = 0;
    e.viewCenter = [0, 0, 0];
    e.viewHeight = 1;
    e.twist = 0;
    e.frozenLayers = [];
  },
  tag(e: E, code, i, r) {
    switch (code) {
      case 10: return pt(e, 'center', i, r);
      case 40: e.width = r.n(i); return 1;
      case 41: e.height = r.n(i); return 1;
      case 68: e.status = r.n(i); return 1;
      case 69: e.vpId = r.n(i); return 1;
      case 12: { const { p, used } = r.point(i); e.viewCenter = p; return used; }
      case 16: return pt(e, 'viewDirection', i, r);
      case 17: return pt(e, 'viewTarget', i, r);
      case 45: e.viewHeight = r.n(i); return 1;
      case 51: e.twist = r.n(i); return 1;
      case 90: e.statusFlags = r.n(i); return 1;
      case 340: e.clipBoundary = r.raw(i).trim(); return 1;
      // frozen layers are 331 (some writers use 341)
      case 331:
      case 341: e.frozenLayers.push(r.raw(i).trim()); return 1;
      default: return 0;
    }
  },
};

export const ENTITY_SPECS: Record<string, EntitySpec> = {
  LINE,
  POINT,
  CIRCLE,
  ARC,
  ELLIPSE,
  LWPOLYLINE,
  POLYLINE,
  VERTEX,
  SOLID: FACE,
  TRACE: FACE,
  '3DFACE': FACE,
  TEXT,
  ATTRIB: TEXT,
  ATTDEF: TEXT,
  MTEXT,
  INSERT,
  DIMENSION,
  ARC_DIMENSION: DIMENSION,
  LARGE_RADIAL_DIMENSION: DIMENSION,
  SPLINE,
  HELIX,
  VIEWPORT,
  XLINE,
  RAY: XLINE,
  HATCH,
  MPOLYGON,
  LEADER,
  MULTILEADER,
  MLEADER: MULTILEADER,
  TOLERANCE,
  MLINE,
  IMAGE,
  WIPEOUT: IMAGE,
  PDFUNDERLAY: UNDERLAY,
  DWFUNDERLAY: UNDERLAY,
  DGNUNDERLAY: UNDERLAY,
  OLE2FRAME,
  SHAPE,
  ACAD_TABLE,
  MESH,
  '3DSOLID': ACIS,
  REGION: ACIS,
  BODY: ACIS,
  SURFACE: ACIS,
  EXTRUDEDSURFACE: ACIS,
  LOFTEDSURFACE: ACIS,
  REVOLVEDSURFACE: ACIS,
  SWEPTSURFACE: ACIS,
  PLANESURFACE: ACIS,
  NURBSURFACE: ACIS,
  ACAD_PROXY_ENTITY: PROXY,
};

export type { EntityBase, Vec3 };
