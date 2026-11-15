import assert from "node:assert/strict";
import { test } from "node:test";
import type { DaemonContext } from "@gasho/plugin-sdk/daemon";
import { dispatch, opsByName, type Op } from "../src/daemon/op.ts";

test("an operation runs by its file's name, and one that writes only through the method that is logged", async () => {
  const ran: string[] = [];
  const op = (kind: Op["kind"], name: string): { default: Op } => ({ default: { kind, run: async (p) => (ran.push(`${name}:${String(p.n)}`), name) } });
  const ops = opsByName({ "./ops/items.ts": op("read", "items"), "./ops/remove.ts": op("write", "remove") });
  const ctx = {} as DaemonContext;
  assert.equal(await dispatch(ops, "read", { op: "items", n: 1 }, ctx), "items");
  assert.equal(await dispatch(ops, "write", { op: "remove", n: 2 }, ctx), "remove");
  // "remove" changes only what the daemon part keeps (no ctx.github.write that would refuse): the kind check stops it.
  await assert.rejects(dispatch(ops, "read", { op: "remove", n: 3 }, ctx));
  await assert.rejects(dispatch(ops, "read", { op: "missing" }, ctx));
  await assert.rejects(dispatch(ops, "read", {}, ctx));
  assert.deepEqual(ran, ["items:1", "remove:2"]);
});
