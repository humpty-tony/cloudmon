import {useState} from "react";
import {createRoot} from "react-dom/client";
import {backend} from "../../src/api/backend";
import {WorkspaceActivity} from "../../src/components/WorkspaceActivity";
import {Popover} from "../../src/components/Toolbar";
import {ThemedSelect} from "../../src/components/ThemedSelect";
import {RawJsonModal} from "../../src/components/RawJsonModal";
import {EvidenceModal} from "../../src/components/EvidenceModal";
import {InvestigationView} from "../../src/components/InvestigationView";
import {LineageView} from "../../src/components/LineageView";
import {LineageEventModal} from "../../src/components/LineageEventModal";
import "../../src/app.css";
import {installWorkspaceBackend} from "./workspace-backend.mjs";

// Standalone production components, synthetic backend only. Navigation is
// controlled externally to also cover programmatic switches during a modal.
if ((window as any).go) throw Error("No native/cloud bridge allowed");
const record={eventVersion:"1.09",eventID:"standalone-overlay",eventName:"DescribeSecret",eventTime:"2026-09-24T09:00:00Z",eventSource:"secretsmanager.amazonaws.com",awsRegion:"us-east-1",userIdentity:{type:"IAMUser",userName:"reviewer"}};
await backend.ingestText(JSON.stringify({Records:[record]}));
const {events,aggregates}=await backend.querySearch({includes:{},excludes:{},errorsOnly:false,hideReadOnly:false,fromMs:0,toMs:0,text:"",expr:null},10);
const event=events[0],snapshot=aggregates.snapshot!;
await installWorkspaceBackend(backend);
backend.queryLineageGraph=async()=>({snapshot,applicable:false,nodes:[],edges:[],rootId:"",currentId:"",notes:[]});
const kind=new URLSearchParams(location.search).get("kind");
const outside=new URLSearchParams(location.search).has("outside");
function Fixture(){
  const [active,setActive]=useState(true),[open,setOpen]=useState(true);
  (window as any).overlayFixture={setActive};
  const close=()=>setOpen(false);
  const contents=<section hidden={!active}>
    {kind==="popover"&&<Popover label="Fixture menu">{()=> <button>Menu item</button>}</Popover>}
    {kind==="select"&&<ThemedSelect label="Fixture select" value="one" onChange={()=>{}} options={[{value:"one",label:"One"},{value:"two",label:"Two"}]}/>}
    {open&&kind==="raw"&&<RawJsonModal title={event.eventID} json={JSON.stringify(record)} onClose={close}/>}
    {open&&kind==="evidence"&&<EvidenceModal seq={event.seq} snapshot={snapshot} onClose={close}/>}
    {open&&kind==="investigation"&&<InvestigationView event={event} initialSnapshot={snapshot} onClose={close}/>}
    {open&&kind==="lineage"&&<LineageView seq={event.seq} initialSnapshot={snapshot} onPivot={()=>{}} onClose={close}/>}
    {open&&kind==="lineage event"&&<LineageEventModal title={event.eventID} json={JSON.stringify(record)} onPivot={()=>{}} onClose={close}/>}
  </section>;
  return <><button id="destination">Other workspace</button>{outside?contents:<WorkspaceActivity.Provider value={active}>{contents}</WorkspaceActivity.Provider>}</>;
}
createRoot(document.getElementById("root")!).render(<Fixture/>);
