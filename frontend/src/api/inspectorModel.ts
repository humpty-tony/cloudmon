import { LosslessNumber, parse } from "lossless-json";

export const FIELD_PAGE_SIZE = 50;
export interface FieldSummary {
  path: string[];
  key: string;
  kind: "object" | "array" | "string" | "number" | "boolean" | "null";
  value: string;
  truncated: boolean;
  children: number;
}
export interface FieldPage { path: string[]; offset: number; total: number; fields: FieldSummary[] }
export type InspectorRequest = { id: number; json: string } | { id: number; path: string[]; offset: number };
export interface InspectorResponse { id: number; page?: FieldPage; error?: string }

// This document stays inside the worker. Only a page of short summaries crosses
// the bridge; large arrays and full strings never enter React's state.
export class InspectorDocument {
  private readonly root: unknown;
  private readonly keys = new WeakMap<object, string[]>();
  constructor(json: string) {
    // The library assigns object keys with ordinary property assignment. Reject
    // prototype-setter keys before it can discard them; Raw JSON remains exact.
    for (const token of json.matchAll(/"(?:[^"\\]|\\[\s\S])*"/g)) {
      let next=token.index+token[0].length;
      while (/\s/.test(json[next] ?? "") && next<json.length) next++;
      if (json[next] === ":" && JSON.parse(token[0]) === "__proto__") {
        throw new Error("This record contains a __proto__ key. Use Raw JSON to inspect the complete source safely.");
      }
    }
    this.root = parse(json);
  }

  private childKeys(value: unknown): string[] {
    if (value === null || typeof value !== "object" || value instanceof LosslessNumber) return [];
    let keys = this.keys.get(value);
    if (!keys) { keys = Object.keys(value); this.keys.set(value, keys); }
    return keys;
  }

  page(path: string[], offset: number): FieldPage {
    if (path.length > 64) throw new Error("This section is too deeply nested for the field view. Open Raw JSON to inspect it.");
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid field page");
    let value = this.root;
    for (const key of path) {
      if (value === null || typeof value !== "object" || !Object.hasOwn(value, key)) throw new Error("Field no longer exists");
      value = (value as Record<string, unknown>)[key];
    }
    const keys = this.childKeys(value);
    const fields = keys.slice(offset, offset + FIELD_PAGE_SIZE).map(key => {
      const child = (value as Record<string, unknown>)[key];
      const kind: FieldSummary["kind"] = child instanceof LosslessNumber ? "number" : child === null ? "null" : Array.isArray(child) ? "array" : typeof child as "object" | "string" | "boolean";
      const text = kind === "object" || kind === "array" ? "" : child instanceof LosslessNumber ? child.value : String(child);
      // Slice by code points so a preview never splits a surrogate pair.
      const preview = text.length > 512 ? Array.from(text.slice(0, 1024)).slice(0, 512).join("") : text;
      return {path:[...path,key],key,kind,value:preview,truncated:preview.length < text.length,children:this.childKeys(child).length};
    });
    return {path,offset,total:keys.length,fields};
  }
}
