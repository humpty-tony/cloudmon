import {useEffect,useLayoutEffect,useMemo,useRef,useState} from "react";
import {useWorkspaceActive} from "./WorkspaceActivity";
import {useVirtualizer} from "@tanstack/react-virtual";
import {backend} from "../api/backend";
import {compileQuery} from "../api/queryLang";
import type {CloudTrailEvent,EventRow,EvidenceSnapshot,HuntIndicator,HuntOptions,HuntResult,Lineage,QueryFilter} from "../api/types";
import {rowToEvent,QUERY_FIELDS,hasCredentialLineage} from "../api/types";
import {EventInspector,type EventInspectorProps} from "./EventInspector";
import {LineageView} from "./LineageView";
import {RawJsonModal} from "./RawJsonModal";
import {InvestigationView} from "./InvestigationView";
import {SavedHuntsPanel} from "./SavedHuntsPanel";
import {cloneHuntConfig,type HuntConfig,type SavedHunt} from "../api/savedHunts";

const emptyFilter:QueryFilter={includes:{},excludes:{},errorsOnly:false,hideReadOnly:false,fromMs:0,toMs:0,text:"",expr:null};
const searchFields=new Set<string>(QUERY_FIELDS);
const stepLabel=(index:number)=>String.fromCharCode(65+index);
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

interface HuntViewProps {
  filter: QueryFilter;
  fixedMode?: HuntOptions["mode"];
  savedLoad?: {hunt:SavedHunt};
  onLoadSaved?: (hunt:SavedHunt)=>void;
  inspector?: Pick<EventInspectorProps,"onPivot"|"timeZone">;
}

function HuntResultInspector({row,snapshot,onClose,...props}:Pick<EventInspectorProps,"onPivot"|"timeZone"|"onClose"> & {row:EventRow;snapshot:EvidenceSnapshot}) {
  const event=useMemo(()=>rowToEvent(row),[row]);
  const [raw,setRaw]=useState(""),[rawError,setRawError]=useState("");
  const [lineage,setLineage]=useState<Lineage|null>(null),[lineageError,setLineageError]=useState("");
  const [retry,setRetry]=useState(0),[graph,setGraph]=useState(false);
  useEffect(()=>{
    let current=true;
    setRaw("");setRawError("");setLineage(null);setLineageError("");
    backend.queryLineageRaw(row.seq,snapshot).then(value=>{if(current){setRaw(value);if(!value)setRawError("No retained original record.")}}).catch(error=>{if(current)setRawError(String(error))});
    if(hasCredentialLineage(event))backend.queryLineage(row.seq,snapshot).then(value=>{if(current)setLineage(value)}).catch(error=>{if(current)setLineageError(String(error))});
    return ()=>{current=false};
  },[row.seq,snapshot,event,retry]);
  return <><EventInspector {...props} pivotLabel="Search all evidence" event={event} snapshot={snapshot} rawJSON={raw} rawError={rawError} lineage={lineage} lineageError={lineageError} onRetry={()=>setRetry(value=>value+1)} onOpenLineage={()=>setGraph(true)} onClose={onClose}/>{graph&&<LineageView seq={row.seq} initialSnapshot={snapshot} onClose={()=>setGraph(false)} onPivot={props.onPivot}/>}</>;
}

