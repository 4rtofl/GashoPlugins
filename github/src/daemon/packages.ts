// GitHub Packages of a repository, and one package's versions. GraphQL's repository.packages leaves out npm packages,
// so the owner's packages are read with REST, one kind at a time (/orgs/{org}/packages, /user/packages for gh's own
// login, /users/{user}/packages for another user), and those whose repository is the session's are kept. gh's login
// needs read:packages; without it, the answer says how to add it.
// The owner is first read as the repository's, by the name its clone's origin says: after an owner was renamed, that
// name still finds the repository, but /users/{old login} and /orgs/{old login} find no one.
// A package's updated_at stays when a version is published: the list reads each package's newest version for that.
import type { Package, PackageDetail, Packages, PackageType, PackageVersion } from "../types.ts";
import { arr, githubUrl, missingScope, num, parseJson, rec, str, type Gh } from "./gh.ts";

export const PACKAGE_TYPES: readonly PackageType[] = ["npm", "container", "maven", "rubygems", "nuget", "docker"];
export const VERSIONS_MAX = 100;
/** Packages of the list whose newest version is read (one gh each). */
export const PUBLISHED_MAX = 30;
/** Tags that sign or attest an image rather than name it: "sha256-<its digest>", maybe with ".sig", ".att", …. */
const SIGNATURE_TAG = /^sha256-[0-9a-f]{64}(?:\.\w+)?$/;
/** An owner's packages of a kind: read this many a page, and this many pages at most. */
const PER_PAGE = 100;
export const PACKAGE_PAGES = 10;

export const OWNER_QUERY = "query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { nameWithOwner owner { __typename login } } viewer { login } }";

/** The repository's owner as GitHub names it now, the repository's name now (owner/name), and whose packages these are. */
export interface Owner {
  login: string;
  repo: string;
  kind: "org" | "me" | "user";
}

export const packageTypeArg = (v: unknown): PackageType | undefined => (PACKAGE_TYPES as readonly unknown[]).includes(v) ? (v as PackageType) : undefined;

/** A package's name as GitHub allows it: no "..", nothing gh would take as a flag. */
export const packageNameArg = (v: unknown): string | undefined =>
  typeof v === "string" && /^[A-Za-z0-9_.@][A-Za-z0-9_.@/-]{0,199}$/.test(v) && !v.includes("..") ? v : undefined;

/** The REST path of an owner's packages: an organization's, gh's own login's, or another user's. */
export function packagesBase(owner: string, kind: "org" | "me" | "user"): string {
  return kind === "org" ? `orgs/${owner}/packages` : kind === "me" ? "user/packages" : `users/${owner}/packages`;
}

/** A package of `/…/packages` output, if it is the repository's (`repo`: owner/name, any case). */
export function parsePackage(raw: unknown, repo?: string): Package | undefined {
  const p = rec(raw);
  const type = packageTypeArg(p.package_type);
  const name = str(p.name);
  const url = githubUrl(p.html_url);
  if (!type || !name || !url) return undefined;
  if (repo !== undefined && str(rec(p.repository).full_name)?.toLowerCase() !== repo.toLowerCase()) return undefined;
  return {
    type,
    name,
    visibility: str(p.visibility) ?? "",
    ...(num(p.version_count) !== undefined ? { versions: num(p.version_count) } : {}),
    ...(str(p.created_at) ? { createdAt: str(p.created_at) } : {}),
    url,
  };
}

/** A page of `/…/packages?package_type=…` output (parsed): the packages of `repo`. */
export function parsePackages(page: unknown, repo: string): Package[] {
  return arr(page).flatMap((p) => {
    const pkg = parsePackage(p, repo);
    return pkg ? [pkg] : [];
  });
}

