import {LosslessNumber} from "lossless-json";
import {parseEvidence} from "./inspectorModel";

import {COMPARE_MAX_CHARS,COMPARE_MAX_NODES,COMPARE_MAX_CHANGES,COMPARE_SIZE_ERROR} from "./compareLimits";
export {COMPARE_MAX_CHARS,COMPARE_MAX_NODES,COMPARE_MAX_CHANGES} from "./compareLimits";
const MISSING = Symbol("missing");
type Value = unknown | typeof MISSING;
export interface ComparedValue {kind:string;text:string;truncated:boolean}
export interface EvidenceChange {path:string;pathTruncated:boolean;change:"added"|"removed"|"changed";left:ComparedValue;right:ComparedValue}
export interface ComparisonResult {changes:EvidenceChange[];complete:boolean;visited:number;notes:string[]}
function kind(value:Value):string {
  return value===MISSING?"missing":value===null?"null":value instanceof LosslessNumber?"number":Array.isArray(value)?"array":typeof value;
}
function shorten(value:string,limit:number):[string,boolean] {
  if(value.length<=limit)return [value,false];
  const preview=Array.from(value.slice(0,limit*2)).slice(0,limit).join("");
  return [preview,preview.length<value.length];
}
function summary(value:Value):ComparedValue {
  const type=kind(value);
  const text=value===MISSING?"Not present":value instanceof LosslessNumber?value.value:
    type==="array"?`Array · ${(value as unknown[]).length} items`:
    type==="object"?`Object · ${Object.keys(value as object).length} fields`:
    type==="string"?JSON.stringify(value):String(value);
  const [preview,truncated]=shorten(text,512);
  return {kind:type,text:preview,truncated};
}
function scalar(value:unknown):unknown {return value instanceof LosslessNumber?value.value:value}
function pointer(path:string[]):string {return path.length?"/"+path.map(p=>p.replaceAll("~","~0").replaceAll("/","~1")).join("/"):"(root)"}

// Array positions are significant; object member order is not. Numeric lexemes
// are compared without coercion through IEEE-754. This is source-field comparison,
// not a normalization of equivalent numeric spellings or AWS policy semantics.
export function compareEvidence(left:string,right:string):ComparisonResult {
  if(left.length>COMPARE_MAX_CHARS||right.length>COMPARE_MAX_CHARS)throw Error(COMPARE_SIZE_ERROR);
  const result:ComparisonResult={changes:[],complete:true,visited:0,notes:[]};
  const pending:{a:Value;b:Value;path:string[]}[]=[{a:parseEvidence(left),b:parseEvidence(right),path:[]}];
  let scheduled=1;
  while(pending.length&&result.visited<COMPARE_MAX_NODES&&result.changes.length<COMPARE_MAX_CHANGES) {
    const {a,b,path}=pending.pop()!;result.visited++;
    const ak=kind(a),bk=kind(b);
    if(ak===bk&&(ak==="array"||ak==="object")){
      if(path.length>=64){result.complete=false;continue}
      const keys=new Set<string>();
      // Bound the queued work too: a very wide array must not create millions of
      // path objects before the visit limit is reached.
      const available=COMPARE_MAX_NODES-scheduled;
      const gather=(value:Value)=>{
        for(const key in value as object){
          if(!Object.hasOwn(value as object,key)||keys.has(key))continue;
          if(keys.size>=available){result.complete=false;break}
          keys.add(key);
        }
      };
      gather(a);gather(b);
      const ordered=[...keys].sort();scheduled+=ordered.length;
      for(let i=ordered.length-1;i>=0;i--){const key=ordered[i];pending.push({
        a:Object.hasOwn(a as object,key)?(a as Record<string,unknown>)[key]:MISSING,
        b:Object.hasOwn(b as object,key)?(b as Record<string,unknown>)[key]:MISSING,path:[...path,key],
      })}
    }else if(ak!==bk||scalar(a)!==scalar(b)){
      const [display,pathTruncated]=shorten(pointer(path),1024);
      result.changes.push({path:display,pathTruncated,change:a===MISSING?"added":b===MISSING?"removed":"changed",left:summary(a),right:summary(b)});
    }
  }
  if(pending.length)result.complete=false;
  if(!result.complete)result.notes.push("Comparison is incomplete: the 500-change, 50,000-node, or 64-level bound was reached. Additional differences may exist.");
  result.notes.push("Object member order is ignored. Array positions and exact numeric spellings are compared. Long values and paths are previews; the original records remain available.");
  return result;
}
