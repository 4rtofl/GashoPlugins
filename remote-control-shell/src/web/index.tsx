// The web part of Remote Control Shell: "シェル" in a session's header, right of "ファイル" (order 400), with the number
// of commands running in the session's folder, and the shell panel it opens (README.md「画面」).
import { SquareTerminal } from "lucide-react";
import { definePlugin, useRequest, type SessionContext } from "@gasho/plugin-sdk";
import type { StatusAnswer } from "../types.ts";
import { ShellPanel } from "./panel";
import "./style.css";

/** The commands running in the session's folder, read every 10 seconds while the header shows. */
function useRunning(c: SessionContext): number | undefined {
  const r = useRequest<StatusAnswer>(
    c.daemon.ready && c.machine.connected ? { machine: c.machine.id, sessionId: c.session.sessionId, method: "status" } : undefined,
    { staleSeconds: 5, refreshSeconds: 10 },
  );
  return r.data && r.data.running > 0 ? r.data.running : undefined;
}

export default definePlugin({
  sessionHeader: [
    {
      id: "shell",
      label: "シェル",
      icon: SquareTerminal,
      title: "このセッションのフォルダーでコマンドを実行する（出力は会話に入らない）",
      order: 450,
      when: (c) => c.daemon.ready,
      panel: { id: "shell" },
      useBadge: useRunning,
    },
  ],
  sessionPanels: { shell: ShellPanel },
});
