// The page "GitHub" of the sidebar (P1, P2): the open issues and pull requests of a repository, without opening one of
// its worktrees first. The repositories are those registered with a working server and those Gasho's sessions work in.
// A row opens the item's screen in a worktree of the repository the sidebar has: the main one of a registered
// repository, else the worktree of its session used last; from there #92's button makes the item's own worktree.
import { ExternalLink } from "lucide-react";
import { cn, useDaemonReady, useMachines, useNavigation, usePluginState, type PageProps } from "@gasho/plugin-sdk";
import { RepoItems } from "./list.tsx";
import { repoPlaces, type RepoPlace } from "./places.ts";
import { Alert } from "./ui/alert.tsx";
import { buttonClass } from "./ui/button.tsx";
import { ToastProvider } from "./ui/toast.tsx";

export function GitHubPage(_: PageProps) {
  return (
    <ToastProvider>
      <Page />
    </ToastProvider>
  );
}

function Page() {
  const machines = useMachines();
  const places = repoPlaces(machines);
  const [chosen, setChosen] = usePluginState<string>("page:repo", "");
  const place = places.find((p) => p.key === chosen) ?? places[0];
  const several = new Set(places.map((p) => p.machine.id)).size > 1;
  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-5 md:px-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">GitHub</h1>
          <p className="text-sm text-muted-foreground">リポジトリの Open な Issue と Pull request</p>
        </div>
        {place && (
          <a href={place.url} target="_blank" rel="noreferrer" className={buttonClass("ghost", "xs")}>
            GitHub <ExternalLink />
          </a>
        )}
      </header>
      {places.length === 0 ? (
        <Alert>GitHub のリポジトリがまだありません。サイドバーの worktree の一覧からリポジトリを登録するか、リポジトリのフォルダーでセッションを起動してください。</Alert>
      ) : (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="リポジトリ">
          {places.map((p) => (
            <button
              key={p.key}
              type="button"
              aria-pressed={p.key === place?.key}
              onClick={() => setChosen(p.key)}
              className={cn(
                "h-8 rounded-lg border px-3 text-xs transition-colors",
                p.key === place?.key ? "border-foreground/30 bg-surface-raised font-medium text-foreground" : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {p.repo}
              {several && <span className="ml-1.5 text-muted-foreground">{p.machine.name}</span>}
            </button>
          ))}
        </div>
      )}
      {place && <PlaceItems key={place.key} place={place} />}
    </div>
  );
}

function PlaceItems({ place }: { place: RepoPlace }) {
  const daemon = useDaemonReady(place.machine.id);
  const nav = useNavigation();
  const at = { machine: place.machine.id, path: place.path };
  if (!daemon.ready) return <Alert tone="warning">{daemon.reason ?? `${place.machine.name} で github-almighty の daemon の部分が動いていません。`}</Alert>;
  return (
    <RepoItems
      machine={place.machine.id}
      repo={place.repo}
      href={(i) => nav.worktreeHref("item", { kind: i.kind, number: String(i.number) }, at)}
      open={(i) => nav.openWorktreeView("item", { kind: i.kind, number: String(i.number) }, at)}
    />
  );
}
