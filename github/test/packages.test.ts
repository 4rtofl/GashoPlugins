import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { installCommand, listPackages, packageNameArg, packagesBase, parsePackages, parseVersions, readPackage } from "../src/daemon/packages.ts";

const fixture = (name: string) => readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");

test("an organization's packages are kept when their repository is the session's (real output)", () => {
  const gasho = parsePackages(fixture("packages-org-npm.json"), "4rtofl/gasho");
  assert.ok(gasho.some((p) => p.name === "gasho-plugin-sdk"));
  const sdk = gasho.find((p) => p.name === "gasho-plugin-sdk");
  assert.deepEqual(sdk, {
    type: "npm",
    name: "gasho-plugin-sdk",
    visibility: "private",
    versions: sdk?.versions,
    createdAt: "2026-11-14T12:20:33Z",
    updatedAt: sdk?.updatedAt,
    url: "https://github.com/orgs/4rtofl/packages/npm/package/gasho-plugin-sdk",
  });
  assert.equal(typeof sdk?.versions, "number");
  assert.deepEqual(parsePackages(fixture("packages-org-npm.json"), "4rtofl/GashoPlugins"), []);
  // A user's packages do not say how many versions they have.
  const user = parsePackages(fixture("packages-user-container.json"), "4rna-y/AwakeVerify");
  assert.equal(user.length, 3);
  assert.equal(user[0]?.versions, undefined);
  assert.equal(user[0]?.type, "container");
});

test("versions: npm's numbers and a container's tags, newest first (real output)", () => {
  const npm = parseVersions(fixture("versions-npm.json"));
  assert.deepEqual(
    npm.map((v) => v.name),
    ["1.10.0", "1.9.0", "1.8.1"],
  );
  assert.equal(npm[0]?.tags, undefined);
  const container = parseVersions(fixture("versions-container.json"));
  assert.deepEqual(container[0]?.tags, ["prod-20260716-7"]);
  assert.deepEqual(container[1]?.tags, []);
  assert.match(container[0]?.name ?? "", /^sha256:/);
});

test("the command that installs a version", () => {
  assert.equal(installCommand({ type: "npm", name: "gasho-plugin-sdk" }, "4rtofl", "Gasho", { id: 1, name: "1.9.0" }), "npm install @4rtofl/gasho-plugin-sdk@1.9.0 --registry=https://npm.pkg.github.com");
  assert.equal(installCommand({ type: "container", name: "Awaver-Backend" }, "4rna-y", "x", { id: 1, name: "sha256:ab", tags: ["prod", "v1"] }), "docker pull ghcr.io/4rna-y/awaver-backend:prod");
  assert.equal(installCommand({ type: "container", name: "app" }, "O", "x", { id: 1, name: "sha256:ab", tags: [] }), "docker pull ghcr.io/o/app@sha256:ab");
  assert.equal(installCommand({ type: "rubygems", name: "gem" }, "O", "x", { id: 1, name: "1.0" }), "gem install gem --version 1.0 --source https://rubygems.pkg.github.com/o");
  assert.equal(installCommand({ type: "nuget", name: "Pkg" }, "O", "x", { id: 1, name: "1.0" }), "dotnet add package Pkg --version 1.0 --source https://nuget.pkg.github.com/o/index.json");
  assert.equal(installCommand({ type: "maven", name: "com.example.app" }, "O", "x", { id: 1, name: "1.0" }), undefined);
});

test("whose packages are read: an organization's, gh's own login's, or another user's", async () => {
  assert.equal(packagesBase("acme", "org"), "orgs/acme/packages");
  assert.equal(packagesBase("me", "me"), "user/packages");
  assert.equal(packagesBase("you", "user"), "users/you/packages");
  const asked: string[] = [];
  const ctx = (type: string, login: string) => ({
    github: {
      read: async (args: string[]) => {
        const path = args[1] ?? "";
        asked.push(path);
        if (path.startsWith("users/") && !path.includes("packages")) return { stdout: JSON.stringify({ type }), stderr: "" };
        if (path === "user") return { stdout: JSON.stringify({ login }), stderr: "" };
        if (path.includes("package_type=container")) return { stdout: fixture("packages-user-container.json"), stderr: "" };
        return { stdout: "[]", stderr: "" };
      },
    },
  });
  const mine = await listPackages(ctx("User", "4RNA-Y") as never, "4rna-y/AwakeVerify", { maxAgeSeconds: 60 });
  assert.equal(mine.packages.length, 3);
  assert.ok(asked.includes("user/packages?package_type=container&per_page=100"));
  asked.length = 0;
  await listPackages(ctx("User", "someone") as never, "4rna-y/AwakeVerify", { maxAgeSeconds: 60 });
  assert.ok(asked.includes("users/4rna-y/packages?package_type=npm&per_page=100"));
  asked.length = 0;
  await listPackages(ctx("Organization", "someone") as never, "acme/app", { maxAgeSeconds: 60 });
  assert.ok(asked.includes("orgs/acme/packages?package_type=maven&per_page=100"));
});

test("without read:packages, the answer says how to add it; a package of another repository is not read", async () => {
  const ctx = {
    github: {
      read: async (args: string[]) => {
        if (args[1]?.includes("packages")) throw Object.assign(new Error("x"), { stderr: "gh: You need at least read:packages scope to list packages. (HTTP 403)" });
        return { stdout: JSON.stringify({ type: "Organization" }), stderr: "" };
      },
    },
  };
  const list = await listPackages(ctx as never, "acme/app", { maxAgeSeconds: 60 });
  assert.deepEqual(list.missing, { scope: "read:packages", command: "gh auth refresh -h github.com -s read:packages" });
  assert.equal(list.errors, undefined);
  const elsewhere = {
    github: {
      read: async (args: string[]) => {
        const path = args[1] ?? "";
        if (path.endsWith("/versions?per_page=100")) return { stdout: fixture("versions-npm.json"), stderr: "" };
        if (path.includes("packages/npm/")) return { stdout: JSON.stringify((JSON.parse(fixture("packages-org-npm.json")) as { name: string }[]).find((p) => p.name === "gasho-hub")), stderr: "" };
        return { stdout: JSON.stringify({ type: "Organization" }), stderr: "" };
      },
    },
  };
  assert.equal(await readPackage(elsewhere as never, "4rtofl/GashoPlugins", "npm", "gasho-hub", { maxAgeSeconds: 60 }), undefined);
  const read = await readPackage(elsewhere as never, "4rtofl/Gasho", "npm", "gasho-hub", { maxAgeSeconds: 60 });
  assert.equal(read?.versions.length, 3);
  assert.match(read?.install ?? "", /^npm install @4rtofl\/gasho-hub@1\.10\.0 /);
});

test("a package's name is checked before it reaches gh", () => {
  assert.equal(packageNameArg("gasho-plugin-sdk"), "gasho-plugin-sdk");
  assert.equal(packageNameArg("org/app"), "org/app");
  for (const bad of ["-x", "../x", "a b", "", 3, "a?b"]) assert.equal(packageNameArg(bad), undefined);
});
