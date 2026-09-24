// A small, flexible query language for the event stream.
//
//   eventSource="ec2" and eventName="RunInstances"
//   eventName="List*"                     (glob wildcard)
//   eventName ~ "^List.*"                 (regex match)
//   (result="AccessDenied" or errorCode=*) and not readOnly="true"
//   sourceIPAddress:"192.0.2"             (`:` = contains)
//   alice                                 (bare word = free-text substring)
//
// Operators: =  ==  !=  ~ (regex)  !~  : (contains).  `*` and `?` in a value
// make `=`/`!=` a glob. Booleans: and / or / not (case-insensitive) + parens.
// Implicit AND between adjacent terms.
//
// The parser runs client-side and produces a QueryExpr tree (see types.ts). The
// engine compiles that tree to SQL (internal/store exprSQL) so DuckDB does the
// filtering; the browser mock walks the same tree via evalAst below.

import type { CloudTrailEvent, CmpOp, FilterField, QueryExpr } from "./types";
import { filterFieldValue, QUERY_FIELDS } from "./types";
import { searchableValues } from "./query";
import { globMatches, searchRegex } from "./searchRegex";

export interface Compiled {
  ast: QueryExpr | null; // null when the query is empty (matches everything)
  error: string | null;
}

interface Tok {
  t: "lp" | "rp" | "and" | "or" | "not" | "op" | "str" | "regex" | "word";
  v: string;
}

const OP_CHARS = new Set(["=", "!", "~", ":", "<", ">"]);

function tokenize(input: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const n = input.length;
  while (i < n) {
    const c = input[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "(") { toks.push({ t: "lp", v: "(" }); i++; continue; }
    if (c === ")") { toks.push({ t: "rp", v: ")" }); i++; continue; }
    if (c === '"' || c === "'") {
      const q = c;
      let s = "";
      i++;
      while (i < n && input[i] !== q) {
        if (input[i] === "\\" && i + 1 < n) {
          // Decode quote/backslash escapes only. Keep regex tokens such as \d
          // and literal Windows-path backslashes instead of silently dropping them.
          const next = input[i + 1];
          s += next === q || next === "\\" ? next : "\\" + next;
          i += 2;
        }
        else { s += input[i]; i++; }
      }
      if (i >= n) throw new Error("unterminated string");
      i++;
      toks.push({ t: "str", v: s });
      continue;
    }
    if (c === "/") {
      let s = "";
      i++;
      while (i < n && input[i] !== "/") {
        if (input[i] === "\\" && i + 1 < n) { s += input[i] + input[i + 1]; i += 2; }
        else { s += input[i]; i++; }
      }
      if (i >= n) throw new Error("unterminated regex");
      i++;
      if (i < n && /[a-z]/i.test(input[i])) throw new Error("regex suffix flags are unsupported; use inline RE2 flags such as (?s)");
      toks.push({ t: "regex", v: s });
      continue;
    }
    if (OP_CHARS.has(c)) {
      // longest match: != !~ == = ~ :
      const two = input.slice(i, i + 2);
      if (two === "!=" || two === "!~" || two === "==") { toks.push({ t: "op", v: two }); i += 2; continue; }
      if (c === "!" || c === "<" || c === ">") throw new Error(`unsupported operator "${c}"`);
      toks.push({ t: "op", v: c }); i++; continue;
    }
    // word: run until whitespace, paren, quote, slash, or operator char
    let w = "";
    while (i < n && !/\s/.test(input[i]) && !"()\"'/".includes(input[i]) && !OP_CHARS.has(input[i])) {
      w += input[i];
      i++;
    }
    const lw = w.toLowerCase();
    if (lw === "and") toks.push({ t: "and", v: w });
    else if (lw === "or") toks.push({ t: "or", v: w });
    else if (lw === "not") toks.push({ t: "not", v: w });
    else toks.push({ t: "word", v: w });
  }
  return toks;
}

// Map an operator token + value token → a comparison node. Glob-vs-exact and
// exists (empty value) are decided by the engine/evaluator from the value, so
// `=`/`!=` collapse to eq/ne here.
function makeComparison(field: string, op: string, valTok: Tok): QueryExpr {
  const isRegexTok = valTok.t === "regex";
  if (op === ":" && isRegexTok) throw new Error("use ~ for a regex, or quote the literal value after :");
  let cmp: CmpOp;
  if (op === "~" || op === "!~" || isRegexTok) cmp = op === "!~" || op === "!=" ? "nregex" : "regex";
  else if (op === ":") cmp = "contains";
  else cmp = op === "!=" ? "ne" : "eq";
  return { t: "cmp", field, op: cmp, value: valTok.v };
}

