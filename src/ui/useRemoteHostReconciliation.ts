import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { canHostRemoteServer, getRemoteHostStatus, type RemoteServerInfo } from "../platform";

type RemoteHostReconciliationOptions = {
  active: boolean;
  remoteBrowser: boolean;
  transitionRef: MutableRefObject<boolean>;
  setRemoteServer: Dispatch<SetStateAction<RemoteServerInfo | null>>;
  setRemoteBannerVisible: Dispatch<SetStateAction<boolean>>;
};

export function useRemoteHostReconciliation({ active, remoteBrowser, transitionRef, setRemoteServer, setRemoteBannerVisible }: RemoteHostReconciliationOptions) {
  useEffect(() => {
    if (!active || remoteBrowser || !canHostRemoteServer()) return;
    let mounted = true;
    let pending = false;
    const reconcile = async () => {
      if (!mounted || pending || transitionRef.current) return;
      pending = true;
      try {
        const status = await getRemoteHostStatus();
        if (!mounted) return;
        if (status.state === "running" && status.info) {
          setRemoteServer((current) => {
            if (!current) return current;
            const next = { ...current, ...status.info, readiness: status.info.readiness ?? current.readiness };
            return JSON.stringify(next) === JSON.stringify(current) ? current : next;
          });
        } else if (status.state === "stopped") {
          setRemoteServer(null);
          setRemoteBannerVisible(false);
        }
      } catch {
        // Read-only reconciliation must never disturb the accepted host lifecycle.
      } finally {
        pending = false;
      }
    };
    const timer = window.setInterval(() => void reconcile(), 3000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, [active, remoteBrowser, setRemoteBannerVisible, setRemoteServer, transitionRef]);
}
