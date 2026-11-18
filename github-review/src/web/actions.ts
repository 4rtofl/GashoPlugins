// What the buttons of a pull request's row do: make its review worktree on a working server, start a session there and
// send the chosen template, staying on the page (the notice offers to open the session); open the worktree it has (its
// Gasho session, or one started there), or start a new session there and open it; remove its review worktree; and send
// the Agent in its worktree what "マージしてもらう", "差し戻す" or "修正してもらう" asks, and remove its review worktree
// once a merge or a send-back asked with "終わったら片付ける" is done (cleanup.ts; shell.tsx decides when). Before
// sending, it switches the session's effort level (xhigh for the review, medium to merge or send back). The daemon part
// does the git; the page asks the person before trusting a folder, before removing, and before asking for a merge or a
// send-back. The session a review was sent to is removed once it has posted the result (review-session.ts).
import {
  type EffortLevel,
  type MachineInfo,
  type Navigation,
  type SessionInfo,
  type useCall,
  type useLaunchSession,
  type useRemoveSession,
  type useRemoveWorktree,
  type useSendInput,
} from "@gasho/plugin-sdk";
import { cleanable, changesProblem, type CleanupKind } from "../cleanup.ts";
import type { Item as AnyItem, Spot as AnySpot } from "../items.ts";
import { effortFor, markInstruction, REVIEW_EFFORT } from "../instructions.ts";
import { fillTemplate, type Template } from "../template.ts";
import type { Created, Place, PrRow, Removed } from "../types.ts";
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
  /**
   * Before asking the Agent to merge or to send it back: what it will do, and whether to remove the review worktree
   * once it is done. Undefined when the person does not ask.
   */
  askAgentFor: (q: { kind: CleanupKind; item: Item; spot: Spot }) => Promise<{ cleanup: boolean } | undefined>;
  /** Reads a working server's list again. */
  reload: (machine: string) => void;
  /** Reads a working server's list from GitHub again, as "更新" does; done once the list that gives is asked for. */
  refresh: (machine: string) => Promise<void>;
}

export interface Tools {
  call: ReturnType<typeof useCall>;
  launch: ReturnType<typeof useLaunchSession>;
  send: ReturnType<typeof useSendInput>;
  remove: ReturnType<typeof useRemoveWorktree>;
  removeSession: ReturnType<typeof useRemoveSession>;
  nav: Navigation;
  actions: Actions;
}

/** Where the review of a pull request is: from its mark, its head, and the sessions at work in its worktrees. */
export function progressOf(item: Item): ReviewProgress | undefined {
  return reviewProgress(item.pr, workingIn(item));
}

/** A session in one of a pull request's worktrees works on something (verdict.ts working). */
export function workingIn({ spots }: Item): boolean {
  return spots.some((s) => s.worktree && working(s.machine.sessions, s.worktree.path));
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
 * for "何も送らない") at the effort level of a review. When the worktree turns out to be there already, it takes the
 * Gasho session used last there (or starts one) and sends nothing. Either way the page stays, so the person can go on to
 * other pull requests; the notice offers to open the session, and says why when the effort level could not be switched.
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
  if (template && !(await sendTemplate(pr, machine, sessionId, template, t))) return;
  sentNotice(
    machine,
    sessionId,
    template ? `#${pr.number} のセッションを起動し、「${template.name}」を送りました。` : `#${pr.number} のセッションを起動しました。`,
    t,
  );
}

/**
 * Sends a session the template, with the verdict's mark asked for after it whatever it says, at the effort level of a
 * review. False (with the reason shown) when it did not go, or went without the effort level.
 */
async function sendTemplate(pr: Item["pr"], machine: MachineInfo, sessionId: string, template: Template, t: Tools): Promise<boolean> {
  t.actions.notify({ text: `「${template.name}」を送っています…`, busy: true });
  // Before it is sent, so that the result cannot come first. Without it the review goes on, and the session stays.
  await t.call({
    machine: machine.id,
    method: "reviewSession",
    params: { action: "track", sessionId, repo: pr.repo, number: pr.number, ...(pr.mark ? { before: pr.mark.url } : {}) },
    summary: `${pr.repo}#${pr.number} のレビューの結果を投稿したら、セッションを削除する`,
  });
  const sent = await t.send({
    machine: machine.id,
    sessionId,
    text: `${fillTemplate(template.body, pr)}\n${markInstruction(pr)}`,
    ...effortFor(machine, REVIEW_EFFORT),
  });
  const open = { label: "セッションを開く", run: () => t.nav.openSession(machine.id, sessionId) };
  if (!sent.ok) {
    await forgetSession(machine, sessionId, t);
    t.actions.notify({ text: `セッションは起動しましたが、「${template.name}」を送れませんでした：${sent.error}`, tone: "danger", action: open });
    return false;
  }
  if (sent.data.warning) {
    t.actions.notify({ text: `「${template.name}」を送りました。${sent.data.warning}`, tone: "danger", action: open });
    return false;
  }
  return true;
}

