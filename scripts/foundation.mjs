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
  rmdir,
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
const FOUNDATION_VERSION = "2.0.1";
const OFFICIAL_UPSTREAM = "https://github.com/DevCrop/project-foundation";
const VALID_RUNTIMES = new Set(["php"]);
const VALID_PROFILES = new Set(["core", "php", "web", "assets", "typescript", "scss", "docker", "github"]);
const CORE_MANAGED_PATHS = [
  ".agents/skills/architecture-selection/SKILL.md",
  ".agents/skills/change-workflow/SKILL.md",
  ".agents/skills/site-starter/SKILL.md",
  ".claude/skills/architecture-selection/SKILL.md",
  ".claude/skills/change-workflow/SKILL.md",
  ".claude/skills/site-starter/SKILL.md",
  ".codex/hooks.json",
  ".cursor/rules/project.mdc",
  ".editorconfig",
  ".foundation/capabilities.json",
  ".foundation/recipes/assets-experience.json",
  ".foundation/recipes/backend-data.json",
  ".foundation/recipes/integrations.json",
  ".foundation/recipes/operations-governance.json",
  ".foundation/recipes/web-core.json",
  ".foundation/scenarios.json",
  ".foundation/toolchain.json",
  ".gitattributes",
  "AGENTS.md",
  "CLAUDE.md",
  "FOUNDATION.md",
  "SECURITY.md",
  "SOURCES.json",
  "scripts/foundation.mjs",
];
const GITHUB_MANAGED_PATHS = [
  ".github/ISSUE_TEMPLATE/change.yml",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/dependabot.yml",
  ".github/workflows/dependency-review.yml",
  ".github/workflows/quality.yml",
];
const MANAGED_PATHS = [...CORE_MANAGED_PATHS, ...GITHUB_MANAGED_PATHS];
const PROFILE_PATHS = {
  github: [".github/CODEOWNERS"],
  php: [
    "composer.json",
    "composer.lock",
    "bootstrap/app.php",
    "config/pages.php",
    "public/index.php",
    "src/Web/AssetManifest.php",
    "src/Web/PageController.php",
    "src/Web/ViewRenderer.php",
    "resource/views/layouts/default.php",
    "resource/views/pages/home.php",
    "tests/Web/PageControllerTest.php",
  ],
  assets: ["package.json", "package-lock.json", "vite.config.ts"],
  typescript: ["tsconfig.json", "resource/ts/main.ts"],
  scss: [
    "resource/scss/main.scss",
    "resource/scss/abstract/_tokens.scss",
    "resource/scss/base/_document.scss",
    "resource/scss/components/_card.scss",
    "resource/scss/layouts/_section.scss",
  ],
  docker: [
    "Dockerfile",
    "compose.yaml",
    "docker/nginx/default.conf",
    "docker/php/conf.d/app.ini",
    ".dockerignore",
    ".env.example",
    "Makefile",
  ],
};
const REQUIRED_CHECKS = ["foundation-policy", "project-quality", "container", "dependency-gate"];
const BRANCH_PATTERN = /^(feature|fix|security|docs|refactor|test|chore|release)\/[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const PR_TITLE_PATTERN = /^(feat|fix|docs|refactor|test|chore|build|ci|perf|revert)(\([a-z0-9._/-]+\))?!?: .+$/;
const DEPENDABOT_LOGIN = "dependabot[bot]";
const DEPENDABOT_CHANGE_PATTERNS = [
  /^(?:package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lock|bun\.lockb|composer\.json|composer\.lock|compose\.yaml|compose\.yml)$/,
  /(^|\/)Dockerfile$/,
  /^\.github\/workflows\/[^/]+\.(?:yml|yaml)$/,
];
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
  ".php",
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
  "vendor",
  "tmp",
]);
const PREPARED_PHP_TOOLING_IMAGES = new Map();
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

function parseRuntime(value) {
  const runtime = String(value ?? "php").trim().toLowerCase();
  if (!VALID_RUNTIMES.has(runtime)) throw new FoundationError(`Unknown runtime: ${runtime}`);
  return runtime;
}

