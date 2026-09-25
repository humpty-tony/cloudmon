import assert from "node:assert/strict";
import fs from "node:fs";
import {fileURLToPath} from "node:url";
import {createServer} from "vite";
const fixture = JSON.parse(fs.readFileSync(new URL("../../testdata/facets.json", import.meta.url), "utf8"));
const server = await createServer({root:fileURLToPath(new URL("..",import.meta.url)),cacheDir:"node_modules/.vite-vector-facets/ssr",server:{middlewareMode:true},appType:"custom",optimizeDeps:{noDiscovery:true,include:[]}});
try {
 const {parseDump} = await server.ssrLoadModule("/src/api/dumpParser.ts");
 const {computeFacets} = await server.ssrLoadModule("/src/api/facets.ts");
 const records = parseDump(JSON.stringify(fixture.records));
 const facets = computeFacets(records);
 const {applyFilter} = await server.ssrLoadModule("/src/api/searchFilter.ts");
 const defaults={includes:{},excludes:{},text:"",errorsOnly:false,hideReadOnly:false,fromMs:0,toMs:0,expr:null};
 const nativeOutput=process.env.CLOUDMON_FACETS_OUTPUT ? JSON.parse(fs.readFileSync(process.env.CLOUDMON_FACETS_OUTPUT,"utf8")) : null;
 for(const test of fixture.cases){
  const events=applyFilter(records,{...defaults,...test.filter});
  assert.deepEqual(events.map(e=>e.eventID).sort(),test.ids,test.name);
  const result=computeFacets(events);
  for(const group of result){
   assert.equal(group.metadata.presentEvents+group.metadata.missingEvents,events.length,test.name);
   if(nativeOutput){
    assert.deepEqual(group.metadata,nativeOutput[test.name].facetMetadata[group.field],`${test.name}: ${group.field} native metadata`);
    assert.deepEqual(group.values.map(({value,count})=>({value,count})),nativeOutput[test.name].facets[group.field],`${test.name}: ${group.field} native values`);
   }
  }
 }
 if(nativeOutput) assert.equal(Object.keys(nativeOutput).length,fixture.cases.length);
 assert.ok(computeFacets([]).every(g=>g.metadata.totalEvents===0 && g.metadata.distinctValues===0));
 const identity = facets.find(f=>f.field==="userName");
 assert.ok(identity, "Identity must group normalized userName, not derived user/ARN fallback");
 assert.deepEqual(identity.metadata, {totalEvents:40,presentEvents:30,missingEvents:10,distinctValues:30,returnedValues:25,limit:25,truncated:true});
 const identityFixture=JSON.parse(fs.readFileSync(new URL("../../testdata/facets-identity.json",import.meta.url),"utf8"));
 const identityRecords=parseDump(JSON.stringify(identityFixture.records));
 const identityNative=process.env.CLOUDMON_FACETS_IDENTITY_OUTPUT ? JSON.parse(fs.readFileSync(process.env.CLOUDMON_FACETS_IDENTITY_OUTPUT,"utf8")) : null;
 assert.deepEqual(Object.fromEntries(identityRecords.map(e=>[e.eventID,e.userIdentity.userName])),identityFixture.userNames);
 const normalized=computeFacets(identityRecords).find(g=>g.field==='userName');
 assert.deepEqual(normalized.values.map(({value,count})=>({value,count})),[{value:'AdminRole',count:3},{value:'DirectName',count:1}],"same-name users and issuers group together");
 assert.deepEqual(normalized.metadata,{totalEvents:5,presentEvents:4,missingEvents:1,distinctValues:2,returnedValues:2,limit:25,truncated:false},"presence counts normalized names, not raw userIdentity.userName");
 for(const test of identityFixture.cases){
  const events=applyFilter(identityRecords,{...defaults,...test.filter});
  assert.deepEqual(events.map(e=>e.eventID).sort(),test.ids,test.name);
  for(const group of computeFacets(events)) if(identityNative){
   assert.deepEqual(group.metadata,identityNative[test.name].facetMetadata[group.field],`${test.name}: ${group.field} native metadata`);
   assert.deepEqual(group.values.map(({value,count})=>({value,count})),identityNative[test.name].facets[group.field],`${test.name}: ${group.field} native values`);
  }
 }
 if(identityNative) assert.equal(Object.keys(identityNative).length,identityFixture.cases.length);
 assert.equal(normalized.label,"User / issuer name","the label must disclose normalized name grouping, not imply a recorded identity");
 assert.equal(identity.label,normalized.label);
 assert.equal(identity.values.length,25);
 assert.equal(facets.find(f=>f.field==="errorCode").metadata.presentEvents,8);
 assert.equal(facets.find(f=>f.field==="result").metadata.missingEvents,0);
 assert.equal(facets.find(f=>f.field==="result").values[0].count,32);
 assert.equal(facets.find(f=>f.field==="accountId").metadata.missingEvents,15);
 globalThis.window = {go:{main:{App:{QueryAggregatesRequest:async()=>native}}}};
 const native = {total:40, snapshot:{generation:"fixture",maxSeq:40,capturedAt:"2026-09-24T10:00:00Z"},facets:Object.fromEntries(facets.map(f=>[f.field,f.values.map(({value,count})=>({value,count}))])),facetMetadata:Object.fromEntries(facets.map(f=>[f.field,f.metadata])),stats:{errors:8,principals:40,sources:2,regions:2,minMs:0,maxMs:0},histogram:[],histStep:60000,histFrom:0,histTo:0};
 const {backend} = await server.ssrLoadModule("/src/api/backend.ts");
 const mapped = await backend.queryAggregates({});
 assert.deepEqual(mapped.facets,facets,"native/browser facet contracts must match");
 delete native.facetMetadata;
 const legacy = await backend.queryAggregates({});
 assert.ok(legacy.facets.every(f=>f.metadata===undefined && f.total===undefined),"legacy top values cannot establish presence or distinct totals");
 assert.equal(legacy.facets.length,10,"empty fields must stay available without invented metadata");
 console.log(`Facet checks passed: ${fixture.cases.length} shared filter cases + ${identityFixture.cases.length} normalized-name cases; complete scope, user/issuer names, counts, mapping and legacy metadata${nativeOutput && identityNative ? "; real DuckDB/browser metadata and values match for both fixtures" : ""}.`);
} finally {await server.close()}
