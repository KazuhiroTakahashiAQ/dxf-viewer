import type { Diagnostic } from '../model';

/**
 * Lossless storage of every (group code, value) pair of a DXF file.
 * Values are materialized lazily so large files stay compact in memory.
 */
export interface TagStore {
  readonly count: number;
  readonly binary: boolean;
  /** total number of physical lines (ASCII) */
  readonly lineCount: number;
  code(i: number): number;
  /** raw string value (escape sequences are NOT decoded) */
  str(i: number): string;
  /** numeric value (NaN if not a number) */
  num(i: number): number;
  /** 1-based line number of the group code line (ASCII) or byte offset (binary) */
  line(i: number): number;
}

export class AsciiTagStore implements TagStore {
  readonly binary = false;
  count = 0;
  lineCount = 0;
  private codes: Int32Array;
  private vs: Uint32Array;
  private ve: Uint32Array;
  private lines: Uint32Array;
  readonly text: string;

  constructor(text: string, capacity: number) {
    this.text = text;
    this.codes = new Int32Array(capacity);
    this.vs = new Uint32Array(capacity);
    this.ve = new Uint32Array(capacity);
    this.lines = new Uint32Array(capacity);
  }

  push(code: number, vs: number, ve: number, line: number): void {
    if (this.count === this.codes.length) this.grow();
    const i = this.count++;
    this.codes[i] = code;
    this.vs[i] = vs;
    this.ve[i] = ve;
    this.lines[i] = line;
  }

  private grow(): void {
    const cap = Math.max(1024, this.codes.length * 2);
    const c = new Int32Array(cap);
    c.set(this.codes);
    this.codes = c;
    const a = new Uint32Array(cap);
    a.set(this.vs);
    this.vs = a;
    const b = new Uint32Array(cap);
    b.set(this.ve);
    this.ve = b;
    const l = new Uint32Array(cap);
    l.set(this.lines);
    this.lines = l;
  }

  code(i: number): number {
    return this.codes[i];
  }

  str(i: number): string {
    return this.text.slice(this.vs[i], this.ve[i]);
  }

  num(i: number): number {
    return parseFloat(this.text.slice(this.vs[i], this.ve[i]));
  }

  line(i: number): number {
    return this.lines[i];
  }

  /** Offsets of the value text, used by the raw view. */
  valueRange(i: number): [number, number] {
    return [this.vs[i], this.ve[i]];
  }
}

/** Tag store for binary DXF where values are already typed. */
export class ValueTagStore implements TagStore {
  readonly binary = true;
  readonly lineCount = 0;
  private codes: number[] = [];
  private values: (string | number)[] = [];
  private offsets: number[] = [];

  get count(): number {
    return this.codes.length;
  }

  push(code: number, value: string | number, offset: number): void {
    this.codes.push(code);
    this.values.push(value);
    this.offsets.push(offset);
  }

  code(i: number): number {
    return this.codes[i];
  }

  str(i: number): string {
    const v = this.values[i];
    return typeof v === 'string' ? v : String(v);
  }

  num(i: number): number {
    const v = this.values[i];
    return typeof v === 'number' ? v : parseFloat(v);
  }

  line(i: number): number {
    return this.offsets[i];
  }
}

/**
 * Split decoded DXF text into tag pairs. Accepts CRLF, LF and CR line endings,
 * blank/whitespace-padded group code lines and a missing EOF marker.
 */
export function buildAsciiTagStore(text: string, diagnostics: Diagnostic[]): AsciiTagStore {
  const len = text.length;
  const store = new AsciiTagStore(text, Math.max(1024, Math.ceil(len / 8)));
  let pos = 0;
  let line = 0;
  let badCodes = 0;

  // Read one physical line; returns [start, end) excluding the terminator.
  let ls = 0;
  let le = 0;
  const nextLine = (): boolean => {
    if (pos >= len) return false;
    ls = pos;
    let p = pos;
    while (p < len) {
      const ch = text.charCodeAt(p);
      if (ch === 10 || ch === 13) break;
      p++;
    }
    le = p;
    if (p < len) {
      if (text.charCodeAt(p) === 13 && p + 1 < len && text.charCodeAt(p + 1) === 10) p += 2;
      else p += 1;
    }
    pos = p;
    line++;
    return true;
  };

  while (nextLine()) {
    const codeLine = line;
    const codeStr = text.slice(ls, le).trim();
    if (codeStr === '' && pos >= len) break; // trailing empty line
    const code = codeStr === '' ? NaN : Number(codeStr);
    if (!Number.isInteger(code)) {
      badCodes++;
      if (badCodes <= 50) {
        diagnostics.push({
          level: 'warning',
          code: 'bad-group-code',
          message: `Invalid group code "${codeStr.slice(0, 40)}"; skipping line to resynchronize`,
          line: codeLine,
        });
      }
      continue;
    }
    if (!nextLine()) {
      diagnostics.push({ level: 'warning', code: 'missing-value', message: `Group code ${code} without value at end of file`, line: codeLine });
      break;
    }
    store.push(code, ls, le, codeLine);
  }
  if (badCodes > 50) {
    diagnostics.push({ level: 'warning', code: 'bad-group-code', message: `${badCodes} invalid group code lines in total` });
  }
  store.lineCount = line;
  return store;
}
