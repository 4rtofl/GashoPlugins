// What the conversation reads of the body, the comments and the reviews besides the item (the operation "comments"): the
// node ids that the changes name them by, which comments bots wrote and which ones gh's login may change, and the
// reactions. They share one read; comments.tsx reads it again after a change.
import { useRequest } from "@gasho/plugin-sdk";
import type { ConversationMeta } from "../../daemon/ops/comments.ts";
import { readOp } from "../daemon.ts";
import { useRefreshOptions } from "../tabs.ts";
import { useItem } from "./context.tsx";

export function useConversationMeta() {
  const { machine, where } = useItem();
  return useRequest<ConversationMeta>(readOp(machine, "comments", { repo: where.repo, number: where.number, kind: where.kind }), useRefreshOptions());
}
