import createModule, { type MainModule } from 'libredwg-web-wasm/libredwg-web.js';
import { DWG_ERR_CRITICAL, dwgErrorNames } from './detect';

export interface DwgConversion {
  /** DXF written by LibreDWG */
  dxf: Uint8Array;
  /** LibreDWG error flags; recoverable ones still produce a DXF */
  errorCode: number;
  /** e.g. "LibreDWG 0.13.3.7825" (from the DXF's leading 999 comment) */
  converter: string;
  /** layer off flags read from the DWG, by handle (hex); null if they could not be read */
  layerOff: Record<string, boolean> | null;
  ms: number;
}

export interface ConvertOptions {
  /** URL of libredwg-web.wasm (browser); Node finds it next to the module */
  wasmUrl?: string;
}

export class DwgConvertError extends Error {
  constructor(readonly code: number) {
    super(`Could not convert the DWG file (LibreDWG: ${dwgErrorNames(code).join(', ') || (code ? `error ${code}` : 'no output')})`);
  }
}

/** Dwg_Object_Type.TYPE_LAYER */
const TYPE_LAYER = 51;

/**
 * Layer off flags as decoded from the DWG. The DXF writer of the bundled
 * LibreDWG (0.13.3) negates the color of every R13+ layer, i.e. writes them
 * all as off; it decodes the flag correctly, so the viewer takes it from here.
 */
function readLayerOff(mod: MainModule, path: string): Record<string, boolean> {
  const r = mod.dwg_read_file(path);
  if (!r?.data) return {};
  const off: Record<string, boolean> = {};
  try {
    if (r.error >= DWG_ERR_CRITICAL) return off;
    const n = mod.dwg_get_num_objects(r.data);
    for (let i = 0; i < n; i++) {
      const obj = mod.dwg_get_object(r.data, i);
      if (mod.dwg_object_get_fixedtype(obj) !== TYPE_LAYER) continue;
      const handle = mod.dwg_object_get_handle_object(obj)?.value as bigint | number | undefined;
      const v = mod.dwg_dynapi_entity_value(mod.dwg_object_to_object_tio(obj), 'off') as { success: boolean; data: unknown };
      if (handle !== undefined && v?.success) off[handle.toString(16).toUpperCase()] = !!v.data;
    }
  } finally {
    mod.dwg_free(r.data);
  }
  return off;
}

/**
 * Convert a DWG file to DXF with LibreDWG. Each call instantiates its own
 * module: WebAssembly memory never shrinks and the module does not survive
 * many files reliably, so callers run this in a worker that is terminated
 * afterwards.
 */
export async function convertDwg(bytes: Uint8Array, opts: ConvertOptions = {}): Promise<DwgConversion> {
  const t0 = performance.now();
  const mod = await createModule({
    ...(opts.wasmUrl ? { locateFile: () => opts.wasmUrl } : {}),
    print: () => {},
    printErr: () => {},
  });
  mod.FS.writeFile('/in.dwg', bytes);
  const code = mod.dwg_write_dxf('/in.dwg', '/out.dxf');
  const dxf: Uint8Array | null = mod.FS.analyzePath('/out.dxf', false).exists ? mod.FS.readFile('/out.dxf') : null;
  if (code >= DWG_ERR_CRITICAL || !dxf?.length) throw new DwgConvertError(code);
  const head = new TextDecoder('latin1').decode(dxf.subarray(0, 200));
  const converter = /^\s*999\r?\n(LibreDWG[^\r\n]*)/.exec(head)?.[1].trim() ?? 'LibreDWG';
  let layerOff: Record<string, boolean> | null = null;
  try {
    layerOff = readLayerOff(mod, '/in.dwg');
  } catch {
    // the DXF is already there; keep it with the layer states it says
  }
  return { dxf, errorCode: code, converter, layerOff, ms: performance.now() - t0 };
}
