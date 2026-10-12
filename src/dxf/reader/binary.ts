import type { Diagnostic } from '../model';
import { codepageToEncoding } from './encoding';
import { ValueTagStore } from './tagStore';

const SENTINEL = 'AutoCAD Binary DXF\r\n\x1a\x00';

export function isBinaryDxf(bytes: Uint8Array): boolean {
  if (bytes.length < SENTINEL.length) return false;
  for (let i = 0; i < SENTINEL.length; i++) if (bytes[i] !== SENTINEL.charCodeAt(i)) return false;
  return true;
}

type ValueKind = 'str' | 'f64' | 'i16' | 'i32' | 'i64' | 'bool' | 'bin';

function kindOf(code: number): ValueKind {
  if (code >= 10 && code <= 59) return 'f64';
  if (code >= 60 && code <= 79) return 'i16';
  if (code >= 90 && code <= 99) return 'i32';
  if (code >= 110 && code <= 149) return 'f64';
  if (code >= 160 && code <= 169) return 'i64';
  if (code >= 170 && code <= 179) return 'i16';
  if (code >= 210 && code <= 239) return 'f64';
  if (code >= 270 && code <= 289) return 'i16';
  if (code >= 290 && code <= 299) return 'bool';
  if (code >= 310 && code <= 319) return 'bin';
  if (code >= 370 && code <= 389) return 'i16';
  if (code >= 400 && code <= 409) return 'i16';
  if (code >= 420 && code <= 429) return 'i32';
  if (code >= 440 && code <= 459) return 'i32';
  if (code >= 460 && code <= 469) return 'f64';
  if (code === 1004) return 'bin';
  if (code >= 1010 && code <= 1059) return 'f64';
  if (code >= 1060 && code <= 1070) return 'i16';
  if (code === 1071) return 'i32';
  return 'str';
}

function hex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0').toUpperCase();
  return s;
}

function readAll(bytes: Uint8Array, decoder: TextDecoder, diagnostics: Diagnostic[], stopAfterHeader: boolean): ValueTagStore {
  const store = new ValueTagStore();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = SENTINEL.length;
  // R12 binary uses 1-byte group codes, R13+ 2-byte codes.
  const twoByte = bytes[pos + 1] === 0;
  const n = bytes.length;
  let prevWasEndsec = false;
  while (pos < n) {
    const offset = pos;
    let code: number;
    if (twoByte) {
      if (pos + 2 > n) break;
      code = view.getInt16(pos, true);
      pos += 2;
    } else {
      code = bytes[pos++];
      if (code === 255) {
        if (pos + 2 > n) break;
        code = view.getInt16(pos, true);
        pos += 2;
      }
    }
    let value: string | number;
    const kind = kindOf(code);
    try {
      switch (kind) {
        case 'f64':
          value = view.getFloat64(pos, true);
          pos += 8;
          break;
        case 'i16':
          value = view.getInt16(pos, true);
          pos += 2;
          break;
        case 'i32':
          value = view.getInt32(pos, true);
          pos += 4;
          break;
        case 'i64':
          value = Number(view.getBigInt64(pos, true));
          pos += 8;
          break;
        case 'bool':
          value = bytes[pos];
          pos += 1;
          break;
        case 'bin': {
          const len = bytes[pos];
          value = hex(bytes.subarray(pos + 1, pos + 1 + len));
          pos += 1 + len;
          break;
        }
        default: {
          let end = pos;
          while (end < n && bytes[end] !== 0) end++;
          value = decoder.decode(bytes.subarray(pos, end));
          pos = end + 1;
        }
      }
    } catch {
      diagnostics.push({ level: 'error', code: 'binary-truncated', message: `Truncated binary DXF at byte ${offset}`, line: offset });
      break;
    }
    store.push(code, value, offset);
    if (code === 0 && typeof value === 'string') {
      const v = value.trim().toUpperCase();
      if (v === 'EOF') break;
      if (stopAfterHeader && v === 'ENDSEC' && !prevWasEndsec) return store;
      prevWasEndsec = v === 'ENDSEC';
    }
  }
  return store;
}

/** Parse binary DXF; text encoding comes from $ACADVER/$DWGCODEPAGE unless overridden. */
export function parseBinaryDxf(bytes: Uint8Array, encodingOverride: string | undefined, diagnostics: Diagnostic[]): ValueTagStore {
  let encoding = encodingOverride;
  if (!encoding) {
    const probe = readAll(bytes, new TextDecoder('windows-1252'), [], true);
    let acadver = '';
    let codepage = '';
    for (let i = 0; i + 1 < probe.count; i++) {
      if (probe.code(i) === 9) {
        const name = probe.str(i).trim().toUpperCase();
        if (name === '$ACADVER') acadver = probe.str(i + 1).trim();
        if (name === '$DWGCODEPAGE') codepage = probe.str(i + 1).trim();
      }
    }
    const ver = Number(/AC(\d{4})/i.exec(acadver)?.[1] ?? 0);
    encoding = ver >= 1021 ? 'utf-8' : (codepageToEncoding(codepage) ?? 'windows-1252');
  }
  return readAll(bytes, new TextDecoder(encoding), diagnostics, false);
}
