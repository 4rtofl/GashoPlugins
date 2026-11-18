import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { machine, sdk, session } from "../../test/sdk.tsx";
import { Card, CardActionsContext, type CardActions } from "../src/web/card.tsx";
import type { KanbanCard, PlacedCard } from "../src/cards.ts";

const card = (over: Partial<KanbanCard> = {}): KanbanCard => ({
  id: "c1",
  repo: "4rtofl/app",
  label: "issue-1-x",
  path: "/work/issue-1-x",
  branch: "feat/1-x",
  title: "feat/1-x",
  column: "mine",
  actions: [{ label: "実装する", text: "/issue-implement 1" }],
  sessions: [],
  ...over,
});

function draw(row: PlacedCard, actions: Partial<CardActions> = {}) {
  const given: CardActions = { notify: vi.fn(), askTrust: vi.fn(async () => false), ...actions };
  render(
    <CardActionsContext.Provider value={given}>
      <Card row={row} now={Date.now()} where={{ machines: false, repos: false }} />
    </CardActionsContext.Provider>,
  );
  return given;
}

const openMenu = (label: string) => userEvent.click(screen.getByRole("button", { name: `${label} のメニュー` }));

describe("a card's menu", () => {
  it("sends the board plugin's instruction to the Gasho session of the worktree used last", async () => {
    const older = session({ sessionId: "s-old", cwd: "/work/issue-1-x", managed: true, lastActivityAt: 1000 });
    const newer = session({ sessionId: "s-new", cwd: "/work/issue-1-x", managed: true, lastActivityAt: 2000 });
    const m = machine({ sessions: [older, newer], canLaunch: true });
    const actions = draw({
      machine: m,
      card: card({ sessions: [{ sessionId: "s-old", status: "idle", managed: true }, { sessionId: "s-new", status: "idle", managed: true }] }),
    });
    await openMenu("issue-1-x");
    await userEvent.click(screen.getByRole("menuitem", { name: "実装する" }));
    await waitFor(() => expect(sdk.sendInput).toHaveBeenCalledWith({ machine: "m1", sessionId: "s-new", text: "/issue-implement 1" }));
    expect(sdk.launchSession).not.toHaveBeenCalled();
    expect(actions.notify).toHaveBeenLastCalledWith({ text: "issue-1-x に「実装する」を送りました。", session: { machine: "m1", sessionId: "s-new" } });
  });

  it("starts a session in the worktree first when it has no Gasho session, and sends the instruction there", async () => {
    // A session started outside Gasho cannot be sent to, so it does not count.
    const term = session({ sessionId: "term", cwd: "/work/issue-1-x" });
    const actions = draw({ machine: machine({ canLaunch: true, sessions: [term] }), card: card({ sessions: [{ sessionId: "term", status: "idle" }] }) });
    await openMenu("issue-1-x");
    await userEvent.click(screen.getByRole("menuitem", { name: "実装する" }));
    await waitFor(() => expect(sdk.sendInput).toHaveBeenCalledWith({ machine: "m1", sessionId: "launched", text: "/issue-implement 1" }));
    expect(sdk.launchSession).toHaveBeenCalledWith({ machine: "m1", cwd: "/work/issue-1-x" });
    expect(actions.askTrust).not.toHaveBeenCalled();
  });

  it("asks the person before trusting the folder, and starts nothing when they decline", async () => {
    sdk.launchSession.mockReturnValue({ ok: false, error: "trust", needsTrust: true, trustWarnings: [".mcp.json があります"] });
    const actions = draw({ machine: machine({ canLaunch: true }), card: card() }, { askTrust: vi.fn(async () => false) });
    await openMenu("issue-1-x");
    await userEvent.click(screen.getByRole("menuitem", { name: "実装する" }));
    await waitFor(() => expect(actions.askTrust).toHaveBeenCalledWith({ path: "/work/issue-1-x", warnings: [".mcp.json があります"] }));
    expect(sdk.launchSession).toHaveBeenCalledTimes(1);
    expect(sdk.sendInput).not.toHaveBeenCalled();
  });

  it("starts the session trusting the folder once the person agrees", async () => {
    sdk.launchSession.mockReturnValueOnce({ ok: false, error: "trust", needsTrust: true }).mockReturnValueOnce({ ok: true, sessionId: "trusted" });
    draw({ machine: machine({ canLaunch: true }), card: card() }, { askTrust: vi.fn(async () => true) });
    await openMenu("issue-1-x");
    await userEvent.click(screen.getByRole("menuitem", { name: "実装する" }));
    await waitFor(() => expect(sdk.sendInput).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "trusted" })));
    expect(sdk.launchSession).toHaveBeenLastCalledWith({ machine: "m1", cwd: "/work/issue-1-x", trust: true });
  });

  it("shows why a session did not start, and sends nothing", async () => {
    sdk.launchSession.mockReturnValue({ ok: false, error: "claude が見つかりません" });
    const actions = draw({ machine: machine({ canLaunch: true }), card: card() });
    await openMenu("issue-1-x");
    await userEvent.click(screen.getByRole("menuitem", { name: "実装する" }));
    await waitFor(() => expect(actions.notify).toHaveBeenLastCalledWith({ text: "claude が見つかりません", tone: "danger" }));
    expect(sdk.sendInput).not.toHaveBeenCalled();
  });

  it("opens the session it starts from 「セッションを起動して開く」", async () => {
    draw({ machine: machine({ canLaunch: true }), card: card({ actions: undefined }) });
    await openMenu("issue-1-x");
    await userEvent.click(screen.getByRole("menuitem", { name: "セッションを起動して開く" }));
    await waitFor(() => expect(sdk.nav.openSession).toHaveBeenCalledWith("m1", "launched"));
  });

  it("offers no instruction for a pull request without a worktree, and says why", async () => {
    draw({
      machine: machine({ canLaunch: true }),
      card: card({ label: "PR #7", path: undefined, pr: { number: 7, url: "https://github.com/4rtofl/app/pull/7", state: "open" } }),
    });
    await openMenu("PR #7");
    expect(screen.getByRole("menuitem", { name: "実装する" }).getAttribute("aria-disabled")).toBe("true");
    expect(screen.queryByRole("menuitem", { name: "セッションを起動して開く" })).toBeNull();
    expect(screen.getByText("worktree が無いので、セッションを起動できません。")).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /PR #7 を GitHub で開く/ }).getAttribute("href")).toBe("https://github.com/4rtofl/app/pull/7");
  });

  it("offers no instruction when the working server cannot start sessions and the worktree has none of Gasho's", async () => {
    draw({ machine: machine({ canLaunch: false }), card: card() });
    await openMenu("issue-1-x");
    expect(screen.getByRole("menuitem", { name: "実装する" }).getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText("この working server では、Gasho からセッションを起動できません。")).toBeTruthy();
  });
});

describe("a card", () => {
  it("opens a Gasho session of its worktree from the session's button on it", async () => {
    const s = session({ sessionId: "s1", cwd: "/work/issue-1-x", managed: true, name: "実装" });
    draw({ machine: machine({ sessions: [s] }), card: card({ sessions: [{ sessionId: "s1", status: "busy", managed: true }] }) });
    await userEvent.click(screen.getByRole("button", { name: "実装" }));
    expect(sdk.nav.openSession).toHaveBeenCalledWith("m1", "s1");
  });
});
