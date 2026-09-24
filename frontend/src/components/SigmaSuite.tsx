import {useEffect, useRef, useState} from "react";
import {backend, type SigmaOutcome, type SigmaSuiteOutcome} from "../api/backend";
import {BUNDLED_RULES, type SigmaRuleEntry} from "../api/sigmaRules";

export function SigmaSuite({saved,onOpen}:{saved:SigmaRuleEntry[];onOpen:(yaml:string,result:SigmaOutcome)=>void}) {
 const entries=[...BUNDLED_RULES.map(r=>({...r,key:`Example: ${r.name}`})),...saved.map(r=>({...r,key:`Saved: ${r.name}`}))];
 const [chosen,setChosen]=useState(()=>new Set(BUNDLED_RULES.map(r=>`Example: ${r.name}`)));
 const [result,setResult]=useState<SigmaSuiteOutcome|null>(null);
 const [error,setError]=useState("");const [running,setRunning]=useState(false);
 const controller=useRef<AbortController|null>(null);
 const sources=useRef(new Map<string,string>());
 useEffect(()=>()=>controller.current?.abort(),[]);
 const cancel=()=>{controller.current?.abort();controller.current=null;setRunning(false)};
 const toggle=(key:string)=>{cancel();setResult(null);setError("");setChosen(old=>{const next=new Set(old);if(next.has(key))next.delete(key);else if(next.size<25)next.add(key);return next})};
 const run=async()=>{
  if(controller.current)return;
  const selected=entries.filter(r=>chosen.has(r.key));if(!selected.length)return;
  const abort=new AbortController();controller.current=abort;setRunning(true);setResult(null);setError("");
  sources.current=new Map(selected.map(r=>[r.key,r.yaml]));
  try {const r=await backend.sigmaSuite(selected.map(r=>({name:r.key,yaml:r.yaml})),abort.signal);if(controller.current===abort)setResult(r)}
  catch(e){if(controller.current===abort&&!abort.signal.aborted)setError(String(e))}
  finally{if(controller.current===abort){controller.current=null;setRunning(false)}}
 };
 return <section className="sigma-suite" aria-label="Sigma rule suite">
  <div className="sg-suite-pick">
   <div className="sg-suite-heading"><h3>Choose rules</h3><span>{chosen.size} / 25 selected</span></div>
   <p>Run examples and saved rules against one snapshot. Each rule keeps its own diagnostics and up to 100 matching events.</p>
   <div className="sg-suite-choices">{entries.map(entry=><label key={entry.key}><input type="checkbox" checked={chosen.has(entry.key)} disabled={!chosen.has(entry.key)&&chosen.size>=25} onChange={()=>toggle(entry.key)} /><span>{entry.name}<small>{entry.key.startsWith("Example:")?"Bundled example":"Saved locally"}</small></span></label>)}</div>
   <div className="sg-suite-actions"><button className="btn-primary" onClick={run} disabled={running||!chosen.size}>{running?"Running rules…":"Run selected rules"}</button>{running&&<button className="btn-ghost" onClick={cancel}>Cancel suite</button>}</div>
  </div>
  <div className="sg-suite-results" aria-live="polite">
   {error&&<p className="sg-diag err" role="alert">{error}</p>}
   {!result&&!error&&<p className="sg-empty">{running?"Evaluating the selected rules…":"Choose rules and run the suite to compare matches."}</p>}
   {result&&<><div className="sg-suite-heading"><h3>Suite results</h3><span>{result.results.filter(r=>r.result.supported).length} / {result.results.length} rules ran</span></div><p>Snapshot through event {result.snapshot.maxSeq.toLocaleString()} · {result.snapshot.capturedAt}. Matches can overlap across rules.</p>
   {result.results.map(({name,result:run})=><article key={name} className="sg-suite-result"><div><strong>{run.title||name}</strong><span className={`sg-pill ${run.supported?"valid":"unsupported"}`}>{run.supported?`${run.matches.toLocaleString()} matches`:"Not run"}</span></div>{run.diagnostics.map((d,i)=><p key={i} className={`sg-diag ${d.severity==="error"?"err":"warn"}`}>{d.message}</p>)}<button className="btn-ghost" onClick={()=>onOpen(sources.current.get(name)!,run)}>{run.supported?"Inspect results":"Open diagnostics"}</button></article>)}</>}
  </div>
 </section>;
}
