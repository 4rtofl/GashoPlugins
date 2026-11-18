import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { ItemProjects, ProjectsRead } from "../src/daemon/ops/projects.ts";
import type { GitHubItemDetail } from "../src/types.ts";
import Projects from "../src/web/item/sections/projects.tsx";
import { detail, fill, reads, renderItem, REPO, writes } from "./render.tsx";

const issue = (over: Partial<GitHubItemDetail> = {}) => detail({ title: "Project に入れる", ...over });

const show = (item = issue()) => renderItem(item, <Projects.View />);

const board = (canUpdate = true): ItemProjects => ({
  contentId: "I_12",
  items: [
    {
      id: "PVTI_1",
      project: { id: "PVT_1", number: 1, title: "Board", url: "https://github.com/orgs/4rtofl/projects/1", canUpdate },
      fields: [
        {
          id: "F_status",
          name: "Status",
          type: "single_select",
          options: [
            { id: "o1", name: "Todo", color: "GRAY" },
            { id: "o2", name: "Done", color: "GREEN" },
          ],
          value: { singleSelectOptionId: "o1" },
          valueName: "Todo",
        },
        { id: "F_estimate", name: "Estimate", type: "number", value: { number: 3 } },
        { id: "F_sprint", name: "Sprint", type: "iteration", value: { iterationId: "it4" }, valueName: "Sprint 4" },
      ],
    },
  ],
  choices: [{ id: "PVT_2", number: 2, title: "Roadmap", url: "https://github.com/orgs/4rtofl/projects/2", canUpdate: true }],
});

const projects = (state: { data?: ProjectsRead; error?: string }) => reads({ projects: state });

describe("the projects of an item", () => {
  it("says how to give gh the scope when its login has none for Projects, and offers none to add", () => {
    projects({ data: { noScope: true } });
    show();
    expect(screen.getByText("gh auth refresh -s project")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Project に足す" })).toBeNull();
  });

  it("says why the projects could not be read", () => {
    projects({ error: "gh: HTTP 502" });
    show();
    expect(screen.getByText("Project を読めませんでした：gh: HTTP 502")).toBeTruthy();
  });

  it("puts the item in a project picked from those that do not hold it", async () => {
    projects({ data: board() });
    show();
    await userEvent.click(screen.getByRole("button", { name: "Project に足す" }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "Project に足す" })).getByRole("button", { name: "Roadmap #2" }));
    expect(writes()).toMatchObject([{ op: "project", repo: REPO, number: 12, action: "add", projectId: "PVT_2", contentId: "I_12" }]);
  });

  it("takes the item out of a project, and the toast puts it back with the values it held", async () => {
    projects({ data: board() });
    show();
    await userEvent.click(screen.getByRole("button", { name: "Project「Board」から外す" }));
    expect(writes()).toMatchObject([{ op: "project", action: "remove", projectId: "PVT_1", contentId: "I_12" }]);
    await userEvent.click(screen.getByRole("button", { name: "元に戻す" }));
    expect(writes()[1]).toMatchObject({
      op: "project",
      action: "add",
      projectId: "PVT_1",
      contentId: "I_12",
      values: [
        { fieldId: "F_status", value: { singleSelectOptionId: "o1" } },
        { fieldId: "F_estimate", value: { number: 3 } },
        { fieldId: "F_sprint", value: { iterationId: "it4" } },
      ],
    });
  });

  it("sets a single select to another option, leaves it on its own, or clears it", async () => {
    projects({ data: board() });
    show();
    const field = { projectId: "PVT_1", itemId: "PVTI_1", fieldId: "F_status" };
    const options = () => within(screen.getByRole("dialog", { name: "「Status」を変える" }));

    await userEvent.click(screen.getByRole("button", { name: "Status：Todo。変える" }));
    await userEvent.click(options().getByRole("button", { name: /Todo/ }));
    expect(writes()).toEqual([]);

    await userEvent.click(screen.getByRole("button", { name: "Status：Todo。変える" }));
    await userEvent.click(options().getByRole("button", { name: "Done" }));
    expect(writes()).toMatchObject([{ op: "project", action: "set", ...field, value: { singleSelectOptionId: "o2" } }]);

    await userEvent.click(screen.getByRole("button", { name: "Status：Todo。変える" }));
    await userEvent.click(options().getByRole("button", { name: "空にする" }));
    expect(writes()[1]).toMatchObject({ op: "project", action: "clear", ...field });
  });

  it("saves a number only once it is another number", async () => {
    projects({ data: board() });
    show();
    await userEvent.click(screen.getByRole("button", { name: "Estimate：3。変える" }));
    const box = within(screen.getByRole("dialog", { name: "「Estimate」を変える" }));
    const save = box.getByRole("button", { name: "保存する" });
    expect(save).toHaveProperty("disabled", true);
    const input = box.getByRole("spinbutton", { name: "Estimate" });
    await userEvent.clear(input);
    expect(save).toHaveProperty("disabled", true);
    await fill(input, "2.5");
    await userEvent.click(save);
    expect(writes()).toMatchObject([{ op: "project", action: "set", fieldId: "F_estimate", value: { number: 2.5 } }]);
  });

  it("only shows an iteration, and the values of a project gh's login may not change", () => {
    projects({ data: board() });
    const { unmount } = show();
    expect(screen.getByText("Sprint 4")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Sprint：/ })).toBeNull();
    unmount();

    projects({ data: board(false) });
    show();
    expect(screen.getByText("Todo")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /変える$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Project「Board」から外す" })).toBeNull();
  });
});
