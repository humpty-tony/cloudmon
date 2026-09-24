import { RE2JS } from "re2js";

// Same RE2 syntax family as the desktop engine, without JavaScript RegExp's
// backtracking or extra lookaround/backreference features. Bound the cache so
// editing queries cannot retain an unbounded collection of compiled programs.
const cache = new Map<string, RE2JS>();
export function searchRegex(pattern: string): RE2JS {
  if (new TextEncoder().encode(pattern).length > 4096) throw new Error("regular expression exceeds 4096 bytes");
  let compiled = cache.get(pattern);
  if (!compiled) {
    try {
      compiled = RE2JS.compile(pattern, RE2JS.CASE_INSENSITIVE);
    } catch (error) {
      throw new Error(`invalid RE2 regular expression: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (cache.size >= 64) cache.delete(cache.keys().next().value!);
    cache.set(pattern, compiled);
  }
  return compiled;
}

export function globMatches(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  // LIKE's wildcards include newlines; matches() anchors to the whole value.
  return searchRegex("(?s)" + escaped).matches(value);
}
