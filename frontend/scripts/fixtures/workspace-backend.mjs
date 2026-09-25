// Test-only browser adapter. Desktop-only query results below are deliberately
// synthetic; they test production component lifetimes, not engine correctness.
// Original evidence is still read by the actual browser backend.
export function deferredRaw(original) {
  let holdNext = false;
  const pending = [];
  const gate = {
    deferNext() { holdNext = true; },
    get pending() { return pending.length; },
    completed: 0,
    release(fail = false) {
      const request = pending.shift();
      if (!request) throw Error('No deferred raw request');
      fail ? request.reject(Error('Synthetic delayed raw failure')) : request.resolve();
    },
    async query(...args) {
      const hold = holdNext;
      holdNext = false;
      // Attach the rejection handler before exposing the release control.
      const wait = hold ? new Promise((resolve, reject) => pending.push({resolve, reject})) : Promise.resolve();
      try {
        const [raw] = await Promise.all([original(...args), wait]);
        return raw;
      } finally { gate.completed++; }
    },
  };
  return gate;
}

export async function installWorkspaceBackend(backend) {
  const empty = {includes:{},excludes:{},errorsOnly:false,hideReadOnly:false,fromMs:0,toMs:0,text:'',expr:null};
  const {events, aggregates} = await backend.querySearch(empty, 80);
  const snapshot = aggregates.snapshot;
  const rows = events.map(event=>({...event,
    identityType:event.userIdentity.type, identityArn:event.userIdentity.arn,
    userName:event.userIdentity.userName, principalId:event.userIdentity.principalId,
    accountId:event.userIdentity.accountId, accessKeyId:'', roleArn:'', roleName:'',
    sessionName:'', invokedBy:'', errorCode:event.errorCode||'', errorMessage:'',
  }));
  const calls = {hunt:0, analysis:0, sigma:0, investigation:0};
  backend.queryLineage = async () => ({applicable:true,complete:false,status:'missing',nodes:[],reason:'Synthetic lineage fixture.'});
  backend.queryLineageGraph = async () => ({snapshot,applicable:true,nodes:[],edges:[],currentId:'',rootId:'',notes:['Synthetic graph fixture.']});
  backend.hunt = async options => {
    calls.hunt++;
    return {snapshot,scanned:events.length,total:rows.length,limit:500,invalidTimes:0,missingPrincipal:0,missingCredential:rows.length,
      indicators:options.indicators.map(indicator=>({...indicator,matches:rows.length})),
      matches:rows.map(event=>({event,indicators:[0]})),pairs:[],sequences:[],notes:['Synthetic UI fixture; no native hunt engine.']};
  };
  backend.analyze = async options => {
    calls.analysis++;
    const stats = {events:rows.length,errors:0,writes:0,unknownReadOnly:0,credentialIDs:0,invalidTimes:0,firstMs:Date.parse(rows.at(-1).eventTime),lastMs:Date.parse(rows[0].eventTime)};
    return {snapshot,scope:stats,current:stats,previous:{...stats,events:0},
      groups:[{value:rows[0][options.dimension],current:rows.length,previous:0,errors:0,writes:0,totalGroups:1}],
      totalGroups:1,limit:50,fromMs:stats.firstMs,toMs:stats.lastMs+1,previousFromMs:0,hasWindow:true,
      breakdowns:{},events:options.entity?rows:[],notes:['Synthetic UI fixture; no native analysis engine.']};
  };
  backend.sigmaRun = async () => {
    calls.sigma++;
    return {snapshot,parsed:true,supported:true,title:'Synthetic rule fixture',sql:'',matches:3,scanned:events.length,events:events.slice(0,3),explanations:{},diagnostics:[]};
  };
  backend.investigate = async options => {
    calls.investigation++;
    const event=rows.find(row=>row.seq===options.seq)||rows[0];
    return {snapshot,fromMs:Date.parse(event.eventTime)-300000,toMs:Date.parse(event.eventTime)+300000,total:1,
      events:[{event,deltaMs:0,reasons:[{kind:'anchor',label:'Synthetic anchor'}]}],resources:[],resourcesTruncated:false,notes:['Synthetic UI fixture; no native investigation engine.']};
  };
  const gate = deferredRaw(backend.queryLineageRaw.bind(backend));
  backend.queryLineageRaw = (...args)=>gate.query(...args);
  return {gate,calls};
}
