// Lenient tokenizer for the query bar's syntax-highlighting overlay. Unlike the
// parser (queryLang.ts) it never throws, and it emits a segment for EVERY
// character - including whitespace - so the coloured overlay lines up exactly
// with the transparent <input> text on top of it.

export interface Seg {
  text: string;
  cls: string; // "" for whitespace; qh-field / qh-op / qh-bool / qh-str / qh-re / qh-val / qh-text / qh-paren
}

const OP = new Set(["=", "!", "~", ":", "<", ">"]);

function nextIsOp(input: string, from: number): boolean {
  let i = from;
  while (i < input.length && /\s/.test(input[i])) i++;
  return i < input.length && OP.has(input[i]);
}

export function highlightQuery(input: string): Seg[] {
  const segs: Seg[] = [];
  const n = input.length;
  let i = 0;
  let depth = 0; // paren nesting → rainbow colour (p0..p4, cycling)
  let prevOp = false; // previous meaningful token was an operator → the next word is a value
  while (i < n) {
    const c = input[i];
    if (/\s/.test(c)) {
      let j = i;
      while (j < n && /\s/.test(input[j])) j++;
      segs.push({ text: input.slice(i, j), cls: "" });
      i = j;
      continue;
    }
    if (c === "(") {
      segs.push({ text: c, cls: `qh-paren p${depth % 5}` });
      depth++;
      prevOp = false;
      i++;
      continue;
    }
    if (c === ")") {
      depth = depth > 0 ? depth - 1 : 0;
      segs.push({ text: c, cls: `qh-paren p${depth % 5}` });
      prevOp = false;
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && input[j] !== c) {
        if (input[j] === "\\") j++;
        j++;
      }
      if (j < n) j++; // include the closing quote
      segs.push({ text: input.slice(i, j), cls: "qh-str" });
      prevOp = false;
      i = j;
      continue;
    }
    if (c === "/") {
      let j = i + 1;
      while (j < n && input[j] !== "/") {
        if (input[j] === "\\") j++;
        j++;
      }
      if (j < n) j++;
      segs.push({ text: input.slice(i, j), cls: "qh-re" });
      prevOp = false;
      i = j;
      continue;
    }
    if (OP.has(c)) {
      const two = input.slice(i, i + 2);
      const len = two === "!=" || two === "!~" || two === "==" ? 2 : 1;
      segs.push({ text: input.slice(i, i + len), cls: "qh-op" });
      prevOp = true;
      i += len;
      continue;
    }
    // bareword: run until whitespace, paren, quote, slash, or operator char
    let j = i;
    while (j < n && !/\s/.test(input[j]) && !"()\"'/".includes(input[j]) && !OP.has(input[j])) j++;
    const word = input.slice(i, j);
    const lw = word.toLowerCase();
    let cls: string;
    if (lw === "and" || lw === "or" || lw === "not") cls = "qh-bool";
    else if (prevOp) cls = "qh-val";
    else cls = nextIsOp(input, j) ? "qh-field" : "qh-text";
    segs.push({ text: word, cls });
    prevOp = false;
    i = j;
  }
  return segs;
}
