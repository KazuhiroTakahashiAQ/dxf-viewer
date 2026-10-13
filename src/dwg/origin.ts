import type { DxfDocument } from '../dxf/model';
import type { DwgConversion } from './convert';
import { dwgErrorNames, type DwgSignature } from './detect';

/** R13 (AC1012) changed the DWG format completely; LibreDWG reads older files only partly. */
function preR13(version: string): boolean {
  const n = /^AC1(\d{3})$/.exec(version);
  return n ? Number(n[1]) < 12 : !/^AC(402[ab]|701a)$/.test(version);
}

/** Record on a parsed document that it came from a DWG file (source info and diagnostics). */
export function noteDwgOrigin(d: DxfDocument, sig: DwgSignature, conv: DwgConversion, dwgSize: number): void {
  const errors = dwgErrorNames(conv.errorCode);
  d.source.dwg = { version: sig.version, release: sig.release, size: dwgSize, converter: conv.converter, errors, ms: conv.ms };
  const notes: typeof d.diagnostics = [
    {
      level: 'info',
      code: 'dwg-converted',
      message: `Converted from DWG ${sig.version}${sig.release ? ` (${sig.release})` : ''} with ${conv.converter}; line numbers and group codes are those of the converted DXF`,
    },
  ];
  if (errors.length) notes.push({ level: 'warning', code: 'dwg-errors', message: `LibreDWG reported recoverable errors: ${errors.join(', ')}` });
  // the DXF writer gets layer on / off wrong for R13+ (see readLayerOff); the DWG's flag decides
  const layerOff = conv.layerOff;
  let corrected = 0;
  if (layerOff) {
    for (const l of d.layers.values()) {
      const off = l.handle ? layerOff[l.handle.toUpperCase()] : undefined;
      if (off === undefined || off === (l.color < 0)) continue;
      const aci = Math.abs(l.color) || 7;
      l.color = off ? -aci : aci;
      corrected++;
    }
  }
  if (corrected) notes.push({ level: 'info', code: 'dwg-layer-off', message: `On / off of ${corrected} layers taken from the DWG (the converted DXF has them wrong)` });
  if (preR13(sig.version)) notes.push({ level: 'warning', code: 'dwg-old', message: 'LibreDWG reads DWG files older than R13 only partly; some entities may be missing' });
  if (!d.entities.length) notes.push({ level: 'warning', code: 'dwg-empty', message: 'LibreDWG found no entities in this DWG file' });
  d.diagnostics.unshift(...notes);
}
