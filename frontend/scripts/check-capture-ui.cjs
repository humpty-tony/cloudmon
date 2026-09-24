const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'test-results', 'capture');
fs.mkdirSync(output, {recursive:true});
async function checkStatusBar(page, expected='↑ 1 new event') {
 // Flush resize/paint work and the badge entrance animation on the test clock.
 await page.clock.runFor(300);
 await page.getByRole('button',{name:expected,exact:true}).waitFor({state:'visible'});
 // Read the badge and footer together as one rendered layout.
 const bounds=await page.evaluate(()=>{
  const footer=document.querySelector('.statusbar');
  const button=footer?.querySelector('.newpill');
  if(!button)return {missing:true,footer:footer?.textContent};
  const pill=button.getBoundingClientRect();
  const bar=footer.getBoundingClientRect();
  return {inside:pill.top>=bar.top && pill.bottom<=bar.bottom && pill.left>=bar.left && pill.right<=bar.right,
   visible:pill.width>0 && pill.height>0 && bar.bottom<=innerHeight && bar.right<=innerWidth,
   label:button.textContent.replace(/\s+/g,' ').trim(),
   pill:{width:pill.width,height:pill.height},bar:{width:bar.width,height:bar.height}};
 });
 assert.ok(bounds.inside && bounds.visible,`New-event badge spills out of the footer: ${JSON.stringify(bounds)}`);
 assert.equal(bounds.label,expected,'Inspection lost its pending event count');
}
(async()=>{
 const vite=await import('vite');
 const server=await vite.createServer({root,server:{host:'127.0.0.1',port:5181,strictPort:true}}); await server.listen();
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.addInitScript(()=>{
   const raw='{"eventID":"saved-1","eventTime":"2026-09-24T00:00:00Z","eventName":"RunInstances","eventSource":"ec2.amazonaws.com","awsRegion":"us-east-1","recipientAccountId":"111122223333","userIdentity":{"type":"IAMUser","userName":"analyst"},"opaque":9007199254740993}';
   const config={mode:'create-infra',profile:'investigator',region:'us-east-1',queueUrl:'',ruleArn:'',dumpPath:'',dumpText:'',capturePattern:''};
   const infra={owned:true,queueUrl:'https://sqs.us-east-1.amazonaws.com/111122223333/cloudmon-capture-saved',queueName:'cloudmon-capture-saved',queueArn:'arn:aws:sqs:us-east-1:111122223333:cloudmon-capture-saved',ruleName:'cloudmon-cloudtrail-saved',ruleArn:'arn:aws:events:us-east-1:111122223333:rule/cloudmon-cloudtrail-saved',region:'us-east-1',account:'111122223333',allManagement:true};
   const recovering=location.search.includes('recovery');
   const state=window.captureTest={delayIdentity:false,delayTrail:false,failTrail:false,startCalls:0,resumeCalls:0,removeCalls:0,cleanupFails:false,exportFails:false,exported:null,raw,
     aggCalls:0,aggActive:0,aggMax:0,newerCalls:0,newerActive:0,newerMax:0,delayAgg:false,delayNewer:false,searchMode:false,failSearch:false,
     searchCalls:[],searchActive:0,searchMax:0,delaySearch:false,delayExport:false,cancelledQueries:0,exportedFilter:null,rawBySeq:{},rawCalls:0,copied:null,failRaw:false,failLineage:false,delayRawSeq:0,inspectorLoads:0,
     rows:[{seq:1,eventID:"saved-1",eventName:"RunInstances",eventSource:"ec2.amazonaws.com",eventTime:"2026-09-24T00:00:00Z",awsRegion:"us-east-1",identityType:"IAMUser",userName:"analyst",readOnly:false,managementEvent:true}],
     recovery:{evidence:{events:recovering?1:0,observations:recovering?3:0,variantEvents:recovering?1:0,lossy:recovering?1:0},capture:recovering?{version:1,phase:'ready',config,infra}:null,captureError:'',active:false}};
   const handlers=new Map();
   const searchJobs=new Map();
   const snapshot=()=>({generation:"fixture",maxSeq:Math.max(...state.rows.map(row=>row.seq)),capturedAt:new Date().toISOString()});
   Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{state.copied=text}}});
   const NativeWorker=window.Worker;
   window.Worker=class extends NativeWorker {
    postMessage(message,...rest){if(message && typeof message.json==='string')state.inspectorLoads++;return super.postMessage(message,...rest)}
   };
   const queryRows=(filter)=>{
    if(state.failSearch)throw Error('Storage temporarily unavailable');
    // Only the event-ID UI scenarios below need filtering. Real search semantics
    // are checked against DuckDB in the shared conformance fixture.
    return state.searchMode && filter?.expr ? state.rows.filter(row=>row.eventID===filter.expr.value) : state.rows;
   };
   window.runtime={EventsOn:(name,cb)=>{if(!handlers.has(name))handlers.set(name,new Set());handlers.get(name).add(cb);return()=>handlers.get(name).delete(cb)}};
   state.emit=(total,withRows=true)=>{while(withRows && state.rows.length<total){const seq=state.rows.length+1;state.rows.unshift({...state.rows[state.rows.length-1],seq,eventID:`live-${seq}`,eventName:`LiveEvent${seq}`})}state.recovery.evidence.events=total;for(const cb of handlers.get('cloudmon:events')||[])cb({added:1,total})};
   window.go={main:{App:{
    Log:async()=>{},MaximizeWindow:async()=>{},
    GetRecoveryState:async()=>structuredClone(state.recovery),
    StartCapture:async()=>{state.startCalls++;throw Error('Unexpected provisioning')},
    ResumeCapture:async()=>{state.resumeCalls++;state.recovery.active=true;return infra},
    StopCapture:async()=>{state.recovery.active=false},
    TeardownCapture:async()=>{state.removeCalls++;state.recovery.active=false;if(state.cleanupFails){state.recovery.capture.phase='cleanup';throw Error('Queue deletion denied; saved resources retained')}state.recovery.capture=null},
    QueryAggregates:async(filter)=>{state.aggCalls++;const rows=queryRows(filter);state.aggActive++;state.aggMax=Math.max(state.aggMax,state.aggActive);const result={snapshot:snapshot(),total:rows.length,facets:{},histogram:[],histFrom:0,histTo:0,histStep:60000,stats:{errors:0,principals:1,sources:1,regions:1,minMs:0,maxMs:0}};try{if(state.delayAgg)await new Promise(resolve=>{state.resolveAgg=resolve});return result}finally{state.aggActive--}},
    QueryPage:async(filter)=>queryRows(filter),
    QueryAggregatesRequest:async(filter)=>window.go.main.App.QueryAggregates(filter),
    QuerySearch:async(filter,id,limit)=>{
     state.searchCalls.push(filter);state.searchActive++;state.searchMax=Math.max(state.searchMax,state.searchActive);
     try {
      if(state.delaySearch)await new Promise((resolve,reject)=>{searchJobs.set(id,{resolve,reject});state.pendingSearch=id});
      return {aggregates:await window.go.main.App.QueryAggregates(filter),events:queryRows(filter).slice(0,limit)};
     } finally {searchJobs.delete(id);state.searchActive--}
    },
    CancelQuery:async(id)=>{const job=searchJobs.get(id);if(job){state.cancelledQueries++;job.reject(Error('Query cancelled'))}},
    QuerySnapshotPage:async(filter,snap,before,limit)=>queryRows(filter).filter(row=>row.seq<=snap.maxSeq && (!before || row.seq<before)).slice(0,limit),
    ExportFiltered:async(filter,snap,id)=>{try{if(state.delayExport)await new Promise((resolve,reject)=>{searchJobs.set(id,{resolve,reject})});state.exportedFilter={filter,snapshot:snap};return {path:'cloudtrail-matches.json',count:queryRows(filter).filter(row=>row.seq<=snap.maxSeq).length}}finally{searchJobs.delete(id)}},
    QueryNewer:async(_filter,since)=>{state.newerCalls++;state.newerActive++;state.newerMax=Math.max(state.newerMax,state.newerActive);const rows=state.rows.filter(r=>r.seq>since);try{if(state.delayNewer)await new Promise(resolve=>{state.resolveNewer=resolve});return rows}finally{state.newerActive--}},
    GetEventRaw:async(seq)=>{state.rawCalls++;if(state.failRaw)throw Error('Storage unavailable');const value=state.rawBySeq[seq] || state.raw;if(state.delayRawSeq===seq)return new Promise(resolve=>{state.resolveRaw=()=>resolve(value)});return value},
    QueryLineage:async(seq)=>{if(state.failLineage)throw Error('Lineage unavailable');return state.lineage || {applicable:state.rows.find(r=>r.seq===seq)?.identityType==='AssumedRole',sourceIdentity:'',complete:false,status:'missing',reason:'No successful supported STS issuance for this key is present in the loaded evidence.',nodes:[]}},
    Investigate:async(options,id)=>{
     state.investigationCalls=(state.investigationCalls||[]).concat([options]);
     try{
      if(state.delayInvestigation)await new Promise((resolve,reject)=>searchJobs.set(id,{resolve,reject}));
      if(state.failInvestigation)throw Error('Investigation query unavailable');
      const anchor=state.rows.find(r=>r.seq===options.seq);
      const snap=options.snapshot||snapshot();
      const matches=state.rows.filter(r=>r.seq<=snap.maxSeq&&(options.relation!=='resources'||r.seq%2===0||r.seq===options.seq)).sort((a,b)=>a.seq-b.seq);
      return {anchor,snapshot:snap,resources:[{arn:'arn:aws:s3:::evidence-bucket',kind:'AWS::S3::Bucket',source:'resources[0].ARN'},{arn:'arn:aws:s3:::evidence-bucket/audit/events.json',kind:'AWS::S3::Object',source:'resources[1].ARN'}],resourcesTruncated:false,events:matches.slice(0,500).map(r=>({event:r,deltaMs:(r.seq-options.seq)*500,reasons:r.seq===options.seq?[{kind:'anchor',label:'Selected event'}]:[{kind:'resource',label:'Shared recorded ARN',value:'arn:aws:s3:::evidence-bucket/audit/events.json'},{kind:'ip',label:'Same source IP (context)',value:'192.0.2.1'}]})),total:matches.length,limit:500,fromMs:Date.parse(anchor.eventTime)-options.minutes*60000,toMs:Date.parse(anchor.eventTime)+options.minutes*60000,notes:['Shared identifiers show relationships in the loaded evidence, not causation. A principal or IP can be used by multiple operators.']};
     }finally{searchJobs.delete(id)}
    },
    QueryLineageGraph:async()=>{if(state.failGraph)throw Error('Graph query unavailable');return {...state.graph,snapshot:snapshot()}},
    QueryLineageChildren:async(key,snap)=>{state.expansionSnapshot=snap;if(state.failExpansion)throw Error('The dataset changed; reload lineage.');return {nodes:[],edges:[],notes:['No further unambiguous child links are present.']}},
    QueryLineageEvents:async(key,snap)=>{state.expansionSnapshot=snap;return {nodes:[],edges:[],notes:[]}},
    QueryLineageRaw:async(seq,snap)=>{state.rawSnapshot=snap;return state.rawBySeq[seq] || state.raw},
    RawBySeqs:async()=>{if(state.exportFails)throw Error('Storage unavailable');return [raw]},
    ExportEventsJSON:async(data)=>{state.exported=data;return 'selection.json'},
    GetEventEvidence:async()=>({total:3,variants:3,observations:[1,2,3].map(id=>({id,source:id===3?'/evidence/history.csv':'/evidence/CloudTrail/2026/09/24/events.json.gz',ordinal:id,format:id===3?'event-history-csv':'cloudtrail-json',lossy:id===3,sha256:String(id).repeat(64),observedAt:'2026-09-24T00:01:00Z',displayed:id===1}))}),
    GetObservation:async(id)=>id===3?'Event name,Event ID,Recipient account ID\nRunInstances,saved-1,111122223333\n':id===2?raw.replace('9007199254740993','9007199254740995'):raw,
    RequiredPermissions:async()=>[{action:'sqs:ChangeMessageVisibility',reason:'Keep messages leased until the local commit completes.'},{action:'cloudtrail:GetEventSelectors',reason:'Verify management-event coverage.'}],
    ListProfiles:async()=>[{name:'default',kind:'sso',region:'us-east-1'},{name:'alternate',kind:'sso',region:'eu-west-1'}],
    VerifyIdentity:async(profile,region)=>{const id={account:'111122223333',arn:`arn:aws:sts::111122223333:assumed-role/Investigator/${profile}`,userId:'test',profile,region};if(state.delayIdentity)return new Promise(resolve=>{state.resolveIdentity=()=>resolve(id)});return id;},
    CheckTrail:async(profile,region)=>{const status={hasLoggingTrail:true,trailCount:1,globalCovered:false,coverageKnown:true,coverageComplete:true,readManagement:true,writeManagement:true,summary:`Management selectors in ${region}: reads true, writes true; global-service logging enabled false. EventBridge delivery is regional and best-effort.`};if(state.failTrail)throw Error('Access denied');if(state.delayTrail)return new Promise(resolve=>{state.resolveTrail=()=>resolve(status)});return status;}
   }}};
  });
  await page.goto('http://127.0.0.1:5181');
  await page.getByRole('button',{name:'Verify identity',exact:true}).click();
  await page.getByText('Management selectors in us-east-1:',{exact:false}).waitFor();
  const coverage=page.locator('b',{hasText:'CloudTrail:'}).locator('../..');
  assert.ok((await coverage.getAttribute('style')).includes('--sev-ok'));
  await page.screenshot({path:path.join(output, 'capture-wide.png'),fullPage:true});
  await page.evaluate(()=>{window.captureTest.delayTrail=true});
  await page.getByRole('button',{name:'Re-verify',exact:true}).click();
  await page.waitForFunction(()=>!!window.captureTest.resolveTrail);
  await page.getByLabel('AWS region').selectOption('eu-west-1');
  await page.evaluate(()=>window.captureTest.resolveTrail());
  await page.waitForTimeout(60);
  assert.equal(await page.getByText('Management selectors in us-east-1:',{exact:false}).count(),0);
  await page.evaluate(()=>{window.captureTest.delayTrail=false;window.captureTest.delayIdentity=true});
  await page.getByRole('button',{name:'Verify identity',exact:true}).click();
  await page.waitForFunction(()=>!!window.captureTest.resolveIdentity);
  await page.getByPlaceholder('Search 2 profiles…').click();
  await page.getByRole('button',{name:/alternate.*sso/}).click();
  await page.evaluate(()=>window.captureTest.resolveIdentity());
  await page.waitForTimeout(60);
  assert.equal(await page.getByText('arn:aws:sts::111122223333:assumed-role/Investigator/default',{exact:true}).count(),0);
  await page.evaluate(()=>{window.captureTest.delayIdentity=false;window.captureTest.failTrail=true});
  await page.getByRole('button',{name:'Verify identity',exact:true}).click();
  await page.getByText('Coverage unknown:',{exact:false}).waitFor();
  await page.setViewportSize({width:1024,height:768});
  await page.screenshot({path:path.join(output, 'capture-unknown.png'),fullPage:true});
  await page.getByText('Connect to existing SQS',{exact:true}).click();
  await page.getByText('Use a dedicated queue;',{exact:false}).waitFor();
  await page.screenshot({path:path.join(output, 'capture-sqs.png'),fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  // Recovery must stay local until the user explicitly resumes a saved queue.
  await page.goto('http://127.0.0.1:5181/?recovery');
  await page.getByRole('button',{name:'Open saved evidence',exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>[window.captureTest.startCalls,window.captureTest.resumeCalls,window.captureTest.removeCalls]),[0,0,0]);
  await page.screenshot({path:path.join(output,'recovery-start.png'),fullPage:true});
  await page.evaluate(()=>window.captureTest.cleanupFails=true);
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Remove infrastructure…',exact:true}).click();
  await page.getByText('Cleanup is incomplete.',{exact:false}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Resume capture',exact:true}).count(),0);
  await page.screenshot({path:path.join(output,'recovery-cleanup.png'),fullPage:true});
  await page.evaluate(()=>window.captureTest.cleanupFails=false);
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Remove infrastructure…',exact:true}).click();
  await page.waitForFunction(()=>window.captureTest.recovery.capture===null);
  await page.getByRole('button',{name:'Open saved evidence',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.captureTest.recovery.evidence.events),1);

  await page.goto('http://127.0.0.1:5181/?recovery');
  await page.getByRole('button',{name:'Open saved evidence',exact:true}).click();
  await page.getByText('RunInstances',{exact:true}).first().click();
  await page.getByRole('button',{name:'Sources & hashes',exact:true}).click();
  await page.getByRole('button',{name:'View source #1',exact:true}).click();
  await page.getByRole('region',{name:'Original source record'}).getByText('9007199254740993',{exact:false}).waitFor();
  assert.equal(await page.evaluate(()=>window.captureTest.resumeCalls),0);
  await page.screenshot({path:path.join(output,'evidence-sources.png'),fullPage:true});
  await page.getByRole('button',{name:'View source #3',exact:true}).click();
  await page.getByText('CSV includes only exported columns.',{exact:false}).waitFor();
  assert.ok((await page.getByRole('region',{name:'Original source record'}).locator('pre').textContent()).startsWith('Event name,Event ID,Recipient account ID\n'));
  await page.getByRole('button',{name:'Close source evidence',exact:true}).click();
  // Exercise the real export through the File menu, including the failure path.
  await page.getByRole('button',{name:'File',exact:true}).click();
  await page.getByRole('button',{name:'Export loaded events…',exact:true}).click();
  await page.waitForFunction(()=>!!window.captureTest.exported);
  assert.ok((await page.evaluate(()=>window.captureTest.exported)).includes('9007199254740993'));
  await page.evaluate(()=>{window.captureTest.exportFails=true;window.captureTest.exported=null});
  const alertSeen=page.waitForEvent('dialog').then(async dialog=>{assert.ok(dialog.message().includes('Export cancelled'));await dialog.accept()});
  await page.getByRole('button',{name:'File',exact:true}).click();
  await page.getByRole('button',{name:'Export loaded events…',exact:true}).click();
  await alertSeen;
  assert.equal(await page.evaluate(()=>window.captureTest.exported),null);
  await page.getByRole('button',{name:'▶ Capture',exact:true}).click();
  await page.waitForFunction(()=>window.captureTest.resumeCalls===1);
  await page.getByText('Capture running ·',{exact:false}).waitFor();
  assert.equal(await page.evaluate(()=>window.captureTest.startCalls),0);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  // Drive the refresh cadence with a browser clock, including deliberately slow
  // native responses. Incoming batches must coalesce rather than queue UI reads.
  await page.clock.install();
  await page.reload();
  await page.getByRole('button',{name:'Open saved evidence',exact:true}).click();
  await page.getByRole('button',{name:'▶ Capture',exact:true}).click();
  await page.getByText('Capture running ·',{exact:false}).waitFor();
  await page.waitForFunction(()=>window.captureTest.aggCalls>=2 && window.captureTest.aggActive===0);
  const idle=await page.evaluate(()=>({agg:window.captureTest.aggCalls,newer:window.captureTest.newerCalls}));
  await page.clock.runFor(3000);
  assert.equal(await page.evaluate(()=>window.captureTest.aggCalls),idle.agg,'idle capture rescanned the dataset');
  await page.evaluate(()=>window.captureTest.emit(1)); // duplicate source observation
  await page.clock.runFor(3000);
  assert.equal(await page.evaluate(()=>window.captureTest.aggCalls),idle.agg);
  assert.equal(await page.evaluate(()=>window.captureTest.newerCalls),idle.newer);

  await page.evaluate(()=>{window.captureTest.delayNewer=true;window.captureTest.delayAgg=true;window.captureTest.emit(2)});
  await page.clock.runFor(500);
  await page.waitForFunction(()=>!!window.captureTest.resolveNewer);
  await page.evaluate(()=>window.captureTest.emit(3));
  await page.clock.runFor(1000);
  assert.equal(await page.evaluate(()=>window.captureTest.newerCalls),idle.newer+1,'overlapping tail requests');
  await page.evaluate(()=>{window.captureTest.delayNewer=false;window.captureTest.resolveNewer()});
  await page.clock.runFor(500);
  await page.getByText('LiveEvent3',{exact:true}).first().waitFor();
  await page.getByText('LiveEvent2',{exact:true}).first().waitFor();
  await page.clock.runFor(3000);
  await page.waitForFunction(()=>!!window.captureTest.resolveAgg);
  const busyAgg=await page.evaluate(()=>window.captureTest.aggCalls);
  await page.evaluate(()=>window.captureTest.emit(4));
  await page.clock.runFor(6000);
  assert.equal(await page.evaluate(()=>window.captureTest.aggCalls),busyAgg,'overlapping aggregate refreshes');
  await page.evaluate(()=>{window.captureTest.delayAgg=false;window.captureTest.resolveAgg()});
  await page.clock.runFor(3000);
  assert.equal(await page.evaluate(()=>window.captureTest.aggCalls),busyAgg+1,'arrivals during a refresh were lost');
  assert.deepEqual(await page.evaluate(()=>[window.captureTest.aggMax,window.captureTest.newerMax]),[1,1]);

  await page.getByText('RunInstances',{exact:true}).first().click();
  await page.getByRole('button',{name:'Sources & hashes',exact:true}).waitFor();
  const frozen=await page.evaluate(()=>({agg:window.captureTest.aggCalls,newer:window.captureTest.newerCalls}));
  await page.evaluate(()=>window.captureTest.emit(5));
  await page.clock.runFor(6000);
  assert.deepEqual(await page.evaluate(()=>({agg:window.captureTest.aggCalls,newer:window.captureTest.newerCalls})),frozen,'inspection did not freeze the visible window');
  await page.screenshot({path:path.join(output,'live-inspection.png'),fullPage:true});
  await checkStatusBar(page);
  await page.setViewportSize({width:960,height:640});
  await checkStatusBar(page);
  await page.screenshot({path:path.join(output,'statusbar-minimum.png'),fullPage:true});
  // Inspection needs only a progress notification, not a million fixture rows.
  await page.evaluate(()=>window.captureTest.emit(1000004,false));
  await checkStatusBar(page,'↑ 1,000,000 new events');
  await page.screenshot({path:path.join(output,'statusbar-large-count.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  await checkStatusBar(page,'↑ 1,000,000 new events');
  assert.deepEqual(await page.evaluate(()=>({agg:window.captureTest.aggCalls,newer:window.captureTest.newerCalls})),frozen,'resizing resumed Follow during inspection');
  await page.getByRole('button',{name:'↑ 1,000,000 new events',exact:true}).click();
  await page.locator('.sb-mode.live').waitFor();
  assert.equal(await page.locator('.newpill').count(),0,'explicit Follow did not clear pending arrivals');
  // Invalid draft syntax must never replace an applied search. A failed engine
  // request must keep older evidence explicitly labelled until a successful retry.
  await page.goto('http://127.0.0.1:5181/?recovery');
  await page.evaluate(()=>{window.captureTest.searchMode=true;window.captureTest.emit(2)});
  await page.getByRole('button',{name:'Open saved evidence',exact:true}).click();
  await page.getByText('LiveEvent2',{exact:true}).first().waitFor();
  const query=page.getByRole('textbox',{name:'Search query',exact:true});
  await query.fill('eventID="saved-1"');
  await query.press('Enter');
  await page.getByText('LiveEvent2',{exact:true}).waitFor({state:'hidden'});
  await page.getByText('RunInstances',{exact:true}).first().waitFor();
  await page.screenshot({path:path.join(output,'search-valid.png'),fullPage:true});
  const appliedCalls=await page.evaluate(()=>window.captureTest.aggCalls);
  await query.fill('eventName~"(?=Run)"');
  await query.press('Enter');
  await page.clock.runFor(500);
  assert.equal(await query.getAttribute('aria-invalid'),'true');
  assert.equal(await page.evaluate(()=>window.captureTest.aggCalls),appliedCalls,'invalid query reached the engine');
  assert.equal(await page.getByText('LiveEvent2',{exact:true}).count(),0,'invalid query widened results');
  await page.screenshot({path:path.join(output,'search-invalid.png'),fullPage:true});
  await page.evaluate(()=>{window.captureTest.failSearch=true});
  await query.fill('eventID="missing"');
  await query.press('Enter');
  await page.getByRole('alert').filter({hasText:'Search failed.'}).waitFor();
  await page.getByText('RunInstances',{exact:true}).first().waitFor();
  await page.evaluate(()=>{window.captureTest.failSearch=false});
  await page.getByRole('button',{name:'Retry search',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Search failed.'}).waitFor({state:'hidden'});
  await page.getByText('RunInstances',{exact:true}).waitFor({state:'hidden'});
  await page.getByTitle('Clear all filters',{exact:true}).click();
  await page.getByText('LiveEvent2',{exact:true}).first().waitFor();
  await query.fill('(');
  await page.getByTitle('Clear all filters',{exact:true}).click();
  assert.equal(await query.inputValue(),'','Clear did not discard an unapplied draft');
  // Large-event rendering stays bounded; exact evidence survives the worker,
  // field pages, raw-source segments, and progress updates.
  await page.goto('http://127.0.0.1:5181/?recovery');
  await page.evaluate(()=>{
    const state=window.captureTest;
    state.raw=JSON.stringify({eventID:'saved-1',eventName:'RunInstances',eventTime:'2026-09-24T00:00:00Z',userIdentity:{type:'IAMUser',userName:'analyst'},opaque:'EXACT_INTEGER',requestParameters:{items:Array.from({length:20000},(_,i)=>({resourceId:`i-${i}`,state:'active'}))},longValue:'x'.repeat(100000)}).replace('"EXACT_INTEGER"','9007199254740993');
    state.rawBySeq[1]=state.raw;
  });
  await page.getByRole('button',{name:'Open saved evidence',exact:true}).click();
  await page.locator('.row').getByText('RunInstances',{exact:true}).click();
  const fields=page.getByRole('region',{name:'Event fields',exact:true});
  await fields.getByText('9007199254740993',{exact:true}).waitFor();
  await fields.getByRole('button',{name:/requestParameters/}).click();
  await fields.getByRole('button',{name:/items/}).click();
  await page.clock.runFor(50);
  assert.ok(await fields.locator('.ft-row').count()<40,'field tree mounted the full large array');
  await fields.evaluate(el=>{el.scrollTop=el.scrollHeight});
  await page.clock.runFor(100);
  await fields.getByRole('button',{name:'Next fields',exact:true}).click();
  await fields.getByText('51–100 of 20,000',{exact:true}).waitFor();
  await fields.evaluate(el=>{el.scrollTop=0});
  await page.clock.runFor(100);
  const parsedOnce=await page.evaluate(()=>window.captureTest.inspectorLoads);
  await page.evaluate(()=>window.captureTest.emit(2));
  await page.clock.runFor(500);
  assert.equal(await page.evaluate(()=>window.captureTest.inspectorLoads),parsedOnce,'capture progress reparsed the selected record');
  assert.ok(await fields.locator('.ft-row').count()<40);
  await page.setViewportSize({width:960,height:720});
  await page.clock.runFor(100);
  await fields.scrollIntoViewIfNeeded();
  await page.clock.runFor(100);
  await page.screenshot({path:path.join(output,'inspector-large.png'),fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.getByRole('button',{name:'{ } Raw JSON',exact:true}).click();
  const rawDialog=page.getByRole('dialog',{name:'Raw JSON',exact:true});
  assert.ok((await rawDialog.locator('pre').textContent()).includes('9007199254740993'));
  assert.ok((await rawDialog.locator('pre').textContent()).length<=32769);
  await rawDialog.getByRole('button',{name:'Next text segment',exact:true}).click();
  await rawDialog.getByText('Segment 2 of',{exact:false}).waitFor();
  await rawDialog.getByRole('button',{name:'⧉ Copy',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.captureTest.copied),await page.evaluate(()=>window.captureTest.raw),'Copy omitted source outside the visible segment');
  await page.screenshot({path:path.join(output,'inspector-raw.png'),fullPage:true});
  await page.keyboard.press('Escape');
  await rawDialog.waitFor({state:'hidden'});
  await fields.waitFor({state:'visible'});
  // Late details must not replace a different event; failures have an explicit retry.
  await page.goto('http://127.0.0.1:5181/?recovery');
  await page.evaluate(()=>{
    const state=window.captureTest;state.emit(2);state.delayRawSeq=1;
    state.rawBySeq[2]='{"eventID":"second-event","eventName":"LiveEvent2","userIdentity":{"type":"AssumedRole"}}';
    state.rows[0].identityType='AssumedRole';state.failLineage=true;
  });
  await page.getByRole('button',{name:'Open saved evidence',exact:true}).click();
  await page.locator('.row').getByText('RunInstances',{exact:true}).click();
  await page.getByText('Loading event…',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>typeof window.captureTest.resolveRaw),'function','delayed detail request was not started');
  await page.locator('.etbody').evaluate(el=>{el.scrollTop=0});
  await page.clock.runFor(100);
  await page.locator('.row').getByText('LiveEvent2',{exact:true}).click();
  await fields.getByText('second-event',{exact:true}).waitFor();
  await page.evaluate(()=>window.captureTest.resolveRaw());
  await page.clock.runFor(100);
  assert.equal(await fields.getByText('saved-1',{exact:true}).count(),0,'late response replaced selected evidence');
  await page.getByRole('button',{name:'Retry lineage',exact:true}).waitFor();
  await page.evaluate(()=>{window.captureTest.failLineage=false});
  await page.getByRole('button',{name:'Retry lineage',exact:true}).click();
  await fields.getByText('second-event',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Retry lineage',exact:true}).count(),0);
  await page.locator('.row').getByText('LiveEvent2',{exact:true}).click();
  await page.evaluate(()=>{window.captureTest.failRaw=true});
  await page.locator('.row').getByText('LiveEvent2',{exact:true}).click();
  await page.getByRole('button',{name:'Retry event',exact:true}).waitFor();
  await page.screenshot({path:path.join(output,'inspector-error.png'),fullPage:true});
  await page.evaluate(()=>{window.captureTest.failRaw=false});
  await page.getByRole('button',{name:'Retry event',exact:true}).click();
  await fields.getByText('second-event',{exact:true}).waitFor();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  // Superseded searches cancel at the bridge and do not build an engine backlog.
  await page.goto('http://127.0.0.1:5181/?recovery');
  await page.evaluate(()=>{window.captureTest.emit(3);window.captureTest.searchMode=true});
  await page.getByRole('button',{name:'Open saved evidence',exact:true}).click();
  await page.locator('.row').getByText('LiveEvent3',{exact:true}).waitFor();
  await page.evaluate(()=>{window.captureTest.delaySearch=true});
  await query.fill('eventID="saved-1"');await query.press('Enter');
  await page.clock.runFor(100);
  assert.ok(await page.evaluate(()=>window.captureTest.pendingSearch),'slow search did not start');
  await page.evaluate(()=>{window.captureTest.delaySearch=false});
  await query.fill('eventID="live-2"');await query.press('Enter');
  await page.locator('.row').getByText('LiveEvent2',{exact:true}).waitFor();
  assert.equal(await page.locator('.row').getByText('RunInstances',{exact:true}).count(),0);
  assert.deepEqual(await page.evaluate(()=>[window.captureTest.cancelledQueries,window.captureTest.searchMax]),[1,1]);
  // Export all matches is independent of the first 2,000 loaded events.
  await page.goto('http://127.0.0.1:5181/?recovery');
  await page.evaluate(()=>window.captureTest.emit(2505));
  await page.getByRole('button',{name:'Open saved evidence',exact:true}).click();
  await page.locator('.row').getByText('LiveEvent2505',{exact:true}).waitFor();
  await page.getByRole('button',{name:'File',exact:true}).click();
  await page.getByRole('button',{name:'Export all matching events…',exact:true}).click();
  await page.getByText('Exported 2,505 matching events to cloudtrail-matches.json',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.captureTest.exportedFilter.snapshot.maxSeq),2505);
  await page.getByRole('button',{name:'File',exact:true}).click();
  await page.screenshot({path:path.join(output,'search-valid.png'),fullPage:true});
  await page.locator('.tbar-backdrop').click({position:{x:8,y:200}});
  await page.evaluate(()=>{window.captureTest.delayExport=true;window.captureTest.exportedFilter=null});
  await page.getByRole('button',{name:'File',exact:true}).click();
  await page.getByRole('button',{name:'Export all matching events…',exact:true}).click();
  await page.getByRole('button',{name:'Cancel export',exact:true}).click();
  await page.getByText('Export cancelled; no incomplete file was saved.',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.captureTest.exportedFilter),null);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  // Credential lineage supports temporary users and keeps uncertainty visible.
  await page.goto('http://127.0.0.1:5181/?recovery');
  await page.evaluate(()=>{
    const state=window.captureTest;
    state.lineage={applicable:true,sourceIdentity:'recorded-operator',complete:true,status:'observed',reason:'Chain reaches a recorded principal; this does not verify the human operator.',nodes:[{identityType:'IAMUser',arn:'arn:aws:iam::111:user/alice',userName:'alice',accountId:'111',roleArn:'',sessionName:'',invokedBy:'',viaSeq:10,viaEvent:'GetSessionToken',viaTime:'2026-09-24T00:00:00Z',viaSourceIP:'192.0.2.1',evidence:'Exact access-key match to successful STS issuance; expiration not recorded',evidenceSeqs:[10,11]}]};
    const common={roleArn:'',roleName:'',sessionName:'',invokedBy:'',childCount:1,events:1};
    state.graph={applicable:true,rootId:'AKIAALICE',currentId:'ASIACHILD',notes:['Recorded sourceIdentity is a session attribute; identity assurance depends on the issuing policy.'],nodes:[{...common,id:'AKIAALICE',kind:'origin',identityType:'IAMUser',arn:'arn:aws:iam::111:user/alice',accountId:'111',userName:'alice',accessKeyId:'AKIAALICE'},{...common,id:'ASIACHILD',kind:'current',identityType:'IAMUser',arn:'arn:aws:iam::111:user/alice',accountId:'111',userName:'alice',accessKeyId:'ASIACHILD'}],edges:[{parent:'AKIAALICE',child:'ASIACHILD',viaSeq:10,viaEvent:'GetSessionToken',viaTime:'2026-09-24T00:00:00Z',viaIP:'192.0.2.1',evidence:'Exact access-key match; issuance precedes use; expiration not recorded',evidenceSeqs:[10,11]}]};
    state.rawBySeq[10]='{"eventName":"GetSessionToken","eventID":"issuance-evidence"}';state.failGraph=true;
  });
  await page.getByRole('button',{name:'Open saved evidence',exact:true}).click();
  await page.locator('.row').getByText('RunInstances',{exact:true}).click();
  await page.getByText('principal observed',{exact:true}).waitFor();
  await page.getByRole('button',{name:'⤢ View full lineage',exact:true}).click();
  await page.locator('.lgv-error').getByText('Graph query unavailable',{exact:false}).waitFor();
  await page.evaluate(()=>{window.captureTest.failGraph=false});
  await page.getByRole('button',{name:'Reload lineage',exact:true}).click();
  await page.locator('.lgv-canvas .lgv-g').first().waitFor();
  assert.equal(await page.locator('.lgv-canvas .lgv-g').count(),2);
  await page.getByRole('button',{name:'Open issuance event',exact:true}).click();
  await page.getByRole('dialog',{name:'Raw JSON',exact:true}).locator('pre').getByText('issuance-evidence',{exact:false}).waitFor();
  assert.equal(await page.evaluate(()=>window.captureTest.rawSnapshot.generation),'fixture');
  await page.keyboard.press('Escape');
  await page.locator('.lgv-modal').waitFor({state:'visible'});
  await page.getByRole('button',{name:'Open linked observation 11',exact:true}).waitFor();
  await page.evaluate(()=>{window.captureTest.failExpansion=true});
  await page.getByRole('button',{name:'Expand 1 issued key',exact:true}).click();
  await page.locator('.lgv-error').getByText('The dataset changed; reload lineage.',{exact:false}).waitFor();
  assert.equal(await page.evaluate(()=>window.captureTest.expansionSnapshot.generation),'fixture');
  await page.evaluate(()=>{window.captureTest.failExpansion=false});
  await page.getByRole('button',{name:'Expand 1 issued key',exact:true}).click();
  await page.getByText('No further unambiguous child links are present.',{exact:true}).waitFor();
  await page.screenshot({path:path.join(output,'investigation-context.png'),fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  // Event context uses a virtual timeline, snapshot-preserving pivots, and retries.
  await page.goto('http://127.0.0.1:5181/?recovery');
  await page.evaluate(()=>{
    const state=window.captureTest,base=state.rows[0];
    state.rows=Array.from({length:520},(_,i)=>({...base,seq:i+1,eventID:`context-${i+1}`,eventName:i===0?'GetObject':i%2?'PutObject':'HeadObject',eventSource:'s3.amazonaws.com',eventTime:new Date(Date.parse('2026-09-24T00:00:00Z')+i*500).toISOString()}));
    state.raw=JSON.stringify({eventID:'context-1',eventName:'GetObject',resources:[{ARN:'arn:aws:s3:::evidence-bucket'},{ARN:'arn:aws:s3:::evidence-bucket/audit/events.json'}]});
    state.rawBySeq[2]='{"eventID":"context-2","eventName":"PutObject"}';state.failInvestigation=true;
  });
  await page.getByRole('button',{name:'Open saved evidence',exact:true}).click();
  await page.locator('.row').getByText('GetObject',{exact:true}).click();
  await page.getByRole('button',{name:'Investigate',exact:true}).click();
  const investigation=page.getByRole('dialog',{name:'Event investigation',exact:true});
  await investigation.getByText('Investigation query unavailable',{exact:false}).waitFor();
  await page.evaluate(()=>{window.captureTest.failInvestigation=false});
  await investigation.getByRole('button',{name:'Retry investigation',exact:true}).click();
  await investigation.getByText('520 events',{exact:true}).waitFor();
  await investigation.locator('.investigation-event').first().waitFor();
  assert.ok(await investigation.locator('.investigation-event').count()<30,'context timeline was not virtualized');
  await investigation.getByText('Showing 500 closest events of 520. Narrow the window or relationship.',{exact:true}).waitFor();
  await investigation.locator('.investigation-event').nth(1).click();
  await investigation.getByRole('button',{name:'Open original record',exact:true}).click();
  await page.getByRole('dialog',{name:'Raw JSON',exact:true}).locator('pre').getByText('context-2',{exact:false}).waitFor();
  await page.keyboard.press('Escape');
  await investigation.waitFor({state:'visible'});
  await investigation.getByRole('button',{name:'Center on this event',exact:true}).click();
  await investigation.locator('.investigation-sub').getByText('PutObject · context-2',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.captureTest.investigationCalls.at(-1).snapshot.generation),'fixture');
  await investigation.getByRole('button',{name:'← Back',exact:true}).click();
  await investigation.getByText('GetObject · context-1',{exact:true}).waitFor();
  await investigation.getByText('520 events',{exact:true}).waitFor();
  await page.evaluate(()=>{window.captureTest.delayInvestigation=true});
  await investigation.getByLabel('Investigation relationship',{exact:true}).selectOption('related');
  await page.clock.runFor(100);
  await page.evaluate(()=>{window.captureTest.delayInvestigation=false});
  await investigation.getByLabel('Investigation relationship',{exact:true}).selectOption('resources');
  await investigation.getByText('261 events',{exact:true}).waitFor();
  assert.ok(await page.evaluate(()=>window.captureTest.cancelledQueries)>0,'superseded context query was not cancelled');
  await page.setViewportSize({width:1440,height:1000});
  await page.clock.runFor(150);
  await page.screenshot({path:path.join(output,'investigation-compare.png'),fullPage:true});
  await page.setViewportSize({width:960,height:720});
  await page.clock.runFor(150);
  await page.screenshot({path:path.join(output,'investigation-context.png'),fullPage:true});
  const fits=await investigation.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&el.scrollWidth<=el.clientWidth});
  assert.ok(fits,'investigation spilled out of the window');
  await investigation.getByRole('button',{name:'Close investigation',exact:true}).click();
  await investigation.waitFor({state:'hidden'});
  // Pin exact originals, compare in a worker, and keep copies stable after reloads.
  await page.goto('http://127.0.0.1:5181/?recovery');
  await page.evaluate(()=>{
    const state=window.captureTest;state.emit(2);state.rows.forEach(r=>{r.eventName='PutRolePolicy';r.eventSource='iam.amazonaws.com'});
    state.rawBySeq[1]='{"eventID":"saved-1","eventName":"PutRolePolicy","requestParameters":{"roleName":"Deployment","policyDocument":{"Action":["s3:GetObject"],"Resource":"arn:aws:s3:::artifacts/*"}},"opaque":9007199254740993,"optional":null}';
    state.rawBySeq[2]='{"eventID":"live-2","eventName":"PutRolePolicy","requestParameters":{"roleName":"Deployment","policyDocument":{"Action":["s3:*"],"Resource":"*"}},"opaque":9007199254740992}';
  });
  await page.getByRole('button',{name:'Open saved evidence',exact:true}).click();
  await page.locator('.row').getByText('PutRolePolicy',{exact:true}).nth(1).click();
  await page.getByRole('button',{name:'Pin event A',exact:true}).click();
  await page.locator('.etbody').evaluate(el=>{el.scrollTop=0});await page.clock.runFor(100);
  await page.locator('.row').getByText('PutRolePolicy',{exact:true}).first().click();
  await page.getByRole('button',{name:'Pin event B',exact:true}).click();
  await page.evaluate(()=>{window.captureTest.rawBySeq[1]='{"eventID":"changed-after-pin","eventName":"Replacement"}'});
  await page.getByRole('button',{name:'Compare events',exact:true}).click();
  const comparison=page.getByRole('dialog',{name:'Compare original records',exact:true});
  await comparison.getByText('9007199254740993',{exact:true}).waitFor();
  await comparison.getByText('9007199254740992',{exact:true}).waitFor();
  await comparison.getByText('Not present',{exact:true}).waitFor();
  await comparison.getByRole('button',{name:'Open original A',exact:true}).click();
  const original=page.getByRole('dialog',{name:'Raw JSON',exact:true});
  assert.ok((await original.locator('pre').textContent()).includes('9007199254740993'));
  assert.ok(!(await original.locator('pre').textContent()).includes('changed-after-pin'),'pinned original was replaced by a later source');
  await page.keyboard.press('Escape');
  await comparison.waitFor({state:'visible'});
  await page.screenshot({path:path.join(output,'investigation-compare.png'),fullPage:true});
  assert.ok(await comparison.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&el.scrollWidth<=el.clientWidth}));
  await comparison.getByRole('button',{name:'Swap A/B',exact:true}).click();
  await comparison.locator('.comparison-change').filter({hasText:'/opaque'}).locator('pre').first().getByText('9007199254740992',{exact:true}).waitFor();
  await comparison.getByRole('button',{name:'Close comparison',exact:true}).click();
  await page.getByRole('button',{name:'Clear pins',exact:true}).click();
  assert.equal(await page.locator('.comparison-bar').count(),0);
  // A large number of changes must be labelled incomplete, never "no differences".
  await page.locator('.row').getByText('PutRolePolicy',{exact:true}).first().click();
  await page.evaluate(()=>{
    const state=window.captureTest;
    state.rawBySeq[1]='{"eventID":"saved-1","eventName":"PutRolePolicy"}';
    state.rawBySeq[2]=JSON.stringify({eventID:'live-2',eventName:'PutRolePolicy',...Object.fromEntries(Array.from({length:1000},(_,i)=>[`change${i}`,i]))});
  });
  await page.locator('.row').getByText('PutRolePolicy',{exact:true}).nth(1).click();
  await page.getByRole('button',{name:'Pin event A',exact:true}).click();
  await page.locator('.etbody').evaluate(el=>{el.scrollTop=0});await page.clock.runFor(100);
  await page.locator('.row').getByText('PutRolePolicy',{exact:true}).first().click();
  await page.getByRole('button',{name:'Pin event B',exact:true}).click();
  await page.getByRole('button',{name:'Compare events',exact:true}).click();
  await comparison.getByText('500 differences found · comparison incomplete',{exact:true}).waitFor();
  assert.ok(await comparison.locator('.comparison-change').count()<30,'comparison rendered every change');
  await comparison.getByRole('button',{name:'Close comparison',exact:true}).click();
  await page.getByRole('button',{name:'Clear pins',exact:true}).click();
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:['verified coverage','stale trail after region change','stale identity after profile change','unknown coverage warning','dedicated queue guidance','1024px layout','saved evidence stays offline','failed cleanup retains handles','cleanup preserves evidence','source variants and CSV provenance','raw export preserves large integers','export failure cancels output','explicit resume reuses capture','idle and duplicate batches avoid scans','slow tail requests coalesce without losing arrivals','aggregate refreshes never overlap','inspection stays anchored during capture','invalid search stays unapplied','failed search shows stale results and retries','clear resets unapplied draft'],errors}));
 } finally {await browser.close();await server.close()}
})().catch(e=>{console.error(e);process.exit(1)});
