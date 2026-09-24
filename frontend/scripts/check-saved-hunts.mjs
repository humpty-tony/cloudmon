import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const server=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),server:{middlewareMode:true},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}});
try {
 const {SavedHuntStore,SAVED_HUNTS_KEY,MAX_SAVED_HUNTS,validateHuntConfig,cloneHuntConfig,emptyHuntFilter}=await server.ssrLoadModule('/src/api/savedHunts.ts');
 const data=new Map();let reads=0,failWrite=false,failRead=false;
 const storage={getItem:key=>{reads++;if(failRead)throw Error('denied');return data.get(key)??null},setItem:(key,value)=>{if(failWrite)throw Error('quota');data.set(key,value)},removeItem:key=>{if(failWrite)throw Error('denied');data.delete(key)}};
 const store=new SavedHuntStore(()=>storage);
 const initial=store.getSnapshot();for(let i=0;i<100;i++)assert.equal(store.getSnapshot(),initial);assert.equal(reads,1,'rendering reread local storage');
 const config={mode:'indicators',indicatorText:'arn arn:aws-us-gov:iam::012345678901:role/ProductionReader\nip 2001:DB8::AbCd\nkey ASIACaseSensitive',steps:['',''],group:'credential',minutes:15,filter:{
  includes:{identityArn:['arn:aws-us-gov:iam::012345678901:role/ProductionReader'],accountId:['012345678901'],eventName:['Get*Literal?'],EVENTSOURCE:['S3.AmazonAWS.com']},
  excludes:{sourceIPAddress:['AWS Internal','2001:DB8::AbCd']},exists:['principalId','roleArn'],matchNone:true,errorsOnly:true,hideReadOnly:true,fromMs:1000,toMs:9000,
  text:'independent literal filter text',expr:{t:'and',nodes:[{t:'cmp',field:'accountId',op:'eq',value:'012345678901'},{t:'or',nodes:[{t:'not',node:{t:'cmp',field:'eventName',op:'contains',value:'Exact*Literal?'}},{t:'text',value:'^Assume',regex:true},{t:'text',value:'literal',regex:false},{t:'text',value:'plain'}]}]}
 }};
 const expected=structuredClone(config),entry=store.create('  Production context  ',config);
 assert.equal(entry.name,'Production context');assert.deepEqual(entry.config,expected);
 config.filter.includes.accountId[0]='changed';config.filter.expr.nodes[0].value='changed';config.steps[0]='changed';
 assert.deepEqual(entry.config,expected,'input mutation changed a saved hunt');
 assert.throws(()=>{entry.config.filter.includes.accountId[0]='bad'},TypeError);
 assert.throws(()=>{store.getSnapshot().items[0].config.filter.expr.nodes.push({t:'text',value:'bad'})},TypeError);
 assert.throws(()=>{store.getSnapshot().items.push(entry)},TypeError);
 const detached=cloneHuntConfig(entry.config);detached.filter.expr.nodes[0].value='detached';assert.deepEqual(entry.config,expected);
 const reloaded=new SavedHuntStore(()=>storage);assert.deepEqual(reloaded.getSnapshot().items,[entry]);
 assert.equal(reloaded.getSnapshot().items[0].config.filter.text,'independent literal filter text','text was rebuilt from AST');
 const beforeRename=structuredClone(entry.config);let notifications=0;const unsubscribe=store.subscribe(()=>notifications++);
 const renamed=store.rename(entry.id,'Renamed hunt');assert.equal(notifications,1);assert.deepEqual(renamed.config,beforeRename);assert.equal(renamed.id,entry.id);
 const sequence={mode:'sequence',indicatorText:'dormant text',steps:['eventName="CreateUser"','eventName="AttachUserPolicy"','eventName="CreateAccessKey"','eventName="AssumeRole"','eventName="GetSecretValue"'],group:'principal',minutes:1440,filter:emptyHuntFilter()};
 const updated=store.update(entry.id,'Five steps',sequence);assert.deepEqual(updated.config,sequence);assert.equal(updated.id,entry.id);
 assert.throws(()=>store.update('missing','Lost',sequence),/no longer exists/);assert.throws(()=>store.rename('missing','Lost'),/no longer exists/);
 const before=store.getSnapshot(),bytes=data.get(SAVED_HUNTS_KEY);failWrite=true;
 for(const operation of [()=>store.create('Unsaved',sequence),()=>store.update(entry.id,'Unsaved',expected),()=>store.rename(entry.id,'Unsaved'),()=>store.remove(entry.id)])assert.throws(operation,/not saved/);
 assert.throws(()=>store.clear(),/could not be reset/);assert.equal(store.getSnapshot(),before);assert.equal(data.get(SAVED_HUNTS_KEY),bytes);assert.equal(notifications,2);failWrite=false;
 store.remove(entry.id);assert.equal(store.getSnapshot().items.length,0);unsubscribe();

 // An older cached window rereads before editing, preserving completed writes.
 const other=new SavedHuntStore(()=>storage);other.getSnapshot();
 const first=store.create('Window one',sequence),second=other.create('Window two',expected);
 assert.equal(other.getSnapshot().items.length,2);store.refresh();assert.equal(store.getSnapshot().items.length,2);
 other.remove(second.id);store.rename(first.id,'Window one renamed');assert.equal(store.getSnapshot().items.length,1);

 const rejectConfig=mutate=>{const copy=structuredClone(expected);mutate(copy);assert.throws(()=>validateHuntConfig(copy))};
 for(const mutate of [
  c=>{c.unknown=true},c=>{delete c.filter},c=>{c.mode='other'},c=>{c.group='account'},c=>{c.minutes=0},c=>{c.minutes=1441},c=>{c.minutes=1.5},c=>{c.steps=['one']},c=>{c.steps=Array(6).fill('eventName=CreateUser')},
  c=>{c.steps[0]='é'.repeat(8193)},c=>{c.steps=Array(2)},c=>{c.indicatorText=''},c=>{c.indicatorText='unknown value'},c=>{c.indicatorText='ip value\u0000'},c=>{c.indicatorText='key '+'é'.repeat(1025)},c=>{c.indicatorText=Array(101).fill('ip 192.0.2.1').join('\n')},c=>{c.indicatorText='x'.repeat(256001)},
  c=>{c.filter.unknown=true},c=>{c.filter.includes.unknown=['value']},c=>{c.filter.includes.accountId='not an array'},c=>{c.filter.excludes.sourceIPAddress=[123]},c=>{c.filter.exists=['unknown']},c=>{c.filter.exists='accountId'},c=>{c.filter.matchNone='false'},c=>{c.filter.errorsOnly=1},c=>{c.filter.hideReadOnly=null},
  c=>{c.filter.fromMs=Infinity},c=>{c.filter.toMs=1.1},c=>{c.filter.fromMs=-1},c=>{c.filter.fromMs=Number.MAX_SAFE_INTEGER+1},c=>{c.filter.fromMs=10000},c=>{c.filter.text=null},
  c=>{c.filter.expr={t:'text',value:123}},c=>{c.filter.expr={t:'text',value:'x',regex:'false'}},c=>{c.filter.expr={t:'text',value:'x',extra:true}},c=>{c.filter.expr={t:'cmp',field:'unknown',op:'eq',value:'x'}},c=>{c.filter.expr={t:'cmp',field:'eventName',op:'containsSql',value:'x'}},
  c=>{c.filter.expr={t:'and',nodes:[]}},c=>{c.filter.expr={t:'and',nodes:Array(1)}},c=>{c.filter.expr={t:'or',nodes:{}}},c=>{c.filter.expr={t:'not',node:null}},c=>{c.filter.expr={t:'cmp',field:'eventName',op:'regex',value:'['}},c=>{c.filter.expr={t:'text',value:'x'.repeat(16385)}},
 ])rejectConfig(mutate);
 for(const steps of [['','eventName=CreateUser'],['eventName="unterminated','eventName=CreateUser'],['eventName=CreateUser','unknown=foo']])assert.throws(()=>validateHuntConfig({...sequence,steps}));
 const cyclic={t:'not',node:null};cyclic.node=cyclic;assert.throws(()=>validateHuntConfig({...expected,filter:{...expected.filter,expr:cyclic}}),/too complex/);
 assert.throws(()=>validateHuntConfig({...expected,filter:{...expected.filter,expr:{t:'and',nodes:Array.from({length:513},()=>({t:'text',value:'x'}))}}}));
 for(const name of ['', 'x'.repeat(81),'name\nline'])assert.throws(()=>store.create(name,expected));
 assert.deepEqual(validateHuntConfig({...expected,filter:emptyHuntFilter()}).filter,emptyHuntFilter(),'optional filter flags were materialized');
 const explicit={...emptyHuntFilter(),exists:[],matchNone:false};assert.deepEqual(validateHuntConfig({...expected,filter:explicit}).filter,explicit);

 // Invalid collections are never replaced by an empty one during edits.
 const valid={version:1,items:[entry]};
 const badCollections=['invalid bytes',JSON.stringify({...valid,version:2}),JSON.stringify({...valid,unknown:true}),JSON.stringify({...valid,items:[entry,entry]}),JSON.stringify({...valid,items:[{...entry,extra:true}]}),JSON.stringify({...valid,items:[{...entry,id:'invalid-id'}]}),JSON.stringify({...valid,items:[{...entry,config:{...expected,filter:{...expected.filter,exists:['futureField']}}}]}),'x'.repeat(4*1024*1024+1)];
 for(const raw of badCollections){
  data.set(SAVED_HUNTS_KEY,raw);const broken=new SavedHuntStore(()=>storage);assert.match(broken.getSnapshot().error,/preserved/);
  for(const operation of [()=>broken.create('Blocked',expected),()=>broken.update(entry.id,'Blocked',expected),()=>broken.rename(entry.id,'Blocked'),()=>broken.remove(entry.id)])assert.throws(operation,/preserved/);
  assert.equal(data.get(SAVED_HUNTS_KEY),raw,'corrupt saved bytes were overwritten');broken.clear();assert.equal(broken.getSnapshot().error,'');assert.equal(data.has(SAVED_HUNTS_KEY),false);
 }
 const capped=new SavedHuntStore(()=>storage);
 for(let i=0;i<MAX_SAVED_HUNTS;i++)capped.create(`Hunt ${i}`,sequence);
 assert.throws(()=>capped.create('Extra',sequence),/50/);assert.equal(capped.getSnapshot().items.length,50);
 capped.update(capped.getSnapshot().items[0].id,'Updated at limit',expected);assert.equal(capped.getSnapshot().items.length,50);
 const filled=JSON.parse(data.get(SAVED_HUNTS_KEY));filled.items.push({...filled.items[0],id:crypto.randomUUID()});data.set(SAVED_HUNTS_KEY,JSON.stringify(filled));capped.refresh();assert.ok(capped.getSnapshot().error);
 capped.clear();
 const large={...expected,indicatorText:Array.from({length:100},(_,i)=>'key '+String(i).padStart(4,'0')+'x'.repeat(2044)).join('\n')};
 let sizeBlocked=false;for(let i=0;i<MAX_SAVED_HUNTS;i++){
  const before=capped.getSnapshot(),stored=data.get(SAVED_HUNTS_KEY);
  try{capped.create(`Large ${i}`,large)}catch(error){assert.match(error.message,/4 MiB/);assert.equal(capped.getSnapshot(),before);assert.equal(data.get(SAVED_HUNTS_KEY),stored);sizeBlocked=true;break}
 }
 assert.ok(sizeBlocked,'collection byte limit was not enforced');
 failRead=true;const unavailable=new SavedHuntStore(()=>storage);assert.match(unavailable.getSnapshot().error,/unavailable/);assert.throws(()=>unavailable.create('Blocked',expected),/unavailable/);failRead=false;
 console.log('Saved hunt checks passed: exact filters/ASTs, cached snapshots, mutation isolation, CRUD, completed cross-window writes, schema/syntax bounds, corruption recovery and storage failures.');
} finally {await server.close()}