export function HuntView({filter,fixedMode,savedLoad,onLoadSaved,inspector}:HuntViewProps) {
  const [localMode,setMode]=useState<HuntOptions["mode"]>("indicators"),[text,setText]=useState("");
  const mode=fixedMode??localMode;
  const [indicatorType,setIndicatorType]=useState<HuntIndicator["kind"]>("ip"),[indicatorValue,setIndicatorValue]=useState("");
  const appendIndicator=(line:string)=>setText(current=>`${current}${current&&!current.endsWith("\n")?"\n":""}${line}`);
  const canAddIndicator=!!indicatorValue.trim()&&!/[\r\n]/.test(indicatorValue)&&text.length+indicatorValue.trim().length+indicatorType.length+2<=256000;
  const [steps,setSteps]=useState(["",""]),[group,setGroup]=useState<HuntOptions["group"]>("credential"),[minutes,setMinutes]=useState(15),[useFilter,setUseFilter]=useState(false);
  const [savedFilter,setSavedFilter]=useState<QueryFilter|null>(null);
  const setStep=(index:number,value:string)=>setSteps(current=>current.map((step,i)=>i===index?value:step));
  const [result,setResult]=useState<HuntResult|null>(null),[applied,setApplied]=useState("");
  const [resultMode,setResultMode]=useState(mode),[busy,setBusy]=useState(false),[error,setError]=useState(""),[selected,setSelected]=useState(0);
  const [selectedStep,setSelectedStep]=useState<number|null>(0);
  const [raw,setRaw]=useState<{title:string;json:string}|null>(null),[rawError,setRawError]=useState(""),[rawBusy,setRawBusy]=useState(false);
  const [investigation,setInvestigation]=useState<CloudTrailEvent|null>(null);
  const controller=useRef<AbortController|null>(null),request=useRef(0),rawRequest=useRef(0),scroll=useRef<HTMLDivElement>(null);
  const parsed=useMemo(()=>indicators(text),[text]),compiledSteps=useMemo(()=>steps.map(step=>compileQuery(step,searchFields)),[steps]);
  const invalidStep=compiledSteps.findIndex(step=>!!step.error||!step.ast);
  const validation=mode==="indicators"?parsed.error:steps.length<2||steps.length>5?"Use 2–5 ordered steps.":invalidStep>=0?`Step ${stepLabel(invalidStep)}: ${compiledSteps[invalidStep].error||"enter a search expression."}`:"";
  const scope=useFilter?filter:savedFilter??emptyFilter;
  const options:HuntOptions={mode,filter:scope,indicators:mode==="indicators"?parsed.values:[],first:null,second:null,steps:mode==="sequence"?compiledSteps.flatMap(step=>step.ast?[step.ast]:[]):null,group,minutes,snapshot:null};
  const signature=JSON.stringify({options,text,steps});
  const config:HuntConfig={mode,indicatorText:text,steps,group,minutes,filter:scope};
  const rows=useMemo(()=>{
    if(resultMode==="indicators")return (result?.matches??[]).map(item=>({events:[item.event],detail:item.indicators.map(i=>`${result!.indicators[i].kind}: ${result!.indicators[i].value}`),label:"Indicator match",summary:""}));
    const sequences=result?.sequences??(result?.pairs??[]).map(pair=>({events:[pair.first,pair.second],deltaMs:pair.deltaMs,tiedCandidates:[pair.tiedFirst,1]}));
    return sequences.map(sequence=>({
      events:sequence.events,
      detail:[`${(sequence.deltaMs/1000).toLocaleString()} seconds from first to last step`,...sequence.tiedCandidates.flatMap((count,i)=>count>1?[`${count.toLocaleString()} candidates for step ${stepLabel(i)} share the selected timestamp; a representative is shown.`]:[])],
      label:sequence.events.map((_,i)=>stepLabel(i)).join(" → "),
      summary:`${sequence.events.length} steps · ${(sequence.deltaMs/1000).toLocaleString()} seconds total`,
    }));
  },[result,resultMode]);
  const virtual=useVirtualizer({count:rows.length,getScrollElement:()=>scroll.current,estimateSize:()=>fixedMode?64:142,overscan:3});
  const chosen=rows[selected];
  const workspaceActive=useWorkspaceActive();
  useLayoutEffect(()=>{
    if(!workspaceActive){rawRequest.current++;setRaw(null);setRawBusy(false);setRawError("");setInvestigation(null)}
  },[workspaceActive]);
  useEffect(()=>()=>{controller.current?.abort();request.current++;rawRequest.current++},[]);
  useEffect(()=>{if(result)virtual.measure()},[result]);
  const load=(hunt:SavedHunt)=>{
    const next=cloneHuntConfig(hunt.config);
    controller.current?.abort();controller.current=null;request.current++;rawRequest.current++;
    setBusy(false);setResult(null);setApplied("");setError("");setSelected(0);setRaw(null);setRawError("");setRawBusy(false);setInvestigation(null);
    setSelectedStep(0);
    setMode(next.mode);setText(next.indicatorText);setSteps(next.steps);setGroup(next.group);setMinutes(next.minutes);setUseFilter(false);setSavedFilter(next.filter);
  };
  useEffect(()=>{if(savedLoad)load(savedLoad.hunt)},[savedLoad]);
  const loadFromPanel=(hunt:SavedHunt)=>{
    if(onLoadSaved){
      // A cross-mode load cancels the source's pending request, but retains its
      // successful result/draft. Only the target definition is replaced.
      controller.current?.abort();controller.current=null;request.current++;setBusy(false);
      onLoadSaved(hunt);
    }else load(hunt);
  };
  const run=async()=>{
    if(validation||controller.current)return;
    const abort=new AbortController(),id=++request.current;controller.current=abort;
    rawRequest.current++;setRaw(null);setRawBusy(false);setRawError("");setInvestigation(null);setResult(null);setBusy(true);setError("");setApplied(signature);setResultMode(mode);setSelected(0);
    setSelectedStep(0);
    try{const next=await backend.hunt(options,abort.signal);if(id===request.current&&!abort.signal.aborted)setResult(next)}
    catch(e){if(id===request.current&&!abort.signal.aborted)setError(String(e))}
    finally{if(id===request.current){controller.current=null;setBusy(false);if(abort.signal.aborted)setError("Hunt cancelled. Run again when ready.")}}
  };
  const original=async(event:EventRow)=>{
    if(!result||!workspaceActive)return;const id=++rawRequest.current;setRawBusy(true);setRawError("");
    try{const json=await backend.queryLineageRaw(event.seq,result.snapshot);if(id===rawRequest.current)setRaw({title:`${event.eventName} · ${event.eventID}`,json})}
    catch(e){if(id===rawRequest.current)setRawError(String(e))}
    finally{if(id===rawRequest.current)setRawBusy(false)}
  };
  return <div className="analysis-view hunt-view">
    <div className="hunt-author">
    <header className="analysis-heading"><div><h1>{fixedMode?(mode==="indicators"?"Indicators":"Event sequences"):"Investigation hunts"}</h1>{!fixedMode&&<p>Find typed indicators or a sequence of two to five recorded events.</p>}</div><button className="btn-primary" disabled={busy||!!validation} onClick={()=>void run()}>Run hunt</button>{busy&&<button className="btn-ghost btn-sm" onClick={()=>controller.current?.abort()}>Cancel hunt</button>}</header>
    <SavedHuntsPanel config={config} validation={validation} busy={busy} onLoad={loadFromPanel} loaded={savedLoad}/>
    <div className="analysis-controls">{!fixedMode?<><label>Hunt type <select aria-label="Hunt type" value={mode} disabled={busy} onChange={e=>setMode(e.target.value as HuntOptions["mode"])}><option value="indicators">Bulk indicators</option><option value="sequence">Ordered events (2–5 steps)</option></select></label><label><input type="checkbox" checked={useFilter} disabled={busy} onChange={e=>{setUseFilter(e.target.checked);setSavedFilter(null)}}/> Use console filters</label></>:<label>Scope <select aria-label="Hunt scope" value={useFilter?"workbench":savedFilter?"saved":"all"} disabled={busy} onChange={e=>{setUseFilter(e.target.value==="workbench");if(e.target.value!=="saved")setSavedFilter(null)}}><option value="all">All loaded evidence</option><option value="workbench">Current event filters</option>{savedFilter&&<option value="saved">Saved filters (fixed)</option>}</select></label>}</div>
    {mode==="indicators"?<>
      <div className="hunt-indicator-add">
        <label>Type <select aria-label="Indicator type" value={indicatorType} disabled={busy} onChange={e=>setIndicatorType(e.target.value as HuntIndicator["kind"])}><option value="ip">IP address</option><option value="cidr">CIDR range</option><option value="key">Access key ID</option><option value="event">Event ID</option><option value="arn">ARN</option></select></label>
        <label>Value <input aria-label="Indicator value" value={indicatorValue} disabled={busy} maxLength={16384} onChange={e=>setIndicatorValue(e.target.value)} placeholder="Enter the selected type's value"/></label>
        <button className="btn-ghost btn-sm" disabled={busy||!canAddIndicator} onClick={()=>{appendIndicator(`${indicatorType} ${indicatorValue.trim()}`);setIndicatorValue("")}}>Add indicator</button>
      </div>
      <div className="hunt-format-examples"><span>Bulk format examples</span><code>ip 192.0.2.1<br/>cidr 2001:db8::/32<br/>key ASIAEXAMPLE<br/>event event-id<br/>arn arn:aws:s3:::example-bucket</code><button className="btn-ghost btn-sm" disabled={busy||text.length+16>256000} onClick={()=>appendIndicator("ip 192.0.2.1")}>Add example indicator</button></div>
      <label className="hunt-input">Typed indicators <textarea aria-label="Typed indicators" value={text} disabled={busy} maxLength={256000} onChange={e=>setText(e.target.value)} spellCheck={false} placeholder={'ip 192.0.2.1\ncidr 2001:db8::/32\nkey ASIAEXAMPLE\nevent event-id\narn arn:aws:s3:::example-bucket'}/><span>One type and value per line · up to 100 · IPv4 and IPv6 supported · IDs and ARNs are exact matches</span></label></>:<div className="hunt-sequence-controls">
      <div className="hunt-sequence-starter"><button className="btn-ghost btn-sm" disabled={busy||steps.some(step=>!!step.trim())} onClick={()=>{setSteps(['eventName="ConsoleLogin"','eventName="GetObject"']);setGroup("principal");setMinutes(15)}}>Load sequence example</button><span>ConsoleLogin → GetObject · same principal ARN · within 15 minutes. Fills empty steps only; does not run.</span></div>
      {steps.map((step,index)=><div className="hunt-sequence-step" key={index}>
        <label className="hunt-input">Step {stepLabel(index)} · {index===0?"earlier search":index===steps.length-1?"later search":"next search"}<input aria-label={`Step ${stepLabel(index)} search`} value={step} disabled={busy} maxLength={16384} onChange={e=>setStep(index,e.target.value)} placeholder={`eventName="${index===0?"First":index===1?"Second":"Next"}Operation"`}/></label>
        <button className="btn-ghost btn-sm" aria-label={`Remove step ${stepLabel(index)}`} disabled={busy||steps.length<=2} onClick={()=>setSteps(current=>current.length>2?current.filter((_,i)=>i!==index):current)}>Remove</button>
      </div>)}
      <div className="hunt-sequence-actions"><button className="btn-ghost btn-sm" disabled={busy||steps.length>=5} onClick={()=>setSteps(current=>current.length<5?[...current,""]:current)}>Add step</button><span>{steps.length} of 5 steps · all steps must match in order</span></div>
      <div className="analysis-controls"><label>Group by <select aria-label="Sequence grouping" disabled={busy} value={group} onChange={e=>setGroup(e.target.value as HuntOptions["group"])}><option value="credential">Same access key and principal ARN</option><option value="principal">Same principal ARN</option></select></label><label>Complete sequence within <select aria-label="Sequence interval" disabled={busy} value={minutes} onChange={e=>setMinutes(Number(e.target.value))}>{[...new Set([1,5,15,60,1440,minutes])].sort((a,b)=>a-b).map(n=><option key={n} value={n}>{n===1440?"24 hours":`${n} minutes`}</option>)}</select></label></div>
      <p className="hunt-sequence-rules">Each step must be strictly later than the previous step. At each stage, select the closest completed prefix. The complete first-to-last interval must fit the selected window. Each final event has one representative sequence.</p>
    </div>}
    <div className="analysis-scope">{useFilter?`Scope: ${fixedMode?"current event":"console"} filters, including time bounds, apply to every step.`:savedFilter?"Scope: saved filters. Filter values and absolute time bounds are fixed until you change scope.":"Scope: all loaded evidence."} Runs on request. Matches are investigative context.</div>
    {savedFilter&&!useFilter&&<div className="saved-hunt-scope"><details><summary>Saved filter scope</summary><pre>{JSON.stringify(savedFilter,null,2)}</pre></details><div className="saved-hunt-actions"><button className="btn-ghost btn-sm" disabled={busy} onClick={()=>{setSavedFilter(null);setUseFilter(true)}}>Use current {fixedMode?"event":"console"} filters</button><button className="btn-ghost btn-sm" disabled={busy} onClick={()=>{setSavedFilter(null);setUseFilter(false)}}>Clear saved scope</button></div></div>}
    {validation&&<div className="hunt-validation">{validation}</div>}
    </div>
    <div className="hunt-output">
    {result&&applied!==signature&&<div className="analysis-notice" role="status">Inputs changed. Results below use the previous hunt; run again to apply changes.</div>}
    {busy?<div className="analysis-empty" role="status">Searching evidence snapshot…</div>:error?<div className="analysis-empty" role="alert">{error}</div>:result&&<>
      <div className="analysis-result-head"><strong>{result.total.toLocaleString()} {resultMode==="indicators"?"matched events":result.total===1?"sequence":"sequences"} · {result.scanned.toLocaleString()} events in scope</strong><span>Snapshot {new Date(result.snapshot.capturedAt).toLocaleString()}</span></div>
      {resultMode==="indicators"&&<details className="hunt-counts"><summary>Matches per indicator ({result.indicators.length})</summary>{result.indicators.map((indicator,i)=><div key={i}><code>{indicator.kind} {indicator.value}</code><b>{indicator.matches.toLocaleString()}</b></div>)}</details>}
      {resultMode==="sequence"&&<div className="analysis-scope">Strict recorded-time order · one closest completed sequence per final event. Across events in scope: {result.invalidTimes.toLocaleString()} have no usable time · {result.missingPrincipal.toLocaleString()} have no principal ARN · {(result.missingCredential??0).toLocaleString()} have no access key. These counts can overlap. Principal grouping requires an ARN; credential grouping also requires a key.</div>}
      {rows.length?<div className="hunt-results"><div className="hunt-list" ref={scroll} role="list" aria-label="Hunt results"><div style={{height:virtual.getTotalSize(),position:"relative"}}>{virtual.getVirtualItems().map(v=>{
        const row=rows[v.index],first=row.events[0],last=row.events[row.events.length-1];
        return <button role="listitem" key={v.index} className={`hunt-card ${selected===v.index?"selected":""}`} style={{height:v.size,transform:`translateY(${v.start}px)`}} onClick={()=>{setSelected(v.index);setSelectedStep(0);rawRequest.current++;setRawBusy(false);setRawError("")}}>
          <strong title={row.events.map(event=>event.eventName).join(" → ")}>{first.eventName}{row.events.length>1?` → ${last.eventName}`:""}</strong>
          <time>{first.eventTime}{row.events.length>1?` → ${last.eventTime}`:""}</time>
          <span>{first.identityArn||"Principal not recorded"}</span>
          <small>{row.summary||row.detail.slice(0,2).join(" · ")}{resultMode==="indicators"&&row.detail.length>2?` · +${row.detail.length-2} more`:""}</small>
        </button>;
      })}</div></div>
        {inspector?<div className="hunt-inspection"><div className="hunt-match-context"><strong>{chosen?.label}</strong>{chosen?.detail.map((reason,i)=><span key={i}>{reason}</span>)}{resultMode==="sequence"&&<div className="hunt-step-picks">{chosen?.events.map((event,i)=><button key={i} className="btn-ghost btn-sm" aria-label={`Inspect step ${stepLabel(i)}`} aria-pressed={selectedStep===i} onClick={()=>setSelectedStep(i)}>{stepLabel(i)} · {event.eventName}</button>)}</div>}</div>{selectedStep!==null&&chosen?.events[selectedStep]&&<HuntResultInspector key={`${result.snapshot.generation}:${result.snapshot.maxSeq}:${chosen.events[selectedStep].seq}`} {...inspector} row={chosen.events[selectedStep]} snapshot={result.snapshot} onClose={()=>setSelectedStep(null)}/>}</div>:<aside className="hunt-detail"><h2>{chosen?.label}</h2>{chosen?.detail.map((reason,i)=><p key={i}>{reason}</p>)}{rawError&&<div role="alert">{rawError}</div>}{chosen?.events.map((event,i)=><section key={`${event.seq}-${i}`}><h3>{resultMode==="sequence"?`${stepLabel(i)} · `:""}{event.eventName}</h3><p>{event.eventSource}</p><p>{event.eventTime}</p><code>{event.eventID}</code><div><button className="btn-ghost btn-sm" disabled={rawBusy} onClick={()=>void original(event)}>Original {resultMode==="sequence"?stepLabel(i):"record"}</button><button className="btn-ghost btn-sm" onClick={()=>setInvestigation(rowToEvent(event))}>Investigate {resultMode==="sequence"?stepLabel(i):"event"}</button></div></section>)}</aside>}
      </div>:<div className="analysis-empty">No matches in this evidence snapshot.</div>}
      <div className="analysis-scope">Showing {rows.length.toLocaleString()} of {result.total.toLocaleString()} results{result.total>result.limit?". Narrow the search to inspect the rest.":"."}</div>
      <details className="analysis-notes"><summary>Matching rules and limitations</summary>{result.notes.map(note=><p key={note}>{note}</p>)}</details>
    </>}
    {!result&&!busy&&!error&&<div className="analysis-empty">{mode==="indicators"?"Enter typed indicators":"Define two to five ordered steps"}, choose a scope, then run the hunt. No search runs automatically.</div>}
    </div>
    {raw&&<RawJsonModal title={raw.title} json={raw.json} onClose={()=>setRaw(null)}/>}
    {investigation&&result&&<InvestigationView event={investigation} initialSnapshot={result.snapshot} onClose={()=>setInvestigation(null)}/>}
  </div>;
}