function parseProfiles(value, runtime = "php") {
  const selectedRuntime = parseRuntime(runtime);
  const requested = String(value ?? "core")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const profiles = [...new Set(["core", selectedRuntime, ...requested])];
  const invalid = profiles.filter((profile) => !VALID_PROFILES.has(profile));
  if (invalid.length) throw new FoundationError(`Unknown profiles: ${invalid.join(", ")}`);
  if (profiles.includes("typescript") || profiles.includes("scss")) profiles.push("assets");
  if (profiles.includes("assets") && !profiles.includes("web")) profiles.push("web");
  if (!profiles.includes("web")) profiles.push("web");
  return [...new Set(profiles)];
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
      trigger: field("Trigger"),
      action: field("Do"),
      forbidden: field("Don't"),
      exception: field("Exception"),
      enforcedBy: field("Enforced by")?.split(",").map((item) => item.trim()) ?? [],
      evidence: field("Evidence"),
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

function managedPathsForProfiles(profiles) {
  const selected = new Set(profiles);
  return selected.has("github") ? MANAGED_PATHS : CORE_MANAGED_PATHS;
}

function validateCommandSpecification(name, specification, errors) {
  if (specification === undefined) return;
  if (!specification || typeof specification !== "object" || Array.isArray(specification)) {
    errors.push(`project.json: commands.${name} must be an object`);
    return;
  }
  if (typeof specification.command !== "string" || !/^[A-Za-z0-9._-]+$/.test(specification.command)) {
    errors.push(`project.json: commands.${name}.command is unsafe`);
  }
  if (!Array.isArray(specification.args) || specification.args.some((item) => typeof item !== "string" || item.includes("\0"))) {
    errors.push(`project.json: commands.${name}.args must be a string array`);
  }
}

function validateProjectConfiguration(configuration, errors) {
  if (configuration.schemaVersion !== 2) errors.push("project.json: unsupported schemaVersion");
  const runtime = configuration.project?.runtime;
  if (!VALID_RUNTIMES.has(runtime)) errors.push("project.json: project.runtime must be php");
  if (typeof configuration.project?.name !== "string" || !/^[a-z0-9][a-z0-9._-]{0,213}$/.test(configuration.project.name)) {
    errors.push("project.json: project.name is invalid");
  }
  for (const [name, specification] of Object.entries(configuration.commands ?? {})) {
    validateCommandSpecification(name, specification, errors);
  }
  if (!configuration.intake || !["incomplete", "baseline-ready", "approved"].includes(configuration.intake.state)) {
    errors.push("project.json: intake.state must be incomplete, baseline-ready, or approved");
  }
  for (const key of ["observed", "inferred", "unverified"]) {
    if (!Array.isArray(configuration.intake?.[key]) || configuration.intake[key].some((item) => typeof item !== "string" || !item.trim())) {
      errors.push(`project.json: intake.${key} must be a non-empty string array`);
    }
  }
  if (configuration.pages?.source !== "config/pages.php") errors.push("project.json: pages.source must be config/pages.php");
  if (!Array.isArray(configuration.capabilities?.active)) errors.push("project.json: capabilities.active must be an array");
  if (configuration.assets?.enabled) {
    try {
      normalizeRelative(configuration.assets.manifest);
      for (const entry of configuration.assets.entries ?? []) normalizeRelative(entry);
    } catch (error) {
      errors.push(`project.json: assets path is unsafe (${error.message})`);
    }
    if (!Array.isArray(configuration.assets.entries) || configuration.assets.entries.length === 0) errors.push("project.json: enabled assets require at least one entry");
  }
  if (configuration.docker?.enabled) {
    for (const field of ["file", "service"]) {
      if (typeof configuration.docker[field] !== "string" || !configuration.docker[field]) errors.push(`project.json: docker.${field} is required`);
    }
    try {
      normalizeRelative(configuration.docker.file);
    } catch (error) {
      errors.push(`project.json: docker.file is unsafe (${error.message})`);
    }
    const port = configuration.docker.port;
    if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push("project.json: docker.port must be between 1 and 65535");
    for (const [name, target] of Object.entries(configuration.docker.targets ?? {})) {
      if (!/^[A-Za-z0-9._-]+$/.test(name) || typeof target !== "string" || !/^[A-Za-z0-9._-]+$/.test(target)) {
        errors.push(`project.json: docker target ${name} is invalid`);
      }
    }
    for (const command of ["test", "build", "start"]) {
      if (!configuration.commands?.[command]) errors.push(`project.json: Docker projects must configure commands.${command}`);
    }
  }
  if (!configuration.github || !["preserve", "public", "private"].includes(configuration.github.visibility)) {
    errors.push("project.json: github.visibility must be preserve, public, or private");
  }
  if (typeof configuration.github?.defaultBranch !== "string" || !/^[A-Za-z0-9._/-]+$/.test(configuration.github.defaultBranch)) {
    errors.push("project.json: github.defaultBranch is invalid");
  }
}

function dockerStages(dockerfile) {
  return [...dockerfile.matchAll(/^FROM\s+(?:--platform=\S+\s+)?\S+(?:\s+AS\s+([A-Za-z0-9._-]+))?\s*$/gim)]
    .map((match) => match[1]?.toLowerCase())
    .filter(Boolean);
}

function validateDockerfile(dockerfile, configuration, toolchain, errors) {
  const targets = Object.values(configuration.docker.targets ?? {}).map((value) => value.toLowerCase());
  const stages = new Set(dockerStages(dockerfile));
  for (const target of targets) if (!stages.has(target)) errors.push(`Dockerfile: missing configured target ${target}`);
  if (/^ARG\s+\w*(TOKEN|PASSWORD|SECRET|KEY)\w*/im.test(dockerfile)) errors.push("Dockerfile: secrets must not be build arguments");
  if (!/--mount=type=cache\b/.test(dockerfile)) errors.push("Dockerfile: BuildKit cache mount is required");
  const production = configuration.docker.targets?.production ?? "production";
  const productionIndex = dockerfile.search(new RegExp(`^FROM\\s+.+\\s+AS\\s+${production}\\s*$`, "im"));
  const productionBlock = productionIndex >= 0 ? dockerfile.slice(productionIndex) : "";
  if (!/^USER\s+(?!0\b|root\b)\S+/im.test(productionBlock)) errors.push("Dockerfile: production stage must use a non-root user");
  if (/^FROM\s+[^$\s]+:(?:latest|edge)(?:@|\s|$)/im.test(dockerfile)) errors.push("Dockerfile: floating base image tags are forbidden");
  const literalImages = [...dockerfile.matchAll(/^FROM\s+(?:--platform=\S+\s+)?([^$\s]+)(?:\s+AS\s+\S+)?\s*$/gim)].map((match) => match[1]);
  for (const image of literalImages) {
    if (stages.has(image.toLowerCase())) continue;
    if (!/:[^@\s]+@sha256:[a-f0-9]{64}$/i.test(image)) errors.push(`Dockerfile: base image must include a tag and digest (${image})`);
  }
  const imageArguments = new Map([...dockerfile.matchAll(/^ARG\s+([A-Za-z_][A-Za-z0-9_]*)=([^\s]+)\s*$/gm)].map((match) => [match[1], match[2]]));
  for (const match of dockerfile.matchAll(/^FROM\s+\$\{([A-Za-z_][A-Za-z0-9_]*)\}/gm)) {
    const image = imageArguments.get(match[1]);
    if (!image || !/:[^@\s]+@sha256:[a-f0-9]{64}$/i.test(image)) errors.push(`Dockerfile: ${match[1]} must pin a base image tag and digest`);
  }
  if (!/^HEALTHCHECK\s+/im.test(dockerfile)) errors.push("Dockerfile: a runtime HEALTHCHECK is required");
  if (configuration.project.runtime === "php") {
    if (!/^ARG PHP_IMAGE=[^\s:]+:[^\s@]+@sha256:[a-f0-9]{64}$/m.test(dockerfile)) {
      errors.push("Dockerfile: PHP_IMAGE must include a version tag and SHA-256 digest");
    }
    if (!dockerfile.includes(toolchain.docker.images.phpFpm)) errors.push("Dockerfile: PHP base image does not match toolchain.json");
    if (!dockerfile.includes(toolchain.docker.images.composer)) errors.push("Dockerfile: Composer image does not match toolchain.json");
    if (!dockerfile.includes("FROM php-base AS php-tooling") || !dockerfile.includes("FROM php-tooling AS php-dependencies")) {
      errors.push("Dockerfile: Composer commands must run from the pinned PHP tooling stage");
    }
    if (!dockerfile.includes(toolchain.docker.dockerfileFrontend)) errors.push("Dockerfile: frontend does not match toolchain.json");
    if (!dockerfile.includes(`ARG NPM_VERSION=${toolchain.npm.default}`)) errors.push("Dockerfile: npm version does not match toolchain.json");
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
    "ARCHITECTURE.md",
    ".foundation/manifest.json",
    ".foundation/capabilities.json",
    ".foundation/evidence.json",
    ".foundation/project.json",
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
    if (!rule.trigger) errors.push(`${rule.id}: missing Trigger`);
    if (!rule.action) errors.push(`${rule.id}: missing Do`);
    if (!rule.forbidden) errors.push(`${rule.id}: missing Don't`);
    if (!rule.body) errors.push(`${rule.id}: missing Rule body`);
    if (!rule.exception || !["yes", "no"].includes(rule.exception)) errors.push(`${rule.id}: invalid Exception`);
    if (!rule.enforcedBy.length || rule.enforcedBy.some((method) => !["validator", "hook", "ci", "github", "review"].includes(method))) {
      errors.push(`${rule.id}: invalid Enforced by`);
    }
    if (!rule.evidence) errors.push(`${rule.id}: missing Evidence`);
    if (strict && rule.level === "MUST" && rule.enforcedBy.length === 1 && rule.enforcedBy[0] === "review" && !rule.evidence?.startsWith("judgment:")) {
      errors.push(`${rule.id}: machine-checkable MUST cannot rely on review alone`);
    }
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
    ".claude/skills/change-workflow/SKILL.md",
    ".claude/skills/site-starter/SKILL.md",
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

  let projectConfiguration;
  try {
    projectConfiguration = await readJson(resolveInside(root, ".foundation/project.json"));
    validateProjectConfiguration(projectConfiguration, errors);
  } catch (error) {
    errors.push(error.message, ...(error.details ?? []));
    projectConfiguration = { project: { runtime: "php" }, commands: {}, docker: { enabled: false }, github: { visibility: "preserve" } };
  }

  let capabilityCatalog = { capabilities: [] };
  try {
    capabilityCatalog = await readJson(resolveInside(root, ".foundation/capabilities.json"));
    const capabilityIds = new Set();
    const recipeIds = new Set();
    for (const recipeFile of files.filter((entry) => entry.path.startsWith(".foundation/recipes/") && entry.path.endsWith(".json"))) {
      const recipe = await readJson(resolveInside(root, recipeFile.path));
      if (!recipe.id || recipeIds.has(recipe.id)) errors.push(`${recipeFile.path}: duplicate or missing recipe ID`);
      recipeIds.add(recipe.id);
    }
    for (const capability of capabilityCatalog.capabilities ?? []) {
      if (!capability.id || capabilityIds.has(capability.id)) errors.push(`capabilities.json: duplicate or missing capability ID ${capability.id ?? "<missing>"}`);
      capabilityIds.add(capability.id);
      if (!recipeIds.has(capability.recipe)) errors.push(`capabilities.json: ${capability.id} references unknown recipe ${capability.recipe}`);
      for (const ruleId of capability.securityRules ?? []) {
        if (!ruleIds.has(ruleId)) errors.push(`capabilities.json: ${capability.id} references unknown rule ${ruleId}`);
      }
    }
    for (const capability of capabilityCatalog.capabilities ?? []) {
      for (const relation of [...(capability.requires ?? []), ...(capability.conflicts ?? [])]) {
        if (!capabilityIds.has(relation)) errors.push(`capabilities.json: ${capability.id} references unknown capability ${relation}`);
      }
    }
    const activeCapabilities = new Set(projectConfiguration.capabilities?.active ?? []);
    for (const capabilityId of activeCapabilities) {
      const capability = (capabilityCatalog.capabilities ?? []).find((item) => item.id === capabilityId);
      if (!capability) {
        errors.push(`project.json: unknown active capability ${capabilityId}`);
        continue;
      }
      for (const requirement of capability.requires ?? []) {
        if (!activeCapabilities.has(requirement)) errors.push(`project.json: ${capabilityId} requires active capability ${requirement}`);
      }
      for (const conflict of capability.conflicts ?? []) {
        if (activeCapabilities.has(conflict)) errors.push(`project.json: ${capabilityId} conflicts with ${conflict}`);
      }
    }
  } catch (error) {
    errors.push(error.message, ...(error.details ?? []));
  }

  try {
    const scenarios = await readJson(resolveInside(root, ".foundation/scenarios.json"));
    const groups = scenarios.groups ?? [];
    const cases = groups.flatMap((group) => group.cases ?? []);
    if (scenarios.schemaVersion !== 1) errors.push("scenarios.json: unsupported schemaVersion");
    if (scenarios.expectedCount !== 120 || cases.length !== 120) errors.push(`scenarios.json: expected exactly 120 cases, found ${cases.length}`);
    if (groups.length !== 12 || groups.some((group) => !group.id || group.cases?.length !== 10)) errors.push("scenarios.json: expected 12 named groups with 10 cases each");
    const scenarioIds = new Set();
    for (const scenario of cases) {
      if (!/^PF-SC-\d{3}$/.test(scenario.id ?? "") || scenarioIds.has(scenario.id)) errors.push(`scenarios.json: duplicate or invalid case ID ${scenario.id ?? "<missing>"}`);
      scenarioIds.add(scenario.id);
      if (!scenario.title || !scenario.probe?.type) errors.push(`scenarios.json: ${scenario.id} is missing title or executable probe`);
      if (!Array.isArray(scenario.ruleIds) || !scenario.ruleIds.length) errors.push(`scenarios.json: ${scenario.id} has no rule references`);
      for (const ruleId of scenario.ruleIds ?? []) if (!ruleIds.has(ruleId)) errors.push(`scenarios.json: ${scenario.id} references unknown rule ${ruleId}`);
    }
    for (let index = 1; index <= 120; index += 1) {
      const expectedId = `PF-SC-${String(index).padStart(3, "0")}`;
      if (!scenarioIds.has(expectedId)) errors.push(`scenarios.json: missing canonical case ${expectedId}`);
    }
  } catch (error) {
    errors.push(error.message, ...(error.details ?? []));
  }

  if (projectConfiguration.intake?.state === "approved" && projectConfiguration.intake.unverified?.length) {
    errors.push("project.json: approved intake cannot retain Unverified items");
  }

  const lockfiles = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb"].filter((name) =>
    files.some((entry) => entry.path === name),
  );
  if (lockfiles.length > 1) errors.push(`Multiple package-manager lockfiles: ${lockfiles.join(", ")}`);
  if (lockfiles.includes("package-lock.json")) {
    if (!(await exists(resolveInside(root, "package.json")))) errors.push("package-lock.json requires package.json");
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

  const composerPath = resolveInside(root, "composer.json");
  const composerLockPath = resolveInside(root, "composer.lock");
  if (await exists(composerPath)) {
    if (!(await exists(composerLockPath))) errors.push("composer.json requires committed composer.lock");
    const composer = await readJson(composerPath);
    if (composer.require?.php !== ">=8.2.33 <8.3") errors.push("composer.json: PHP constraint must match the supported Foundation range");
    if (composer.config?.platform?.php !== "8.2.33") errors.push("composer.json: config.platform.php must pin the Foundation PHP version");
    for (const dependency of ["symfony/http-foundation", "symfony/routing"]) {
      if (!composer.require?.[dependency]) errors.push(`composer.json: missing required HTTP boundary dependency ${dependency}`);
    }
    if (await exists(composerLockPath)) {
      const composerLock = await readJson(composerLockPath);
      if (!/^[a-f0-9]{32}$/.test(composerLock["content-hash"] ?? "")) errors.push("composer.lock: invalid content-hash");
      const lockedPackages = new Set([...(composerLock.packages ?? []), ...(composerLock["packages-dev"] ?? [])].map((item) => item.name));
      for (const dependency of [...Object.keys(composer.require ?? {}).filter((name) => name !== "php"), ...Object.keys(composer["require-dev"] ?? {})]) {
        if (!lockedPackages.has(dependency)) errors.push(`composer.lock: missing direct dependency ${dependency}`);
      }
    }
  }

  let manifest;
  try {
    manifest = await readJson(resolveInside(root, ".foundation/manifest.json"));
  } catch (error) {
    errors.push(error.message, ...error.details);
    manifest = { managedFiles: {}, activeProfiles: [] };
  }
  if (manifest.schemaVersion !== 3) errors.push("manifest.json: unsupported schemaVersion");
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
  const expectedManaged = manifest.mode === "upstream" ? MANAGED_PATHS : managedPathsForProfiles(manifest.activeProfiles ?? []);
  for (const relativePath of expectedManaged) {
    if (!Object.hasOwn(manifest.managedFiles ?? {}, relativePath)) errors.push(`Manifest is missing managed file: ${relativePath}`);
  }
  for (const relativePath of Object.keys(manifest.managedFiles ?? {})) {
    if (!expectedManaged.includes(relativePath)) errors.push(`Manifest has out-of-scope managed file: ${relativePath}`);
  }

  const toolchain = await readJson(resolveInside(root, ".foundation/toolchain.json"));
  let packageJson;
  if (projectConfiguration.assets?.enabled || manifest.mode === "upstream") {
    if (!(await exists(resolveInside(root, "package.json")))) errors.push("Assets profile is missing package.json");
    if (!(await exists(resolveInside(root, "package-lock.json")))) errors.push("Assets profile is missing package-lock.json");
    if (await exists(resolveInside(root, "package.json"))) {
      packageJson = await readJson(resolveInside(root, "package.json"));
      if (packageJson.engines?.node !== toolchain.node.range) errors.push("package.json: engines.node does not match toolchain.json");
      if (packageJson.packageManager !== `npm@${toolchain.npm.default}`) errors.push("package.json: packageManager does not match toolchain.json");
      const supportedNodeMajors = (toolchain.node.supported ?? []).map((version) => parseVersion(version)?.[0]).filter(Number.isInteger);
      const minimumNodeMajor = supportedNodeMajors.length ? Math.min(...supportedNodeMajors) : null;
      if (!Number.isInteger(toolchain.node.typeDefinitionsMajor) || toolchain.node.typeDefinitionsMajor !== minimumNodeMajor) {
        errors.push("toolchain.json: node.typeDefinitionsMajor must match the minimum supported Node major");
      }
      if (manifest.mode === "upstream" || (manifest.activeProfiles ?? []).includes("typescript")) {
        const nodeTypes = packageJson.devDependencies?.["@types/node"];
        const nodeTypesVersion = parseVersion(nodeTypes);
        if (!/^\d+\.\d+\.\d+$/.test(nodeTypes ?? "") || nodeTypesVersion?.[0] !== toolchain.node.typeDefinitionsMajor) {
          errors.push("package.json: @types/node must be exact and match toolchain.json node.typeDefinitionsMajor");
        }
      }
      if (packageJson.devDependencies?.sass) {
        const packageLock = await readJson(resolveInside(root, "package-lock.json"));
        const watcherVersion = packageLock.packages?.["node_modules/@parcel/watcher"]?.version;
        if (!watcherVersion || packageJson.allowScripts?.[`@parcel/watcher@${watcherVersion}`] !== true) {
          errors.push("package.json: Sass install-script dependency approval is missing or not version-pinned");
        }
      }
      if (manifest.mode === "upstream" && packageJson.version !== manifest.foundationVersion) {
        errors.push("Foundation version mismatch between package.json and manifest");
      }
      if (strict && manifest.mode === "upstream") {
        const changelog = await readFile(resolveInside(root, "CHANGELOG.md"), "utf8");
        if (!changelog.includes(`## ${packageJson.version} -`)) errors.push(`CHANGELOG.md: missing ${packageJson.version} release entry`);
      }
    }
  }

  const activeProfiles = new Set(manifest.activeProfiles ?? []);
  if (!activeProfiles.has("core")) errors.push("manifest: core profile is required");
  if (!activeProfiles.has(projectConfiguration.project.runtime)) errors.push("manifest: runtime profile does not match project.json");
  if (!activeProfiles.has("web")) errors.push("manifest: web profile is required for PHP sites");
  if (projectConfiguration.assets?.enabled !== activeProfiles.has("assets")) errors.push("manifest: assets profile does not match project.json");
  if (projectConfiguration.docker.enabled !== activeProfiles.has("docker")) errors.push("manifest: docker profile does not match project.json");
  for (const profile of ["github", "php", "assets", "typescript", "scss"]) {
    if (!activeProfiles.has(profile)) continue;
    for (const relativePath of PROFILE_PATHS[profile] ?? []) {
      if (!(await exists(resolveInside(root, relativePath)))) errors.push(`${profile} profile is missing ${relativePath}`);
    }
  }
  if (activeProfiles.has("typescript") && await exists(resolveInside(root, "tsconfig.json"))) {
    const tsconfig = await readJson(resolveInside(root, "tsconfig.json"));
    if (tsconfig.compilerOptions?.strict !== true || tsconfig.compilerOptions?.noImplicitAny === false) errors.push("tsconfig.json: strict TypeScript is required");
    for (const entry of files.filter((item) => !item.symlink && item.path.endsWith(".ts"))) {
      const source = await readFile(resolveInside(root, entry.path), "utf8");
      if (/:\s*any\b|\bas\s+any\b|<any>|\bany\s*\[\s*\]/.test(source)) errors.push(`${entry.path}: explicit any requires a documented project exception`);
    }
  }
  if (activeProfiles.has("scss")) {
    const scssEntries = files.filter((item) => !item.symlink && item.path.startsWith("resource/scss/") && item.path.endsWith(".scss") && !path.posix.basename(item.path).startsWith("_"));
    for (const entry of scssEntries) {
      if (entry.path !== "resource/scss/main.scss" && !/^resource\/scss\/pages\/[a-z0-9][a-z0-9-]*\.scss$/.test(entry.path)) {
        errors.push(`${entry.path}: SCSS entry must be main.scss or an approved page entry`);
      }
    }
    for (const entry of files.filter((item) => !item.symlink && item.path.endsWith(".scss"))) {
      const source = await readFile(resolveInside(root, entry.path), "utf8");
      if (/^\s*@import\b/m.test(source)) errors.push(`${entry.path}: legacy Sass @import is forbidden; use @use or @forward`);
    }
    const mainScssPath = resolveInside(root, "resource/scss/main.scss");
    if (await exists(mainScssPath)) {
      const mainScss = await readFile(mainScssPath, "utf8");
      const implementation = mainScss
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("//") && !/^@use\s+.+;$/.test(line));
      if (implementation.length) errors.push("resource/scss/main.scss: main may only compose modules with @use");
    }
  }
  if (activeProfiles.has("web")) {
    for (const entry of files.filter((item) => !item.symlink && /^resource\/views\/pages\/.+\.php$/.test(item.path))) {
      const source = await readFile(resolveInside(root, entry.path), "utf8");
      for (const requiredClass of ["section", "container", "inner", "section-contents"]) {
        if (!new RegExp(`class=["'][^"']*\\b${requiredClass}\\b`).test(source)) errors.push(`${entry.path}: canonical HTML shell is missing .${requiredClass}`);
      }
    }
  }
  if (activeProfiles.has("docker")) {
    for (const relativePath of PROFILE_PATHS.docker) {
      if (relativePath === "Dockerfile") continue;
      if (!(await exists(resolveInside(root, relativePath)))) errors.push(`Docker profile is missing ${relativePath}`);
    }
    let dockerRelativePath = "Dockerfile";
    try {
      dockerRelativePath = normalizeRelative(projectConfiguration.docker.file);
      await assertNoSymlink(root, dockerRelativePath);
      if (!(await exists(resolveInside(root, dockerRelativePath)))) errors.push(`Docker profile is missing ${dockerRelativePath}`);
    } catch (error) {
      errors.push(error.message);
    }
    if (await exists(resolveInside(root, "compose.yml"))) errors.push("compose.yml conflicts with the canonical compose.yaml");
    if (await exists(resolveInside(root, "compose.yaml"))) {
      const compose = await readFile(resolveInside(root, "compose.yaml"), "utf8");
      if (/^version\s*:/m.test(compose)) errors.push("compose.yaml: obsolete top-level version is not allowed");
      for (const pattern of [/privileged\s*:\s*true/i, /network_mode\s*:\s*host/i, /docker\.sock/i]) {
        if (pattern.test(compose)) errors.push(`compose.yaml: forbidden high-risk setting ${pattern}`);
      }
      for (const pattern of [/read_only\s*:\s*true/i, /tmpfs\s*:/i, /cap_drop\s*:[\s\S]*?-\s*ALL/i, /no-new-privileges:true/i]) {
        if (!pattern.test(compose)) errors.push(`compose.yaml: missing production-safe setting ${pattern}`);
      }
      if (/target:\s*\/app\/node_modules/i.test(compose) || /path:\s*\.\/node_modules/i.test(compose)) errors.push("compose.yaml: host node_modules must not be synchronized");
    }
    if (await exists(resolveInside(root, dockerRelativePath))) {
      const dockerfile = await readFile(resolveInside(root, dockerRelativePath), "utf8");
      validateDockerfile(dockerfile, projectConfiguration, toolchain, errors);
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
    for (const image of [toolchain.docker.images.phpFpm]) {
      if (!quality.includes(`"${image}"`)) errors.push(`quality.yml: missing supported PHP image ${image}`);
    }
    const workflowPhpVersions = [...quality.matchAll(/^\s+- php:\s+"([^"]+)"\s*$/gm)].map((match) => match[1]);
    if (JSON.stringify(workflowPhpVersions) !== JSON.stringify(toolchain.php.supported)) {
      errors.push("quality.yml: PHP compatibility matrix must exactly match toolchain.json");
    }
    if (!/^  php-compatibility:/m.test(quality)) errors.push("quality.yml: missing PHP compatibility matrix");
    for (const check of REQUIRED_CHECKS.filter((name) => name !== "dependency-gate")) {
      if (!new RegExp(`^  ${check}:`, "m").test(quality) || !quality.includes(`name: ${check}`)) errors.push(`quality.yml: missing stable check ${check}`);
    }
  }
  const dependencyPath = resolveInside(root, ".github/workflows/dependency-review.yml");
  if (await exists(dependencyPath)) {
    const dependency = await readFile(dependencyPath, "utf8");
    if (!/^  dependency-gate:/m.test(dependency) || !dependency.includes("name: dependency-gate")) errors.push("dependency-review.yml: missing stable check dependency-gate");
  }
  const releasePath = resolveInside(root, ".github/workflows/release.yml");
  if (await exists(releasePath)) {
    const release = await readFile(releasePath, "utf8");
    const createIndex = release.indexOf("gh release create");
    const uploadIndex = release.indexOf("gh release upload");
    const publishIndex = release.indexOf("gh release edit");
    const createCommand = createIndex >= 0 && uploadIndex > createIndex ? release.slice(createIndex, uploadIndex) : "";
    const publishCommand = publishIndex >= 0 ? release.slice(publishIndex) : "";
    if (createIndex < 0 || !/(?:^|\s)--draft(?=\s|\\|$)/m.test(createCommand)) errors.push("release.yml: release must be created as a draft before assets are uploaded");
    if (uploadIndex < 0 || uploadIndex <= createIndex) errors.push("release.yml: release assets must be uploaded after draft creation");
    if (publishIndex < 0 || publishIndex <= uploadIndex || !/(?:^|\s)--draft=false(?=\s|\\|$)/m.test(publishCommand)) errors.push("release.yml: release must be published only after asset upload");
    if (!/git archive[^\n]*HEAD\^\{tree\}/.test(release)) errors.push("release.yml: release archive must use the tree object to preserve updater compatibility");
  }

  const agentIndexes = files.filter((entry) => !entry.symlink && path.posix.basename(entry.path) === "AGENTS.md");
  let aggregateAgentBytes = 0;
  for (const entry of agentIndexes) aggregateAgentBytes += (await readFile(resolveInside(root, entry.path))).byteLength;
  if (aggregateAgentBytes >= 32 * 1024) errors.push("AGENTS.md hierarchy: aggregate instructions must remain below the 32 KiB Codex default");
  const claude = await readFile(resolveInside(root, "CLAUDE.md"), "utf8");
  for (const reference of ["@AGENTS.md", "@FOUNDATION.md", "@PROJECT.md"]) if (!claude.includes(reference)) errors.push(`CLAUDE.md: missing import ${reference}`);
  const cursorPath = resolveInside(root, ".cursor/rules/project.mdc");
  if (await exists(cursorPath)) {
    const cursor = await readFile(cursorPath, "utf8");
    for (const reference of ["@FOUNDATION.md", "@PROJECT.md"]) if (!cursor.includes(reference)) errors.push(`project.mdc: missing reference ${reference}`);
  }
  const hooksPath = resolveInside(root, ".codex/hooks.json");
  if (await exists(hooksPath)) {
    const hooks = await readJson(hooksPath);
    for (const event of ["SessionStart", "PreToolUse", "Stop"]) {
      const handlers = hooks.hooks?.[event]?.flatMap((group) => group.hooks ?? []) ?? [];
      if (!handlers.length) errors.push(`hooks.json: missing ${event}`);
      for (const handler of handlers) {
        if (handler.type !== "command" || !handler.command || !handler.commandWindows) errors.push(`hooks.json: ${event} requires Unix and Windows command handlers`);
      }
    }
  }

  if (await exists(resolveInside(root, "ARCHITECTURE.md"))) {
    try {
      const expectedArchitecture = await architectureDocument(root);
      const actualArchitecture = await readFile(resolveInside(root, "ARCHITECTURE.md"), "utf8");
      if (actualArchitecture !== expectedArchitecture) errors.push("ARCHITECTURE.md is stale or manually edited; regenerate it with a Foundation command");
    } catch (error) {
      errors.push(`ARCHITECTURE.md: ${error.message}`);
    }
  }
  const evidenceAudit = await auditEvidence(root);
  errors.push(...evidenceAudit.errors);

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

function projectDocument(projectName, runtime, profiles) {
  return `# ${projectName} Project Rules

## Identity

- Project: ${projectName}
- Foundation version: ${FOUNDATION_VERSION}
- Runtime adapter: ${runtime}
- Active profiles: ${profiles.join(", ")}
- Owner: project owner

## Project Intake

- Observed: PHP renders the site through the checked-in HTTP entry point.
- Inferred: none
- Unverified: page map, integrations, deployment target, content source, browser support, accessibility target, performance budgets

Before project-specific structure is added, replace Unverified items with evidence or keep them explicitly unresolved.

## Commands

Executable commands are owned by \`.foundation/project.json\`. Record command intent, exceptions, and operational notes here.

## Architecture

The approved baseline is minimal PHP MVC at the HTTP presentation boundary: Symfony Request, Response, and Routing; one common PageController; pure PHP Views; and feature folders only after a capability is approved. Use the architecture-selection Skill before changing this boundary.

## Type Ownership

Record the module that owns each shared domain type. Do not create a global catch-all type file.

## Styling

The only global entry is \`resource/scss/main.scss\`. Search existing tokens, variables, functions, and Mixins before adding new SCSS assets. Add a page entry only when that page has independently loadable styling.

## Docker

Docker settings are owned by \`.foundation/project.json\`. Record project-only ports, volumes, deployment constraints, and measured budgets here.

## Performance Budgets

- Production image size: not measured
- Cold build time: not measured
- Cached build time: not measured
- Container readiness time: not measured

## Exceptions

No active Foundation exceptions.
`;
}

function consumerReadme(projectName, runtime, profiles) {
  return `# ${projectName}

This PHP site uses Project Foundation ${FOUNDATION_VERSION} and these profiles: ${profiles.join(", ")}.

## Setup

\`\`\`text
node scripts/foundation.mjs doctor
node scripts/foundation.mjs validate --strict
node scripts/foundation.mjs verify --base origin/main
\`\`\`

Add a page with \`node scripts/foundation.mjs page add <slug> --path /path\`. Plan an optional feature with \`node scripts/foundation.mjs capability plan <id>\` before applying it.

Project-specific decisions belong in [PROJECT.md](PROJECT.md). Machine settings belong in [project.json](.foundation/project.json). Shared rules are indexed in [FOUNDATION.md](FOUNDATION.md).
`;
}

function projectConfiguration(projectName, runtime, profiles) {
  const assetsEnabled = profiles.includes("assets");
  const entries = [];
  if (profiles.includes("typescript")) entries.push("resource/ts/main.ts");
  if (profiles.includes("scss")) entries.push("resource/scss/main.scss");
  const commands = {
    install: { command: "composer", args: ["install", "--no-interaction"] },
    lint: { command: "composer", args: ["lint"] },
    typecheck: { command: "composer", args: ["analyse"] },
    test: { command: "composer", args: ["test"] },
    build: assetsEnabled
      ? { command: "npm", args: ["run", "build"] }
      : { command: "composer", args: ["dump-autoload", "--classmap-authoritative", "--no-interaction"] },
    start: { command: "php", args: ["-S", "127.0.0.1:8080", "-t", "public"] },
    dependencyValidate: { command: "composer", args: ["validate", "--strict", "--no-check-publish"] },
    dependencyAudit: { command: "composer", args: ["audit", "--locked"] },
  };
  if (assetsEnabled) {
    commands.assetsInstall = { command: "npm", args: ["ci"] };
    commands.assetAudit = { command: "npm", args: ["audit", "--audit-level=moderate"] };
  }
  return {
    schemaVersion: 2,
    project: { name: projectName, runtime },
    intake: {
      state: "incomplete",
      observed: ["PHP HTTP entry point is present"],
      inferred: [],
      unverified: ["page map", "integrations", "deployment target", "performance budgets"],
    },
    commands,
    pages: { source: "config/pages.php" },
    capabilities: { active: ["publishing", "seo"] },
    assets: {
      enabled: assetsEnabled,
      manifest: "public/build/.vite/manifest.json",
      entries,
    },
    docker: {
      enabled: profiles.includes("docker"),
      file: "Dockerfile",
      service: "php",
      port: 8080,
      targets: { development: "php-development", test: "php-test", production: "php-production", web: "nginx-production" },
    },
    github: { visibility: "preserve", defaultBranch: "main" },
    budgets: {
      productionImageBytes: null,
      coldBuildMs: null,
      cachedBuildMs: null,
      readinessMs: null,
      frontend: {},
    },
  };
}

async function snapshotPaths(root, relativePaths) {
  const snapshots = new Map();
  snapshots.initialDirectories = new Set();
  for (const relativePath of relativePaths) {
    let parent = path.posix.dirname(normalizeRelative(relativePath));
    while (parent !== ".") {
      if (await exists(resolveInside(root, parent))) snapshots.initialDirectories.add(parent);
      parent = path.posix.dirname(parent);
    }
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
  const candidateDirectories = new Set();
  for (const [relativePath, data] of snapshots) {
    if (data !== undefined) continue;
    let parent = path.posix.dirname(normalizeRelative(relativePath));
    while (parent !== ".") {
      if (!snapshots.initialDirectories.has(parent)) candidateDirectories.add(parent);
      parent = path.posix.dirname(parent);
    }
  }
  for (const relativePath of [...candidateDirectories].sort((left, right) => right.split("/").length - left.split("/").length)) {
    try {
      await rmdir(resolveInside(root, relativePath));
    } catch (error) {
      if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code)) throw error;
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

async function createAssetFiles(root, name, profiles) {
  const packageJson = await readJson(resolveInside(SCRIPT_ROOT, "package.json"));
  packageJson.name = name;
  packageJson.version = "0.1.0";
  packageJson.private = true;
  packageJson.description = "Vite asset pipeline for a Project Foundation PHP site";
  packageJson.scripts = {
    build: "vite build",
    dev: "vite",
  };
  if (profiles.includes("typescript")) packageJson.scripts.typecheck = "tsc -p tsconfig.json --noEmit";
  if (profiles.includes("scss")) packageJson.scripts["styles:build"] = "vite build";
  if (!profiles.includes("typescript")) {
    delete packageJson.devDependencies["@types/node"];
    delete packageJson.devDependencies.typescript;
    delete packageJson.scripts.typecheck;
  }
  if (!profiles.includes("scss")) {
    delete packageJson.devDependencies.sass;
    delete packageJson.scripts["styles:build"];
  }
  if (!packageJson.devDependencies.sass) delete packageJson.allowScripts;
  await writeJsonAtomic(resolveInside(root, "package.json"), packageJson);

  const lock = await readJson(resolveInside(SCRIPT_ROOT, "package-lock.json"));
  lock.name = name;
  lock.version = "0.1.0";
  lock.packages[""].name = name;
  lock.packages[""].version = "0.1.0";
  lock.packages[""].devDependencies = packageJson.devDependencies;
  await writeJsonAtomic(resolveInside(root, "package-lock.json"), lock);
}

async function writeCodeowners(root, owner) {
  const normalized = String(owner ?? "").trim().replace(/^@/, "");
  if (!/^[A-Za-z0-9-]{1,39}$/.test(normalized)) throw new FoundationError("The github profile requires --owner with a GitHub login.");
  await mkdir(resolveInside(root, ".github"), { recursive: true });
  await writeFile(resolveInside(root, ".github/CODEOWNERS"), `* @${normalized}\n`, "utf8");
}

async function initProject(root, { profile, projectName, runtime, owner }) {
  const selectedRuntime = parseRuntime(runtime);
  const profiles = parseProfiles(profile, selectedRuntime);
  const name = String(projectName ?? path.basename(root)).trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,213}$/.test(name)) throw new FoundationError(`Invalid project name: ${name}`);

  const manifestPath = resolveInside(root, ".foundation/manifest.json");
  const currentManifest = (await exists(manifestPath)) ? await readJson(manifestPath) : null;
  const inPlaceTemplate = path.resolve(root) === SCRIPT_ROOT && currentManifest?.mode === "upstream";
  if (currentManifest?.mode === "consumer") throw new FoundationError("This project is already initialized.");

  const sourceManifest = await readJson(resolveInside(SCRIPT_ROOT, ".foundation/manifest.json"));
  const selectedSeeds = sourceManifest.seedFiles.filter((item) => seedSelected(item, profiles));
  const selectedManaged = managedPathsForProfiles(profiles);
  const destinationPaths = [
    ...selectedManaged,
    ...selectedSeeds,
    ".foundation/manifest.json",
    ".foundation/project.json",
    "PROJECT.md",
    "README.md",
  ];
  const changingPaths = [...new Set([...destinationPaths, ...sourceManifest.upstreamOnlyFiles, ...Object.values(PROFILE_PATHS).flat()])];
  const snapshots = await snapshotPaths(root, changingPaths);

  try {
    if (!inPlaceTemplate) {
      const existing = await walk(root);
      const conflicts = existing.filter((entry) => entry.path !== ".git" && !entry.path.startsWith(".git/")).map((entry) => entry.path);
      if (conflicts.length) throw new FoundationError("init requires an empty project; use adopt for an existing project.", conflicts);
      for (const relativePath of selectedManaged) await copyFoundationFile(SCRIPT_ROOT, root, relativePath);
      for (const relativePath of selectedSeeds) {
        if (["README.md", "PROJECT.md", ".foundation/project.json", "package.json", "package-lock.json", ".github/CODEOWNERS"].includes(relativePath)) continue;
        await copyFoundationFile(SCRIPT_ROOT, root, relativePath);
      }
    }

    if (profiles.includes("assets")) await createAssetFiles(root, name, profiles);
    await writeJsonAtomic(resolveInside(root, ".foundation/project.json"), projectConfiguration(name, selectedRuntime, profiles));
    await writeFile(resolveInside(root, "README.md"), consumerReadme(name, selectedRuntime, profiles), "utf8");
    await writeFile(resolveInside(root, "PROJECT.md"), projectDocument(name, selectedRuntime, profiles), "utf8");
    if (profiles.includes("github")) await writeCodeowners(root, owner);
    if (profiles.includes("docker")) {
      const composePath = resolveInside(root, "compose.yaml");
      const compose = await readFile(composePath, "utf8");
      await writeFile(composePath, compose.replaceAll("project-foundation", name), "utf8");
      await writeFile(resolveInside(root, ".env.example"), `COMPOSE_PROJECT_NAME=${name}\nAPP_ENV=development\nPORT=8080\nVITE_DEV_SERVER=\n`, "utf8");
    }

    for (const [profileName, profilePaths] of Object.entries(PROFILE_PATHS)) {
      if (profiles.includes(profileName)) continue;
      for (const relativePath of profilePaths) await rm(resolveInside(root, relativePath), { force: true, recursive: true });
    }
    for (const relativePath of MANAGED_PATHS) {
      if (!selectedManaged.includes(relativePath)) await rm(resolveInside(root, relativePath), { force: true, recursive: true });
    }
    for (const relativePath of sourceManifest.upstreamOnlyFiles) await rm(resolveInside(root, relativePath), { force: true, recursive: true });

    const managedFiles = {};
    for (const relativePath of selectedManaged) managedFiles[relativePath] = await hashFile(resolveInside(root, relativePath));
    const consumerManifest = {
      schemaVersion: 3,
      foundationVersion: FOUNDATION_VERSION,
      mode: "consumer",
      activeProfiles: profiles,
      upstream: OFFICIAL_UPSTREAM,
      managedFiles,
      seedFiles: selectedSeeds,
      upstreamOnlyFiles: sourceManifest.upstreamOnlyFiles,
    };
    await writeJsonAtomic(manifestPath, consumerManifest);
    await writeArchitectureDocument(root);

    const validation = await validateProject(root, { strict: false });
    if (validation.errors.length) throw new FoundationError("Initialized project did not validate.", validation.errors);
    return { name, runtime: selectedRuntime, profiles };
  } catch (error) {
    await restoreSnapshots(root, snapshots);
    throw error;
  }
}

async function treeFingerprint(root) {
  const entries = await walk(root);
  const records = [];
  for (const entry of entries) {
    if (entry.symlink) records.push([entry.path, "symlink"]);
    else records.push([entry.path, await hashFile(resolveInside(root, entry.path))]);
  }
  return sha256(JSON.stringify(records));
}

function adoptionCachePath(root) {
  return path.join(tmpdir(), `project-foundation-adopt-${sha256(path.resolve(root)).slice(0, 24)}.json`);
}

async function adoptPlan(root, { profile, projectName, runtime, owner }) {
  const selectedRuntime = parseRuntime(runtime ?? "php");
  const profiles = parseProfiles(profile, selectedRuntime);
  const name = String(projectName ?? path.basename(root)).trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,213}$/.test(name)) throw new FoundationError(`Invalid project name: ${name}`);
  if (await exists(resolveInside(root, ".foundation/manifest.json"))) throw new FoundationError("This project already has a Foundation manifest.");

  const selectedManaged = managedPathsForProfiles(profiles);
  const sourceManifest = await readJson(resolveInside(SCRIPT_ROOT, ".foundation/manifest.json"));
  const selectedSeeds = sourceManifest.seedFiles.filter((item) => seedSelected(item, profiles));
  const creates = [];
  const conflicts = [];
  for (const relativePath of selectedManaged) {
    const destination = resolveInside(root, relativePath);
    if (!(await exists(destination))) creates.push({ path: relativePath, kind: "managed" });
    else if ((await lstat(destination)).isSymbolicLink() || (await hashFile(destination)) !== (await hashFile(resolveInside(SCRIPT_ROOT, relativePath)))) conflicts.push(relativePath);
  }
  for (const [relativePath, kind] of [["README.md", "readme"], ["PROJECT.md", "project"]]) {
    if (!(await exists(resolveInside(root, relativePath)))) creates.push({ path: relativePath, kind });
  }
  const generatedSeeds = new Set(["README.md", "PROJECT.md", ".foundation/project.json", ".github/CODEOWNERS", "package.json", "package-lock.json"]);
  for (const relativePath of selectedSeeds) {
    if (generatedSeeds.has(relativePath)) continue;
    if (!(await exists(resolveInside(root, relativePath)))) creates.push({ path: relativePath, kind: "seed" });
    else if (relativePath === "ARCHITECTURE.md") conflicts.push("ARCHITECTURE.md already exists and would conflict with the generated Foundation architecture index");
  }
  const configurationPath = resolveInside(root, ".foundation/project.json");
  let existingConfiguration;
  if (!(await exists(configurationPath))) {
    creates.push({ path: ".foundation/project.json", kind: "configuration" });
  } else {
    const configurationErrors = [];
    existingConfiguration = await readJson(configurationPath);
    validateProjectConfiguration(existingConfiguration, configurationErrors);
    if (existingConfiguration.project?.runtime !== selectedRuntime) configurationErrors.push("project.json runtime does not match --runtime");
    if (existingConfiguration.docker?.enabled !== profiles.includes("docker")) configurationErrors.push("project.json docker.enabled does not match --profile");
    conflicts.push(...configurationErrors.map((item) => `.foundation/project.json: ${item}`));
  }
  if (profiles.includes("github") && !(await exists(resolveInside(root, ".github/CODEOWNERS")))) {
    const normalizedOwner = String(owner ?? "").trim().replace(/^@/, "");
    if (!/^[A-Za-z0-9-]{1,39}$/.test(normalizedOwner)) conflicts.push(".github/CODEOWNERS requires --owner");
    else creates.push({ path: ".github/CODEOWNERS", kind: "codeowners", owner: normalizedOwner });
  }
  if (profiles.includes("assets")) {
    const hasPackage = await exists(resolveInside(root, "package.json"));
    const hasLock = await exists(resolveInside(root, "package-lock.json"));
    if (!hasPackage && !hasLock) creates.push({ path: "package.json", kind: "asset-package" });
    else if (hasPackage !== hasLock) conflicts.push("package.json and package-lock.json must be adopted together");
  }

  const stateSha = await treeFingerprint(root);
  const plan = { schemaVersion: 1, root: path.resolve(root), stateSha, name, runtime: selectedRuntime, profiles, creates, conflicts };
  const planSha = sha256(JSON.stringify(plan));
  await writeJsonAtomic(adoptionCachePath(root), { ...plan, planSha });
  const output = { planSha, runtime: selectedRuntime, profiles, creates: creates.map((item) => item.path), conflicts };
  console.log(JSON.stringify(output, null, 2));
  return { ...plan, planSha };
}

async function adoptApply(root, planSha, confirmed) {
  if (!/^[a-f0-9]{64}$/.test(String(planSha ?? ""))) throw new FoundationError("adopt apply requires --plan-sha with a SHA-256 value.");
  if (!confirmed) throw new FoundationError("adopt apply requires --confirm.");
  const cachePath = adoptionCachePath(root);
  if (!(await exists(cachePath))) throw new FoundationError("No adoption plan is available; run adopt plan again.");
  const plan = await readJson(cachePath);
  if (plan.planSha !== planSha || plan.root !== path.resolve(root)) throw new FoundationError("Adoption plan SHA or project root does not match.");
  if ((await treeFingerprint(root)) !== plan.stateSha) throw new FoundationError("Project state changed after adopt plan; run adopt plan again.");
  if (plan.conflicts.length) throw new FoundationError("Adoption conflicts must be resolved before apply.", plan.conflicts);

  const changePaths = [
    ...plan.creates.map((item) => item.path),
    ...(plan.creates.some((item) => item.kind === "asset-package") ? ["package-lock.json"] : []),
    ".foundation/manifest.json",
  ];
  const snapshots = await snapshotPaths(root, changePaths);
  try {
    for (const item of plan.creates) {
      if (item.kind === "managed" || item.kind === "seed") await copyFoundationFile(SCRIPT_ROOT, root, item.path);
      else if (item.kind === "asset-package") await createAssetFiles(root, plan.name, plan.profiles);
      else if (item.kind === "readme") await writeFile(resolveInside(root, item.path), consumerReadme(plan.name, plan.runtime, plan.profiles), "utf8");
      else if (item.kind === "project") await writeFile(resolveInside(root, item.path), projectDocument(plan.name, plan.runtime, plan.profiles), "utf8");
      else if (item.kind === "configuration") await writeJsonAtomic(resolveInside(root, item.path), projectConfiguration(plan.name, plan.runtime, plan.profiles));
      else if (item.kind === "codeowners") await writeFile(resolveInside(root, item.path), `* @${item.owner}\n`, "utf8");
    }
    const configurationPath = resolveInside(root, ".foundation/project.json");
    if (!(await exists(configurationPath))) throw new FoundationError("Existing adoption requires .foundation/project.json.");
    const configuration = await readJson(configurationPath);
    if (configuration.project?.runtime !== plan.runtime) throw new FoundationError("Existing project.json runtime does not match the adoption plan.");

    const selectedManaged = managedPathsForProfiles(plan.profiles);
    const managedFiles = {};
    for (const relativePath of selectedManaged) managedFiles[relativePath] = await hashFile(resolveInside(root, relativePath));
    const sourceManifest = await readJson(resolveInside(SCRIPT_ROOT, ".foundation/manifest.json"));
    await writeJsonAtomic(resolveInside(root, ".foundation/manifest.json"), {
      schemaVersion: 3,
      foundationVersion: FOUNDATION_VERSION,
      mode: "consumer",
      activeProfiles: plan.profiles,
      upstream: OFFICIAL_UPSTREAM,
      managedFiles,
      seedFiles: plan.creates.filter((item) => item.kind !== "managed").map((item) => item.path),
      upstreamOnlyFiles: sourceManifest.upstreamOnlyFiles,
    });
    await writeArchitectureDocument(root);
    const validation = await validateProject(root, { strict: false });
    if (validation.errors.length) throw new FoundationError("Adopted project did not validate.", validation.errors);
  } catch (error) {
    await restoreSnapshots(root, snapshots);
    throw error;
  }
  await rm(cachePath, { force: true });
  return plan;
}

function phpSingleQuoted(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

function validatePageInput(slug, routePath, title) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(slug ?? ""))) throw new FoundationError("Page slug must be lowercase kebab-case.");
  if (typeof routePath !== "string" || !/^\/(?:[a-z0-9][a-z0-9\-/]*?)?$/.test(routePath) || routePath.includes("//")) {
    throw new FoundationError("Page path must be an absolute lowercase URL path without a query or fragment.");
  }
  if (typeof title !== "string" || !title.trim() || /[\r\n]/.test(title) || title.length > 120) throw new FoundationError("Page title is required and must be at most 120 characters.");
}

