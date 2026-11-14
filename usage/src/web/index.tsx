// The web part of the usage plugin: a ring in the line under a session's chat box (P14) with the share of its context
// window in use, which opens a popover with the context window and the Claude.ai plan's usage limits (ring.tsx). It
// needs Gasho's plugin API 1.4: the line under the chat box, the SDK's Popover, and SessionInfo.context.
import { definePlugin } from "@gasho/plugin-sdk";
import { UsageRing } from "./ring";
import "./style.css";

export default definePlugin({
  // Only for sessions whose status line reports the context window: those Gasho started, once they have replied.
  composerFooter: [{ id: "usage", when: (c) => c.session.context !== undefined, component: UsageRing }],
});
