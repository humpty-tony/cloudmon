import type { FieldPage, InspectorRequest, InspectorResponse } from "./inspectorModel";

export class InspectorClient {
  private worker = new Worker(new URL("./inspector.worker.ts", import.meta.url), {type:"module"});
  private nextID = 0;
  private pending = new Map<number, {resolve:(page:FieldPage)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  private closed = false;
  constructor() {
    this.worker.onmessage = ({data}: MessageEvent<InspectorResponse>) => {
      const pending = this.pending.get(data.id);
      if (!pending) return;
      this.pending.delete(data.id); clearTimeout(pending.timer);
      if (data.page) pending.resolve(data.page);
      else pending.reject(new Error(data.error || "Could not prepare this field page"));
    };
    this.worker.onerror = event => { event.preventDefault(); this.dispose("Could not prepare this record. Open Raw JSON or retry."); };
    this.worker.onmessageerror = () => this.dispose("Could not read the prepared fields. Open Raw JSON or retry.");
  }
  request(payload: {json:string} | {path:string[];offset:number}): Promise<FieldPage> {
    if (this.closed) return Promise.reject(new Error("Record viewer is closed. Retry to reopen it."));
    const id = ++this.nextID;
    return new Promise((resolve,reject) => {
      const timer = setTimeout(() => this.dispose("Preparing this record took too long. Open Raw JSON or retry."), 15000);
      this.pending.set(id,{resolve,reject,timer});
      try { this.worker.postMessage({...payload,id} satisfies InspectorRequest); }
      catch { this.dispose("Could not prepare this record. Open Raw JSON or retry."); }
    });
  }
  dispose(message = "Record viewer closed") {
    this.closed = true; this.worker.terminate();
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error(message)); }
    this.pending.clear();
  }
}