async function architectureDocument(root) {
  const configuration = await readJson(resolveInside(root, ".foundation/project.json"));
  const manifest = await readJson(resolveInside(root, ".foundation/manifest.json"));
  const catalog = await readJson(resolveInside(root, ".foundation/capabilities.json"));
  const files = await walk(root);
  const pageViews = files
    .filter((entry) => !entry.symlink && /^resource\/views\/pages\/[a-z0-9][a-z0-9-]*\.php$/.test(entry.path))
    .map((entry) => path.posix.basename(entry.path, ".php"))
    .sort();
  const active = new Set(configuration.capabilities?.active ?? []);
  const capabilities = (catalog.capabilities ?? []).filter((item) => active.has(item.id)).sort((left, right) => left.id.localeCompare(right.id));
  const pageLines = pageViews.length ? pageViews.map((page) => `- \`${page}\`: \`resource/views/pages/${page}.php\``).join("\n") : "- none";
  const capabilityLines = capabilities.length
    ? capabilities.map((item) => `- \`${item.id}\` via recipe \`${item.recipe}\`; triggers: ${(item.triggers ?? []).join(", ")}`).join("\n")
    : "- none";
  return `# Generated Architecture

이 문서는 \`.foundation/project.json\`, capability catalog, 실제 페이지 View에서 생성된다. 직접 수정하지 말고 Foundation CLI를 사용한다.

## Observed configuration

- Runtime: \`${configuration.project.runtime}\`
- Profiles: ${manifest.activeProfiles.join(", ")}
- Page source: \`${configuration.pages.source}\`
- Asset manifest: \`${configuration.assets.enabled ? configuration.assets.manifest : "not applicable"}\`
- Docker: ${configuration.docker.enabled ? `\`${configuration.docker.service}\` via \`${configuration.docker.file}\`` : "not applicable"}

