#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  access,
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";

const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FOUNDATION_VERSION = "1.0.0";
const OFFICIAL_UPSTREAM = "https://github.com/DevCrop/project-foundation";
const VALID_PROFILES = new Set(["core", "typescript", "scss", "docker"]);
const MANAGED_PATHS = [
  ".agents/skills/architecture-selection/SKILL.md",
  ".claude/skills/architecture-selection/SKILL.md",
  ".cursor/rules/project.mdc",
  ".editorconfig",
  ".foundation/toolchain.json",
  ".gitattributes",
  ".github/CODEOWNERS",
  ".github/ISSUE_TEMPLATE/change.yml",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/dependabot.yml",
  ".github/workflows/dependency-review.yml",
  ".github/workflows/quality.yml",
  "AGENTS.md",
  "CLAUDE.md",
  "FOUNDATION.md",
  "SECURITY.md",
  "SOURCES.json",
  "scripts/foundation.mjs",
];
const PROFILE_PATHS = {
  typescript: ["tsconfig.json", "src/main.ts"],
  scss: ["styles/_tokens.scss", "styles/_mixins.scss", "styles/main.scss"],
  docker: ["Dockerfile", "compose.yaml", ".dockerignore", ".env.example", "Makefile"],
};
const ROOT_TEXT_FILES = new Set([
  ".dockerignore",
  ".editorconfig",
  ".env.example",
  ".gitattributes",
  ".gitignore",
  "Dockerfile",
  "LICENSE",
  "Makefile",
]);
const TEXT_EXTENSIONS = new Set([
  ".css",
  ".env",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mdc",
  ".mjs",
  ".scss",
  ".ts",
  ".txt",
  ".yaml",
  ".yml",
]);
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".release",
  ".cache",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "tmp",
]);
const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 50 * 1024 * 1024;

class FoundationError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = "FoundationError";
    this.details = details;
  }
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function normalizeRelative(value) {
  if (typeof value !== "string" || value.includes("\0") || path.isAbsolute(value)) {
    throw new FoundationError(`Unsafe path: ${String(value)}`);
  }
  const normalized = path.posix.normalize(value.replaceAll("\\", "/"));
  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new FoundationError(`Unsafe path: ${value}`);
  }
  return normalized;
}

function resolveInside(root, relativePath) {
  const normalized = normalizeRelative(relativePath);
  const absoluteRoot = path.resolve(root);
  const absolutePath = path.resolve(absoluteRoot, ...normalized.split("/"));
  const relation = path.relative(absoluteRoot, absolutePath);
  if (relation.startsWith("..") || path.isAbsolute(relation)) {
    throw new FoundationError(`Path escapes project root: ${relativePath}`);
  }
  return absolutePath;
}

async function exists(target) {
  try {
    await access(target, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  let text;
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    throw new FoundationError(`Cannot read JSON: ${filePath}`, [error.message]);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new FoundationError(`Invalid JSON: ${filePath}`, [error.message]);
  }
}

async function writeJsonAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, filePath);
}

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

async function hashFile(filePath) {
  return sha256(await readFile(filePath));
}

async function assertNoSymlink(root, relativePath) {
  const normalized = normalizeRelative(relativePath);
  let current = path.resolve(root);
  for (const segment of normalized.split("/")) {
    current = path.join(current, segment);
    if (!(await exists(current))) continue;
    const information = await lstat(current);
    if (information.isSymbolicLink()) {
      throw new FoundationError(`Symbolic links are not allowed in managed paths: ${relativePath}`);
    }
  }
}

async function walk(root, current = "") {
  const actualDirectory = current ? resolveInside(root, current) : path.resolve(root);
  const entries = await readdir(actualDirectory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      files.push({ path: toPosix(path.join(current, entry.name)), symlink: true });
      continue;
    }
    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue;
      files.push(...(await walk(root, path.join(current, entry.name))));
      continue;
    }
    files.push({ path: toPosix(path.join(current, entry.name)), symlink: false });
  }
  return files;
}

function isTextPath(relativePath) {
  return ROOT_TEXT_FILES.has(relativePath) || TEXT_EXTENSIONS.has(path.extname(relativePath).toLowerCase());
}

function parseVersion(value) {
  const match = String(value).match(/v?(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : null;
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function parseArguments(argv) {
  const positional = [];
  const options = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) {
      positional.push(item);
      continue;
    }
    const equals = item.indexOf("=");
    if (equals !== -1) {
      options.set(item.slice(2, equals), item.slice(equals + 1));
      continue;
    }
    const key = item.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      options.set(key, next);
      index += 1;
    } else {
      options.set(key, true);
    }
  }
  return { positional, options };
}

function parseProfiles(value) {
  const requested = String(value ?? "core")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const profiles = [...new Set(["core", ...requested])];
  const invalid = profiles.filter((profile) => !VALID_PROFILES.has(profile));
  if (invalid.length) throw new FoundationError(`Unknown profiles: ${invalid.join(", ")}`);
  if (profiles.includes("docker") && !profiles.includes("typescript")) {
    throw new FoundationError("The docker profile requires the typescript profile in v1.");
  }
  return profiles;
}

