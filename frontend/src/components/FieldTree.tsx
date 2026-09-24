import {AliasBadge} from "./AliasBadge";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { FilterField, QueryOp } from "../api/types";
import { InspectorClient } from "../api/inspectorClient";
import { FIELD_PAGE_SIZE, type FieldPage, type FieldSummary } from "../api/inspectorModel";

// Leaf paths (dotted) that map to a filterable field → get pivot affordances.
// Each maps to a CONCRETE, round-tripping field: the value shown at that JSON
// position is exactly what the query bar matches, so clicking it filters cleanly.
const PATH_FIELD: Record<string, FilterField> = {
  eventName: "eventName",
  eventSource: "eventSource",
  awsRegion: "awsRegion",
  sourceIPAddress: "sourceIPAddress",
  userAgent: "userAgent",
  errorCode: "errorCode",
  recipientAccountId: "recipientAccountId",
  readOnly: "readOnly",
  eventID: "eventID",
  // identity - mapped to their extraction points so the expanded record is pivotable
  "userIdentity.type": "identityType",
  "userIdentity.userName": "userName",
  "userIdentity.arn": "identityArn",
  "userIdentity.principalId": "principalId",
  "userIdentity.accountId": "accountId",
  "userIdentity.sessionContext.sessionIssuer.arn": "roleArn",
  "userIdentity.sessionContext.sessionIssuer.userName": "userName", // assumed-role name → userName (coalesced by the engine)
};


type PivotFn = (field: FilterField, value: string, op: QueryOp) => void;
const pathKey = (path: string[]) => JSON.stringify(path);
type DisplayRow = {kind:"field"; field:FieldSummary;depth:number} | {kind:"page";page:FieldPage;depth:number} | {kind:"status";path:string[];message:string;error:boolean;depth:number};

