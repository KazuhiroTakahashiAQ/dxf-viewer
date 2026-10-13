/**
 * DWG file signature and LibreDWG error codes. Free of the WebAssembly module
 * so a file can be classified without loading the converter.
 */

/** Signature (first bytes) → release, after LibreDWG's version table. */
const DWG_RELEASES: Record<string, string> = {
  'MC0.0': 'MicroCAD R1.1',
  'AC1.2': 'R1.2',
  'AC1.3': 'R1.3',
  'AC1.40': 'R1.4',
  'AC1.50': 'R2.0',
  'AC2.10': 'R2.10',
  'AC2.21': 'R2.21',
  'AC2.22': 'R2.22',
  AC1001: 'R2.4',
  AC1002: 'R2.5',
  AC1003: 'R2.6',
  AC1004: 'R9',
  AC1005: 'R9c1',
  AC1006: 'R10',
  AC1007: 'R11 beta',
  AC1008: 'R11 beta',
  AC1009: 'R11/R12',
  AC1010: 'R13 beta',
  AC1011: 'R13 beta',
  AC1012: 'R13',
  AC1013: 'R13c3',
  AC1014: 'R14',
  AC1500: 'R2000 beta',
  AC1015: 'R2000',
  AC1016: 'R2000i',
  AC1017: 'R2002',
  AC402a: 'R2004 alpha',
  AC402b: 'R2004 alpha',
  AC1018: 'R2004',
  AC701a: 'R2007 beta',
  AC1021: 'R2007',
  AC1024: 'R2010',
  AC1027: 'R2013',
  AC1032: 'R2018',
};

export interface DwgSignature {
  /** e.g. "AC1032" */
  version: string;
  /** e.g. "R2018" (undefined for signatures newer than this table) */
  release?: string;
}

/**
 * The DWG signature of a file, or null for anything else. DXF never starts
 * like this: ASCII DXF begins with a group code and binary DXF with
 * "AutoCAD Binary DXF".
 */
export function dwgSignature(bytes: Uint8Array): DwgSignature | null {
  const head = String.fromCharCode(...bytes.subarray(0, 6));
  const m = /^(?:MC0\.0|AC2\.2[12]|AC[12]\.\d0?|AC1\d{3}|AC402[ab]|AC701a)/.exec(head);
  if (!m) return null;
  return { version: m[0], release: DWG_RELEASES[m[0]] };
}

/** Dwg_Error bit flags returned by LibreDWG. */
const DWG_ERRORS: [number, string][] = [
  [1, 'WRONGCRC'],
  [2, 'NOTYETSUPPORTED'],
  [4, 'UNHANDLEDCLASS'],
  [8, 'INVALIDTYPE'],
  [16, 'INVALIDHANDLE'],
  [32, 'INVALIDEED'],
  [64, 'VALUEOUTOFBOUNDS'],
  [128, 'CLASSESNOTFOUND'],
  [256, 'SECTIONNOTFOUND'],
  [512, 'PAGENOTFOUND'],
  [1024, 'INTERNALERROR'],
  [2048, 'INVALIDDWG'],
  [4096, 'IOERROR'],
  [8192, 'OUTOFMEM'],
];

/** LibreDWG treats DWG_ERR_CLASSESNOTFOUND and above as critical. */
export const DWG_ERR_CRITICAL = 128;

export function dwgErrorNames(code: number): string[] {
  return DWG_ERRORS.filter(([bit]) => code & bit).map(([, name]) => name);
}
