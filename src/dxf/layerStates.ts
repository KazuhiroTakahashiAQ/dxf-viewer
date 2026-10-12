import { nameKey, type DxfDocument } from './model';
import { dictEntries, dictLookup, objectByHandle, recordTags } from './objects';
import { decodeEscapes } from './text/escapes';

/** LayerPropertiesFlags (per layer, group code 90). */
export const LS_OFF = 1;
export const LS_FROZEN = 2;
export const LS_LOCKED = 4;
export const LS_PLOT = 8;
export const LS_NEW_VP_FROZEN = 16;
export const LS_VP_FROZEN = 32;

/** Restore flags of the state (group code 91): which properties the state restores. */
export const LSR_ON = 1;
export const LSR_FROZEN = 2;
export const LSR_LOCKED = 4;
export const LSR_PLOT = 8;
export const LSR_COLOR = 64;
export const LSR_LINETYPE = 128;
export const LSR_LINEWEIGHT = 256;
export const LSR_TRANSPARENCY = 512;

export interface LayerStateLayer {
  name: string;
  flags: number;
  /** ACI (sign ignored) */
  color?: number;
  trueColor?: number;
  lineweight?: number;
  linetype?: string;
  /** raw 440 alpha value */
  transparency?: number;
}

export interface LayerStateDef {
  name: string;
  description: string;
  currentLayer?: string;
  paperSpace: boolean;
  /** 91; all properties when missing */
  restoreFlags: number;
  layers: LayerStateLayer[];
  /** XRECORD handle */
  handle: string;
}

/**
 * Layer states stored by AutoCAD's Layer States Manager: the LAYER table's
 * extension dictionary → ACAD_LAYERSTATES → one XRECORD per state.
 * Record layout follows netDxf (DxfReader.BuildLayerStateManager) and AutoCAD output:
 * 91 restore flags, 301 description, 290 paper space, 302 current layer,
 * then per layer 8 (name) or 330 (LAYER handle) followed by 90 flags, 62 color,
 * 370 lineweight, 6 / 331 linetype, 1 plot style, 440 transparency, 92 true color.
 */
export function readLayerStates(doc: DxfDocument): LayerStateDef[] {
  const table = doc.tableRecords.find((r) => r.table === 'LAYER:TABLE');
  const xdict = table?.xdict as string | undefined;
  if (!xdict) return [];
  const states = dictLookup(doc, xdict, 'ACAD_LAYERSTATES');
  if (!states) return [];
  const layerByHandle = new Map<string, string>();
  for (const l of doc.layers.values()) if (l.handle) layerByHandle.set(l.handle.toUpperCase(), l.name);
  const ltByHandle = new Map<string, string>();
  for (const lt of doc.linetypes.values()) if (lt.handle) ltByHandle.set(lt.handle.toUpperCase(), lt.name);
  const out: LayerStateDef[] = [];
  for (const [name, handle] of dictEntries(states)) {
    const xr = objectByHandle(doc, handle);
    if (!xr || xr.type !== 'XRECORD') continue;
    const def: LayerStateDef = { name, description: '', paperSpace: false, restoreFlags: 0x7ff, layers: [], handle };
    let cur: LayerStateLayer | null = null;
    let inData = false;
    const t = doc.tags;
    for (const [c, i] of recordTags(doc, xr.tagStart, xr.tagEnd)) {
      if (c === 100) {
        inData = t.str(i).trim() === 'AcDbXrecord';
        continue;
      }
      if (!inData) continue;
      if (c === 8 || c === 330) {
        const layerName = c === 8 ? decodeEscapes(t.str(i)).trim() : layerByHandle.get(t.str(i).trim().toUpperCase());
        cur = layerName !== undefined ? { name: layerName, flags: LS_PLOT } : null;
        if (cur) def.layers.push(cur);
        continue;
      }
      if (!cur) {
        if (c === 91) def.restoreFlags = t.num(i);
        else if (c === 301) def.description = decodeEscapes(t.str(i));
        else if (c === 302) def.currentLayer = decodeEscapes(t.str(i)).trim();
        else if (c === 290) def.paperSpace = t.num(i) !== 0;
        continue;
      }
      if (c === 90) cur.flags = t.num(i);
      else if (c === 62) cur.color = Math.abs(t.num(i));
      else if (c === 92) cur.trueColor = t.num(i) & 0xffffff;
      else if (c === 370) cur.lineweight = t.num(i);
      else if (c === 6) cur.linetype = decodeEscapes(t.str(i)).trim();
      else if (c === 331) cur.linetype ??= ltByHandle.get(t.str(i).trim().toUpperCase());
      else if (c === 440) cur.transparency = t.num(i);
    }
    // keep only layers that exist in the drawing (unknown names are ignored by AutoCAD too)
    def.layers = def.layers.filter((l) => doc.layers.has(nameKey(l.name)));
    out.push(def);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}
