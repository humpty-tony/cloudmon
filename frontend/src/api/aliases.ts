// Personal annotations are a display concern. This module has no backend,
// CloudTrail model, query compiler or export dependencies.
export type AliasKind="arn"|"account"|"address";
export interface Alias {kind:AliasKind;value:string;label:string}
export interface AliasSnapshot {
 items:ReadonlyArray<Readonly<Alias>>;
 labels:ReadonlyMap<string,string>;
 error:string;
}
export const ALIAS_KEY="cloudmon.aliases";
export const MAX_ALIASES=500;
type AliasStorage=Pick<Storage,"getItem"|"setItem"|"removeItem">;
export const aliasKey=(kind:AliasKind,value:string)=>JSON.stringify([kind,value]);

export function validateAlias(value:unknown):Alias {
 if(!value||typeof value!=="object")throw Error("Invalid label entry.");
 const row=value as Record<string,unknown>;
 if(row.kind!=="arn"&&row.kind!=="account"&&row.kind!=="address")throw Error("Choose ARN, account or source address.");
 if(typeof row.value!=="string"||!row.value.trim()||row.value.length>2048||/[\x00-\x1f\x7f]/.test(row.value))throw Error("Use an exact identifier of 1–2048 characters without control characters.");
 if(row.kind==="account"&&!/^[0-9]{12}$/.test(row.value))throw Error("An AWS account ID must have exactly 12 digits, including any leading zeros.");
 if(row.kind==="arn"&&!/^arn:[a-z0-9-]+:[a-z0-9-]+:[^:]*:[^:]*:.+$/.test(row.value))throw Error("Paste a full ARN, including its partition and resource.");
 if(typeof row.label!=="string"||!row.label.trim()||row.label.trim().length>100||/[\x00-\x1f\x7f]/.test(row.label))throw Error("Use a label of 1–100 characters without control characters.");
 return {kind:row.kind,value:row.value,label:row.label.trim()};
}
export function aliasKindFor(field:string,value:string):AliasKind|null {
 if(value.startsWith("arn:"))return "arn";
 if(field==="accountId"||field==="recipientAccountId")return "account";
 if(field==="sourceIPAddress")return "address";
 return null;
}
function snapshot(items:Alias[],error=""):AliasSnapshot {
 return {items:Object.freeze(items.map(item=>Object.freeze({...item}))),labels:new Map(items.map(item=>[aliasKey(item.kind,item.value),item.label])),error};
}

// Snapshot identity is cached for useSyncExternalStore. Neither rendering a row
// nor receiving an event reads localStorage or reparses the saved collection.
export class AliasStore {
 private state:AliasSnapshot|null=null;
 private listeners=new Set<()=>void>();
 constructor(private storage:()=>AliasStorage){}
 private read():AliasSnapshot {
  let raw:string|null;
  try{raw=this.storage().getItem(ALIAS_KEY)}catch{return snapshot([],"Local label storage is unavailable. Retry when storage is accessible.")}
  if(raw===null)return snapshot([]);
  try{
   if(raw.length>2_000_000)throw Error("Saved labels exceed the supported size.");
   const data=JSON.parse(raw);
   if(data?.version!==1||!Array.isArray(data.items)||data.items.length>MAX_ALIASES)throw Error("Unrecognized or oversized label collection.");
   const items:Alias[]=data.items.map(validateAlias),seen=new Set<string>();
   for(const item of items){const key=aliasKey(item.kind,item.value);if(seen.has(key))throw Error("Duplicate saved identifier.");seen.add(key)}
   return snapshot(items);
  }catch{return snapshot([],"Saved labels could not be read. They have been preserved; restore the saved collection or explicitly reset labels.")}
 }
 getSnapshot=():AliasSnapshot=>this.state??(this.state=this.read());
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return ()=>{this.listeners.delete(listener)}};
 private publish(next:AliasSnapshot){this.state=next;this.listeners.forEach(listener=>listener())}
 refresh=()=>this.publish(this.read());
 private current():Alias[]{const state=this.read();if(state.error)throw Error(state.error);return [...state.items]}
 private persist(items:Alias[]){
  try{this.storage().setItem(ALIAS_KEY,JSON.stringify({version:1,items}))}catch{throw Error("Labels were not saved. Local storage may be full or unavailable.")}
  this.publish(snapshot(items));
 }
 put(input:Alias){
  const entry=validateAlias(input),key=aliasKey(entry.kind,entry.value);
  const items=this.current().filter(item=>aliasKey(item.kind,item.value)!==key);
  if(items.length>=MAX_ALIASES)throw Error(`At most ${MAX_ALIASES} labels can be saved. Remove one first.`);
  this.persist([...items,entry]);
 }
 remove(kind:AliasKind,value:string){this.persist(this.current().filter(item=>aliasKey(item.kind,item.value)!==aliasKey(kind,value)))}
 clear(){
  try{this.storage().removeItem(ALIAS_KEY)}catch{throw Error("Labels could not be reset because local storage is unavailable.")}
  this.publish(snapshot([]));
 }
}
export const aliases=new AliasStore(()=>window.localStorage);
if(typeof window!=="undefined")window.addEventListener("storage",event=>{if(event.key===ALIAS_KEY||event.key===null)aliases.refresh()});
