// The web part of Pondering: while Claude works in a session, a line at the end of its conversation, as Claude Code's
// spinner (see pondering.tsx). It needs Gasho's plugin API 1.2: the end of the conversation (P13) and
// useSessionActivity.
import { definePlugin } from "@gasho/plugin-sdk";
import { Pondering } from "./pondering";
import "./style.css";

export default definePlugin({
  // Drawn for every session shown, so that it sees the session start its work (see Pondering); it shows only then.
  conversationEnd: [{ id: "spinner", when: (c) => c.machine.connected, component: Pondering }],
});
