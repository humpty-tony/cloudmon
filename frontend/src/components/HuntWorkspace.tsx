import {useId, useRef, useState, type KeyboardEvent} from "react";
import type {QueryFilter} from "../api/types";
import type {SavedHunt} from "../api/savedHunts";
import {HuntView} from "./HuntView";
import {SigmaView, type SigmaViewProps} from "./SigmaView";
import {WorkspaceActivity, useWorkspaceActive} from "./WorkspaceActivity";
import "./hunt-workspace.css";

/** Same table/pivot contract as SigmaView, plus the applied Workbench filter. */
export interface HuntWorkspaceProps extends SigmaViewProps { filter: QueryFilter }

type Mode = "indicators" | "rules" | "sequence";
const MODES: {id:Mode; label:string; purpose:string}[] = [
  {id:"indicators",label:"Indicators",purpose:"Find known IPs, access keys, event IDs or ARNs in your evidence."},
  {id:"rules",label:"Rules",purpose:"Choose a detection rule, run it, then inspect matching events."},
  {id:"sequence",label:"Event sequences",purpose:"Find ordered events for the same principal or credential within a time window."},
];

/** Keep mounted (hide, don't unmount) when returning to the Workbench. */
export function HuntWorkspace({filter,...sigma}: HuntWorkspaceProps) {
  const active = useWorkspaceActive();
  const [mode,setMode] = useState<Mode>("indicators");
  const [loads,setLoads] = useState<Partial<Record<Mode,{hunt:SavedHunt}>>>({});
  const loadSaved = (hunt:SavedHunt) => {
    setLoads(current=>({...current,[hunt.config.mode]:{hunt}}));
    setMode(hunt.config.mode);
  };
  const id = useId();
  const tabs = useRef<(HTMLButtonElement|null)[]>([]);
  const navigate = (event:KeyboardEvent<HTMLButtonElement>,index:number) => {
    let next=index;
    if(event.key==="ArrowRight")next=(index+1)%MODES.length;
    else if(event.key==="ArrowLeft")next=(index+MODES.length-1)%MODES.length;
    else if(event.key==="Home")next=0;
    else if(event.key==="End")next=MODES.length-1;
    else return;
    event.preventDefault();setMode(MODES[next].id);tabs.current[next]?.focus();
  };
  return <main className="hunt-workspace" aria-label="Hunt workspace">
    <header className="hw-toolbar"><div role="tablist" aria-label="Hunt modes">
      {MODES.map((item,index)=><button key={item.id} title={item.purpose} ref={element=>{tabs.current[index]=element}} type="button" role="tab" id={`${id}-${item.id}`} aria-controls={`${id}-${item.id}-panel`} aria-selected={mode===item.id} tabIndex={mode===item.id?0:-1} onKeyDown={event=>navigate(event,index)} onClick={()=>setMode(item.id)}>{item.label}</button>)}
    </div></header>
    {MODES.map(item=><WorkspaceActivity.Provider key={item.id} value={active && mode===item.id}><section className="hw-panel" role="tabpanel" id={`${id}-${item.id}-panel`} aria-labelledby={`${id}-${item.id}`} hidden={mode!==item.id}>
      {item.id==="rules"?<SigmaView {...sigma}/>:<HuntView filter={filter} fixedMode={item.id} savedLoad={loads[item.id]} onLoadSaved={loadSaved} inspector={{timeZone:sigma.timeZone,onPivot:sigma.onPivot}}/>}
    </section></WorkspaceActivity.Provider>)}
  </main>;
}
