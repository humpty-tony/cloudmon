const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'test-results', 'performance');
fs.mkdirSync(output, { recursive: true });

(async () => {
  const vite = await import('vite');
  const server = await vite.createServer({ root, server: { host: '127.0.0.1', port: 5182, strictPort: true } });
  await server.listen();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto('http://127.0.0.1:5182/scripts/perf-fixture/');
    await page.waitForFunction(() => !!window.perfFixture && document.querySelectorAll('.row').length > 0);
    await page.waitForTimeout(250); // Initial measurement + scroll-end notifications settle.
    const results = {};
    for (const kind of ['cursor', 'scroll', 'counter', 'selection']) {
      await page.waitForTimeout(200);
      const result = await page.evaluate(kind => window.perfFixture.update(kind), kind);
      results[kind] = result;
      // An inline getItemKey callback used to rebuild all 20k measurements on
      // every render. Include actual side-inspector selections; assert bounded
      // work, not a machine-dependent time limit.
      assert.ok(result.keyReads < 10000, `${kind} rescanned the loaded dataset: ${JSON.stringify(result)}`);
      if (kind === 'counter') assert.equal(result.keyReads, 0, 'Unrelated counter updates rendered the event table');
    }
    assert.equal(await page.getByTestId('counter').textContent(), '20');
    assert.ok(await page.locator('.row').count() < 100, 'The table mounted the whole dataset');
    assert.equal(await page.locator('.row-expand').count(), 0, 'Workbench selection mounted inline details');
    await page.screenshot({ path: path.join(output, 'large-table.png') });

    // The user also observed delays with only a handful of events. Exercise the
    // real inspector worker while checking that row geometry stays unchanged.
    await page.evaluate(() => window.perfFixture.smallDataset());
    await page.waitForTimeout(200);
    const rowGeometry = () => page.locator('.rowwrap').evaluateAll(rows => rows.map(row => {
      const rect = row.getBoundingClientRect();
      return { index: row.dataset.index, top: rect.top, height: rect.height };
    }));
    const unselectedRows = await rowGeometry();
    for (let cycle = 0; cycle < 4; cycle++) {
      await page.locator('.row').nth(cycle).click();
      await page.getByRole('region', { name: 'Event fields', exact: true }).waitFor();
      await page.locator('.ft-row[data-field-path]').first().waitFor();
      await page.waitForTimeout(200);
      const before = await page.evaluate(() => window.perfFixture.snapshot());
      await page.waitForTimeout(250);
      const after = await page.evaluate(() => window.perfFixture.snapshot());
      assert.ok(after.commits - before.commits <= 2, `Inspector did not settle: ${JSON.stringify({before, after})}`);
      assert.ok(after.rowResizes - before.rowResizes <= 2, 'Selected row kept changing its measured height');
      assert.equal(after.inspectorLoads, before.inspectorLoads, 'Idle inspector reparsed its event');
      assert.deepEqual(await rowGeometry(), unselectedRows, 'Selection changed table row positions or heights');
      if (cycle === 0) await page.screenshot({ path: path.join(output, 'small-inspector.png') });
      await page.locator('.row--selected').click();
      await page.waitForTimeout(100);
      assert.equal(await page.locator('.row--selected').count(), 1, 'Repeated click closed the inspector');
      assert.equal((await page.evaluate(() => window.perfFixture.snapshot())).inspectorLoads, after.inspectorLoads, 'Repeated selection reparsed its event');
      await page.getByRole('button', { name: 'Close inspector', exact: true }).click();
      await page.getByRole('button', { name: 'Close inspector', exact: true }).waitFor({ state: 'detached' });
      assert.deepEqual(await rowGeometry(), unselectedRows, 'Closing the inspector changed table row positions or heights');
    }
    assert.equal(await page.locator('.row').count(), 8, 'Small table lost rows after inspector selection');
    assert.deepEqual(errors, [], 'Browser errors during interaction');
    fs.writeFileSync(path.join(output, 'interaction-metrics.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
    console.log('UI work stays bounded for 20k rows; inspector selection settles without moving event rows. Timings are observations, not pass/fail limits.');
  } finally {
    await browser?.close();
    await server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
