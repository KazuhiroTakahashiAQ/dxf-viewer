import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { allCodeDescriptions, HEADER_DESCRIPTIONS } from '../../src/dxf/codes';
import { parseDxf } from '../../src/dxf/parser';
import { ENTITY_SPECS } from '../../src/dxf/entities/specs';
import { CATALOG } from '../../src/filter/evaluate';
import { en } from '../../src/i18n/en';
import { resolveLocale, setLocale, t, tx } from '../../src/i18n';
import { entityTypeDesc, tableDesc, term, TERM_GROUPS, TERM_IDS } from '../../src/i18n/glossary';
import { ja } from '../../src/i18n/ja';
import { JA_TERMS } from '../../src/i18n/terms.ja';
import { StyleResolver } from '../../src/scene/style';
import type { TextMeasurer } from '../../src/scene/textLayout';
import { entityInfo } from '../../src/worker/inspect';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

afterEach(() => setLocale('en'));

describe('UI messages', () => {
  it('returns the English string', () => {
    expect(t('app.title')).toBe('DXF Viewer');
  });

  it('Japanese has exactly the English keys with the same placeholders', () => {
    expect(Object.keys(ja).sort()).toEqual(Object.keys(en).sort());
    for (const k of Object.keys(en) as (keyof typeof en)[]) expect([k, placeholders(ja[k])]).toEqual([k, placeholders(en[k])]);
  });

  it('switches language at run time', () => {
    expect(t('panel.layers')).toBe('Layers');
    setLocale('ja');
    expect(t('panel.layers')).toBe('レイヤー');
    expect(t('state.isolated', { count: 3 })).toBe('分離表示中: 3 個の要素だけを表示');
  });

  it('follows the browser language list when set to auto', () => {
    expect(resolveLocale('auto', ['ja-JP', 'en-US'])).toBe('ja');
    expect(resolveLocale('auto', ['en-GB', 'ja'])).toBe('en');
    expect(resolveLocale('auto', ['fr-FR', 'ja'])).toBe('ja');
    expect(resolveLocale('auto', ['fr-FR'])).toBe('en');
    expect(resolveLocale('en', ['ja-JP'])).toBe('en');
  });
});

describe('fixed texts from the document worker (tx)', () => {
  it('leaves English untouched in the English UI', () => {
    expect(tx('Linear units precision')).toBe('Linear units precision');
  });

  it('translates header variable descriptions, group-code meanings and the filter catalog completely', () => {
    const missing = [...Object.values(HEADER_DESCRIPTIONS), ...allCodeDescriptions(), ...CATALOG.flatMap((c) => [c.label, c.group])].filter((s) => !(s in JA_TERMS));
    expect(missing).toEqual([]);
  });

  it('translates every property label shown for the sample drawings', () => {
    const measurer: TextMeasurer = { width: (s) => s.length * 60, metrics: () => ({ capHeight: 0.7, ascent: 0.9, descent: 0.2 }) };
    const dir = 'public/samples';
    const missing = new Set<string>();
    for (const name of readdirSync(dir).filter((n) => n.endsWith('.dxf'))) {
      const doc = parseDxf(new Uint8Array(readFileSync(join(dir, name))), { name });
      const styles = new StyleResolver(doc);
      for (let id = 0; id < doc.entities.length; id++) {
        for (const r of entityInfo(doc, id, styles, measurer)?.rows ?? []) if (r.group !== 'Attributes' && !(r.label in JA_TERMS)) missing.add(r.label);
      }
    }
    expect([...missing]).toEqual([]);
  });

  it('translates messages with variable parts but keeps names from the drawing', () => {
    setLocale('ja');
    expect(tx('Block "Model" is not defined')).toBe('ブロック「Model」が定義されていません');
    expect(tx('Block: Model')).toBe('ブロック: Model');
    expect(tx('Manually selected (detected: shift_jis – No $DWGCODEPAGE; byte patterns match Shift_JIS)')).toBe(
      '手動で選択（自動判定: shift_jis – $DWGCODEPAGE がなく、バイト列が Shift_JIS と一致）',
    );
    expect(tx('$ACADVER AC1032 (R2007 or later) stores text as UTF-8')).toBe('$ACADVER AC1032（R2007 以降）は文字を UTF-8 で保存する');
    // unknown text (e.g. drawing content) is returned unchanged
    expect(tx('KITCHEN 1F')).toBe('KITCHEN 1F');
  });
});

describe('explanations for people new to CAD', () => {
  const japanese = /[\u3040-\u30ff\u4e00-\u9fff]/;

  it('has an English and a Japanese explanation for every glossary term', () => {
    for (const id of TERM_IDS) {
      const en = term(id, 'en');
      const jp = term(id, 'ja');
      expect([id, en.name.length > 0, en.desc.length > 20, japanese.test(en.desc)]).toEqual([id, true, true, false]);
      expect([id, jp.name.length > 0, japanese.test(jp.desc)]).toEqual([id, true, true]);
    }
  });

  it('lists every term exactly once in the help dialog glossary', () => {
    const listed = TERM_GROUPS.flatMap(([, ids]) => ids);
    expect([...listed].sort()).toEqual([...TERM_IDS].sort());
    expect(new Set(listed).size).toBe(listed.length);
    for (const [group] of TERM_GROUPS) expect(`glossary.group.${group}` in en).toBe(true);
  });

  it('explains every entity type the parser knows', () => {
    const missing = [...Object.keys(ENTITY_SPECS), 'SEQEND'].filter((type) => !entityTypeDesc(type, 'en') || !entityTypeDesc(type, 'ja'));
    expect(missing).toEqual([]);
    expect(entityTypeDesc('LOFTEDSURFACE', 'ja')).toContain('サーフェス');
    expect(entityTypeDesc('MY_CUSTOM_ENTITY', 'ja')).toBeUndefined();
  });

  it('explains the standard symbol tables, rendering methods and snap kinds', () => {
    for (const table of ['LAYER', 'LTYPE', 'STYLE', 'DIMSTYLE', 'BLOCK_RECORD', 'VPORT', 'VIEW', 'UCS', 'APPID']) {
      expect([table, !!tableDesc(table, 'en'), !!tableDesc(table, 'ja')]).toEqual([table, true, true]);
    }
    for (const m of ['native', 'block', 'text', 'frame', 'proxy', 'none']) expect(`coverage.desc.${m}` in en).toBe(true);
    for (const k of ['endpoint', 'midpoint', 'center', 'quadrant', 'intersection', 'insertion', 'node', 'nearest']) expect(`snap.desc.${k}` in en).toBe(true);
  });
});