function parseRules(markdown) {
  const matches = [...markdown.matchAll(/^### (PF-[A-Z]+-\d{3})\s+—\s+(.+)$/gm)];
  return matches.map((match, index) => {
    const end = matches[index + 1]?.index ?? markdown.length;
    const block = markdown.slice(match.index, end);
    const field = (name) => block.match(new RegExp(`^- ${name}: (.+)$`, "m"))?.[1]?.trim();
    return {
      id: match[1],
      title: match[2].trim(),
      level: field("Level"),
      profiles: field("Profiles")?.split(",").map((item) => item.trim()) ?? [],
      authority: field("Authority"),
      exception: field("Exception"),
      body: field("Rule"),
    };
  });
}

function normalizedRuleBody(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s.,;:!?`'"()[\]{}_-]+/g, "")
    .trim();
}

async function validateInternalLinks(root, files, errors) {
  const markdownFiles = files.filter((entry) => !entry.symlink && [".md", ".mdc"].includes(path.extname(entry.path)));
  for (const entry of markdownFiles) {
    const text = await readFile(resolveInside(root, entry.path), "utf8");
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const rawTarget = match[1].trim().replace(/^<|>$/g, "");
      if (!rawTarget || rawTarget.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(rawTarget)) continue;
      const cleanTarget = decodeURIComponent(rawTarget.split("#")[0]);
      const target = path.resolve(path.dirname(resolveInside(root, entry.path)), cleanTarget);
      const relation = path.relative(path.resolve(root), target);
      if (relation.startsWith("..") || path.isAbsolute(relation) || !(await exists(target))) {
        errors.push(`${entry.path}: broken or unsafe internal link ${rawTarget}`);
      }
    }
  }
}

async function validateProject(root, { strict = false, now = new Date() } = {}) {
  const errors = [];
  const warnings = [];
  const required = [
    "README.md",
    "FOUNDATION.md",
    "SOURCES.json",
    "AGENTS.md",
    "CLAUDE.md",
    "PROJECT.md",
    "SECURITY.md",
    "LICENSE",
    "package.json",
    ".foundation/manifest.json",
    ".foundation/toolchain.json",
    "scripts/foundation.mjs",
  ];

  for (const relativePath of required) {
    if (!(await exists(resolveInside(root, relativePath)))) errors.push(`Missing required file: ${relativePath}`);
  }
  if (errors.length) return { errors, warnings };

  const files = await walk(root);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (const entry of files) {
    if (entry.symlink) {
      if (MANAGED_PATHS.includes(entry.path)) errors.push(`Managed path is a symbolic link: ${entry.path}`);
      continue;
    }
    if (!isTextPath(entry.path)) continue;
    const bytes = await readFile(resolveInside(root, entry.path));
    let text;
    try {
      text = decoder.decode(bytes);
    } catch {
      errors.push(`${entry.path}: invalid UTF-8`);
      continue;
    }
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) errors.push(`${entry.path}: UTF-8 BOM is not allowed`);
    if (text.includes("\r")) errors.push(`${entry.path}: line endings must be LF`);
  }

  const foundation = await readFile(resolveInside(root, "FOUNDATION.md"), "utf8");
  const rules = parseRules(foundation);
  if (!rules.length) errors.push("FOUNDATION.md: no indexed rules found");
  const ruleIds = new Set();
  const ruleBodies = new Map();
  for (const rule of rules) {
    if (ruleIds.has(rule.id)) errors.push(`Duplicate rule ID: ${rule.id}`);
    ruleIds.add(rule.id);
    if (!rule.level || !["MUST", "SHOULD", "MAY"].includes(rule.level)) errors.push(`${rule.id}: invalid Level`);
    if (!rule.profiles.length || rule.profiles.some((profile) => !VALID_PROFILES.has(profile))) errors.push(`${rule.id}: invalid Profiles`);
    if (!rule.authority) errors.push(`${rule.id}: missing Authority`);
    if (!rule.body) errors.push(`${rule.id}: missing Rule body`);
    if (!rule.exception || !["yes", "no"].includes(rule.exception)) errors.push(`${rule.id}: invalid Exception`);
    const normalized = normalizedRuleBody(rule.body);
    if (normalized && ruleBodies.has(normalized)) errors.push(`Duplicate normalized rule body: ${ruleBodies.get(normalized)} and ${rule.id}`);
    if (normalized) ruleBodies.set(normalized, rule.id);
  }

  let sources;
  try {
    sources = await readJson(resolveInside(root, "SOURCES.json"));
  } catch (error) {
    errors.push(error.message, ...error.details);
    sources = { sources: [], allowedDomains: [] };
  }
  const sourceIds = new Set();
  const allowedDomains = new Set(sources.allowedDomains ?? []);
  for (const source of sources.sources ?? []) {
    if (!source.id || sourceIds.has(source.id)) errors.push(`Duplicate or missing source ID: ${source.id ?? "<missing>"}`);
    sourceIds.add(source.id);
    let url;
    try {
      url = new URL(source.url);
      if (url.protocol !== "https:" || !allowedDomains.has(url.hostname)) errors.push(`${source.id}: source domain is not allowed`);
    } catch {
      errors.push(`${source.id}: invalid source URL`);
    }
    const verifiedAt = new Date(`${source.verifiedAt}T00:00:00Z`);
    const ageDays = Math.floor((now.getTime() - verifiedAt.getTime()) / 86_400_000);
    if (!Number.isFinite(verifiedAt.getTime())) errors.push(`${source.id}: invalid verifiedAt`);
    else if (ageDays > Number(source.reviewIntervalDays ?? 31)) {
      const message = `${source.id}: source verification is ${ageDays} days old`;
      if (strict) errors.push(message);
      else warnings.push(message);
    }
  }
  for (const rule of rules) {
    if (rule.authority !== "policy:project-foundation" && !sourceIds.has(rule.authority)) {
      errors.push(`${rule.id}: unknown source ${rule.authority}`);
    }
  }

  const adapters = [
    "AGENTS.md",
    "CLAUDE.md",
    ".cursor/rules/project.mdc",
    ".claude/skills/architecture-selection/SKILL.md",
  ];
  for (const adapter of adapters) {
    if (!(await exists(resolveInside(root, adapter)))) continue;
    const text = await readFile(resolveInside(root, adapter), "utf8");
    for (const rule of rules) {
      if (rule.body && rule.body.length >= 40 && text.includes(rule.body)) errors.push(`${adapter}: copied common rule ${rule.id}`);
    }
  }

  const projectText = await readFile(resolveInside(root, "PROJECT.md"), "utf8");
  const exceptionSection = projectText.split(/^## Exceptions\s*$/m)[1] ?? "";
  const exceptionMatches = [...exceptionSection.matchAll(/^### (PF-[A-Z]+-\d{3})\s*$/gm)];
  for (let index = 0; index < exceptionMatches.length; index += 1) {
    const match = exceptionMatches[index];
    const id = match[1];
    const blockEnd = exceptionMatches[index + 1]?.index ?? exceptionSection.length;
    const block = exceptionSection.slice(match.index + match[0].length, blockEnd);
    if (!ruleIds.has(id)) errors.push(`PROJECT.md: exception references unknown rule ${id}`);
    for (const field of ["Reason", "Owner", "Review by", "Compensating control"]) {
      if (!new RegExp(`^- ${field}: \\S.+$`, "m").test(block)) errors.push(`PROJECT.md: ${id} exception is missing ${field}`);
    }
    const reviewDate = block.match(/^- Review by: (\d{4}-\d{2}-\d{2})$/m)?.[1];
    if (reviewDate && new Date(`${reviewDate}T23:59:59Z`) < now) errors.push(`PROJECT.md: ${id} exception expired on ${reviewDate}`);
  }

  for (const document of ["README.md", "FOUNDATION.md", "PROJECT.md", "AGENTS.md", "CLAUDE.md"]) {
    const text = await readFile(resolveInside(root, document), "utf8");
    if (/\bmise\b/i.test(text)) errors.push(`${document}: contains a forbidden legacy identifier`);
  }

  await validateInternalLinks(root, files, errors);

  const lockfiles = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb"].filter((name) =>
    files.some((entry) => entry.path === name),
  );
  if (lockfiles.length > 1) errors.push(`Multiple package-manager lockfiles: ${lockfiles.join(", ")}`);
  if (lockfiles.includes("package-lock.json")) {
    try {
      const packageJson = await readJson(resolveInside(root, "package.json"));
      const lock = await readJson(resolveInside(root, "package-lock.json"));
      const lockRoot = lock.packages?.[""] ?? {};
      for (const key of ["dependencies", "devDependencies"]) {
        const declared = packageJson[key] ?? {};
        const locked = lockRoot[key] ?? {};
        if (JSON.stringify(declared) !== JSON.stringify(locked)) errors.push(`package-lock.json: root ${key} does not match package.json`);
      }
    } catch (error) {
      errors.push(error.message, ...(error.details ?? []));
    }
  }

  let manifest;
  try {
    manifest = await readJson(resolveInside(root, ".foundation/manifest.json"));
  } catch (error) {
    errors.push(error.message, ...error.details);
    manifest = { managedFiles: {}, activeProfiles: [] };
  }
  const managedEntries = Object.entries(manifest.managedFiles ?? {});
  if (!managedEntries.length) {
    const message = ".foundation/manifest.json: managedFiles is empty";
    if (strict) errors.push(message);
    else warnings.push(message);
  }
  for (const [relativePath, expectedHash] of managedEntries) {
    try {
      await assertNoSymlink(root, relativePath);
      const filePath = resolveInside(root, relativePath);
      if (!(await exists(filePath))) errors.push(`Missing managed file: ${relativePath}`);
      else if (manifest.mode === "consumer" && (await hashFile(filePath)) !== expectedHash) errors.push(`Modified managed file: ${relativePath}`);
    } catch (error) {
      errors.push(error.message);
    }
  }

  const packageJson = await readJson(resolveInside(root, "package.json"));
  const toolchain = await readJson(resolveInside(root, ".foundation/toolchain.json"));
  if (packageJson.engines?.node !== toolchain.node.range) errors.push("package.json: engines.node does not match toolchain.json");
  if (packageJson.packageManager !== `npm@${toolchain.npm.default}`) errors.push("package.json: packageManager does not match toolchain.json");
  if (manifest.mode === "upstream" && packageJson.version !== manifest.foundationVersion) {
    errors.push("Foundation version mismatch between package.json and manifest");
  }
  if (strict && manifest.mode === "upstream") {
    const changelog = await readFile(resolveInside(root, "CHANGELOG.md"), "utf8");
    if (!changelog.includes(`## ${packageJson.version} -`)) errors.push(`CHANGELOG.md: missing ${packageJson.version} release entry`);
  }

  const activeProfiles = new Set(manifest.activeProfiles ?? []);
  if (activeProfiles.has("docker")) {
    for (const relativePath of PROFILE_PATHS.docker) {
      if (!(await exists(resolveInside(root, relativePath)))) errors.push(`Docker profile is missing ${relativePath}`);
    }
    if (await exists(resolveInside(root, "compose.yml"))) errors.push("compose.yml conflicts with the canonical compose.yaml");
    if (await exists(resolveInside(root, "compose.yaml"))) {
      const compose = await readFile(resolveInside(root, "compose.yaml"), "utf8");
      if (/^version\s*:/m.test(compose)) errors.push("compose.yaml: obsolete top-level version is not allowed");
      for (const pattern of [/privileged\s*:\s*true/i, /network_mode\s*:\s*host/i, /docker\.sock/i]) {
        if (pattern.test(compose)) errors.push(`compose.yaml: forbidden high-risk setting ${pattern}`);
      }
    }
    if (await exists(resolveInside(root, "Dockerfile"))) {
      const dockerfile = await readFile(resolveInside(root, "Dockerfile"), "utf8");
      if (!/^ARG NODE_IMAGE=[^\s:]+:[^\s@]+@sha256:[a-f0-9]{64}$/m.test(dockerfile)) {
        errors.push("Dockerfile: NODE_IMAGE must include a version tag and SHA-256 digest");
      }
      if (/^ARG\s+\w*(TOKEN|PASSWORD|SECRET|KEY)\w*/im.test(dockerfile)) errors.push("Dockerfile: secrets must not be build arguments");
      if (!/^USER node$/m.test(dockerfile)) errors.push("Dockerfile: production stage must use a non-root user");
      if (!dockerfile.includes(toolchain.docker.baseImage)) errors.push("Dockerfile: base image does not match toolchain.json");
      if (!dockerfile.includes(toolchain.docker.dockerfileFrontend)) errors.push("Dockerfile: frontend does not match toolchain.json");
    }
    if (await exists(resolveInside(root, "Makefile"))) {
      const makefile = await readFile(resolveInside(root, "Makefile"), "utf8");
      const requiredTargets = ["help", "doctor", "validate", "test", "build", "image", "config", "up", "watch", "down", "logs", "ps", "release-check"];
      for (const target of requiredTargets) {
        if (!new RegExp(`^${target}:`, "m").test(makefile)) errors.push(`Makefile: missing target ${target}`);
      }
      const phony = makefile.match(/^\.PHONY:\s+(.+)$/m)?.[1]?.split(/\s+/) ?? [];
      for (const target of requiredTargets) if (!phony.includes(target)) errors.push(`Makefile: ${target} is not .PHONY`);
    }
  }

  for (const entry of files.filter((item) => item.path.startsWith(".github/workflows/") && item.path.endsWith(".yml"))) {
    const workflow = await readFile(resolveInside(root, entry.path), "utf8");
    if (/pull_request_target\s*:/m.test(workflow)) errors.push(`${entry.path}: pull_request_target is forbidden`);
    for (const match of workflow.matchAll(/^\s*uses:\s*([^@\s]+)@([^\s#]+)/gm)) {
      const reference = match[2];
      if (!match[1].startsWith("./") && !/^[a-f0-9]{40}$/.test(reference)) errors.push(`${entry.path}: external action is not pinned to a full commit SHA`);
    }
  }
  const qualityPath = resolveInside(root, ".github/workflows/quality.yml");
  if (await exists(qualityPath)) {
    const quality = await readFile(qualityPath, "utf8");
    for (const version of toolchain.node.supported) {
      if (!quality.includes(`"${version}"`)) errors.push(`quality.yml: missing supported Node ${version}`);
    }
  }

  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)], ruleCount: rules.length, sourceCount: sourceIds.size };
}

async function refreshManifest(root) {
  const manifestPath = resolveInside(root, ".foundation/manifest.json");
  const manifest = await readJson(manifestPath);
  const packageJson = await readJson(resolveInside(root, "package.json"));
  const managedFiles = {};
  for (const relativePath of MANAGED_PATHS) {
    const filePath = resolveInside(root, relativePath);
    if (!(await exists(filePath))) throw new FoundationError(`Cannot index missing managed file: ${relativePath}`);
    managedFiles[relativePath] = await hashFile(filePath);
  }
  manifest.foundationVersion = packageJson.version;
  manifest.managedFiles = managedFiles;
  await writeJsonAtomic(manifestPath, manifest);
  return manifest;
}

function projectDocument(projectName, profiles) {
  return `# ${projectName} Project Rules

## Identity

- Project: ${projectName}
- Foundation version: ${FOUNDATION_VERSION}
- Active profiles: ${profiles.join(", ")}
- Owner: project owner

## Commands

Record the project's install, validate, test, build, and start commands here.

## Architecture

No design pattern has been approved yet. Use the architecture-selection Skill before structural changes.

## Type Ownership

Record the module that owns each shared domain type. Do not create a global catch-all type file.

## Styling

Search existing tokens, variables, functions, and Mixins before adding new SCSS assets.

## Docker

- Application port: 3000
- Production output: \`dist/\`
- Build command: \`npm run build\`
- Start command: \`npm start\`

## Performance Budgets

- Production image size: not measured
- Cold build time: not measured
- Cached build time: not measured
- Container readiness time: not measured

## Exceptions

No active Foundation exceptions.
`;
}

function consumerReadme(projectName, profiles) {
  return `# ${projectName}

This project uses Project Foundation ${FOUNDATION_VERSION} with the following profiles: ${profiles.join(", ")}.

## Setup

\`\`\`text
npm ci
node scripts/foundation.mjs doctor
node scripts/foundation.mjs validate --strict
\`\`\`

Project-specific decisions belong in [PROJECT.md](PROJECT.md). Shared rules are indexed in [FOUNDATION.md](FOUNDATION.md).
`;
}

async function snapshotPaths(root, relativePaths) {
  const snapshots = new Map();
  for (const relativePath of relativePaths) {
    const filePath = resolveInside(root, relativePath);
    if (await exists(filePath)) {
      const information = await lstat(filePath);
      if (information.isSymbolicLink()) throw new FoundationError(`Refusing to replace symbolic link: ${relativePath}`);
      snapshots.set(relativePath, information.isFile() ? await readFile(filePath) : null);
    } else {
      snapshots.set(relativePath, undefined);
    }
  }
  return snapshots;
}

async function restoreSnapshots(root, snapshots) {
  for (const [relativePath, data] of snapshots) {
    const filePath = resolveInside(root, relativePath);
    if (data === undefined) {
      await rm(filePath, { force: true, recursive: true });
    } else if (data !== null) {
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, data);
    }
  }
}

