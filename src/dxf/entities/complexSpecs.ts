import type { Vec3 } from '../../geom/vec';
import type { EntitySpec, TagReader } from './common';

/* eslint-disable @typescript-eslint/no-explicit-any */
type E = any;

function pt(e: E, key: string, i: number, r: TagReader): number {
  const { p, used } = r.point(i);
  e[key] = p;
  return used;
}

function extrusion(e: E, code: number, i: number, r: TagReader): number {
  return code === 210 ? pt(e, 'extrusion', i, r) : 0;
}

export const XLINE: EntitySpec = {
  init(e: E) {
    e.base = [0, 0, 0];
    e.direction = [1, 0, 0];
  },
  tag(e: E, code, i, r) {
    if (code === 10) return pt(e, 'base', i, r);
    if (code === 11) return pt(e, 'direction', i, r);
    return 0;
  },
};

export const LEADER: EntitySpec = {
  init(e: E) {
    e.dimStyle = 'STANDARD';
    e.arrow = true;
    e.pathType = 0;
    e.creation = 3;
    e.vertices = [] as Vec3[];
    e.hookline = false;
  },
  tag(e: E, code, i, r) {
    switch (code) {
      case 3: e.dimStyle = r.s(i).trim(); return 1;
      case 71: e.arrow = r.n(i) !== 0; return 1;
      case 72: e.pathType = r.n(i); return 1;
      case 73: e.creation = r.n(i); return 1;
      case 74: e.hooklineDirection = r.n(i); return 1;
      case 75: e.hookline = r.n(i) !== 0; return 1;
      case 40: e.textHeight = r.n(i); return 1;
      case 41: e.textWidth = r.n(i); return 1;
      case 76: return 1;
      case 10: {
        const { p, used } = r.point(i);
        e.vertices.push(p);
        return used;
      }
      case 340: e.annotation = r.raw(i).trim(); return 1;
      case 211: return pt(e, 'horizontalDirection', i, r);
      case 212: return pt(e, 'blockOffset', i, r);
      case 213: return pt(e, 'annotationOffset', i, r);
      default: return extrusion(e, code, i, r);
    }
  },
};