/** A bounded worker supplies summaries; only visible tree rows mount in React. */
export const FieldTree = memo(function FieldTree({ json, height, onPivot }: { json: string; height: number; onPivot: PivotFn }) {
  const [pages,setPages] = useState<Map<string,FieldPage>>(new Map());
  const [open,setOpen] = useState<Set<string>>(new Set());
  const [errors,setErrors] = useState<Map<string,string>>(new Map());
  const [busy,setBusy] = useState<Set<string>>(new Set());
  const [retry,setRetry] = useState(0);
  const client = useRef<InspectorClient | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let current: InspectorClient | null = null;
    setPages(new Map());setOpen(new Set());setErrors(new Map());setBusy(new Set(['[]']));
    try {
      current = new InspectorClient(); client.current = current;
      current.request({json}).then(page => {
        if (client.current === current) setPages(new Map([['[]',page]]));
      }).catch(error => { if (client.current === current) setErrors(new Map([['[]',String(error)]])); })
        .finally(()=>{if(client.current===current)setBusy(new Set())});
    } catch (error) { setErrors(new Map([['[]',String(error)]]));setBusy(new Set()); }
    return () => { client.current = null; current?.dispose(); };
  },[json,retry]);

  const loadPage = async(path: string[], offset: number) => {
    const current=client.current, key=pathKey(path);
    if(!current || busy.has(key))return;
    setBusy(previous=>new Set(previous).add(key));
    setErrors(previous=>{const next=new Map(previous);next.delete(key);return next});
    try {
      const page=await current.request({path,offset});
      if(client.current===current)setPages(previous=>new Map(previous).set(key,page));
    } catch(error) {if(client.current===current)setErrors(previous=>new Map(previous).set(key,String(error)))}
    finally {if(client.current===current)setBusy(previous=>{const next=new Set(previous);next.delete(key);return next})}
  };
  const toggle=(field:FieldSummary)=>{
    const key=pathKey(field.path);
    if(open.has(key))setOpen(previous=>{const next=new Set(previous);next.delete(key);return next});
    else {setOpen(previous=>new Set(previous).add(key));if(!pages.has(key))void loadPage(field.path,0)}
  };
  const rows=useMemo(()=>{
    const result:DisplayRow[]=[];
    const visit=(path:string[],depth:number)=>{
      const key=pathKey(path),page=pages.get(key),error=errors.get(key);
      if(error)result.push({kind:'status',path,message:error,error:true,depth});
      if(!page){if(!error)result.push({kind:'status',path,message:'Loading fields…',error:false,depth});return}
      for(const field of page.fields){
        result.push({kind:'field',field,depth});
        if(open.has(pathKey(field.path)))visit(field.path,depth+1);
      }
      if(page.total>FIELD_PAGE_SIZE)result.push({kind:'page',page,depth});
    };
    visit([],0);return result;
  },[pages,open,errors]);
  const virtual=useVirtualizer({count:rows.length,getScrollElement:()=>scroll.current,estimateSize:()=>28,overscan:6,
    getItemKey:index=>{const row=rows[index];return row.kind==='field'?pathKey(row.field.path):row.kind+pathKey(row.kind==='page'?row.page.path:row.path)}});
  return <div className="ft-view">
    <div className="ft-toolbar"><span>Event fields · expand a section to inspect it</span><button className="btn-ghost" onClick={()=>setOpen(new Set())}>Collapse all</button></div>
    <div className="ft ft-viewport" ref={scroll} role="region" aria-label="Event fields" tabIndex={0} style={{height:Math.min(height,Math.max(56,rows.length*28))}}>
      <div style={{height:virtual.getTotalSize(),position:'relative'}}>
        {virtual.getVirtualItems().map(item=>{
          const row=rows[item.index];
          const style={position:'absolute' as const,top:0,left:0,width:'100%',height:28,transform:`translateY(${item.start}px)`,paddingLeft:Math.min(row.depth,12)*14};
          if(row.kind==='page')return <div key={item.key} className="ft-row ft-page" style={style}>
            <button className="btn-ghost" disabled={row.page.offset===0 || busy.has(pathKey(row.page.path))} onClick={()=>void loadPage(row.page.path,Math.max(0,row.page.offset-FIELD_PAGE_SIZE))}>Previous fields</button>
            <span>{row.page.offset+1}–{Math.min(row.page.total,row.page.offset+FIELD_PAGE_SIZE)} of {row.page.total.toLocaleString()}</span>
            <button className="btn-ghost" disabled={row.page.offset+FIELD_PAGE_SIZE>=row.page.total || busy.has(pathKey(row.page.path))} onClick={()=>void loadPage(row.page.path,row.page.offset+FIELD_PAGE_SIZE)}>Next fields</button>
          </div>;
          if(row.kind==='status')return <div key={item.key} style={style} className="ft-row" role={row.error?'alert':'status'}>
            <span className="ft-status" title={row.message}>{row.message}</span>{row.error && <button className="btn-ghost" onClick={()=>setRetry(n=>n+1)}>Retry fields</button>}
          </div>;
          const field=row.field,key=pathKey(field.path),branch=field.kind==='object'||field.kind==='array';
          // Dots in a literal key must never impersonate a nested query field.
          const pivot=field.path.every(part=>!part.includes('.')) ? PATH_FIELD[field.path.join('.')] : undefined;
          const value=field.value;
          return <div key={item.key} style={style} className="ft-row" data-field-path={key}>
            {branch ? <button className="ft-toggle" aria-expanded={open.has(key)} onClick={()=>toggle(field)} title={field.path.join('.')}>
              <span className={`ft-caret ${open.has(key)?'open':''}`}>▸</span><span className="ft-key">{field.key}</span>
              <span className="ft-meta">{field.kind==='array'?`[${field.children.toLocaleString()}]`:`{${field.children.toLocaleString()}}`}</span>
            </button> : <><span className="ft-key" title={field.path.join('.')}>{field.key}</span><span className={`ft-val ft-${field.kind==='number'?'num':field.kind==='boolean'?'bool':field.kind==='null'?'null':'str'}`} title={field.truncated?'Long value · open Raw JSON for the complete text':value}>{value===''?'""':value}{field.truncated?'…':''}</span>
              {!field.truncated&&field.kind==="string"&&<AliasBadge field={field.key} value={value}/>}
              {pivot && !field.truncated && field.kind!=='null' && <span className="ft-pivot">
                <button className="pv" title={`Filter for ${value}`} onClick={()=>onPivot(pivot,value,'include')}>⌕+</button>
                <button className="pv" title={`Filter out ${value}`} onClick={()=>onPivot(pivot,value,'exclude')}>⌕−</button>
              </span>}
            </>}
          </div>;
        })}
      </div>
    </div>
    <span className="ft-footnote">Long values are shortened here. Raw JSON and Copy retain the complete source.</span>
  </div>;
});
