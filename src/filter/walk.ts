import { nameKey, type DxfDocument, type Entity, type InsertEntity } from '../dxf/model';
import { TOP_CTX, type InheritCtx, type StyleResolver } from '../scene/style';

const CONTAINERS = new Set(['INSERT', 'DIMENSION', 'ARC_DIMENSION', 'LARGE_RADIAL_DIMENSION', 'ACAD_TABLE']);

function containerBlock(e: Entity): string | undefined {
  if (e.type === 'INSERT' || e.type === 'ACAD_TABLE') return String(e.name ?? '') || undefined;
  if (CONTAINERS.has(e.type)) return String(e.blockName ?? '') || undefined;
  return undefined;
}

/**
 * Visit every leaf entity (anything that is not a block reference) under the
 * given top-level ids, with inherited properties and the block path.
 * Block definitions referenced many times are visited once per reference
 * (MINSERT grids once). Returns false when the visit budget ran out.
 */
export function walkLeaves(
  doc: DxfDocument,
  styles: StyleResolver,
  ids: number[],
  visit: (e: Entity, ctx: InheritCtx, path: string[], top: number) => void,
  budget = 3_000_000,
): boolean {
  let left = budget;
  const stack: string[] = [];
  const rec = (e: Entity, ctx: InheritCtx, path: string[], top: number, depth: number): void => {
    if (left-- <= 0) return;
    const bn = containerBlock(e);
    if (!bn) {
      visit(e, ctx, path, top);
      return;
    }
    const key = nameKey(bn);
    const block = doc.blocks.get(key);
    if (block && depth < 64 && !stack.includes(key)) {
      const sc = e.type === 'INSERT' ? Math.sqrt(Math.abs(((e as InsertEntity).scale[0] || 1) * ((e as InsertEntity).scale[1] || 1))) : 1;
      const child = styles.childCtx(e, ctx, sc);
      stack.push(key);
      const p = [...path, bn];
      for (const id of block.entities) rec(doc.entities[id], child, p, top, depth + 1);
      stack.pop();
    }
    if (e.type === 'INSERT') {
      const attrCtx = styles.childCtx(e, ctx, 1);
      for (const a of (e as InsertEntity).attribs) rec(a, { ...attrCtx, layer: ctx.layer }, path, top, depth + 1);
    }
  };
  for (const id of ids) rec(doc.entities[id], TOP_CTX, [], id, 0);
  return left > 0;
}
