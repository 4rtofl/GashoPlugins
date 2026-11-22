import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { PlanLimits } from "@gasho/plugin-sdk";
import { changed, lastRequest, machine, NOW, respond, sdk, session } from "../../test/sdk.tsx";
import { UsageRing } from "../src/web/ring.tsx";
import type { UsageLimits } from "../src/types.ts";

const HOUR = 3_600_000;
const s = session({ context: { used: 84_000, size: 200_000, percent: 42, at: NOW - 2 * 60_000 } });
const reported: PlanLimits = { fiveHour: { percent: 30, resetsAt: NOW + HOUR }, at: NOW - 60_000 };

const openPopover = () => userEvent.click(screen.getByRole("button", { name: "コンテキスト 42% 使用。使用量の詳細を開く" }));
const meter = (name: string) => screen.queryByRole("meter", { name });
const withModels: UsageLimits = {
  at: NOW - 30_000,
  available: true,
  sevenDay: { percent: 55, resetsAt: NOW + 48 * HOUR },
  models: [{ name: "Fable", percent: 80, resetsAt: NOW + 48 * HOUR }],
};

describe("UsageRing", () => {
  it("reads the plan's limits only while its popover is open, and says it is reading them", async () => {
    render(<UsageRing machine={machine()} session={s} />);
    expect(sdk.request).not.toHaveBeenCalled();
    await openPopover();
    expect(lastRequest("limits")).toBeDefined();
    expect(meter("コンテキストの使用率")?.getAttribute("aria-valuenow")).toBe("42");
    expect(screen.getByText("使用量の上限を読んでいます…")).toBeTruthy();
  });

  it("shows the limits the status line reported when get_usage fails, and that the models' weekly ones are missing", async () => {
    respond({ limits: { loading: false, error: "Claude Code の get_usage を読めませんでした。" } });
    render(<UsageRing machine={machine({ sessions: [session({ sessionId: "s0", limits: reported })] })} session={s} />);
    await openPopover();
    expect(meter("5時間の上限")?.getAttribute("aria-valuenow")).toBe("30");
    expect(screen.getByText("最後の返答の時点（1 分前）")).toBeTruthy();
    expect(screen.getByText("Claude Code の get_usage を読めませんでした。 モデルごとの週の上限は出せません。")).toBeTruthy();
  });

  it("shows the models' weekly limits that get_usage read, and a limit already reset without its meter", async () => {
    const read: UsageLimits = {
      at: NOW - 30_000,
      available: true,
      fiveHour: { percent: 100, resetsAt: NOW - 60_000 },
      sevenDay: { percent: 55, resetsAt: NOW + 48 * HOUR },
      models: [{ name: "Fable", percent: 80, resetsAt: NOW + 48 * HOUR }],
    };
    respond({ limits: { data: read } });
    render(<UsageRing machine={machine({ sessions: [session({ sessionId: "s0", limits: reported })] })} session={s} />);
    await openPopover();
    expect(meter("週の上限（Fable）")?.getAttribute("aria-valuenow")).toBe("80");
    expect(meter("5時間の上限")).toBeNull();
    expect(screen.getByText("5時間の上限")).toBeTruthy();
    expect(screen.getByText("リセット済み")).toBeTruthy();
    expect(screen.queryByText(/モデルごとの週の上限は出せません/)).toBeNull();
  });

  it("reads nothing from an offline working server, and shows the limits it last received", async () => {
    render(<UsageRing machine={machine({ connected: false, sessions: [session({ sessionId: "s0", limits: reported })] })} session={s} />);
    await openPopover();
    expect(sdk.request).not.toHaveBeenCalled();
    expect(meter("5時間の上限")?.getAttribute("aria-valuenow")).toBe("30");
    expect(screen.getByText("working server がオフラインです。最後に受け取った値を出しています。")).toBeTruthy();
  });

  it("reads the limits again once each time the popover opens after a read failed", async () => {
    respond({ limits: { loading: false, error: "Claude Code の get_usage を読めませんでした。" } });
    render(<UsageRing machine={machine()} session={s} />);
    await openPopover();
    act(() => changed());
    expect(sdk.reload.mock.calls).toEqual([["limits"]]);
    await openPopover();
    await openPopover();
    expect(sdk.reload.mock.calls).toEqual([["limits"], ["limits"]]);
  });

  it("does not read the limits again while they are read, nor once they were", async () => {
    render(<UsageRing machine={machine()} session={s} />);
    await openPopover();
    act(() => respond({ limits: { data: withModels } }));
    await openPopover();
    await openPopover();
    expect(sdk.reload).not.toHaveBeenCalled();
  });

  it("keeps the models' weekly limits it read after the working server goes offline", async () => {
    respond({ limits: { data: withModels } });
    const { rerender } = render(<UsageRing machine={machine()} session={s} />);
    await openPopover();
    await openPopover();
    rerender(<UsageRing machine={machine({ connected: false })} session={s} />);
    await openPopover();
    expect(meter("週の上限（Fable）")?.getAttribute("aria-valuenow")).toBe("80");
    expect(screen.getByText("working server がオフラインです。最後に受け取った値を出しています。")).toBeTruthy();
  });

  it("shows the limits the status line reported when the login may not read them with get_usage", async () => {
    respond({ limits: { data: { at: NOW - 30_000, available: false, models: [] } satisfies UsageLimits } });
    render(<UsageRing machine={machine({ sessions: [session({ sessionId: "s0", limits: reported })] })} session={s} />);
    await openPopover();
    expect(meter("5時間の上限")?.getAttribute("aria-valuenow")).toBe("30");
    expect(screen.getByText("この working server の Claude Code のログインでは、モデルごとの週の上限を読めません。")).toBeTruthy();
  });
});
