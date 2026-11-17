import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { answerCalls, callsOf, machine, respond, sdk } from "../../test/sdk.tsx";
import { ReposDialog } from "../src/web/repos-dialog.tsx";
import { MAX_REPOS, type RepoOption } from "../src/types.ts";

const options: RepoOption[] = [
  { path: "/work/app", github: "4rtofl/app" },
  { path: "/work/lib", github: "4rtofl/lib" },
];
type Watch = { paths: string[]; plugins: Record<string, string> } | undefined;

function draw({ watched = () => ({ paths: ["/work/app"], plugins: {} }), machines = [machine()] }: { watched?: (id: string) => Watch; machines?: ReturnType<typeof machine>[] } = {}) {
  const onClose = vi.fn();
  const reload = vi.fn();
  const view = render(<ReposDialog open onClose={onClose} machines={machines} watched={watched} reload={reload} />);
  return { onClose, reload, rerender: (w: (id: string) => Watch) => view.rerender(<ReposDialog open onClose={onClose} machines={machines} watched={w} reload={reload} />) };
}

const box = (path: string) => screen.getByRole("checkbox", { name: new RegExp(`${path}$`) });
const save = () => userEvent.click(screen.getByRole("button", { name: "保存" }));

describe("ReposDialog", () => {
  it("closes without asking anything when nothing changed", async () => {
    respond({ options: { data: options } });
    const { onClose } = draw();
    await save();
    expect(sdk.call).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("saves the repositories ticked, reads the board again and closes", async () => {
    respond({ options: { data: options } });
    const { onClose, reload } = draw();
    await userEvent.click(box("/work/lib"));
    await save();
    expect(sdk.call).toHaveBeenCalledWith({ machine: "m1", method: "watch", params: { paths: ["/work/app", "/work/lib"], plugins: {} }, summary: "見る repo を 2 個にする" });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(reload).toHaveBeenCalledWith("m1");
  });

  it("keeps the dialog open with the working server's error when saving fails", async () => {
    respond({ options: { data: options } });
    answerCalls({ watch: { ok: false, error: "書き込めません" } });
    const { onClose, reload } = draw();
    await userEvent.click(box("/work/lib"));
    await save();
    expect(await screen.findByText("mac：書き込めません")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledWith("m1");
  });

  it("asks only the working servers whose choice changed", async () => {
    respond({ options: { data: options } });
    const machines = [machine({ id: "m1", name: "mac" }), machine({ id: "m2", name: "linux" })];
    draw({ machines, watched: () => ({ paths: ["/work/app"], plugins: {} }) });
    const [, onLinux] = screen.getAllByRole("checkbox", { name: /\/work\/lib$/ });
    await userEvent.click(onLinux!);
    await save();
    expect(sdk.call).toHaveBeenCalledTimes(1);
    expect(sdk.call).toHaveBeenCalledWith(expect.objectContaining({ machine: "m2" }));
  });

  it("lists a repository chosen before that is no longer offered, so that it can be taken off", async () => {
    respond({ options: { data: options } });
    draw({ watched: () => ({ paths: ["/work/app", "/work/gone"], plugins: {} }) });
    expect(screen.getByText("見つからない repo")).toBeTruthy();
    await userEvent.click(box("/work/gone"));
    await save();
    expect(callsOf("watch")).toEqual([{ paths: ["/work/app"], plugins: {} }]);
  });

  it("lets no more repositories be ticked once a working server watches as many as it can", () => {
    const many = Array.from({ length: MAX_REPOS + 1 }, (_, i) => ({ path: `/work/r${i}`, github: `4rtofl/r${i}` }));
    respond({ options: { data: many } });
    draw({ watched: () => ({ paths: many.slice(0, MAX_REPOS).map((o) => o.path), plugins: {} }) });
    expect(box(`/work/r${MAX_REPOS}`)).toHaveProperty("disabled", true);
    expect(box("/work/r0")).toHaveProperty("disabled", false);
  });

  it("starts a working server whose board arrives while the dialog is open from what it watches", async () => {
    respond({ options: { data: options } });
    const { rerender } = draw({ watched: () => undefined });
    rerender(() => ({ paths: ["/work/app"], plugins: {} }));
    await userEvent.click(box("/work/lib"));
    await save();
    expect(callsOf("watch")).toEqual([{ paths: ["/work/app", "/work/lib"], plugins: {} }]);
  });

  it("saves the board plugin chosen for a watched repository", async () => {
    respond({ options: { data: options } });
    draw();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "4rtofl/app のカンバン用のプラグイン" }), "example");
    await save();
    expect(sdk.call).toHaveBeenCalledWith(expect.objectContaining({ params: { paths: ["/work/app"], plugins: { "/work/app": "example" } }, summary: "repo ごとのカンバン用のプラグインを変える" }));
  });
});