function seedSelected(relativePath, profiles) {
  for (const [profile, paths] of Object.entries(PROFILE_PATHS)) {
    if (paths.includes(relativePath)) return profiles.includes(profile);
  }
  return true;
}

async function copyFoundationFile(sourceRoot, targetRoot, relativePath) {
  await assertNoSymlink(targetRoot, relativePath);
  const source = resolveInside(sourceRoot, relativePath);
  const target = resolveInside(targetRoot, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target, fsConstants.COPYFILE_EXCL);
}

async function initProject(root, { profile, projectName }) {
  const profiles = parseProfiles(profile);
  const name = String(projectName ?? path.basename(root)).trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,213}$/.test(name)) throw new FoundationError(`Invalid project name: ${name}`);

  const manifestPath = resolveInside(root, ".foundation/manifest.json");
  const currentManifest = (await exists(manifestPath)) ? await readJson(manifestPath) : null;
  const inPlaceTemplate = path.resolve(root) === SCRIPT_ROOT && currentManifest?.mode === "upstream";
  if (currentManifest?.mode === "consumer") throw new FoundationError("This project is already initialized.");

  const sourceManifest = await readJson(resolveInside(SCRIPT_ROOT, ".foundation/manifest.json"));
  const selectedSeeds = sourceManifest.seedFiles.filter((item) => seedSelected(item, profiles));
  const destinationPaths = [
    ...MANAGED_PATHS,
    ...selectedSeeds,
    ".foundation/manifest.json",
    "PROJECT.md",
    "README.md",
    "package.json",
    "package-lock.json",
  ];
  const changingPaths = [...new Set([...destinationPaths, ...sourceManifest.upstreamOnlyFiles, ...Object.values(PROFILE_PATHS).flat()])];
  const snapshots = await snapshotPaths(root, changingPaths);

  try {
    if (!inPlaceTemplate) {
      const conflicts = [];
      for (const relativePath of destinationPaths) if (await exists(resolveInside(root, relativePath))) conflicts.push(relativePath);
      if (conflicts.length) throw new FoundationError("Initialization would overwrite existing files.", conflicts);
      for (const relativePath of MANAGED_PATHS) await copyFoundationFile(SCRIPT_ROOT, root, relativePath);
      for (const relativePath of selectedSeeds) {
        if (["README.md", "PROJECT.md", "package.json", "package-lock.json"].includes(relativePath)) continue;
        await copyFoundationFile(SCRIPT_ROOT, root, relativePath);
      }
    }

    const packageJson = await readJson(resolveInside(SCRIPT_ROOT, "package.json"));
    packageJson.name = name;
    packageJson.version = "0.1.0";
    packageJson.private = true;
    packageJson.scripts.test = "node --test";
    if (!profiles.includes("typescript")) {
      delete packageJson.devDependencies["@types/node"];
      delete packageJson.devDependencies.typescript;
      delete packageJson.scripts.build;
      delete packageJson.scripts.start;
    }
    if (!profiles.includes("scss")) {
      delete packageJson.devDependencies.sass;
      delete packageJson.scripts["styles:build"];
    }
    await writeJsonAtomic(resolveInside(root, "package.json"), packageJson);

    const sourceLockPath = resolveInside(SCRIPT_ROOT, "package-lock.json");
    if (await exists(sourceLockPath)) {
      const lock = await readJson(sourceLockPath);
      lock.name = name;
      lock.version = "0.1.0";
      lock.packages[""].name = name;
      lock.packages[""].version = "0.1.0";
      lock.packages[""].devDependencies = packageJson.devDependencies;
      await writeJsonAtomic(resolveInside(root, "package-lock.json"), lock);
    }

    await writeFile(resolveInside(root, "README.md"), consumerReadme(name, profiles), "utf8");
    await writeFile(resolveInside(root, "PROJECT.md"), projectDocument(name, profiles), "utf8");
    if (profiles.includes("docker")) {
      const composePath = resolveInside(root, "compose.yaml");
      const compose = await readFile(composePath, "utf8");
      await writeFile(composePath, compose.replaceAll("project-foundation", name), "utf8");
      await writeFile(resolveInside(root, ".env.example"), `COMPOSE_PROJECT_NAME=${name}\nPORT=3000\n`, "utf8");
    }

    for (const [profileName, profilePaths] of Object.entries(PROFILE_PATHS)) {
      if (profiles.includes(profileName)) continue;
      for (const relativePath of profilePaths) await rm(resolveInside(root, relativePath), { force: true, recursive: true });
    }
    for (const relativePath of sourceManifest.upstreamOnlyFiles) await rm(resolveInside(root, relativePath), { force: true, recursive: true });

    const managedFiles = {};
    for (const relativePath of MANAGED_PATHS) managedFiles[relativePath] = await hashFile(resolveInside(root, relativePath));
    const consumerManifest = {
      schemaVersion: 1,
      foundationVersion: FOUNDATION_VERSION,
      mode: "consumer",
      activeProfiles: profiles,
      upstream: OFFICIAL_UPSTREAM,
      managedFiles,
      seedFiles: selectedSeeds,
      upstreamOnlyFiles: sourceManifest.upstreamOnlyFiles,
    };
    await writeJsonAtomic(manifestPath, consumerManifest);

    const validation = await validateProject(root, { strict: false });
    if (validation.errors.length) throw new FoundationError("Initialized project did not validate.", validation.errors);
    return { name, profiles };
  } catch (error) {
    await restoreSnapshots(root, snapshots);
    throw error;
  }
}