/** The session stays: it did not get the review, or it was given other work. */
async function forgetSession(machine: MachineInfo, sessionId: string, t: Tools): Promise<void> {
  await t.call({ machine: machine.id, method: "reviewSession", params: { action: "forget", sessionId }, summary: "レビューのセッションを自動では削除しない" });
}

/**
 * Removes the session a review was sent to, now that it has posted the result and is at rest (review-session.ts); first
 * claimed from the daemon part, so that one page does it. It is tried once: a session that cannot be removed stays.
 */
export async function removeFinishedSession(pr: Pick<PrRow, "repo" | "number">, machine: MachineInfo, sessionId: string, t: Tools): Promise<void> {
  const claim = await t.call<{ claimed: boolean }>({
    machine: machine.id,
    method: "reviewSession",
    params: { action: "claim", sessionId },
    summary: `${pr.repo}#${pr.number} のレビューのセッションを削除し始める`,
  });
  if (!claim.ok || !claim.data.claimed) return;
  const r = await t.removeSession({ machine: machine.id, sessionId });
  await forgetSession(machine, sessionId, t);
  t.actions.notify(
    r.ok
      ? { text: `#${pr.number} のレビューの結果を投稿したので、セッションを削除しました。` }
      : { text: `#${pr.number} のレビューのセッションを削除できませんでした：${r.error}`, tone: "danger" },
  );
}

/**
 * "レビューする" on my own pull request, whose worktree is there already (the one I made it in): starts a new session
 * there, apart from the one that made the changes, and sends it the template as "worktree を作る" does. The page stays.
 */