/** MULTILEADER: context data (300…301) holds the geometry; entity level holds styling. */
export const MULTILEADER: EntitySpec = {
  init(e: E) {
    e.leaders = [] as { lines: Vec3[][]; lastPoint?: Vec3; dogleg?: Vec3; doglegLength: number }[];
    e.ctx = { scale: 1, textHeight: 0, arrowSize: 0, landingGap: 0, hasText: false, text: '', hasBlock: false };
    e._state = 'entity';
    e.lineType = 1;
    e.contentType = 2;
    e.enableLanding = true;
    e.enableDogleg = true;
  },
  tag(e: E, code, i, r) {
    const ctx = e.ctx;
    if (code === 300 && /CONTEXT_DATA/i.test(r.raw(i))) {
      e._state = 'ctx';
      return 1;
    }
    if (code === 301) {
      e._state = 'entity';
      return 1;
    }
    if (code === 302 && /LEADER\{/i.test(r.raw(i))) {
      e._state = 'leader';
      e.leaders.push({ lines: [], doglegLength: 0 });
      return 1;
    }
    if (code === 303) {
      e._state = 'ctx';
      return 1;
    }
    if (code === 304 && e._state !== 'ctx' && /LEADER_LINE\{/i.test(r.raw(i))) {
      e._state = 'line';
      e.leaders[e.leaders.length - 1]?.lines.push([]);
      return 1;
    }
    if (code === 305) {
      e._state = 'leader';
      return 1;
    }
    const leader = e.leaders[e.leaders.length - 1];
    switch (e._state) {
      case 'line':
        if (code === 10 && leader) {
          const { p, used } = r.point(i);
          leader.lines[leader.lines.length - 1].push(p);
          return used;
        }
        return 1;
      case 'leader':
        if (!leader) return 1;
        if (code === 10) return pt(leader, 'lastPoint', i, r);
        if (code === 11) return pt(leader, 'dogleg', i, r);
        if (code === 40) {
          leader.doglegLength = r.n(i);
          return 1;
        }
        if (code === 271) {
          leader.attachmentDirection = r.n(i);
          return 1;
        }
        return 1;
      case 'ctx':
        switch (code) {
          case 40: ctx.scale = r.n(i); return 1;
          case 10: return pt(ctx, 'contentBase', i, r);
          case 41: ctx.textHeight = r.n(i); return 1;
          case 140: ctx.arrowSize = r.n(i); return 1;
          case 145: ctx.landingGap = r.n(i); return 1;
          case 290: if (ctx._seenText) ctx.hasBlock = r.n(i) !== 0; else { ctx.hasText = r.n(i) !== 0; ctx._seenText = true; } return 1;
          case 304: ctx.text = r.raw(i); return 1;
          case 11: return pt(ctx, 'textNormal', i, r);
          case 340: ctx.textStyle = r.raw(i).trim(); return 1;
          case 12: return pt(ctx, 'textLocation', i, r);
          case 13: return pt(ctx, 'textDirection', i, r);
          case 42: ctx.textRotation = r.n(i); return 1;
          case 43: ctx.textWidth = r.n(i); return 1;
          case 45: ctx.lineSpacingFactor = r.n(i); return 1;
          case 170: ctx.lineSpacingStyle = r.n(i); return 1;
          case 90: ctx.textColor = r.n(i); return 1;
          case 171: ctx.textAttachment = r.n(i); return 1;
          case 91: ctx.bgColor = r.n(i); return 1;
          case 141: ctx.bgScale = r.n(i); return 1;
          case 291: ctx.bgColorOn = r.n(i) !== 0; return 1;
          case 292: ctx.bgFillOn = r.n(i) !== 0; return 1;
          case 341: ctx.block = r.raw(i).trim(); return 1;
          case 14: return pt(ctx, 'blockNormal', i, r);
          case 15: return pt(ctx, 'blockLocation', i, r);
          case 16: return pt(ctx, 'blockScale', i, r);
          case 46: ctx.blockRotation = r.n(i); return 1;
          case 93: ctx.blockColor = r.n(i); return 1;
          case 47: (ctx.blockMatrix ??= []).push(r.n(i)); return 1;
          case 110: return pt(ctx, 'planeOrigin', i, r);
          case 111: return pt(ctx, 'planeX', i, r);
          case 112: return pt(ctx, 'planeY', i, r);
          default: return 1;
        }
      default:
        switch (code) {
          case 340: e.leaderStyle = r.raw(i).trim(); return 1;
          case 170: e.lineType = r.n(i); return 1;
          case 91: e.lineColor = r.n(i); return 1;
          case 341: e.lineLinetype = r.raw(i).trim(); return 1;
          case 171: e.lineWeight = r.n(i); return 1;
          case 290: e.enableLanding = r.n(i) !== 0; return 1;
          case 291: e.enableDogleg = r.n(i) !== 0; return 1;
          case 41: e.doglegLength = r.n(i); return 1;
          case 342: e.arrowBlock = r.raw(i).trim(); return 1;
          case 42: e.arrowSize = r.n(i); return 1;
          case 172: e.contentType = r.n(i); return 1;
          case 343: e.textStyle = r.raw(i).trim(); return 1;
          case 92: e.textColor = r.n(i); return 1;
          case 292: e.textFrame = r.n(i) !== 0; return 1;
          case 344: e.blockContent = r.raw(i).trim(); return 1;
          case 93: e.blockColor = r.n(i); return 1;
          case 302: (e.attribs ??= []).push(r.raw(i)); return 1;
          default: return 0;
        }
    }
  },
  finish(e: E) {
    delete e._state;
    delete e.ctx._seenText;
  },
};

export const TOLERANCE: EntitySpec = {
  init(e: E) {
    e.dimStyle = 'STANDARD';
    e.insert = [0, 0, 0];
    e.text = '';
    e.xAxis = [1, 0, 0];
  },
  tag(e: E, code, i, r) {
    switch (code) {
      case 3: e.dimStyle = r.s(i).trim(); return 1;
      case 10: return pt(e, 'insert', i, r);
      case 1: e.text = r.raw(i); return 1;
      case 11: return pt(e, 'xAxis', i, r);
      default: return extrusion(e, code, i, r);
    }
  },
};

export const MLINE: EntitySpec = {
  init(e: E) {
    e.styleName = 'STANDARD';
    e.scale = 1;
    e.justification = 0;
    e.flags = 0;
    e.start = [0, 0, 0];
    e.vertices = [] as { point: Vec3; direction: Vec3; miter: Vec3; params: number[][]; fills: number[][] }[];
    e.elementCount = 0;
  },
  tag(e: E, code, i, r) {
    switch (code) {
      case 2: e.styleName = r.s(i).trim(); return 1;
      case 340: e.styleHandle = r.raw(i).trim(); return 1;
      case 40: e.scale = r.n(i); return 1;
      case 70: e.justification = r.n(i); return 1;
      case 71: e.flags = r.n(i); return 1;
      case 72: return 1;
      case 73: e.elementCount = r.n(i); return 1;
      case 10: return pt(e, 'start', i, r);
      case 11: {
        const { p, used } = r.point(i);
        e.vertices.push({ point: p, direction: [1, 0, 0], miter: [0, 1, 0], params: [], fills: [] });
        return used;
      }
      case 12: {
        const v = e.vertices[e.vertices.length - 1];
        if (!v) return 1;
        return pt(v, 'direction', i, r);
      }
      case 13: {
        const v = e.vertices[e.vertices.length - 1];
        if (!v) return 1;
        return pt(v, 'miter', i, r);
      }
      case 74: {
        const v = e.vertices[e.vertices.length - 1];
        if (!v) return 1;
        const n = Math.trunc(r.n(i));
        const params: number[] = [];
        let j = i + 1;
        for (let q = 0; q < n && j < r.end && r.tags.code(j) === 41; q++, j++) params.push(r.n(j));
        v.params.push(params);
        // area fill parameters
        if (j < r.end && r.tags.code(j) === 75) {
          const nf = Math.trunc(r.n(j));
          j++;
          const fills: number[] = [];
          for (let q = 0; q < nf && j < r.end && r.tags.code(j) === 42; q++, j++) fills.push(r.n(j));
          v.fills.push(fills);
        }
        return j - i;
      }
      default: return extrusion(e, code, i, r);
    }
  },
};

/** IMAGE and WIPEOUT (AcDbRasterImage). */
export const IMAGE: EntitySpec = {
  init(e: E) {
    e.insert = [0, 0, 0];
    e.u = [1, 0, 0];
    e.v = [0, 1, 0];
    e.size = [1, 1];
    e.clipType = 1;
    e.clip = [] as [number, number][];
    e.clipping = false;
    e.displayFlags = 0;
    e.clipInverted = false;
  },
  tag(e: E, code, i, r) {
    switch (code) {
      case 10: return pt(e, 'insert', i, r);
      case 11: return pt(e, 'u', i, r);
      case 12: return pt(e, 'v', i, r);
      case 13: {
        const { p, used } = r.point(i);
        e.size = [p[0], p[1]];
        return used;
      }
      case 340: e.imageDef = r.raw(i).trim(); return 1;
      case 360: e.imageDefReactor = r.raw(i).trim(); return 1;
      case 70: e.displayFlags = r.n(i); return 1;
      case 280: e.clipping = r.n(i) !== 0; return 1;
      case 281: e.brightness = r.n(i); return 1;
      case 282: e.contrast = r.n(i); return 1;
      case 283: e.fade = r.n(i); return 1;
      case 71: e.clipType = r.n(i); return 1;
      case 91: return 1;
      case 14: {
        const x = r.n(i);
        const y = i + 1 < r.end && r.tags.code(i + 1) === 24 ? r.n(i + 1) : 0;
        e.clip.push([x, y]);
        return i + 1 < r.end && r.tags.code(i + 1) === 24 ? 2 : 1;
      }
      case 290: e.clipInverted = r.n(i) !== 0; return 1;
      default: return 0;
    }
  },
};

export const UNDERLAY: EntitySpec = {
  init(e: E) {
    e.insert = [0, 0, 0];
    e.scale = [1, 1, 1];
    e.rotation = 0;
    e.flags = 0;
    e.clip = [] as [number, number][];
  },
  tag(e: E, code, i, r) {
    switch (code) {
      case 340: e.definition = r.raw(i).trim(); return 1;
      case 10: return pt(e, 'insert', i, r);
      case 41: e.scale[0] = r.n(i); return 1;
      case 42: e.scale[1] = r.n(i); return 1;
      case 43: e.scale[2] = r.n(i); return 1;
      case 50: e.rotation = r.n(i); return 1;
      case 280: e.flags = r.n(i); return 1;
      case 281: e.contrast = r.n(i); return 1;
      case 282: e.fade = r.n(i); return 1;
      case 11: {
        const x = r.n(i);
        const y = i + 1 < r.end && r.tags.code(i + 1) === 21 ? r.n(i + 1) : 0;
        e.clip.push([x, y]);
        return i + 1 < r.end && r.tags.code(i + 1) === 21 ? 2 : 1;
      }
      default: return extrusion(e, code, i, r);
    }
  },
};

export const OLE2FRAME: EntitySpec = {
  init(e: E) {
    e.upperLeft = [0, 0, 0];
    e.lowerRight = [0, 0, 0];
  },
  tag(e: E, code, i, r) {
    switch (code) {
      case 10: return pt(e, 'upperLeft', i, r);
      case 11: return pt(e, 'lowerRight', i, r);
      case 3: e.oleType = r.s(i); return 1;
      case 71: e.objectType = r.n(i); return 1;
      case 90: e.dataLength = r.n(i); return 1;
      case 310: return 1;
      default: return 0;
    }
  },
};

export const SHAPE: EntitySpec = {
  init(e: E) {
    e.insert = [0, 0, 0];
    e.size = 1;
    e.name = '';
    e.rotation = 0;
    e.widthFactor = 1;
    e.oblique = 0;
  },
  tag(e: E, code, i, r) {
    switch (code) {
      case 10: return pt(e, 'insert', i, r);
      case 40: e.size = r.n(i); return 1;
      case 2: e.name = r.s(i).trim(); return 1;
      case 50: e.rotation = r.n(i); return 1;
      case 41: e.widthFactor = r.n(i) || 1; return 1;
      case 51: e.oblique = r.n(i); return 1;
      case 39: e.thickness = r.n(i); return 1;
      default: return extrusion(e, code, i, r);
    }
  },
};

/** ACAD_TABLE: drawn through its anonymous *T block; cell texts are kept for search. */
export const ACAD_TABLE: EntitySpec = {
  init(e: E) {
    e.name = '';
    e.insert = [0, 0, 0];
    e.scale = [1, 1, 1];
    e.rotation = 0;
    e.cells = [] as string[];
    e.rows = 0;
    e.columns = 0;
  },
  tag(e: E, code, i, r) {
    if (r.subclass === 'AcDbBlockReference' || r.subclass === '') {
      switch (code) {
        case 2: e.name = r.s(i).trim(); return 1;
        case 10: return pt(e, 'insert', i, r);
        case 41: e.scale[0] = r.n(i); return 1;
        case 42: e.scale[1] = r.n(i); return 1;
        case 43: e.scale[2] = r.n(i); return 1;
        case 50: e.rotation = r.n(i); return 1;
        default: return extrusion(e, code, i, r);
      }
    }
    if (r.subclass === 'AcDbTable') {
      switch (code) {
        case 342: e.tableStyle = r.raw(i).trim(); return 1;
        case 343: e.blockRecord = r.raw(i).trim(); return 1;
        case 11: return pt(e, 'direction', i, r);
        case 91: e.rows = r.n(i); return 1;
        case 92: e.columns = r.n(i); return 1;
        case 1:
        case 302:
          e.cells.push(r.raw(i));
          return 1;
        case 3:
          if (e.cells.length) e.cells[e.cells.length - 1] = r.raw(i) + e.cells[e.cells.length - 1];
          return 1;
        default: return 0;
      }
    }
    return 0;
  },
};

export const MESH: EntitySpec = {
  init(e: E) {
    e.vertices = [] as Vec3[];
    e.faces = [] as number[][];
    e.edges = [] as [number, number][];
    e.subdivision = 0;
  },
  tag(e: E, code, i, r) {
    switch (code) {
      case 91: e.subdivision = r.n(i); return 1;
      case 92: {
        const n = Math.trunc(r.n(i));
        let j = i + 1;
        for (let q = 0; q < n && j < r.end && r.tags.code(j) === 10; q++) {
          const { p, used } = r.point(j);
          e.vertices.push(p);
          j += used;
        }
        return j - i;
      }
      case 93: {
        const n = Math.trunc(r.n(i));
        let j = i + 1;
        let read = 0;
        while (read < n && j < r.end && r.tags.code(j) === 90) {
          const cnt = Math.trunc(r.n(j));
          j++;
          read++;
          const f: number[] = [];
          for (let q = 0; q < cnt && j < r.end && r.tags.code(j) === 90; q++, j++, read++) f.push(Math.trunc(r.n(j)));
          e.faces.push(f);
        }
        return j - i;
      }
      case 94: {
        const n = Math.trunc(r.n(i));
        let j = i + 1;
        for (let q = 0; q < n && j + 1 < r.end && r.tags.code(j) === 90; q++, j += 2) e.edges.push([Math.trunc(r.n(j)), Math.trunc(r.n(j + 1))]);
        return j - i;
      }
      default: return 0;
    }
  },
};

/** 3DSOLID / REGION / BODY / SURFACE: ACIS data (SAT text lines 1/3 or SAB in ACDSDATA). */
export const ACIS: EntitySpec = {
  init(e: E) {
    e.modelerVersion = 0;
    e.satLines = 0;
  },
  tag(e: E, code, i, r) {
    if (code === 70 && r.subclass === 'AcDbModelerGeometry') {
      e.modelerVersion = r.n(i);
      return 1;
    }
    if ((code === 1 || code === 3) && r.subclass === 'AcDbModelerGeometry') {
      if (e.satStart === undefined) e.satStart = i;
      e.satEnd = i + 1;
      e.satLines++;
      return 1;
    }
    if (code === 2 && r.subclass === 'AcDbModelerGeometry') {
      e.guid = r.raw(i);
      return 1;
    }
    return 0;
  },
};

export const PROXY: EntitySpec = {
  init(e: E) {
    e.classId = 0;
    e.appClassId = 0;
  },
  tag(e: E, code, i, r) {
    switch (code) {
      case 90: e.classId = r.n(i); return 1;
      case 91: e.appClassId = r.n(i); return 1;
      case 93: e.entityDataSize = r.n(i); return 1;
      case 95: e.format = r.n(i); return 1;
      case 70: e.originalType = r.n(i); return 1;
      default: return 0;
    }
  },
};

/** Decode SAT text lines (R2000–R2010 store them with a simple substitution). */
export function decodeSat(line: string): string {
  let out = '';
  for (const ch of line) {
    const c = ch.charCodeAt(0);
    if (c === 32) out += ' ';
    else if (c > 32 && c < 159) out += String.fromCharCode(159 - c);
    else out += ch;
  }
  return out;
}
