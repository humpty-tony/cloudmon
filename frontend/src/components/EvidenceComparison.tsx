import {createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode} from "react";
import {createPortal} from "react-dom";
import {useVirtualizer} from "@tanstack/react-virtual";
import type {CloudTrailEvent} from "../api/types";
import {COMPARE_MAX_CHARS,COMPARE_SIZE_ERROR} from "../api/compareLimits";
import type {ComparisonResult} from "../api/compareModel";
import {RawJsonModal} from "./RawJsonModal";

type Pinned = {eventID:string;eventName:string;eventTime:string;json:string};
interface ComparisonState {pins:Pinned[];pin:(event:CloudTrailEvent,json:string)=>void;remove:(index:number)=>void;clear:()=>void;swap:()=>void;show:()=>void}
const ComparisonContext=createContext<ComparisonState|null>(null);
function useComparison(){const value=useContext(ComparisonContext);if(!value)throw Error("Comparison provider is unavailable");return value}
export function EvidenceComparisonProvider({children}:{children:ReactNode}){
  const [pins,setPins]=useState<Pinned[]>([]),[open,setOpen]=useState(false);
  const value=useMemo<ComparisonState>(()=>({pins,
    pin:(event,json)=>setPins(prev=>{
      if(prev.some(p=>p.eventID===event.eventID&&p.json===json))return prev;
      const next={eventID:event.eventID,eventName:event.eventName,eventTime:event.eventTime,json};
      return prev.length<2?[...prev,next]:[prev[0],next];
    }),
    remove:index=>{setOpen(false);setPins(prev=>prev.filter((_,i)=>i!==index))},
    clear:()=>{setOpen(false);setPins([])},swap:()=>setPins(prev=>prev.length===2?[prev[1],prev[0]]:prev),show:()=>setOpen(true),
  }),[pins]);
  return <ComparisonContext.Provider value={value}>{children}{open&&pins.length===2&&<ComparisonView left={pins[0]} right={pins[1]} onClose={()=>setOpen(false)} onSwap={value.swap}/>}</ComparisonContext.Provider>;
}
export function PinComparisonButton({event,json}:{event:CloudTrailEvent;json:string}){
  const {pins,pin}=useComparison();
  const index=pins.findIndex(p=>p.eventID===event.eventID&&p.json===json);
  const label=index>=0?`Pinned as ${index===0?"A":"B"}`:pins.length===0?"Pin event A":pins.length===1?"Pin event B":"Replace event B";
  return <button className="xd-raw-btn" disabled={index>=0} onClick={()=>pin(event,json)}>{label}</button>;
}
export function ComparisonBar(){
  const {pins,remove,clear,swap,show}=useComparison();
  if(!pins.length)return null;
  return <div className="comparison-bar" aria-label="Pinned evidence">
    <span>Pinned source copies</span>
    {pins.map((p,i)=><div className="comparison-pin" key={i}><b>{i===0?"A":"B"}</b><span title={`${p.eventName} · ${p.eventID}`}>{p.eventName} · {p.eventID}</span><button onClick={()=>remove(i)} aria-label={`Remove event ${i===0?"A":"B"}`}>×</button></div>)}
    {pins.length===1&&<span>Pin another event to compare.</span>}
    <button disabled={pins.length<2} onClick={show}>Compare events</button>
    <button disabled={pins.length<2} onClick={swap}>Swap A/B</button>
    <button onClick={clear}>Clear pins</button>
  </div>;
}
function ComparisonView({left,right,onClose,onSwap}:{left:Pinned;right:Pinned;onClose:()=>void;onSwap:()=>void}){
  const [result,setResult]=useState<ComparisonResult|null>(null),[error,setError]=useState(""),[retry,setRetry]=useState(0);
  const [raw,setRaw]=useState<Pinned|null>(null);
  const close=useRef<HTMLButtonElement>(null),scroll=useRef<HTMLDivElement>(null);
  const changes=result?.changes??[];
  const virtual=useVirtualizer({count:changes.length,getScrollElement:()=>scroll.current,estimateSize:()=>115,overscan:4});
  useEffect(()=>{const previous=document.activeElement as HTMLElement|null;close.current?.focus();return ()=>previous?.focus()},[]);
  useEffect(()=>{const onKey=(e:KeyboardEvent)=>{if(e.key==="Escape"&&!raw){e.stopImmediatePropagation();onClose()}};window.addEventListener("keydown",onKey,true);return()=>window.removeEventListener("keydown",onKey,true)},[onClose,raw]);
  useEffect(()=>{
    setResult(null);setError("");
    let active=true,worker:Worker|undefined;
    const finish=(message:string)=>{if(!active)return;active=false;setError(message);worker?.terminate();clearTimeout(timer)};
    const timer=setTimeout(()=>finish("Comparison took too long. Retry or inspect the original records."),15000);
    try{
      if(left.json.length>COMPARE_MAX_CHARS||right.json.length>COMPARE_MAX_CHARS)throw Error(COMPARE_SIZE_ERROR);
      worker=new Worker(new URL("../api/compare.worker.ts",import.meta.url),{type:"module"});
      worker.onmessage=({data}:MessageEvent<{result?:ComparisonResult;error?:string}>)=>{if(!active)return;active=false;clearTimeout(timer);worker?.terminate();if(data.result)setResult(data.result);else setError(data.error||"Could not compare these records.")};
      worker.onerror=e=>{e.preventDefault();finish("Could not compare these records. Retry or inspect the originals.")};
      worker.onmessageerror=()=>finish("Could not read the comparison result.");
      worker.postMessage({left:left.json,right:right.json});
    }catch(e){finish(String(e))}
    return()=>{active=false;clearTimeout(timer);worker?.terminate()};
  },[left.json,right.json,retry]);
  useEffect(()=>{if(result)virtual.measure()},[result]);
  return createPortal(<>
    <div className="comparison-scrim" onClick={onClose}>
      <section className="comparison-dialog" role="dialog" aria-modal="true" aria-label="Compare original records" onClick={e=>e.stopPropagation()} onKeyDown={e=>{
        if(e.key!=="Tab")return;const items=Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),[tabindex="0"]'));const first=items[0],last=items[items.length-1];
        if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}
      }}>
        <header><div><h2>Compare original records</h2><span>Source copies kept until cleared or the app closes.</span></div><button onClick={onSwap}>Swap A/B</button><button ref={close} onClick={onClose} aria-label="Close comparison">✕ Close</button></header>
        <div className="comparison-sources">{[left,right].map((p,i)=><div key={i}><b>{i===0?"A":"B"} · {p.eventName}</b><code>{p.eventID}</code><span>{p.eventTime}</span><button onClick={()=>setRaw(p)}>Open original {i===0?"A":"B"}</button></div>)}</div>
        {error?<div className="comparison-status" role="alert">{error}<button onClick={()=>setRetry(n=>n+1)}>Retry comparison</button></div>:!result?<div className="comparison-status" role="status">Comparing records…</div>:<>
          <div className={`comparison-summary ${result.complete?"":"partial"}`} role="status">{result.complete?(changes.length?`${changes.length} field difference${changes.length===1?"":"s"}`:"No field differences"):`${changes.length} differences found · comparison incomplete`}</div>
          <div className="comparison-columns"><span>Field / change</span><span>A</span><span>B</span></div>
          <div className="comparison-changes" ref={scroll}>
            <div style={{height:virtual.getTotalSize(),position:"relative"}}>{virtual.getVirtualItems().map(v=>{const change=changes[v.index];return <div key={v.index} className="comparison-change" style={{height:v.size,transform:`translateY(${v.start}px)`}}>
              <div><code title={change.path}>{change.path}{change.pathTruncated?"… (path truncated)":""}</code><span className={`change-${change.change}`}>{change.change}</span></div>
              {[change.left,change.right].map((value,i)=><div key={i}><span className="comparison-kind">{value.kind}</span><pre>{value.text}{value.truncated?"… (preview)":""}</pre></div>)}
            </div>})}</div>
          </div>
          <div className="comparison-notes">{result.notes.map((note,i)=><p key={i}>{note}</p>)}</div>
        </>}
      </section>
    </div>
    {raw&&<RawJsonModal title={`${raw.eventName} · ${raw.eventID}`} json={raw.json} onClose={()=>setRaw(null)}/>}
  </>,document.body);
}
