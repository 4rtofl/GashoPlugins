// ⌘K: read the item again, open it on GitHub, and copy its link.
import { ExternalLink, Link, RefreshCw } from "lucide-react";
import type { PaletteCommand } from "../../palette.tsx";
import { useToast } from "../../ui/toast.tsx";
import { useItem } from "../context.tsx";
import type { ItemCommands } from "../palette.tsx";

function useScreenCommands(): PaletteCommand[] {
  const { item, reload } = useItem();
  const toast = useToast();
  const copy = () =>
    void (navigator.clipboard?.writeText(item.url) ?? Promise.reject(new Error("no clipboard"))).then(
      () => toast({ title: "リンクをコピーしました" }),
      () => toast({ title: "リンクをコピーできませんでした", description: "このブラウザーでは、ページからクリップボードに書けません。", tone: "error" }),
    );
  return [
    { id: "reload", label: "再読み込み", icon: RefreshCw, keywords: "reload refresh", run: reload },
    { id: "github", label: "GitHub で開く", icon: ExternalLink, keywords: "open browser", run: () => void window.open(item.url, "_blank", "noopener") },
    { id: "copy", label: "リンクをコピーする", icon: Link, keywords: "copy url link", run: copy },
  ];
}

export default { order: 40, useCommands: useScreenCommands } satisfies ItemCommands;
