import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { answerCalls, machine, respond, sdk } from "../../test/sdk.tsx";
import { ReposDialog } from "../src/web/repos-dialog.tsx";
import type { RepoOption } from "../src/types.ts";

const options: RepoOption[] = [
  { path: "/work/app", github: "4rtofl/app" },
  { path: "/work/api", github: "4rtofl/api" },
  { path: "/work/notes" },
];

function open(watching: Record<string, string[]>, machines = [machine()]) {
  const onClose = vi.fn();
  const reload = vi.fn();
  render(<ReposDialog open onClose={onClose} machines={machines} watched={(id) => watching[id]} reload={reload} />);
  return { onClose, reload };
}

const box = (name: RegExp) => screen.getByRole("checkbox", { name });
const save = () => userEvent.click(screen.getByRole("button", { name: "保存" }));

describe("ReposDialog", () => {
  it("starts from what each working server watches, and saves only the working servers whose choice changed", async () => {
    respond({ options: { data: options } });
    const { onClose, reload } = open({ m1: ["/work/app"], m2: ["/work/app"] }, [machine({ id: "m1", name: "mac" }), machine({ id: "m2", name: "linux" })]);
    const [mac] = screen.getAllByRole("checkbox", { name: /4rtofl\/\s*api/ });
    for (const b of screen.getAllByRole("checkbox", { name: /4rtofl\/\s*app/ })) expect(b).toHaveProperty("checked", true);
    await userEvent.click(mac!);
    await save();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(sdk.call.mock.calls.map(([t]) => [t.machine, t.method, t.params])).toEqual([["m1", "watch", { paths: ["/work/app", "/work/api"] }]]);
    expect(reload.mock.calls).toEqual([["m1"]]);
  });

  it("closes without saving when nothing changed", async () => {
    respond({ options: { data: options } });
    const { onClose } = open({ m1: ["/work/app"] });
    await save();
    expect(onClose).toHaveBeenCalled();
    expect(sdk.call).not.toHaveBeenCalled();
  });

  it("stays open with the working server's reason when saving fails", async () => {
    respond({ options: { data: options } });
    answerCalls({ watch: { ok: false, error: "the folder is gone" } });
    const { onClose, reload } = open({ m1: ["/work/app"] });
    await userEvent.click(box(/4rtofl\/\s*app/));
    await save();
    expect(await screen.findByText("mac：the folder is gone")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledWith("m1");
  });

  it("lets no more than 30 repositories be ticked on a working server", async () => {
    const many = Array.from({ length: 31 }, (_, i) => ({ path: `/work/r${i}`, github: `4rtofl/r${i}` }));
    respond({ options: { data: many } });
    open({ m1: many.slice(0, 30).map((o) => o.path) });
    expect(box(/4rtofl\/\s*r30\b/)).toHaveProperty("disabled", true);
    await userEvent.click(box(/4rtofl\/\s*r0\b/));
    expect(box(/4rtofl\/\s*r30\b/)).toHaveProperty("disabled", false);
  });

  it("shows first the repositories chosen before that cannot be chosen now, so that they can be taken off", async () => {
    respond({ options: { data: options } });
    open({ m1: ["/work/gone", "/work/notes"] });
    expect(box(/見つからない repo/)).toHaveProperty("checked", true);
    expect(box(/GitHub にない repo/)).toHaveProperty("checked", true);
    await userEvent.click(box(/見つからない repo/));
    await save();
    await waitFor(() => expect(sdk.call).toHaveBeenCalled());
    expect(sdk.call.mock.calls[0]?.[0].params).toEqual({ paths: ["/work/notes"] });
  });

  it("narrows the repositories by the words typed, and lists those not on GitHub apart, which cannot be chosen", async () => {
    respond({ options: { data: options } });
    open({ m1: [] });
    const dialog = screen.getByRole("dialog", { name: "対象リポジトリ" });
    await userEvent.type(within(dialog).getByPlaceholderText("repo の名前やフォルダーで絞り込む"), "api");
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(box(/4rtofl\/\s*api/)).toBeTruthy();
    await userEvent.type(within(dialog).getByPlaceholderText("repo の名前やフォルダーで絞り込む"), "zzz");
    expect(screen.getByText("一致する repo がありません。")).toBeTruthy();

    await userEvent.clear(within(dialog).getByPlaceholderText("repo の名前やフォルダーで絞り込む"));
    const others = screen.getByRole("button", { name: /GitHub にない repo（1）/ });
    expect(others.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(others);
    expect(screen.getByText("origin が GitHub にないので、選べません。")).toBeTruthy();
    expect(screen.getByText("/work/notes")).toBeTruthy();
  });
});
