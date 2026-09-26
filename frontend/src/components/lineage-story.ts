import type {GraphNode, GraphEdge, LineageTree} from '../api/types';
import type {AttributionEvidence, Initiator} from '../api/attribution';

export interface SelectedActivity {
  eventName?: string; eventSource?: string; eventTime?: string; eventID?: string;
  userAgent?: string; sourceIPAddress?: string; awsRegion?: string; errorCode?: string; mfa?: string;
}
export interface StoryNode extends GraphNode {
  storyKind?: 'identity' | 'activity' | 'gap';
  identityEvidence?: AttributionEvidence;
  activity?: SelectedActivity;
}
export interface StoryEdge extends GraphEdge {
  relationship: 'issuance' | 'identity' | 'activity' | 'gap';
  label: string;
  detail: string;
}
const empty = {identityType:'',arn:'',roleArn:'',roleName:'',userName:'',sessionName:'',accountId:'',accessKeyId:'',invokedBy:'',events:0,childCount:0};

// A display projection only. It never changes native ancestry, completeness,
// correlation, cache, or expansion state. Directory association != issuance.
export function buildLineageStory(graph: LineageTree, evidence: AttributionEvidence[], seq: number, activity?: SelectedActivity | null) {
  const nodes: StoryNode[] = graph.nodes.map(n=>({...n}));
  const nodeMap = new Map(nodes.map(n=>[n.id,n]));
  const edges: StoryEdge[] = graph.edges.map(e=>({...e,
    relationship:nodeMap.get(e.child)?.kind==='event'?'activity':'issuance',
    label:nodeMap.get(e.child)?.kind==='event'?(nodeMap.get(e.parent)?.accessKeyId?'accessKeyId':'userIdentity'):e.viaEvent,
    detail:nodeMap.get(e.child)?.kind==='event'?'Recorded on this event':'Issued accessKeyId match',
  }));
  let rootId = graph.rootId;
  const root = nodeMap.get(rootId);
  if (root && graph.applicable && root.kind !== 'origin') {
    // Only the adapter's exact recorded store/user-ID binding qualifies. Never
    // turn sourceIdentity, a role/session name, or candidate directory hit into
    // an identity edge. Conflicting subject IDs remain unresolved.
    const identities = evidence.filter(e=>e.nodeKey===root.id && e.source==='identity-center' && e.method==='event-recorded-store-user-id' && e.subjectId);
    const distinct = new Set(identities.map(e=>e.subjectId));
    const person = distinct.size===1 ? identities[0] : undefined;
    const id = `story:${person?'identity':'gap'}:${root.id}`;
    nodes.push(person ? {...empty,id,kind:'identity',storyKind:'identity',identityType:'IdentityCenterUser',userName:person.userName||person.displayName||person.subjectId,identityEvidence:person}
      : {...empty,id,kind:'unknown',storyKind:'gap',identityNote:distinct.size>1?'Conflicting recorded identities; no single origin selected.':graph.notes.join('\n')});
    edges.push({parent:id,child:root.id,viaSeq:0,viaEvent:'',viaTime:'',viaIP:'',
      relationship:person?'identity':'gap',label:person?'onBehalfOf':'Issuance missing',detail:person?'Identity Store + user ID':'',
      evidence:person?'Identity linked by the exact event-recorded Identity Store/user IDs: userIdentity.onBehalfOf.identityStoreArn + userIdentity.onBehalfOf.userId, resolved with DescribeUser. This association does not recover the credential issuance event.':graph.notes.join('\n'),
    });
    rootId=id;
  }
  // Always show the selected action. Reuse an expanded activity node rather
  // than displaying the same event twice. Missing raw fields stay unspecified.
  if (nodeMap.has(graph.currentId)) {
    let selected = nodes.find(n=>n.kind==='event'&&n.seq===seq);
    if (!selected) {
      selected={...empty,id:`story:activity:${seq}`,kind:'event',seq};nodes.push(selected);
      const field=nodeMap.get(graph.currentId)?.accessKeyId?'accessKeyId':'userIdentity';
      edges.push({parent:graph.currentId,child:selected.id,viaSeq:seq,viaEvent:'',viaTime:activity?.eventTime||'',viaIP:activity?.sourceIPAddress||'',relationship:'activity',label:field,detail:'Recorded on this event',evidence:field==='accessKeyId'?'The selected event records this session in userIdentity.accessKeyId.':'The selected event records this actor in userIdentity.'});
    }
    Object.assign(selected,{storyKind:'activity',activity,eventName:activity?.eventName||selected.eventName||`Event #${seq}`,eventSource:activity?.eventSource||selected.eventSource||'',eventTime:activity?.eventTime||selected.eventTime||'',errorCode:activity?.errorCode||selected.errorCode||''});
  }
  return {nodes,edges,rootId};
}

export function activityFacts(activity?: SelectedActivity): Initiator {
  return {ip:activity?.sourceIPAddress||'',userAgent:activity?.userAgent||'',time:activity?.eventTime||'',eventId:activity?.eventID||'',region:activity?.awsRegion||'',mfa:activity?.mfa||''};
}

// CLI command is shown only when it is explicitly present in the recorded UA.
export function activityCommand(activity?: SelectedActivity): string {
  const command=activity?.userAgent?.match(/(?:^|\s)md\/command#([a-z0-9-]+)\.([a-z0-9-]+)(?=[\s\]]|$)/i);
  return command ? `aws ${command[1]} ${command[2]}` : '';
}
