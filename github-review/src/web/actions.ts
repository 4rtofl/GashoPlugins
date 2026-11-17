// What the buttons of a pull request's row do: make its review worktree on a working server, start a session there,
// send the chosen template and open the session; open the worktree it has (its Gasho session, or one started there), or
// start a new session there and open it; remove its review worktree; send the Agent in its worktree what
// "マージしてもらう", "差し戻す" or "修正してもらう" asks; and do the first for many pull requests at once
// ("まとめてレビューさせる"). The daemon part does the git; the page asks the person before trusting a folder, before
// removing, and before asking for a merge.
import { relativeTime, type MachineInfo, type Navigation, type SessionInfo, type useCall, type useLaunchSession, type useSendInput } from "@gasho/plugin-sdk";
import type { Item as AnyItem, Spot as AnySpot } from "../items.ts";
import { reviewInstruction } from "../instructions.ts";
import type { Template } from "../template.ts";
import type { Created, PrRow, Removed } from "../types.ts";
import { reviewProgress, working, type ReviewProgress } from "../verdict.ts";

/** Where a pull request is on one working server: the clone of its repository, and its worktree there. */
export type Spot = AnySpot<MachineInfo>;
/** A pull request of the page, with where it is on every working server that listed it. */
export type Item = AnyItem<MachineInfo>;

/** What a row's button is doing or did, shown at the bottom of the page. */
export interface Notice {
  text: string;
  tone?: "danger";
  /** Still going: the notice stays until it is done. */
  busy?: boolean;
  /** A button in the notice. */
  action?: { label: string; run: () => void };
}

/** What the rows ask of the page. */
export interface Actions {
  notify: (n: Notice | undefined) => void;
  askTrust: (q: { path: string; warnings: string[] }) => Promise<boolean>;
  askRemove: (q: { item: Item; spot: Spot }) => Promise<boolean>;
  /** Before asking the Agent to merge: what it will do. */
  askMerge: (q: { item: Item; spot: Spot }) => Promise<boolean>;
  /** Reads a working server's list again. */
  reload: (machine: string) => void;
}

export interface Tools {
  call: ReturnType<typeof useCall>;
  launch: ReturnType<typeof useLaunchSession>;
  send: ReturnType<typeof useSendInput>;
  nav: Navigation;
  actions: Actions;
}

/** Where the review of a pull request is: from its mark, its head, and the sessions at work in its worktrees. */
export function progressOf({ pr, spots }: Item): ReviewProgress | undefined {
  return reviewProgress(
    pr,
    spots.some((s) => s.worktree && working(s.machine.sessions, s.worktree.path)),
  );
}

const lastUsed = (s: SessionInfo): number => s.lastActivityAt ?? s.startedAt ?? 0;

/** The sessions Gasho started in a folder (or below it), the one used last first: only these open in Gasho. */
export function sessionsIn(machine: MachineInfo, dir: string): SessionInfo[] {
  return machine.sessions.filter((s) => s.managed && (s.cwd === dir || s.cwd.startsWith(`${dir}/`))).sort((a, b) => lastUsed(b) - lastUsed(a));
}

const folderName = (p: string): string => p.split("/").filter(Boolean).pop() ?? p;

/** What starting a session in a folder gave: its id, or why none started (none when the person said no to trusting). */
type Started = { ok: true; sessionId: string; trusted: boolean } | { ok: false; error?: string };

/**
 * Starts a session in a folder, asking the person first when Claude Code does not trust it yet. `trustQuietly`: a folder
 * Claude Code has no warnings about is trusted without asking (the person has said yes once in this run).
 */
async function launchIn(machine: MachineInfo, cwd: string, t: Tools, trustQuietly = false): Promise<Started> {
  let r = await t.launch({ machine: machine.id, cwd });
  let trusted = false;
  if (!r.ok && r.needsTrust) {
    const warnings = r.trustWarnings ?? [];
    if (!(trustQuietly && warnings.length === 0)) {
      t.actions.notify(undefined);
      if (!(await t.actions.askTrust({ path: cwd, warnings }))) return { ok: false };
    }
    trusted = true;
    r = await t.launch({ machine: machine.id, cwd, trust: true });
  }
  return r.ok ? { ok: true, sessionId: r.sessionId, trusted } : { ok: false, error: r.error };
}

