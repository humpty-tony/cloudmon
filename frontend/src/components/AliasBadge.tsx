import {useSyncExternalStore} from "react";
import {aliases,aliasKey,aliasKindFor,type AliasKind} from "../api/aliases";

export function useAliases(){return useSyncExternalStore(aliases.subscribe,aliases.getSnapshot,aliases.getSnapshot)}
export function AliasBadge({value,kind,field=""}:{value:string;kind?:AliasKind;field?:string}) {
 const saved=useAliases(),resolved=kind??aliasKindFor(field,value);
 const label=resolved?saved.labels.get(aliasKey(resolved,value)):undefined;
 return label?<span className="alias-badge" title={`Personal label: ${label}\nOriginal ${resolved}: ${value}`} aria-label={`Personal label: ${label}`}>{label}</span>:null;
}