function runCommand(command, args, { input, timeout = 10_000 } = {}) {
  const useWindowsShell = process.platform === "win32" && command === "npm";
  const result = spawnSync(command, args, {
    encoding: "utf8",
    input,
    timeout,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
    shell: useWindowsShell,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout?.trim() ?? "",
    stderr: result.stderr?.trim() ?? "",
    error: result.error,
  };
}

async function doctor(root) {
  const manifest = await readJson(resolveInside(root, ".foundation/manifest.json"));
  const toolchain = await readJson(resolveInside(root, ".foundation/toolchain.json"));
  const checks = [];
  const nodeVersion = process.versions.node;
  checks.push({ name: "Node", ok: compareVersions(nodeVersion, "22.22.0") >= 0 && compareVersions(nodeVersion, "25.0.0") < 0, value: nodeVersion, required: true });

  const npm = runCommand("npm", ["--version"]);
  const npmVersion = npm.stdout || npm.stderr;
  checks.push({ name: "npm", ok: npm.ok && compareVersions(npmVersion, toolchain.npm.minimum) >= 0, value: npmVersion, required: true });
  const git = runCommand("git", ["--version"]);
  checks.push({ name: "Git", ok: git.ok, value: git.stdout || git.stderr, required: true });

  if (manifest.activeProfiles.includes("docker")) {
    const docker = runCommand("docker", ["--version"]);
    checks.push({ name: "Docker", ok: docker.ok, value: docker.stdout || docker.stderr, required: true });
    const compose = runCommand("docker", ["compose", "version", "--short"]);
    const composeVersion = compose.stdout || compose.stderr;
    checks.push({ name: "Compose", ok: compose.ok && compareVersions(composeVersion, toolchain.compose.minimum) >= 0, value: composeVersion, required: true });
    const buildx = runCommand("docker", ["buildx", "version"]);
    const buildxVersion = buildx.stdout.match(/v?\d+\.\d+\.\d+/)?.[0] ?? buildx.stderr;
    checks.push({ name: "Buildx", ok: buildx.ok && compareVersions(buildxVersion, toolchain.buildx.minimum) >= 0, value: buildxVersion, required: true });
    const daemon = runCommand("docker", ["info", "--format", "{{.ServerVersion}}"], { timeout: 15_000 });
    checks.push({ name: "Docker daemon", ok: daemon.ok, value: daemon.stdout || daemon.stderr, required: true });
  }

  const make = runCommand("make", ["--version"]);
  checks.push({ name: "GNU Make", ok: make.ok, value: make.stdout.split("\n")[0] || make.stderr, required: false });
  const gh = runCommand("gh", ["--version"]);
  checks.push({ name: "GitHub CLI", ok: gh.ok, value: gh.stdout.split("\n")[0] || gh.stderr, required: false });

  for (const check of checks) console.log(`${check.ok ? "OK" : check.required ? "ERROR" : "WARN"} ${check.name}: ${check.value || "not found"}`);
  const failures = checks.filter((check) => check.required && !check.ok);
  if (failures.length) throw new FoundationError("Required tool checks failed.", failures.map((item) => item.name));
  return checks;
}

function validateRepositoryName(repo) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new FoundationError(`Invalid GitHub repository: ${repo}`);
  return repo;
}

