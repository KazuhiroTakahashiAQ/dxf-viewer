import { nameKey, type DxfDocument, type Entity } from './model';
import { blockNameByRecord, recordTags } from './objects';
import { decodeEscapes } from './text/escapes';

/** Subset of dimension style variables used for rendering annotations. */
export interface DimVars {
  scale: number; // DIMSCALE 40
  asz: number; // DIMASZ 41
  txt: number; // DIMTXT 140
  gap: number; // DIMGAP 147
  exo: number; // DIMEXO 42
  exe: number; // DIMEXE 44
  tsz: number; // DIMTSZ 142 (tick size)
  blk: string; // DIMBLK (342 handle or 5 name)
  blk1: string;
  blk2: string;
  sah: boolean; // DIMSAH 173
  ldrblk: string; // DIMLDRBLK 341
  txsty?: string; // DIMTXSTY 340 (style handle)
  clrd: number; // DIMCLRD 176
  clrt: number; // DIMCLRT 178
  dec: number; // DIMDEC 271
  post: string; // DIMPOST 3
}

const DEFAULTS: DimVars = {
  scale: 1,
  asz: 0.18,
  txt: 0.18,
  gap: 0.09,
  exo: 0.0625,
  exe: 0.18,
  tsz: 0,
  blk: '',
  blk1: '',
  blk2: '',
  sah: false,
  ldrblk: '',
  clrd: 0,
  clrt: 0,
  dec: 4,
  post: '',
};

function apply(doc: DxfDocument, v: DimVars, code: number, value: string | number): void {
  const num = typeof value === 'number' ? value : parseFloat(value);
  const str = typeof value === 'string' ? value.trim() : String(value);
  switch (code) {
    case 40: v.scale = num || 1; break;
    case 41: v.asz = num; break;
    case 140: v.txt = num; break;
    case 147: v.gap = num; break;
    case 42: v.exo = num; break;
    case 44: v.exe = num; break;
    case 142: v.tsz = num; break;
    case 173: v.sah = num !== 0; break;
    case 176: v.clrd = num; break;
    case 178: v.clrt = num; break;
    case 271: v.dec = num; break;
    case 3: v.post = decodeEscapes(str); break;
    case 5: v.blk = str; break;
    case 6: v.blk1 = str; break;
    case 7: v.blk2 = str; break;
    case 342: v.blk = blockNameByRecord(doc, str) ?? v.blk; break;
    case 343: v.blk1 = blockNameByRecord(doc, str) ?? v.blk1; break;
    case 344: v.blk2 = blockNameByRecord(doc, str) ?? v.blk2; break;
    case 341: v.ldrblk = blockNameByRecord(doc, str) ?? v.ldrblk; break;
    case 340: v.txsty = str; break;
    default: break;
  }
}

const cache = new WeakMap<DxfDocument, Map<string, DimVars>>();

/** Dimension variables of a DIMSTYLE plus the entity's ACAD DSTYLE overrides. */
export function dimVars(doc: DxfDocument, styleName: string, e?: Entity): DimVars {
  let m = cache.get(doc);
  if (!m) {
    m = new Map();
    cache.set(doc, m);
  }
  let base = m.get(nameKey(styleName));
  if (!base) {
    base = { ...DEFAULTS };
    if (doc.header.get('$MEASUREMENT')?.values[0] === 1) Object.assign(base, { asz: 2.5, txt: 2.5, gap: 0.625, exo: 0.625, exe: 1.25 });
    const rec = doc.tableRecords.find((r) => r.table === 'DIMSTYLE' && nameKey(r.name) === nameKey(styleName));
    if (rec) for (const [c, i] of recordTags(doc, rec.tag, rec.tagEnd)) apply(doc, base, c, doc.tags.str(i));
    m.set(nameKey(styleName), base);
  }
  if (!e?.xdataStart) return base;
  // XDATA: 1001 ACAD, 1000 DSTYLE, 1002 {, (1070 code, value)*, 1002 }
  const v = { ...base };
  const t = doc.tags;
  let inAcad = false;
  let inStyle = false;
  for (let i = e.xdataStart; i < e.tagEnd; i++) {
    const c = t.code(i);
    if (c === 1001) {
      inAcad = t.str(i).trim().toUpperCase() === 'ACAD';
      inStyle = false;
      continue;
    }
    if (!inAcad) continue;
    if (c === 1000 && t.str(i).trim().toUpperCase() === 'DSTYLE') inStyle = true;
    else if (c === 1002 && t.str(i).trim() === '}') inStyle = false;
    else if (inStyle && c === 1070 && i + 1 < e.tagEnd) {
      const code = t.num(i);
      const vc = t.code(i + 1);
      // 1005 handles reference block records / styles
      apply(doc, v, code, vc === 1005 ? t.str(i + 1) : vc === 1000 ? t.str(i + 1) : t.num(i + 1));
      i++;
    }
  }
  return v;
}