export function compileQuery(input: string, fields: Set<string>): Compiled {
  if (new TextEncoder().encode(input).length > 16384) return { ast: null, error: "query exceeds 16384 bytes" };
  const trimmed = input.trim();
  if (!trimmed) return { ast: null, error: null };

  let toks: Tok[];
  try {
    toks = tokenize(trimmed);
  } catch (err) {
    return { ast: null, error: (err as Error).message };
  }

  // case-insensitive field resolution: eventname -> eventName
  const fieldMap = new Map<string, string>();
  for (const f of fields) fieldMap.set(f.toLowerCase(), f);

  let pos = 0;
  const peek = () => toks[pos];
  const eof = () => pos >= toks.length;

  function parseExpr(depth = 0): QueryExpr {
    return parseOr(depth);
  }
  function parseOr(depth: number): QueryExpr {
    const nodes = [parseAnd(depth)];
    while (!eof() && peek().t === "or") {
      pos++;
      nodes.push(parseAnd(depth));
    }
    return nodes.length === 1 ? nodes[0] : { t: "or", nodes };
  }
  function parseAnd(depth: number): QueryExpr {
    const nodes = [parseNot(depth)];
    while (!eof()) {
      const t = peek().t;
      if (t === "and") {
        pos++;
        nodes.push(parseNot(depth));
      } else if (t === "lp" || t === "not" || t === "str" || t === "regex" || t === "word") {
        // implicit AND
        nodes.push(parseNot(depth));
      } else break;
    }
    return nodes.length === 1 ? nodes[0] : { t: "and", nodes };
  }
  function parseNot(depth: number): QueryExpr {
    if (depth > 32) throw new Error("query nesting exceeds 32 levels");
    if (!eof() && peek().t === "not") {
      pos++;
      return { t: "not", node: parseNot(depth + 1) };
    }
    return parsePrimary(depth);
  }
  function parsePrimary(depth: number): QueryExpr {
    if (eof()) throw new Error("unexpected end of query");
    const tk = peek();
    if (tk.t === "lp") {
      pos++;
      const inner = parseExpr(depth + 1);
      if (eof() || peek().t !== "rp") throw new Error("missing closing )");
      pos++;
      return inner;
    }
    if (tk.t === "word") {
      pos++;
      // field comparison?
      if (!eof() && peek().t === "op") {
        const field = fieldMap.get(tk.v.toLowerCase());
        if (!field) throw new Error(`unknown field "${tk.v}"`);
        const op = peek().v;
        pos++;
        const vt = eof() ? null : peek();
        if (vt && (vt.t === "word" || vt.t === "str" || vt.t === "regex")) {
          pos++;
          return makeComparison(field, op, vt);
        }
        if (op !== "=" && op !== "==" && op !== "!=") throw new Error(`missing value after ${op}`);
        // Bare equality with no value → exists / not-exists convenience.
        // (An explicit `field=""` keeps its literal meaning via makeComparison above.)
        return { t: "cmp", field, op: op === "!=" ? "nexists" : "exists", value: "" };
      }
      return { t: "text", value: tk.v };
    }
    if (tk.t === "str") {
      pos++;
      return { t: "text", value: tk.v };
    }
    if (tk.t === "regex") {
      pos++;
      return { t: "text", value: tk.v, regex: true };
    }
    throw new Error(`unexpected "${tk.v}"`);
  }

  try {
    const ast = parseExpr();
    if (!eof()) throw new Error(`unexpected "${peek().v}"`);
    validateQueryExpr(ast, fields);
    return { ast, error: null };
  } catch (err) {
    return { ast: null, error: (err as Error).message };
  }
}

export function validateQueryExpr(ast: QueryExpr, fields = new Set<string>(QUERY_FIELDS)): void {
  let count = 0;
  const walk = (node: QueryExpr, depth: number) => {
    if (!node) throw new Error("missing expression operand");
    if (++count > 512 || depth > 32) throw new Error("query is too complex (maximum depth 32, 512 nodes)");
    if ((node.t === "text" || node.t === "cmp") && new TextEncoder().encode(node.value).length > 16384) throw new Error("query value exceeds 16384 bytes");
    switch (node.t) {
      case "and": case "or":
        if (!node.nodes.length) throw new Error(`${node.t} requires operands`);
        node.nodes.forEach(child => walk(child, depth + 1));
        break;
      case "not": walk(node.node, depth + 1); break;
      case "cmp":
        if (!fields.has(node.field)) throw new Error(`unknown field "${node.field}"`);
        if (!["eq", "ne", "contains", "regex", "nregex", "exists", "nexists"].includes(node.op)) throw new Error(`unknown operator "${node.op}"`);
        if (node.op === "regex" || node.op === "nregex") searchRegex(node.value);
        break;
      case "text": if (node.regex) searchRegex(node.value); break;
      default: throw new Error("unknown query expression");
    }
  };
  walk(ast, 0);
}

// ---- browser/mock evaluation: walk the same tree as a predicate ----
// (In a Wails build the engine compiles the tree to SQL instead - see
// internal/store exprSQL. This keeps the mock preview faithful to the language.)

export function evalAst(e: CloudTrailEvent, node: QueryExpr): boolean {
  switch (node.t) {
    case "and":
      return node.nodes.every((n) => evalAst(e, n));
    case "or":
      return node.nodes.some((n) => evalAst(e, n));
    case "not":
      return !evalAst(e, node.node);
    case "text": {
      if (node.regex) {
        const re = searchRegex(node.value);
        return searchableValues(e).some(value => re.test(value));
      }
      return searchableValues(e).some(value => value.toLowerCase().includes(node.value.toLowerCase()));
    }
    case "cmp":
      return evalCmp(e, node);
  }
}

function evalCmp(e: CloudTrailEvent, node: Extract<QueryExpr, { t: "cmp" }>): boolean {
  const actual = filterFieldValue(e, node.field as FilterField);
  const v = node.value;
  switch (node.op) {
    case "exists":
      return actual !== "";
    case "nexists":
      return actual === "";
    case "regex":
    case "nregex": {
      const m = searchRegex(v).test(actual);
      return node.op === "nregex" ? !m : m;
    }
    case "contains":
      return actual.toLowerCase().includes(v.toLowerCase());
    case "eq":
    case "ne": {
      const neg = node.op === "ne";
      let m: boolean;
      if (v === "*") m = actual !== "";
      else if (v.includes("*") || v.includes("?")) m = globMatches(v, actual);
      else m = actual.toLowerCase() === v.toLowerCase();
      return neg ? !m : m;
    }
  }
}