function ghApi(method, endpoint, body, { allowFailure = false } = {}) {
  const args = ["api", `repos/${endpoint}`];
  if (method !== "GET") args.push("--method", method);
  let input;
  if (body !== undefined) {
    args.push("--input", "-");
    input = JSON.stringify(body);
  }
  const result = runCommand("gh", args, { input, timeout: 30_000 });
  if (!result.ok && !allowFailure) throw new FoundationError(`GitHub API request failed: ${method} ${endpoint}`, [result.stderr]);
  if (!result.ok) return { ok: false, error: result.stderr };
  try {
    return { ok: true, data: result.stdout ? JSON.parse(result.stdout) : null };
  } catch {
    return { ok: true, data: result.stdout };
  }
}

const REPOSITORY_TARGET = {
  private: false,
  has_issues: true,
  has_projects: false,
  has_wiki: false,
  is_template: true,
  allow_squash_merge: true,
  allow_merge_commit: false,
  allow_rebase_merge: false,
  allow_auto_merge: true,
  delete_branch_on_merge: true,
};

function rulesetPayload() {
  return {
    name: "main protection",
    target: "branch",
    enforcement: "active",
    bypass_actors: [{ actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "pull_request" }],
    conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
    rules: [
      { type: "deletion" },
      { type: "non_fast_forward" },
      { type: "required_linear_history" },
      {
        type: "pull_request",
        parameters: {
          allowed_merge_methods: ["squash"],
          dismiss_stale_reviews_on_push: false,
          require_code_owner_review: false,
          require_last_push_approval: false,
          required_approving_review_count: 0,
          required_review_thread_resolution: true,
        },
      },
      {
        type: "required_status_checks",
        parameters: {
          do_not_enforce_on_create: true,
          strict_required_status_checks_policy: true,
          required_status_checks: [
            { context: "quality (Node 22.23.2)" },
            { context: "quality (Node 24.19.0)" },
            { context: "container" },
            { context: "dependency-review" },
          ],
        },
      },
    ],
  };
}

