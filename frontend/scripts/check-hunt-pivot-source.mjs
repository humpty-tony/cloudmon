import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium} from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const fixture = fileURLToPath(new URL('./fixtures/hunt-pivot-source.tsx', import.meta.url));
const server = await createServer({
  root,
  cacheDir:fileURLToPath(new URL('../test-results/hunt-pivot-source/vite-cache', import.meta.url)),
  server:{host:'127.0.0.1', port:5267, strictPort:true},
  plugins:[{
    name:'hunt-pivot-source-prop-observer', enforce:'pre',
    resolveId(source, importer) {
      if (importer?.endsWith('/src/components/HuntPivotResults.tsx') &&
          ['./EventTable', './EventInspector', './LineageView'].includes(source)) return fixture;
    },
    configureServer(server) {
      server.middlewares.use('/hunt-pivot-source-fixture', async (_req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.end(await server.transformIndexHtml('/hunt-pivot-source-fixture',
          '<!doctype html><html><body><div id="root"></div><script type="module" src="/scripts/fixtures/hunt-pivot-source.tsx"></script></body></html>'));
      });
    },
  }],
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({headless:true});
  const page = await browser.newPage();
  page.setDefaultTimeout(6000);
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto('http://127.0.0.1:5267/hunt-pivot-source-fixture');
  await page.getByRole('button', {name:'Select A', exact:true}).click();
  await page.waitForFunction(() => window.pivotSource.pending.some(p => p.seq === 1));
  await page.evaluate(() => window.pivotSource.finish(1, '{"event":"A"}'));
  await page.waitForFunction(() => window.pivotSource.commits.at(-1)?.raw === '{"event":"A"}');
  await page.evaluate(() => {window.pivotSource.commits.length = 0;});
  await page.getByRole('button', {name:'Select B', exact:true}).click();
  await page.waitForFunction(() => window.pivotSource.pending.some(p => p.seq === 2));
  const firstB = await page.evaluate(() => window.pivotSource.commits.find(c => c.seq === 2));
  assert.ok(firstB, 'The first committed B inspector props must be observed');
  assert.equal(firstB.raw, '', 'First B commit must not expose A source as B');
  assert.equal(firstB.error, '', 'First B commit must not expose another identity’s error');
  assert.equal(firstB.loading, true, 'B must remain loading until its own source resolves');
  await page.evaluate(() => window.pivotSource.finish(2, '{"event":"B"}'));
  await page.waitForFunction(() => window.pivotSource.commits.at(-1)?.raw === '{"event":"B"}');
  const result = await page.evaluate(() => ({commits:window.pivotSource.commits, requests:window.pivotSource.requests}));
  assert.ok(result.commits.every(c => c.seq !== 2 || c.raw === '' || c.raw === '{"event":"B"}'));
  assert.deepEqual(result.requests.map(r => r.seq), [1, 2]);
  assert.deepEqual(result.commits.at(-1), {seq:2, snapshot:result.requests[1].snapshot, raw:'{"event":"B"}', loading:false, error:''});
  assert.equal(result.requests[1].snapshot.generation, 'pivot-source-fixture');
  assert.deepEqual(errors, []);
  console.log('PASS hunt-pivot-source: first committed A→B inspector props hide A source; eventual B source matches B and snapshot (stubbed child/backend boundary)');
} finally {
  await browser?.close();
  await server.close();
}
