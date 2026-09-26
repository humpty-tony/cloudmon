const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
const {pathToFileURL} = require('node:url');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'test-results', 'capture');
fs.mkdirSync(output, {recursive:true});
async function chooseThemed(page,label,option,scope=page) {
 await scope.getByRole('combobox',{name:label,exact:true}).click();
 await page.getByRole('listbox',{name:label,exact:true}).getByRole('option',{name:option,exact:true}).click();
}
async function checkThemedList(page,label) {
 const colors=await page.getByRole('listbox',{name:label,exact:true}).evaluate(list=>{
  const probe=document.createElement('div');probe.style.backgroundColor='var(--bg-2)';probe.style.color='var(--tx-1)';document.body.append(probe);
  const actual=getComputedStyle(list),expected=getComputedStyle(probe),r=list.getBoundingClientRect();
  const result={background:actual.backgroundColor,color:actual.color,expectedBackground:expected.backgroundColor,expectedColor:expected.color,
   fits:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight};
  probe.remove();return result;
 });
 assert.equal(colors.background,colors.expectedBackground,'dropdown background differs from the active theme');
 assert.equal(colors.color,colors.expectedColor,'dropdown text differs from the active theme');
 assert.ok(colors.fits,'dropdown spills outside the window');
 return colors;
}
async function checkModalFocus(page,dialog) {
 const actions=dialog.locator('button:not(:disabled),[tabindex="0"]');
 await actions.first().focus();
 await page.keyboard.press('Shift+Tab');
 assert.ok(await actions.last().evaluate(el=>document.activeElement===el),'Shift+Tab escaped the event inspector');
 await page.keyboard.press('Tab');
 assert.ok(await actions.first().evaluate(el=>document.activeElement===el),'Tab escaped the event inspector');
}
async function workbenchLayout(page) {
 return page.locator('.workbench-results .etbody').evaluate(table=>({
  scrollTop:table.scrollTop,
  width:table.clientWidth,
  height:table.clientHeight,
  rows:[...table.querySelectorAll('.rowwrap')].map(row=>{
   const rect=row.getBoundingClientRect();
   return {index:row.dataset.index,top:rect.top,height:rect.height};
  }),
 }));
}
async function checkWorkbenchFits(page) {
 const bounds=await page.evaluate(()=>{
  const panes=['.workbench-body','.workbench-results','.workbench-body > .event-inspector'].map(selector=>{
   const element=document.querySelector(selector),rect=element?.getBoundingClientRect();
   return {selector,empty:element?.classList.contains('is-empty'),exists:!!element,inside:!!rect&&rect.left>=0&&rect.top>=0&&rect.right<=innerWidth+1&&rect.bottom<=innerHeight+1,
    width:rect?.width,height:rect?.height};
  });
  return {panes,pageFits:document.documentElement.scrollWidth<=innerWidth};
 });
 assert.ok(bounds.pageFits&&bounds.panes.every(p=>p.exists&&p.inside&&(p.empty?p.width===0:p.width>100)&&p.height>100),`Workbench panes spill outside the window: ${JSON.stringify(bounds)}`);
 assert.equal(await page.locator('.workbench-results .row-expand').count(),0,'Workbench rendered an inline expansion');
}
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
  const version=footer.querySelector('.sb-version').getBoundingClientRect();
  return {inside:pill.top>=bar.top && pill.bottom<=bar.bottom && pill.left>=bar.left && pill.right<=bar.right,
   visible:pill.width>0 && pill.height>0 && bar.bottom<=innerHeight && bar.right<=innerWidth,
   versionInside:version.left>=bar.left && version.right<=bar.right && version.bottom<=bar.bottom,
   label:button.textContent.replace(/\s+/g,' ').trim(),
   pill:{width:pill.width,height:pill.height},bar:{width:bar.width,height:bar.height}};
 });
 assert.ok(bounds.inside && bounds.visible,`New-event badge spills out of the footer: ${JSON.stringify(bounds)}`);
 assert.ok(bounds.versionInside,`Build version spills out of the footer: ${JSON.stringify(bounds)}`);
 const buildTag=process.env.VITE_APP_VERSION || 'dev';
 assert.equal(await page.locator('.sb-version').getAttribute('title'),buildTag,'Version tooltip must preserve the full build version');
 assert.equal((await page.locator('.sb-version').textContent()).trim(),`⬢ ${buildTag}`,'Build must show its injected version');
 assert.equal(bounds.label,expected,'Inspection lost its pending event count');
}
(async()=>{
 const vite=await import('vite');
 const server=await vite.createServer({root,cacheDir:path.join(root,'node_modules','.vite-capture-ui'),server:{host:'127.0.0.1',port:5181,strictPort:true}}); await server.listen();
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',e=>{errors.push(String(e));console.error('Browser error:',e.stack||String(e))});
  await page.addInitScript(()=>{
   const raw='{"eventID":"saved-1","eventTime":"2026-09-24T00:00:00Z","eventName":"RunInstances","eventSource":"ec2.amazonaws.com","awsRegion":"us-east-1","recipientAccountId":"111122223333","userIdentity":{"type":"IAMUser","userName":"analyst"},"opaque":9007199254740993}';
   const config={mode:'create-infra',profile:'investigator',region:'us-east-1',queueUrl:'',ruleArn:'',dumpPath:'',dumpText:'',capturePattern:''};
   const infra={owned:true,queueUrl:'https://sqs.us-east-1.amazonaws.com/111122223333/cloudmon-capture-saved',queueName:'cloudmon-capture-saved',queueArn:'arn:aws:sqs:us-east-1:111122223333:cloudmon-capture-saved',ruleName:'cloudmon-cloudtrail-saved',ruleArn:'arn:aws:events:us-east-1:111122223333:rule/cloudmon-cloudtrail-saved',region:'us-east-1',account:'111122223333',allManagement:true};
   const recovering=location.search.includes('recovery');
   const state=window.captureTest={delayIdentity:false,delayTrail:false,failTrail:false,startCalls:0,resumeCalls:0,removeCalls:0,cleanupFails:false,exportFails:false,exported:null,raw,
     aggCalls:0,aggActive:0,aggMax:0,newerCalls:0,newerActive:0,newerMax:0,delayAgg:false,delayNewer:false,searchMode:false,failSearch:false,
     searchCalls:[],searchActive:0,searchMax:0,delaySearch:false,delayExport:false,cancelledQueries:0,exportedFilter:null,rawBySeq:{},rawCalls:0,copied:null,failRaw:false,failLineage:false,delayRawSeq:0,inspectorLoads:0,snapshotCalls:[],
     // Match the native EventRow contract: absent indexed strings are empty,
     // not undefined. Overview renders these fields before raw evidence loads.
     rows:[{seq:1,eventID:"saved-1",eventName:"RunInstances",eventSource:"ec2.amazonaws.com",eventTime:"2026-09-24T00:00:00Z",awsRegion:"us-east-1",identityType:"IAMUser",userName:"analyst",sourceIPAddress:'',userAgent:'',principalId:'',identityArn:'',accountId:'',roleArn:'',sessionName:'',recipientAccountId:'111122223333',target:'',readOnly:false,managementEvent:true}],
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
    GetLineageAttribution:async()=>null,
    GetRecoveryState:async()=>structuredClone(state.recovery),
    GetEvidenceSnapshot:async()=>{const snap={...snapshot(),generation:state.snapshotGeneration||'fixture'};state.snapshotCalls.push(snap);if(state.failSnapshot)throw Error('Snapshot unavailable');if(state.delaySnapshot)return new Promise(resolve=>{state.resolveSnapshot=()=>resolve(snap)});return snap},
    StartCapture:async()=>{state.startCalls++;throw Error('Unexpected provisioning')},
    ResumeCapture:async()=>{state.resumeCalls++;state.recovery.active=true;return infra},
    StopCapture:async()=>{state.recovery.active=false},
    TeardownCapture:async()=>{state.removeCalls++;state.recovery.active=false;if(state.cleanupFails){state.recovery.capture.phase='cleanup';throw Error('Queue deletion denied; saved resources retained')}state.recovery.capture=null},
    QueryAggregates:async(filter)=>{state.aggCalls++;const rows=queryRows(filter);state.aggActive++;state.aggMax=Math.max(state.aggMax,state.aggActive);const result={snapshot:snapshot(),total:rows.length,facets:state.workbenchFacets||{},histogram:[],histFrom:0,histTo:0,histStep:60000,stats:{errors:0,principals:1,sources:1,regions:1,minMs:0,maxMs:0}};try{if(state.delayAgg)await new Promise(resolve=>{state.resolveAgg=resolve});return result}finally{state.aggActive--}},
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
    QueryLineageGraph:async()=>{if(state.failGraph)throw Error('Graph query unavailable');return {...(state.graph||{applicable:false,rootId:'',currentId:'',nodes:[],edges:[],notes:['No credential links observed in this fixture.']}),snapshot:snapshot()}},
    QueryLineageChildren:async(key,snap)=>{state.expansionSnapshot=snap;if(state.failExpansion)throw Error('The dataset changed; reload lineage.');return {nodes:[],edges:[],notes:['No further unambiguous child links are present.']}},
    QueryLineageEvents:async(key,snap)=>{state.expansionSnapshot=snap;return {nodes:[],edges:[],notes:[]}},
    QueryLineageRaw:async(seq,snap)=>{state.rawSnapshot=snap;state.rawSeq=seq;return window.go.main.App.GetEventRaw(seq)},
    Analyze:async(options,id)=>{
     state.analysisCalls=(state.analysisCalls||[]).concat([options]);
     try{
      if(state.delayAnalysis)await new Promise((resolve,reject)=>searchJobs.set(id,{resolve,reject}));
      if(state.failAnalysis)throw Error('The dataset changed; run analysis again');
      const stats={events:120,errors:3,writes:40,unknownReadOnly:10,credentialIDs:2,invalidTimes:0,firstMs:Date.parse('2026-09-23T12:00:00Z'),lastMs:Date.parse('2026-09-24T00:00:00Z')};
      const groups=[{value:'arn:aws:sts::111122223333:assumed-role/ProductionInvestigationReader/audit-session-with-a-long-identifier',current:90,previous:30,errors:2,writes:32,totalGroups:2},{value:'arn:aws:iam::111122223333:user/automation',current:30,previous:0,errors:1,writes:8,totalGroups:2}];
      return {snapshot:options.snapshot||snapshot(),scope:{...stats,events:150,invalidTimes:2},current:stats,previous:{...stats,events:30},groups:options.entity?groups.filter(g=>g.value===options.entity.value):groups,totalGroups:options.entity?1:2,limit:50,fromMs:Date.parse('2026-09-23T00:00:00.001Z'),toMs:Date.parse('2026-09-24T00:00:00.001Z'),previousFromMs:Date.parse('2026-09-22T00:00:00.001Z'),hasWindow:true,breakdowns:{eventSource:[{value:'iam.amazonaws.com',current:90,previous:30,totalGroups:1}],eventName:[{value:'PutRolePolicy',current:90,previous:30,totalGroups:1}],sourceIPAddress:[{value:'192.0.2.1',current:90,previous:30,totalGroups:1}]},events:options.entity?state.rows.slice(0,2):[],notes:['Counts describe stored events, not unique AWS actions.','Missing evidence can explain differences; this is not a statistical anomaly detector.']};
     }finally{searchJobs.delete(id)}
    },
    Hunt:async(options,id)=>{
     state.huntCalls=(state.huntCalls||[]).concat([options]);
     try{
      if(state.delayHunt)await new Promise((resolve,reject)=>searchJobs.set(id,{resolve,reject}));
      if(state.failHunt)throw Error('Indicator 2 has an invalid IP address');
      const first=state.rows[0],stepCount=options.steps?.length||2;
      const sequenceEvents=Array.from({length:stepCount},(_,i)=>({...((state.rows[i])||first),eventTime:new Date(Date.parse(first.eventTime)+i*60000).toISOString()}));
      const tiedCandidates=sequenceEvents.map((_,i)=>i===0?2:i===2&&i<stepCount-1?3:1);
      const snap=snapshot();state.lastHuntSnapshot=snap;
      return {snapshot:snap,scanned:900,total:options.mode==='sequence'?1:600,limit:500,invalidTimes:2,missingPrincipal:3,missingCredential:4,indicators:options.indicators.map(indicator=>({...indicator,matches:600})),matches:options.mode==='indicators'?Array.from({length:500},(_,i)=>({event:{...first,seq:first.seq+i,eventID:i===0?first.eventID:`indicator-${i}`,identityArn:'arn:aws:sts::111122223333:assumed-role/Investigator/session'},indicators:[0,1]})):[],sequences:options.mode==='sequence'?[{events:sequenceEvents,deltaMs:(stepCount-1)*60000,tiedCandidates}]:[],pairs:options.mode==='sequence'&&stepCount===2?[{first:sequenceEvents[0],second:sequenceEvents[1],deltaMs:60000,tiedFirst:2}]:[],notes:['Counts can overlap across indicators.','Sequences show temporal proximity for recorded identifiers, not causation.']};
     }finally{searchJobs.delete(id)}
    },
    SigmaRunRequest:async(yaml,id)=>{
     state.sigmaCalls=(state.sigmaCalls||[]).concat([yaml]);
     try{
      if(state.delaySigma)await new Promise((resolve,reject)=>searchJobs.set(id,{resolve,reject}));
      if(state.failSigma)throw Error('Sigma storage unavailable');
      return {parsed:true,supported:true,title:'Root account activity',diagnostics:[],sql:'SELECT events within snapshot',matches:1,scanned:state.rows.length,rows:state.rows.slice(0,1),snapshot:snapshot(),explanations:{[state.rows[0].seq]:[{name:'selection',matched:true},{name:'filter_service',matched:false}]}};
     }finally{searchJobs.delete(id)}
    },
    SigmaSuite:async(rules,id)=>{
     state.sigmaSuiteRules=rules;
     try{
      if(state.delaySuite)await new Promise((resolve,reject)=>searchJobs.set(id,{resolve,reject}));
      if(state.failSuite)throw Error('Suite storage unavailable');
      const snap=snapshot();return {snapshot:snap,results:rules.map((rule,i)=>({name:rule.name,result:{parsed:true,supported:i!==1,title:rule.yaml.match(/^title: (.*)/m)[1],diagnostics:i===1?[{severity:'error',message:'This fixture rule uses an unsupported modifier'}]:[],sql:'SELECT snapshot',matches:i===1?0:1,scanned:state.rows.length,rows:i===1?[]:state.rows.slice(0,1),snapshot:snap,explanations:{[state.rows[0].seq]:[{name:'selection',matched:true}]}}}))};
     }finally{searchJobs.delete(id)}
    },
    QueryLineageSnapshot:async(seq,snap)=>{state.lineageSnapshot=snap;return window.go.main.App.QueryLineage(seq)},
    QueryLineageGraphSnapshot:async(seq,snap)=>{state.graphSnapshot=snap;return {...await window.go.main.App.QueryLineageGraph(seq),snapshot:snap}},
    GetEventEvidenceSnapshot:async(seq,offset,snap)=>{state.evidenceSnapshot=snap;return window.go.main.App.GetEventEvidence(seq,offset)},
    GetObservationSnapshot:async(id,snap)=>{state.observationSnapshot=snap;return window.go.main.App.GetObservation(id)},
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
  await page.locator('.workbench-results .row').getByText('RunInstances',{exact:true}).first().click();
  await openReviewEvidence(page);
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

  await page.locator('.workbench-results .row').getByText('RunInstances',{exact:true}).first().click();
  await page.getByRole('button',{name:'Related events',exact:true}).waitFor();
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
  // The right inspector takes width only while selected. Row heights/vertical
  // anchoring stay stable, and the two scrollable panes operate independently.
  await page.goto('http://127.0.0.1:5181/?recovery');
  await page.evaluate(()=>{
    const state=window.captureTest;state.emit(120);
    state.workbenchFacets={eventSource:[{value:'ec2.amazonaws.com',count:120}],userName:[{value:'analyst',count:120}],identityType:[{value:'IAMUser',count:120}],awsRegion:[{value:'us-east-1',count:120}]};
    for(const row of state.rows)state.rawBySeq[row.seq]=JSON.stringify({
      eventID:row.eventID,eventName:row.eventName,eventTime:row.eventTime,
      requestParameters:{items:Array.from({length:150},(_,i)=>({resourceId:`resource-${i}`,state:'active'}))},
    });
  });
  await page.getByRole('button',{name:'Open saved evidence',exact:true}).click();
  const workbenchTable=page.locator('.workbench-results .etbody');
  const workbenchInspector=page.locator('.workbench-body > .event-inspector');
  await page.locator('.row').getByText('LiveEvent120',{exact:true}).waitFor();
  await page.clock.runFor(100);
  const unselectedLayout=await workbenchLayout(page);
  await page.locator('.row').getByText('LiveEvent120',{exact:true}).click();
  await workbenchInspector.getByRole('tab',{name:'Fields',exact:true}).click();
  await workbenchInspector.getByRole('region',{name:'Event fields',exact:true}).getByText('live-120',{exact:true}).waitFor();
  await page.clock.runFor(100);
  const selectedLayout=await workbenchLayout(page);
  assert.ok(selectedLayout.width<unselectedLayout.width,'Selecting an event did not allocate the right inspector');
  assert.deepEqual({...selectedLayout,width:unselectedLayout.width},unselectedLayout,'Selecting an event moved event rows vertically');
  const selectedSnapshotCount=await page.evaluate(()=>window.captureTest.snapshotCalls.length);
  await page.locator('.row--selected').click();
  await workbenchInspector.getByRole('button',{name:'Close inspector',exact:true}).waitFor();
  assert.equal(await page.locator('.row--selected').count(),1,'Clicking the selected row closed its inspector');
  assert.equal(await page.evaluate(()=>window.captureTest.snapshotCalls.length),selectedSnapshotCount,'Repeated selection widened the evidence snapshot');
  const workbenchParses=await page.evaluate(()=>window.captureTest.inspectorLoads);
  await workbenchTable.focus();
  await page.keyboard.press('ArrowDown');
  await workbenchInspector.getByRole('region',{name:'Event fields',exact:true}).getByText('live-119',{exact:true}).waitFor();
  await page.keyboard.press('ArrowUp');
  await workbenchInspector.getByRole('region',{name:'Event fields',exact:true}).getByText('live-120',{exact:true}).waitFor();
  await page.clock.runFor(100);
  assert.deepEqual(await workbenchLayout(page),selectedLayout,'Keyboard selection moved visible rows');
  assert.ok(await page.evaluate(()=>window.captureTest.inspectorLoads)>workbenchParses,'Keyboard selection left old inspector evidence');
  // Navigation keys inside an inspector control must not select another event.
  await workbenchInspector.getByRole('tab',{name:'Fields',exact:true}).focus();
  await page.keyboard.press('ArrowDown');
  assert.ok((await page.locator('.row--selected').textContent()).includes('LiveEvent120'));
  const workbenchFields=workbenchInspector.getByRole('region',{name:'Event fields',exact:true});
  await workbenchFields.getByRole('button',{name:/requestParameters/}).click();
  await workbenchFields.getByRole('button',{name:/items/}).click();
  // Advancing the animation clock does not complete the field worker request.
  // Wait for an actual array child before measuring/scrolling the loaded page.
  await workbenchFields.getByTitle('requestParameters.items.0',{exact:true}).waitFor();
  await page.clock.runFor(100);
  const tableScrollBefore=await workbenchTable.evaluate(el=>el.scrollTop);
  await workbenchFields.evaluate(el=>{el.scrollTop=el.scrollHeight});
  await page.clock.runFor(100);
  const inspectorScroll=await workbenchFields.evaluate(el=>el.scrollTop);
  assert.ok(inspectorScroll>0,'Inspector fields did not have their own scroll area');
  assert.equal(await workbenchTable.evaluate(el=>el.scrollTop),tableScrollBefore,'Scrolling fields moved the event list');
  await workbenchTable.evaluate(el=>{el.scrollTop=320});
  await page.clock.runFor(100);
  assert.equal(await workbenchFields.evaluate(el=>el.scrollTop),inspectorScroll,'Scrolling events moved the inspector');
  assert.equal(await workbenchTable.evaluate(el=>el.scrollTop),320,'Event list did not scroll independently');
  const retainedSelection=await page.evaluate(()=>window.captureTest.inspectorLoads);
  await page.clock.runFor(500);
  assert.equal(await page.evaluate(()=>window.captureTest.inspectorLoads),retainedSelection,'Scrolling reparsed selected evidence');
  await workbenchTable.evaluate(el=>{el.scrollTop=0});
  await workbenchFields.evaluate(el=>{el.scrollTop=0});
  const workbenchTheme=await page.evaluate(()=>document.documentElement.dataset.theme);
  for(const theme of ['graphite','light']) {
    await page.evaluate(theme=>{document.documentElement.dataset.theme=theme},theme);
    for(const width of [1440,960]) {
      await page.setViewportSize({width,height:720});
      await page.clock.runFor(100);
      await checkWorkbenchFits(page);
      await page.screenshot({path:path.join(output,`workbench-${theme}-${width}.png`),fullPage:true});
    }
  }
  await page.evaluate(theme=>{if(theme===undefined)delete document.documentElement.dataset.theme;else document.documentElement.dataset.theme=theme},workbenchTheme);
  const beforeClose=await workbenchLayout(page);
  await workbenchInspector.getByRole('button',{name:'Close inspector',exact:true}).click();
  await page.clock.runFor(100);
  assert.equal(await page.locator('.row--selected').count(),0,'Close inspector left a selected event');
  const closedLayout=await workbenchLayout(page);
  assert.ok(closedLayout.width>beforeClose.width,'Closing the inspector did not return its width to the event list');
  assert.deepEqual({...closedLayout,width:beforeClose.width},beforeClose,'Closing the inspector moved event rows vertically');
  await checkWorkbenchFits(page);
  await page.locator('.row').getByText('LiveEvent120',{exact:true}).click();
  await workbenchInspector.getByRole('tab',{name:'Fields',exact:true}).focus();
  await page.keyboard.press('Escape');
  await workbenchInspector.getByRole('button',{name:'Close inspector',exact:true}).waitFor({state:'hidden'});
  assert.equal(await page.locator('.row--selected').count(),0,'Escape inside the inspector failed to clear its selection');
  await page.setViewportSize({width:1440,height:1000});
  // Invalid draft syntax must never replace an applied search. A failed engine
  // request must keep older evidence explicitly labelled until a successful retry.
  await page.goto('http://127.0.0.1:5181/?recovery');
  await page.evaluate(()=>{window.captureTest.searchMode=true;window.captureTest.emit(2);window.captureTest.rawBySeq[2]='{"eventID":"live-2","eventName":"LiveEvent2"}'});
  await page.getByRole('button',{name:'Open saved evidence',exact:true}).click();
  await page.getByText('LiveEvent2',{exact:true}).first().waitFor();
  await page.locator('.row').getByText('LiveEvent2',{exact:true}).click();
  await page.locator('.workbench-body > .event-inspector').getByRole('tab',{name:'Fields',exact:true}).click();
  await workbenchInspector.getByRole('region',{name:'Event fields',exact:true}).getByText('live-2',{exact:true}).waitFor();
  const query=page.getByRole('textbox',{name:'Search query',exact:true});
  await query.fill('eventID="saved-1"');
  await query.press('Enter');
  await page.locator('.row').getByText('LiveEvent2',{exact:true}).waitFor({state:'hidden'});
  await page.getByText('RunInstances',{exact:true}).first().waitFor();
  assert.equal(await page.locator('.row--selected').count(),0,'A successful search left its excluded event selected');
  await workbenchInspector.waitFor({state:'hidden'});
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
  await page.locator('.workbench-body > .event-inspector').getByRole('tab',{name:'Fields',exact:true}).click();
  const fields=page.getByRole('region',{name:'Event fields',exact:true});
  await fields.getByText('9007199254740993',{exact:true}).waitFor();
  await fields.getByRole('button',{name:/requestParameters/}).click();
  await fields.getByRole('button',{name:/items/}).click();
  await fields.getByTitle('requestParameters.items.0',{exact:true}).waitFor();
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
  await page.getByRole('tab',{name:'Original JSON',exact:true}).click();
  const inlineOriginal=page.getByRole('tabpanel',{name:'Original JSON',exact:true});
  assert.ok((await inlineOriginal.locator('pre').textContent()).includes('9007199254740993'));
  assert.ok((await inlineOriginal.locator('pre').textContent()).length<=32769,'Workbench mounted the complete large source');
  await inlineOriginal.getByRole('button',{name:'Next text segment',exact:true}).click();
  await inlineOriginal.getByText('Segment 2 of',{exact:false}).waitFor();
  await inlineOriginal.getByRole('button',{name:'Open full JSON',exact:true}).click();
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
  await page.getByRole('tab',{name:'Fields',exact:true}).click();
  await fields.waitFor({state:'visible'});
  await fields.evaluate(el=>{el.scrollTop=el.scrollHeight});
  await page.clock.runFor(100);
  await fields.getByText('51–100 of 20,000',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.captureTest.inspectorLoads),parsedOnce,'Switching inspector tabs reparsed the original event');
  // Scope-dependent actions cannot race ahead of a pending/failed snapshot.
  await page.goto('http://127.0.0.1:5181/?recovery');
  await page.evaluate(()=>{window.captureTest.delaySnapshot=true});
  await page.getByRole('button',{name:'Open saved evidence',exact:true}).click();
  await page.locator('.row').getByText('RunInstances',{exact:true}).click();
  await page.locator('.workbench-body > .event-inspector').getByRole('tab',{name:'Fields',exact:true}).click();
  await page.waitForFunction(()=>typeof window.captureTest.resolveSnapshot==='function');
  await checkSnapshotActions(page,true,'ran before its evidence scope was ready');
  assert.equal(await page.evaluate(()=>window.captureTest.rawCalls),0,'Original record loaded before its evidence cutoff');
  await page.evaluate(()=>{window.captureTest.emit(2);window.captureTest.delaySnapshot=false;window.captureTest.resolveSnapshot()});
  await fields.getByText('saved-1',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.captureTest.rawSnapshot.maxSeq),1,'Delayed snapshot widened to later arrivals');
  await checkSnapshotActions(page,false,'was unavailable after its evidence scope resolved');
  await page.goto('http://127.0.0.1:5181/?recovery');
  await page.evaluate(()=>{window.captureTest.failSnapshot=true});
  await page.getByRole('button',{name:'Open saved evidence',exact:true}).click();
  await page.locator('.row').getByText('RunInstances',{exact:true}).click();
  await page.locator('.workbench-body > .event-inspector').getByRole('tab',{name:'Fields',exact:true}).click();
  await workbenchInspector.getByRole('button',{name:'Retry event',exact:true}).waitFor();
  await checkSnapshotActions(page,true,'escaped a failed evidence cutoff');
  await page.evaluate(()=>{window.captureTest.failSnapshot=false});
  await workbenchInspector.getByRole('button',{name:'Retry event',exact:true}).click();
  await fields.getByText('saved-1',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.captureTest.snapshotCalls.length),2,'Retry did not acquire the missing evidence cutoff');
  // An import can replace the backend before the old event list is cleared.
  // A reused sequence number from that new generation must never load here.
  await page.goto('http://127.0.0.1:5181/?recovery');
  await page.getByRole('button',{name:'Open saved evidence',exact:true}).click();
  await page.locator('.row').getByText('RunInstances',{exact:true}).waitFor();
  await page.evaluate(()=>{window.captureTest.snapshotGeneration='replacement-dataset'});
  await page.locator('.row').getByText('RunInstances',{exact:true}).click();
  await page.locator('.workbench-body > .event-inspector').getByRole('tab',{name:'Fields',exact:true}).click();
  await workbenchInspector.getByRole('button',{name:'Retry event',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.captureTest.rawCalls),0,'A selected event loaded a reused sequence from another dataset');
  assert.equal(await page.evaluate(()=>window.captureTest.lineageSnapshot),undefined,'Lineage crossed the selected dataset generation');
  await checkSnapshotActions(page,true,'accepted a different dataset generation');
  await page.evaluate(()=>{window.captureTest.snapshotGeneration='fixture'});
  await workbenchInspector.getByRole('button',{name:'Retry event',exact:true}).click();
  await fields.getByText('saved-1',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.captureTest.rawSnapshot.generation),'fixture');
  assert.equal(await page.evaluate(()=>window.captureTest.snapshotCalls.length),2,'Retry reused the rejected dataset generation');
  // Late details must not replace a different event; failures have an explicit retry.
  await page.goto('http://127.0.0.1:5181/?recovery');
  await page.evaluate(()=>{
    const state=window.captureTest;state.emit(2);state.delayRawSeq=1;
    state.rawBySeq[2]='{"eventID":"second-event","eventName":"LiveEvent2","userIdentity":{"type":"AssumedRole"}}';
    state.rows[0].identityType='AssumedRole';state.failGraph=true;
  });
  await page.getByRole('button',{name:'Open saved evidence',exact:true}).click();
  await page.locator('.row').getByText('RunInstances',{exact:true}).click();
  await page.locator('.workbench-body > .event-inspector').getByRole('tab',{name:'Fields',exact:true}).click();
  await page.getByText('Loading original event…',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>typeof window.captureTest.resolveRaw),'function','delayed detail request was not started');
  await page.locator('.etbody').evaluate(el=>{el.scrollTop=0});
  await page.clock.runFor(100);
  await page.locator('.row').getByText('LiveEvent2',{exact:true}).click();
  await page.locator('.workbench-body > .event-inspector').getByRole('tab',{name:'Fields',exact:true}).click();
  await fields.getByText('second-event',{exact:true}).waitFor();
  await page.evaluate(()=>window.captureTest.resolveRaw());
  await page.clock.runFor(100);
  assert.equal(await fields.getByText('saved-1',{exact:true}).count(),0,'late response replaced selected evidence');
  await page.getByRole('button',{name:'Credential chain',exact:true}).click();
  await page.getByRole('button',{name:'Reload lineage',exact:true}).waitFor();
  const retrySnapshot=await page.evaluate(()=>({snapshot:window.captureTest.rawSnapshot,calls:window.captureTest.snapshotCalls.length}));
  await page.evaluate(()=>{window.captureTest.failGraph=false;window.captureTest.emit(3)});
  await page.getByRole('button',{name:'Reload lineage',exact:true}).click();
  await page.getByRole('button',{name:'Reload lineage',exact:true}).waitFor({state:'hidden'});
  await page.keyboard.press('Escape');
  await page.getByRole('dialog',{name:'Credential lineage',exact:true}).waitFor({state:'hidden'});
  await page.getByRole('tab',{name:'Fields',exact:true}).click();
  await fields.getByText('second-event',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Reload lineage',exact:true}).count(),0);
  assert.deepEqual(await page.evaluate(()=>({snapshot:window.captureTest.rawSnapshot,calls:window.captureTest.snapshotCalls.length})),retrySnapshot,'Retry replaced the selected evidence snapshot after new arrivals');
  assert.deepEqual(await page.evaluate(()=>window.captureTest.graphSnapshot),retrySnapshot.snapshot,'Retry lineage used a different snapshot from the event');
  await page.getByRole('button',{name:'Close inspector',exact:true}).click();
  await page.evaluate(()=>{window.captureTest.failRaw=true});
  await page.locator('.row').getByText('LiveEvent2',{exact:true}).click();
  await page.locator('.workbench-body > .event-inspector').getByRole('tab',{name:'Fields',exact:true}).click();
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
    const state=window.captureTest;state.emit(11);
    state.lineage={applicable:true,sourceIdentity:'recorded-operator',complete:true,status:'observed',reason:'Chain reaches a recorded principal; this does not verify the human operator.',nodes:[{identityType:'IAMUser',arn:'arn:aws:iam::111:user/alice',userName:'alice',accountId:'111',roleArn:'',sessionName:'',invokedBy:'',viaSeq:10,viaEvent:'GetSessionToken',viaTime:'2026-09-24T00:00:00Z',viaSourceIP:'192.0.2.1',evidence:'Exact access-key match to successful STS issuance; expiration not recorded',evidenceSeqs:[10,11]}]};
    const common={roleArn:'',roleName:'',sessionName:'',invokedBy:'',childCount:1,events:1};
    state.graph={applicable:true,rootId:'AKIAALICE',currentId:'ASIACHILD',notes:['Recorded sourceIdentity is a session attribute; identity assurance depends on the issuing policy.'],nodes:[{...common,id:'AKIAALICE',kind:'origin',identityType:'IAMUser',arn:'arn:aws:iam::111:user/alice',accountId:'111',userName:'alice',accessKeyId:'AKIAALICE'},{...common,id:'ASIACHILD',kind:'current',identityType:'IAMUser',arn:'arn:aws:iam::111:user/alice',accountId:'111',userName:'alice',accessKeyId:'ASIACHILD'}],edges:[{parent:'AKIAALICE',child:'ASIACHILD',viaSeq:10,viaEvent:'GetSessionToken',viaTime:'2026-09-24T00:00:00Z',viaIP:'192.0.2.1',evidence:'Exact access-key match; issuance precedes use; expiration not recorded',evidenceSeqs:[10,11]}]};
    state.rawBySeq[10]='{"eventName":"GetSessionToken","eventID":"issuance-evidence","userIdentity":{"type":"IAMUser","userName":"alice"},"opaque":9007199254740993}';state.failGraph=true;
  });
  await page.getByRole('button',{name:'Open saved evidence',exact:true}).click();
  await page.locator('.row').getByText('RunInstances',{exact:true}).click();
  await page.locator('.workbench-body > .event-inspector').getByRole('tab',{name:'Fields',exact:true}).click();
  await page.getByRole('region',{name:'Event fields',exact:true}).getByText('saved-1',{exact:true}).waitFor();
  const investigationSnapshot=await page.evaluate(()=>window.captureTest.rawSnapshot);
  assert.equal(investigationSnapshot.maxSeq,11);
  assert.equal(await page.evaluate(()=>window.captureTest.graphSnapshot),undefined,'Browsing resolved lineage before an explicit request');
  await page.evaluate(()=>window.captureTest.emit(12));
  await openReviewEvidence(page);
  await page.getByRole('button',{name:'View source #1',exact:true}).click();
  await page.getByRole('region',{name:'Original source record'}).getByText('9007199254740993',{exact:false}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.captureTest.evidenceSnapshot),investigationSnapshot,'Sources widened the selected event snapshot');
  assert.deepEqual(await page.evaluate(()=>window.captureTest.observationSnapshot),investigationSnapshot,'Original source used a different snapshot');
  await page.getByRole('button',{name:'Close source evidence',exact:true}).click();
  await page.getByRole('button',{name:'Related events',exact:true}).click();
  const selectedInvestigation=page.getByRole('region',{name:'Contextual event results',exact:true});
  await selectedInvestigation.getByText('11 matching events',{exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.captureTest.investigationCalls.at(-1).snapshot),investigationSnapshot,'Investigate included arrivals after selection');
  await selectedInvestigation.getByRole('button',{name:'Back to Events',exact:true}).click();
  await page.getByRole('button',{name:'Credential chain',exact:true}).click();
  await page.locator('.lgv-error').getByText('Graph query unavailable',{exact:false}).waitFor();
  await page.evaluate(()=>{window.captureTest.failGraph=false});
  await page.getByRole('button',{name:'Reload lineage',exact:true}).click();
  await page.locator('.lgv-canvas .lgv-g').first().waitFor();
  assert.equal(await page.locator('.lgv-canvas .lgv-g[aria-label^="Inspect credential:"]').count(),2);
  assert.equal(await page.getByRole('button',{name:'Inspect activity: RunInstances',exact:true}).count(),1,'graph lost or duplicated the selected activity');
  assert.deepEqual(await page.evaluate(()=>window.captureTest.graphSnapshot),investigationSnapshot,'Full lineage widened the selected event snapshot');
  await page.clock.runFor(100);
  const graphViewport=page.locator('.lgv-canvas > g');
  const centeredTransform=await graphViewport.getAttribute('transform');
  await page.locator('.lgv-canvas .lgv-g').filter({has:page.locator('.lgv-rect.cur')}).click();
  await page.clock.runFor(50);
  assert.equal(await graphViewport.getAttribute('transform'),centeredTransform,'a node click started panning');
  const graphBox=await page.locator('.lgv-canvas').boundingBox();
  assert.ok(graphBox,'lineage graph has no visible canvas');
  await page.mouse.move(graphBox.x+30,graphBox.y+graphBox.height-30);
  await page.mouse.down();
  await page.mouse.move(graphBox.x+100,graphBox.y+graphBox.height-65,{steps:12});
  await page.mouse.up();
  await page.clock.runFor(50);
  const draggedTransform=await graphViewport.getAttribute('transform');
  assert.notEqual(draggedTransform,centeredTransform,'background dragging did not move the graph');
  // Playwright's mouse.wheel returns after dispatch, before the browser has
  // necessarily delivered the event. Advance the test clock after delivery so
  // the viewport's requestAnimationFrame is actually pending.
  await page.evaluate(()=>{window.graphWheelDelivered=new Promise(resolve=>document.querySelector('.lgv-canvas').addEventListener('wheel',()=>resolve(),{once:true}))});
  await page.mouse.wheel(0,-200);
  await page.evaluate(()=>window.graphWheelDelivered);
  await page.clock.runFor(100);
  assert.notEqual(await graphViewport.getAttribute('transform'),draggedTransform,'wheel zoom did not update the graph');
  await page.screenshot({path:path.join(output,'lineage-graph.png'),fullPage:true});
  await page.getByRole('button',{name:'Open issuance event',exact:true}).click();
  const lineageEvent=page.getByRole('dialog',{name:'Lineage event',exact:true});
  await lineageEvent.getByText('issuance-evidence',{exact:true}).waitFor();
  await lineageEvent.getByText('9007199254740993',{exact:true}).waitFor();
  await lineageEvent.locator('.ft-toggle').filter({hasText:'userIdentity'}).click();
  await lineageEvent.getByText('alice',{exact:true}).waitFor();
  assert.ok(await lineageEvent.locator('.ft-row').count()<30,'lineage event mounted an unbounded field tree');
  await checkModalFocus(page,lineageEvent);
  await page.screenshot({path:path.join(output,'lineage-event-fields.png'),fullPage:true});
  await lineageEvent.getByRole('button',{name:'Original JSON',exact:true}).click();
  const lineageOriginal=page.getByRole('dialog',{name:'Raw JSON',exact:true});
  await lineageOriginal.locator('pre').getByText('issuance-evidence',{exact:false}).waitFor();
  await checkModalFocus(page,lineageOriginal);
  assert.equal(await lineageOriginal.locator('pre').textContent(),await page.evaluate(()=>window.captureTest.rawBySeq[10]),'lineage original changed source bytes');
  await lineageOriginal.getByRole('button',{name:'⧉ Copy',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.captureTest.copied),await page.evaluate(()=>window.captureTest.rawBySeq[10]),'lineage copy changed the exact number or original source');
  assert.deepEqual(await page.evaluate(()=>window.captureTest.rawSnapshot),investigationSnapshot,'Lineage source viewing widened the selected snapshot');
  await page.keyboard.press('Escape');
  await lineageOriginal.waitFor({state:'hidden'});
  await lineageEvent.waitFor({state:'visible'});
  assert.ok(await lineageEvent.getByRole('button',{name:'Original JSON',exact:true}).evaluate(el=>document.activeElement===el),'closing Original JSON lost focus behind the lineage inspector');
  await page.keyboard.press('Escape');
  await lineageEvent.waitFor({state:'hidden'});
  await page.locator('.lgv-modal').waitFor({state:'visible'});
  await page.getByRole('button',{name:'Open linked observation 11',exact:true}).waitFor();
  await page.evaluate(()=>{window.captureTest.failExpansion=true});
  await page.getByRole('button',{name:'Expand 1 issued key',exact:true}).click();
  await page.locator('.lgv-error').getByText('The dataset changed; reload lineage.',{exact:false}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.captureTest.expansionSnapshot),investigationSnapshot,'Lineage expansion widened the selected snapshot');
  await page.evaluate(()=>{window.captureTest.failExpansion=false});
  await page.getByRole('button',{name:'Expand 1 issued key',exact:true}).click();
  await page.locator('.lgv-detail summary').filter({hasText:'Graph evidence notes'}).click();
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
  await openRuleInvestigation(page,'GetObject');
  const investigation=page.getByRole('dialog',{name:'Event investigation',exact:true});
  await investigation.getByText('Investigation query unavailable',{exact:false}).waitFor();
  await page.evaluate(()=>{window.captureTest.failInvestigation=false});
  await investigation.getByRole('button',{name:'Retry investigation',exact:true}).click();
  await investigation.getByText('520 events',{exact:true}).waitFor();
  await investigation.locator('.investigation-event').first().waitFor();
  assert.ok(await investigation.locator('.investigation-event').count()<30,'context timeline was not virtualized');
  await investigation.getByText('Showing 500 closest events of 520. Narrow the window or relationship.',{exact:true}).waitFor();
  const previousTheme=await page.evaluate(()=>document.documentElement.dataset.theme);
  await page.evaluate(()=>{document.documentElement.dataset.theme='graphite'});
  const windowControl=investigation.getByRole('combobox',{name:'Investigation window',exact:true});
  await windowControl.click();
  await page.clock.runFor(250);
  const graphiteList=await checkThemedList(page,'Investigation window');
  await page.screenshot({path:path.join(output,'investigation-window-graphite.png'),fullPage:true});
  await page.keyboard.press('Escape');
  await page.getByRole('listbox',{name:'Investigation window',exact:true}).waitFor({state:'hidden'});
  await investigation.waitFor({state:'visible'});
  assert.equal(await windowControl.getAttribute('aria-expanded'),'false','Escape left the window list open');
  await page.evaluate(()=>{document.documentElement.dataset.theme='light'});
  await windowControl.click();
  await page.clock.runFor(250);
  const lightList=await checkThemedList(page,'Investigation window');
  assert.notEqual(lightList.background,graphiteList.background,'changing themes left the dropdown in its old palette');
  await page.screenshot({path:path.join(output,'investigation-window-light.png'),fullPage:true});
  await page.keyboard.press('Escape');
  await page.evaluate(theme=>{if(theme===undefined)delete document.documentElement.dataset.theme;else document.documentElement.dataset.theme=theme},previousTheme);
  await windowControl.press('End');
  await windowControl.press('Enter');
  await page.waitForFunction(()=>window.captureTest.investigationCalls.at(-1).minutes===60);
  await investigation.getByText('520 events',{exact:true}).waitFor();
  await chooseThemed(page,'Investigation window','±5 minutes',investigation);
  await page.waitForFunction(()=>window.captureTest.investigationCalls.at(-1).minutes===5);
  await investigation.getByText('520 events',{exact:true}).waitFor();
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
  await chooseThemed(page,'Investigation relationship','Related events',investigation);
  await page.clock.runFor(100);
  await page.evaluate(()=>{window.captureTest.delayInvestigation=false});
  await chooseThemed(page,'Investigation relationship','Shared resource ARN',investigation);
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
  await page.getByRole('button',{name:'Add to comparison',exact:true}).click();
  await page.locator('.etbody').evaluate(el=>{el.scrollTop=0});await page.clock.runFor(100);
  await page.locator('.row').getByText('PutRolePolicy',{exact:true}).first().click();
  await page.getByRole('button',{name:'Add as second event',exact:true}).click();
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
  await page.getByRole('button',{name:'Clear comparison',exact:true}).click();
  assert.equal(await page.locator('.comparison-bar').count(),0);
  // A large number of changes must be labelled incomplete, never "no differences".
  await page.locator('.row').getByText('PutRolePolicy',{exact:true}).first().click();
  await page.evaluate(()=>{
    const state=window.captureTest;
    state.rawBySeq[1]='{"eventID":"saved-1","eventName":"PutRolePolicy"}';
    state.rawBySeq[2]=JSON.stringify({eventID:'live-2',eventName:'PutRolePolicy',...Object.fromEntries(Array.from({length:1000},(_,i)=>[`change${i}`,i]))});
  });
  await page.locator('.row').getByText('PutRolePolicy',{exact:true}).nth(1).click();
  await page.getByRole('button',{name:'Add to comparison',exact:true}).click();
  await page.locator('.etbody').evaluate(el=>{el.scrollTop=0});await page.clock.runFor(100);
  await page.locator('.row').getByText('PutRolePolicy',{exact:true}).first().click();
  await page.getByRole('button',{name:'Add as second event',exact:true}).click();
  await page.getByRole('button',{name:'Compare events',exact:true}).click();
  await comparison.getByText('500 differences found · comparison incomplete',{exact:true}).waitFor();
  assert.ok(await comparison.locator('.comparison-change').count()<30,'comparison rendered every change');
  await comparison.getByRole('button',{name:'Close comparison',exact:true}).click();
  await page.getByRole('button',{name:'Clear comparison',exact:true}).click();
  // Sigma does not reuse validity after edits; requests cancel and suites share a snapshot.
  await page.goto('http://127.0.0.1:5181/?recovery');
  await page.getByRole('button',{name:'Open saved evidence',exact:true}).click();
  await page.getByRole('button',{name:'Hunt',exact:true}).click();
   await page.getByRole('tab',{name:'Rules',exact:true}).click();
  await page.getByRole('button',{name:'▶ Run',exact:true}).click();
  await page.locator('.sg-pill.valid:visible').getByText('✓ Ran · 1 matches',{exact:true}).waitFor();
  await page.locator('.sigma .row').getByText('RunInstances',{exact:true}).click();
  await page.getByRole('region',{name:'Selection explanations',exact:true}).getByText('− filter_service: did not match',{exact:true}).waitFor();
  await openInspectorOriginal(page.locator('.sigma .event-inspector'));
  await page.getByRole('dialog',{name:'Raw JSON',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.captureTest.rawSnapshot.generation),'fixture');
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Sources & hashes',exact:true}).click();
  await page.getByRole('button',{name:'View source #1',exact:true}).click();
  await page.getByRole('region',{name:'Original source record'}).waitFor();
  assert.equal(await page.evaluate(()=>window.captureTest.evidenceSnapshot.generation),'fixture');
  assert.equal(await page.evaluate(()=>window.captureTest.observationSnapshot.generation),'fixture');
  await page.getByRole('button',{name:'Close source evidence',exact:true}).click();
  await page.getByRole('button',{name:'Investigate',exact:true}).click();
  await page.getByRole('dialog',{name:'Event investigation',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.captureTest.investigationCalls.at(-1).snapshot.generation),'fixture');
  await page.getByRole('button',{name:'Close investigation',exact:true}).click();
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:path.join(output,'sigma-rule.png'),fullPage:true});
  await page.setViewportSize({width:960,height:720});
  assert.ok(await page.locator('.sigma-workbench').evaluate(el=>el.scrollWidth<=el.clientWidth),'Sigma spills at minimum width');
  await page.getByRole('button',{name:'Edit YAML',exact:true}).click();
  const editor=page.locator('.sg-editor .cm-content');
  await editor.click();await page.keyboard.press('Control+End');await page.keyboard.press('Enter');await page.keyboard.type('# changed');
  await page.locator('.sg-pill.idle').getByText('Not run',{exact:true}).waitFor();
  assert.equal(await page.locator('.sigma .row').count(),0,'editing left stale matches');
  await page.evaluate(()=>window.captureTest.delaySigma=true);
  await editor.press('Control+Enter');
  await page.getByRole('button',{name:'Cancel rule',exact:true}).waitFor();
  await editor.press('Control+Enter');
  assert.equal(await page.evaluate(()=>window.captureTest.sigmaCalls.length),2,'keyboard queued another rule run');
  await page.getByRole('button',{name:'Cancel rule',exact:true}).click();
  await page.evaluate(()=>{window.captureTest.delaySigma=false;window.captureTest.failSigma=true});
  await page.getByRole('button',{name:'▶ Run',exact:true}).click();
  await page.getByRole('alert').getByText('Error: Sigma storage unavailable',{exact:true}).waitFor();
  await page.evaluate(()=>window.captureTest.failSigma=false);
  await page.getByRole('button',{name:'Rule suite',exact:true}).click();
  await page.getByRole('button',{name:'Run selected rules',exact:true}).click();
  await page.getByText('5 / 6 rules ran',{exact:true}).waitFor();
  assert.equal((await page.evaluate(()=>window.captureTest.sigmaSuiteRules)).length,6);
  await page.getByText('This fixture rule uses an unsupported modifier',{exact:true}).waitFor();
  await page.screenshot({path:path.join(output,'sigma-suite.png'),fullPage:true});
  assert.ok(await page.locator('.sigma-suite').evaluate(el=>el.scrollWidth<=el.clientWidth),'suite spills at minimum width');
  await page.getByRole('button',{name:'Inspect results',exact:true}).first().click();
  await page.locator('.sg-pill.valid:visible').waitFor();
  assert.equal(await page.evaluate(()=>window.captureTest.sigmaCalls.length),3,'opening suite results reran the rule');
  await page.getByRole('button',{name:'Rule suite',exact:true}).click();
  await page.evaluate(()=>window.captureTest.delaySuite=true);
  await page.getByRole('button',{name:'Run selected rules',exact:true}).click();
  await page.getByRole('button',{name:'Cancel suite',exact:true}).click();
  await page.evaluate(()=>{window.captureTest.delaySuite=false;window.captureTest.failSuite=true});
  await page.getByRole('button',{name:'Run selected rules',exact:true}).click();
  await page.getByRole('alert').getByText('Error: Suite storage unavailable',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  // Manual analysis, snapshot drilldown, stale settings, raw evidence and cancellation.
  await page.getByRole('button',{name:'Events',exact:true}).click();
   await page.getByRole('button',{name:'Summarize',exact:true}).click();
  await page.getByLabel('Compare previous window',{exact:true}).check();
  await page.getByRole('button',{name:'Run analysis',exact:true}).click();
  await page.getByText('New in compared window',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.captureTest.analysisCalls.length),1,'analysis ran without a request');
  const entity='arn:aws:sts::111122223333:assumed-role/ProductionInvestigationReader/audit-session-with-a-long-identifier';
  await page.getByRole('button',{name:entity,exact:true}).click();
  await page.getByRole('heading',{name:'Recent original records',exact:true}).waitFor();
  assert.ok(await page.evaluate(()=>window.captureTest.analysisCalls.at(-1).snapshot?.generation==='fixture'));
  await page.getByRole('button',{name:'Original record',exact:true}).first().click();
  await page.getByRole('dialog',{name:'Raw JSON',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.captureTest.rawSnapshot.generation),'fixture');
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Back to overview',exact:true}).click();
  await page.getByText('New in compared window',{exact:true}).waitFor();
  await page.setViewportSize({width:960,height:720});
  await page.screenshot({path:path.join(output,'analysis-hunts.png'),fullPage:true});
  assert.ok(await page.locator('.analysis-view:visible').evaluate(el=>el.scrollWidth<=el.clientWidth),'analysis content overflows');
  await page.getByRole('combobox',{name:'Analysis dimension',exact:true}).click();
  await checkThemedList(page,'Analysis dimension');
  await page.screenshot({path:path.join(output,'analysis-group-by.png'),fullPage:true});
  await page.getByRole('listbox',{name:'Analysis dimension',exact:true}).getByRole('option',{name:'Service',exact:true}).click();
  await page.getByText('Settings changed. Run analysis to apply them; the results below use the previous settings.',{exact:true}).waitFor();
  await page.evaluate(()=>{window.captureTest.delayAnalysis=true});
  await page.getByRole('button',{name:'Run analysis',exact:true}).click();
  await page.getByRole('button',{name:'Cancel analysis',exact:true}).click();
  await page.getByText('Analysis cancelled. Run again when ready.',{exact:true}).waitFor();
  await page.evaluate(()=>{window.captureTest.delayAnalysis=false;window.captureTest.failAnalysis=true});
  await page.getByRole('button',{name:'Run analysis',exact:true}).click();
  await page.getByRole('alert').getByText('Error: The dataset changed; run analysis again',{exact:true}).waitFor();
  await page.evaluate(()=>{window.captureTest.failAnalysis=false});
  await page.getByRole('button',{name:'Run analysis',exact:true}).click();
  await page.getByText('Service overview',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  await page.getByRole('button',{name:'Hunt',exact:true}).click();
  await page.getByRole('tab',{name:'Indicators',exact:true}).click();
  assert.ok(await page.getByRole('button',{name:'Run hunt',exact:true}).isDisabled());
  await openIndicatorBulk(page);await page.locator('.hunt-view:visible').getByLabel('Typed indicators',{exact:true}).fill('ip 192.0.2.1\narn arn:aws:s3:::evidence-bucket/audit/events.json');
  await page.getByRole('button',{name:'Run hunt',exact:true}).click();
  await page.getByText('600 matched events · 900 events in scope',{exact:true}).waitFor();
  assert.ok(await page.locator('.hunt-view:visible .hunt-card').count()<20,'hunt rendered every result');
  await openInspectorOriginal(page.locator('.hunt-view:visible .event-inspector'));
  await page.getByRole('dialog',{name:'Raw JSON',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.captureTest.rawSnapshot.generation),'fixture');
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Investigate',exact:true}).click();
  await page.getByRole('dialog',{name:'Event investigation',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.captureTest.investigationCalls.at(-1).snapshot.generation),'fixture');
  await page.getByRole('button',{name:'Close investigation',exact:true}).click();
  await page.getByRole('tab',{name:'Event sequences',exact:true}).click();
  await page.getByLabel('Step A search',{exact:true}).fill('eventName="PutRolePolicy"');
  await page.getByLabel('Step B search',{exact:true}).fill('eventName="PutRolePolicy"');
  // Modes retain separate results; switching to Sequences must not reuse IOC matches.
  assert.equal(await page.locator('.hunt-view:visible .hunt-card').count(),0,'sequence mode inherited indicator results');
  await page.getByRole('button',{name:'Run hunt',exact:true}).click();
  await page.getByText('1 sequence · 900 events in scope',{exact:true}).waitFor();
  await page.getByText('2 candidates for step A share the selected timestamp; a representative is shown.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Inspect step B',exact:true}).click();
  await openInspectorOriginal(page.locator('.hunt-view:visible .event-inspector'));
  await page.getByRole('dialog',{name:'Raw JSON',exact:true}).waitFor();await page.keyboard.press('Escape');
  await page.locator('.hunt-view:visible').evaluate(el=>{el.scrollTop=0});
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:path.join(output,'analysis-hunts.png'),fullPage:true});
  await page.setViewportSize({width:960,height:720});
  assert.ok(await page.locator('.hunt-view:visible').evaluate(el=>el.scrollWidth<=el.clientWidth),'hunt spills at minimum width');
  await page.evaluate(()=>{window.captureTest.delayHunt=true});
  await page.getByRole('button',{name:'Run hunt',exact:true}).click();
  await page.getByRole('button',{name:'Cancel hunt',exact:true}).click();
  await page.getByText('Hunt cancelled. Run again when ready.',{exact:true}).waitFor();
  await page.evaluate(()=>{window.captureTest.delayHunt=false;window.captureTest.failHunt=true});
  await page.getByRole('button',{name:'Run hunt',exact:true}).click();
  await page.getByRole('alert').getByText('Error: Indicator 2 has an invalid IP address',{exact:true}).waitFor();
  await page.evaluate(()=>{window.captureTest.failHunt=false});
  await page.getByLabel('Step A search',{exact:true}).fill('unknownField="x"');
  assert.ok(await page.getByRole('button',{name:'Run hunt',exact:true}).isDisabled(),'invalid sequence became an unrestricted step');
  // Local labels persist without replacing identifiers or reparsing evidence.
  await page.goto('http://127.0.0.1:5181/?recovery');
  const labeledArn='arn:aws:sts::111122223333:assumed-role/ProductionInvestigationReader/audit-session-with-a-long-identifier';
  await page.evaluate(arn=>{
    const state=window.captureTest,row=state.rows[0];Object.assign(row,{identityType:'AssumedRole',identityArn:arn,accountId:'111122223333',recipientAccountId:'111122223333',sourceIPAddress:'192.0.2.1',roleArn:'arn:aws:iam::111122223333:role/ProductionInvestigationReader'});
    state.raw=JSON.stringify({eventID:row.eventID,eventName:row.eventName,eventSource:row.eventSource,eventTime:row.eventTime,sourceIPAddress:row.sourceIPAddress,recipientAccountId:row.recipientAccountId,userIdentity:{type:'AssumedRole',arn,accountId:row.accountId,sessionContext:{sessionIssuer:{arn:row.roleArn}}}});
  },labeledArn);
  await page.getByRole('button',{name:'Open saved evidence',exact:true}).click();
  await page.locator('.row').getByText('RunInstances',{exact:true}).click();
  await page.locator('.workbench-body > .event-inspector').getByRole('tab',{name:'Fields',exact:true}).click();
  const accountField=page.locator('.ft-row').filter({has:page.getByText('recipientAccountId',{exact:true})});
  await accountField.getByText('111122223333',{exact:true}).waitFor();
  const parsedBeforeLabels=await page.evaluate(()=>window.captureTest.inspectorLoads);
  await page.getByRole('button',{name:'File',exact:true}).click();
  await page.getByRole('button',{name:'Settings…',exact:true}).click();
  await page.getByRole('button',{name:'Personal labels',exact:true}).click();
  const addLabel=async(kind,value,label)=>{
    await page.getByLabel('Label identifier type',{exact:true}).selectOption(kind);
    await page.getByLabel('Label exact identifier',{exact:true}).fill(value);
    await page.getByLabel('Personal label',{exact:true}).fill(label);
    await page.getByRole('button',{name:'Add label',exact:true}).click();
    await page.locator('.alias-entry').filter({has:page.getByText(label,{exact:true})}).waitFor();
  };
  await addLabel('arn',labeledArn,'Production reader');
  await addLabel('account','111122223333','Production account');
  await addLabel('address','192.0.2.1','VPN egress');
  await page.locator('.alias-entry').filter({has:page.getByText('Production reader',{exact:true})}).getByRole('button',{name:'Rename',exact:true}).click();
  assert.ok(await page.getByLabel('Label exact identifier',{exact:true}).isDisabled());
  await page.getByLabel('Personal label',{exact:true}).fill('Prod audit role');
  await page.getByRole('button',{name:'Save label',exact:true}).click();
  await page.locator('.alias-entry').getByText('Prod audit role',{exact:true}).waitFor();
  await page.getByLabel('Search personal labels',{exact:true}).fill('Prod audit role');
  await page.locator('.settings-content').evaluate(el=>el.scrollTop=0);
  await page.setViewportSize({width:960,height:720});
  await page.screenshot({path:path.join(output,'labels-settings.png'),fullPage:true});
  assert.ok(await page.locator('.settings-modal').evaluate(el=>el.scrollWidth<=el.clientWidth),'label editor overflowed');
  await page.locator('.settings-head .icon-btn').click();
  await page.locator('.workbench-results .c-identity .alias-badge').getByText('Prod audit role',{exact:true}).waitFor();
  await accountField.getByText('Production account',{exact:true}).waitFor();
  await page.getByRole('tab',{name:'Overview',exact:true}).click();
  const lineageLabel=workbenchInspector.locator('.eo-section[aria-label="Actor and session"] .alias-badge').filter({hasText:'Prod audit role'});
  await lineageLabel.getByText('Prod audit role',{exact:true}).waitFor();
  assert.ok(await lineageLabel.evaluate(el=>{const badge=el.getBoundingClientRect(),node=el.closest('.eo-section').getBoundingClientRect();return badge.width>0&&badge.left>=node.left&&badge.right<=node.right}),'recorded actor label is clipped');
  assert.equal(await page.evaluate(()=>window.captureTest.inspectorLoads),parsedBeforeLabels,'label changes reparsed an inspected event');
  await page.getByRole('tab',{name:'Original JSON',exact:true}).click();
  const labeledOriginal=await page.getByRole('tabpanel',{name:'Original JSON',exact:true}).locator('pre').textContent();
  assert.ok(labeledOriginal.includes(labeledArn));assert.ok(!labeledOriginal.includes('Prod audit role')&&!labeledOriginal.includes('Production account')&&!labeledOriginal.includes('VPN egress'));
  await page.getByRole('tab',{name:'Fields',exact:true}).click();
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:path.join(output,'labels-inspector.png'),fullPage:true});
  const searchesBeforeLabelPivot=await page.evaluate(()=>window.captureTest.searchCalls.length);
  await accountField.hover();await accountField.getByTitle('Filter for 111122223333',{exact:true}).click();
  await page.clock.runFor(500);
  await page.waitForFunction(before=>window.captureTest.searchCalls.length>before,searchesBeforeLabelPivot);
  const labeledFilter=JSON.stringify(await page.evaluate(()=>window.captureTest.searchCalls.at(-1)));
  assert.ok(labeledFilter.includes('111122223333')&&!labeledFilter.includes('Production account'),'pivot substituted a label for evidence');
  await page.reload();
  await page.getByRole('button',{name:'Open saved evidence',exact:true}).click();
  await page.getByRole('button',{name:'File',exact:true}).click();
  await page.getByRole('button',{name:'Settings…',exact:true}).click();
  await page.getByRole('button',{name:'Personal labels',exact:true}).click();
  await page.locator('.alias-entry').getByText('Prod audit role',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Remove label VPN egress',exact:true}).click();
  assert.equal(await page.locator('.alias-entry').getByText('VPN egress',{exact:true}).count(),0);
  await page.locator('.settings-head .icon-btn').click();
  await page.getByRole('button',{name:'Events',exact:true}).click();
   await page.getByRole('button',{name:'Summarize',exact:true}).click();
  await page.getByRole('button',{name:'Run analysis',exact:true}).click();
  const labeledEntity=page.locator('.analysis-entity').filter({hasText:labeledArn});
  await labeledEntity.getByText('Prod audit role',{exact:true}).waitFor();
  await labeledEntity.click();
  await page.waitForFunction(()=>!!window.captureTest.analysisCalls.at(-1).entity);
  assert.equal(await page.evaluate(()=>window.captureTest.analysisCalls.at(-1).entity.value),labeledArn,'analysis drilldown substituted an alias');
  // Saved hunts keep a copied scope across reloads and never execute on selection/load.
  // Start after all existing scenarios so their request counters and preferences stay isolated.
  await page.evaluate(()=>localStorage.removeItem('cloudmon.savedHunts'));
  await page.goto('http://127.0.0.1:5181/?recovery');
  await page.getByRole('button',{name:'Open saved evidence',exact:true}).click();
  const savedHuntQuery=page.getByRole('textbox',{name:'Search query',exact:true});
  await savedHuntQuery.fill('eventName="RunInstances" and awsRegion="us-east-1"');
  await savedHuntQuery.press('Enter');
  await page.clock.runFor(500);
  await page.waitForFunction(()=>window.captureTest.searchCalls.at(-1)?.expr?.t==='and');
  const originalHuntScope=await page.evaluate(()=>window.captureTest.searchCalls.at(-1));
  await page.getByRole('button',{name:'Hunt',exact:true}).click();
  await page.locator('.hunt-view:visible').getByLabel('Hunt scope',{exact:true}).selectOption('workbench');
  const originalHuntIndicators='ip 192.0.2.1\narn arn:aws:s3:::evidence-bucket/audit/events.json';
  const revisedHuntIndicators='ip 198.51.100.10\narn arn:aws:s3:::evidence-bucket/audit/events.json';
  await openIndicatorBulk(page);await page.locator('.hunt-view:visible').getByLabel('Typed indicators',{exact:true}).fill(originalHuntIndicators);
  await page.locator('.hunt-view:visible summary').filter({hasText:/^Saved hunts \(0\)$/}).click();
  await page.locator('.hunt-view:visible').getByLabel('Hunt name',{exact:true}).fill('Scoped network triage');
  await page.getByRole('button',{name:'Save new hunt',exact:true}).click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('cloudmon.savedHunts'))?.items?.length===1);
  const savedHunt=await page.evaluate(()=>JSON.parse(localStorage.getItem('cloudmon.savedHunts')).items[0]);
  assert.equal(savedHunt.name,'Scoped network triage');
  assert.equal(savedHunt.config.indicatorText,originalHuntIndicators);
  assert.deepEqual(savedHunt.config.filter,originalHuntScope,'saving changed the resolved console scope');
  assert.equal(savedHunt.config.steps.length,2);
  assert.ok(!('snapshot' in savedHunt.config)&&!('results' in savedHunt.config),'saved a dataset result instead of a hunt configuration');
  assert.equal(await page.evaluate(()=>window.captureTest.huntCalls?.length||0),0,'saving ran a hunt');
  await page.reload();
  await page.getByRole('button',{name:'Open saved evidence',exact:true}).click();
  await savedHuntQuery.fill('awsRegion="eu-west-1"');
  await savedHuntQuery.press('Enter');
  await page.clock.runFor(500);
  await page.waitForFunction(()=>window.captureTest.searchCalls.at(-1)?.expr?.value==='eu-west-1');
  const currentHuntScope=await page.evaluate(()=>window.captureTest.searchCalls.at(-1));
  await page.getByRole('button',{name:'Hunt',exact:true}).click();
  await page.locator('.hunt-view:visible summary').filter({hasText:/^Saved hunts \(1\)$/}).click();
  await page.locator('.hunt-view:visible').getByLabel('Saved hunt',{exact:true}).selectOption(savedHunt.id);
  assert.equal(await page.locator('.hunt-view:visible').getByLabel('Typed indicators',{exact:true}).inputValue(),'','selecting a saved hunt silently replaced the draft');
  assert.equal(await page.evaluate(()=>window.captureTest.huntCalls?.length||0),0,'selecting a saved hunt ran it');
  await page.getByRole('button',{name:'Load hunt',exact:true}).click();
  await page.locator('.hunt-view:visible').getByLabel('Hunt scope',{exact:true}).locator('option[value="saved"]').waitFor({state:'attached'});
  assert.equal(await page.locator('.hunt-view:visible').getByLabel('Hunt scope',{exact:true}).inputValue(),'saved');
  assert.equal(await page.locator('.hunt-view:visible').getByLabel('Typed indicators',{exact:true}).inputValue(),originalHuntIndicators);
  assert.equal(await page.evaluate(()=>window.captureTest.huntCalls?.length||0),0,'loading a saved hunt ran it');
  await page.getByRole('button',{name:'Run hunt',exact:true}).click();
  await page.getByText('600 matched events · 900 events in scope',{exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.captureTest.huntCalls.at(-1).filter),originalHuntScope,'loaded hunt used the new console filters');
  await page.getByRole('button',{name:'Use current event filters',exact:true}).click();
  await page.getByRole('button',{name:'Run hunt',exact:true}).click();
  await page.waitForFunction(()=>window.captureTest.huntCalls.length===2);
  assert.deepEqual(await page.evaluate(()=>window.captureTest.huntCalls.at(-1).filter),currentHuntScope,'explicit scope replacement did not use current console filters');
  await page.getByRole('button',{name:'Load hunt',exact:true}).click();
  await page.locator('.hunt-view:visible .hunt-card').first().waitFor({state:'hidden'});
  assert.equal(await page.locator('.hunt-view:visible .hunt-card').count(),0,'loading retained old results');
  await openIndicatorBulk(page);await page.locator('.hunt-view:visible').getByLabel('Typed indicators',{exact:true}).fill(revisedHuntIndicators);
  await page.getByRole('button',{name:'Update saved hunt',exact:true}).click();
  await page.waitForFunction(value=>JSON.parse(localStorage.getItem('cloudmon.savedHunts')).items[0].config.indicatorText===value,revisedHuntIndicators);
  await page.locator('.hunt-view:visible').getByLabel('Hunt name',{exact:true}).fill('Production network review');
  await page.getByRole('button',{name:'Rename hunt',exact:true}).click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('cloudmon.savedHunts')).items[0].name==='Production network review');
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('cloudmon.savedHunts')).items[0].config.filter),originalHuntScope,'updating or renaming changed the saved scope');
  // A cancellation may race with a native completion: loading must invalidate both paths.
  await page.evaluate(()=>{
    const state=window.captureTest,app=window.go.main.App;
    state.savedHuntNative=app.Hunt;state.savedHuntCancel=app.CancelQuery;
    app.Hunt=async(options,id)=>{
      const result=await state.savedHuntNative(options,id);
      state.savedHuntPending=id;
      return new Promise(resolve=>{state.finishSavedHunt=()=>resolve(result)});
    };
    app.CancelQuery=async id=>{
      if(id===state.savedHuntPending){state.savedHuntCancelled=true;return}
      return state.savedHuntCancel(id);
    };
  });
  await openIndicatorBulk(page);await page.locator('.hunt-view:visible').getByLabel('Typed indicators',{exact:true}).fill(originalHuntIndicators);
  await page.getByRole('button',{name:'Run hunt',exact:true}).click();
  await page.waitForFunction(()=>!!window.captureTest.finishSavedHunt);
  await page.getByRole('button',{name:'Load hunt',exact:true}).click();
  await page.waitForFunction(()=>window.captureTest.savedHuntCancelled===true);
  await page.waitForFunction(value=>document.querySelector('.hw-panel:not([hidden]) textarea[aria-label="Typed indicators"]').value===value,revisedHuntIndicators);
  assert.equal(await page.locator('.hunt-view:visible').getByLabel('Typed indicators',{exact:true}).inputValue(),revisedHuntIndicators);
  assert.equal(await page.evaluate(()=>window.captureTest.huntCalls.length),3,'loading while busy launched another hunt');
  await page.evaluate(()=>window.captureTest.finishSavedHunt());
  await page.clock.runFor(100);
  assert.equal(await page.locator('.hunt-view:visible .hunt-card').count(),0,'a stale completion overwrote the newly loaded hunt');
  assert.equal(await page.getByRole('button',{name:'Cancel hunt',exact:true}).count(),0);
  assert.equal(await page.getByText('Hunt cancelled. Run again when ready.',{exact:true}).count(),0,'old cancellation feedback leaked into the loaded hunt');
  assert.ok(await page.getByRole('button',{name:'Run hunt',exact:true}).isEnabled());
  await page.evaluate(()=>{const state=window.captureTest;window.go.main.App.Hunt=state.savedHuntNative;window.go.main.App.CancelQuery=state.savedHuntCancel});
  await page.getByRole('button',{name:'Clear saved scope',exact:true}).click();
  await page.getByRole('button',{name:'Run hunt',exact:true}).click();
  await page.waitForFunction(()=>window.captureTest.huntCalls.length===4);
  const clearedHuntScope=await page.evaluate(()=>window.captureTest.huntCalls.at(-1).filter);
  assert.deepEqual(clearedHuntScope.includes,{});assert.deepEqual(clearedHuntScope.excludes,{});
  assert.equal(clearedHuntScope.expr,null);assert.equal(clearedHuntScope.fromMs,0);assert.equal(clearedHuntScope.toMs,0);
  await page.getByRole('button',{name:'Load hunt',exact:true}).click();
  await page.setViewportSize({width:960,height:720});
  await page.locator('.hunt-view:visible').evaluate(el=>el.scrollTop=0);
  await page.screenshot({path:path.join(output,'saved-hunts.png'),fullPage:true});
  assert.ok(await page.locator('.hunt-view:visible').evaluate(el=>el.scrollWidth<=el.clientWidth),'saved-hunt controls spill at minimum width');
  const deleteSavedHunt=page.waitForEvent('dialog').then(async dialog=>{assert.equal(dialog.type(),'confirm');await dialog.accept()});
  await page.getByRole('button',{name:'Delete hunt',exact:true}).click();
  await deleteSavedHunt;
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('cloudmon.savedHunts')).items.length===0);
  assert.equal(await page.locator('.hunt-view:visible').getByLabel('Saved hunt',{exact:true}).locator('option',{hasText:'Production network review'}).count(),0);
  assert.equal(await page.evaluate(()=>window.captureTest.huntCalls.length),4,'saved-hunt management triggered an extra run');
  // Ordered hunts retain every step, including saved five-step configurations.
  // Real matching/order semantics are covered by store tests; this exercises the UI contract.
  await page.goto('http://127.0.0.1:5181/?recovery');
  const orderedNames=['CreateAccessKey','AttachUserPolicy','ListBuckets','GetObject','DeleteAccessKey'];
  const orderedQueries=orderedNames.map(name=>`eventName="${name}"`);
  const seedOrderedEvents=()=>page.evaluate(names=>{
    const state=window.captureTest,template=state.rows[0];
    state.rows=names.map((eventName,i)=>({...template,seq:i+1,eventID:`sequence-${i+1}`,eventName,eventTime:new Date(Date.parse('2026-09-24T00:00:00Z')+i*60000).toISOString(),identityArn:'arn:aws:iam::111122223333:user/investigator',accessKeyId:'AKIASEQUENCEFIXTURE'}));
    for(const row of state.rows)state.rawBySeq[row.seq]=JSON.stringify({eventID:row.eventID,eventName:row.eventName,eventTime:row.eventTime});
    state.recovery.evidence.events=state.rows.length;
  },orderedNames);
  await seedOrderedEvents();
  await page.getByRole('button',{name:'Open saved evidence',exact:true}).click();
  await page.getByRole('button',{name:'Hunt',exact:true}).click();
  await page.getByRole('tab',{name:'Event sequences',exact:true}).click();
  for(const label of ['A','B'])assert.ok(await page.getByRole('button',{name:`Remove step ${label}`,exact:true}).isDisabled(),'the minimum sequence can lose a step');
  await page.getByLabel('Step A search',{exact:true}).fill(orderedQueries[0]);
  await page.getByLabel('Step B search',{exact:true}).fill(orderedQueries[1]);
  await page.getByRole('button',{name:'Add step',exact:true}).click();
  await page.getByLabel('Step C search',{exact:true}).fill(orderedQueries[2]);
  await page.getByLabel('Sequence interval',{exact:true}).selectOption('5');
  assert.ok((await page.getByLabel('Sequence interval',{exact:true}).locator('..').textContent()).startsWith('Complete sequence within'),'interval does not explain that it spans the complete sequence');
  await page.getByRole('button',{name:'Run hunt',exact:true}).click();
  await page.getByText('1 sequence · 900 events in scope',{exact:true}).waitFor();
  let orderedRequest=await page.evaluate(()=>window.captureTest.huntCalls.at(-1));
  assert.deepEqual(orderedRequest.steps.map(step=>step.value),orderedNames.slice(0,3),'request changed the order of sequence steps');
  assert.equal(orderedRequest.first,null);assert.equal(orderedRequest.second,null);
  assert.equal(orderedRequest.minutes,5);assert.equal(orderedRequest.group,'credential');
  assert.equal(await page.locator('.hunt-view:visible .hunt-step-picks button').count(),3,'three-step result lost a detail record');
  for(let i=3;i<5;i++){
    await page.getByRole('button',{name:'Add step',exact:true}).click();
    await page.getByLabel(`Step ${String.fromCharCode(65+i)} search`,{exact:true}).fill(orderedQueries[i]);
  }
  assert.ok(await page.getByRole('button',{name:'Add step',exact:true}).isDisabled(),'sequence exceeded the five-step bound');
  await page.getByText('Inputs changed. Results below use the previous hunt; run again to apply changes.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Remove step C',exact:true}).click();
  assert.equal(await page.getByLabel('Step C search',{exact:true}).inputValue(),orderedQueries[3],'removing a step reordered the remaining steps');
  assert.equal(await page.getByLabel('Step D search',{exact:true}).inputValue(),orderedQueries[4]);
  assert.equal(await page.getByLabel('Step E search',{exact:true}).count(),0);
  await page.getByRole('button',{name:'Add step',exact:true}).click();
  for(let i=2;i<5;i++)await page.getByLabel(`Step ${String.fromCharCode(65+i)} search`,{exact:true}).fill(orderedQueries[i]);
  await page.locator('.hunt-view:visible summary').filter({hasText:/^Saved hunts \(0\)$/}).click();
  await page.locator('.hunt-view:visible').getByLabel('Hunt name',{exact:true}).fill('Five-step credential review');
  await page.getByRole('button',{name:'Save new hunt',exact:true}).click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('cloudmon.savedHunts')).items.length===1);
  const orderedSaved=await page.evaluate(()=>JSON.parse(localStorage.getItem('cloudmon.savedHunts')).items[0]);
  assert.deepEqual(orderedSaved.config.steps,orderedQueries,'saving truncated a longer sequence');
  await page.reload();
  await seedOrderedEvents();
  await page.getByRole('button',{name:'Open saved evidence',exact:true}).click();
  await page.getByRole('button',{name:'Hunt',exact:true}).click();
  await page.locator('.hunt-view:visible summary').filter({hasText:/^Saved hunts \(1\)$/}).click();
  await page.locator('.hunt-view:visible').getByLabel('Saved hunt',{exact:true}).selectOption(orderedSaved.id);
  await page.getByRole('button',{name:'Load hunt',exact:true}).click();
  await page.waitForFunction(queries=>queries.every((query,i)=>document.querySelector(`.hw-panel:not([hidden]) input[aria-label="Step ${String.fromCharCode(65+i)} search"]`)?.value===query),orderedQueries);
  for(let i=0;i<5;i++)assert.equal(await page.getByLabel(`Step ${String.fromCharCode(65+i)} search`,{exact:true}).inputValue(),orderedQueries[i],'loading changed a saved sequence step');
  assert.equal(await page.getByLabel('Sequence interval',{exact:true}).inputValue(),'5');
  assert.equal(await page.evaluate(()=>window.captureTest.huntCalls?.length||0),0,'loading a longer sequence ran it');
  await page.locator('.hunt-view:visible summary').filter({hasText:/^Saved hunts \(1\)$/}).click();
  await page.getByRole('button',{name:'Run hunt',exact:true}).click();
  await page.getByText('1 sequence · 900 events in scope',{exact:true}).waitFor();
  assert.equal(await page.locator('.hunt-view:visible .hunt-step-picks button').count(),5,'five-step result lost intermediate detail records');
  await page.getByText('3 candidates for step C share the selected timestamp; a representative is shown.',{exact:true}).waitFor();
  orderedRequest=await page.evaluate(()=>window.captureTest.huntCalls.at(-1));
  assert.deepEqual(orderedRequest.steps.map(step=>step.value),orderedNames,'saved sequence request lost or reordered steps');
  const orderedSnapshot=await page.evaluate(()=>window.captureTest.lastHuntSnapshot);
  assert.equal(orderedSnapshot.maxSeq,5);
  await page.evaluate(()=>window.captureTest.emit(6));
  // Each original and investigation stays on the returned snapshot after new evidence arrives.
  for(let i=0;i<5;i++){
    const letter=String.fromCharCode(65+i);
    await page.getByRole('button',{name:`Inspect step ${letter}`,exact:true}).click();
    await openInspectorOriginal(page.locator('.hunt-view:visible .event-inspector'));
    await page.getByRole('dialog',{name:'Raw JSON',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.captureTest.rawSeq),i+1);
    assert.deepEqual(await page.evaluate(()=>window.captureTest.rawSnapshot),orderedSnapshot,`original ${letter} used live evidence`);
    await page.keyboard.press('Escape');
    await page.locator('.hunt-view:visible .event-inspector').getByRole('button',{name:'Investigate',exact:true}).click();
    await page.getByRole('dialog',{name:'Event investigation',exact:true}).waitFor();
    await page.waitForFunction(seq=>window.captureTest.investigationCalls?.at(-1)?.seq===seq,i+1);
    const investigationRequest=await page.evaluate(()=>window.captureTest.investigationCalls.at(-1));
    assert.deepEqual(investigationRequest.snapshot,orderedSnapshot,`investigation ${letter} used live evidence`);
    await page.getByRole('button',{name:'Close investigation',exact:true}).click();
  }
  await page.setViewportSize({width:960,height:1200});
  await page.locator('.hunt-view:visible').evaluate(el=>el.scrollTop=0);
  await page.locator('.hunt-view:visible .hunt-inspection').evaluate(el=>el.scrollTop=0);
  await page.screenshot({path:path.join(output,'ordered-sequences.png'),fullPage:true});
  assert.ok(await page.locator('.hunt-view:visible').evaluate(el=>el.scrollWidth<=el.clientWidth),'five-step hunt spills at minimum width');
  assert.ok(await page.locator('.hunt-view:visible .hunt-inspection').evaluate(el=>el.scrollWidth<=el.clientWidth),'sequence details spill at minimum width');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'sequence page has horizontal overflow');

  // Investigation exports use the displayed successful scope and invalidate native
  // completions when cancellation, new controls, or closing the dialog supersede them.
  await page.goto('http://127.0.0.1:5181/?recovery');
  await page.evaluate(()=>{
    const state=window.captureTest,app=window.go.main.App,base=state.rows[0];
    state.rows=Array.from({length:520},(_,i)=>({...base,seq:i+1,eventID:`report-${i+1}`,eventName:i===0?'GetObject':i%2?'PutObject':'HeadObject',eventSource:'s3.amazonaws.com',eventTime:new Date(Date.parse('2026-09-24T00:00:00Z')+i*500).toISOString()}));
    state.raw=JSON.stringify({eventID:'report-1',eventName:'GetObject',resources:[{ARN:'arn:aws:s3:::evidence-bucket/audit/events.json'}]});
    state.reportMode='success';state.reportCalls=[];state.reportCancelled=[];
    const nativeInvestigate=app.Investigate,nativeCancel=app.CancelQuery;
    app.Investigate=async(options,id)=>{
      const result=await nativeInvestigate(options,id);
      if(state.holdReportInvestigation)await new Promise(resolve=>{state.finishReportInvestigation=resolve});
      state.reportSuccessfulOptions=structuredClone({...options,snapshot:result.snapshot});
      return result;
    };
    app.ExportInvestigation=async(options,id)=>{
      state.reportCalls.push(structuredClone(options));
      if(state.reportMode==='failure')throw Error('Report destination is unavailable');
      const result={path:state.reportMode==='dialog-cancel'?'':'/evidence/reports/production-review.zip',eventCount:options.relation==='resources'?261:500,totalMatches:options.relation==='resources'?261:520,observationCount:503,truncated:options.relation!=='resources'};
      if(state.reportMode==='pending'){
        state.reportPending=id;
        return new Promise((resolve,reject)=>{state.finishReport=path=>resolve({...result,path});state.rejectReport=()=>reject(Error('Report export cancelled'))});
      }
      return result;
    };
    app.CancelQuery=async id=>{
      if(id===state.reportPending){state.reportCancelled.push(id);return}
      return nativeCancel(id);
    };
  });
  await page.getByRole('button',{name:'Open saved evidence',exact:true}).click();
  await page.locator('.row').getByText('GetObject',{exact:true}).click();
  await openRuleInvestigation(page,'GetObject');
  const reportDialog=page.getByRole('dialog',{name:'Event investigation',exact:true});
  const exportInvestigation=reportDialog.getByRole('button',{name:'Export investigation',exact:true});
  await reportDialog.getByText('520 events',{exact:true}).waitFor();
  await exportInvestigation.click();
  await reportDialog.getByText('Saved investigation report:',{exact:false}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.captureTest.reportCalls.at(-1)),await page.evaluate(()=>window.captureTest.reportSuccessfulOptions),'report export changed the displayed investigation options or snapshot');
  await reportDialog.getByText('/evidence/reports/production-review.zip',{exact:false}).waitFor();
  await reportDialog.getByText('Showing 500 closest events of 520. Narrow the window or relationship.',{exact:true}).waitFor();
  await page.setViewportSize({width:960,height:720});
  await page.clock.runFor(150);
  await page.screenshot({path:path.join(output,'investigation-export.png'),fullPage:true});
  assert.ok(await reportDialog.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&el.scrollWidth<=el.clientWidth}),'investigation export controls or status spill at minimum width');
  await page.evaluate(()=>{window.captureTest.reportMode='dialog-cancel'});
  await exportInvestigation.click();
  await reportDialog.getByText('Export cancelled. No report was saved.',{exact:true}).waitFor();
  await page.evaluate(()=>{window.captureTest.reportMode='failure'});
  await exportInvestigation.click();
  await reportDialog.getByRole('alert').getByText('Report destination is unavailable',{exact:false}).waitFor();
  assert.ok(await exportInvestigation.isEnabled(),'failed export cannot be retried');
  await page.evaluate(()=>{window.captureTest.reportMode='pending'});
  await exportInvestigation.click();
  await reportDialog.getByText('Preparing investigation report…',{exact:true}).waitFor();
  await page.waitForFunction(()=>!!window.captureTest.finishReport);
  await reportDialog.getByRole('button',{name:'Cancel export',exact:true}).click();
  await page.waitForFunction(()=>window.captureTest.reportCancelled.length===1);
  await reportDialog.getByText('Cancel requested. Close the save dialog if it is still open.',{exact:true}).waitFor();
  assert.ok(await exportInvestigation.isDisabled(),'cancellation allowed a second native save dialog before the first settled');
  await page.evaluate(()=>window.captureTest.rejectReport());
  await reportDialog.getByText('Export cancelled. No report was saved.',{exact:true}).waitFor();
  // Native publication can win cancellation; the UI must report an already saved file.
  await exportInvestigation.click();
  await page.waitForFunction(()=>window.captureTest.reportCalls.length===5);
  await reportDialog.getByRole('button',{name:'Cancel export',exact:true}).click();
  await page.waitForFunction(()=>window.captureTest.reportCancelled.length===2);
  await page.evaluate(()=>window.captureTest.finishReport('/evidence/reports/save-won-race.zip'));
  await reportDialog.getByText('Saved investigation report: /evidence/reports/save-won-race.zip',{exact:false}).waitFor();
  assert.equal(await reportDialog.getByText('Export cancelled. No report was saved.',{exact:true}).count(),0,'UI hid a successfully saved file after cancellation raced');
  await exportInvestigation.click();
  await page.waitForFunction(()=>window.captureTest.reportCalls.length===6);
  await page.evaluate(()=>{window.captureTest.holdReportInvestigation=true});
  await chooseThemed(page,'Investigation relationship','Shared resource ARN',reportDialog);
  await reportDialog.getByText('Loading investigation…',{exact:true}).waitFor();
  await page.waitForFunction(()=>window.captureTest.reportCancelled.length===3&&!!window.captureTest.finishReportInvestigation);
  assert.ok(await exportInvestigation.isDisabled(),'export remained available while the new investigation was unresolved');
  await page.evaluate(()=>window.captureTest.finishReport('/evidence/reports/stale-scope.zip'));
  await page.clock.runFor(100);
  assert.equal(await reportDialog.getByText('stale-scope.zip',{exact:false}).count(),0,'changed controls accepted an obsolete report completion');
  await page.evaluate(()=>{const state=window.captureTest;state.holdReportInvestigation=false;state.finishReportInvestigation();state.reportMode='success'});
  await reportDialog.getByText('261 events',{exact:true}).waitFor();
  await exportInvestigation.click();
  await reportDialog.getByText('Saved investigation report:',{exact:false}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.captureTest.reportCalls.at(-1)),await page.evaluate(()=>window.captureTest.reportSuccessfulOptions),'retry exported stale controls instead of the new successful investigation');
  assert.equal(await page.evaluate(()=>window.captureTest.reportCalls.at(-1).relation),'resources');
  await page.evaluate(()=>{window.captureTest.reportMode='pending'});
  await exportInvestigation.click();
  await page.waitForFunction(()=>window.captureTest.reportCalls.length===8);
  await reportDialog.getByRole('button',{name:'Close investigation',exact:true}).click();
  await page.waitForFunction(()=>window.captureTest.reportCancelled.length===4);
  await page.evaluate(()=>window.captureTest.finishReport('/evidence/reports/closed-dialog.zip'));
  await page.getByRole('button',{name:'Investigate',exact:true}).click();
  await reportDialog.getByText('520 events',{exact:true}).waitFor();
  assert.equal(await reportDialog.getByText('closed-dialog.zip',{exact:false}).count(),0,'reopened investigation inherited an old export completion');
  await reportDialog.getByRole('button',{name:'Close investigation',exact:true}).click();
  // This HTML is produced by the real DuckDB report test, not a frontend mock.
  // Its offline presentation is inspected at both supported minimum widths.
  if(process.env.CLOUDMON_REPORT_FIXTURE){
    const fixture=path.resolve(process.env.CLOUDMON_REPORT_FIXTURE);
    assert.ok(fs.existsSync(fixture),`Missing generated report fixture: ${fixture}`);
    const reportPage=await browser.newPage({viewport:{width:1024,height:768}});
    const externalRequests=[];
    reportPage.on('pageerror',e=>errors.push(String(e)));
    await reportPage.route(/^https?:/,route=>{externalRequests.push(route.request().url());return route.abort()});
    await reportPage.goto(pathToFileURL(fixture).href);
    await reportPage.getByRole('heading',{name:'Event investigation',exact:true}).waitFor();
    await reportPage.getByRole('heading',{name:'Included evidence',exact:true}).waitFor();
    await reportPage.getByRole('heading',{name:'Chronological context',exact:true}).waitFor();
    for(const summary of await reportPage.locator('details > summary').all())await summary.click();
    assert.equal(await reportPage.locator('script').count(),0,'portable report includes executable scripts');
    assert.equal(await reportPage.evaluate(()=>window.reportInjected===true),false,'retained hostile source text executed as markup');
    assert.ok((await reportPage.locator('body').innerText()).includes('window.reportInjected=true'),'hostile source fixture was dropped instead of displayed safely');
    const relativeEvidenceLinks=await reportPage.locator('a[href]').evaluateAll(links=>links.map(link=>link.getAttribute('href')).filter(href=>/^events\/\d+\.json$|^sources\/\d+\.txt$/.test(href)));
    assert.ok(relativeEvidenceLinks.some(href=>href.startsWith('events/')),'portable report has no raw event links');
    assert.ok(relativeEvidenceLinks.some(href=>href.startsWith('sources/')),'portable report has no retained source links');
    assert.ok(relativeEvidenceLinks.every(href=>fs.existsSync(path.join(path.dirname(fixture),href))),'portable report references missing evidence files');
    assert.ok(await reportPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'portable report spills at 1024px');
    await reportPage.screenshot({path:path.join(output,'investigation-report.png'),fullPage:true});
    await reportPage.setViewportSize({width:960,height:720});
    assert.ok(await reportPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'portable report spills at 960px');
    await reportPage.screenshot({path:path.join(output,'investigation-report-minimum.png'),fullPage:true});
    assert.deepEqual(externalRequests,[],'portable report attempted a network request');
    await reportPage.close();
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:['verified coverage','stale trail after region change','stale identity after profile change','unknown coverage warning','dedicated queue guidance','1024px layout','saved evidence stays offline','failed cleanup retains handles','cleanup preserves evidence','source variants and CSV provenance','raw export preserves large integers','export failure cancels output','explicit resume reuses capture','idle and duplicate batches avoid scans','slow tail requests coalesce without losing arrivals','aggregate refreshes never overlap','inspection stays anchored during capture','invalid search stays unapplied','failed search shows stale results and retries','clear resets unapplied draft'],errors}));
 } catch(error) {
  const failedPage=browser.contexts()[0]?.pages()[0];
  if(failedPage){
   await failedPage.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});
   fs.writeFileSync(path.join(output,'failure.txt'),await failedPage.locator('body').innerText().catch(()=>''));
  }
  throw error;
 } finally {await browser.close();await server.close()}
})().catch(e=>{console.error(e);process.exit(1)});