async function githubPlan(repo) {
  validateRepositoryName(repo);
  const auth = runCommand("gh", ["auth", "status"], { timeout: 15_000 });
  if (!auth.ok) throw new FoundationError("GitHub CLI is not authenticated. No remote changes were attempted.", [auth.stderr]);
  const repository = ghApi("GET", repo).data;
  const differences = [];
  for (const [key, expected] of Object.entries(REPOSITORY_TARGET)) {
    if (repository[key] !== expected) differences.push({ setting: key, current: repository[key], target: expected });
  }
  const rulesets = ghApi("GET", `${repo}/rulesets`, undefined, { allowFailure: true });
  const hasRuleset = rulesets.ok && Array.isArray(rulesets.data) && rulesets.data.some((item) => item.name === "main protection" && item.enforcement === "active");
  if (!hasRuleset) differences.push({ setting: "ruleset", current: "missing or inactive", target: "main protection active" });

  const actions = ghApi("GET", `${repo}/actions/permissions`, undefined, { allowFailure: true });
  if (!actions.ok || actions.data?.sha_pinning_required !== true) differences.push({ setting: "actions.sha_pinning_required", current: actions.data?.sha_pinning_required ?? "unavailable", target: true });

  console.log(JSON.stringify({ repo, differences, limitations: [
    "Availability of secret scanning, push protection, CodeQL default setup, and private vulnerability reporting depends on the repository plan and eligibility.",
    "github apply reports unsupported endpoints instead of claiming success.",
  ] }, null, 2));
  return differences;
}