/** `/…/packages/{type}/{name}/versions` output, newest first. */
export function parseVersions(json: string): PackageVersion[] {
  return arr(parseJson(json))
    .flatMap((raw): PackageVersion[] => {
      const v = rec(raw);
      const id = num(v.id);
      const name = str(v.name);
      if (!id || !name) return [];
      const tags = arr(rec(rec(v.metadata).container).tags).filter((t): t is string => typeof t === "string" && t !== "");
      return [
        {
          id,
          name,
          ...(rec(rec(v.metadata).container).tags !== undefined ? { tags } : {}),
          ...(str(v.created_at) ? { createdAt: str(v.created_at) } : {}),
          ...(githubUrl(v.html_url) ? { url: githubUrl(v.html_url) } : {}),
        },
      ];
    })
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

const imageTags = (v: PackageVersion): string[] => (v.tags ?? []).filter((t) => !SIGNATURE_TAG.test(t));

/**
 * How to install the newest of `versions` (newest first) of `pkg` (of `owner`, in `repo`'s name `repoName`); undefined
 * when the name does not tell. A container's is its newest version tagged as an image ("latest" among its tags if it has
 * it), else its newest one without tags, by its digest.
 */
export function installCommand(pkg: Pick<Package, "type" | "name">, owner: string, repoName: string, versions: PackageVersion[]): string | undefined {
  const o = owner.toLowerCase();
  const version = versions[0];
  switch (pkg.type) {
    case "npm":
      return `npm install @${o}/${pkg.name}${version ? `@${version.name}` : ""} --registry=https://npm.pkg.github.com`;
    case "container": {
      const tagged = versions.find((v) => imageTags(v).length > 0);
      const tags = tagged ? imageTags(tagged) : [];
      const untagged = tagged ? undefined : versions.find((v) => !v.tags?.length && v.name.startsWith("sha256:"));
      const ref = tags.length ? `:${tags.includes("latest") ? "latest" : tags[0]}` : untagged ? `@${untagged.name}` : "";
      return `docker pull ghcr.io/${o}/${pkg.name.toLowerCase()}${ref}`;
    }
    case "rubygems":
      return `gem install ${pkg.name}${version ? ` --version ${version.name}` : ""} --source https://rubygems.pkg.github.com/${o}`;
    case "nuget":
      return `dotnet add package ${pkg.name}${version ? ` --version ${version.name}` : ""} --source https://nuget.pkg.github.com/${o}/index.json`;
    case "docker":
      return `docker pull docker.pkg.github.com/${o}/${repoName.toLowerCase()}/${pkg.name}${version ? `:${version.name}` : ""}`;
    default:
      // Maven names a package by group and artifact, which its name does not split into.
      return undefined;
  }
}

/** The answer of OWNER_QUERY; undefined when it holds no repository. */
export function parseOwner(json: string): Owner | undefined {
  const data = rec(rec(parseJson(json)).data);
  const repository = rec(data.repository);
  const owner = rec(repository.owner);
  const login = str(owner.login);
  const repo = str(repository.nameWithOwner);
  if (!login || !repo) return undefined;
  const kind = owner.__typename === "Organization" ? "org" : str(rec(data.viewer).login)?.toLowerCase() === login.toLowerCase() ? "me" : "user";
  return { login, repo, kind };
}

/** The owner of `repo` (owner/name, as its origin says). It changes rarely: kept 10 minutes unless read afresh. */
async function ownerOf(ctx: Gh, repo: string, o: { maxAgeSeconds: number }): Promise<Owner> {
  const [owner = "", name = ""] = repo.split("/");
  const { stdout } = await ctx.github.read(["api", "graphql", "-f", `query=${OWNER_QUERY}`, "-f", `owner=${owner}`, "-f", `name=${name}`], {
    repo,
    maxAgeSeconds: o.maxAgeSeconds === 0 ? 0 : 600,
    timeoutMs: 20_000,
  });
  const found = parseOwner(stdout);
  if (!found) throw new Error(`repository ${repo} not found`);
  return found;
}

/** The packages of a kind at `base` (an owner's) that are `repo`'s, page by page. */
async function packagesOfKind(ctx: Gh, base: string, type: PackageType, repo: string, read: { repo: string; maxAgeSeconds: number }): Promise<Package[]> {
  const found: Package[] = [];
  for (let page = 1; page <= PACKAGE_PAGES; page++) {
    const { stdout } = await ctx.github.read(["api", `${base}?package_type=${type}&per_page=${PER_PAGE}&page=${page}`], { ...read, timeoutMs: 25_000 });
    const list = arr(parseJson(stdout));
    found.push(...parsePackages(list, repo));
    if (list.length < PER_PAGE) break;
  }
  return found;
}

/** When the newest version of package `pkg` at `base` was published; undefined when it cannot be read. */
async function publishedAt(ctx: Gh, base: string, pkg: Package, read: { repo: string; maxAgeSeconds: number }): Promise<string | undefined> {
  try {
    const { stdout } = await ctx.github.read(["api", `${base}/${pkg.type}/${encodeURIComponent(pkg.name)}/versions?per_page=1`], { ...read, timeoutMs: 25_000 });
    return parseVersions(stdout)[0]?.createdAt;
  } catch {
    return undefined;
  }
}

/** The packages of `repo` (owner/name), the newest version published first. */
export async function listPackages(ctx: Gh, repo: string, o: { maxAgeSeconds: number }): Promise<Omit<Packages, "repo">> {
  const owner = await ownerOf(ctx, repo, o);
  const base = packagesBase(owner.login, owner.kind);
  const errors: string[] = [];
  let missing: Packages["missing"];
  const lists = await Promise.all(
    PACKAGE_TYPES.map(async (type) => {
      try {
        return await packagesOfKind(ctx, base, type, owner.repo, { repo, maxAgeSeconds: o.maxAgeSeconds });
      } catch (e) {
        const scope = missingScope(e);
        if (scope) missing = scope;
        else errors.push(type);
        return [];
      }
    }),
  );
  const found = lists.flat();
  const packages = await Promise.all(
    found.map(async (pkg, i) => {
      const at = i < PUBLISHED_MAX ? await publishedAt(ctx, base, pkg, { repo, maxAgeSeconds: o.maxAgeSeconds }) : undefined;
      return at ? { ...pkg, publishedAt: at } : pkg;
    }),
  );
  packages.sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
  const undated = Math.max(0, found.length - PUBLISHED_MAX);
  return { packages, ...(missing ? { missing } : {}), ...(errors.length ? { errors } : {}), ...(undated ? { undated } : {}) };
}

/** Package `type`/`name` of `repo`'s owner with its versions; undefined when it is not there or not the repository's. */
export async function readPackage(ctx: Gh, repo: string, type: PackageType, name: string, o: { maxAgeSeconds: number }): Promise<Omit<PackageDetail, "repo"> | undefined> {
  const owner = await ownerOf(ctx, repo, o);
  const path = `${packagesBase(owner.login, owner.kind)}/${type}/${encodeURIComponent(name)}`;
  const read = { repo, maxAgeSeconds: o.maxAgeSeconds, timeoutMs: 25_000 };
  const [info, versions] = await Promise.all([
    ctx.github.read(["api", path], read),
    ctx.github.read(["api", `${path}/versions?per_page=${VERSIONS_MAX}`], { ...read, maxBuffer: 16 * 1024 * 1024 }),
  ]);
  const pkg = parsePackage(parseJson(info.stdout), owner.repo);
  if (!pkg) return undefined;
  const list = parseVersions(versions.stdout);
  // A full page may be all there is: there are more only when a version comes after it.
  const more = list.length >= VERSIONS_MAX ? arr(parseJson((await ctx.github.read(["api", `${path}/versions?per_page=1&page=${VERSIONS_MAX + 1}`], read)).stdout)) : [];
  const install = installCommand(pkg, owner.login, owner.repo.split("/")[1] ?? "", list);
  return { package: pkg, versions: list, truncated: more.length > 0, ...(install ? { install } : {}) };
}
