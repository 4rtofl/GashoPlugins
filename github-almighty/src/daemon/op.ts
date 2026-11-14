// One operation of the daemon part is one file in ops/, named after it. The screen calls it through the method "read"
// or "write" of gasho-plugin.json with { op: <its name>, ... }, so that a new operation is a new file and never a new
// line of gasho-plugin.json, which operations added side by side would all change.
import { PluginError, type DaemonContext } from "@gasho/plugin-sdk/daemon";
import { objArg } from "./gh.ts";

export interface Op {
  /** read: only reads. write: changes GitHub or what is kept, and Gasho's operation log has the call. */
  kind: "read" | "write";
  run(params: Record<string, unknown>, ctx: DaemonContext): Promise<unknown>;
}

/** The operations of ops/*.ts by their file names: "./ops/items.ts" is "items". */
export function opsByName(modules: Record<string, { default: Op }>): Map<string, Op> {
  return new Map(Object.entries(modules).map(([file, m]) => [path(file), m.default]));
}

const path = (file: string): string => file.replace(/^.*\//, "").replace(/\.ts$/, "");

/** Runs the operation a call names, when it is of the method's kind: a write never runs outside the operation log. */
export async function dispatch(ops: Map<string, Op>, kind: Op["kind"], params: unknown, ctx: DaemonContext): Promise<unknown> {
  const p = objArg(params);
  const op = typeof p.op === "string" ? ops.get(p.op) : undefined;
  if (!op) throw new PluginError("github-almighty の daemon の部分に、この操作がありません。working server の github-almighty を新しくしてください。");
  if (op.kind !== kind) throw new PluginError(`操作「${String(p.op)}」は ${op.kind} で呼んでください。`);
  return op.run(p, ctx);
}
