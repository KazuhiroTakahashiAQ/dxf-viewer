/**
 * Headless screenshot helper for visual checks (uses the locally installed
 * Google Chrome through playwright-core; no browser download).
 *
 * node tools/e2e/shot.ts --url http://localhost:5173/ --file public/samples/basic_entities.dxf --out shot.png
 *   [--width 1400 --height 900] [--keys "f,Alt+1"] [--wait 1500] [--eval "js"]
 */
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
function arg(name: string, def?: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
}
function all(name: string): string[] {
  const out: string[] = [];
  args.forEach((a, i) => {
    if (a === `--${name}`) out.push(args[i + 1]);
  });
  return out;
}

const url = arg('url', 'http://localhost:5173/')!;
const files = all('file');
const out = arg('out', 'shot.png')!;
const width = Number(arg('width', '1400'));
const height = Number(arg('height', '900'));
const wait = Number(arg('wait', '1500'));
const keys = (arg('keys', '') ?? '').split(',').filter(Boolean);
const evalJs = arg('eval');
const evalBefore = arg('eval-before');
/** --upload "css-selector|path" (repeatable): set files on an input after loading */
const uploads = all('upload');
const chrome = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const browser = await chromium.launch({ executablePath: chrome, headless: true });
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: Number(arg('dpr', '1')) });
const logs: string[] = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url);
if (files.length) {
  await page.locator('input[type=file]').first().setInputFiles(files);
  // wait until no tab is loading
  await page.waitForFunction(() => !document.querySelector('.doc-tab .spin'), undefined, { timeout: 60000 });
}
await page.waitForTimeout(wait);
for (const k of keys) {
  await page.keyboard.press(k);
  await page.waitForTimeout(400);
}
if (evalBefore) {
  await page.evaluate(evalBefore);
  await page.waitForTimeout(500);
}
for (const u of uploads) {
  const i = u.lastIndexOf('|');
  await page.locator(u.slice(0, i)).first().setInputFiles(u.slice(i + 1).split(','));
  await page.waitForTimeout(wait);
}
if (evalJs) {
  const r = await page.evaluate(evalJs);
  if (r !== undefined) console.log('eval:', JSON.stringify(r));
}
await page.screenshot({ path: out });
const status = await page.locator('.status-bar').innerText().catch(() => '');
console.log('status:', status.replace(/\s+/g, ' '));
if (logs.length) console.log(logs.join('\n'));
await browser.close();
