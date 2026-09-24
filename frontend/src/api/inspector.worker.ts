import { InspectorDocument, type InspectorRequest, type InspectorResponse } from "./inspectorModel";

let document: InspectorDocument | null = null;
self.onmessage = (event: MessageEvent<InspectorRequest>) => {
  const request = event.data;
  let response: InspectorResponse;
  try {
    if ("json" in request) document = new InspectorDocument(request.json);
    if (!document) throw new Error("Record is not loaded");
    response = {id:request.id,page:document.page("path" in request ? request.path : [], "offset" in request ? request.offset : 0)};
  } catch (error) { response = {id:request.id,error:error instanceof Error ? error.message : String(error)}; }
  self.postMessage(response);
};
