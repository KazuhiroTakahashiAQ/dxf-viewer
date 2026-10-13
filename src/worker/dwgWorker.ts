/// <reference lib="webworker" />
/**
 * One-shot DWG → DXF converter. LibreDWG's WebAssembly module reserves about
 * 1 GB of memory, so it runs in its own worker that the document worker
 * terminates after one conversion.
 */
import wasmUrl from 'libredwg-web-wasm/libredwg-web.wasm?url';
import { convertDwg, DwgConvertError, type DwgConversion } from '../dwg/convert';

declare const self: DedicatedWorkerGlobalScope;

export type DwgWorkerReply = ({ ok: true } & DwgConversion) | { ok: false; error: string; code?: number };

self.onmessage = async (e: MessageEvent<{ bytes: ArrayBuffer }>) => {
  try {
    const r = await convertDwg(new Uint8Array(e.data.bytes), { wasmUrl });
    // FS.readFile returns a fresh buffer; anything else must not be transferred
    const own = r.dxf.byteOffset === 0 && r.dxf.byteLength === r.dxf.buffer.byteLength;
    self.postMessage({ ok: true, ...r } satisfies DwgWorkerReply, own ? [r.dxf.buffer] : []);
  } catch (err) {
    // anything but DwgConvertError is LibreDWG crashing (e.g. a WebAssembly trap on a damaged file)
    const reply: DwgWorkerReply =
      err instanceof DwgConvertError ? { ok: false, error: err.message, code: err.code } : { ok: false, error: `DWG converter failed: ${(err as Error).message}` };
    self.postMessage(reply);
  }
};
