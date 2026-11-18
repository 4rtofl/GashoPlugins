import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { installCommand, listPackages, PACKAGE_PAGES, packageNameArg, packagesBase, parsePackages, parseVersions, readPackage, VERSIONS_MAX } from "../src/daemon/packages.ts";

const fixture = (name: string) => readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");
const json = (name: string) => JSON.parse(fixture(name)) as unknown;
/** The answer that says whose the repository is (OWNER_QUERY). */
const ownerAnswer = (typename: string, login: string, repo: string, viewer: string) =>
  JSON.stringify({ data: { repository: { nameWithOwner: repo, owner: { __typename: typename, login } }, viewer: { login: viewer } } });

test("an organization's packages are kept when their repository is the session's (real output)", () => {
  const gasho = parsePackages(json("packages-org-npm.json"), "4rtofl/gasho");
  assert.ok(gasho.some((p) => p.name === "gasho-plugin-sdk"));
  const sdk = gasho.find((p) => p.name === "gasho-plugin-sdk");
  assert.deepEqual(sdk, {
    type: "npm",
    name: "gasho-plugin-sdk",
    visibility: "private",
    versions: sdk?.versions,
    createdAt: "2026-11-14T12:20:33Z",
    url: "https://github.com/orgs/4rtofl/packages/npm/package/gasho-plugin-sdk",
  });
  assert.equal(typeof sdk?.versions, "number");
  assert.deepEqual(parsePackages(json("packages-org-npm.json"), "4rtofl/GashoPlugins"), []);
  // A user's packages do not say how many versions they have.
  const user = parsePackages(json("packages-user-container.json"), "4rna-y/AwakeVerify");
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

test("the command that installs the newest version", () => {
  assert.equal(installCommand({ type: "npm", name: "gasho-plugin-sdk" }, "4rtofl", "Gasho", [{ id: 1, name: "1.9.0" }]), "npm install @4rtofl/gasho-plugin-sdk@1.9.0 --registry=https://npm.pkg.github.com");
  assert.equal(installCommand({ type: "container", name: "Awaver-Backend" }, "4rna-y", "x", parseVersions(fixture("versions-container.json"))), "docker pull ghcr.io/4rna-y/awaver-backend:prod-20260716-7");
  assert.equal(installCommand({ type: "container", name: "app" }, "O", "x", [{ id: 1, name: "sha256:ab", tags: ["v1", "latest"] }]), "docker pull ghcr.io/o/app:latest");
  assert.equal(installCommand({ type: "container", name: "app" }, "O", "x", [{ id: 1, name: "sha256:ab", tags: [] }]), "docker pull ghcr.io/o/app@sha256:ab");
  // sigstore/cosign: the newest versions are signatures and attestations, tagged by the digest of the image they are of.
  assert.equal(
    installCommand({ type: "container", name: "cosign/cosign" }, "sigstore", "cosign", parseVersions(fixture("versions-container-signed.json"))),
    "docker pull ghcr.io/sigstore/cosign/cosign:d93bbdba1ba2544fe54fdc7db2abafb510608c5a-dev-dev",
  );
  assert.equal(installCommand({ type: "rubygems", name: "gem" }, "O", "x", [{ id: 1, name: "1.0" }]), "gem install gem --version 1.0 --source https://rubygems.pkg.github.com/o");
  assert.equal(installCommand({ type: "nuget", name: "Pkg" }, "O", "x", [{ id: 1, name: "1.0" }]), "dotnet add package Pkg --version 1.0 --source https://nuget.pkg.github.com/o/index.json");
  assert.equal(installCommand({ type: "maven", name: "com.example.app" }, "O", "x", [{ id: 1, name: "1.0" }]), undefined);
});

test("whose packages are read: an organization's, gh's own login's, or another user's", async () => {
  assert.equal(packagesBase("acme", "org"), "orgs/acme/packages");
  assert.equal(packagesBase("me", "me"), "user/packages");
  assert.equal(packagesBase("you", "user"), "users/you/packages");
  const asked: string[] = [];
  const ctx = (typename: string, owner: string, viewer: string) => ({
    github: {
      read: async (args: string[]) => {
        const path = args[1] ?? "";
        asked.push(path);
        if (path === "graphql") return { stdout: ownerAnswer(typename, owner, `${owner}/AwakeVerify`, viewer), stderr: "" };
        if (path.includes("package_type=container")) return { stdout: fixture("packages-user-container.json"), stderr: "" };
        return { stdout: "[]", stderr: "" };
      },
    },
  });
  const mine = await listPackages(ctx("User", "4rna-y", "4RNA-Y") as never, "4rna-y/AwakeVerify", { maxAgeSeconds: 60 });
  assert.equal(mine.packages.length, 3);
  assert.ok(asked.includes("user/packages?package_type=container&per_page=100&page=1"));
  asked.length = 0;
  await listPackages(ctx("User", "4rna-y", "someone") as never, "4rna-y/AwakeVerify", { maxAgeSeconds: 60 });
  assert.ok(asked.includes("users/4rna-y/packages?package_type=npm&per_page=100&page=1"));
  asked.length = 0;
  await listPackages(ctx("Organization", "acme", "someone") as never, "acme/AwakeVerify", { maxAgeSeconds: 60 });
  assert.ok(asked.includes("orgs/acme/packages?package_type=maven&per_page=100&page=1"));
});

test("a repository whose organization was renamed: its packages are read by the organization's name now (real output)", async () => {
  const asked: string[] = [];
  const ctx = {
    github: {
      read: async (args: string[]) => {
        const path = args[1] ?? "";
        asked.push(path);
        // Asked by the old login, as the clone's origin says it.
        if (path === "graphql") return { stdout: args.includes("owner=4rtoflow") ? fixture("owner-renamed.json") : "{}", stderr: "" };
        if (path.endsWith("/versions?per_page=100")) return { stdout: fixture("versions-npm.json"), stderr: "" };
        // The newest version of each package: the hub's was published last.
        if (path.endsWith("/versions?per_page=1")) return { stdout: path.includes("/gasho-hub/") ? fixture("versions-npm.json") : "[]", stderr: "" };
        if (path === "orgs/4rtofl/packages/npm/gasho-hub") return { stdout: JSON.stringify((json("packages-org-npm.json") as { name: string }[]).find((p) => p.name === "gasho-hub")), stderr: "" };
        if (path.startsWith("orgs/4rtofl/packages?package_type=npm&")) return { stdout: fixture("packages-org-npm.json"), stderr: "" };
        return { stdout: "[]", stderr: "" };
      },
    },
  };
  const list = await listPackages(ctx as never, "4rtoflow/Gasho", { maxAgeSeconds: 60 });
  assert.deepEqual(list.packages.map((p) => p.name).sort(), ["gasho-daemon", "gasho-hub", "gasho-plugin-sdk"]);
  assert.deepEqual([list.packages[0]?.name, list.packages[0]?.publishedAt], ["gasho-hub", "2026-11-15T13:01:24Z"]);
  assert.ok(!asked.some((p) => p.includes("4rtoflow")));
  const read = await readPackage(ctx as never, "4rtoflow/Gasho", "npm", "gasho-hub", { maxAgeSeconds: 60 });
  assert.match(read?.install ?? "", /^npm install @4rtofl\/gasho-hub@1\.10\.0 /);
});

test("an owner's packages are read page by page until a page is not full", async () => {
  const others = Array.from({ length: 100 }, (_, i) => ({ ...(json("packages-org-npm.json") as Record<string, unknown>[])[0], name: `other-${i}`, repository: { full_name: "acme/other" } }));
  const pages: string[] = [];
  const ctx = (full: boolean) => ({
    github: {
      read: async (args: string[]) => {
        const path = args[1] ?? "";
        if (path === "graphql") return { stdout: ownerAnswer("Organization", "4rtofl", "4rtofl/Gasho", "someone"), stderr: "" };
        if (!path.includes("package_type=npm")) return { stdout: "[]", stderr: "" };
        pages.push(path.replace(/.*&page=/, ""));
        // Page 1 holds 100 packages of other repositories; the repository's come after.
        return { stdout: path.endsWith("&page=1") || full ? JSON.stringify(others) : fixture("packages-org-npm.json"), stderr: "" };
      },
    },
  });
  const list = await listPackages(ctx(false) as never, "4rtofl/Gasho", { maxAgeSeconds: 60 });
  assert.equal(list.packages.length, 3);
  assert.deepEqual(pages, ["1", "2"]);
  pages.length = 0;
  await listPackages(ctx(true) as never, "4rtofl/Gasho", { maxAgeSeconds: 60 });
  assert.equal(pages.length, PACKAGE_PAGES);
});

test("without read:packages, the answer says how to add it; a package of another repository is not read", async () => {
  const ctx = {
    github: {
      read: async (args: string[]) => {
        if (args[1]?.includes("packages")) throw Object.assign(new Error("x"), { stderr: "gh: You need at least read:packages scope to list packages. (HTTP 403)" });
        return { stdout: ownerAnswer("Organization", "acme", "acme/app", "someone"), stderr: "" };
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
        if (path.includes("packages/npm/")) return { stdout: JSON.stringify((json("packages-org-npm.json") as { name: string }[]).find((p) => p.name === "gasho-hub")), stderr: "" };
        const repo = args.includes("name=Gasho") ? "4rtofl/Gasho" : "4rtofl/GashoPlugins";
        return { stdout: ownerAnswer("Organization", "4rtofl", repo, "someone"), stderr: "" };
      },
    },
  };
  assert.equal(await readPackage(elsewhere as never, "4rtofl/GashoPlugins", "npm", "gasho-hub", { maxAgeSeconds: 60 }), undefined);
  const read = await readPackage(elsewhere as never, "4rtofl/Gasho", "npm", "gasho-hub", { maxAgeSeconds: 60 });
  assert.equal(read?.versions.length, 3);
  assert.match(read?.install ?? "", /^npm install @4rtofl\/gasho-hub@1\.10\.0 /);
});

test("a package of exactly 100 versions has no more; one of more says so", async () => {
  const full = Array.from({ length: VERSIONS_MAX }, (_, i) => ({ id: i + 1, name: `1.0.${i}`, created_at: `2026-11-01T00:00:${String(i % 60).padStart(2, "0")}Z` }));
  const ctx = (after: unknown[]) => ({
    github: {
      read: async (args: string[]) => {
        const path = args[1] ?? "";
        if (path === "graphql") return { stdout: ownerAnswer("Organization", "4rtofl", "4rtofl/Gasho", "someone"), stderr: "" };
        if (path.endsWith(`/versions?per_page=1&page=${VERSIONS_MAX + 1}`)) return { stdout: JSON.stringify(after), stderr: "" };
        if (path.endsWith("/versions?per_page=100")) return { stdout: JSON.stringify(full), stderr: "" };
        return { stdout: JSON.stringify((json("packages-org-npm.json") as { name: string }[]).find((p) => p.name === "gasho-hub")), stderr: "" };
      },
    },
  });
  assert.equal((await readPackage(ctx([]) as never, "4rtofl/Gasho", "npm", "gasho-hub", { maxAgeSeconds: 60 }))?.truncated, false);
  assert.equal((await readPackage(ctx([{ id: 999, name: "0.0.1" }]) as never, "4rtofl/Gasho", "npm", "gasho-hub", { maxAgeSeconds: 60 }))?.truncated, true);
});

test("a package's name is checked before it reaches gh", () => {
  assert.equal(packageNameArg("gasho-plugin-sdk"), "gasho-plugin-sdk");
  assert.equal(packageNameArg("org/app"), "org/app");
  for (const bad of ["-x", "../x", "a b", "", 3, "a?b"]) assert.equal(packageNameArg(bad), undefined);
});
