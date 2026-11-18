import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { lastRequest, machine, respond, sdk, session } from "../../test/sdk.tsx";
import { PackagePanel, PackagesPanel } from "../src/web/packages.tsx";
import type { Package, PackageDetail } from "../src/types.ts";

const github = { owner: "4rtofl", name: "app", url: "https://github.com/4rtofl/app" };
const s = session({ github });

const npm: Package = { type: "npm", name: "@4rtofl/app", visibility: "private", versions: 4, url: "https://github.com/4rtofl/app/pkgs/npm/app" };
const image: Package = { type: "container", name: "app", visibility: "public", versions: 2, url: "https://github.com/4rtofl/app/pkgs/container/app" };

describe("PackagesPanel", () => {
  it("lists the packages read, says which kinds could not be, and opens a package by its kind and name", async () => {
    respond({ packages: { data: { repo: github, packages: [npm], errors: ["container"] } } });
    render(<PackagesPanel machine={machine()} session={s} params={{}} docked />);
    expect(screen.getByText("コンテナー のパッケージは読めませんでした。")).toBeTruthy();
    await userEvent.click(screen.getByRole("link", { name: /@4rtofl\/app/ }));
    expect(sdk.nav.openPanel).toHaveBeenCalledWith("package", { type: "npm", name: "@4rtofl/app" }, undefined);
  });

  it("says which scope gh's login lacks, rather than that there are no packages", () => {
    respond({ packages: { data: { repo: github, packages: [], missing: { scope: "read:packages", command: "gh auth refresh -s read:packages" } } } });
    render(<PackagesPanel machine={machine()} session={s} params={{}} docked />);
    expect(screen.getByText("gh auth refresh -s read:packages")).toBeTruthy();
    expect(screen.queryByText("このリポジトリのパッケージはありません。")).toBeNull();
  });
});

describe("PackagePanel", () => {
  const detail = (over: Partial<PackageDetail>): PackageDetail => ({ repo: github, package: npm, versions: [], truncated: false, ...over });

  it("shows a container's versions by their tags, an image without tags as such, and its digest cut short", () => {
    respond({
      package: {
        data: detail({
          package: image,
          versions: [
            { id: 1, name: "sha256:0123456789abcdef0123456789abcdef", tags: ["latest", "v1"] },
            { id: 2, name: "sha256:fedcba9876543210fedcba9876543210", tags: [] },
          ],
        }),
      },
    });
    render(<PackagePanel machine={machine()} session={s} params={{ type: "container", name: "app" }} docked />);
    expect(lastRequest("package")?.params).toEqual({ type: "container", name: "app" });
    expect(screen.getByText("版（タグ）")).toBeTruthy();
    expect(screen.getByText("latest")).toBeTruthy();
    expect(screen.getByText("v1")).toBeTruthy();
    expect(screen.getByText("タグなし")).toBeTruthy();
    expect(screen.getByText("sha256:0123456789ab…")).toBeTruthy();
  });

  it("shows the command that installs the newest npm version, with what GitHub Packages needs for it", () => {
    respond({ package: { data: detail({ versions: [{ id: 1, name: "1.2.0" }], install: "npm install @4rtofl/app@1.2.0" }) } });
    render(<PackagePanel machine={machine()} session={s} params={{ type: "npm", name: "@4rtofl/app" }} docked />);
    expect(screen.getByText("npm install @4rtofl/app@1.2.0")).toBeTruthy();
    expect(screen.getByText(/read:packages の権限のあるトークンを ~\/.npmrc に書いておきます/)).toBeTruthy();
  });

  it("reads nothing for a kind of package it does not know, and says the package asked for is wrong", () => {
    render(<PackagePanel machine={machine()} session={s} params={{ type: "pypi", name: "app" }} docked />);
    expect(screen.getByText("パッケージの指定が正しくありません。")).toBeTruthy();
    expect(sdk.request).not.toHaveBeenCalled();
  });
});
