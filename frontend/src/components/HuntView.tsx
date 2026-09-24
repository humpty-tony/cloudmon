import {useEffect,useMemo,useRef,useState} from "react";
import {useVirtualizer} from "@tanstack/react-virtual";
import {backend} from "../api/backend";
import {compileQuery} from "../api/queryLang";
import type {CloudTrailEvent,EventRow,HuntIndicator,HuntOptions,HuntResult,QueryFilter} from "../api/types";
import {rowToEvent,QUERY_FIELDS} from "../api/types";
import {RawJsonModal} from "./RawJsonModal";
import {InvestigationView} from "./InvestigationView";
import {SavedHuntsPanel} from "./SavedHuntsPanel";
import {cloneHuntConfig,type HuntConfig,type SavedHunt} from "../api/savedHunts";

const emptyFilter:QueryFilter={includes:{},excludes:{},errorsOnly:false,hideReadOnly:false,fromMs:0,toMs:0,text:"",expr:null};
const searchFields=new Set<string>(QUERY_FIELDS);
function indicators(text:string):{values:HuntIndicator[];error:string} {
  const lines=text.split(/\r?\n/).filter(line=>line.trim());
  if(!lines.length||lines.length>100)return {values:[],error:"Enter 1 to 100 indicators, one per line."};
  const values:HuntIndicator[]=[];
  for(let i=0;i<lines.length;i++){
    const match=lines[i].trim().match(/^(ip|cidr|key|event|arn)\s+(.+)$/);
    if(!match)return {values:[],error:`Line ${i+1}: use a type (ip, cidr, key, event or arn), a space, then the value.`};
    values.push({kind:match[1] as HuntIndicator["kind"],value:match[2].trim()});
  }
  return {values,error:""};
}

