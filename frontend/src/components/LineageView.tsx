import {AliasBadge} from "./AliasBadge";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { stratify, tree, type HierarchyNode } from "d3-hierarchy";
import type { EvidenceSnapshot, FilterField, GraphEdge, GraphNode, LineageTree, QueryOp } from "../api/types";
import { identityGlyph } from "../api/types";
import { backend } from "../api/backend";
import { logError, logInfo } from "../api/log";
import { LineageEventModal } from "./LineageEventModal";
import {LineageEnrichment,LineageFindings,InitiationSummary} from "./LineageAttribution";
import type {LineageAttribution} from "../api/attribution";
import { WorkspaceOverlay } from "./WorkspaceActivity";

interface Props {
  seq: number;
  initialSnapshot?:EvidenceSnapshot;
  eventLabel?: string;
  onClose: () => void;
  onPivot: (field: FilterField, value: string, op: QueryOp) => void;
}

const NODE_W = 360;
const NODE_H = 64;
const GAP_X = 22;
const LEVEL_H = 160;

const MAX_NODES = 600; // hard ceiling on rendered nodes so the graph can't blow up the renderer
const GLYPH_CLS: Record<string, string> = {
  Root: "lg-root", IAMUser: "lg-iam", AssumedRole: "lg-role", AWSService: "lg-svc", FederatedUser: "lg-fed",
};
const GL_FILL: Record<string, string> = {
  Root: "gl-root", IAMUser: "gl-iam", AssumedRole: "gl-role", AWSService: "gl-svc", FederatedUser: "gl-fed",
};
const trunc = (s: string, n: number) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s || "");
const ORIGIN_LABEL: Record<string, string> = {
  sso: "AWS IAM Identity Center (SSO)",
  "service-linked": "Service-linked role",
  service: "AWS service",
};

const tail = (arn: string, sep = "/") => {
  const i = arn.lastIndexOf(sep);
  return i >= 0 ? arn.slice(i + 1) : arn;
};

// The recognizable end of a resource id: the part after the last ARN colon
// (…:key/abcd, …:secret/foo, bucket/obj), or the whole thing when it isn't an ARN.
const resTail = (r: string) => (r.includes(":") ? r.slice(r.lastIndexOf(":") + 1) : r);

function label(n: GraphNode): { primary: string; secondary: string } {
  if (n.kind === "event") return { primary: n.eventName || "event", secondary: n.resource ? resTail(n.resource) : n.eventSource || "" };
  switch (n.identityType) {
    case "Root": return { primary: "root", secondary: n.accountId };
    case "IAMUser": return { primary: n.userName || tail(n.arn), secondary: n.accountId };
    case "AWSService": return { primary: n.invokedBy || n.arn || "AWS service", secondary: "service" };
    case "FederatedUser": return { primary: n.userName || tail(n.arn), secondary: n.accountId };
    default: return { primary: n.roleName || tail(n.roleArn) || "role", secondary: n.sessionName ? `⋯ ${n.sessionName}` : n.accountId };
  }
}

function pivotOf(n: GraphNode): [FilterField, string] | null {
  if (n.identityType === "AssumedRole" && n.roleArn) return ["roleArn", n.roleArn];
  if (n.userName) return ["userName", n.userName];
  return null;
}

export function LineageView(props: Props) {
  return <WorkspaceOverlay onClose={props.onClose}><LineageContent {...props}/></WorkspaceOverlay>;
}

