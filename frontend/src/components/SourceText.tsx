import { useEffect, useMemo, useRef, useState } from "react";
import { TEXT_PAGE_SIZE, textPage } from "../api/textPage";

function highlight(json: string): string {
  const escaped=json.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  return escaped.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,match=>{
    const kind=match.startsWith('"')?(match.endsWith(':')?'key':'str'):/true|false/.test(match)?'bool':match==='null'?'null':'num';
    return `<span class="j-${kind}">${match}</span>`;
  });
}

/** Bounded source rendering; paging changes only the view, never source bytes. */
export function SourceText({text,json=false,className}:{text:string;json?:boolean;className?:string}) {
  const [page,setPage]=useState(0);
  const body=useRef<HTMLPreElement>(null);
  const total=Math.max(1,Math.ceil(text.length/TEXT_PAGE_SIZE));
  const current=Math.min(page,total-1);
  const content=useMemo(()=>textPage(text,current),[text,current]);
  const html=useMemo(()=>json&&total===1?highlight(content):null,[json,total,content]);
  useEffect(()=>setPage(0),[text]);
  useEffect(()=>{body.current?.scrollTo(0,0)},[current]);
  return <>
    {total>1 && <div className="source-pager">
      <button className="btn-ghost" disabled={current===0} onClick={()=>setPage(current-1)}>Previous text segment</button>
      <span>Segment {current+1} of {total.toLocaleString()} · complete source retained</span>
      <button className="btn-ghost" disabled={current+1>=total} onClick={()=>setPage(current+1)}>Next text segment</button>
    </div>}
    {html!==null?<pre ref={body} className={`source-text ${className??''}`} dangerouslySetInnerHTML={{__html:html}}/>:<pre ref={body} className={`source-text ${className??''}`}>{content}</pre>}
  </>;
}