## Dependency direction

\`public/index.php -> bootstrap/app.php -> Symfony Routing -> PageController -> ViewRenderer -> PHP View\`

HTTP Request, Response, and route matching belong to Symfony components. Page configuration belongs to \`config/pages.php\`. HTML belongs to PHP Views. Vite owns asset compilation only.

## Pages

${pageLines}

## Active capabilities

${capabilityLines}

## Expansion gate

Feature folders, provider adapters, page-specific asset entries, and dependencies are added only after an approved capability plan identifies their owner, evidence, tests, security boundary, and removal condition.
`;
}

async function writeArchitectureDocument(root) {
  await writeFile(resolveInside(root, "ARCHITECTURE.md"), await architectureDocument(root), "utf8");
}

async function addPage(root, { slug, routePath, title, scss = false, typescript = false }) {
  validatePageInput(slug, routePath, title);
  const manifest = await readJson(resolveInside(root, ".foundation/manifest.json"));
  const profiles = new Set(manifest.activeProfiles ?? []);
  if (scss && !profiles.has("scss")) throw new FoundationError("--scss requires the scss profile.");
  if (typescript && !profiles.has("typescript")) throw new FoundationError("--typescript requires the typescript profile.");
  const configurationPath = resolveInside(root, "config/pages.php");
  const viewPath = `resource/views/pages/${slug}.php`;
  const scssPath = `resource/scss/pages/${slug}.scss`;
  const typeScriptPath = `resource/ts/pages/${slug}.ts`;
  const pageTargets = [resolveInside(root, viewPath), ...(scss ? [resolveInside(root, scssPath)] : []), ...(typescript ? [resolveInside(root, typeScriptPath)] : [])];
  for (const target of pageTargets) {
    if (await exists(target)) throw new FoundationError(`Page file already exists: ${toPosix(path.relative(root, target))}`);
  }
  const configuration = await readFile(configurationPath, "utf8");
  if (!configuration.includes("// <foundation:pages>") || !configuration.includes("// </foundation:pages>")) {
    throw new FoundationError("config/pages.php is missing Foundation page markers; no files were changed.");
  }
  if (configuration.includes(`    '${slug}' => [`)) throw new FoundationError(`Page already exists: ${slug}`);
  if (configuration.includes(`        'path' => '${phpSingleQuoted(routePath)}',`)) throw new FoundationError(`Route path already exists: ${routePath}`);

  const assets = [];
  if (typescript) assets.push(typeScriptPath);
  if (scss) assets.push(scssPath);
  const assetLines = assets.map((entry) => `            '${phpSingleQuoted(entry)}',`).join("\n");
  const block = `    '${slug}' => [\n        'path' => '${phpSingleQuoted(routePath)}',\n        'view' => 'pages/${slug}',\n        'title' => '${phpSingleQuoted(title)}',\n        'description' => '',\n        'assets' => [${assetLines ? `\n${assetLines}\n        ` : ""}],\n    ],\n`;
  const updated = configuration.replace("    // </foundation:pages>", `${block}    // </foundation:pages>`);
  const relativeTargets = ["config/pages.php", viewPath, "ARCHITECTURE.md", ...(scss ? [scssPath] : []), ...(typescript ? [typeScriptPath] : [])];
  const snapshots = await snapshotPaths(root, relativeTargets);
  try {
    await writeFile(configurationPath, updated, "utf8");
    await mkdir(path.dirname(resolveInside(root, viewPath)), { recursive: true });
    await writeFile(resolveInside(root, viewPath), `<?php\n\ndeclare(strict_types=1);\n\n/** @var Closure(string|int|float|Stringable|null): string $e */\n?>\n<section class="section section--${slug}" aria-labelledby="${slug}-title">\n    <div class="container">\n        <div class="inner">\n            <header class="section-header">\n                <h1 id="${slug}-title" class="section-title"><?= $e($title ?? '') ?></h1>\n                <div class="section-body"><p><?= $e($description ?? '') ?></p></div>\n            </header>\n            <div class="section-contents">\n                <!-- Assemble approved components here. -->\n            </div>\n        </div>\n    </div>\n</section>\n`, "utf8");
    if (scss) {
      await mkdir(path.dirname(resolveInside(root, scssPath)), { recursive: true });
      await writeFile(resolveInside(root, scssPath), `@use "../abstract/tokens" as token;\n\n.section--${slug} {\n  padding-block: token.$section-space;\n}\n`, "utf8");
    }
    if (typescript) {
      await mkdir(path.dirname(resolveInside(root, typeScriptPath)), { recursive: true });
      await writeFile(resolveInside(root, typeScriptPath), `const root = document.querySelector<HTMLElement>(".section--${slug}");\n\nif (root) {\n  root.dataset.enhanced = "true";\n}\n`, "utf8");
    }
    await writeArchitectureDocument(root);
  } catch (error) {
    await restoreSnapshots(root, snapshots);
    throw error;
  }
  return { slug, routePath, files: relativeTargets.filter((item) => item !== "config/pages.php" && item !== "ARCHITECTURE.md") };
}

