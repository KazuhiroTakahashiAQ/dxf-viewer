/**
 * Performance check against the plan's targets with a large file
 * (generate it with `uv run python generate.py --perf` in tools/samples).
 *
 * node tools/e2e/perf.ts tests/real/.cache/perf/perf_498436.dxf [--url http://localhost:5173/]
 *
 * Measures in local Chrome (headless): main-thread long tasks, time to the first
 * frame and to the complete scene, frame pacing while panning/zooming, the
 * worker's full render time, filter evaluation and search time.
 */
import { chromium } from 'playwright-core';

const file = process.argv[2];
const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : 'http://localhost:5173/';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.addInitScript(() => {
  const w = window as unknown as { __long: { start: number; duration: number }[] };
  w.__long = [];
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) w.__long.push({ start: e.startTime, duration: e.duration });
  }).observe({ type: 'longtask', buffered: true });
});
await page.goto(url);
await page.waitForTimeout(1000);

type W = {
  __long: { start: number; duration: number }[];
  __dxfv: { ui: { getState(): { tabs: { status: string; build?: { done: boolean }; frameMs?: number; filterResult?: { count: number } }[] } }; active(): any };
};

const t0 = await page.evaluate(() => performance.now());
await page.locator('input[type=file]').first().setInputFiles(file);
// first frame: worker reports a frame while the scene is still building
const firstFrame = await page.waitForFunction(() => {
  const t = (window as unknown as W).__dxfv.ui.getState().tabs[0];
  return t?.frameMs !== undefined ? performance.now() : null;
}, undefined, { timeout: 180_000, polling: 16 });
const tFirst = (await firstFrame.jsonValue()) as number;
const ready = await page.waitForFunction(() => {
  const t = (window as unknown as W).__dxfv.ui.getState().tabs[0];
  return t?.status === 'ready' && t.build?.done ? performance.now() : null;
}, undefined, { timeout: 300_000, polling: 50 });
const tReady = (await ready.jsonValue()) as number;
const longLoad = await page.evaluate(() => (window as unknown as W).__long.map((l) => l.duration));

// interaction: wheel zoom and drag pan while sampling rAF intervals
await page.evaluate(() => {
  const w = window as unknown as { __frames: number[] };
  w.__frames = [];
  let last = performance.now();
  const tick = (t: number) => {
    w.__frames.push(t - last);
    last = t;
    if (w.__frames.length < 100_000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
const longBefore = longLoad.length;
await page.mouse.move(800, 500);
for (let i = 0; i < 30; i++) {
  await page.mouse.wheel(0, i < 15 ? -120 : 120);
  await page.waitForTimeout(16);
}
await page.mouse.down({ button: 'middle' });
for (let i = 0; i < 60; i++) {
  await page.mouse.move(800 + Math.sin(i / 6) * 200, 500 + Math.cos(i / 6) * 120);
  await page.waitForTimeout(16);
}
await page.mouse.up({ button: 'middle' });
await page.waitForTimeout(1500);
const interaction = await page.evaluate((n) => {
  const w = window as unknown as { __frames: number[]; __long: { duration: number }[] };
  const f = w.__frames.slice(5);
  f.sort((a, b) => a - b);
  return { frames: f.length, p50: f[Math.floor(f.length * 0.5)], p95: f[Math.floor(f.length * 0.95)], max: f[f.length - 1], longTasks: w.__long.slice(n).map((l) => l.duration) };
}, longBefore);

// full render time of the worker at the extents view
await page.keyboard.press('f');
await page.waitForTimeout(2000);
const renderMs = await page.evaluate(() => (window as unknown as W).__dxfv.ui.getState().tabs[0].frameMs);

// filter evaluation (facet + condition) and search, timed on the main thread incl. RPC
const filterMs = await page.evaluate(async () => {
  const s = (window as unknown as W).__dxfv.active();
  const t = performance.now();
  await s.applyFilter({ version: 1, facets: { layer: ['L3', 'L7'] }, where: { kind: 'group', logic: 'and', items: [{ kind: 'cond', prop: 'type', op: 'in', value: 'CIRCLE, ARC' }] }, level: 'top', mode: 'highlight' });
  return performance.now() - t;
});
const filterCount = await page.evaluate(() => (window as unknown as W).__dxfv.ui.getState().tabs[0].filterResult?.count);
const searchMs = await page.evaluate(async () => {
  const s = (window as unknown as W).__dxfv.active();
  const t = performance.now();
  const r = await s.rpc.call('search', { query: 'T12-', regex: false, caseSensitive: false, limit: 300 });
  return { ms: performance.now() - t, total: r.total };
});
const longAll = await page.evaluate(() => (window as unknown as W).__long.map((l) => l.duration));

console.log(
  JSON.stringify(
    {
      file,
      firstFrameMs: Math.round(tFirst - t0),
      completeMs: Math.round(tReady - t0),
      longTasksDuringLoad: { count: longLoad.length, max: Math.round(Math.max(0, ...longLoad)) },
      interaction: { ...interaction, longTasks: { count: interaction.longTasks.length, max: Math.round(Math.max(0, ...interaction.longTasks)) } },
      workerRenderMs: renderMs,
      filter: { ms: Math.round(filterMs), matches: filterCount },
      search: { ms: Math.round(searchMs.ms), hits: searchMs.total },
      longTasksTotal: { count: longAll.length, max: Math.round(Math.max(0, ...longAll)) },
    },
    null,
    1,
  ),
);
await browser.close();
