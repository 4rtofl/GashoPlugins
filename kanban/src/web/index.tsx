// The web part of the kanban plugin: "カンバン" in the sidebar (P1), and its page (P2) with the board of the watched
// repositories of every working server.
import { SquareKanban } from "lucide-react";
import { definePlugin } from "@gasho/plugin-sdk";
import { KanbanPage } from "./board";
import "./style.css";

export default definePlugin({
  sidebar: [{ id: "board", label: "カンバン", icon: SquareKanban, page: { id: "board" } }],
  pages: { board: KanbanPage },
});
