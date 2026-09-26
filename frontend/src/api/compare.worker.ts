import {compareEvidence,readComparisonValue} from "./compareModel";
self.onmessage=({data}:MessageEvent<{left:string;right:string}|{json:string;path:string[]}>)=>{
  try{self.postMessage("json" in data?{json:readComparisonValue(data.json,data.path)}:{result:compareEvidence(data.left,data.right)})}
  catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)})}
};