function capabilityCachePath(root) {
  return path.join(tmpdir(), `project-foundation-capability-${sha256(path.resolve(root)).slice(0, 24)}.json`);
}

function capabilityClosure(catalog, requestedId, active) {
  const byId = new Map((catalog.capabilities ?? []).map((item) => [item.id, item]));
  if (!byId.has(requestedId)) throw new FoundationError(`Unknown capability: ${requestedId}`);
  const ordered = [];
  const visiting = new Set();
  const visit = (id) => {
    if (active.has(id) || ordered.includes(id)) return;
    if (visiting.has(id)) throw new FoundationError(`Capability dependency cycle: ${id}`);
    const capability = byId.get(id);
    if (!capability) throw new FoundationError(`Unknown capability dependency: ${id}`);
    visiting.add(id);
    for (const requirement of capability.requires ?? []) visit(requirement);
    visiting.delete(id);
    ordered.push(id);
  };
  visit(requestedId);
  return ordered;
}

async function capabilityPlan(root, requestedId) {
  const catalog = await readJson(resolveInside(root, ".foundation/capabilities.json"));
  const configuration = await readJson(resolveInside(root, ".foundation/project.json"));
  const active = new Set(configuration.capabilities?.active ?? []);
  const additions = capabilityClosure(catalog, requestedId, active);
  const selected = additions.map((id) => catalog.capabilities.find((item) => item.id === id));
  const conflicts = selected.flatMap((item) => (item.conflicts ?? []).filter((id) => active.has(id) || additions.includes(id)).map((id) => `${item.id} conflicts with ${id}`));
  const unverified = selected.flatMap((item) => [...(item.dependencies?.composer ?? []), ...(item.dependencies?.npm ?? [])].filter((item) => /selected by project|only when selected|project approval/i.test(item)).map((item) => `${item.id}: ${item}`));
  const plan = {
    schemaVersion: 1,
    root: path.resolve(root),
    stateSha: await treeFingerprint(root),
    requested: requestedId,
    additions,
    conflicts,
    unverified,
    files: selected.flatMap((item) => item.files ?? []),
    dependencies: selected.map((item) => ({ id: item.id, ...item.dependencies })),
    securityRules: [...new Set(selected.flatMap((item) => item.securityRules ?? []))],
    tests: selected.flatMap((item) => (item.tests ?? []).map((test) => `${item.id}: ${test}`)),
  };
  const planSha = sha256(JSON.stringify(plan));
  await writeJsonAtomic(capabilityCachePath(root), { ...plan, planSha });
  const output = { ...plan, root: undefined, stateSha: undefined, planSha };
  console.log(JSON.stringify(output, null, 2));
  return { ...plan, planSha };
}

