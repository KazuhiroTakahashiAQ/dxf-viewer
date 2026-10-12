/**
 * UI walkthrough in local headless Chrome (dev server running): language,
 * tooltips (with explanations of CAD terms), welcome samples, the state bar
 * for hidden / isolated entities, the help dialog with its glossary and the
 * language switch. Screenshots go to --out-dir.
 *
 * node tools/e2e/ui.ts [--url http://localhost:5173/] [--out-dir tools/e2e/out] [--locale ja-JP]
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright-core';

const args = process.argv.slice(2);
const arg = (name: string, def: string) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : def);
const url = arg('url', 'http://localhost:5173/');
const outDir = arg('out-dir', 'tools/e2e/out');
const locale = arg('locale', 'ja-JP');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale });
const page = await context.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

const results: [string, boolean, string?][] = [];
const check = (name: string, ok: boolean, detail?: string) => {
  results.push([name, ok, detail]);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const shot = (name: string) => page.screenshot({ path: join(outDir, `${name}.png`) });
const ja = locale.startsWith('ja');
/** hover an element and return the tooltip text (title / description / term explanations) */
const tipOf = async (target: ReturnType<Page['locator']>) => {
  await page.mouse.move(5, 5);
  await page.waitForFunction(() => !document.querySelector('.tooltip'));
  await target.hover();
  await page.waitForSelector('.tooltip', { timeout: 3000 });
  return page.locator('.tooltip').innerText();
};

type W = { __dxfv: { ui: { getState(): any }; active(): any } };
const state = (p: Page) => p.evaluate(() => (window as unknown as W).__dxfv.ui.getState().tabs.map((t: any) => ({ status: t.status, isolated: t.isolatedCount ?? 0, hidden: t.hiddenCount ?? 0, layout: t.layout })));
const ready = (p: Page) => p.waitForFunction(() => (window as unknown as W).__dxfv.ui.getState().tabs.length > 0 && (window as unknown as W).__dxfv.ui.getState().tabs.every((t: any) => t.status === 'ready' && t.build?.done), undefined, { timeout: 60_000 });

await page.goto(url);
await page.waitForSelector('.welcome');
const lang = await page.evaluate(() => document.documentElement.lang);
check('language follows the browser', lang === locale.split('-')[0], lang);
check('welcome lists features and samples', (await page.locator('.feature').count()) === 6 && (await page.locator('.sample').count()) === 11);
await shot('01-welcome');

// tooltip on the Open button
await page.locator('.toolbar .tb-btn').first().hover();
await page.waitForSelector('.tooltip', { timeout: 3000 });
const tipText = await page.locator('.tooltip').innerText();
check('tooltip appears on hover', tipText.length > 10, tipText.replace(/\n/g, ' / '));
await shot('02-tooltip');
await page.mouse.move(700, 600);

// glossary for people new to CAD, opened from the welcome page
await page.locator('.welcome-glossary').click();
await page.waitForSelector('.help-modal .glossary-entry');
const glossaryCount = await page.locator('.glossary-entry').count();
const glossaryTop = await page.evaluate(() => {
  const h = document.getElementById('help-glossary')!.getBoundingClientRect();
  const m = document.querySelector('.help-modal')!.getBoundingClientRect();
  return h.top - m.top;
});
check('welcome opens the glossary', glossaryCount >= 50 && glossaryTop < 80, `${glossaryCount} terms, heading at ${Math.round(glossaryTop)} px`);
check('glossary explains blocks', (await page.locator('.glossary-entry', { hasText: ja ? 'ブロック参照（INSERT）' : 'Block reference (INSERT)' }).innerText()).length > 40);
await shot('02b-glossary');
await page.keyboard.press('Escape');
await page.waitForFunction(() => !document.querySelector('.help-modal'));

// open a sample from the welcome page
await page.locator('.sample', { hasText: 'minsert_budget' }).click();
await ready(page);
check('sample opens', (await state(page)).length === 1);
check('first-use hint is shown', await page.locator('.canvas-hints').isVisible());
await shot('03-sample-hint');
await page.locator('.canvas-hints .primary-btn').click();
check('hint can be dismissed', !(await page.locator('.canvas-hints').count()));

// panel tab tooltip with a description and what a block is
const blocksTip = await tipOf(page.locator('.dock-left .dock-tab').nth(1));
check('panel tab tooltip explains the panel', (await page.locator('.tooltip-desc').innerText()).length > 10, await page.locator('.tooltip-desc').innerText());
check('panel tab tooltip explains “block”', (await page.locator('.tooltip-term').count()) === 2 && blocksTip.includes(ja ? 'ブロックとは' : 'What is “Block”?'), blocksTip.replace(/\n/g, ' / ').slice(0, 160));
await shot('03b-blocks-tip');
await page.locator('.dock-left .dock-tab').nth(1).click();
await page.mouse.move(700, 600);

