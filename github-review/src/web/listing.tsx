// The lists of every working server, for the review page and the page of one pull request (a phone): each working
// server's daemon part is asked once a minute while a page shows; the two pages ask the same, so they share the answer.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useCall, useDaemonReady, useMachines, useRequest, type MachineInfo } from "@gasho/plugin-sdk";
import { pageItems, type PageItems } from "../items.ts";
import type { Listing } from "../types.ts";

/** How often the page asks for the lists, in seconds. */
export const ASK_SECONDS = 60;
export const DEFAULT_QUERY = "is:open";

/** What the page knows of one working server's list. */
export interface Source {
  ready: boolean;
  reason?: string;
  listing?: Listing;
  /** What it watches: the list's, or read on its own while no list has come. */
  watched?: string[];
  error?: string;
  refreshing: boolean;
  reload: () => void;
}

/**
 * Asks one working server's daemon part for its list, and tells the page. A component per working server, as hooks
 * cannot be called for a list that changes; it draws nothing.
 */
function ListingSource({ machine, query, freshAsk, onChange }: { machine: MachineInfo; query: string; freshAsk: number; onChange: (id: string, s: Source | undefined) => void }) {
  const daemon = useDaemonReady(machine.id);
  const on = machine.connected && daemon.ready;
  const r = useRequest<Listing>(on ? { machine: machine.id, method: "list", params: { query } } : undefined, { staleSeconds: ASK_SECONDS, refreshSeconds: ASK_SECONDS });
  // gh may fail before any list comes; what it watches is read without gh, so the page can still name them.
  const w = useRequest<string[]>(on && !r.data ? { machine: machine.id, method: "watched" } : undefined, { staleSeconds: 0 });
  const watched = r.data?.watched ?? w.data;
  const call = useCall();
  const { reload: reloadList, loading } = r;
  const { reload: reloadWatched } = w;
  // useRequest leaves out a reload asked while it reads, whose answer may be from before what was just done (a
  // worktree made or removed): it is asked again once that read is over.
  const loadingNow = useRef(loading);
  loadingNow.current = loading;
  const again = useRef(false);
  const reload = useCallback(() => {
    if (loadingNow.current) again.current = true;
    else reloadList();
    reloadWatched();
  }, [reloadList, reloadWatched]);
  useEffect(() => {
    if (loading || !again.current) return;
    again.current = false;
    reloadList();
  }, [loading, reloadList]);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<{ text: string; at: number }>();
  const asked = useRef(freshAsk);
  useEffect(() => {
    if (freshAsk === asked.current || !on) return;
    asked.current = freshAsk;
    let live = true;
    setRefreshing(true);
    // Reads GitHub again; the list asked for next gets what gasho-daemon kept of that.
    void call<Listing>({ machine: machine.id, method: "list", params: { query, fresh: true } }).then((res) => {
      if (!live) return;
      setRefreshing(false);
      if (res.ok) {
        setRefreshError(undefined);
        reload();
      } else setRefreshError({ text: res.error, at: Date.now() });
    });
    return () => {
      live = false;
    };
  }, [freshAsk]);
  useEffect(() => setRefreshError(undefined), [query]);

  // A list read after "更新" failed says the error no longer holds.
  const error = (refreshError && !(r.at !== undefined && r.at > refreshError.at) ? refreshError.text : undefined) ?? r.error;
  useEffect(() => {
    onChange(machine.id, { ready: on, ...(daemon.reason ? { reason: daemon.reason } : {}), listing: r.data, watched, ...(error ? { error } : {}), refreshing, reload });
  }, [machine.id, on, daemon.reason, r.data, watched, error, refreshing, reload, onChange]);
  useEffect(() => () => onChange(machine.id, undefined), [machine.id, onChange]);
  return null;
}

export interface Listings {
  /** The components that ask; draw them anywhere. */
  sourcesEl: ReactNode;
  machines: MachineInfo[];
  sources: Record<string, Source>;
  /** The working servers whose daemon part answers. */
  ready: MachineInfo[];
  page: PageItems<MachineInfo>;
  /** Some working server has not answered yet. */
  pending: boolean;
  refreshing: boolean;
}

/** The lists of every working server for the search words `query`; a new `freshAsk` reads GitHub again. */
export function useListings(query: string, freshAsk: number): Listings {
  const machines = useMachines();
  const [sources, setSources] = useState<Record<string, Source>>({});
  const onSource = useCallback((id: string, s: Source | undefined) => {
    setSources((cur) => {
      if (s) return { ...cur, [id]: s };
      if (!(id in cur)) return cur;
      const next = { ...cur };
      delete next[id];
      return next;
    });
  }, []);
  const ready = machines.filter((m) => m.connected && sources[m.id]?.ready);
  const lists = ready.flatMap((machine) => {
    const listing = sources[machine.id]?.listing;
    return listing ? [{ machine, listing }] : [];
  });
  const page = useMemo(() => pageItems(lists, query), [machines, sources, query]);
  return {
    sourcesEl: machines.map((m) => <ListingSource key={m.id} machine={m} query={query} freshAsk={freshAsk} onChange={onSource} />),
    machines,
    sources,
    ready,
    page,
    pending: ready.some((m) => !sources[m.id]?.listing && !sources[m.id]?.error),
    refreshing: ready.some((m) => sources[m.id]?.refreshing),
  };
}
