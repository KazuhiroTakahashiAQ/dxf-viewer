import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { t } from '../../i18n';
import { sessions, type DocumentSession } from '../../session/DocumentSession';
import type { TreeNode } from '../../shared/docApi';
import { activeTab, useUi } from '../../state/store';
import type { TermId } from '../../i18n/glossary';
import { termTip } from '../Tooltip';

/** Fixed node names come from the worker in English; block / layout / entity names stay as they are. */
function nodeLabel(node: TreeNode): string {
  if (node.key === 'blocks') return t('tree.blocks');
  const space = /^space:([^/]*)$/.exec(node.key);
  if (space) return space[1] === 'Model' ? t('tree.model') : t('tree.layout', { name: space[1] });
  if (node.key.startsWith('block:') && node.label.startsWith('Block: ')) return t('layouts.block', { name: node.label.slice(7) });
  return node.label;
}

/** CAD term behind the top-level nodes */
function nodeTerm(node: TreeNode): TermId | undefined {
  if (node.key === 'blocks') return 'block';
  const space = /^space:([^/]*)$/.exec(node.key);
  if (space) return space[1] === 'Model' ? 'modelSpace' : 'paperSpace';
  return undefined;
}

const PAGE = 200;

function Node({ session, node, depth }: { session: DocumentSession; node: TreeNode; depth: number }) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<TreeNode[]>([]);
  const [total, setTotal] = useState(0);
  const selection = useUi((s) => activeTab(s)?.selection);
  const load = useCallback(
    async (offset: number) => {
      const r = await session.rpc.call('treeChildren', { key: node.key, offset, limit: PAGE });
      setTotal(r.total);
      setChildren((prev) => (offset === 0 ? r.nodes : [...prev, ...r.nodes]));
    },
    [session, node.key],
  );
  useEffect(() => {
    if (open && !children.length) void load(0);
  }, [open, children.length, load]);
  const selected = node.id !== undefined && selection?.includes(node.id);
  return (
    <>
      <div className={`tree-row ${selected ? 'selected' : ''}`} style={{ paddingLeft: 4 + depth * 14 }}>
        {node.hasChildren ? (
          <button type="button" className="icon-btn tree-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        ) : (
          <span className="tree-toggle" />
        )}
        <span
          className={`tree-label ${nodeTerm(node) ? 'term' : ''}`}
          {...(nodeTerm(node) ? termTip(nodeTerm(node)!, { side: true }) : { title: nodeLabel(node) })}
          onClick={() => {
            if (node.id !== undefined) {
              session.setSelection([node.id]);
              void session.zoomToEntities([node.id]);
            } else setOpen(!open);
          }}
        >
          {nodeLabel(node)}
        </span>
        {node.count !== undefined && <span className="muted small">{node.count.toLocaleString()}</span>}
      </div>
      {open &&
        children.map((c) => <Node key={c.key} session={session} node={c} depth={depth + 1} />)}
      {open && children.length < total && (
        <button type="button" className="link-btn" style={{ paddingLeft: 22 + depth * 14 }} onClick={() => void load(children.length)}>
          {t('tree.more', { count: (total - children.length).toLocaleString() })}
        </button>
      )}
    </>
  );
}

export function StructurePanel() {
  const tab = useUi(activeTab);
  const session = tab ? sessions.get(tab.id) : undefined;
  const [roots, setRoots] = useState<TreeNode[]>([]);
  useEffect(() => {
    if (!session || tab?.status !== 'ready') return;
    let alive = true;
    void session.rpc.call('treeChildren', { key: 'root', offset: 0, limit: 100 }).then((r) => alive && setRoots(r.nodes));
    return () => {
      alive = false;
    };
  }, [session, tab?.status, tab?.summary]);
  if (!tab || !session) return <div className="panel-empty">—</div>;
  return (
    <div className="panel panel-scroll tree">
      {roots.map((n) => (
        <Node key={n.key} session={session} node={n} depth={0} />
      ))}
    </div>
  );
}
