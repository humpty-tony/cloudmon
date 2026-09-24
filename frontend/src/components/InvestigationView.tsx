import {useEffect, useRef, useState} from "react";
import {createPortal} from "react-dom";
import {useVirtualizer} from "@tanstack/react-virtual";
import {backend} from "../api/backend";
import type {CloudTrailEvent, EvidenceSnapshot, InvestigationResult} from "../api/types";
import {RawJsonModal} from "./RawJsonModal";

type Anchor = {seq:number;eventID:string;eventName:string};
type Match = InvestigationResult["events"][number];
const relationships = [["all","All nearby events"],["related","Related events"],["shared","Shared AWS action"],["credential","Matching credential"],["resources","Shared resource ARN"],["principal","Same principal (context)"],["ip","Same IP (context)"],["request","Same scoped request ID"]];
function offset(ms:number){if(!ms)return "0s";const seconds=Math.abs(ms)/1000;return `${ms<0?"−":"+"}${seconds>=60?`${(seconds/60).toFixed(1)}m`:`${seconds.toFixed(1)}s`}`}

export function InvestigationView({event,onClose}:{event:CloudTrailEvent;onClose:()=>void}) {
  const [anchor,setAnchor]=useState<Anchor>(event);
  const [history,setHistory]=useState<Anchor[]>([]);
  const [minutes,setMinutes]=useState(5);
  const [relation,setRelation]=useState("all");
  const [reload,setReload]=useState(0);
  const [result,setResult]=useState<InvestigationResult|null>(null);
  const [selected,setSelected]=useState<Match|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [raw,setRaw]=useState<{title:string;json:string}|null>(null);
  const [rawBusy,setRawBusy]=useState(false);
  const [rawError,setRawError]=useState("");
  const snapshot=useRef<EvidenceSnapshot|null>(null);
  const queue=useRef<Promise<void>>(Promise.resolve());
  const request=useRef(0);
  const rawRequest=useRef(0);
  const closeRef=useRef<HTMLButtonElement>(null);
  const scrollRef=useRef<HTMLDivElement>(null);
  const rows=result?.events??[];
  const virtual=useVirtualizer({count:rows.length,getScrollElement:()=>scrollRef.current,estimateSize:()=>82,overscan:5});
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;closeRef.current?.focus();
    return ()=>{rawRequest.current++;previous?.focus()};
  },[]);
  useEffect(()=>{
    const onKey=(e:KeyboardEvent)=>{if(e.key==="Escape"&&!raw){e.stopImmediatePropagation();onClose()}};
    window.addEventListener("keydown",onKey,true);return ()=>window.removeEventListener("keydown",onKey,true);
  },[onClose,raw]);
  useEffect(()=>{
    const controller=new AbortController(),id=++request.current;
    rawRequest.current++;setRaw(null);setRawBusy(false);setRawError("");setSelected(null);setResult(null);setLoading(true);setError("");
    const run=async()=>{
      if(controller.signal.aborted)return;
      try{
        const next=await backend.investigate({seq:anchor.seq,eventID:anchor.eventID,minutes,relation,snapshot:snapshot.current},controller.signal);
        if(controller.signal.aborted||id!==request.current)return;
        snapshot.current=next.snapshot;setResult(next);setSelected(next.events.find(r=>r.event.seq===anchor.seq)??null);
      }catch(e){if(!controller.signal.aborted&&id===request.current)setError(String(e))}
      finally{if(!controller.signal.aborted&&id===request.current)setLoading(false)}
    };
    queue.current=queue.current.then(run,run);
    return ()=>controller.abort();
  },[anchor,minutes,relation,reload]);
  useEffect(()=>{if(result)virtual.measure()},[result]);
  const center=(item:Match)=>{setHistory(h=>[...h,anchor].slice(-20));setAnchor(item.event);setRelation("all")};
  const showRaw=async()=>{
    if(!selected||!result)return;
    const id=++rawRequest.current;setRawBusy(true);setRawError("");
    try{
      const json=await backend.queryLineageRaw(selected.event.seq,result.snapshot);
      if(id===rawRequest.current)setRaw({title:`${selected.event.eventName} · ${selected.event.eventID}`,json});
    }catch(e){if(id===rawRequest.current)setRawError(String(e))}
    finally{if(id===rawRequest.current)setRawBusy(false)}
  };
  const choose=(item:Match)=>{rawRequest.current++;setRawBusy(false);setRawError("");setSelected(item)};
  return createPortal(<><div className="investigation-scrim" onClick={onClose}>
    <section className="investigation" role="dialog" aria-modal="true" aria-label="Event investigation" onClick={e=>e.stopPropagation()}>
      <header className="investigation-head">
        <div><h2>Event investigation</h2><div className="investigation-sub">{anchor.eventName} · {anchor.eventID}</div></div>
        {history.length>0&&<button onClick={()=>{setAnchor(history[history.length-1]);setHistory(h=>h.slice(0,-1))}}>← Back</button>}
        <button ref={closeRef} onClick={onClose} aria-label="Close investigation">✕ Close</button>
      </header>
      <div className="investigation-controls">
        <label>Window <select aria-label="Investigation window" value={minutes} onChange={e=>setMinutes(Number(e.target.value))}>{[1,5,15,60].map(n=><option key={n} value={n}>±{n} minute{n===1?"":"s"}</option>)}</select></label>
        <label>Relationship <select aria-label="Investigation relationship" value={relation} onChange={e=>setRelation(e.target.value)}>{relationships.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        <span>Scope: all recorded evidence in this window</span>
        <button onClick={()=>{snapshot.current=null;setReload(n=>n+1)}}>Refresh snapshot</button>
      </div>
      {loading?<div className="investigation-status" role="status">Loading investigation…</div>:error?<div className="investigation-status" role="alert">{error}<button onClick={()=>setReload(n=>n+1)}>Retry investigation</button></div>:result&&<>
        <div className="investigation-summary">
          <strong>{result.total.toLocaleString()} event{result.total===1?"":"s"}</strong><span>including the selected event · {new Date(result.fromMs).toISOString()} — {new Date(result.toMs).toISOString()}</span>
          <span>Snapshot {new Date(result.snapshot.capturedAt).toLocaleTimeString()}</span>
        </div>
        <div className="investigation-body">
          <div className="investigation-timeline">
            <div className="investigation-list" ref={scrollRef} role="list" aria-label="Surrounding events">
              <div style={{height:virtual.getTotalSize(),position:"relative"}}>
                {virtual.getVirtualItems().map(v=>{const item=rows[v.index],e=item.event;return <button key={e.seq} role="listitem" className={`investigation-event ${selected?.event.seq===e.seq?"selected":""} ${e.seq===anchor.seq?"anchor":""}`} style={{height:v.size,transform:`translateY(${v.start}px)`}} onClick={()=>choose(item)}>
                  <span className="investigation-offset">{offset(item.deltaMs)}</span>
                  <span className="investigation-event-main"><b>{e.eventName}</b><span>{e.eventSource} · {e.userName||e.identityArn||e.identityType||"Identity not recorded"}</span><span className="investigation-tags">{item.reasons.slice(0,2).map((r,i)=><span key={i} className={`relation-${r.kind}`}>{r.label}</span>)}{item.reasons.length>2&&<span>+{item.reasons.length-2} more</span>}</span></span>
                  {e.errorCode&&<span className="investigation-failure">{e.errorCode}</span>}
                </button>})}
              </div>
            </div>
            {result.total>result.events.length&&<div className="investigation-cap">Showing {result.events.length} closest events of {result.total.toLocaleString()}. Narrow the window or relationship.</div>}
          </div>
          <aside className="investigation-detail">
            {selected&&<section><h3>{selected.event.eventName}</h3><p className="investigation-sub">{selected.event.eventTime}</p><h4>Why this event is shown</h4>
              <ul>{selected.reasons.map((r,i)=><li key={i}><b>{r.label}</b>{r.value&&<code>{r.value}</code>}</li>)}</ul>
              <div className="investigation-actions"><button onClick={showRaw} disabled={rawBusy}>{rawBusy?"Loading record…":"Open original record"}</button>{selected.event.seq!==anchor.seq&&<button onClick={()=>center(selected)}>Center on this event</button>}</div>
              {rawError&&<p role="alert">{rawError}</p>}
            </section>}
            <section><h3>Anchor resource references</h3>{result.resources.length===0?<p>No complete resource ARNs recorded.</p>:<ul className="investigation-resources">{result.resources.map((r,i)=><li key={i}><code>{r.arn}</code><span>{r.kind||"Recorded ARN"} · {r.source}</span></li>)}</ul>}{result.resourcesTruncated&&<p>First 100 references shown.</p>}</section>
          </aside>
        </div>
        <details className="investigation-notes"><summary>Evidence and coverage notes</summary>{result.notes.map((note,i)=><p key={i}>{note}</p>)}</details>
      </>}
    </section>
  </div>
    {raw&&<RawJsonModal title={raw.title} json={raw.json} onClose={()=>setRaw(null)} />}
  </>,document.body);
}
