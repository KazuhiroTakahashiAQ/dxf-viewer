/** Build DXF text from [code, value] pairs. */
export function dxf(pairs: [number, string | number][], eol = '\r\n'): string {
  return pairs.map(([c, v]) => `${String(c).padStart(3, ' ')}${eol}${v}`).join(eol) + eol;
}

export function enc(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Minimal R12-like document with only an ENTITIES section. */
export function entitiesDoc(entities: [number, string | number][]): [number, string | number][] {
  return [[0, 'SECTION'], [2, 'ENTITIES'], ...entities, [0, 'ENDSEC'], [0, 'EOF']];
}