// isolate references of a block, then restore from the state bar
const row = page.locator('.block-row', { hasText: 'GRID3' });
await row.waitFor();
await row.hover();
await row.locator('.block-actions button').nth(2).click();
await page.waitForSelector('.state-chip.state-iso', { timeout: 10_000 });
check('isolation is announced on the drawing', true, await page.locator('.state-chip.state-iso').innerText());
await shot('04-isolated');
await page.locator('.state-chip.state-iso button').click();
await page.waitForFunction(() => !document.querySelector('.state-chip.state-iso'));
const st = await state(page);
check('“Show all” ends the isolation', st[0].isolated === 0 && st[0].hidden === 0);

// properties of a reference that expands to 10^12 entities (used to crash the worker)
await page.evaluate(() => {
  const ui = (window as unknown as W).__dxfv.ui.getState();
  ui.setDock('right', { open: true, active: 'properties' });
});
await page.evaluate(async () => {
  const s = (window as unknown as W).__dxfv.active();
  const r = await s.rpc.call('search', { query: 'GRID3', regex: false, caseSensitive: false, limit: 5 });
  s.setSelection([r.hits.find((h: any) => h.type === 'INSERT').id]);
});
await page.waitForSelector('.props table.kv th', { timeout: 15_000 });
await page.waitForTimeout(500);
const propsText = await page.locator('.props').innerText();
check('huge reference: properties shown without crashing', /算出していません|Not computed/.test(propsText));
check('property labels are translated', locale.startsWith('ja') ? propsText.includes('レイヤー') && propsText.includes('ブロック名') : true);
const handleTip = await tipOf(page.locator('.props th .term', { hasText: ja ? /^ハンドル$/ : /^Handle$/ }));
check('property label explains the term', handleTip.includes(ja ? '固有の番号' : 'unique ID'), handleTip.replace(/\n/g, ' / ').slice(0, 120));
await shot('05-properties');
const typeTip = await tipOf(page.locator('.props-title .term'));
check('entity type is explained', typeTip.includes(ja ? 'ブロック参照' : 'block reference'), typeTip.replace(/\n/g, ' / '));
await page.mouse.move(700, 600);
const alive = await page.evaluate(async () => (await (window as unknown as W).__dxfv.active().rpc.call('typeStats', undefined)).length > 0);
check('worker still responds', alive);

// document panel
await page.evaluate(() => (window as unknown as W).__dxfv.ui.getState().setDock('right', { open: true, active: 'document' }));
await page.waitForTimeout(600);
await shot('06-document');

// menu items explain their term beside the menu, not on top of the next items
await page.locator('.toolbar details.tb-menu summary', { hasText: ja ? '表示' : 'Display' }).click();
const ltLabel = page.locator('.menu-pop label', { hasText: ja ? /^線種$/ : /^Linetypes$/ });
const ltTip = await tipOf(ltLabel);
const [labelBox, tipBox] = [await ltLabel.boundingBox(), await page.locator('.tooltip').boundingBox()];
check('display menu explains linetypes beside the menu', ltTip.includes(ja ? '破線' : 'dashed') && !!labelBox && !!tipBox && (tipBox.x >= labelBox.x + labelBox.width || tipBox.x + tipBox.width <= labelBox.x), ltTip.replace(/\n/g, ' / ').slice(0, 80));
await shot('06b-display-tip');
await page.keyboard.press('Escape');
await page.locator('.toolbar details.tb-menu summary', { hasText: ja ? '表示' : 'Display' }).click();

// right-click menu explains isolation (the menu acts on the selection)
await page.evaluate(async () => {
  const s = (window as unknown as W).__dxfv.active();
  s.setSelection((await s.rpc.call('selectAll', undefined)).slice(0, 1));
});
await page.mouse.click(700, 450, { button: 'right' });
await page.waitForSelector('.context-menu');
const isoTip = await tipOf(page.locator('.context-menu button', { hasText: ja ? /^分離表示/ : /^Isolate/ }));
check('context menu explains isolation', isoTip.includes(ja ? '一時的に隠す' : 'Temporarily hides'), isoTip.replace(/\n/g, ' / ').slice(0, 80));
await page.keyboard.press('Escape');

// help dialog
await page.mouse.move(700, 450);
await page.keyboard.press('?');
await page.waitForSelector('.help-modal');
check('help opens with ?', true);
await shot('07-help');
await page.locator('.help-item', { has: page.locator('b', { hasText: locale.startsWith('ja') ? /^文字一覧$/ : /^Texts$/ }) }).click();
const bottom = await page.evaluate(() => (window as unknown as W).__dxfv.ui.getState().docks.bottom);
check('help opens the chosen panel', bottom.open && bottom.active === 'texts');

// switch language in Settings
await page.locator('.toolbar details.tb-menu summary').last().click();
await page.locator('.settings-pop select').first().selectOption('en');
await page.waitForTimeout(300);
check('language switch updates the UI', (await page.locator('.toolbar .tb-btn').first().innerText()).trim() === 'Open');
await shot('08-english');
await page.locator('.settings-pop select').first().selectOption('auto');

check('no errors in the console', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r[1]);
console.log(failed.length ? `${failed.length} check(s) failed` : 'all checks passed');
process.exit(failed.length ? 1 : 0);