async function githubApply(repo, confirmed) {
  validateRepositoryName(repo);
  if (repo !== "DevCrop/project-foundation") throw new FoundationError("github apply is restricted to DevCrop/project-foundation in v1.");
  if (!confirmed) throw new FoundationError("github apply requires --confirm.");
  await githubPlan(repo);
  ghApi("PATCH", repo, REPOSITORY_TARGET);

  const existing = ghApi("GET", `${repo}/rulesets`, undefined, { allowFailure: true });
  const ruleset = existing.ok && Array.isArray(existing.data) ? existing.data.find((item) => item.name === "main protection") : null;
  if (ruleset) ghApi("PUT", `${repo}/rulesets/${ruleset.id}`, rulesetPayload());
  else ghApi("POST", `${repo}/rulesets`, rulesetPayload());

  const optional = [
    ["PUT", `${repo}/vulnerability-alerts`, undefined, "Dependabot alerts"],
    ["PUT", `${repo}/automated-security-fixes`, undefined, "Dependabot security updates"],
    ["PUT", `${repo}/private-vulnerability-reporting`, undefined, "Private vulnerability reporting"],
    ["PUT", `${repo}/actions/permissions`, { enabled: true, allowed_actions: "all", sha_pinning_required: true }, "Action SHA pinning"],
    ["PATCH", `${repo}/code-scanning/default-setup`, { state: "configured", query_suite: "default" }, "CodeQL default setup"],
    ["PATCH", repo, { security_and_analysis: { secret_scanning: { status: "enabled" }, secret_scanning_push_protection: { status: "enabled" } } }, "Secret scanning and push protection"],
  ];
  const results = [];
  for (const [method, endpoint, body, name] of optional) {
    const result = ghApi(method, endpoint, body, { allowFailure: true });
    results.push({ name, status: result.ok ? "applied" : "unsupported or denied", detail: result.ok ? undefined : result.error });
  }
  console.log(JSON.stringify({ repo, settings: "applied", optional: results }, null, 2));
  return results;
}

