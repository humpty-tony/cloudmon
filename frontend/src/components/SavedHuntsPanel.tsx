import {useEffect,useState,useSyncExternalStore} from "react";
import {savedHunts,MAX_SAVED_HUNTS,type HuntConfig,type SavedHunt} from "../api/savedHunts";

interface Props {config:HuntConfig;validation:string;busy:boolean;onLoad:(hunt:SavedHunt)=>void;loaded?:{hunt:SavedHunt}}

export function SavedHuntsPanel({config,validation,busy,onLoad,loaded}:Props) {
  const saved=useSyncExternalStore(savedHunts.subscribe,savedHunts.getSnapshot,savedHunts.getSnapshot);
  const [id,setID]=useState(""),[name,setName]=useState(""),[error,setError]=useState(""),[notice,setNotice]=useState("");
  useEffect(()=>{if(loaded){setID(loaded.hunt.id);setName(loaded.hunt.name);setError("");setNotice(`Loaded “${loaded.hunt.name}”. Press Run hunt to search.`)}},[loaded]);
  const chosen=saved.items.find(item=>item.id===id);
  useEffect(()=>{if(id&&!chosen){setID("");setName("")}},[id,chosen]);
  const perform=(action:()=>void,message:string)=>{
    try{action();setError("");setNotice(message)}catch(e){setError(String(e));setNotice("")}
  };
  const select=(next:string)=>{setID(next);setName(saved.items.find(item=>item.id===next)?.name??"");setError("");setNotice("")};
  const create=()=>perform(()=>{const next=savedHunts.create(name,config);setID(next.id);setName(next.name)},"Hunt saved on this device with a copy of its filter scope.");
  const update=()=>perform(()=>{const next=savedHunts.update(id,name,config);setName(next.name)},"Saved hunt updated with the current inputs and scope.");
  const rename=()=>perform(()=>{const next=savedHunts.rename(id,name);setName(next.name)},"Hunt renamed. Its saved inputs and scope were kept.");
  const remove=()=>{if(chosen&&window.confirm(`Delete saved hunt “${chosen.name}” from this device?`))perform(()=>{savedHunts.remove(id);setID("");setName("")},"Saved hunt deleted.")};
  const clear=()=>{if(window.confirm("Remove all saved hunt configurations from this device?"))perform(()=>{savedHunts.clear();setID("");setName("")},"Saved hunts reset.")};
  const cannotSave=busy||!!validation||!!saved.error||!name.trim();
  return <details className="saved-hunts">
    <summary>Saved hunts ({saved.items.length})</summary>
    <p>Keep up to {MAX_SAVED_HUNTS} named configurations on this device. Loading fills the controls and cancels any current run; press Run hunt to search the current evidence.</p>
    {saved.error&&<div className="saved-hunt-error" role="alert">{saved.error}<div className="saved-hunt-actions"><button className="btn-ghost btn-sm" onClick={()=>savedHunts.refresh()}>Retry hunt storage</button><button className="btn-ghost btn-sm" onClick={clear}>Reset saved hunts</button></div></div>}
    <div className="saved-hunt-controls">
      <label>Saved configuration<select aria-label="Saved hunt" value={id} disabled={!!saved.error} onChange={e=>select(e.target.value)}><option value="">Choose a saved hunt…</option>{saved.items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <button className="btn-ghost btn-sm" disabled={!chosen||!!saved.error} onClick={()=>chosen&&perform(()=>onLoad(chosen),`Loaded “${chosen.name}”. Press Run hunt to search.`)}>Load hunt</button>
      <label>Name<input aria-label="Hunt name" value={name} maxLength={80} disabled={!!saved.error} onChange={e=>setName(e.target.value)} placeholder="e.g. Credential activity"/></label>
    </div>
    <div className="saved-hunt-actions">
      <button className="btn-primary btn-sm" disabled={cannotSave||saved.items.length>=MAX_SAVED_HUNTS} onClick={create}>Save new hunt</button>
      <button className="btn-ghost btn-sm" disabled={cannotSave||!chosen} onClick={update}>Update saved hunt</button>
      <button className="btn-ghost btn-sm" disabled={!chosen||!name.trim()||name.trim()===chosen.name||!!saved.error} onClick={rename}>Rename hunt</button>
      <button className="btn-ghost btn-sm" disabled={!chosen||!!saved.error} onClick={remove}>Delete hunt</button>
    </div>
    {error&&<div className="saved-hunt-error" role="alert">{error}</div>}
    {notice&&<p className="saved-hunt-notice" role="status">{notice}</p>}
    {chosen&&<p className="saved-hunt-meta">Saved mode: {chosen.config.mode==="indicators"?"bulk indicators":`${chosen.config.steps.length} ordered steps`}. Filter values and any absolute time bounds are retained. Results and evidence are not stored here.</p>}
  </details>;
}
