import {compileQuery,validateQueryExpr} from "./queryLang";
import {QUERY_FIELDS} from "./types";
import type {QueryExpr,QueryFilter} from "./types";

export interface HuntConfig {
 mode:"indicators"|"sequence";
 indicatorText:string;
 steps:string[];
 group:"principal"|"credential";
 minutes:number;
 filter:QueryFilter;
}
export interface SavedHunt {id:string;name:string;config:HuntConfig}
export interface SavedHuntSnapshot {items:ReadonlyArray<Readonly<SavedHunt>>;error:string}
export const SAVED_HUNTS_KEY="cloudmon.savedHunts";
export const MAX_SAVED_HUNTS=50;
const MAX_COLLECTION_BYTES=4*1024*1024;
const encoder=new TextEncoder();
const fields=new Set<string>(QUERY_FIELDS);
const filterFields=new Set(QUERY_FIELDS.map(field=>field.toLowerCase()));
type HuntStorage=Pick<Storage,"getItem"|"setItem"|"removeItem">;
type Row=Record<string,unknown>;

function row(value:unknown,label:string):Row {
 if(!value||typeof value!=="object"||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error(`${label} must be an object.`);
 return value as Row;
}
function keys(value:Row,required:string[],optional:string[]=[]) {
 const allowed=new Set([...required,...optional]);
 if(Object.keys(value).some(key=>!allowed.has(key))||required.some(key=>!Object.hasOwn(value,key)))throw Error("Unrecognized or incomplete saved hunt data.");
}
function string(value:unknown,label:string,maxBytes=16384):string {
 if(typeof value!=="string"||value.length>maxBytes||encoder.encode(value).length>maxBytes)throw Error(`${label} must be text of at most ${maxBytes} bytes.`);
 return value;
}
function field(value:unknown):string {
 if(typeof value!=="string"||!filterFields.has(value.toLowerCase()))throw Error("Saved hunt contains an unknown filter field.");
 return value;
}
function expressions(value:unknown):QueryExpr {
 let count=0;
 const walk=(input:unknown,depth:number):QueryExpr=>{
  if(++count>512||depth>32)throw Error("Saved filter is too complex (maximum depth 32, 512 nodes).");
  const node=row(input,"Query expression");
  switch(node.t){
   case "and":case "or":{
    keys(node,["t","nodes"]);
    if(!Array.isArray(node.nodes)||!node.nodes.length||node.nodes.length>512)throw Error("Query expression needs an array of operands.");
    return {t:node.t,nodes:Array.from(node.nodes,child=>walk(child,depth+1))};
   }
   case "not":keys(node,["t","node"]);return {t:"not",node:walk(node.node,depth+1)};
   case "cmp":{
    keys(node,["t","field","op","value"]);
    if(typeof node.field!=="string"||!fields.has(node.field)||typeof node.op!=="string"||!["eq","ne","contains","regex","nregex","exists","nexists"].includes(node.op))throw Error("Saved filter contains an unknown field or operator.");
    return {t:"cmp",field:node.field,op:node.op as Extract<QueryExpr,{t:"cmp"}>["op"],value:string(node.value,"Query value")};
   }
   case "text":{
    keys(node,["t","value"],["regex"]);
    if(Object.hasOwn(node,"regex")&&typeof node.regex!=="boolean")throw Error("Query regex flag must be true or false.");
    return {t:"text",value:string(node.value,"Query value"),...(Object.hasOwn(node,"regex")?{regex:node.regex as boolean}:{})};
   }
   default:throw Error("Saved filter contains an unknown query expression.");
  }
 };
 const result=walk(value,0);
 validateQueryExpr(result,fields);
 return result;
}
function filter(value:unknown):QueryFilter {
 const input=row(value,"Hunt filter");
 keys(input,["includes","excludes","errorsOnly","hideReadOnly","fromMs","toMs","text","expr"],["exists","matchNone"]);
 const terms=(value:unknown):Record<string,string[]>=>{
  const input=row(value,"Filter terms"),output:Record<string,string[]>={};
  for(const [key,values] of Object.entries(input)){
   field(key);
   if(!Array.isArray(values)||values.length>10000)throw Error("Filter values must be an array of at most 10000 strings.");
   output[key]=Array.from(values,value=>string(value,"Filter value"));
  }
  return output;
 };
 for(const key of ["errorsOnly","hideReadOnly"])if(typeof input[key]!=="boolean")throw Error("Saved filter flags must be true or false.");
 for(const key of ["fromMs","toMs"])if(typeof input[key]!=="number"||!Number.isSafeInteger(input[key])||input[key]<0)throw Error("Saved filter times must be nonnegative integer milliseconds.");
 if((input.fromMs as number)>0&&(input.toMs as number)>0&&(input.fromMs as number)>(input.toMs as number))throw Error("Saved filter time range starts after it ends.");
 const result:QueryFilter={includes:terms(input.includes),excludes:terms(input.excludes),errorsOnly:input.errorsOnly as boolean,hideReadOnly:input.hideReadOnly as boolean,fromMs:input.fromMs as number,toMs:input.toMs as number,text:string(input.text,"Filter text"),expr:input.expr===null?null:expressions(input.expr)};
 if(Object.hasOwn(input,"exists")){
  if(!Array.isArray(input.exists)||input.exists.length>10000)throw Error("Existence filters must be an array of known fields.");
  result.exists=Array.from(input.exists,field);
 }
 if(Object.hasOwn(input,"matchNone")){
  if(typeof input.matchNone!=="boolean")throw Error("Match-none filter must be true or false.");
  result.matchNone=input.matchNone;
 }
 return result;
}
export function emptyHuntFilter():QueryFilter {return {includes:{},excludes:{},errorsOnly:false,hideReadOnly:false,fromMs:0,toMs:0,text:"",expr:null}}

/** Validate and copy every query constraint. Text and AST can be independent:
 * a clicked pivot may carry an AST that cannot be reconstructed from text. */
export function validateHuntConfig(value:unknown):HuntConfig {
 const input=row(value,"Hunt configuration");
 keys(input,["mode","indicatorText","steps","group","minutes","filter"]);
 if(input.mode!=="indicators"&&input.mode!=="sequence")throw Error("Choose an indicator or sequence hunt.");
 if(input.group!=="principal"&&input.group!=="credential")throw Error("Choose principal or credential grouping.");
 if(typeof input.minutes!=="number"||!Number.isInteger(input.minutes)||input.minutes<1||input.minutes>1440)throw Error("Sequence interval must be 1–1440 minutes.");
 const indicatorText=string(input.indicatorText,"Indicator list",256000);
 if(!Array.isArray(input.steps)||input.steps.length<2||input.steps.length>5)throw Error("A saved hunt needs 2–5 sequence step fields.");
 const steps=Array.from(input.steps,step=>string(step,"Sequence step"));
 if(input.mode==="indicators"){
  const lines=indicatorText.split(/\r?\n/).filter(line=>line.trim());
  if(!lines.length||lines.length>100)throw Error("Enter 1 to 100 indicators, one per line.");
  lines.forEach((line,index)=>{
   const match=line.trim().match(/^(ip|cidr|key|event|arn)\s+(.+)$/);
   if(!match||!match[2].trim()||encoder.encode(match[2].trim()).length>2048||/[\x00-\x1f\x7f]/.test(match[2].trim()))throw Error(`Indicator line ${index+1} needs a known type and a value of 1–2048 bytes.`);
  });
 }else{
  steps.forEach((step,index)=>{
   const compiled=compileQuery(step,fields);
   if(compiled.error||!compiled.ast)throw Error(`Step ${index+1}: ${compiled.error||"enter a search expression."}`);
  });
 }
 return {mode:input.mode,indicatorText,steps,group:input.group,minutes:input.minutes,filter:filter(input.filter)};
}
export function cloneHuntConfig(config:HuntConfig):HuntConfig {return validateHuntConfig(config)}
function name(value:unknown):string {
 if(typeof value!=="string"||!value.trim()||value.trim().length>80||/[\x00-\x1f\x7f]/.test(value))throw Error("Use a hunt name of 1–80 characters without control characters.");
 return value.trim();
}
function saved(value:unknown):SavedHunt {
 const input=row(value,"Saved hunt");keys(input,["id","name","config"]);
 if(typeof input.id!=="string"||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(input.id))throw Error("Saved hunt has an invalid identifier.");
 return {id:input.id,name:name(input.name),config:validateHuntConfig(input.config)};
}
function freeze<T>(value:T):T {
 if(value&&typeof value==="object"){
  Object.values(value).forEach(freeze);
  Object.freeze(value);
 }
 return value;
}
function snapshot(items:SavedHunt[],error=""):SavedHuntSnapshot {return freeze({items,error})}

// Rendering reads a cached snapshot. Mutations reread storage so an older
// window cannot silently overwrite another window's already-saved changes.
export class SavedHuntStore {
 private state:SavedHuntSnapshot|null=null;
 private listeners=new Set<()=>void>();
 constructor(private storage:()=>HuntStorage){}
 private read():SavedHuntSnapshot {
  let raw:string|null;
  try{raw=this.storage().getItem(SAVED_HUNTS_KEY)}catch{return snapshot([],"Saved hunt storage is unavailable. Retry when storage is accessible.")}
  if(raw===null)return snapshot([]);
  try{
   if(raw.length>MAX_COLLECTION_BYTES||encoder.encode(raw).length>MAX_COLLECTION_BYTES)throw Error("Saved hunts exceed the supported size.");
   const data=row(JSON.parse(raw),"Saved hunt collection");keys(data,["version","items"]);
   if(data.version!==1||!Array.isArray(data.items)||data.items.length>MAX_SAVED_HUNTS)throw Error("Unrecognized or oversized saved hunt collection.");
   const items=data.items.map(saved),seen=new Set<string>();
   for(const item of items){if(seen.has(item.id))throw Error("Duplicate saved hunt identifier.");seen.add(item.id)}
   return snapshot(items);
  }catch{return snapshot([],"Saved hunts could not be read. They have been preserved; restore the saved collection or explicitly reset saved hunts.")}
 }
 getSnapshot=():SavedHuntSnapshot=>this.state??(this.state=this.read());
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return ()=>{this.listeners.delete(listener)}};
 private publish(next:SavedHuntSnapshot){this.state=next;this.listeners.forEach(listener=>listener())}
 refresh=()=>this.publish(this.read());
 private current():SavedHunt[]{const state=this.read();if(state.error)throw Error(state.error);return [...state.items]}
 private persist(items:SavedHunt[]){
  const encoded=JSON.stringify({version:1,items});
  if(encoder.encode(encoded).length>MAX_COLLECTION_BYTES)throw Error("Saved hunts exceed the 4 MiB collection limit. Remove a hunt or shorten its configuration.");
  try{this.storage().setItem(SAVED_HUNTS_KEY,encoded)}catch{throw Error("Hunts were not saved. Local storage may be full or unavailable.")}
  this.publish(snapshot(items));
 }
 create(inputName:string,config:HuntConfig):SavedHunt {
  const entry:SavedHunt={id:crypto.randomUUID(),name:name(inputName),config:validateHuntConfig(config)},items=this.current();
  if(items.length>=MAX_SAVED_HUNTS)throw Error(`At most ${MAX_SAVED_HUNTS} hunts can be saved. Remove one first.`);
  if(items.some(item=>item.id===entry.id))throw Error("Could not allocate a unique saved hunt identifier. Retry saving.");
  this.persist([...items,entry]);return entry;
 }
 update(id:string,inputName:string,config:HuntConfig):SavedHunt {
  const items=this.current(),index=items.findIndex(item=>item.id===id);
  if(index<0)throw Error("Saved hunt no longer exists. Save a new hunt instead.");
  const entry:SavedHunt={id,name:name(inputName),config:validateHuntConfig(config)};
  items[index]=entry;this.persist(items);return entry;
 }
 rename(id:string,inputName:string):SavedHunt {
  const items=this.current(),index=items.findIndex(item=>item.id===id);
  if(index<0)throw Error("Saved hunt no longer exists. Save a new hunt instead.");
  const entry={...items[index],name:name(inputName)};
  items[index]=entry;this.persist(items);return entry;
 }
 remove(id:string){this.persist(this.current().filter(item=>item.id!==id))}
 clear(){
  try{this.storage().removeItem(SAVED_HUNTS_KEY)}catch{throw Error("Saved hunts could not be reset because local storage is unavailable.")}
  this.publish(snapshot([]));
 }
}
export const savedHunts=new SavedHuntStore(()=>window.localStorage);
if(typeof window!=="undefined")window.addEventListener("storage",event=>{if(event.key===SAVED_HUNTS_KEY||event.key===null)savedHunts.refresh()});