async function capabilityApply(root, requestedId, planSha, confirmed) {
  if (confirmed !== requestedId) throw new FoundationError("capability apply requires --confirm with the exact capability ID.");
  if (!/^[a-f0-9]{64}$/.test(String(planSha ?? ""))) throw new FoundationError("capability apply requires --plan-sha with a SHA-256 value.");
  const cachePath = capabilityCachePath(root);
  if (!(await exists(cachePath))) throw new FoundationError("No capability plan is available; run capability plan again.");
  const plan = await readJson(cachePath);
  if (plan.planSha !== planSha || plan.requested !== requestedId || plan.root !== path.resolve(root)) throw new FoundationError("Capability plan identity does not match.");
  if ((await treeFingerprint(root)) !== plan.stateSha) throw new FoundationError("Project state changed after capability plan; run capability plan again.");
  if (plan.conflicts.length) throw new FoundationError("Capability conflicts must be resolved before apply.", plan.conflicts);
  if (plan.unverified.length) throw new FoundationError("Provider or dependency choices remain Unverified; record them in Project Intake and plan again.", plan.unverified);

  const snapshots = await snapshotPaths(root, [".foundation/project.json", "PROJECT.md", "ARCHITECTURE.md"]);
  try {
    const configurationPath = resolveInside(root, ".foundation/project.json");
    const configuration = await readJson(configurationPath);
    configuration.capabilities.active = [...new Set([...(configuration.capabilities.active ?? []), ...plan.additions])].sort();
    await writeJsonAtomic(configurationPath, configuration);
    let project = await readFile(resolveInside(root, "PROJECT.md"), "utf8");
    const body = `## Approved Capabilities\n\n${configuration.capabilities.active.map((id) => `- \`${id}\``).join("\n")}\n`;
    if (/^## Approved Capabilities\s*$/m.test(project)) {
      project = project.replace(/^## Approved Capabilities\s*$[\s\S]*?(?=^## |\s*$)/m, body);
    } else {
      project = `${project.trimEnd()}\n\n${body}`;
    }
    await writeFile(resolveInside(root, "PROJECT.md"), project, "utf8");
    await writeArchitectureDocument(root);
  } catch (error) {
    await restoreSnapshots(root, snapshots);
    throw error;
  }
  await rm(cachePath, { force: true });
  return plan;
}

async function readEvidence(root) {
  const evidencePath = resolveInside(root, ".foundation/evidence.json");
  if (!(await exists(evidencePath))) return { schemaVersion: 1, records: [] };
  return readJson(evidencePath);
}

async function addEvidence(root, { status, statement, sourceFile, sourceUrl }) {
  const normalizedStatus = String(status ?? "").trim().toLowerCase();
  if (!new Set(["observed", "inferred", "unverified"]).has(normalizedStatus)) throw new FoundationError("Evidence status must be observed, inferred, or unverified.");
  if (typeof statement !== "string" || !statement.trim() || /[\r\n]/.test(statement)) throw new FoundationError("Evidence statement is required on one line.");
  let source = null;
  if (sourceFile) {
    const relativePath = normalizeRelative(sourceFile);
    const filePath = resolveInside(root, relativePath);
    if (!(await exists(filePath))) throw new FoundationError(`Evidence source file does not exist: ${relativePath}`);
    source = { type: "file", path: relativePath, sha256: await hashFile(filePath) };
  } else if (sourceUrl) {
    const sources = await readJson(resolveInside(root, "SOURCES.json"));
    const registered = (sources.sources ?? []).find((item) => item.url === sourceUrl);
    if (!registered) throw new FoundationError("Observed URL evidence must exactly match a registered official source.");
    source = { type: "official-source", id: registered.id, url: registered.url, verifiedAt: registered.verifiedAt };
  }
  if (normalizedStatus === "observed" && !source) throw new FoundationError("Observed evidence requires --source-file or --source-url.");
  const evidence = await readEvidence(root);
  const record = { status: normalizedStatus, statement: statement.trim(), source };
  const id = sha256(JSON.stringify(record));
  if (!(evidence.records ?? []).some((item) => item.id === id)) evidence.records.push({ id, ...record });
  await writeJsonAtomic(resolveInside(root, ".foundation/evidence.json"), evidence);
  return { id, ...record };
}

async function auditEvidence(root) {
  const evidence = await readEvidence(root);
  const errors = [];
  if (evidence.schemaVersion !== 1 || !Array.isArray(evidence.records)) errors.push("evidence.json: unsupported schema");
  const ids = new Set();
  const sources = await readJson(resolveInside(root, "SOURCES.json"));
  for (const record of evidence.records ?? []) {
    if (!record.id || ids.has(record.id)) errors.push(`evidence.json: duplicate or missing record ID ${record.id ?? "<missing>"}`);
    ids.add(record.id);
    if (!new Set(["observed", "inferred", "unverified"]).has(record.status)) errors.push(`${record.id}: invalid evidence status`);
    if (record.status === "observed" && !record.source) errors.push(`${record.id}: observed evidence has no source`);
    if (record.source?.type === "file") {
      try {
        const filePath = resolveInside(root, record.source.path);
        if (!(await exists(filePath)) || (await hashFile(filePath)) !== record.source.sha256) errors.push(`${record.id}: file evidence changed or is missing`);
      } catch (error) {
        errors.push(`${record.id}: ${error.message}`);
      }
    }
    if (record.source?.type === "official-source" && !(sources.sources ?? []).some((item) => item.id === record.source.id && item.url === record.source.url)) {
      errors.push(`${record.id}: official source is no longer registered`);
    }
  }
  return { errors, count: ids.size };
}

function runCommand(command, args, { input, timeout = 10_000, cwd, env } = {}) {
  const useWindowsShell = process.platform === "win32" && ["npm", "composer"].includes(command);
  const result = spawnSync(command, args, {
    encoding: "utf8",
    input,
    timeout,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
    shell: useWindowsShell,
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout?.trim() ?? "",
    stderr: result.stderr?.trim() ?? "",
    error: result.error,
  };
}

function dockerDaemonConnected(result) {
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
  return result.ok
    && /^\d+\.\d+(?:\.\d+)?$/m.test(result.stdout)
    && !/(?:cannot connect|error during connect|access is denied|permission denied)/i.test(output);
}

async function doctor(root) {
  const manifest = await readJson(resolveInside(root, ".foundation/manifest.json"));
  const configuration = await readJson(resolveInside(root, ".foundation/project.json"));
  const toolchain = await readJson(resolveInside(root, ".foundation/toolchain.json"));
  const checks = [];
  const nodeVersion = process.versions.node;
  checks.push({ name: "Node", ok: compareVersions(nodeVersion, "22.22.0") >= 0 && compareVersions(nodeVersion, "25.0.0") < 0, value: nodeVersion, required: true });

  const dockerProfile = manifest.activeProfiles.includes("docker");
  const php = runCommand("php", ["--version"], { cwd: root });
  const phpVersion = (php.stdout || php.stderr).match(/PHP\s+(\d+\.\d+\.\d+)/)?.[1] ?? php.stderr;
  checks.push({ name: "PHP", ok: php.ok && compareVersions(phpVersion, toolchain.php.supported[0]) >= 0 && compareVersions(phpVersion, "8.3.0") < 0, value: phpVersion, required: !dockerProfile });
  const composer = runCommand("composer", ["--version"], { cwd: root });
  const composerVersion = (composer.stdout || composer.stderr).match(/\d+\.\d+\.\d+/)?.[0] ?? composer.stderr;
  checks.push({ name: "Composer", ok: composer.ok && compareVersions(composerVersion, toolchain.composer.minimum) >= 0, value: composerVersion, required: !dockerProfile });

  if (configuration.assets?.enabled) {
    const npm = runCommand("npm", ["--version"], { cwd: root });
    const npmVersion = npm.stdout || npm.stderr;
    checks.push({ name: "npm", ok: npm.ok && compareVersions(npmVersion, toolchain.npm.minimum) >= 0, value: npmVersion, required: true });
  }
  const git = runCommand("git", ["--version"], { cwd: root });
  checks.push({ name: "Git", ok: git.ok, value: git.stdout || git.stderr, required: true });

  if (dockerProfile) {
    const docker = runCommand("docker", ["--version"], { cwd: root });
    checks.push({ name: "Docker", ok: docker.ok, value: docker.stdout || docker.stderr, required: true });
    const compose = runCommand("docker", ["compose", "version", "--short"], { cwd: root });
    const composeVersion = compose.stdout || compose.stderr;
    checks.push({ name: "Compose", ok: compose.ok && compareVersions(composeVersion, toolchain.compose.minimum) >= 0, value: composeVersion, required: true });
    const buildx = runCommand("docker", ["buildx", "version"], { cwd: root });
    const buildxVersion = buildx.stdout.match(/v?\d+\.\d+\.\d+/)?.[0] ?? buildx.stderr;
    checks.push({ name: "Buildx", ok: buildx.ok && compareVersions(buildxVersion, toolchain.buildx.minimum) >= 0, value: buildxVersion, required: true });
    const daemon = runCommand("docker", ["info", "--format", "{{.ServerVersion}}"], { timeout: 15_000, cwd: root });
    const daemonOutput = [daemon.stdout, daemon.stderr].filter(Boolean).join("\n");
    checks.push({ name: "Docker daemon", ok: dockerDaemonConnected(daemon), value: daemonOutput, required: true });
  }

  const make = runCommand("make", ["--version"], { cwd: root });
  checks.push({ name: "GNU Make", ok: make.ok, value: make.stdout.split("\n")[0] || make.stderr, required: false });
  const gh = runCommand("gh", ["--version"], { cwd: root });
  checks.push({ name: "GitHub CLI", ok: gh.ok, value: gh.stdout.split("\n")[0] || gh.stderr, required: false });
  checks.push({
    name: "Codex project hooks",
    ok: false,
    value: "Trust and enable .codex/hooks.json with /hooks; CI remains authoritative if hooks are unavailable.",
    required: false,
  });

  for (const check of checks) console.log(`${check.ok ? "OK" : check.required ? "ERROR" : "WARN"} ${check.name}: ${check.value || "not found"}`);
  const failures = checks.filter((check) => check.required && !check.ok);
  if (failures.length) throw new FoundationError("Required tool checks failed.", failures.map((item) => item.name));
  return checks;
}

async function runProjectCommand(root, name) {
  const configuration = await readJson(resolveInside(root, ".foundation/project.json"));
  const specification = configuration.commands?.[name];
  if (!specification) return { name, applicable: false, ok: true, output: "not configured" };
  const errors = [];
  validateCommandSpecification(name, specification, errors);
  if (errors.length) throw new FoundationError(`Invalid project command: ${name}`, errors);
  let command = specification.command;
  let args = specification.args;
  const composerAvailable = command === "composer" ? runCommand("composer", ["--version"], { cwd: root }).ok : true;
  const useComposerContainer = command === "composer"
    && configuration.docker?.enabled
    && (process.env.FOUNDATION_PHP_CONTAINER === "1" || !composerAvailable);
  if (useComposerContainer) {
    const normalizedRoot = path.resolve(root);
    let toolingImage = PREPARED_PHP_TOOLING_IMAGES.get(normalizedRoot);
    if (!toolingImage) {
      const imageBase = configuration.project.name.replace(/[^a-z0-9._-]/g, "-");
      toolingImage = `${imageBase}:php-tooling`;
      const dockerfile = normalizeRelative(configuration.docker.file);
      const build = runCommand("docker", [
        "buildx",
        "build",
        "--file",
        dockerfile,
        "--target",
        "php-tooling",
        "--tag",
        toolingImage,
        "--load",
        ".",
      ], { timeout: 20 * 60_000, cwd: root });
      if (!build.ok) throw new FoundationError("Could not build the pinned PHP tooling image.", [build.stderr || build.stdout]);
      PREPARED_PHP_TOOLING_IMAGES.set(normalizedRoot, toolingImage);
    }
    command = "docker";
    args = [
      "run",
      "--rm",
      "--volume",
      `${path.resolve(root)}:/app`,
      "--workdir",
      "/app",
      toolingImage,
      "composer",
      ...specification.args,
    ];
  }
  const result = runCommand(command, args, { timeout: command === "docker" ? 600_000 : 120_000, cwd: root });
  return {
    name,
    applicable: true,
    ok: result.ok,
    output: [result.stdout, result.stderr].filter(Boolean).join("\n"),
  };
}

async function runContainerCommand(root, mode) {
  const manifest = await readJson(resolveInside(root, ".foundation/manifest.json"));
  if (!manifest.activeProfiles.includes("docker")) return { applicable: false, results: [] };
  const configuration = await readJson(resolveInside(root, ".foundation/project.json"));
  const dockerfile = normalizeRelative(configuration.docker.file);
  const imageBase = configuration.project.name.replace(/[^a-z0-9._-]/g, "-");
  const buildTargets = [
    ...(mode === "verify" ? [configuration.docker.targets?.test] : []),
    configuration.docker.targets?.production,
    configuration.docker.targets?.web,
  ].filter(Boolean);
  const imageNames = buildTargets.map((target) => ({ target, name: `${imageBase}:${target}` }));
  const commands = [];
  if (["verify", "config"].includes(mode)) commands.push(["docker", ["compose", "config", "-q"]]);
  if (mode === "verify") commands.push(["docker", ["buildx", "build", "--check", "--file", dockerfile, "."]]);
  if (["verify", "image"].includes(mode)) {
    for (const image of imageNames) {
      const args = ["buildx", "build", "--file", dockerfile, "--target", image.target, "--tag", image.name, "--load"];
      if (process.env.GITHUB_ACTIONS === "true") {
        const cacheScope = `foundation-${image.target}`;
        args.push("--cache-from", `type=gha,scope=${cacheScope}`, "--cache-to", `type=gha,mode=max,scope=${cacheScope}`);
      }
      args.push(".");
      commands.push(["docker", args]);
    }
  }
  const results = [];
  for (const [command, args] of commands) {
    const result = runCommand(command, args, { timeout: 20 * 60_000, cwd: root });
    results.push({ command: [command, ...args].join(" "), ...result });
    if (!result.ok) throw new FoundationError(`Container command failed: ${[command, ...args].join(" ")}`, [result.stderr || result.stdout]);
  }
  if (mode === "verify") {
    const projectName = `foundation-verify-${process.pid}`;
    const environment = { PORT: "0", COMPOSE_PROJECT_NAME: projectName };
    const compose = (...args) => runCommand("docker", ["compose", "--project-name", projectName, ...args], {
      timeout: 20 * 60_000,
      cwd: root,
      env: environment,
    });
    let runtimeError;
    try {
      const up = compose("up", "--build", "--detach", "--wait");
      if (!up.ok) throw new FoundationError("Compose runtime failed to become healthy.", [up.stderr || up.stdout]);

      const published = compose("port", "web", "8080");
      const port = published.stdout.match(/:(\d+)$/)?.[1];
      if (!published.ok || !port) throw new FoundationError("Could not resolve the ephemeral web port.", [published.stderr || published.stdout]);

      const phpUser = runCommand("docker", ["inspect", `${projectName}-php-1`, "--format", "{{.Config.User}}"], { cwd: root });
      const webUser = runCommand("docker", ["inspect", `${projectName}-web-1`, "--format", "{{.Config.User}}"], { cwd: root });
      for (const [service, inspection] of [["php", phpUser], ["web", webUser]]) {
        if (!inspection.ok || !inspection.stdout || ["0", "root"].includes(inspection.stdout.toLowerCase())) {
          throw new FoundationError(`${service} runtime is not configured as a non-root user.`, [inspection.stderr || inspection.stdout]);
        }
      }

      const origin = `http://127.0.0.1:${port}`;
      const health = await fetch(`${origin}/healthz`, { signal: AbortSignal.timeout(10_000) });
      const page = await fetch(`${origin}/`, { signal: AbortSignal.timeout(10_000) });
      const markup = await page.text();
      const assetPaths = [...markup.matchAll(/(?:src|href)="(\/build\/assets\/[^"]+)"/g)].map((match) => match[1]);
      if (!health.ok || (await health.text()).trim() !== "ok") throw new FoundationError("Runtime health endpoint failed.");
      if (!page.ok || !markup.includes('<section class="section section--hero"')) throw new FoundationError("Runtime page did not render the canonical section.");
      if (!assetPaths.some((assetPath) => assetPath.endsWith(".css")) || !assetPaths.some((assetPath) => assetPath.endsWith(".js"))) {
        throw new FoundationError("Runtime page must reference built CSS and JavaScript assets.");
      }
      for (const assetPath of assetPaths) {
        const asset = await fetch(`${origin}${assetPath}`, { signal: AbortSignal.timeout(10_000) });
        if (!asset.ok || !asset.headers.get("cache-control")?.includes("immutable")) throw new FoundationError("Built asset delivery or cache policy failed.");
      }

      results.push({
        command: "compose runtime e2e",
        ok: true,
        stdout: `health=200 page=200 assets=${assetPaths.length} php-user=${phpUser.stdout} web-user=${webUser.stdout}`,
        stderr: "",
      });
    } catch (error) {
      runtimeError = error;
    } finally {
      const down = compose("down", "--remove-orphans");
      if (!down.ok && !runtimeError) runtimeError = new FoundationError("Could not clean the Compose verification project.", [down.stderr || down.stdout]);
    }
    if (runtimeError) throw runtimeError;
  }
  return { applicable: true, imageNames: ["verify", "image"].includes(mode) ? imageNames.map((item) => item.name) : [], results };
}

