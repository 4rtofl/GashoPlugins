// Calls of the daemon part's operations (src/daemon/ops): a read through the method "read", a change through "write".
import { useCall, type CallResult, type RequestTarget } from "@gasho/plugin-sdk";

/** A read of the operation `op` on the working server `machine`, for useRequest. */
export const readOp = (machine: string, op: string, params: Record<string, unknown> = {}): RequestTarget => ({ machine, method: "read", params: { op, ...params } });

/**
 * The reload button: tells the daemon part to read `repo` again from GitHub (the operation "fresh"), then `reload`s, so
 * that the reads it makes use nothing gasho-daemon kept from before the press.
 */
export function useFreshReload(machine: string, repo: string | undefined, reload: () => void): () => void {
  const call = useCall();
  return () => {
    if (!repo) return reload();
    void call(readOp(machine, "fresh", { repo })).finally(reload);
  };
}

/** Runs the operation `op` that changes something; `summary` goes into Gasho's operation log. */
export function useWriteOp() {
  const call = useCall();
  return (machine: string, op: string, params: Record<string, unknown>, summary: string): Promise<CallResult<unknown>> => call({ machine, method: "write", params: { op, ...params }, summary });
}
