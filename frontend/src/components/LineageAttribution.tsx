import {useEffect,useRef,useState} from 'react';
import {backend} from '../api/backend';
import {defaultAttributionConfig,sourceName,type AttributionConfig,type LineageAttribution,type Initiator} from '../api/attribution';
import type {EvidenceSnapshot,GraphEdge,GraphNode} from '../api/types';
import './LineageAttribution.css';

interface Props {seq:number;snapshot:EvidenceSnapshot;report:LineageAttribution|null;onResult:(value:LineageAttribution)=>void}
export function LineageEnrichment({seq,snapshot,report,onResult}:Props){
 const [config,setConfig]=useState<AttributionConfig>(defaultAttributionConfig);
 const [ready,setReady]=useState(false),[editing,setEditing]=useState(false),[working,setWorking]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState('');
 const savedConfig=useRef(defaultAttributionConfig),epoch=useRef(0);const [settingsChanged,setSettingsChanged]=useState(false);
 const controller=useRef<AbortController|null>(null),active=useRef(true),resultRef=useRef(onResult);resultRef.current=onResult;
 useEffect(()=>{active.current=true;let valid=true;const loadEpoch=++epoch.current;
  backend.getAttributionSettings().then(c=>{if(valid){savedConfig.current={...defaultAttributionConfig,...c,awsRegions:c.awsRegions??[],entraMappings:c.entraMappings??[]};setConfig(savedConfig.current);setReady(true)}}).catch(e=>{if(valid)setError(String(e))});
  backend.getLineageAttribution(seq,snapshot).then(value=>{if(valid&&value&&epoch.current===loadEpoch)resultRef.current(value)}).catch(e=>{if(valid&&epoch.current===loadEpoch)setError(`Saved attribution unavailable: ${String(e)}`)});
  return()=>{valid=false;active.current=false;controller.current?.abort()};
 },[seq,snapshot.generation,snapshot.maxSeq]);
 const resolve=async()=>{epoch.current++;const abort=new AbortController();controller.current=abort;setWorking(true);setError('');
  try{const value=await backend.resolveLineageAttribution(seq,snapshot,abort.signal);if(active.current&&!abort.signal.aborted){resultRef.current(value);setSettingsChanged(false)}}
  catch(e){if(active.current&&!abort.signal.aborted)setError(String(e))}
  finally{if(active.current){setWorking(false);controller.current=null}}
 };
 const save=async()=>{setSaving(true);setError('');try{await backend.saveAttributionSettings(config);if(active.current){savedConfig.current=config;setEditing(false);setSettingsChanged(!!report)}}catch(e){if(active.current)setError(String(e))}finally{if(active.current)setSaving(false)}};
 const field=(key:keyof AttributionConfig,label:string,placeholder='')=><label>{label}<input value={String(config[key]??'')} placeholder={placeholder} onChange={e=>setConfig({...config,[key]:e.target.value})}/></label>;
 return <section className="la-tools" aria-label="Session attribution sources">
  <div className="la-toolbar"><div><span className="la-heading">Session attribution</span><span className="la-scope">Primary: CloudTrail · up to 90 days</span></div><span className="lgv-spacer"/>
   {working?<button onClick={()=>{controller.current?.abort();setError('Lookup cancelled. Existing evidence is unchanged.')}}>Cancel lookup</button>:<button className="la-primary" disabled={!ready||editing} onClick={()=>void resolve()}>{report?'Refresh attribution':'Search AWS history'}</button>}
   <button disabled={working} onClick={()=>{setError('');setConfig(savedConfig.current);setEditing(!editing)}} aria-expanded={editing}>Sources &amp; settings</button>
  </div>
  <div className="la-scope">Profile: {savedConfig.current.awsProfile||'default AWS credential chain'} · Regions: {savedConfig.current.awsRegions.length?savedConfig.current.awsRegions.join(', '):'event Region + us-east-1'} · read-only, on request · loaded event scope unchanged</div>
  {settingsChanged&&<div className="la-progress">Settings changed — refresh to apply. Existing evidence retains its original source scope below.</div>}
  {!report&&<div className="la-scope">Lookup retains original audit records locally, including any sensitive fields AWS logged. Cache is private to your OS account.</div>}
  {working&&<div role="status" className="la-progress">Searching retained management-event history, then stacking configured directory and broker evidence…</div>}
  {error&&<div role="alert" className="la-error">{error}</div>}
  {editing&&<div className="la-settings">
   <div className="la-setting-grid">{field('awsProfile','AWS profile','default credential chain')}<label>AWS Regions<input value={config.awsRegions.join(', ')} onChange={e=>setConfig({...config,awsRegions:e.target.value.split(',').map(s=>s.trim()).filter(Boolean)})} placeholder="us-east-1, eu-west-1"/></label>{field('identityCenterRegion','Identity Center home Region','eu-west-1')}</div>
   <details><summary>Entra ID — provider-controlled session names</summary><p>Only add a role mapping after verifying that the provider controls the session name and alternate assumption paths cannot impersonate it. This is your time-bounded attestation, not an automatic trust-policy audit.</p><div className="la-setting-grid">{field('entraTenantId','Entra tenant ID')}{field('entraTokenEnv','Graph token environment variable')}</div>
    {config.entraMappings.map((mapping,index)=><div className="la-mapping" key={index}><div className="la-setting-grid">{(['roleArn','validFrom','validTo','verifiedAt','note'] as const).map(key=><label key={key}>{{roleArn:'Exact role ARN',validFrom:'Valid from (UTC RFC3339)',validTo:'Valid to (UTC RFC3339)',verifiedAt:'Verified at (UTC RFC3339)',note:'Verification note'}[key]}<input value={mapping[key]} onChange={e=>setConfig({...config,entraMappings:config.entraMappings.map((m,i)=>i===index?{...m,[key]:e.target.value}:m)})}/></label>)}</div><button onClick={()=>setConfig({...config,entraMappings:config.entraMappings.filter((_,i)=>i!==index)})}>Remove mapping</button></div>)}
    <button onClick={()=>setConfig({...config,entraMappings:[...config.entraMappings,{roleArn:'',validFrom:'',validTo:'',verifiedAt:'',note:''}]})}>Add attested mapping</button>
   </details>
   <details><summary>Vault — exact credential-issuance audit match</summary><div className="la-setting-grid">{field('vaultAuditPath','Local Vault audit JSONL path')}{field('vaultAddress','Vault HTTPS address')}{field('vaultAuditDevice','Audit device for HMAC comparison')}{field('vaultTokenEnv','Vault token environment variable')}</div><p>Tokens stay in the native process environment. Never paste tokens here. Audit access is local and bounded; Vault is contacted only to hash a known access-key identifier when required.</p></details>
   <div className="la-save"><button disabled={saving} onClick={()=>void save()}>{saving?'Saving…':'Save settings'}</button><span>Saving does not contact providers. Refresh explicitly after changing sources.</span></div>
  </div>}
  {report&&<div className="la-coverage"><div className="la-scope">{report.cached?'Saved offline result':'Retrieved result'} · {report.result.fetchedAt} · directory metadata is current at retrieval, not a historical directory snapshot</div><div className="la-source-list">{report.result.sources.map((source,i)=><details key={i} className="la-source"><summary>{sourceName(source.source)} <span>{source.status.replaceAll('-',' ').replaceAll('_',' ')}</span></summary><div>{source.detail}</div>{(source.accountId||source.region)&&<div>Scope: {source.accountId||'account not established'} / {source.region||'Region not specified'}</div>}{source.from&&<div>{source.from} → {source.to}</div>}<div>{source.pages} pages · {source.events} records examined</div></details>)}</div></div>}
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
