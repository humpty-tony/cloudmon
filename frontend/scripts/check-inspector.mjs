import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import {createServer} from "vite";
const server=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),server:{middlewareMode:true},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}});
try {
  const {InspectorDocument,FIELD_PAGE_SIZE}=await server.ssrLoadModule('/src/api/inspectorModel.ts');
  const {textPage,TEXT_PAGE_SIZE}=await server.ssrLoadModule('/src/api/textPage.ts');
  const source='{"exact":9007199254740993,"decimal":0.123456789012345678901,"items":['+Array.from({length:20000},(_,i)=>i).join(',')+'],"long":"'+'a'.repeat(2000)+'","spoof":{"isLosslessNumber":true,"value":"invented"}}';
  const document=new InspectorDocument(source);
  const root=document.page([],0);
  assert.equal(root.fields.find(f=>f.key==='exact').value,'9007199254740993');
  assert.equal(root.fields.find(f=>f.key==='decimal').value,'0.123456789012345678901');
  assert.equal(root.fields.find(f=>f.key==='spoof').kind,'object');
  const long=root.fields.find(f=>f.key==='long');assert.equal(long.truncated,true);assert.equal(long.value.length,512);
  const second=document.page(['items'],FIELD_PAGE_SIZE);
  assert.equal(second.total,20000);assert.equal(second.fields.length,50);assert.equal(second.fields[0].value,'50');assert.equal(second.fields[49].value,'99');
  assert.throws(()=>new InspectorDocument('{"a":1,"a":2}'),/Duplicate/);
  assert.throws(()=>document.page(['__proto__'],0));
  const unicode='x'.repeat(TEXT_PAGE_SIZE-1)+'😀'+source;
  const pages=Array.from({length:Math.ceil(unicode.length/TEXT_PAGE_SIZE)},(_,i)=>textPage(unicode,i));
  assert.equal(pages.join(''),unicode);assert.ok(pages[0].endsWith('😀'));
  console.log('Inspector checks passed: bounded pages/previews, exact numbers, duplicate keys, own-property paths, lossless source segments.');
} finally {await server.close()}