function gitOutput(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true });
  const stdout = String(result.stdout ?? "").trim();
  const stderr = String(result.stderr ?? "").trim();
  return { ok: result.status === 0, output: result.status === 0 ? stdout : `${stdout}\n${stderr}`.trim() };
}

function isTrustedDependabotPullRequest(event, actor = "") {
  const pullRequest = event?.pull_request;
  return actor === DEPENDABOT_LOGIN
    && pullRequest?.user?.login === DEPENDABOT_LOGIN
    && pullRequest?.user?.type === "Bot"
    && /^dependabot\/.+/.test(pullRequest?.head?.ref ?? "");
}

function dependabotChangeErrors(lines) {
  if (!lines.length) return ["Trusted Dependabot PR has no changed dependency files"];
  const errors = [];
  for (const line of lines) {
    const fields = line.split("\t");
    const status = fields[0] ?? "";
    const relativePath = fields.at(-1) ?? "";
    if (status !== "M" || !DEPENDABOT_CHANGE_PATTERNS.some((pattern) => pattern.test(relativePath))) {
      errors.push(`Trusted Dependabot PR changed a forbidden path or status: ${line}`);
    }
  }
  return errors;
}

function pullRequestPolicyErrors(event, actor, changedLines, { bootstrap = false } = {}) {
  const pullRequest = event?.pull_request;
  if (!pullRequest) return [];
  const errors = [];
  const title = pullRequest.title ?? "";
  const body = pullRequest.body ?? "";
  const branch = pullRequest.head?.ref ?? "";
  const trustedDependabot = isTrustedDependabotPullRequest(event, actor);

  if (branch && !bootstrap && !trustedDependabot && !BRANCH_PATTERN.test(branch)) errors.push(`Branch name does not match policy: ${branch}`);
  if (!PR_TITLE_PATTERN.test(title)) errors.push(`PR title is not Conventional Commit format: ${title}`);
  if (trustedDependabot) {
    errors.push(...dependabotChangeErrors(changedLines));
    return errors;
  }
  if (!/^## Rule evidence\s*$/m.test(body)) errors.push("PR body is missing the Rule evidence section");
  if (changedLines.some((line) => line.startsWith("A\t")) && !/^## New files and folders\s*$/m.test(body)) {
    errors.push("PR body is missing the New files and folders section");
  }
  if (changedLines.some((line) => /(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Dockerfile|dependabot\.yml)$/.test(line.split("\t").at(-1)))) {
    if (!/^## Dependency changes\s*$/m.test(body)) errors.push("PR body is missing the Dependency changes section");
  }
  return errors;
}

async function pullRequestEvidence(root, base, errors, warnings) {
  const branch = gitOutput(root, ["branch", "--show-current"]);
  const eventPath = process.env.GITHUB_EVENT_PATH;
  let event;
  if (eventPath && await exists(eventPath)) {
    try {
      event = await readJson(eventPath);
    } catch (error) {
      errors.push(error.message);
      return;
    }
  }

  const eventBranch = event?.pull_request?.head?.ref ?? "";
  const branchName = eventBranch || branch.output;
  let bootstrap = false;
  if (branchName === "codex/foundation-v1") {
    const manifest = await readJson(resolveInside(root, ".foundation/manifest.json"));
    const configuration = await readJson(resolveInside(root, ".foundation/project.json"));
    bootstrap = manifest.mode === "upstream" && configuration.project?.name === "project-foundation";
  }
  if (!event?.pull_request && branch.ok && branchName && !["main", "master"].includes(branchName)) {
    if (!bootstrap && !BRANCH_PATTERN.test(branchName)) errors.push(`Branch name does not match policy: ${branchName}`);
  }

  if (!event?.pull_request) {
    warnings.push("PR title and evidence checks are only available in a pull_request event.");
    return;
  }

  const changed = gitOutput(root, ["diff", "--name-status", `${base}...HEAD`]);
  if (!changed.ok) {
    errors.push(`Could not inspect changed files against ${base}: ${changed.output}`);
    return;
  }
  const lines = changed.output.split(/\r?\n/).filter(Boolean);
  errors.push(...pullRequestPolicyErrors(event, process.env.GITHUB_ACTOR ?? "", lines, { bootstrap }));
}

async function verifyProject(root, { base = "origin/main", scope = "all" } = {}) {
  const errors = [];
  const warnings = [];
  const results = [];
  if (["all", "policy"].includes(scope)) {
    const validation = await validateProject(root, { strict: true });
    errors.push(...validation.errors);
    warnings.push(...validation.warnings);
    await pullRequestEvidence(root, base, errors, warnings);
    const whitespace = gitOutput(root, ["diff", "--check"]);
    if (!whitespace.ok) errors.push(`git diff --check failed: ${whitespace.output}`);
  }
  if (["all", "project"].includes(scope)) {
    for (const name of ["lint", "typecheck", "test", "build"]) {
      const result = await runProjectCommand(root, name);
      results.push(result);
      if (!result.ok) errors.push(`Project command failed: ${name}\n${result.output}`);
    }
  }
  if (["all", "dependency"].includes(scope)) {
    for (const name of ["dependencyValidate", "dependencyAudit", "assetAudit"]) {
      const result = await runProjectCommand(root, name);
      results.push(result);
      if (!result.applicable && name === "dependencyAudit") warnings.push("No runtime dependency audit command is configured; GitHub capability detection will report this limitation.");
      else if (!result.ok) errors.push(`${name} failed:\n${result.output}`);
    }
  }
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)], results };
}

async function readStandardInputJson() {
  if (process.stdin.isTTY) return {};
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new FoundationError("Hook input is not valid JSON.", [error.message]);
  }
}

async function agentContext(root) {
  const manifest = await readJson(resolveInside(root, ".foundation/manifest.json"));
  const configuration = await readJson(resolveInside(root, ".foundation/project.json"));
  const commandNames = Object.keys(configuration.commands ?? {});
  return [
    "Read FOUNDATION.md, PROJECT.md, and the nearest AGENTS.md before editing.",
    `Runtime: ${configuration.project.runtime}. Active profiles: ${manifest.activeProfiles.join(", ")}.`,
    `Project Intake: ${configuration.intake.state}. Unverified: ${configuration.intake.unverified.length ? configuration.intake.unverified.join(", ") : "none"}.`,
    `Configured project commands: ${commandNames.length ? commandNames.join(", ") : "none"}.`,
    "Before finishing run: node scripts/foundation.mjs verify --base origin/main",
    "Never convert Inferred or Unverified information into Observed facts. Use evidence add/audit for durable completion claims.",
    "Use site-starter for project intake, architecture-selection for structural changes, and change-workflow for implementation changes.",
  ].join("\n");
}

async function agentHook(root, eventName) {
  const input = await readStandardInputJson();
  if (eventName === "session-start") {
    return { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: await agentContext(root) } };
  }
  if (eventName === "pre-tool-use") {
    const toolInput = input.tool_input ?? {};
    const command = typeof toolInput.command === "string" ? toolInput.command : JSON.stringify(toolInput);
    const deny = (reason) => ({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } });
    if (/(?:git\s+reset\s+--hard|git\s+clean\s+-[^\s]*f|git\s+push[^\n]*--force(?:\s|$)|rm\s+-rf\s+(?:~|\/)(?:\s|$))/i.test(command)) {
      return deny("Destructive or history-rewriting command is blocked by Project Foundation.");
    }
    const manifest = await readJson(resolveInside(root, ".foundation/manifest.json"));
    if (manifest.mode === "consumer" && MANAGED_PATHS.some((managedPath) => command.includes(managedPath))) {
      return deny("Foundation-managed files cannot be edited directly in a consumer project; use foundation update.");
    }
    const configuration = await readJson(resolveInside(root, ".foundation/project.json"));
    const usesFoundationWorkflow = /foundation\.mjs\s+(?:page|capability|adopt|init)\b/.test(command);
    if (manifest.mode === "consumer" && configuration.intake.state === "incomplete" && !usesFoundationWorkflow && /(?:Dockerfile|compose\.ya?ml|composer\.json|package\.json|src[\\/]|resource[\\/])/i.test(command)) {
      return deny("Project Intake is incomplete. Record the missing project facts and use an approved Foundation plan before structural edits.");
    }
    return { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: "Preserve Observed/Inferred/Unverified boundaries and record real verification evidence." } };
  }
  if (eventName !== "stop") throw new FoundationError(`Unknown agent hook event: ${eventName}`);
  const status = gitOutput(root, ["status", "--porcelain=v1"]);
  if (!status.ok || !status.output) return { continue: true, suppressOutput: true };
  const configuration = await readJson(resolveInside(root, ".foundation/project.json"));
  const result = await verifyProject(root, { base: `origin/${configuration.github.defaultBranch}`, scope: "all" });
  if (!result.errors.length) return { continue: true, suppressOutput: true };
  const reason = `Foundation verification failed:\n${result.errors.map((item) => `- ${item}`).join("\n")}`;
  if (input.stop_hook_active) return { continue: false, stopReason: reason, systemMessage: reason };
  return { decision: "block", reason: `${reason}\nFix the failures, rerun verification, and review the final diff.` };
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
          required_status_checks: REQUIRED_CHECKS.map((context) => ({ context })),
        },
      },
    ],
  };
}