async function revealReviewEvidence(page) {
  const inspector=page.locator('.workbench-body > .event-inspector');
  await inspector.getByRole('tab',{name:'Overview',exact:true}).click();
  const disclosure=inspector.locator('details').filter({has:page.locator('summary').filter({hasText:/^Evidence & provenance$/})});
  if(!await disclosure.evaluate(el=>el.open))await disclosure.locator('summary').click();
}
async function openReviewEvidence(page) {
  await revealReviewEvidence(page);
  await page.locator('.workbench-body > .event-inspector').getByRole('button',{name:'Sources & hashes',exact:true}).click();
}
async function checkSnapshotActions(page,disabled,message) {
  await revealReviewEvidence(page);
  const inspector=page.locator('.workbench-body > .event-inspector');
  for(const name of ['Sources & hashes','Related events','Credential chain'])assert.equal(await inspector.getByRole('button',{name,exact:true}).isDisabled(),disabled,`${name}: ${message}`);
  await inspector.getByRole('tab',{name:'Fields',exact:true}).click();
}
// The full investigation dialog remains available on Hunt results; Events now
// opens contextual rows instead. Keep dialog/export coverage on its real entry.
async function openRuleInvestigation(page,eventName) {
  await page.getByRole('button',{name:'Hunt',exact:true}).click();
  await page.getByRole('tab',{name:'Rules',exact:true}).click();
  await page.getByRole('button',{name:'▶ Run',exact:true}).click();
  await page.locator('.sigma .row').getByText(eventName,{exact:true}).click();
  await page.getByRole('button',{name:'Investigate',exact:true}).click();
}
async function openInspectorOriginal(scope) {
  await scope.getByRole('tab',{name:'Original JSON',exact:true}).click();
  await scope.getByRole('button',{name:'Open full JSON',exact:true}).click();
}
async function openIndicatorBulk(page) {
  const choices=page.getByRole('button',{name:/^(Paste multiple indicators|Back to indicator list)$/});
  await choices.waitFor();
  const toggle=page.getByRole('button',{name:'Paste multiple indicators',exact:true});
  if(await toggle.isVisible())await toggle.click();
}
