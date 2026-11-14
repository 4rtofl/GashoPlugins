// Calls of the daemon part's operations (src/daemon/ops): a read through the method "read", a change through "write".
import { useCall, type CallResult, type RequestTarget } from "@gasho/plugin-sdk";

/** A read of the operation `op` on the working server `machine`, for useRequest. */
export const readOp = (machine: string, op: string, params: Record<string, unknown> = {}): RequestTarget => ({ machine, method: "read", params: { op, ...params } });

/** Runs the operation `op` that changes something; `summary` goes into Gasho's operation log. */
export function useWriteOp() {
  const call = useCall();
  return (machine: string, op: string, params: Record<string, unknown>, summary: string): Promise<CallResult<unknown>> => call({ machine, method: "write", params: { op, ...params }, summary });
}
