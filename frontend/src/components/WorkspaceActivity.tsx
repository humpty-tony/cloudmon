import {createContext, useContext, useLayoutEffect, type ReactNode} from "react";

// Retained workspaces keep drafts/results mounted, but their body portals must
// follow workspace activation. Outside a retained workspace, behavior is unchanged.
export const WorkspaceActivity = createContext(true);
export const useWorkspaceActive = () => useContext(WorkspaceActivity);

// Unmount the dialog's effects as well as its portal: hidden dialogs must not
// retain global keyboard handlers or finish requests. Dismiss the owner's open
// flag so returning to the retained workspace cannot resurrect the dialog.
export function WorkspaceOverlay({children,onClose}:{children:ReactNode;onClose:()=>void}) {
  const active=useWorkspaceActive();
  useLayoutEffect(()=>{if(!active)onClose()},[active,onClose]);
  return active?children:null;
}
