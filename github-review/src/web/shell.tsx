// What the review page and the page of one pull request share around the rows' buttons: the tools they use, the
// templates and the settings of the merge, which rows are at work, and the dialogs and the notice they show.
import { useMemo, useState, type ReactNode } from "react";
import { useCall, useLaunchSession, useNavigation, useSendInput, useSetting, type MachineInfo } from "@gasho/plugin-sdk";
import { mergeMethodOf } from "../instructions.ts";
import { parseTemplates } from "../template.ts";
import type { Actions, Item, Notice, Spot, Tools } from "./actions";
import { MergeDialog, RemoveDialog, Toast, TrustDialog } from "./dialogs";
import type { Source } from "./listing";
import type { RowShared } from "./row";

type Question<Q> = (Q & { answer: (yes: boolean) => void }) | undefined;

export function useRowShell({
  sources,
  ready,
  select,
  selected,
}: {
  sources: Record<string, Source>;
  ready: MachineInfo[];
  select?: (item: Item) => void;
  selected?: string;
}): { shared: RowShared; overlays: ReactNode } {
  const nav = useNavigation();
  const call = useCall();
  const launch = useLaunchSession();
  const send = useSendInput();
  const [rawTemplates] = useSetting<string>("templates");
  const templates = useMemo(() => parseTemplates(rawTemplates), [rawTemplates]);
  const [rawMethod] = useSetting<string>("mergeMethod");
  const [rawDelete] = useSetting<boolean>("deleteBranch");
  const merge = useMemo(() => ({ method: mergeMethodOf(rawMethod), deleteBranch: rawDelete !== false }), [rawMethod, rawDelete]);
  const [notice, setNotice] = useState<Notice>();
  const [trust, setTrust] = useState<Question<{ path: string; warnings: string[] }>>();
  const [removing, setRemoving] = useState<Question<{ item: Item; spot: Spot }>>();
  const [merging, setMerging] = useState<Question<{ item: Item; spot: Spot }>>();
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());

  const tools = useMemo<Tools>(() => {
    const actions: Actions = {
      notify: setNotice,
      askTrust: (q) => new Promise<boolean>((resolve) => setTrust({ ...q, answer: resolve })),
      askRemove: (q) => new Promise<boolean>((resolve) => setRemoving({ ...q, answer: resolve })),
      askMerge: (q) => new Promise<boolean>((resolve) => setMerging({ ...q, answer: resolve })),
      reload: (id) => sources[id]?.reload(),
    };
    return { call, launch, send, nav, actions };
  }, [call, launch, send, nav, sources]);

  const shared: RowShared = {
    tools,
    templates,
    busy,
    machines: ready.length > 1,
    merge,
    ...(select ? { select } : {}),
    ...(selected ? { selected } : {}),
    run: (url, work) => {
      setBusy((cur) => new Set(cur).add(url));
      void work()
        .catch((e: unknown) => setNotice({ text: e instanceof Error ? e.message : String(e), tone: "danger" }))
        .finally(() =>
          setBusy((cur) => {
            const next = new Set(cur);
            next.delete(url);
            return next;
          }),
        );
    },
  };

  const answer =
    <Q,>(q: Question<Q>, clear: () => void) =>
    (yes: boolean) => {
      q?.answer(yes);
      clear();
    };
  const overlays = (
    <>
      <TrustDialog question={trust} onAnswer={answer(trust, () => setTrust(undefined))} />
      <RemoveDialog question={removing} onAnswer={answer(removing, () => setRemoving(undefined))} />
      <MergeDialog question={merging} merge={merge} onAnswer={answer(merging, () => setMerging(undefined))} />
      <Toast notice={notice} onClose={() => setNotice(undefined)} />
    </>
  );
  return { shared, overlays };
}
