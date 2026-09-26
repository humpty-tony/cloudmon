import assert from 'node:assert/strict';
import {buildLineageStory} from '../src/components/lineage-story.ts';
const base={arn:'',roleArn:'',roleName:'AdministratorAccess',userName:'',sessionName:'casey',accountId:'111122223333',accessKeyId:'ASIAEXAMPLE',invokedBy:'',events:1,childCount:0};
const node={...base,id:base.accessKeyId,kind:'current',identityType:'AssumedRole',originKind:'sso'};
const graph={nodes:[node],edges:[],currentId:node.id,rootId:node.id,applicable:true,notes:['Issuance not recovered.']};
const action={eventName:'ListBuckets',eventSource:'s3.amazonaws.com',eventTime:'2026-09-26T13:09:55Z',userAgent:'aws-cli/2 md/command#s3.ls'};
const evidence={source:'identity-center',method:'event-recorded-store-user-id',nodeKey:node.id,subjectId:'store/user/immutable-user',userName:'casey',displayName:'Casey',initiator:{eventId:'selected-activity'}};
const story=buildLineageStory(graph,[evidence],1,action);
assert.equal(story.nodes.length,3);assert.equal(story.edges.length,2);
assert.equal(story.nodes.find(n=>n.storyKind==='identity').userName,'casey');
assert.equal(story.nodes.find(n=>n.storyKind==='activity').eventName,'ListBuckets');
assert.equal(story.edges.find(e=>e.relationship==='identity').label,'SSO role access');
assert.match(story.edges.find(e=>e.relationship==='identity').detail,/issuance not recovered/i);
assert.equal(story.edges.filter(e=>e.relationship==='issuance').length,0,'Directory association is NOT issuance proof');
assert.equal(graph.nodes.length,1,'Presentation must not mutate native graph');assert.equal(graph.edges.length,0);
for(const bad of [{...evidence,nodeKey:'another-key'},{...evidence,method:'name-match'},{...evidence,source:'source-identity'}]){
 const s=buildLineageStory(graph,[bad],1,action);assert.equal(s.nodes.filter(n=>n.storyKind==='identity').length,0);assert.equal(s.nodes.filter(n=>n.storyKind==='gap').length,1);
}
const conflict=buildLineageStory(graph,[evidence,{...evidence,subjectId:'different-user'}],1,action);
assert.equal(conflict.nodes.filter(n=>n.storyKind==='identity').length,0,'Conflicting identities must not become one origin');
assert.equal(buildLineageStory(graph,[evidence,evidence],1,action).nodes.length,3,'Duplicate metadata is one identity');
const origin={...base,id:'IAMUSER',kind:'origin',identityType:'IAMUser',userName:'operator'};
const issued={parent:origin.id,child:node.id,viaSeq:2,viaEvent:'AssumeRole',viaTime:'2026-09-26T13:00:00Z'};
const exact=buildLineageStory({...graph,rootId:origin.id,nodes:[origin,node],edges:[issued]},[],1,action);
assert.equal(exact.nodes.length,3);assert.equal(exact.edges.find(e=>e.relationship==='issuance').label,'AssumeRole');assert.equal(exact.nodes.filter(n=>n.storyKind==='gap').length,0);
const expanded={...base,id:'ev:1',kind:'event',seq:1,eventName:'ListBuckets'};
const dedup=buildLineageStory({...graph,nodes:[node,expanded],edges:[{parent:node.id,child:expanded.id,viaEvent:'',viaSeq:1,viaTime:''}]},[evidence],1,action);
assert.equal(dedup.nodes.filter(n=>n.seq===1).length,1,'Expanding session events must not duplicate selected activity');
console.log('PASS: identity → role → selected action; strict typed links, conflicts, exact issuance and selected-event deduplication');
