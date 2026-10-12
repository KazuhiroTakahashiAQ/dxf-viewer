import { nameKey, type DxfDocument, type Entity, type InsertEntity, type TextEntity } from '../dxf/model';
import type { BlockInfo, TreeNode } from '../shared/docApi';

/** Block name referenced by an entity (INSERT, DIMENSION, ACAD_TABLE). */
export function referencedBlock(e: Entity): string | undefined {
  if (e.type === 'INSERT' || e.type === 'ACAD_TABLE') return String(e.name ?? '') || undefined;
  if (e.type === 'DIMENSION' || e.type === 'ARC_DIMENSION' || e.type === 'LARGE_RADIAL_DIMENSION') return String(e.blockName ?? '') || undefined;
  return undefined;
}

export function blockInfos(doc: DxfDocument): BlockInfo[] {
  const refs = new Map<string, number>();
  const top = new Map<string, number>();
  const topIds = new Set([...doc.modelSpace, ...doc.paperSpace]);
  doc.entities.forEach((e) => {
    const n = referencedBlock(e);
    if (!n) return;
    const k = nameKey(n);
    refs.set(k, (refs.get(k) ?? 0) + 1);
    if (topIds.has(e.id)) top.set(k, (top.get(k) ?? 0) + 1);
  });
  const records = new Map(doc.tableRecords.filter((r) => r.table === 'BLOCK_RECORD').map((r) => [nameKey(r.name), r]));
  const byHandle = new Map(doc.tableRecords.filter((r) => r.table === 'BLOCK_RECORD' && r.handle).map((r) => [r.handle!.toUpperCase(), r.name]));
  const out: BlockInfo[] = [];
  for (const b of doc.blocks.values()) {
    const k = nameKey(b.name);
    if (k === '*MODEL_SPACE' || k.startsWith('*PAPER_SPACE')) continue;
    const rec = records.get(k);
    const dyn = rec?.dynamicSource ? byHandle.get(String(rec.dynamicSource).toUpperCase()) : undefined;
    out.push({
      name: b.name,
      handle: b.handle,
      flags: b.flags,
      anonymous: b.name.startsWith('*') || (b.flags & 1) !== 0,
      xref: (b.flags & 4) !== 0,
      xrefPath: b.xrefPath,
      dynamicSource: dyn,
      base: b.base,
      entityCount: b.entities.length,
      refCount: refs.get(k) ?? 0,
      topRefCount: top.get(k) ?? 0,
      description: b.description,
      attdefs: b.entities.map((id) => doc.entities[id]).filter((e) => e.type === 'ATTDEF').map((e) => String((e as TextEntity).tag ?? '')),
    });
  }
  return out.sort((a, b) => Number(a.anonymous) - Number(b.anonymous) || a.name.localeCompare(b.name, undefined, { numeric: true }));
}

/** Whether block `key` (directly or nested) references `target`. */
export function makeContains(doc: DxfDocument): (key: string, target: string) => boolean {
  const memo = new Map<string, boolean>();
  const visit = (key: string, target: string, stack: Set<string>): boolean => {
    if (key === target) return true;
    const mk = key + '\u0000' + target;
    const hit = memo.get(mk);
    if (hit !== undefined) return hit;
    if (stack.has(key)) return false;
    stack.add(key);
    const b = doc.blocks.get(key);
    let res = false;
    for (const id of b?.entities ?? []) {
      const n = referencedBlock(doc.entities[id]);
      if (n && visit(nameKey(n), target, stack)) {
        res = true;
        break;
      }
    }
    stack.delete(key);
    memo.set(mk, res);
    return res;
  };
  return (key, target) => visit(key, target, new Set());
}

const TREE_TYPES_CAP = 100_000;

/** Lazy structure tree for the Structure panel. */
export function treeChildren(doc: DxfDocument, layoutItems: (name: string) => number[] | null, layoutNames: string[], key: string, offset: number, limit: number): { total: number; nodes: TreeNode[] } {
  const entityNode = (id: number): TreeNode => {
    const e = doc.entities[id];
    const sub = e.type === 'INSERT' ? (e as InsertEntity).name : e.type === 'TEXT' || e.type === 'MTEXT' ? String(e.text ?? '').slice(0, 40) : '';
    return { key: `e:${id}`, label: `${e.type} ${e.handle}${sub ? ` · ${sub}` : ''}`, id, type: e.type, hasChildren: !!referencedBlock(e) || (e.type === 'INSERT' && (e as InsertEntity).attribs.length > 0) };
  };
  const page = (nodes: TreeNode[]) => ({ total: nodes.length, nodes: nodes.slice(offset, offset + limit) });
  if (key === 'root') {
    const nodes: TreeNode[] = layoutNames.map((n) => ({ key: `space:${n}`, label: n === 'Model' ? 'Model space' : `Layout: ${n}`, count: layoutItems(n)?.length ?? 0, hasChildren: true }));
    nodes.push({ key: 'blocks', label: 'Block definitions', count: doc.blocks.size, hasChildren: true });
    return page(nodes);
  }
  if (key.startsWith('space:')) {
    const rest = key.slice(6);
    const slash = rest.indexOf('/');
    const name = slash >= 0 ? rest.slice(0, slash) : rest;
    const items = layoutItems(name) ?? [];
    if (slash < 0) {
      const counts = new Map<string, number>();
      for (const id of items.slice(0, TREE_TYPES_CAP * 10)) counts.set(doc.entities[id].type, (counts.get(doc.entities[id].type) ?? 0) + 1);
      return page([...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t, c]) => ({ key: `space:${name}/${t}`, label: t, count: c, hasChildren: true })));
    }
    const type = rest.slice(slash + 1);
    const ids = items.filter((id) => doc.entities[id].type === type);
    return { total: ids.length, nodes: ids.slice(offset, offset + limit).map(entityNode) };
  }
  if (key === 'blocks') {
    return page(
      [...doc.blocks.values()]
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
        .map((b) => ({ key: `block:${b.name}`, label: b.name, count: b.entities.length, hasChildren: b.entities.length > 0 })),
    );
  }
  if (key.startsWith('block:')) {
    const b = doc.blocks.get(nameKey(key.slice(6)));
    const ids = b?.entities ?? [];
    return { total: ids.length, nodes: ids.slice(offset, offset + limit).map(entityNode) };
  }
  if (key.startsWith('e:')) {
    const e = doc.entities[Number(key.slice(2))];
    const nodes: TreeNode[] = [];
    const n = e ? referencedBlock(e) : undefined;
    if (n) {
      const b = doc.blocks.get(nameKey(n));
      nodes.push({ key: `block:${n}`, label: `Block: ${n}`, count: b?.entities.length ?? 0, hasChildren: !!b?.entities.length });
    }
    if (e?.type === 'INSERT') for (const a of (e as InsertEntity).attribs) nodes.push(entityNode(a.id));
    return page(nodes);
  }
  return { total: 0, nodes: [] };
}
