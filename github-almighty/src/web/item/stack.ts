// The read of a pull request's stack (src/daemon/ops/stack.ts) that the breadcrumb (sections/stack.tsx) and the base's
// row (sections/base.tsx) share: useRequest gives both the one result.
import { useRequest } from "@gasho/plugin-sdk";
import type { PullStack } from "../../daemon/ops/stack.ts";
import { readOp } from "../daemon.ts";
import { useRefreshOptions } from "../tabs.ts";
import { useAfterChange, useItem } from "./context.tsx";

export type { PullStack, StackPull } from "../../daemon/ops/stack.ts";

export function useStack() {
  const { machine, where, item } = useItem();
  const { head, base } = item;
  const r = useRequest<PullStack>(head && base ? readOp(machine, "stack", { repo: where.repo, number: where.number, head, base }) : undefined, useRefreshOptions());
  useAfterChange(r.reload);
  return r;
}
