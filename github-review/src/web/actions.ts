// What the buttons of a pull request's row do: make its review worktree on a working server, start a session there and
// send the chosen template, staying on the page (the notice offers to open the session); open the worktree it has (its Gasho session, or one started there), or
// start a new session there and open it; remove its review worktree; and send the Agent in its worktree what
// "マージしてもらう", "差し戻す" or "修正してもらう" asks. The daemon part does the git; the page asks the person before
// trusting a folder, before removing, and before asking for a merge.
import type { MachineInfo, Navigation, SessionInfo, useCall, useLaunchSession, useSendInput } from "@gasho/plugin-sdk";
import type { Item as AnyItem, Spot as AnySpot } from "../items.ts";
import { markInstruction } from "../instructions.ts";
import { fillTemplate, type Template } from "../template.ts";
import type { Created, Removed } from "../types.ts";
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

/** Starts a session in a folder; its id, or undefined (with the reason shown) when it did not start. */
async function start(machine: MachineInfo, cwd: string, t: Tools): Promise<string | undefined> {
  const starting: Notice = { text: `${folderName(cwd)} でセッションを起動しています…`, busy: true };
  t.actions.notify(starting);
  let r = await t.launch({ machine: machine.id, cwd });
  if (!r.ok && r.needsTrust) {
    t.actions.notify(undefined);
    if (!(await t.actions.askTrust({ path: cwd, warnings: r.trustWarnings ?? [] }))) return undefined;
    t.actions.notify(starting);
    r = await t.launch({ machine: machine.id, cwd, trust: true });
  }
  if (r.ok) return r.sessionId;
  t.actions.notify({ text: r.error, tone: "danger" });
  return undefined;
}

/** Opens the Gasho session used last in a folder, or one started there. */
async function openIn(machine: MachineInfo, dir: string, t: Tools): Promise<void> {
  const sessionId = sessionsIn(machine, dir)[0]?.sessionId ?? (await start(machine, dir, t));
  if (!sessionId) return;
  t.actions.notify(undefined);
  t.nav.openSession(machine.id, sessionId);
}

/** The notice that a session got what it was sent, with a button to open it: the page stays where it is. */
function sentNotice(machine: MachineInfo, sessionId: string, text: string, t: Tools): void {
  t.actions.notify({ text, action: { label: "セッションを開く", run: () => t.nav.openSession(machine.id, sessionId) } });
}

/**
 * Makes the review worktree of a pull request on a working server, starts a session there and sends the template (none
 * for "何も送らない"). When the worktree turns out to be there already, it takes the Gasho session used last there (or
 * starts one) and sends nothing. Either way the page stays, so the person can go on to other pull requests; the notice
 * offers to open the session.
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
    const sessionId = sessionsIn(machine, r.data.path)[0]?.sessionId ?? (await start(machine, r.data.path, t));
    if (sessionId) sentNotice(machine, sessionId, `#${pr.number} のレビュー用の worktree はもうありました（${folderName(r.data.path)}）。`, t);
    return;
  }
  const sessionId = await start(machine, r.data.path, t);
  if (!sessionId) return;
  if (template) {
    t.actions.notify({ text: `「${template.name}」を送っています…`, busy: true });
    // The verdict's mark is asked for after the template, whatever it says.
    const sent = await t.send({ machine: machine.id, sessionId, text: `${fillTemplate(template.body, pr)}\n${markInstruction(pr)}` });
    if (!sent.ok) {
      t.actions.notify({
        text: `セッションは起動しましたが、「${template.name}」を送れませんでした：${sent.error}`,
        tone: "danger",
        action: { label: "セッションを開く", run: () => t.nav.openSession(machine.id, sessionId) },
      });
      return;
    }
  }
  sentNotice(
    machine,
    sessionId,
    template ? `#${pr.number} のセッションを起動し、「${template.name}」を送りました。` : `#${pr.number} のセッションを起動しました。`,
    t,
  );
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
  sentNotice(machine, sessionId, later ? `「${label}」を送りました。セッションの作業が終わってから入力されます。` : `「${label}」をセッションに送りました。`, t);
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
