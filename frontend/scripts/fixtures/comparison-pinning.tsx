import {useState} from "react";
import {createRoot} from "react-dom/client";
import {EventInspector, type EventInspectorProps} from "../../src/components/EventInspector";
import {ComparisonBar, EvidenceComparisonProvider} from "../../src/components/EvidenceComparison";
import type {CloudTrailEvent} from "../../src/api/types";
import "../../src/app.css";

// Synthetic policy type changes from RESEARCH-01; no native or cloud calls.
export const action = '/requestParameters/policy/Statement/0/Action';
export const principal = '/requestParameters/policy/Statement/0/Principal';
export const records = [
  '{\n "eventID":"research-a", "requestParameters":{"policy":{"Statement":[{"Action":"s3:GetObject","Principal":{"AWS":"arn:aws:iam::111122223333:user/alice-review"}}]}}, "value":9007199254740992\n}',
  '{\n "eventID":"research-b", "requestParameters":{"policy":{"Statement":[{"Action":["s3:GetObject","s3:PutObject"],"Principal":"*"}]}}, "value":{"exact":9007199254740993,"decimal":0.123456789012345678901,"exponent":1e3,"spoof":{"isLosslessNumber":true,"value":"invented"},"html":"<img src=x onerror=alert(1)>"}\n}',
  '{"eventID":"research-c","requestParameters":{"policy":null}}',
];
export const events: CloudTrailEvent[] = records.map((rawJSON, i) => ({
  seq:i+1, eventID:`research-${String.fromCharCode(97+i)}`, eventName:"PutBucketPolicy", eventTime:`2026-09-26T13:1${i}:00Z`,
  eventSource:"s3.amazonaws.com", awsRegion:"us-east-1", sourceIPAddress:"198.51.100.44", userAgent:"synthetic-UX-review",
  userIdentity:{type:"IAMUser", principalId:"RESEARCH", arn:"arn:aws:iam::111122223333:user/alice-review", accountId:"111122223333",userName:"alice-review"},
  recipientAccountId:"111122223333", readOnly:false, managementEvent:true, rawJSON,
}));
const state = {select:(_index:number)=>{}, update:(_props:Partial<EventInspectorProps>)=>{}, retries:0};
Object.assign(window,{comparisonPinning:state});
function Fixture() {
  const [props,setProps] = useState<EventInspectorProps>({
    event:events[0], rawJSON:records[0], layout:"review", timeZone:"utc",
    snapshot:{generation:"comparison-pinning",maxSeq:3,capturedAt:"2026-09-26T13:13:00Z"},
    onRetry:()=>{state.retries++}, onClose:()=>{}, onPivot:()=>{}, onPrevious:()=>state.select(0), onNext:()=>state.select(1),
  });
  state.select=index=>setProps(previous=>({...previous,event:events[index],rawJSON:records[index],rawLoading:false,rawError:undefined}));
  state.update=updates=>setProps(previous=>({...previous,...updates}));
  return <EvidenceComparisonProvider>
    <style>{`body {margin:0;background:var(--bg-0);color:var(--tx-1)} .comparison-fixture {height:calc(100vh - 96px);display:flex;justify-content:flex-end} .comparison-fixture .event-inspector {width:390px} .fixture-note {padding:14px;font:12px var(--sans)}`}</style>
    <div className="fixture-note">Synthetic comparison / selected-event pinning regression</div>
    <ComparisonBar/><div className="comparison-fixture"><EventInspector {...props}/></div>
  </EvidenceComparisonProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture/>);
