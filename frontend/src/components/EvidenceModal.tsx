import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { backend } from "../api/backend";
import type { EvidencePage, EvidenceSnapshot, SourceEvidence } from "../api/types";
import { SourceText } from "./SourceText";
import { WorkspaceOverlay } from "./WorkspaceActivity";

type Props = { seq: number; snapshot?:EvidenceSnapshot; onClose: () => void };
export function EvidenceModal(props: Props) {
  return <WorkspaceOverlay onClose={props.onClose}><EvidenceContent {...props}/></WorkspaceOverlay>;
}

function EvidenceContent({ seq, snapshot, onClose }: Props) {
  const [page, setPage] = useState<EvidencePage | null>(null);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState("");
  const [source, setSource] = useState<{ meta: SourceEvidence; text: string } | null>(null);
  const [loadingSource, setLoadingSource] = useState(false);
  const [retry, setRetry] = useState(0);
  const request = useRef(0);
  const original = useRef<HTMLElement>(null);
  const modal = useRef<HTMLElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  useLayoutEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    const host=modal.current?.parentElement;
    const background=Array.from(document.body.children)
      .filter((element):element is HTMLElement=>element instanceof HTMLElement && element!==host)
      .map(element=>({element,inert:element.inert}));
    for(const {element} of background)element.inert=true;
    close.current?.focus({preventScroll:true});
    return ()=>{
      for(const {element,inert} of background)element.inert=inert;
      if(previous?.isConnected && !previous.closest('[hidden],[inert]') && previous.getClientRects().length)
        previous.focus({preventScroll:true});
    };
  },[]);
  useEffect(()=>{if(source){original.current?.focus({preventScroll:true});original.current?.scrollIntoView({block:"nearest"})}},[source]);
  useEffect(() => {
    let alive = true;
    setError(""); setPage(null); setSource(null); setLoadingSource(false); request.current++;
    backend.getEventEvidence(seq, offset,snapshot).then(result=>{if(alive)setPage(result)}).catch(e=>{if(alive)setError(String(e))});
    return ()=>{alive=false;request.current++};
  }, [seq, offset, retry,snapshot]);
  useEffect(()=>{
    const onKey=(event: KeyboardEvent)=>{if(event.key === "Escape"){event.stopImmediatePropagation();onClose()}};
    window.addEventListener("keydown",onKey,true);
    return ()=>window.removeEventListener("keydown",onKey,true);
  },[onClose]);
  const view = async(meta: SourceEvidence)=>{
    const token=++request.current;setLoadingSource(true);setSource(null);setError("");
    try {const text=await backend.getObservation(meta.id,snapshot);if(token===request.current)setSource({meta,text})}
    catch(e){if(token===request.current)setError(String(e))}
    finally{if(token===request.current)setLoadingSource(false)}
  };
  return createPortal(<div className="rawmodal-scrim" onClick={onClose}>
    <section ref={modal} className="rawmodal evidence-modal" role="dialog" aria-modal="true" aria-label="Source evidence" onClick={e=>e.stopPropagation()} onKeyDown={event=>{
      if(event.key!=="Tab")return;
      const controls=Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])'))
        .filter(element=>element.getClientRects().length && !element.closest('[hidden],[inert]'));
      const first=controls[0],last=controls[controls.length-1];
      const current=document.activeElement as HTMLElement|null;
      // The loaded source section receives tabindex=-1 focus; it is not one
      // of the sequential controls, so contain that starting point as well.
      if(!current || !controls.includes(current) || (event.shiftKey?current===first:current===last)){
        event.preventDefault();(event.shiftKey?last:first)?.focus({preventScroll:true});
      }
    }}>
      <div className="rawmodal-head"><h2>Source evidence</h2><button ref={close} className="icon-btn" aria-label="Close source evidence" onClick={onClose}>✕</button></div>
      <div className="evidence-body">
        <p>The event list displays the first observed record. Each import or capture commit retains its source bytes and SHA-256 hash. Repeated observations can include redeliveries or retries.</p>
        {page && <>
          <div className="evidence-summary">{page.total.toLocaleString()} observations · {page.variants.toLocaleString()} distinct source hashes</div>
          {page.variants>1 && <p className="recovery-warning">Different source bytes are present. Inspect the originals before drawing conclusions; formatting differences also change the hash.</p>}
          <div className="evidence-list">{page.observations.map(ob=><article key={ob.id} className="evidence-item">
            <div className="evidence-item-head"><b>{ob.format}</b><span>{ob.displayed ? "Matches displayed record" : "Different source bytes"}</span>{ob.lossy && <strong className="recovery-warning">Lossy CSV projection</strong>}<button className="btn-ghost" onClick={()=>view(ob)}>View source #{ob.id}</button></div>
            <div className="evidence-source">{ob.source} · record {ob.ordinal}</div>
            <code className="evidence-hash">SHA-256 {ob.sha256}</code>
            {ob.observedAt && <time>{new Date(ob.observedAt).toLocaleString()}</time>}
          </article>)}</div>
          {page.total>25 && <div className="recovery-actions"><button className="btn-ghost" disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-25))}>Previous sources</button><span>{offset+1}–{Math.min(offset+25,page.total)} of {page.total}</span><button className="btn-ghost" disabled={offset+25>=page.total} onClick={()=>setOffset(offset+25)}>Next sources</button></div>}
        </>}
        {!page && !error && <p role="status">Loading source observations…</p>}
        {error && <div role="alert" className="recovery-warning">{error} <button className="btn-ghost" onClick={()=>setRetry(n=>n+1)}>Retry</button></div>}
        {loadingSource && <p role="status">Loading source record…</p>}
        {source && <section ref={original} tabIndex={-1} aria-label="Original source record" className="evidence-original">
          <h3>Original source #{source.meta.id}</h3>
          {source.meta.lossy && <p className="recovery-warning">CSV includes only exported columns. This is the original header and row; missing CloudTrail fields cannot be reconstructed.</p>}
          <SourceText text={source.text} />
        </section>}
        <p className="evidence-footnote">Hashes identify the saved bytes; they do not verify CloudTrail signatures or authenticate the source. JSON evidence preserves the event object, not its surrounding delivery envelope.</p>
      </div>
    </section>
  </div>,document.body);
}
