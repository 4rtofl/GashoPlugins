// The web part of OK: once Claude has replied in a session, buttons above the chat box with the prompts the person is
// likely to send next (suggestions.tsx). It uses the end of the conversation (P13, plugin API 1.2), which is right above
// the chat box, and useSendInput (the permission session.input).
import { definePlugin, type SessionContext } from "@gasho/plugin-sdk";
import { Suggestions } from "./suggestions";
import "./style.css";

/** SessionInfo.agent (plugin API 1.16; absent means Claude Code), which the SDK this repository builds with lacks. */
const agentOf = (c: SessionContext) => (c.session as { agent?: string }).agent ?? "claude";

/** Sessions Gasho can type into, of Claude Code, waiting for the person after a reply. */
export const shows = (c: SessionContext) =>
  c.machine.connected && c.daemon.ready && c.session.managed === true && agentOf(c) === "claude" && c.session.status === "idle";

export default definePlugin({
  conversationEnd: [{ id: "suggestions", order: 900, when: shows, component: Suggestions }],
});