/** Starts a session in a folder; its id, or undefined (with the reason shown) when it did not start. */
async function start(machine: MachineInfo, cwd: string, t: Tools): Promise<string | undefined> {
  t.actions.notify({ text: `${folderName(cwd)} でセッションを起動しています…`, busy: true });
  const r = await launchIn(machine, cwd, t);
  if (r.ok) return r.sessionId;
  if (r.error) t.actions.notify({ text: r.error, tone: "danger" });
  return undefined;
}

/** Opens the Gasho session used last in a folder, or one started there. */
async function openIn(machine: MachineInfo, dir: string, t: Tools): Promise<void> {
  const sessionId = sessionsIn(machine, dir)[0]?.sessionId ?? (await start(machine, dir, t));
  if (!sessionId) return;
  t.actions.notify(undefined);
  t.nav.openSession(machine.id, sessionId);
}

/**
 * Makes the review worktree of a pull request on a working server, starts a session there, sends the template (none
 * for "何も送らない") and opens the session. When the worktree turns out to be there already, it only opens.
 */
export async function createWorktree({ pr }: Item, spot: Spot, template: Template | undefined, t: Tools): Promise<void> {
  const { machine } = spot;
  t.actions.notify({ text: `#${pr.number} のレビュー用の worktree を作っています…`, busy: true });
  const r = await t.call<Created>({
    machine: machine.id,
    method: "create",
    params: { repo: pr.repo, number: pr.number },
    summary: `${pr.repo}#${pr.number} のレビュー用の worktree を作る`,
  });
  t.actions.reload(machine.id);
  if (!r.ok) {
    t.actions.notify({ text: r.error, tone: "danger" });
    return;
  }
  if (!r.data.created) {
    await openIn(machine, r.data.path, t);
    return;
  }
  const sessionId = await start(machine, r.data.path, t);
  if (!sessionId) return;
  if (template) {
    t.actions.notify({ text: `「${template.name}」を送っています…`, busy: true });
    const sent = await t.send({ machine: machine.id, sessionId, text: reviewInstruction(template, pr) });
    if (!sent.ok) {
      t.actions.notify({ text: `セッションは起動しましたが、「${template.name}」を送れませんでした：${sent.error}`, tone: "danger" });
      return;
    }
  }
  t.actions.notify(undefined);
  t.nav.openSession(machine.id, sessionId);
}

/** Where one pull request of "まとめてレビューさせる" is. */
export type BatchState = "waiting" | "working" | "done" | "skipped" | "failed";

export interface BatchStep {
  state: BatchState;
  /** Why it was skipped or failed. */
  text?: string;
  /** The session started for it. */
  sessionId?: string;
}

/**
 * "まとめてレビューさせる": for each pull request in turn (git in one clone at a time), makes its review worktree on the
 * working server, starts a session there and sends the template, as "worktree を作る" does, without opening the sessions.
 * A pull request whose worktree turns out to be there already is skipped. Once the person has said yes to trusting a
 * folder, the next folders Claude Code has no warnings about are trusted without asking again.
 */
export async function reviewAll(
  targets: { item: Item; spot: Spot }[],
  template: Template,
  t: Tools,
  onStep: (url: string, step: BatchStep) => void,
): Promise<{ done: number; failed: number; skipped: number }> {
  const count = { done: 0, failed: 0, skipped: 0 };
  let trustQuietly = false;
  const machines = new Set<string>();
  for (const [i, { item, spot }] of targets.entries()) {
    const { pr } = item;
    const { machine } = spot;
    machines.add(machine.id);
    const end = (step: BatchStep & { state: "done" | "skipped" | "failed" }) => {
      count[step.state] += 1;
      onStep(pr.url, step);
    };
    onStep(pr.url, { state: "working" });
    t.actions.notify({ text: `${i + 1} / ${targets.length}：#${pr.number} のレビューを用意しています…`, busy: true });
    const r = await t.call<Created>({
      machine: machine.id,
      method: "create",
      params: { repo: pr.repo, number: pr.number },
      summary: `${pr.repo}#${pr.number} のレビュー用の worktree を作る`,
    });
    if (!r.ok) {
      end({ state: "failed", text: r.error });
      continue;
    }
    if (!r.data.created) {
      end({ state: "skipped", text: `worktree（${folderName(r.data.path)}）がもうあるので、作りませんでした。` });
      continue;
    }
    const started = await launchIn(machine, r.data.path, t, trustQuietly);
    if (!started.ok) {
      end({ state: "failed", text: started.error ?? "フォルダーを信頼しなかったので、セッションを起動しませんでした（worktree は作りました）。" });
      continue;
    }
    trustQuietly ||= started.trusted;
    const sent = await t.send({ machine: machine.id, sessionId: started.sessionId, text: reviewInstruction(template, pr) });
    if (!sent.ok) {
      end({ state: "failed", sessionId: started.sessionId, text: `セッションは起動しましたが、「${template.name}」を送れませんでした：${sent.error}` });
      continue;
    }
    end({ state: "done", sessionId: started.sessionId });
  }
  for (const id of machines) t.actions.reload(id);
  const rest = [count.skipped > 0 ? `${count.skipped} 件は飛ばしました` : "", count.failed > 0 ? `${count.failed} 件はできませんでした` : ""].filter(Boolean);
  t.actions.notify({
    text: `${targets.length} 件のうち ${count.done} 件でレビューを始めました${rest.length > 0 ? `（${rest.join("、")}）` : ""}。`,
    ...(count.failed > 0 ? { tone: "danger" as const } : {}),
  });
  return count;
}

