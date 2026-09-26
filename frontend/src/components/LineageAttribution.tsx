import {useEffect,useRef,useState} from 'react';
import {backend} from '../api/backend';
import {sourceName,type LineageAttribution,type Initiator} from '../api/attribution';
import type {EvidenceSnapshot,GraphEdge,GraphNode} from '../api/types';
import './LineageAttribution.css';

interface Props {seq:number;snapshot:EvidenceSnapshot;unresolved:boolean;report:LineageAttribution|null;onResult:(value:LineageAttribution)=>void}
export function LineageEnrichment({seq,snapshot,unresolved,report,onResult}:Props){
 const [ready,setReady]=useState(false),[working,setWorking]=useState(false),[details,setDetails]=useState(false),[error,setError]=useState('');
 const epoch=useRef(0),controller=useRef<AbortController|null>(null),active=useRef(true),resultRef=useRef(onResult);resultRef.current=onResult;
 useEffect(()=>{active.current=true;let valid=true;const loadEpoch=++epoch.current;
  backend.getLineageAttribution(seq,snapshot).then(value=>{if(valid&&value&&epoch.current===loadEpoch)resultRef.current(value)}).catch(e=>{if(valid&&epoch.current===loadEpoch)setError(`Saved attribution unavailable: ${String(e)}`)}).finally(()=>{if(valid)setReady(true)});
  return()=>{valid=false;active.current=false;controller.current?.abort()};
 },[seq,snapshot.generation,snapshot.maxSeq]);
 const resolve=async()=>{epoch.current++;const abort=new AbortController();controller.current=abort;setWorking(true);setError('');
  try{const value=await backend.resolveLineageAttribution(seq,snapshot,abort.signal);if(active.current&&!abort.signal.aborted)resultRef.current(value)}
  catch(e){if(active.current&&!abort.signal.aborted)setError(String(e))}
  finally{if(active.current){setWorking(false);controller.current=null}}
 };
 if(!unresolved&&!report&&!error)return null;
 return <section className="la-tools" aria-label="Dynamic lineage resolution">
  <div className="la-toolbar"><div className="la-message"><span className="la-heading">{working?'Resolving lineage…':unresolved?(report?'Lineage remains incomplete':'Lineage could not be fully resolved'):'Lineage context available'}</span>
   <span className="la-scope">{report?(unresolved?'Available sources did not establish a complete chain. Supported evidence is shown below.':'Resolved from available evidence—not proof of the physical operator.'):'Search cloud history and available identity sources using your AWS connection. Original evidence is cached locally.'}</span>
  </div><span className="lgv-spacer"/>
   {working?<button onClick={()=>{controller.current?.abort();setError('Lookup cancelled. Existing evidence is unchanged.')}}>Cancel lookup</button>:unresolved&&<button className="la-primary" disabled={!ready} onClick={()=>void resolve()}>Resolve lineage dynamically</button>}
  </div>
  {working&&<div role="status" className="la-progress">Checking cloud history and available identity sources…</div>}
  {error&&<div role="alert" className="la-error">{error}</div>}
  {report&&<><button className="la-details-toggle" aria-expanded={details} onClick={()=>setDetails(!details)}>{details?'Hide lookup details':'Show lookup details'}</button>
   {details&&<div className="la-coverage"><div className="la-scope">{report.cached?'Saved offline result':'Retrieved result'} · {report.result.fetchedAt} · directory metadata reflects retrieval time</div><div className="la-source-list">{report.result.sources.map((source,i)=><div key={i} className="la-source"><div className="la-source-heading">{sourceName(source.source)} · {source.status.replaceAll('-',' ').replaceAll('_',' ')}</div><div>{source.detail}</div>{(source.accountId||source.region)&&<div>Scope: {source.accountId||'account not established'} / {source.region||'Region not specified'}</div>}{source.from&&<div>{source.from} → {source.to}</div>}<div>{source.pages} lookup calls · {source.events} records examined</div></div>)}</div></div>}
  </>}
 </section>;
}

export function InitiatorFacts({value}:{value:Initiator}){return <dl className="la-facts"><dt>Source IP</dt><dd>{value.ip||'Not recorded'}</dd><dt>User agent</dt><dd>{value.userAgent||'Not recorded'}</dd><dt>Request time</dt><dd>{value.time||'Not recorded'}</dd><dt>Region</dt><dd>{value.region||'Not recorded'}</dd><dt>MFA attribute</dt><dd>{value.mfa===''?'Not recorded':`${value.mfa} · recorded by this event`}</dd>{value.eventId&&<><dt>Event ID</dt><dd>{value.eventId}</dd></>}</dl>}

export function LineageFindings({report,rootKey}:{report:LineageAttribution|null;rootKey:string}){
 if(!report)return null;
 const evidence=report.result.evidence.filter(item=>!(item.source==='cloudtrail'&&item.initiator?.eventId&&report.graph.edges.some(edge=>edge.viaEventId===item.initiator?.eventId))).sort((a,b)=>Number(b.nodeKey===rootKey)-Number(a.nodeKey===rootKey));
 return <section className="la-findings"><h3>Attribution evidence</h3>{evidence.length===0?<p>No additional identity evidence found in the queried sources.</p>:evidence.map((item,i)=><div className="la-finding" key={i}>
  <div className="la-evidence-source">{sourceName(item.source)} · {item.method.replaceAll('-',' ').replaceAll('_',' ')}</div>
  <div className="la-person">{item.displayName||item.userName||item.subjectId||'Evidence record'}</div>
  {item.email&&item.email!==item.displayName&&<div className="la-evidence-id">{item.email}</div>}
  <p>{item.description}</p>
  <details><summary>Identity &amp; provenance</summary><dl className="la-facts"><dt>Subject ID</dt><dd>{item.subjectId||'Not supplied'}</dd><dt>Session key</dt><dd>{item.nodeKey||'Not keyed'}</dd><dt>Observed at</dt><dd>{item.observedAt||'Not supplied'}</dd></dl></details>
  {item.initiator&&<details><summary>Supporting request metadata</summary><InitiatorFacts value={item.initiator}/></details>}
 </div>)}<p className="la-caveat">These records attribute credentials or directory identities—not the physical person operating them.</p></section>;
}

export function InitiationSummary({edge,parent,onOpen}:{edge?:GraphEdge;parent?:GraphNode;onOpen:(seq:number,title:string)=>void}){
 return <section className="la-initiation"><h3>First observed credential request</h3>{edge?<><div className="la-actor">{(parent?.identityType==='AssumedRole'?parent.sessionName||parent.roleName:parent?.userName)||parent?.arn||'Recorded caller'}</div><div className="la-scope">{parent?.identityType||'Identity'} · {edge.viaEvent}{edge.viaSeq<0?' · recovered history':' · loaded evidence'}</div><InitiatorFacts value={{ip:edge.viaIP,userAgent:edge.viaUserAgent??'',time:edge.viaTime,region:edge.viaRegion??'',mfa:edge.viaMfa??'',eventId:edge.viaEventId??''}}/><button onClick={()=>onOpen(edge.viaSeq,`${edge.viaEvent} · original issuance`)}>Open issuance event</button></>:<p>Issuance has not been recovered. The activity event's IP is not substituted for an unknown initiator.</p>}</section>;
}