function LineageContent({ seq, initialSnapshot, eventLabel, onClose, onPivot }: Props) {
  const arrowId = useId();
  const [nodes, setNodes] = useState<Map<string, GraphNode>>(new Map());
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [meta, setMeta] = useState<{ currentId: string; rootId: string; notes: string[]; applicable:boolean }>({ currentId: "", rootId: "", notes: [],applicable:false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [attribution,setAttribution]=useState<LineageAttribution|null>(null);
  const snapshotRef = useRef<EvidenceSnapshot | undefined>(undefined);
  const generation = useRef(0);
  const graphRef = useRef({nodes: new Map<string, GraphNode>(), edges: [] as GraphEdge[]});
  const busyRef = useRef(new Set<string>());
  const [expSessions, setExpSessions] = useState<Set<string>>(new Set());
  const [expEvents, setExpEvents] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const view = useRef({ x: 0, y: 0, k: 1 });
  const viewFrame = useRef<number | null>(null);
  const viewportRef = useRef<SVGGElement>(null);
  const [raw, setRaw] = useState<{ title: string; json: string } | null>(null);

  const modalRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const host = modalRef.current?.parentElement;
    const background = Array.from(document.body.children).filter((el): el is HTMLElement => el instanceof HTMLElement && el !== host).map(el => ({el, inert: el.inert}));
    background.forEach(({el}) => { el.inert = true; });
    closeRef.current?.focus({preventScroll: true});
    return () => {
      background.forEach(({el, inert}) => { el.inert = inert; });
      if (previous?.isConnected && !previous.closest('[hidden],[inert]') && previous.getClientRects().length) previous.focus({preventScroll: true});
    };
  }, []);
  const svgRef = useRef<SVGSVGElement>(null);
  const didCenter = useRef(false);

  // Pointer events can arrive much faster than paint. Keep the viewport outside
  // React so moving the graph never re-renders its inspector or node details.
  const moveViewport = useCallback((next: {x: number; y: number; k: number}) => {
    view.current = next;
    if (viewFrame.current !== null) return;
    viewFrame.current = requestAnimationFrame(() => {
      viewFrame.current = null;
      const {x, y, k} = view.current;
      viewportRef.current?.setAttribute("transform", `translate(${x},${y}) scale(${k})`);
    });
  }, []);
  useEffect(() => () => {
    if (viewFrame.current !== null) cancelAnimationFrame(viewFrame.current);
  }, []);

  useEffect(() => {
    const request = ++generation.current;
    setLoading(true); setError(""); setExpSessions(new Set()); setExpEvents(new Set()); setBusy(new Set()); busyRef.current.clear();
    setNodes(new Map()); setEdges([]); setMeta({currentId:"",rootId:"",notes:[],applicable:false});
    snapshotRef.current = undefined;
    graphRef.current = {nodes:new Map(),edges:[]};
    didCenter.current = false;
    setSelected(null);
    setRaw(null);setAttribution(null);
    backend
      .queryLineageGraph(seq,initialSnapshot)
      .then((t) => {
        if (request !== generation.current) return;
        snapshotRef.current = t.snapshot;
        graphRef.current = {nodes:new Map(t.nodes.map(n=>[n.id,n])),edges:t.edges};
        setNodes(new Map(t.nodes.map((n) => [n.id, n])));
        setEdges(t.edges);
        setMeta({ currentId: t.currentId, rootId: t.rootId, notes: t.notes || [],applicable:t.applicable });
        setSelected(t.currentId || null);
        logInfo(`lineage graph opened seq=${seq} nodes=${t.nodes.length} edges=${t.edges.length}`);
      })
      .catch((e) => { if(request===generation.current){setError(String(e?.message || e));logError(`lineage graph load failed seq=${seq}: ${e?.message || e}`)} })
      .finally(() => {if(request===generation.current)setLoading(false)});
    return () => { generation.current++; };
  }, [seq, retry,initialSnapshot]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !raw && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, raw]);

  const laidOut = useMemo(() => {
    const arr = [...nodes.values()];
    if (!arr.length || !meta.rootId) return null;
    const parentOf: Record<string, string> = {};
    for (const e of edges) parentOf[e.child] = e.parent;
    try {
      const root = stratify<GraphNode>()
        .id((d) => d.id)
        .parentId((d) => (d.id === meta.rootId ? "" : parentOf[d.id]))(arr);
      tree<GraphNode>().nodeSize([NODE_W + GAP_X, LEVEL_H])(root);
      return root;
    } catch {
      return null;
    }
  }, [nodes, edges, meta.rootId]);

  const posOf = useCallback(
    (id: string) => {
      let r: { x: number; y: number } | null = null;
      laidOut?.each((d) => {
        if (d.data.id === id) r = { x: (d as HierarchyNode<GraphNode> & { x: number }).x, y: (d as HierarchyNode<GraphNode> & { y: number }).y };
      });
      return r;
    },
    [laidOut]
  );

  useEffect(() => {
    if (loading || didCenter.current || !laidOut) return;
    const cur = posOf(meta.currentId);
    const svg = svgRef.current;
    if (!cur || !svg) return;
    const r = svg.getBoundingClientRect();
    const positions = laidOut.descendants().map(node => node as HierarchyNode<GraphNode> & {x:number;y:number});
    const minX = Math.min(...positions.map(n => n.x)), maxX = Math.max(...positions.map(n => n.x));
    const minY = Math.min(...positions.map(n => n.y)), maxY = Math.max(...positions.map(n => n.y));
    const k = Math.min(1, (r.width - 64) / (maxX - minX + NODE_W), (r.height - 64) / (maxY - minY + NODE_H));
    moveViewport({k, x:r.width/2 - (minX+maxX)*k/2, y:r.height/2 - (minY+maxY)*k/2});
    didCenter.current = true;
  }, [loading, laidOut, posOf, meta.currentId, moveViewport]);

  const merge = (t: LineageTree) => {
    const next = new Map(graphRef.current.nodes);
    const nextEdges = [...graphRef.current.edges];
    const additions = new Map(t.nodes.map(n=>[n.id,n]));
    let omitted = false;
    for (const edge of t.edges) {
      if (nextEdges.some(e=>e.parent===edge.parent && e.child===edge.child)) continue;
      // Do not reparent an existing node or introduce a cycle. Every new node
      // must have a visible parent; the layout never invents missing edges.
      if (!next.has(edge.parent) || next.has(edge.child) || next.size>=MAX_NODES || !additions.has(edge.child)) {omitted=true;continue}
      next.set(edge.child, additions.get(edge.child)!); nextEdges.push(edge);
    }
    graphRef.current = {nodes:next,edges:nextEdges};
    setNodes(next);setEdges(nextEdges);
    const notes = [...(t.notes??[]),...(omitted?["Some expansion links were omitted because they repeat an existing node or exceed the graph limit."]:[])];
    if(notes.length)setMeta(m=>({...m,notes:[...new Set([...m.notes,...notes])]}));
  };
  const withBusy = useCallback(async (id: string, fn: (request: number) => Promise<void>) => {
    if (busyRef.current.has(id)) return;
    const request=generation.current;
    busyRef.current.add(id); setBusy(new Set(busyRef.current));setError("");
    try { await fn(request); }
    catch(e) {if(request===generation.current)setError(String(e))}
    finally {if(request===generation.current){busyRef.current.delete(id);setBusy(new Set(busyRef.current))}}
  }, []);
  const expandSessions = (n: GraphNode) => withBusy(n.id+":s",async request=>{
    if(!snapshotRef.current)throw Error("Graph snapshot unavailable; reload lineage.");
    const t=await backend.queryLineageChildren(n.accessKeyId,snapshotRef.current);
    if(request!==generation.current)return;
    merge(t);setExpSessions(s=>new Set(s).add(n.id));
  });
  const expandEvents = (n: GraphNode) => withBusy(n.id+":e",async request=>{
    if(!snapshotRef.current)throw Error("Graph snapshot unavailable; reload lineage.");
    const t=await backend.queryLineageEvents(n.accessKeyId,snapshotRef.current);
    if(request!==generation.current)return;
    merge(t);setExpEvents(s=>new Set(s).add(n.id));
  });
  const openRaw = useCallback((viaSeq: number, title: string) => withBusy("raw",async request=>{
    if(!snapshotRef.current)throw Error("Graph snapshot unavailable; reload lineage.");
    const json=viaSeq<0 ? attribution?.raw[String(viaSeq)] : await backend.queryLineageRaw(viaSeq,snapshotRef.current);
    if(json===undefined)throw Error("Recovered evidence is unavailable; refresh attribution.");
    if(request===generation.current)setRaw({title,json});
  }), [withBusy,attribution]);

  const incoming = useMemo(() => {
    const m = new Map<string, GraphEdge>();
    for (const e of edges) m.set(e.child, e);
    return m;
  }, [edges]);

  // ---- pan / zoom ----
  const drag = useRef<{ x: number; y: number } | null>(null);
  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 || (e.target as Element).closest(".lgv-g")) return;
    e.preventDefault();
    drag.current = { x: e.clientX - view.current.x, y: e.clientY - view.current.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    moveViewport({ ...view.current, x: e.clientX - d.x, y: e.clientY - d.y });
  };
  const onUp = (e: React.PointerEvent<SVGSVGElement>) => {
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const onWheel = (e: React.WheelEvent) => {
    const svg = svgRef.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const v = view.current;
    const k = Math.min(2.5, Math.max(0.2, v.k * factor));
    const s = k / v.k;
    moveViewport({ k, x: mx - (mx - v.x) * s, y: my - (my - v.y) * s });
  };

  // Build the SVG once per layout/selection - NOT per pan frame. Panning/zooming
  // only mutates the outer <g transform>, so memoizing the ~thousands of node/link
  // elements keeps a drag from reconciling the whole tree every mousemove (which
  // churned enough garbage to crash the WebView2 renderer on big graphs).
  const linkEls = useMemo(() => {
    if (!laidOut) return null;
    return laidOut.links().map((l, i) => {
      const s = l.source as HierarchyNode<GraphNode> & { x: number; y: number };
      const t = l.target as HierarchyNode<GraphNode> & { x: number; y: number };
      const my = (s.y + NODE_H / 2 + (t.y - NODE_H / 2)) / 2;
      const edge = incoming.get(t.data.id);
      const isActivity = t.data.kind === "event";
      return (
        <g key={i}>
          <path
            className={`lgv-link ${isActivity ? "ev" : ""} ${edge?.crossAccount ? "xacct" : ""}`}
            d={`M${s.x},${s.y + NODE_H / 2} C${s.x},${my} ${t.x},${my} ${t.x},${t.y - NODE_H / 2}`}
            markerEnd={`url(#${arrowId})`}
          />
          {!isActivity && edge?.viaEvent && <g className="lgv-edge-label" transform={`translate(${(s.x+t.x)/2},${my})`}>
            <title>{`${edge.viaEvent} · ${edge.viaTime}\n${edge.evidence || "Recorded credential issuance"}`}</title>
            <text textAnchor="middle" y={-6} className="lgv-edge-method">{edge.viaEvent}</text>
            <text textAnchor="middle" y={10} className="lgv-edge-time">{edge.viaTime.replace('T',' ')}</text>
          </g>}
        </g>
      );
    });
  }, [laidOut, incoming, arrowId]);

  const nodeEls = useMemo(() => {
    if (!laidOut) return null;
    return laidOut.descendants().map((d) => {
      const n = d.data;
      const x = (d as HierarchyNode<GraphNode> & { x: number }).x;
      const y = (d as HierarchyNode<GraphNode> & { y: number }).y;
      const lab = label(n);
      if (n.kind === "event") {
        const w = NODE_W - 34;
        return (
          <g key={n.id} className="lgv-g" transform={`translate(${x - w / 2},${y - NODE_H / 2})`} onClick={() => openRaw(n.seq || 0, `${n.eventName} · ${n.eventSource}`)}>
            <title>{`${n.eventName} · ${n.eventSource}${n.resource ? `\n→ ${n.resource}` : ""}\nseq ${n.seq} (click to open)`}</title>
            <rect className="lgv-rect ev" width={w} height={NODE_H} rx={7} />
            <circle cx={13} cy={NODE_H / 2} r={4} className={n.errorCode ? "lgv-dot-err" : "lgv-dot-ok"} />
            <text x={26} y={NODE_H / 2 - 2} className="lgv-nm">{trunc(lab.primary, 20)}</text>
            <text x={26} y={NODE_H / 2 + 12} className="lgv-sb">{trunc(lab.secondary, 22)}</text>
          </g>
        );
      }
      const state = `${n.id === meta.currentId ? "cur" : ""} ${n.id === selected ? "sel" : ""} k-${n.kind}`;
      return (
        <g key={n.id} className="lgv-g" role="button" tabIndex={0} aria-label={`Inspect credential: ${lab.primary}`} transform={`translate(${x - NODE_W / 2},${y - NODE_H / 2})`} onKeyDown={event => {if(event.key === "Enter" || event.key === " "){event.preventDefault();setSelected(n.id)}}} onClick={() => setSelected(n.id)}>
          <title>{n.arn}</title>
          <rect className={`lgv-rect ${state}`} width={NODE_W} height={NODE_H} rx={8} />
          <text x={16} y={NODE_H / 2 + 5} className={`lgv-gl ${GL_FILL[n.identityType] || "gl-other"}`}>{identityGlyph(n.identityType)}</text>
          <text x={32} y={NODE_H / 2 - 3} className="lgv-nm">{trunc(lab.primary, 40)}</text>
          {lab.secondary && <text x={32} y={NODE_H / 2 + 12} className="lgv-sb">{trunc(lab.secondary, 44)}</text>}
          {n.events > 0 && <text x={NODE_W - 12} y={NODE_H / 2 + 4} textAnchor="end" className="lgv-ct">{n.events}</text>}
          {n.originKind === "sso" && <text x={NODE_W - 10} y={13} textAnchor="end" className="lgv-badge b-sso">SSO</text>}
          {n.originKind === "service-linked" && <text x={NODE_W - 10} y={13} textAnchor="end" className="lgv-badge b-slr">service-linked</text>}
        </g>
      );
    });
  }, [laidOut, selected, meta.currentId, openRaw]);

  const sel = selected ? nodes.get(selected) : null;
  const atCap = nodes.size >= MAX_NODES;
  const firstInitiation=useMemo(()=>{let id=meta.currentId,last:GraphEdge|undefined;const seen=new Set<string>();while(!seen.has(id)){seen.add(id);const edge=incoming.get(id);if(!edge)break;last=edge;id=edge.parent}return last},[incoming,meta.currentId]);
  const applyAttribution=useCallback((value:LineageAttribution)=>{
    const t=value.graph;if(t.snapshot?.generation!==snapshotRef.current?.generation||t.snapshot?.maxSeq!==snapshotRef.current?.maxSeq)return;
    generation.current++;busyRef.current.clear();setBusy(new Set());setExpSessions(new Set());setExpEvents(new Set());
    graphRef.current={nodes:new Map(t.nodes.map(n=>[n.id,n])),edges:t.edges};
    didCenter.current=false;setNodes(graphRef.current.nodes);setEdges(t.edges);setMeta({currentId:t.currentId,rootId:t.rootId,notes:t.notes??[],applicable:t.applicable});setSelected(t.currentId||null);setAttribution(value);
  },[]);

  return createPortal(
    <div className="lgv-scrim" onClick={onClose}>
      <div ref={modalRef} className="lgv-modal" role="dialog" aria-modal="true" aria-label="Credential lineage" onClick={(e) => e.stopPropagation()} onKeyDown={event => {
        if (event.key !== "Tab" || raw) return;
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]')).filter(el => el.getClientRects().length);
        const first = items[0], last = items[items.length-1];
        if (event.shiftKey && (document.activeElement === first || !items.includes(document.activeElement as HTMLElement))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !items.includes(document.activeElement as HTMLElement))) { event.preventDefault(); first?.focus(); }
      }}>
        <div className="lgv-bar">
          <span className="lgv-title">Credential lineage</span><span className="lgv-hint">{eventLabel || `Event #${seq}`} · observed evidence, not verified human identity</span>
          <span className="lgv-spacer" />
          <span className="lgv-hint">drag pan · scroll zoom · click a node for details</span>
          <button ref={closeRef} className="lgv-close" onClick={onClose}>✕ Close</button>
        </div>

        {!loading&&snapshotRef.current&&<LineageEnrichment key={`${seq}:${snapshotRef.current.generation}:${snapshotRef.current.maxSeq}`} seq={seq} snapshot={snapshotRef.current} unresolved={meta.applicable&&nodes.get(meta.rootId)?.kind!=="origin"} report={attribution} onResult={applyAttribution}/>}
        {meta.notes.length>0 && <div className="lgv-notes">{meta.notes.map((n,i)=><div key={i} className="lgv-note">{n}</div>)}</div>}
        {error && <div className="lgv-error" role="alert">{error} <button onClick={()=>setRetry(n=>n+1)}>Reload lineage</button></div>}
        {loading ? (
          <div className="lgv-empty">Building lineage…</div>
        ) : (
          <div className="lgv-body">
            {laidOut?<svg ref={svgRef} className="lgv-canvas" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onLostPointerCapture={() => { drag.current = null; }} onWheel={onWheel}>
              <defs><marker id={arrowId} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L0,8 L8,4 Z" className="lgv-arrow"/></marker></defs>
              <g ref={viewportRef} transform="translate(0,0) scale(1)">
                {linkEls}
                {nodeEls}
              </g>
            </svg>:<div className="la-empty-graph">{error?"The graph could not be loaded.":"No credential links are available for this event."}</div>}

              <div className="lgv-detail">
                <InitiationSummary edge={firstInitiation} parent={firstInitiation?nodes.get(firstInitiation.parent):undefined} onOpen={(id,title)=>void openRaw(id,title)}/>
                <LineageFindings report={attribution} rootKey={meta.rootId}/>
                {sel && sel.kind !== "event" && <>
                <div className="lgv-d-head">
                  <span className={`lgv-glyph ${GLYPH_CLS[sel.identityType] || "lg-other"}`}>{identityGlyph(sel.identityType)}</span>
                  <span className="lgv-d-title">{label(sel).primary}</span>
                  <span className={`lg-tag ${sel.kind === "current" ? "ok" : ""}`}>{sel.kind}</span>
                </div>
                {sel.originKind && <div className={`lgv-origin b-${sel.originKind}`}>{ORIGIN_LABEL[sel.originKind] || sel.originKind}</div>}
                {incoming.get(sel.id)?.crossAccount && (
                  <div className="lgv-xacct">⚠ Cross-account - assumed from account {nodes.get(incoming.get(sel.id)!.parent)?.accountId || "another account"}</div>
                )}
                {sel.identityNote && <div className="lgv-cap">{sel.identityNote}</div>}
                {incoming.get(sel.id)?.evidence && <div className="lgv-cap">{incoming.get(sel.id)!.evidence}</div>}
                <dl className="lgv-kv">
                  {sel.invokedBy && (<><dt>service</dt><dd>{sel.invokedBy}</dd></>)}
                  <dt>identity</dt><dd>{sel.identityType}</dd>
                  {sel.arn&&<><dt>ARN</dt><dd>{sel.arn}<AliasBadge kind="arn" value={sel.arn}/></dd></>}
                  {sel.roleArn && (<><dt>role</dt><dd>{sel.roleArn}<AliasBadge kind="arn" value={sel.roleArn}/></dd></>)}
                  {sel.sessionName && (<><dt>session</dt><dd>{sel.sessionName}</dd></>)}
                  {sel.userName && (<><dt>user</dt><dd>{sel.userName}</dd></>)}
                  {sel.accountId && (<><dt>account</dt><dd>{sel.accountId}<AliasBadge kind="account" value={sel.accountId}/></dd></>)}
                  {sel.accessKeyId && (<><dt>access key</dt><dd>{sel.accessKeyId}</dd></>)}
                  {/* "this session" is keyed-session framing; a service/root has no key */}
                  {sel.accessKeyId && (<><dt>this session</dt><dd>{sel.events} event{sel.events === 1 ? "" : "s"}</dd></>)}
                  {sel.roleArn && (sel.roleSessions ?? 0) > 0 && (
                    <><dt>role total</dt><dd>{sel.roleEvents} event{sel.roleEvents === 1 ? "" : "s"} across {sel.roleSessions} session{sel.roleSessions === 1 ? "" : "s"}</dd></>
                  )}
                  <dt>issued keys</dt><dd>{sel.childCount}</dd>
                </dl>
                {sel.events === 0 && (sel.roleEvents ?? 0) > 0 && (
                  <div className="lgv-cap">This specific session key logged no activity - the role is active under {sel.roleSessions} other session{(sel.roleSessions ?? 0) === 1 ? "" : "s"}.</div>
                )}
                <div className="lgv-d-actions">
                  {incoming.get(sel.id)?.viaSeq ? (
                    <button onClick={() => openRaw(incoming.get(sel.id)!.viaSeq, `${incoming.get(sel.id)!.viaEvent} → ${label(sel).primary}`)}>Open issuance event</button>
                  ) : null}
                  {(incoming.get(sel.id)?.evidenceSeqs??[]).filter(s=>s!==incoming.get(sel.id)?.viaSeq).map(s=><button key={s} onClick={()=>openRaw(s,`Linked issuance observation ${s}`)}>Open linked observation {s}</button>)}
                  {pivotOf(sel) && <button onClick={() => { const p = pivotOf(sel)!; onPivot(p[0], p[1], "include"); onClose(); }}>Filter Events to this identity</button>}
                  {atCap ? (
                    <span className="lgv-cap">Graph is at its {MAX_NODES}-node limit - close and re-open on another event to explore further.</span>
                  ) : (
                    <>
                      {sel.accessKeyId && sel.events > 0 && !expEvents.has(sel.id) && (
                        <button onClick={() => expandEvents(sel)}>{busy.has(sel.id + ":e") ? "…" : `Expand ${sel.events} events`}</button>
                      )}
                      {sel.accessKeyId && sel.childCount > 0 && !expSessions.has(sel.id) && (
                        <button onClick={() => expandSessions(sel)}>{busy.has(sel.id + ":s") ? "…" : `Expand ${sel.childCount} issued key${sel.childCount > 1 ? "s" : ""}`}</button>
                      )}
                    </>
                  )}
                </div>
                </>}
              </div>
          </div>
        )}
      </div>
      {raw && <LineageEventModal title={raw.title} json={raw.json} onClose={() => setRaw(null)} onPivot={(field, value, op) => { onPivot(field, value, op); onClose(); }} />}
    </div>,
    document.body
  );
}