/** Opens the worktree a pull request has on a working server. */
export async function openWorktree(spot: Spot, t: Tools): Promise<void> {
  if (spot.worktree) await openIn(spot.machine, spot.worktree.path, t);
}

/** Starts a new session in the worktree a pull request has on a working server (not the one used last), and opens it. */
export async function newSessionIn(spot: Spot, t: Tools): Promise<void> {
  if (!spot.worktree) return;
  const sessionId = await start(spot.machine, spot.worktree.path, t);
  if (!sessionId) return;
  t.actions.notify(undefined);
  t.nav.openSession(spot.machine.id, sessionId);
}

/**
 * Sends the Agent in a pull request's worktree on a working server what a row's button asks (`text`), in the Gasho
 * session used last there, or one started there. A session at work gets it once it is done (Gasho keeps it till then).
 */
export async function askAgent(spot: Spot, label: string, text: string, t: Tools): Promise<void> {
  const dir = spot.worktree?.path;
  if (!dir) return;
  const { machine } = spot;
  const session = sessionsIn(machine, dir)[0];
  const sessionId = session?.sessionId ?? (await start(machine, dir, t));
  if (!sessionId) return;
  t.actions.notify({ text: `「${label}」を送っています…`, busy: true });
  const sent = await t.send({ machine: machine.id, sessionId, text });
  if (!sent.ok) {
    t.actions.notify({ text: `「${label}」を送れませんでした：${sent.error}`, tone: "danger" });
    return;
  }
  const later = session && session.status !== "idle";
  t.actions.notify({
    text: later ? `「${label}」を送りました。セッションの作業が終わってから入力されます。` : `「${label}」をセッションに送りました。`,
    action: { label: "セッションを開く", run: () => t.nav.openSession(machine.id, sessionId) },
  });
}

/** Removes a pull request's review worktree and its local branch, once the person agrees. */
export async function removeWorktree(item: Item, spot: Spot, t: Tools): Promise<void> {
  const { pr } = item;
  if (!spot.worktree?.review || !(await t.actions.askRemove({ item, spot }))) return;
  t.actions.notify({ text: `${folderName(spot.worktree.path)} を片付けています…`, busy: true });
  const r = await t.call<Removed>({
    machine: spot.machine.id,
    method: "remove",
    params: { repo: pr.repo, number: pr.number },
    summary: `${pr.repo}#${pr.number} のレビュー用の worktree を片付ける`,
  });
  t.actions.reload(spot.machine.id);
  t.actions.notify(
    r.ok
      ? { text: `${folderName(r.data.path)} を片付けました${r.data.branch ? `（ローカルのブランチ ${r.data.branch} も消しました）` : ""}。` }
      : { text: r.error, tone: "danger" },
  );
}

/** "totosuki が 3日前に開いた": who opened a pull request, and when. */
export function openedText(pr: Pick<PrRow, "author" | "createdAt">, now: number): string {
  const when = pr.createdAt ? relativeTime(Date.parse(pr.createdAt), now) : undefined;
  return [pr.author ? `${pr.author} が` : undefined, when ? `${when}に開いた` : "開いた"].filter(Boolean).join(" ");
}