export async function reviewIn({ pr }: Item, spot: Spot, template: Template, t: Tools): Promise<void> {
  if (!spot.worktree) return;
  const { machine } = spot;
  const sessionId = await start(machine, spot.worktree.path, t);
  if (!sessionId) return;
  if (await sendTemplate(pr, machine, sessionId, template, t)) sentNotice(machine, sessionId, `#${pr.number} のレビューのセッションを起動し、「${template.name}」を送りました。`, t);
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
 * session used last there, or one started there, switching its effort level first (none: it keeps its own). A session
 * at work gets it once it is done (Gasho keeps it till then).
 */
export async function askAgent(spot: Spot, label: string, text: string, effort: EffortLevel | undefined, t: Tools): Promise<boolean> {
  const dir = spot.worktree?.path;
  if (!dir) return false;
  const { machine } = spot;
  const session = sessionsIn(machine, dir)[0];
  const sessionId = session?.sessionId ?? (await start(machine, dir, t));
  if (!sessionId) return false;
  // It has more to do than the review: it is not removed when the review is posted.
  if (session) await forgetSession(machine, sessionId, t);
  t.actions.notify({ text: `「${label}」を送っています…`, busy: true });
  const sent = await t.send({ machine: machine.id, sessionId, text, ...effortFor(machine, effort) });
  if (!sent.ok) {
    t.actions.notify({ text: `「${label}」を送れませんでした：${sent.error}`, tone: "danger" });
    return false;
  }
  const later = session && session.status !== "idle";
  const notice = later ? `「${label}」を送りました。セッションの作業が終わってから入力されます。` : `「${label}」をセッションに送りました。`;
  if (sent.data.warning) {
    t.actions.notify({
      text: notice + sent.data.warning,
      tone: "danger",
      action: { label: "セッションを開く", run: () => t.nav.openSession(machine.id, sessionId) },
    });
  } else sentNotice(machine, sessionId, notice, t);
  return true;
}

/**
 * After a merge or a send-back was sent: the daemon part keeps whether to remove the review worktree once it is done
 * (`cleanup`), with the head of the verdict it was asked of, or forgets what an earlier ask said. A merge may remove a
 * worktree of any name, a send-back only a review worktree (review-<repository>-<number>, or review-<number> from
 * before); the primary checkout is never removed. An ask that may not remove the worktree forgets the one before it
 * too: a send-back takes the place of the merge asked earlier.
 */
export async function followCleanup({ pr }: Item, spot: Spot, kind: CleanupKind, cleanup: boolean, t: Tools): Promise<void> {
  if (!spot.worktree) return;
  const follow = cleanup && cleanable(kind, spot.worktree, spot.primary);
  const r = await t.call({
    machine: spot.machine.id,
    method: "cleanup",
    params: { repo: pr.repo, number: pr.number, ...(follow ? { action: "follow", kind, ...(pr.mark ? { sha: pr.mark.sha } : {}) } : { action: "forget" }) },
    summary: follow ? `${pr.repo}#${pr.number} の${KIND_TEXT[kind]}が終わったら、worktree を片付ける` : `${pr.repo}#${pr.number} の worktree を自動では片付けない`,
  });
  t.actions.reload(spot.machine.id);
  if (!r.ok && follow) t.actions.notify({ text: `指示は送りましたが、終わったら片付けるように覚えられませんでした：${r.error}`, tone: "danger" });
}

const KIND_TEXT: Record<CleanupKind, string> = { merge: "マージ", sendBack: "差し戻し" };

/**
 * Removes a review worktree whose merge or send-back is done, with the sessions in it and its local branch, as Gasho's
 * sidebar does; first claimed from the daemon part, so that one page does it. The pull request's head counts as pushed
 * (its branch may be gone from GitHub once merged). Uncommitted changes or other commits keep it, with the reason on
 * its row; it is not tried again.
 */
export async function cleanUp(pr: Pick<PrRow, "repo" | "number" | "head">, machine: MachineInfo, place: Place, t: Tools): Promise<void> {
  const { worktree, cleanup } = place;
  if (!worktree || !cleanup) return;
  const target = { machine: machine.id, method: "cleanup" } as const;
  const ref = { repo: pr.repo, number: pr.number };
  const claim = await t.call<{ claimed: boolean }>({ ...target, params: { ...ref, action: "claim" }, summary: `${pr.repo}#${pr.number} の worktree を片付け始める` });
  if (!claim.ok || !claim.data.claimed) return;
  const r = await t.remove({
    machine: machine.id,
    path: worktree.path,
    ...(worktree.branch ? { branch: worktree.branch } : {}),
    ...(pr.head ? { pushed: [pr.head] } : {}),
  });
  const name = folderName(worktree.path);
  if (r.ok) {
    await t.call({ ...target, params: { ...ref, action: "forget" }, summary: `${pr.repo}#${pr.number} の worktree を片付けた` });
    t.actions.notify({
      text: `#${pr.number} の${KIND_TEXT[cleanup.kind]}が終わったので、${name}${worktree.branch ? "とローカルのブランチ" : ""}を片付けました。${r.warning ? `（${r.warning}）` : ""}`,
    });
  } else {
    const problem = r.changes ? changesProblem(r.changes) : `自動では片付けられませんでした：${r.error}`;
    await t.call({ ...target, params: { ...ref, action: "fail", problem }, summary: `${pr.repo}#${pr.number} の worktree を片付けられなかった` });
    t.actions.notify({ text: `#${pr.number} の ${name}：${problem}`, tone: "danger" });
  }
  t.actions.reload(machine.id);
}

/** Removes a pull request's review worktree, or the one a merge asked to clean up, and its local branch, once the person agrees. */
export async function removeWorktree(item: Item, spot: Spot, t: Tools): Promise<void> {
  const { pr } = item;
  if (!(spot.worktree?.review || spot.cleanup) || !spot.worktree || !(await t.actions.askRemove({ item, spot }))) return;
  t.actions.notify({ text: `${folderName(spot.worktree.path)} を片付けています…`, busy: true });
  const r = await t.call<Removed>({
    machine: spot.machine.id,
    method: "remove",
    params: { repo: pr.repo, number: pr.number },
    summary: `${pr.repo}#${pr.number} の worktree を片付ける`,
  });
  t.actions.reload(spot.machine.id);
  t.actions.notify(
    r.ok
      ? { text: `${folderName(r.data.path)} を片付けました${r.data.branch ? `（ローカルのブランチ ${r.data.branch} も消しました）` : ""}。` }
      : { text: r.error, tone: "danger" },
  );
}
