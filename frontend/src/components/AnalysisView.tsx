import {useEffect,useRef,useState} from "react";
import {backend} from "../api/backend";
import type {ActivityAnalysis,AnalysisDimension,AnalysisOptions,CloudTrailEvent,EventRow,QueryFilter} from "../api/types";
import {rowToEvent} from "../api/types";
import {RawJsonModal} from "./RawJsonModal";
import {InvestigationView} from "./InvestigationView";

export const analysisDimensions: [AnalysisDimension,string][] = [["identityArn","Principal / session ARN"],["roleArn","Role ARN"],["eventSource","Service"],["eventName","Operation"],["accountId","Actor account"],["recipientAccountId","Recipient account"],["sourceIPAddress","Source address"],["awsRegion","Region"]];
const allEvidence:QueryFilter={includes:{},excludes:{},errorsOnly:false,hideReadOnly:false,fromMs:0,toMs:0,text:"",expr:null};
const date=(ms:number|null)=>ms===null?"Not recorded":new Date(ms).toISOString();
const number=(n:number)=>n.toLocaleString();

export function AnalysisView({filter}:{filter:QueryFilter}) {
  const [dimension,setDimension]=useState<AnalysisDimension>("identityArn");
  const [compare,setCompare]=useState(false),[hours,setHours]=useState(24),[useFilter,setUseFilter]=useState(false);
  const [result,setResult]=useState<ActivityAnalysis|null>(null),[applied,setApplied]=useState<AnalysisOptions|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const [raw,setRaw]=useState<{title:string;json:string}|null>(null),[rawError,setRawError]=useState("");
  const [rawBusy,setRawBusy]=useState(false),[investigation,setInvestigation]=useState<CloudTrailEvent|null>(null);
  const active=useRef<AbortController|null>(null),request=useRef(0),rawRequest=useRef(0);
  const draft:AnalysisOptions={filter:useFilter?filter:allEvidence,dimension,compare,windowHours:hours,entity:null,snapshot:null};
  const changed=applied&&JSON.stringify({...applied,entity:null,snapshot:null})!==JSON.stringify(draft);
  useEffect(()=>()=>{active.current?.abort();request.current++;rawRequest.current++},[]);
  const run=async(options=draft)=>{
    if(active.current)return;
    const controller=new AbortController(),id=++request.current;active.current=controller;
    rawRequest.current++;setRaw(null);setRawBusy(false);setRawError("");setError("");setBusy(true);setResult(null);setApplied(options);
    try {const next=await backend.analyze(options,controller.signal);if(id===request.current&&!controller.signal.aborted)setResult(next)}
    catch(e){if(id===request.current&&!controller.signal.aborted)setError(String(e))}
    finally{if(id===request.current){active.current=null;setBusy(false);if(controller.signal.aborted)setError("Analysis cancelled. Run again when ready.")}}
  };
  const openRaw=async(event:EventRow)=>{
    if(!result)return;const id=++rawRequest.current;setRawBusy(true);setRawError("");
    try{const json=await backend.queryLineageRaw(event.seq,result.snapshot);if(id===rawRequest.current)setRaw({title:`${event.eventName} · ${event.eventID}`,json})}
    catch(e){if(id===rawRequest.current)setRawError(String(e))}
    finally{if(id===rawRequest.current)setRawBusy(false)}
  };
  const label=analysisDimensions.find(([key])=>key===(applied?.dimension??dimension))?.[1];
  return <main className="analysis-view">
    <header className="analysis-heading"><div><h1>Activity analysis</h1><p>Explore recorded activity and compare it with the preceding window.</p></div><button className="btn-primary" disabled={busy} onClick={()=>void run()}>Run analysis</button>{busy&&<button className="btn-ghost btn-sm" onClick={()=>active.current?.abort()}>Cancel analysis</button>}</header>
    <div className="analysis-controls">
      <label>Group by <select aria-label="Analysis dimension" disabled={busy} value={dimension} onChange={e=>setDimension(e.target.value as AnalysisDimension)}>{analysisDimensions.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <label><input type="checkbox" checked={compare} disabled={busy} onChange={e=>setCompare(e.target.checked)}/> Compare previous window</label>
      {compare&&<label>Each window <select aria-label="Baseline window" disabled={busy} value={hours} onChange={e=>setHours(Number(e.target.value))}><option value={1}>1 hour</option><option value={24}>24 hours</option><option value={168}>7 days</option></select></label>}
      <label><input type="checkbox" disabled={busy} checked={useFilter} onChange={e=>setUseFilter(e.target.checked)}/> Use console search, including time filters</label>
    </div>
    <div className="analysis-scope">{useFilter?"Scope: console search. All its filters apply to both windows.":"Scope: all loaded evidence. Console filters are not applied."} Updates run on request.</div>
    {changed&&<div className="analysis-notice" role="status">Settings changed. Run analysis to apply them; the results below use the previous settings.</div>}
    {busy?<div className="analysis-empty" role="status">Reading activity snapshot…</div>:error?<div className="analysis-empty" role="alert">{error}</div>:!result?<div className="analysis-empty">Run analysis to rank activity. Select a result to inspect its services, operations, source addresses and original records.</div>:applied&&<>
      <div className="analysis-result-head"><strong>{applied.entity?`${label}: ${applied.entity.value||"Not recorded"}`:`${label} overview`}</strong><span>Snapshot {new Date(result.snapshot.capturedAt).toLocaleString()}</span>{applied.entity&&<button className="btn-ghost btn-sm" onClick={()=>void run({...applied,entity:null,snapshot:result.snapshot})}>Back to overview</button>}</div>
      {applied.compare&&<div className="analysis-window">{result.hasWindow?<><div>Current: {date(result.fromMs)} ≤ time &lt; {date(result.toMs)}</div><div>Previous: {date(result.previousFromMs)} ≤ time &lt; {date(result.fromMs)}</div></>:"No usable timestamps in this scope."}<span>{number(result.scope.invalidTimes)} event(s) lack a usable timestamp. Counts can reflect gaps in the loaded evidence.</span></div>}
      <div className="analysis-stats">{[["Current events",result.current.events],["Top-level errors",result.current.errors],["Recorded writes",result.current.writes],["Read/write unknown",result.current.unknownReadOnly],...(applied.compare?[["Previous events",result.previous.events]]:[["Credential IDs",result.current.credentialIDs]])].map(([title,count])=><div key={title}><span>{title}</span><strong>{number(Number(count))}</strong></div>)}</div>
      <div className="analysis-table-wrap"><table className="analysis-table"><thead><tr><th>{label}</th><th>{applied.compare?"Current":"Events"}</th>{applied.compare&&<><th>Previous</th><th>Change</th></>}<th>Errors</th><th>Writes</th></tr></thead><tbody>{result.groups.map(group=><tr key={group.value}><td><button className="analysis-entity" disabled={busy} onClick={()=>void run({...applied,entity:{dimension:applied.dimension,value:group.value},snapshot:result.snapshot})}>{group.value||"Not recorded"}</button></td><td>{number(group.current)}</td>{applied.compare&&<><td>{number(group.previous)}</td><td className={group.current>group.previous?"analysis-increase":""}>{group.current>group.previous?"+":""}{number(group.current-group.previous)}{group.previous===0&&group.current>0&&<small>New in compared window</small>}</td></>}<td>{number(group.errors)}</td><td>{number(group.writes)}</td></tr>)}</tbody></table>{!result.groups.length&&<p>No events match this scope.</p>}</div>
      <div className="analysis-scope">Showing {result.groups.length} of {number(result.totalGroups)} groups · ranked by {applied.compare?"absolute count change":"event count"}. {result.totalGroups>result.limit&&"Only the top 50 groups are displayed."}</div>
      {applied.entity&&<><div className="analysis-breakdowns">{Object.entries(result.breakdowns).map(([field,groups])=><section key={field}><h3>{analysisDimensions.find(([key])=>key===field)?.[1]}</h3>{groups.map(g=><div key={g.value}><span>{g.value||"Not recorded"}</span><b>{number(g.current)}</b></div>)}<small>Top 10 · current counts</small></section>)}</div>
        <section className="analysis-records"><h2>Recent original records</h2><p>Up to 25 current-window events · first {date(result.current.firstMs)} · last {date(result.current.lastMs)}</p>{rawError&&<div role="alert">{rawError}</div>}{result.events.map(event=><div className="analysis-record" key={event.seq}><time>{event.eventTime||"Time not recorded"}</time><strong>{event.eventName}</strong><span>{event.eventID}</span><button className="btn-ghost btn-sm" disabled={rawBusy} onClick={()=>void openRaw(event)}>Original record</button><button className="btn-ghost btn-sm" onClick={()=>setInvestigation(rowToEvent(event))}>Investigate</button></div>)}</section></>}
      <details className="analysis-notes"><summary>Scope and interpretation</summary>{result.notes.map(note=><p key={note}>{note}</p>)}<p>Overall scope: {number(result.scope.events)} stored events; {number(result.scope.invalidTimes)} lack usable timestamps. Missing entity values form an explicit “Not recorded” bucket.</p></details>
    </>}
    {raw&&<RawJsonModal title={raw.title} json={raw.json} onClose={()=>setRaw(null)}/>}
    {investigation&&<InvestigationView event={investigation} onClose={()=>setInvestigation(null)}/>}
  </main>;
}
