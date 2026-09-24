import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const fixture = JSON.parse(fs.readFileSync(new URL("../../testdata/search.json", import.meta.url), "utf8"));
const server = await createServer({root: fileURLToPath(new URL("..", import.meta.url)), server:{middlewareMode:true}, appType:"custom", optimizeDeps:{noDiscovery:true,include:[]}});
try {
  const {compileQuery} = await server.ssrLoadModule("/src/api/queryLang.ts");
  const {QUERY_FIELDS} = await server.ssrLoadModule("/src/api/types.ts");
  const {parseDump} = await server.ssrLoadModule("/src/api/dumpParser.ts");
  const {applyFilter, buildFilter} = await server.ssrLoadModule("/src/api/searchFilter.ts");
  const fields = new Set(QUERY_FIELDS);
  const records = parseDump(JSON.stringify(fixture.records));
  const defaults = {includes:{},excludes:{},text:"",errorsOnly:false,hideReadOnly:false,fromMs:0,toMs:0};
  for (const test of fixture.cases) {
    if (test.query !== undefined) {
      const compiled = compileQuery(test.query, fields);
      assert.equal(compiled.error, null, test.name);
      assert.deepEqual(compiled.ast, test.filter.expr, test.name);
    }
    const ids = applyFilter(records, {...defaults,...test.filter}).map(event=>event.eventID).sort();
    assert.deepEqual(ids, test.ids, test.name);
  }
  for (const test of fixture.invalid) {
    // Validation must also reject malformed filters on an empty dataset.
    assert.throws(()=>applyFilter([], {...defaults,...test.filter}), undefined, test.name);
  }
  for (const query of ['eventName!Run', 'eventName>', 'eventName~', 'eventName:', '/Run/i', 'eventName:/Run/', 'userIdentity.type=Root', '(', 'eventName~"(?=Run)"', 'not '.repeat(40)+'x', 'x'.repeat(16385)]) {
    assert.ok(compileQuery(query, fields).error, `Accepted invalid query: ${query.slice(0,100)}`);
  }
  const filter = buildFilter([{id:'test',kind:'field',field:'eventName',op:'include',value:'ListBuckets'}],true,null,new Set(['DeleteBucket']));
  assert.equal(filter.matchNone,true);
  assert.deepEqual(applyFilter(records,filter),[]);
  console.log(`Search checks passed: ${fixture.cases.length} shared cases, invalid filters and syntax, sensitive intersection.`);
} finally { await server.close(); }
