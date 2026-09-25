import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium} from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = new URL('../test-results/overlay-layout/', import.meta.url);
const server = await createServer({root, cacheDir: 'node_modules/.vite-overlay-layout', server: {host: '127.0.0.1', port: 5201, strictPort: true}});
await server.listen();
const url = 'http://127.0.0.1:5201';
const browser = await chromium.launch({headless: true});
await fs.mkdir(out, {recursive: true});
const cases = [
  ['sources', 'running', 1280, 800], ['sources', 'retained', 1180, 680],
  ['sources', 'none', 1440, 960], ['aliases', 'none', 1280, 800],
];
try {
  for (const [panel, capture, width, height] of cases) {
    const page = await browser.newPage({viewport: {width, height}});
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto(`${url}/scripts/fixtures/overlay-layout.html?panel=${panel}&capture=${capture}`);
    await page.waitForFunction(() => window.checkOverlayLayout?.().ready);
    const report = await page.evaluate(() => window.checkOverlayLayout());
    assert.deepEqual(report.failures, [], JSON.stringify(report));
    if (panel === 'sources') {
      const dialog = page.getByRole('dialog', {name: 'Sources', exact: true});
      const load = dialog.getByRole('button', {name: 'Load dump', exact: true});
      await load.scrollIntoViewIfNeeded();
      const inside = await load.evaluate(el => {
        const box = el.getBoundingClientRect(), body = el.closest('.connect--embedded').getBoundingClientRect();
        return box.top >= body.top && box.bottom <= body.bottom;
      });
      assert.ok(inside, 'Import action must be reachable by scrolling the dialog body');
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press('Tab');
        assert.ok(await dialog.evaluate(el => el.contains(document.activeElement)), 'Sources keeps keyboard focus');
      }
      await page.locator('.connect--embedded').evaluate(el => {el.scrollTop = 0;});
      await page.screenshot({path: fileURLToPath(new URL(`chromium-${panel}-${capture}-${width}x${height}.png`, out))});
      await page.keyboard.press('Escape');
      await dialog.waitFor({state: 'detached'});
    } else {
      const select = page.getByLabel('Label identifier type');
      await select.focus();
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      assert.equal(await select.inputValue(), 'account', 'Compact control keeps native keyboard selection');
      await page.screenshot({path: fileURLToPath(new URL(`chromium-${panel}-${width}x${height}.png`, out))});
    }
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`PASS Chromium ${panel}/${capture} ${width}x${height}`);
  }
  if (process.argv.includes('--webkit')) {
    // Async subprocess: Vite must continue serving while native WebKit loads the fixture.
    const {spawn} = await import('node:child_process');
    for (const [panel, capture, width, height] of cases) {
      const code = await new Promise((resolve, reject) => {
        const child = spawn(process.env.GI_PYTHON || '/usr/bin/python', ['scripts/check-overlay-webkit.py', url, panel, String(width), String(height), capture], {cwd: root, stdio: 'inherit'});
        child.on('error', reject);
        child.on('exit', resolve);
      });
      assert.equal(code, 0, `Native WebKit ${panel}/${capture} ${width}x${height}`);
    }
  }
} finally {
  await browser.close();
  await server.close();
}
