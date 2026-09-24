import {compareEvidence} from "./compareModel";
self.onmessage=({data}:MessageEvent<{left:string;right:string}>)=>{
  try{self.postMessage({result:compareEvidence(data.left,data.right)})}
  catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)})}
};
