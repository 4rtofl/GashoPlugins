// The Packages panels: the packages whose repository is the session's (kind, visibility, versions, last update), and
// one package with its versions (a container's tags) and the command that installs the newest.
import { ArrowLeft, Box, Container } from "lucide-react";
import { relativeTime, useNavigation, useNow, type PanelProps } from "@gasho/plugin-sdk";
import type { Package, PackageDetail, Packages, PackageType } from "../types.ts";
import { CommandLine, Empty, LoadedAt, MissingScopeNote, PanelFrame, PanelRepoTabs, Status, usePanelRepo, useRead } from "./common";

const TYPE: Record<PackageType, string> = {
  npm: "npm",
  container: "コンテナー",
  maven: "Maven",
  rubygems: "RubyGems",
  nuget: "NuGet",
  docker: "Docker",
};

const VISIBILITY: Record<string, string> = { public: "公開", private: "非公開", internal: "組織内" };

const PACKAGE_TYPES = Object.keys(TYPE) as PackageType[];

export function PackagesPanel({ machine, session, params }: PanelProps) {
  const nav = useNavigation();
  const now = useNow(60_000);
  const { noRepo, where, github } = usePanelRepo(session, params);
  const r = useRead<Packages>(machine, session, "packages", noRepo ? undefined : where);
  const data = r.data;
  const open = (p: Package) => ({ ...where, type: p.type, name: p.name });
  return (
    <PanelFrame
      title="Packages"
      github={github}
      cwd={session.cwd}
      href={github ? `${github.url}/packages` : undefined}
      r={r}
      disabled={!machine.connected || noRepo}
    >
      <PanelRepoTabs session={session} params={params} panel="packages" />
      <div className="space-y-3">
        <Status machine={machine} noRepo={noRepo} error={r.error} loading={!data && r.loading} />
        {data?.missing && <MissingScopeNote missing={data.missing} what="Packages" machine={machine} />}
        {data &&
          !data.missing &&
          (data.packages.length === 0 ? (
            <Empty>このリポジトリのパッケージはありません。</Empty>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
              {data.packages.map((p) => (
                <li key={`${p.type}/${p.name}`}>
                  <a
                    href={nav.panelHref("package", open(p))}
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                      e.preventDefault();
                      nav.openPanel("package", open(p));
                    }}
                    className="flex gap-2.5 px-3 py-2.5 hover:bg-surface-raised"
                  >
                    <PackageIcon type={p.type} />
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-sm leading-snug break-all">{p.name}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
                        <span>{TYPE[p.type]}</span>
                        {p.visibility && <span>{VISIBILITY[p.visibility] ?? p.visibility}</span>}
                        {p.versions !== undefined && <span>{p.versions} 版</span>}
                        {p.updatedAt && <span title={new Date(p.updatedAt).toLocaleString("ja-JP")}>更新 {relativeTime(Date.parse(p.updatedAt), now)}</span>}
                      </div>
                    </div>
                  </a>
                </li>
              ))}
            </ul>
          ))}
        {data?.errors && <p className="text-xs text-muted-foreground">{data.errors.map((t) => TYPE[t as PackageType] ?? t).join("、")} のパッケージは読めませんでした。</p>}
        <LoadedAt at={r.at} />
      </div>
    </PanelFrame>
  );
}

function PackageIcon({ type }: { type: PackageType }) {
  const Icon = type === "container" || type === "docker" ? Container : Box;
  return <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-sky-400" />;
}

export function PackagePanel({ machine, session, params }: PanelProps) {
  const nav = useNavigation();
  const now = useNow(60_000);
  const { where, github } = usePanelRepo(session, params);
  const type = PACKAGE_TYPES.find((t) => t === params.type);
  const name = params.name && params.name.length <= 200 ? params.name : undefined;
  const r = useRead<PackageDetail>(machine, session, "package", type && name ? { ...where, type, name } : undefined);
  const data = r.data;
  return (
    <PanelFrame
      title={name ?? "パッケージ"}
      github={github}
      cwd={session.cwd}
      href={data?.package.url}
      r={r}
      disabled={!machine.connected || !type || !name}
    >
      <button type="button" onClick={() => nav.back({ id: "packages", params: where })} className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" />
        Packages の一覧
      </button>
      <div className="space-y-4">
        {(!type || !name) && <p className="text-sm text-red-400">パッケージの指定が正しくありません。</p>}
        <Status machine={machine} error={r.error} loading={!data && r.loading && Boolean(type && name)} />
        {data?.missing && <MissingScopeNote missing={data.missing} what="Packages" machine={machine} />}
        {data && !data.missing && (
          <>
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
              <span>{TYPE[data.package.type]}</span>
              {data.package.visibility && <span>{VISIBILITY[data.package.visibility] ?? data.package.visibility}</span>}
              {data.package.versions !== undefined && <span>{data.package.versions} 版</span>}
            </div>
            {data.install && (
              <section className="space-y-1.5">
                <h3 className="text-xs font-medium text-muted-foreground">新しい版を入れる</h3>
                <CommandLine command={data.install} />
                {data.package.type === "npm" && (
                  <p className="text-xs text-muted-foreground">GitHub Packages から入れるには、read:packages の権限のあるトークンを ~/.npmrc に書いておきます。</p>
                )}
              </section>
            )}
            <section className="space-y-1.5">
              <h3 className="text-xs font-medium text-muted-foreground">{data.package.type === "container" ? "版（タグ）" : "版"}</h3>
              {data.versions.length === 0 ? (
                <Empty>版はありません。</Empty>
              ) : (
                <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                  {data.versions.map((v) => (
                    <li key={v.id} className="flex items-start gap-3 px-3 py-2 text-xs">
                      <div className="min-w-0 flex-1">
                        {v.tags ? (
                          v.tags.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {v.tags.map((t) => (
                                <span key={t} className="rounded-full border border-border px-1.5 py-px font-mono">
                                  {t}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">タグなし</span>
                          )
                        ) : (
                          <span className="font-mono text-sm">{v.name}</span>
                        )}
                        {v.tags && (
                          <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground" title={v.name}>
                            {v.name.replace(/^(sha256:.{12}).*$/, "$1…")}
                          </p>
                        )}
                      </div>
                      {v.createdAt && (
                        <span className="shrink-0 text-muted-foreground" title={new Date(v.createdAt).toLocaleString("ja-JP")}>
                          {relativeTime(Date.parse(v.createdAt), now)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {data.truncated && <p className="text-xs text-muted-foreground">新しいものから {data.versions.length} 版を表示しています。すべては GitHub で見られます。</p>}
            </section>
          </>
        )}
        <LoadedAt at={r.at} />
      </div>
    </PanelFrame>
  );
}