function tagRulesetPayload() {
  return {
    name: "release tag protection",
    target: "tag",
    enforcement: "active",
    bypass_actors: [{ actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always" }],
    conditions: { ref_name: { include: ["refs/tags/v*"], exclude: [] } },
    rules: [{ type: "deletion" }, { type: "non_fast_forward" }],
  };
}

function comparableArrayItem(items, expected, index) {
  if (!expected || typeof expected !== "object" || Array.isArray(expected)) return items[index];
  for (const identity of ["type", "context"]) {
    if (expected[identity] !== undefined) return items.find((item) => item?.[identity] === expected[identity]);
  }
  if (expected.actor_type !== undefined) {
    return items.find((item) => item?.actor_type === expected.actor_type && item?.actor_id === expected.actor_id);
  }
  return items[index];
}

function projectComparableValue(value, expected) {
  if (Array.isArray(expected)) {
    if (!Array.isArray(value) || value.length !== expected.length) return value;
    return expected.map((item, index) => projectComparableValue(comparableArrayItem(value, item, index), item));
  }
  if (expected && typeof expected === "object") {
    return Object.fromEntries(Object.keys(expected).map((key) => [key, projectComparableValue(value?.[key], expected[key])]));
  }
  return value;
}

function comparableRuleset(value, expected) {
  return projectComparableValue(value, expected);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
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
  const desiredRulesets = [rulesetPayload(), tagRulesetPayload()];
  for (const desired of desiredRulesets) {
    const summary = rulesets.ok && Array.isArray(rulesets.data) ? rulesets.data.find((item) => item.name === desired.name) : null;
    if (!summary) {
      differences.push({ setting: `ruleset.${desired.name}`, current: "missing", target: desired });
      continue;
    }
    const detail = ghApi("GET", `${repo}/rulesets/${summary.id}`, undefined, { allowFailure: true });
    const current = detail.ok ? comparableRuleset(detail.data, desired) : "unavailable";
    if (!detail.ok || canonicalJson(current) !== canonicalJson(desired)) {
      differences.push({ setting: `ruleset.${desired.name}`, current, target: desired });
    }
  }

  const actions = ghApi("GET", `${repo}/actions/permissions`, undefined, { allowFailure: true });
  if (!actions.ok || actions.data?.sha_pinning_required !== true) differences.push({ setting: "actions.sha_pinning_required", current: actions.data?.sha_pinning_required ?? "unavailable", target: true });
  const immutableReleases = ghApi("GET", `${repo}/immutable-releases`, undefined, { allowFailure: true });
  if (!immutableReleases.ok || immutableReleases.data?.enabled !== true) differences.push({ setting: "immutable_releases", current: immutableReleases.ok ? immutableReleases.data : "disabled or unavailable", target: true });

  const dependencyReviewAvailable = repository.private !== true || repository.security_and_analysis?.advanced_security?.status === "enabled";
  const limitations = [
    "Availability of secret scanning, push protection, CodeQL default setup, and private vulnerability reporting depends on the repository plan and eligibility.",
    "github apply reports unsupported endpoints instead of claiming success.",
  ];
  if (!dependencyReviewAvailable) limitations.push("Dependency Review is unavailable for this private repository; dependency-gate must use the configured runtime audit fallback.");
  console.log(JSON.stringify({ repo, visibility: repository.private ? "private" : "public", dependencyReviewAvailable, differences, limitations }, null, 2));
  return differences;
}

async function githubApply(repo, confirmed, { makePublic = false } = {}) {
  validateRepositoryName(repo);
  if (confirmed !== repo) throw new FoundationError("github apply requires --confirm with the exact owner/name repository value.");
  await githubPlan(repo);
  ghApi("PATCH", repo, makePublic ? { ...REPOSITORY_TARGET, private: false } : REPOSITORY_TARGET);

  const existing = ghApi("GET", `${repo}/rulesets`, undefined, { allowFailure: true });
  for (const payload of [rulesetPayload(), tagRulesetPayload()]) {
    const ruleset = existing.ok && Array.isArray(existing.data) ? existing.data.find((item) => item.name === payload.name) : null;
    if (ruleset) ghApi("PUT", `${repo}/rulesets/${ruleset.id}`, payload);
    else ghApi("POST", `${repo}/rulesets`, payload);
  }

  const optional = [
    ["PUT", `${repo}/vulnerability-alerts`, undefined, "Dependabot alerts"],
    ["PUT", `${repo}/automated-security-fixes`, undefined, "Dependabot security updates"],
    ["PUT", `${repo}/private-vulnerability-reporting`, undefined, "Private vulnerability reporting"],
    ["PUT", `${repo}/immutable-releases`, undefined, "Immutable releases"],
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
    // Directories and PAX metadata do not materialize files; manifest hashes still prove every managed path.
    else if (!["5", "g", "x"].includes(type)) throw new FoundationError(`Unsupported tar entry type for ${rawName}`);
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
  const currentVersion = String(current.foundationVersion ?? "");
  if (!/^\d+\.\d+\.\d+$/.test(currentVersion)) throw new FoundationError("Consumer manifest has an invalid Foundation version.");
  if (Number.parseInt(currentVersion, 10) !== Number.parseInt(version, 10)) {
    throw new FoundationError(
      `Major Foundation update ${currentVersion} -> ${version} requires an approved seed migration; automatic update refused.`,
    );
  }
  if (current.schemaVersion !== 3) {
    throw new FoundationError("Consumer manifest schema requires an approved migration; automatic update refused.");
  }
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

  const selectedManaged = managedPathsForProfiles(current.activeProfiles ?? []);
  for (const relativePath of selectedManaged) {
    const expected = sourceManifest.managedFiles?.[relativePath];
    const data = archiveFiles.get(normalizeRelative(relativePath));
    if (!expected || !data || sha256(data) !== expected) throw new FoundationError(`Release managed file checksum mismatch: ${relativePath}`);
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
    for (const relativePath of selectedManaged) {
      const destination = resolveInside(stage, relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, archiveFiles.get(relativePath));
    }
    const stagedManifest = {
      ...current,
      foundationVersion: version,
      managedFiles: Object.fromEntries(selectedManaged.map((relativePath) => [relativePath, sourceManifest.managedFiles[relativePath]])),
    };
    await writeJsonAtomic(resolveInside(stage, ".foundation/manifest.json"), stagedManifest);
    const stagedValidation = await validateProject(stage, { strict: false });
    if (stagedValidation.errors.length) throw new FoundationError("Updated files failed validation in staging.", stagedValidation.errors);

    const updatePaths = [...selectedManaged, ".foundation/manifest.json"];
    const snapshots = await snapshotPaths(root, updatePaths);
    try {
      for (const relativePath of selectedManaged) {
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
  foundation.mjs init --runtime php [--profile github,docker,typescript,scss] [--project-name name] [--owner login]
  foundation.mjs adopt plan --runtime php [--profile github,docker,typescript,scss] [--project-name name] [--owner login]
  foundation.mjs adopt apply --plan-sha sha256 --confirm
  foundation.mjs page add slug --path /path --title title [--scss] [--typescript]
  foundation.mjs capability list
  foundation.mjs capability plan id
  foundation.mjs capability apply id --plan-sha sha256 --confirm id
  foundation.mjs architecture render
  foundation.mjs evidence add --status observed|inferred|unverified --statement text [--source-file path|--source-url url]
  foundation.mjs evidence audit
  foundation.mjs validate [--strict]
  foundation.mjs verify [--base origin/main] [--scope all|policy|project|dependency]
  foundation.mjs run <configured-command>
  foundation.mjs container verify|image|config
  foundation.mjs update [--version 1.0.0]
  foundation.mjs doctor
  foundation.mjs agent context
  foundation.mjs github plan [--repo owner/name]
  foundation.mjs github apply --repo owner/name --confirm owner/name [--make-public]`);
}

async function main(argv = process.argv.slice(2), root = process.cwd()) {
  const { positional, options } = parseArguments(argv);
  const [command, subcommand] = positional;
  if (!command || command === "help" || options.has("help")) {
    printUsage();
    return;
  }
  if (command === "init") {
    const result = await initProject(path.resolve(root), {
      profile: options.get("profile"),
      projectName: options.get("project-name"),
      runtime: options.get("runtime"),
      owner: options.get("owner"),
    });
    console.log(`Initialized ${result.name} with runtime ${result.runtime} and profiles: ${result.profiles.join(", ")}`);
    return;
  }
  if (command === "adopt" && subcommand === "plan") {
    await adoptPlan(path.resolve(root), {
      profile: options.get("profile"),
      projectName: options.get("project-name"),
      runtime: options.get("runtime"),
      owner: options.get("owner"),
    });
    return;
  }
  if (command === "adopt" && subcommand === "apply") {
    const result = await adoptApply(path.resolve(root), options.get("plan-sha"), options.has("confirm"));
    console.log(`Adopted Project Foundation with runtime ${result.runtime}.`);
    return;
  }
  if (command === "page" && subcommand === "add") {
    const result = await addPage(path.resolve(root), {
      slug: positional[2],
      routePath: options.get("path"),
      title: options.get("title"),
      scss: options.has("scss"),
      typescript: options.has("typescript"),
    });
    console.log(`Added page ${result.slug} at ${result.routePath}: ${result.files.join(", ")}`);
    return;
  }
  if (command === "capability" && subcommand === "list") {
    const catalog = await readJson(resolveInside(path.resolve(root), ".foundation/capabilities.json"));
    for (const capability of catalog.capabilities ?? []) console.log(`${capability.id}\t${(capability.triggers ?? []).join("; ")}`);
    return;
  }
  if (command === "capability" && subcommand === "plan") {
    await capabilityPlan(path.resolve(root), positional[2]);
    return;
  }
  if (command === "capability" && subcommand === "apply") {
    const result = await capabilityApply(path.resolve(root), positional[2], options.get("plan-sha"), options.get("confirm"));
    console.log(`Approved capabilities: ${result.additions.join(", ") || "already active"}`);
    return;
  }
  if (command === "architecture" && subcommand === "render") {
    await writeArchitectureDocument(path.resolve(root));
    console.log("Regenerated ARCHITECTURE.md from observed project configuration.");
    return;
  }
  if (command === "evidence" && subcommand === "add") {
    const record = await addEvidence(path.resolve(root), {
      status: options.get("status"),
      statement: options.get("statement"),
      sourceFile: options.get("source-file"),
      sourceUrl: options.get("source-url"),
    });
    console.log(JSON.stringify(record, null, 2));
    return;
  }
  if (command === "evidence" && subcommand === "audit") {
    const result = await auditEvidence(path.resolve(root));
    if (result.errors.length) throw new FoundationError("Evidence audit failed.", result.errors);
    console.log(`Evidence audit passed: ${result.count} records.`);
    return;
  }
  if (command === "validate") {
    const result = await validateProject(path.resolve(root), { strict: options.has("strict") });
    for (const warning of result.warnings) console.warn(`WARN ${warning}`);
    if (result.errors.length) throw new FoundationError("Validation failed.", result.errors);
    console.log(`Validation passed: ${result.ruleCount} rules, ${result.sourceCount} official sources.`);
    return;
  }
  if (command === "verify") {
    const scope = options.get("scope") ?? "all";
    if (!["all", "policy", "project", "dependency"].includes(scope)) throw new FoundationError(`Unknown verification scope: ${scope}`);
    const result = await verifyProject(path.resolve(root), { base: options.get("base") ?? "origin/main", scope });
    for (const warning of result.warnings) console.warn(`WARN ${warning}`);
    for (const item of result.results) console.log(`${item.ok ? "OK" : "ERROR"} ${item.name}: ${item.output || "completed"}`);
    if (result.errors.length) throw new FoundationError("Verification failed.", result.errors);
    console.log("Foundation verification passed.");
    return;
  }
  if (command === "run" && subcommand) {
    const result = await runProjectCommand(path.resolve(root), subcommand);
    if (!result.applicable && !options.has("if-configured")) throw new FoundationError(`Project command is not configured: ${subcommand}`);
    if (!result.applicable) {
      console.log(`Project command is not configured; skipped: ${subcommand}`);
      return;
    }
    if (result.output) console.log(result.output);
    if (!result.ok) throw new FoundationError(`Project command failed: ${subcommand}`);
    return;
  }
  if (command === "container" && ["verify", "image", "config"].includes(subcommand)) {
    const result = await runContainerCommand(path.resolve(root), subcommand);
    if (!result.applicable) {
      console.log("Container profile is not active; not applicable.");
      return;
    }
    for (const item of result.results) console.log(`OK ${item.command}`);
    for (const imageName of result.imageNames ?? []) console.log(`Container image: ${imageName}`);
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
  if (command === "agent" && subcommand === "context") {
    console.log(await agentContext(path.resolve(root)));
    return;
  }
  if (command === "agent" && subcommand === "hook") {
    const eventName = positional[2];
    console.log(JSON.stringify(await agentHook(path.resolve(root), eventName)));
    return;
  }
  if (command === "github" && subcommand === "plan") {
    await githubPlan(options.get("repo") ?? "DevCrop/project-foundation");
    return;
  }
  if (command === "github" && subcommand === "apply") {
    await githubApply(options.get("repo") ?? "", options.get("confirm"), { makePublic: options.has("make-public") });
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
  REQUIRED_CHECKS,
  addEvidence,
  addPage,
  adoptApply,
  adoptPlan,
  agentHook,
  architectureDocument,
  auditEvidence,
  capabilityApply,
  capabilityPlan,
  comparableRuleset,
  compareVersions,
  dockerDaemonConnected,
  dependabotChangeErrors,
  initProject,
  isTrustedDependabotPullRequest,
  main,
  parseArguments,
  parseProfiles,
  parseRuntime,
  parseTarGz,
  refreshManifest,
  resolveInside,
  pullRequestPolicyErrors,
  updateProject,
  validateProject,
  verifyProject,
};