async function download(url, maximumBytes = MAX_ARCHIVE_BYTES) {
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new FoundationError(`Download failed (${response.status}): ${url}`);
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > maximumBytes) throw new FoundationError(`Download exceeds size limit: ${url}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maximumBytes) throw new FoundationError(`Download exceeds size limit: ${url}`);
  return bytes;
}

function parseTarGz(archive) {
  const tar = gunzipSync(archive, { maxOutputLength: MAX_EXPANDED_BYTES });
  const files = new Map();
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const readString = (start, length) => Buffer.from(header.subarray(start, start + length)).toString("utf8").replace(/\0.*$/s, "");
    const name = readString(0, 100);
    const prefix = readString(345, 155);
    const rawName = prefix ? `${prefix}/${name}` : name;
    const sizeText = readString(124, 12).trim();
    const size = Number.parseInt(sizeText || "0", 8);
    const type = String.fromCharCode(header[156] || 48);
    if (!Number.isSafeInteger(size) || size < 0) throw new FoundationError(`Invalid tar size for ${rawName}`);
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > tar.length) throw new FoundationError(`Truncated tar entry: ${rawName}`);
    if (type === "0" || type === "\0") files.set(normalizeRelative(rawName), Buffer.from(tar.subarray(dataStart, dataEnd)));
    else if (type !== "5") throw new FoundationError(`Unsupported tar entry type for ${rawName}`);
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  const names = [...files.keys()];
  const firstSegments = new Set(names.map((name) => name.split("/")[0]));
  if (firstSegments.size === 1 && names.every((name) => name.includes("/"))) {
    const prefix = `${names[0].split("/")[0]}/`;
    return new Map(names.map((name) => [normalizeRelative(name.slice(prefix.length)), files.get(name)]));
  }
  return files;
}

async function resolveUpdateVersion(version, baseUrl) {
  if (version) {
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new FoundationError(`Invalid release version: ${version}`);
    return version;
  }
  if (baseUrl) throw new FoundationError("Tests using a custom release URL must specify --version.");
  const latest = await download("https://api.github.com/repos/DevCrop/project-foundation/releases/latest", 1024 * 1024);
  const release = JSON.parse(new TextDecoder().decode(latest));
  const resolved = String(release.tag_name ?? "").replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+$/.test(resolved)) throw new FoundationError("Latest GitHub release has an invalid tag.");
  return resolved;
}

async function updateProject(root, requestedVersion) {
  const manifestPath = resolveInside(root, ".foundation/manifest.json");
  const current = await readJson(manifestPath);
  if (current.mode !== "consumer") throw new FoundationError("Foundation updates apply only to initialized consumer projects.");
  const modified = [];
  for (const [relativePath, expected] of Object.entries(current.managedFiles ?? {})) {
    await assertNoSymlink(root, relativePath);
    const filePath = resolveInside(root, relativePath);
    if (!(await exists(filePath)) || (await hashFile(filePath)) !== expected) modified.push(relativePath);
  }
  if (modified.length) throw new FoundationError("Managed files were modified; update aborted before download.", modified);

  const customBase = process.env.NODE_ENV === "test" ? process.env.FOUNDATION_RELEASE_BASE_URL : undefined;
  const version = await resolveUpdateVersion(requestedVersion, customBase);
  const base = customBase ?? `${OFFICIAL_UPSTREAM}/releases/download/v${version}`;
  const asset = `project-foundation-v${version}.tar.gz`;
  const archive = await download(`${base}/${asset}`);
  const checksumBytes = await download(`${base}/${asset}.sha256`, 4096);
  const expectedChecksum = new TextDecoder().decode(checksumBytes).match(/\b[a-f0-9]{64}\b/i)?.[0]?.toLowerCase();
  if (!expectedChecksum || sha256(archive) !== expectedChecksum) throw new FoundationError("Release archive checksum mismatch.");

  const archiveFiles = parseTarGz(archive);
  const sourceManifestBytes = archiveFiles.get(".foundation/manifest.json");
  if (!sourceManifestBytes) throw new FoundationError("Release archive has no manifest.");
  const sourceManifest = JSON.parse(sourceManifestBytes.toString("utf8"));
  if (sourceManifest.foundationVersion !== version) throw new FoundationError("Release manifest version mismatch.");

  for (const [relativePath, expected] of Object.entries(sourceManifest.managedFiles ?? {})) {
    const data = archiveFiles.get(normalizeRelative(relativePath));
    if (!data || sha256(data) !== expected) throw new FoundationError(`Release managed file checksum mismatch: ${relativePath}`);
  }

  const stage = await mkdtemp(path.join(tmpdir(), "project-foundation-update-"));
  try {
    await cp(root, stage, {
      recursive: true,
      filter: (source) => {
        const name = path.basename(source);
        return !IGNORED_DIRECTORIES.has(name) && name !== ".git";
      },
    });
    for (const relativePath of Object.keys(sourceManifest.managedFiles)) {
      const destination = resolveInside(stage, relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, archiveFiles.get(relativePath));
    }
    const stagedManifest = {
      ...current,
      foundationVersion: version,
      managedFiles: sourceManifest.managedFiles,
    };
    await writeJsonAtomic(resolveInside(stage, ".foundation/manifest.json"), stagedManifest);
    const stagedValidation = await validateProject(stage, { strict: false });
    if (stagedValidation.errors.length) throw new FoundationError("Updated files failed validation in staging.", stagedValidation.errors);

    const updatePaths = [...Object.keys(sourceManifest.managedFiles), ".foundation/manifest.json"];
    const snapshots = await snapshotPaths(root, updatePaths);
    try {
      for (const relativePath of Object.keys(sourceManifest.managedFiles)) {
        const destination = resolveInside(root, relativePath);
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, archiveFiles.get(relativePath));
      }
      await writeJsonAtomic(manifestPath, stagedManifest);
    } catch (error) {
      await restoreSnapshots(root, snapshots);
      throw error;
    }
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
  return version;
}

function printUsage() {
  console.log(`Project Foundation ${FOUNDATION_VERSION}

Usage:
  foundation.mjs init [--profile typescript,scss,docker] [--project-name name]
  foundation.mjs validate [--strict]
  foundation.mjs update [--version 1.0.0]
  foundation.mjs doctor
  foundation.mjs github plan [--repo owner/name]
  foundation.mjs github apply --repo DevCrop/project-foundation --confirm`);
}

async function main(argv = process.argv.slice(2), root = process.cwd()) {
  const { positional, options } = parseArguments(argv);
  const [command, subcommand] = positional;
  if (!command || command === "help" || options.has("help")) {
    printUsage();
    return;
  }
  if (command === "init") {
    const result = await initProject(path.resolve(root), { profile: options.get("profile"), projectName: options.get("project-name") });
    console.log(`Initialized ${result.name} with profiles: ${result.profiles.join(", ")}`);
    return;
  }
  if (command === "validate") {
    const result = await validateProject(path.resolve(root), { strict: options.has("strict") });
    for (const warning of result.warnings) console.warn(`WARN ${warning}`);
    if (result.errors.length) throw new FoundationError("Validation failed.", result.errors);
    console.log(`Validation passed: ${result.ruleCount} rules, ${result.sourceCount} official sources.`);
    return;
  }
  if (command === "doctor") {
    await doctor(path.resolve(root));
    return;
  }
  if (command === "update") {
    const version = await updateProject(path.resolve(root), options.get("version"));
    console.log(`Updated managed files to Project Foundation ${version}.`);
    return;
  }
  if (command === "github" && subcommand === "plan") {
    await githubPlan(options.get("repo") ?? "DevCrop/project-foundation");
    return;
  }
  if (command === "github" && subcommand === "apply") {
    await githubApply(options.get("repo") ?? "", options.has("confirm"));
    return;
  }
  throw new FoundationError(`Unknown command: ${[command, subcommand].filter(Boolean).join(" ")}`);
}

const isDirectExecution = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectExecution) {
  main().catch((error) => {
    console.error(`ERROR ${error.message}`);
    for (const detail of error.details ?? []) console.error(`- ${detail}`);
    process.exitCode = 1;
  });
}

export {
  FoundationError,
  MANAGED_PATHS,
  compareVersions,
  initProject,
  main,
  parseArguments,
  parseProfiles,
  parseTarGz,
  refreshManifest,
  resolveInside,
  updateProject,
  validateProject,
};
