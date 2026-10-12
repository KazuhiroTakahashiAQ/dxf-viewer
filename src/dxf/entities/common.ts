import type { Vec3 } from '../../geom/vec';
import type { Diagnostic, EntityBase } from '../model';
import type { TagStore } from '../reader/tagStore';
import { decodeEscapes } from '../text/escapes';

/**
 * Per-type tag handler. Returns the number of tags consumed starting at `i`
 * (0 = not handled). Handlers may read ahead for multi-tag structures.
 */
export interface EntitySpec {
  init(e: EntityBase): void;
  tag(e: EntityBase, code: number, i: number, r: TagReader): number;
  finish?(e: EntityBase, r: TagReader): void;
}

export interface TagReader {
  tags: TagStore;
  end: number;
  diagnostics: Diagnostic[];
  /** decoded string (escapes resolved) */
  s(i: number): string;
  /** raw string */
  raw(i: number): string;
  n(i: number): number;
  /** read a point: x at i, y/z from the following tags if their codes match x+10/x+20 */
  point(i: number): { p: Vec3; used: number };
  /** current subclass marker (last 100 value) */
  subclass: string;
}

export function makeReader(tags: TagStore, end: number, diagnostics: Diagnostic[]): TagReader {
  const r: TagReader = {
    tags,
    end,
    diagnostics,
    subclass: '',
    s: (i) => decodeEscapes(tags.str(i)),
    raw: (i) => tags.str(i),
    n: (i) => {
      const v = tags.num(i);
      return Number.isFinite(v) ? v : 0;
    },
    point: (i) => {
      const code = tags.code(i);
      const x = r.n(i);
      let y = 0;
      let z = 0;
      let used = 1;
      if (i + 1 < end && tags.code(i + 1) === code + 10) {
        y = r.n(i + 1);
        used++;
        if (i + 2 < end && tags.code(i + 2) === code + 20) {
          z = r.n(i + 2);
          used++;
        }
      }
      return { p: [x, y, z], used };
    },
  };
  return r;
}

/** Codes handled as common entity properties. */
const COMMON_CODES = new Set([5, 6, 8, 48, 60, 62, 67, 330, 370, 410, 420, 430, 440, 284, 347, 348, 390]);

/**
 * Parse one entity record [start, end) into `e` using `spec`.
 * Handles subclass markers, 102 groups, common properties and XDATA.
 */
export function parseEntityRecord(
  e: EntityBase,
  spec: EntitySpec | undefined,
  tags: TagStore,
  start: number,
  end: number,
  diagnostics: Diagnostic[],
): void {
  const r = makeReader(tags, end, diagnostics);
  spec?.init(e);
  // Common properties live in the AcDbEntity subclass (or anywhere in R12,
  // which has no subclass markers). Later subclasses may reuse those codes.
  let commonPhase = true;
  const seen = new Set<number>();
  let i = start + 1;
  while (i < end) {
    const code = tags.code(i);
    if (code === 102) {
      const v = tags.str(i).trim();
      if (v.startsWith('{')) {
        const group = v.slice(1).toUpperCase();
        let j = i + 1;
        while (j < end && !(tags.code(j) === 102 && tags.str(j).trim() === '}')) {
          if (group === 'ACAD_REACTORS' && tags.code(j) === 330) (e.reactors ??= []).push(tags.str(j).trim());
          if (group === 'ACAD_XDICTIONARY' && (tags.code(j) === 360 || tags.code(j) === 330)) e.xdict = tags.str(j).trim();
          j++;
        }
        i = j + 1;
        continue;
      }
      i++;
      continue;
    }
    if (code >= 1000) {
      parseXdataApps(e, tags, i, end);
      break;
    }
    if (code === 100) {
      const v = tags.str(i).trim();
      (e.subclasses ??= []).push(v);
      r.subclass = v;
      commonPhase = v === 'AcDbEntity';
      i++;
      continue;
    }
    if (commonPhase && COMMON_CODES.has(code) && !(code === 5 && seen.has(5))) {
      applyCommon(e, code, i, tags);
      seen.add(code);
      i++;
      continue;
    }
    const used = spec ? spec.tag(e, code, i, r) : 0;
    if (used > 0) {
      i += used;
      continue;
    }
    // Lenient: common codes appearing late (non-AutoCAD writers)
    if (COMMON_CODES.has(code) && !seen.has(code)) {
      applyCommon(e, code, i, tags);
      seen.add(code);
    }
    i++;
  }
  spec?.finish?.(e, r);
}

function applyCommon(e: EntityBase, code: number, i: number, tags: TagStore): void {
  switch (code) {
    case 5:
      e.handle = tags.str(i).trim();
      break;
    case 330:
      if (e.owner === undefined) e.owner = tags.str(i).trim();
      break;
    case 8:
      e.layer = decodeEscapes(tags.str(i));
      break;
    case 6:
      e.linetype = decodeEscapes(tags.str(i).trim());
      break;
    case 62:
      e.color = Math.trunc(tags.num(i));
      break;
    case 420:
      e.trueColor = Math.trunc(tags.num(i)) & 0xffffff;
      break;
    case 430:
      e.colorName = tags.str(i);
      break;
    case 440:
      e.transparency = Math.trunc(tags.num(i));
      break;
    case 370:
      e.lineweight = Math.trunc(tags.num(i));
      break;
    case 48:
      e.ltscale = tags.num(i);
      break;
    case 60:
      e.invisible = Math.trunc(tags.num(i)) === 1;
      break;
    case 67:
      e.paperSpace = Math.trunc(tags.num(i)) === 1;
      break;
    case 410:
      e.layoutName = decodeEscapes(tags.str(i));
      break;
    default:
      break;
  }
}

function parseXdataApps(e: EntityBase, tags: TagStore, start: number, end: number): void {
  e.xdataStart = start;
  for (let i = start; i < end; i++) {
    if (tags.code(i) === 1001) (e.xdataApps ??= []).push(tags.str(i).trim());
  }
}

export function newEntityBase(type: string, id: number, tagStart: number, tagEnd: number): EntityBase {
  return {
    id,
    type,
    handle: '',
    layer: '0',
    color: 256,
    lineweight: -1,
    ltscale: 1,
    invisible: false,
    paperSpace: false,
    tagStart,
    tagEnd,
  };
}
