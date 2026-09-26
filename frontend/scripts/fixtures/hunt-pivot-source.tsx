import React, {useLayoutEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {backend} from '../../src/api/backend';
import {HuntPivotResults} from '../../src/components/HuntPivotResults';

// Real HuntPivotResults; synthetic backend and child prop-observation boundary.
const state = (window as any).pivotSource = {commits: [], pending: [], requests: []};
const snapshot = {generation:'pivot-source-fixture', maxSeq:2, capturedAt:'2026-09-26T12:00:00Z'};
const events = [{seq:1, eventName:'A'}, {seq:2, eventName:'B'}];
backend.querySearch = async () => ({events, aggregates:{snapshot, total:2}} as any);
backend.queryLineageRaw = (seq, scope) => new Promise((resolve, reject) => {
  state.requests.push({seq, snapshot:scope});
  state.pending.push({seq, resolve, reject});
});
state.finish = (seq: number, raw: string) => {
  const index = state.pending.findIndex((p: any) => p.seq === seq);
  if (index < 0) throw Error(`No pending source for ${seq}`);
  state.pending.splice(index, 1)[0].resolve(raw);
};

// Observe committed inspector props BEFORE the owner's passive clearing effect.
// This is not a real-inspector pinning/DOM or native-backend integration test.
export function EventInspector(props: any) {
  useLayoutEffect(() => {
    state.commits.push({seq:props.event?.seq ?? null, snapshot:props.snapshot,
      raw:props.rawJSON, loading:props.rawLoading, error:props.rawError});
  });
  return <output>{props.event?.eventName ?? 'none'}</output>;
}
export function EventTable({events, onSelect}: any) {
  return <div>{events.map((event: any) => <button key={event.seq} onClick={() => onSelect(event)}>Select {event.eventName}</button>)}</div>;
}
export function LineageView() {return null;}

createRoot(document.getElementById('root')!).render(<HuntPivotResults
  scope={{field:'eventName', op:'include', value:'fixture'}}
  tableProps={{columns:[], colWidths:{}, rowHeight:32, onResizeColumn:()=>{}, onReorderColumns:()=>{}, isSensitive:()=>false, timeZone:'utc', onPivot:()=>{}}}
  onReturn={()=>{}}/>);
