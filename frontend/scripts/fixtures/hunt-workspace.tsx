import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import '../../src/app.css';
import {HuntWorkspace} from '../../src/components/HuntWorkspace';
import {WorkspaceActivity} from '../../src/components/WorkspaceActivity';
import {HuntView} from '../../src/components/HuntView';
import {COLUMNS} from '../../src/api/columns';
import {EvidenceComparisonProvider} from '../../src/components/EvidenceComparison';
import {emptyHuntFilter} from '../../src/api/savedHunts';

// Dedicated composition fixture: never imports App or provisions capture.

const initialFilter = {...emptyHuntFilter(), includes:{accountId:['012345678901']}, excludes:{eventName:['Get*Literal?']}, exists:['identityArn'], errorsOnly:true, hideReadOnly:true, fromMs:1000, toMs:9000, text:'literal text', expr:{t:'cmp' as const,field:'eventName' as const,op:'eq' as const,value:'RunInstances'}};
function Fixture() {
  const [visible,setVisible] = useState(true);
  const [filter,setFilter] = useState(initialFilter);
  return <EvidenceComparisonProvider><div style={{height:'100vh',display:'flex',flexDirection:'column'}}>
    <header style={{height:44,flex:'none',display:'flex',alignItems:'center',gap:16,padding:'0 16px',borderBottom:'1px solid var(--line-struct)'}}>
      <strong>CloudMon</strong><button onClick={()=>setVisible(v=>!v)}>Toggle destination</button>
      <button onClick={()=>setFilter({...initialFilter,includes:{accountId:['999999999999']}})}>Change Workbench filter</button>
      <span>Hunt composition fixture · synthetic bridge, not native matching</span>
    </header>
    <WorkspaceActivity.Provider value={visible}><div hidden={!visible} style={visible?{display:'flex',flex:1,minHeight:0}:undefined}>
      {new URLSearchParams(window.location.search).has('standalone')?<HuntView filter={filter}/>:<HuntWorkspace filter={filter} columns={COLUMNS.filter(c=>['time','name','result'].includes(c.key))} visibleCols={['time','name','result']} colWidths={{}} rowHeight={32} timeZone="utc" isSensitive={()=>false} onResizeColumn={()=>{}} onReorderColumns={()=>{}} onToggleColumn={()=>{}} onPivot={()=>{}} onOpenLineage={()=>{}}/>}
    </div></WorkspaceActivity.Provider>
  </div></EvidenceComparisonProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
