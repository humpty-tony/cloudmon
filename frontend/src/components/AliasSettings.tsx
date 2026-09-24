import {useState} from "react";
import {aliases,aliasKey,MAX_ALIASES,type Alias,type AliasKind} from "../api/aliases";
import {useAliases} from "./AliasBadge";

const kinds:[AliasKind,string][]=[["arn","ARN"],["account","Account ID"],["address","Source address"]];
const empty:Alias={kind:"arn",value:"",label:""};
export function AliasSettings(){
 const saved=useAliases();
 const [draft,setDraft]=useState<Alias>(empty),[editing,setEditing]=useState(false);
 const [error,setError]=useState(""),[notice,setNotice]=useState("");
 const [query,setQuery]=useState(""),[page,setPage]=useState(0);
 const needle=query.toLowerCase();
 const matched=saved.items.filter(item=>[item.kind,item.value,item.label].some(text=>text.toLowerCase().includes(needle)));
 const pages=Math.max(1,Math.ceil(matched.length/50)),current=Math.min(page,pages-1);
 const perform=(action:()=>void,message:string)=>{try{action();setError("");setNotice(message)}catch(e){setError(String(e));setNotice("")}};
 const save=()=>perform(()=>{aliases.put(draft);setDraft(empty);setEditing(false)},"Label saved on this device.");
 const reset=()=>{if(window.confirm("Remove all personal labels from this device? Event evidence will be kept."))perform(()=>{aliases.clear();setDraft(empty);setEditing(false)},"Personal labels reset.")};
 return <div className="alias-settings">
  <div className="alias-heading"><h3>Personal labels</h3><span>{saved.items.length} / {MAX_ALIASES}</span></div>
  <p>Give familiar names to exact identifiers. Labels appear alongside the original values; filters, evidence, exports and correlation still use the originals.</p>
  <p className="alias-note">Local to this device. Matching is case-sensitive, with no wildcard, network-range or ownership inference.</p>
  {saved.error&&<div role="alert" className="alias-error">{saved.error}<button className="btn-ghost" onClick={()=>aliases.refresh()}>Retry label storage</button><button className="btn-ghost" onClick={reset}>Reset personal labels</button></div>}
  <form className="alias-form" onSubmit={e=>{e.preventDefault();save()}}>
   <label>Identifier type<select aria-label="Label identifier type" disabled={editing||!!saved.error} value={draft.kind} onChange={e=>setDraft({...draft,kind:e.target.value as AliasKind})}>{kinds.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
   <label>Exact identifier<input aria-label="Label exact identifier" disabled={editing||!!saved.error} maxLength={2048} value={draft.value} placeholder={draft.kind==="arn"?"arn:aws:iam::123456789012:role/Reader":draft.kind==="account"?"012345678901":"192.0.2.10 or recorded source text"} onChange={e=>setDraft({...draft,value:e.target.value})}/></label>
   <label>Personal label<input aria-label="Personal label" disabled={!!saved.error} maxLength={100} value={draft.label} placeholder="Production audit role" onChange={e=>setDraft({...draft,label:e.target.value})}/></label>
   <div className="alias-actions"><button className="btn-primary" type="submit" disabled={!!saved.error||!draft.value.trim()||!draft.label.trim()}>{editing?"Save label":"Add label"}</button>{editing&&<button className="btn-ghost" type="button" onClick={()=>{setEditing(false);setDraft(empty)}}>Cancel rename</button>}</div>
  </form>
  {error&&<div className="alias-error" role="alert">{error}</div>}{notice&&<p className="alias-notice" role="status">{notice}</p>}
  <div className="alias-list-head"><input aria-label="Search personal labels" className="set-search" placeholder="Search labels or original identifiers…" value={query} onChange={e=>{setQuery(e.target.value);setPage(0)}}/>{saved.items.length>0&&<button className="btn-ghost" onClick={reset}>Reset personal labels</button>}</div>
  <div className="alias-list">{matched.slice(current*50,current*50+50).map(item=><article key={aliasKey(item.kind,item.value)} className="alias-entry"><div><strong>{item.label}</strong><small>{kinds.find(([kind])=>kind===item.kind)?.[1]}</small><code>{item.value}</code></div><button className="btn-ghost" onClick={()=>{setDraft({...item});setEditing(true);setError("");setNotice("")}}>Rename</button><button className="btn-ghost" aria-label={`Remove label ${item.label}`} onClick={()=>perform(()=>{aliases.remove(item.kind,item.value);if(editing&&draft.kind===item.kind&&draft.value===item.value){setDraft(empty);setEditing(false)}},"Label removed.")}>Remove</button></article>)}</div>
  {!matched.length&&<p>{saved.items.length?"No labels match this search.":"No personal labels saved."}</p>}
  {pages>1&&<div className="alias-pagination"><button className="btn-ghost" disabled={current===0} onClick={()=>setPage(current-1)}>Previous labels</button><span>Page {current+1} of {pages} · {matched.length} labels</span><button className="btn-ghost" disabled={current+1===pages} onClick={()=>setPage(current+1)}>Next labels</button></div>}
 </div>;
}
