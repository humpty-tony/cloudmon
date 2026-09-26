// Browser-only Wails contract fixture. These responses do NOT test matching.
export function installHuntBridge() {
  const snapshot={generation:'hunt-fixture',maxSeq:8,capturedAt:'2026-09-24T10:00:00Z'};
  const rows=Array.from({length:8},(_,i)=>({seq:i+1,eventID:`fixture-${i+1}`,eventTime:`2026-09-24T09:0${i}:00Z`,eventName:i%2?'CreateAccessKey':'CreateUser',eventSource:'iam.amazonaws.com',awsRegion:'us-east-1',sourceIPAddress:'192.0.2.10',userAgent:'fixture',identityType:'IAMUser',identityArn:'arn:aws:iam::012345678901:user/analyst',userName:'analyst',accountId:'012345678901',principalId:'fixture-identity',roleArn:'',sessionName:'',errorCode:'',errorMessage:'',recipientAccountId:'012345678901',readOnly:false,managementEvent:true,rawJSON:''}));
  const state=window.huntFixture={hunts:[],rules:[],suites:[],raw:[],evidence:[],cancelled:[],pending:[],delay:false,fail:false,failRaw:false};
  const finish=value=>state.delay?new Promise(resolve=>state.pending.push(()=>resolve(value))):Promise.resolve(value);
  const sigma=yaml=>({parsed:true,supported:!yaml.includes('unsupported'),title:yaml.match(/^title:\s*(.*)/m)?.[1]||'Fixture rule',diagnostics:yaml.includes('unsupported')?[{severity:'error',message:'Unsupported fixture modifier',line:5}]:[],sql:'SELECT * FROM events',matches:rows.length,scanned:8,rows,snapshot,explanations:{1:[{name:'selection',matched:true}]}});
  window.go={main:{App:{
    Hunt:async (options,id)=>{state.hunts.push({options,id});if(state.fail)throw Error('Fixture hunt failed');return finish({snapshot,scanned:8,total:options.mode==='indicators'?8:1,limit:500,invalidTimes:1,missingPrincipal:2,missingCredential:3,indicators:options.indicators.map(value=>({...value,matches:8})),matches:options.mode==='indicators'?rows.map(event=>({event,indicators:[0]})):[],sequences:options.mode==='sequence'?[{events:rows.slice(0,options.steps.length),deltaMs:60000,tiedCandidates:options.steps.map((_,i)=>i?1:2)}]:[],pairs:[],notes:['Synthetic bridge fixture. Matching semantics are tested by Go.']});},
    SigmaRunRequest:async (yaml,id)=>{state.rules.push({yaml,id});if(state.fail)throw Error('Fixture rule failed');return finish(sigma(yaml));},
    SigmaSuite:async (rules,id)=>{state.suites.push({rules,id});if(state.fail)throw Error('Fixture suite failed');return finish({snapshot,results:rules.map(rule=>({name:rule.name,result:sigma(rule.yaml)}))});},
    CancelQuery:async id=>{state.cancelled.push(id);},
    QueryLineageRaw:async (seq,scope)=>{state.raw.push({seq,snapshot:scope});if(state.failRaw)throw Error('Evidence dataset replaced');return `{"eventID":"fixture-${seq}","eventName":"${rows[seq-1].eventName}","exactNumber":9007199254740993}`;},
    QueryLineageSnapshot:async()=>({applicable:false,reason:'Synthetic IAM identity; no observed credential chain.',hops:[]}),
    GetEventEvidenceSnapshot:async(seq,offset,scope)=>{state.evidence.push({seq,offset,snapshot:scope});return {seq,total:0,observations:[],variants:0};},
  }}};
}