export function HuntView({filter}:{filter:QueryFilter}) {
  const [mode,setMode]=useState<HuntOptions["mode"]>("indicators"),[text,setText]=useState("");
  const [steps,setSteps]=useState(["",""]),[group,setGroup]=useState<HuntOptions["group"]>("credential"),[minutes,setMinutes]=useState(15),[useFilter,setUseFilter]=useState(false);
  const [savedFilter,setSavedFilter]=useState<QueryFilter|null>(null);
  const [first,second]=steps;
  const setFirst=(value:string)=>setSteps(current=>current.map((step,i)=>i===0?value:step));
  const setSecond=(value:string)=>setSteps(current=>current.map((step,i)=>i===1?value:step));
  const [result,setResult]=useState<HuntResult|null>(null),[applied,setApplied]=useState("");
  const [resultMode,setResultMode]=useState(mode),[busy,setBusy]=useState(false),[error,setError]=useState(""),[selected,setSelected]=useState(0);
  const [raw,setRaw]=useState<{title:string;json:string}|null>(null),[rawError,setRawError]=useState(""),[rawBusy,setRawBusy]=useState(false);
  const [investigation,setInvestigation]=useState<CloudTrailEvent|null>(null);
  const controller=useRef<AbortController|null>(null),request=useRef(0),rawRequest=useRef(0),scroll=useRef<HTMLDivElement>(null);
  const parsed=useMemo(()=>indicators(text),[text]),a=useMemo(()=>compileQuery(first,searchFields),[first]),b=useMemo(()=>compileQuery(second,searchFields),[second]);
  const validation=mode==="indicators"?parsed.error:steps.length!==2?"This build runs two-step sequences. Additional saved steps have been preserved; load a two-step hunt to run a sequence.":a.error?`Step A: ${a.error}`:b.error?`Step B: ${b.error}`:!a.ast||!b.ast?"Both steps need a search expression.":"";
  const scope=useFilter?filter:savedFilter??emptyFilter;
  const options:HuntOptions={mode,filter:scope,indicators:mode==="indicators"?parsed.values:[],first:mode==="sequence"?a.ast:null,second:mode==="sequence"?b.ast:null,group,minutes,snapshot:null};
  const signature=JSON.stringify({options,text,steps});
  const config:HuntConfig={mode,indicatorText:text,steps,group,minutes,filter:scope};
  const rows=useMemo(()=>resultMode==="indicators"?(result?.matches??[]).map(item=>({first:item.event,second:null as EventRow|null,detail:item.indicators.map(i=>`${result!.indicators[i].kind}: ${result!.indicators[i].value}`),label:"Indicator match"})):(result?.pairs??[]).map(pair=>({first:pair.first,second:pair.second,detail:[`${(pair.deltaMs/1000).toLocaleString()} seconds later`,...(pair.tiedFirst>1?[`${pair.tiedFirst} A candidates share this timestamp; a representative is shown.`]:[])],label:"A → B"})),[result,resultMode]);
  const virtual=useVirtualizer({count:rows.length,getScrollElement:()=>scroll.current,estimateSize:()=>142,overscan:3});
  const chosen=rows[selected];
  useEffect(()=>()=>{controller.current?.abort();request.current++;rawRequest.current++},[]);
  useEffect(()=>{if(result)virtual.measure()},[result]);
  const load=(hunt:SavedHunt)=>{
    const next=cloneHuntConfig(hunt.config);
    if(next.mode==="sequence"&&next.steps.length!==2)throw Error("This build can run two-step hunts. This saved hunt has more steps and has been kept unchanged.");
    controller.current?.abort();controller.current=null;request.current++;rawRequest.current++;
    setBusy(false);setResult(null);setApplied("");setError("");setSelected(0);setRaw(null);setRawError("");setRawBusy(false);setInvestigation(null);
    setMode(next.mode);setText(next.indicatorText);setSteps(next.steps);setGroup(next.group);setMinutes(next.minutes);setUseFilter(false);setSavedFilter(next.filter);
  };
  const run=async()=>{
    if(validation||controller.current)return;
    const abort=new AbortController(),id=++request.current;controller.current=abort;
    rawRequest.current++;setRaw(null);setRawBusy(false);setRawError("");setInvestigation(null);setResult(null);setBusy(true);setError("");setApplied(signature);setResultMode(mode);setSelected(0);
    try{const next=await backend.hunt(options,abort.signal);if(id===request.current&&!abort.signal.aborted)setResult(next)}
    catch(e){if(id===request.current&&!abort.signal.aborted)setError(String(e))}
    finally{if(id===request.current){controller.current=null;setBusy(false);if(abort.signal.aborted)setError("Hunt cancelled. Run again when ready.")}}
  };
  const original=async(event:EventRow)=>{
    if(!result)return;const id=++rawRequest.current;setRawBusy(true);setRawError("");
    try{const json=await backend.queryLineageRaw(event.seq,result.snapshot);if(id===rawRequest.current)setRaw({title:`${event.eventName} · ${event.eventID}`,json})}
    catch(e){if(id===rawRequest.current)setRawError(String(e))}
    finally{if(id===rawRequest.current)setRawBusy(false)}
  };
  return <main className="analysis-view hunt-view">
    <header className="analysis-heading"><div><h1>Investigation hunts</h1><p>Find typed indicators or a matching event followed by another.</p></div><button className="btn-primary" disabled={busy||!!validation} onClick={()=>void run()}>Run hunt</button>{busy&&<button className="btn-ghost btn-sm" onClick={()=>controller.current?.abort()}>Cancel hunt</button>}</header>
    <SavedHuntsPanel config={config} validation={validation} busy={busy} onLoad={load}/>
    <div className="analysis-controls"><label>Hunt type <select aria-label="Hunt type" value={mode} disabled={busy} onChange={e=>setMode(e.target.value as HuntOptions["mode"])}><option value="indicators">Bulk indicators</option><option value="sequence">Ordered events A → B</option></select></label><label><input type="checkbox" checked={useFilter} disabled={busy} onChange={e=>{setUseFilter(e.target.checked);setSavedFilter(null)}}/> Use console filters</label></div>
    {mode==="indicators"?<label className="hunt-input">Typed indicators <textarea aria-label="Typed indicators" value={text} disabled={busy} maxLength={256000} onChange={e=>setText(e.target.value)} spellCheck={false} placeholder={'ip 192.0.2.1\ncidr 2001:db8::/32\nkey ASIAEXAMPLE\nevent event-id\narn arn:aws:s3:::example-bucket'}/><span>One type and value per line · up to 100 · IPv4 and IPv6 supported · IDs and ARNs are exact matches</span></label>:<div className="hunt-sequence-controls"><label className="hunt-input">Step A · earlier search<input aria-label="Step A search" value={first} disabled={busy} maxLength={16384} onChange={e=>setFirst(e.target.value)} placeholder='eventName="FirstOperation"'/></label><label className="hunt-input">Step B · later search<input aria-label="Step B search" value={second} disabled={busy} maxLength={16384} onChange={e=>setSecond(e.target.value)} placeholder='eventName="SecondOperation"'/></label><div className="analysis-controls"><label>Group by <select aria-label="Sequence grouping" disabled={busy} value={group} onChange={e=>setGroup(e.target.value as HuntOptions["group"])}><option value="credential">Same access key and principal ARN</option><option value="principal">Same principal ARN</option></select></label><label>Within <select aria-label="Sequence interval" disabled={busy} value={minutes} onChange={e=>setMinutes(Number(e.target.value))}>{[...new Set([1,5,15,60,1440,minutes])].sort((a,b)=>a-b).map(n=><option key={n} value={n}>{n===1440?"24 hours":`${n} minutes`}</option>)}</select></label></div></div>}
    <div className="analysis-scope">{useFilter?"Scope: console filters, including time bounds, apply to every step.":savedFilter?"Scope: saved filters. Filter values and absolute time bounds are fixed until you change scope.":"Scope: all loaded evidence."} Runs on request. Matches are investigative context.</div>
    {savedFilter&&!useFilter&&<div className="saved-hunt-scope"><details><summary>Saved filter scope</summary><pre>{JSON.stringify(savedFilter,null,2)}</pre></details><div className="saved-hunt-actions"><button className="btn-ghost btn-sm" disabled={busy} onClick={()=>{setSavedFilter(null);setUseFilter(true)}}>Use current console filters</button><button className="btn-ghost btn-sm" disabled={busy} onClick={()=>{setSavedFilter(null);setUseFilter(false)}}>Clear saved scope</button></div></div>}
    {validation&&<div className="hunt-validation">{validation}</div>}
    {result&&applied!==signature&&<div className="analysis-notice" role="status">Inputs changed. Results below use the previous hunt; run again to apply changes.</div>}
    {busy?<div className="analysis-empty" role="status">Searching evidence snapshot…</div>:error?<div className="analysis-empty" role="alert">{error}</div>:result&&<>
      <div className="analysis-result-head"><strong>{result.total.toLocaleString()} {resultMode==="indicators"?"matched events":"event pairs"} · {result.scanned.toLocaleString()} events in scope</strong><span>Snapshot {new Date(result.snapshot.capturedAt).toLocaleString()}</span></div>
      {resultMode==="indicators"&&<details className="hunt-counts"><summary>Matches per indicator ({result.indicators.length})</summary>{result.indicators.map((indicator,i)=><div key={i}><code>{indicator.kind} {indicator.value}</code><b>{indicator.matches.toLocaleString()}</b></div>)}</details>}
      {resultMode==="sequence"&&<div className="analysis-scope">Closest earlier A for each B · {result.invalidTimes.toLocaleString()} events have no usable time · {result.missingPrincipal.toLocaleString()} have no principal ARN. A credential group also requires a recorded key.</div>}
      {rows.length?<div className="hunt-results"><div className="hunt-list" ref={scroll} role="list" aria-label="Hunt results"><div style={{height:virtual.getTotalSize(),position:"relative"}}>{virtual.getVirtualItems().map(v=>{const row=rows[v.index];return <button role="listitem" key={v.index} className={`hunt-card ${selected===v.index?"selected":""}`} style={{height:v.size,transform:`translateY(${v.start}px)`}} onClick={()=>{setSelected(v.index);rawRequest.current++;setRawBusy(false);setRawError("")}}><strong>{row.first.eventName}{row.second?` → ${row.second.eventName}`:""}</strong><time>{row.first.eventTime}{row.second?` → ${row.second.eventTime}`:""}</time><span>{row.first.identityArn||"Principal not recorded"}</span><small>{row.detail.slice(0,2).join(" · ")}{row.detail.length>2?` · +${row.detail.length-2} more`:""}</small></button>})}</div></div>
        <aside className="hunt-detail"><h2>{chosen?.label}</h2>{chosen?.detail.map((reason,i)=><p key={i}>{reason}</p>)}{rawError&&<div role="alert">{rawError}</div>}{chosen&&[chosen.first,...(chosen.second?[chosen.second]:[])].map((event,i)=><section key={`${event.seq}-${i}`}><h3>{resultMode==="sequence"?`${i===0?"A":"B"} · `:""}{event.eventName}</h3><p>{event.eventSource}</p><code>{event.eventID}</code><div><button className="btn-ghost btn-sm" disabled={rawBusy} onClick={()=>void original(event)}>Original {resultMode==="sequence"?(i===0?"A":"B"):"record"}</button><button className="btn-ghost btn-sm" onClick={()=>setInvestigation(rowToEvent(event))}>Investigate {resultMode==="sequence"?(i===0?"A":"B"):"event"}</button></div></section>)}</aside>
      </div>:<div className="analysis-empty">No matches in this evidence snapshot.</div>}
      <div className="analysis-scope">Showing {rows.length.toLocaleString()} of {result.total.toLocaleString()} results{result.total>result.limit?". Narrow the search to inspect the rest.":"."}</div>
      <details className="analysis-notes"><summary>Matching rules and limitations</summary>{result.notes.map(note=><p key={note}>{note}</p>)}</details>
    </>}
    {raw&&<RawJsonModal title={raw.title} json={raw.json} onClose={()=>setRaw(null)}/>}
    {investigation&&result&&<InvestigationView event={investigation} initialSnapshot={result.snapshot} onClose={()=>setInvestigation(null)}/>}
  </main>;
}
