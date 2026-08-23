import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  appendFile,
  cp,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import {
  FoundationError,
  MANAGED_PATHS,
  comparableRuleset,
  dependabotChangeErrors,
  dockerDaemonConnected,
  isTrustedDependabotPullRequest,
  parseTarGz,
  pullRequestPolicyErrors,
  refreshManifest,
  resolveInside,
  validateProject,
} from "./foundation.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXED_NOW = new Date("2026-08-23T12:00:00Z");
const TEMPORARIES = new Set();
const COPY_EXCLUDES = new Set([".git", ".tmp-init-check", "node_modules", "vendor", "dist", "build", ".release"]);

async function temporaryDirectory(prefix = "project-foundation-test-") {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  TEMPORARIES.add(directory);
  return directory;
}

async function copyFoundation() {
  const target = await temporaryDirectory();
  await cp(ROOT, target, {
    recursive: true,
    filter: (source) => !COPY_EXCLUDES.has(path.basename(source)),
  });
  return target;
}

function runCli(root, args, environment = {}, scriptRoot = root, input) {
  return spawnSync(process.execPath, [path.join(scriptRoot, "scripts", "foundation.mjs"), ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...environment },
    input,
    timeout: 45_000,
    windowsHide: true,
  });
}

function runCliAsync(root, args, environment = {}, scriptRoot = root) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(scriptRoot, "scripts", "foundation.mjs"), ...args], {
      cwd: root,
      env: { ...process.env, ...environment },
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (status) => resolve({ status, stdout, stderr }));
  });
}

async function listFiles(root, current = "") {
  const entries = await readdir(path.join(root, current), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (COPY_EXCLUDES.has(entry.name)) continue;
    const relative = path.join(current, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(root, relative)));
    else files.push(relative.split(path.sep).join("/"));
  }
  return files.sort();
}

async function snapshotTree(root) {
  const snapshot = {};
  for (const relativePath of await listFiles(root)) {
    snapshot[relativePath] = createHash("sha256").update(await readFile(path.join(root, relativePath))).digest("hex");
  }
  return snapshot;
}

function tarHeader(name, size, type = "0") {
  const header = Buffer.alloc(512);
  const write = (value, offset, length) => Buffer.from(value).copy(header, offset, 0, Math.min(length, Buffer.byteLength(value)));
  write(name, 0, 100);
  write("0000644\0", 100, 8);
  write("0000000\0", 108, 8);
  write("0000000\0", 116, 8);
  write(`${size.toString(8).padStart(11, "0")}\0`, 124, 12);
  write("00000000000\0", 136, 12);
  header.fill(0x20, 148, 156);
  header[156] = type.charCodeAt(0);
  write("ustar\0", 257, 6);
  write("00", 263, 2);
  const checksum = [...header].reduce((sum, byte) => sum + byte, 0);
  write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8);
  return header;
}

function createTarGz(files) {
  const parts = [];
  for (const [name, content] of files) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
    parts.push(tarHeader(name, data.length), data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(parts));
}

async function releaseArchive(source, version) {
  const packagePath = path.join(source, "package.json");
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  packageJson.version = version;
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
  const manifestPath = path.join(source, ".foundation", "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.foundationVersion = version;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await refreshManifest(source);
  const refreshed = JSON.parse(await readFile(manifestPath, "utf8"));
  const files = [["project-foundation/.foundation/manifest.json", await readFile(manifestPath)]];
  for (const relativePath of Object.keys(refreshed.managedFiles)) {
    files.push([`project-foundation/${relativePath}`, await readFile(path.join(source, relativePath))]);
  }
  return createTarGz(files);
}

async function serveRelease(archive, version) {
  const checksum = createHash("sha256").update(archive).digest("hex");
  const server = createServer((request, response) => {
    if (request.url?.endsWith(".sha256")) {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end(`${checksum}  project-foundation-v${version}.tar.gz\n`);
      return;
    }
    response.writeHead(200, { "content-type": "application/gzip" });
    response.end(archive);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

function jsonPointer(value, pointer) {
  if (pointer === "") return value;
  return pointer.slice(1).split("/").map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))
    .reduce((current, part) => current?.[part], value);
}

async function initializeConsumer(root, profiles = "github,docker,typescript,scss", owner = "DevCrop") {
  const args = ["init", "--runtime", "php", "--profile", profiles, "--project-name", "scenario-site"];
  if (profiles.split(",").includes("github")) args.push("--owner", owner);
  const result = runCli(root, args);
  assert.equal(result.status, 0, result.stderr);
  return result;
}

async function mutate(root, name) {
  if (name === "approved-unverified") {
    const file = path.join(root, ".foundation", "project.json");
    const data = JSON.parse(await readFile(file, "utf8"));
    data.intake.state = "approved";
    await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  } else if (name === "rogue-scss-entry") {
    await writeFile(path.join(root, "resource", "scss", "rogue.scss"), ".rogue { color: red; }\n", "utf8");
  } else if (name === "legacy-scss-import") {
    await appendFile(path.join(root, "resource", "scss", "main.scss"), "\n@import \"legacy\";\n", "utf8");
  } else if (name === "main-scss-implementation") {
    await appendFile(path.join(root, "resource", "scss", "main.scss"), "\n.rogue { color: red; }\n", "utf8");
  } else if (name === "explicit-any") {
    await appendFile(path.join(root, "resource", "ts", "main.ts"), "\nconst invalid: any = null;\n", "utf8");
  } else if (name === "strict-disabled") {
    const file = path.join(root, "tsconfig.json");
    const data = JSON.parse(await readFile(file, "utf8"));
    data.compilerOptions.strict = false;
    await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  } else if (name === "stale-architecture") {
    await appendFile(path.join(root, "ARCHITECTURE.md"), "\nmanual drift\n", "utf8");
  } else if (name === "multiple-lockfiles") {
    await writeFile(path.join(root, "yarn.lock"), "# mutation\n", "utf8");
  } else if (name === "package-lock-drift") {
    const file = path.join(root, "package.json");
    const data = JSON.parse(await readFile(file, "utf8"));
    data.devDependencies.vite = "0.0.1";
    await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  } else if (name === "missing-composer-lock") {
    await rm(path.join(root, "composer.lock"));
  } else if (name === "composer-lock-direct-missing") {
    const file = path.join(root, "composer.lock");
    const data = JSON.parse(await readFile(file, "utf8"));
    data.packages = data.packages.filter((item) => item.name !== "symfony/routing");
    await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  } else if (name === "floating-docker-image") {
    const file = path.join(root, "Dockerfile");
    const text = await readFile(file, "utf8");
    await writeFile(file, text.replace(/^ARG PHP_IMAGE=.*$/m, "ARG PHP_IMAGE=php:latest"), "utf8");
  } else if (name === "privileged-compose") {
    await appendFile(path.join(root, "compose.yaml"), "\n# mutation\nprivileged: true\n", "utf8");
  } else if (name === "compose-name-conflict") {
    await writeFile(path.join(root, "compose.yml"), "services: {}\n", "utf8");
  } else if (name === "unpinned-action") {
    const file = path.join(root, ".github", "workflows", "quality.yml");
    const text = await readFile(file, "utf8");
    await writeFile(file, text.replace(/actions\/checkout@[a-f0-9]{40}/, "actions/checkout@v6"), "utf8");
  } else if (name === "pull-request-target") {
    const file = path.join(root, ".github", "workflows", "quality.yml");
    await appendFile(file, "\n# mutation\npull_request_target:\n", "utf8");
  } else {
    throw new Error(`Unknown scenario mutation: ${name}`);
  }
}

async function runProbe(probe) {
  if (["contains", "not-contains"].includes(probe.type)) {
    const text = await readFile(path.join(ROOT, probe.path), "utf8");
    if (probe.type === "contains") assert.ok(text.includes(probe.value), `${probe.path} must contain ${probe.value}`);
    else assert.ok(!text.includes(probe.value), `${probe.path} must not contain ${probe.value}`);
    return;
  }
  if (["json-equals", "json-includes", "json-length", "json-has"].includes(probe.type)) {
    const data = JSON.parse(await readFile(path.join(ROOT, probe.path), "utf8"));
    const actual = jsonPointer(data, probe.pointer);
    if (probe.type === "json-equals") assert.deepEqual(actual, probe.value);
    if (probe.type === "json-includes") assert.ok(actual.includes(probe.value));
    if (probe.type === "json-length") assert.equal(actual.length, probe.value);
    if (probe.type === "json-has") assert.notEqual(actual, undefined);
    return;
  }
  if (probe.type === "files-absent") {
    for (const relativePath of probe.paths) await assert.rejects(lstat(path.join(ROOT, relativePath)));
    return;
  }
  if (probe.type === "files-exact") {
    const files = (await listFiles(path.join(ROOT, probe.root)))
      .map((entry) => `${probe.root}/${entry}`)
      .filter((entry) => !path.posix.basename(entry).startsWith("_"));
    assert.deepEqual(files, probe.entries);
    return;
  }
  if (["cli-reject", "cli-accept"].includes(probe.type)) {
    const root = await copyFoundation();
    const result = runCli(root, probe.args);
    if (probe.type === "cli-reject") {
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, new RegExp(probe.error.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
    } else {
      assert.equal(result.status, 0, result.stderr);
    }
    return;
  }
  if (probe.type === "cli-output") {
    const result = runCli(ROOT, probe.args);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes(probe.value));
    return;
  }
  if (probe.type === "cli-json") {
    const result = runCli(ROOT, probe.args);
    assert.equal(result.status, 0, result.stderr);
    const actual = jsonPointer(JSON.parse(result.stdout), probe.pointer);
    assert.match(actual, new RegExp(probe.pattern));
    return;
  }
  if (probe.type === "mutation") {
    const root = await copyFoundation();
    await mutate(root, probe.name);
    const result = await validateProject(root, { strict: true, now: FIXED_NOW });
    assert.ok(result.errors.some((error) => error.includes(probe.error)), result.errors.join("\n"));
    return;
  }
  if (probe.type === "consumer-page" || probe.type === "consumer-cli-reject") {
    const root = await copyFoundation();
    await initializeConsumer(root);
    const args = probe.type === "consumer-page"
      ? ["page", "add", probe.slug, "--path", probe.path, "--title", probe.title, ...(probe.flags ?? [])]
      : probe.args;
    const result = runCli(root, args);
    if (probe.type === "consumer-cli-reject") {
      assert.notEqual(result.status, 0);
      assert.ok(result.stderr.includes(probe.error), result.stderr);
    } else {
      assert.equal(result.status, 0, result.stderr);
      for (const relativePath of probe.files ?? []) assert.equal((await lstat(path.join(root, relativePath))).isFile(), true);
      for (const relativePath of probe.absent ?? []) await assert.rejects(lstat(path.join(root, relativePath)));
      assert.equal(runCli(root, ["validate", "--strict"]).status, 0);
    }
    return;
  }
  if (probe.type === "capability-apply-reject") {
    const root = await copyFoundation();
    const planned = runCli(root, ["capability", "plan", probe.id]);
    assert.equal(planned.status, 0, planned.stderr);
    const plan = JSON.parse(planned.stdout);
    const applied = runCli(root, ["capability", "apply", probe.id, "--plan-sha", plan.planSha, "--confirm", probe.id]);
    assert.notEqual(applied.status, 0);
    assert.ok(applied.stderr.includes(probe.error), applied.stderr);
    return;
  }
  if (probe.type === "init") {
    const root = await copyFoundation();
    await initializeConsumer(root, probe.profiles, probe.owner);
    for (const relativePath of probe.present ?? []) assert.equal((await lstat(path.join(root, relativePath))).isFile(), true);
    for (const relativePath of probe.absent ?? []) await assert.rejects(lstat(path.join(root, relativePath)));
    assert.equal(runCli(root, ["validate", "--strict"]).status, 0);
    return;
  }
  if (probe.type === "deterministic-init") {
    const first = await copyFoundation();
    const second = await copyFoundation();
    await initializeConsumer(first, probe.profiles, probe.owner);
    await initializeConsumer(second, probe.profiles, probe.owner);
    assert.deepEqual(await snapshotTree(first), await snapshotTree(second));
    return;
  }
  if (probe.type === "init-conflict") {
    const root = await temporaryDirectory();
    await writeFile(path.join(root, "README.md"), "사용자 문서\n", "utf8");
    const result = runCli(root, ["init", "--profile", "typescript"], {}, ROOT);
    assert.notEqual(result.status, 0);
    assert.equal(await readFile(path.join(root, "README.md"), "utf8"), "사용자 문서\n");
    return;
  }
  if (probe.type === "path-reject") {
    assert.throws(() => resolveInside(ROOT, probe.value), FoundationError);
    return;
  }
  if (probe.type === "tar-pax-safety") {
    const archived = spawnSync("git", ["archive", "--format=tar.gz", "--prefix=fixture/", "HEAD"], {
      cwd: ROOT,
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    });
    assert.equal(archived.status, 0, archived.stderr?.toString("utf8"));
    assert.equal(parseTarGz(archived.stdout).has("package.json"), true);
    assert.throws(() => parseTarGz(createTarGz([[probe.traversal, "blocked"]])), FoundationError);
    return;
  }
  if (probe.type === "update-managed-conflict") {
    const root = await copyFoundation();
    await initializeConsumer(root, "docker,typescript,scss");
    await appendFile(path.join(root, "AGENTS.md"), "\nmanaged edit\n", "utf8");
    const result = runCli(root, ["update", "--version", "1.0.1"], {
      NODE_ENV: "test",
      FOUNDATION_RELEASE_BASE_URL: "http://127.0.0.1:1",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Managed files were modified/);
    return;
  }
  if (probe.type === "validate-pass") {
    const result = await validateProject(ROOT, { strict: true, now: FIXED_NOW });
    assert.deepEqual(result.errors, []);
    return;
  }
  if (probe.type === "validate-at") {
    const result = await validateProject(ROOT, { strict: true, now: new Date(`${probe.date}T12:00:00Z`) });
    assert.ok(result.errors.some((error) => error.includes(probe.error)));
    return;
  }
  throw new Error(`Unknown scenario probe: ${probe.type}`);
}

test.after(async () => {
  for (const directory of TEMPORARIES) await rm(directory, { recursive: true, force: true });
});

test("upstream passes strict validation", async () => {
  const result = await validateProject(ROOT, { strict: true, now: FIXED_NOW });
  assert.deepEqual(result.errors, []);
  assert.equal(result.ruleCount, 60);
  assert.equal(result.sourceCount, 55);
});

test("trusted Dependabot PRs replace narrative evidence with constrained machine evidence", () => {
  const event = {
    pull_request: {
      title: "chore(deps-dev): bump @types/node from 22.20.0 to 22.20.1",
      body: "Bumps @types/node.",
      user: { login: "dependabot[bot]", type: "Bot" },
      head: { ref: "dependabot/npm_and_yarn/types/node-22.20.1" },
    },
  };
  assert.equal(isTrustedDependabotPullRequest(event, "dependabot[bot]"), true);
  assert.deepEqual(pullRequestPolicyErrors(event, "dependabot[bot]", ["M\tpackage.json", "M\tpackage-lock.json"]), []);
});

test("a Dependabot-looking branch without the GitHub bot identity is rejected", () => {
  const event = {
    pull_request: {
      title: "chore(deps): update a package",
      body: "No evidence sections.",
      user: { login: "human-user", type: "User" },
      head: { ref: "dependabot/npm_and_yarn/spoof" },
    },
  };
  assert.equal(isTrustedDependabotPullRequest(event, "human-user"), false);
  const errors = pullRequestPolicyErrors(event, "human-user", ["M\tpackage.json"]);
  assert.ok(errors.some((error) => error.includes("Branch name does not match policy")));
  assert.ok(errors.some((error) => error.includes("Rule evidence")));
});

test("a human PR recognizes real multiline evidence sections", () => {
  const event = {
    pull_request: {
      title: "fix(deps): harden dependency policy",
      body: "## Rule evidence\n\nPF-GIT-006\n\n## New files and folders\n\nNone.\n\n## Dependency changes\n\nReviewed.",
      user: { login: "DevCrop", type: "User" },
      head: { ref: "fix/dependency-automation" },
    },
  };
  assert.deepEqual(pullRequestPolicyErrors(event, "DevCrop", ["M\tpackage.json", "M\tpackage-lock.json"]), []);
});

test("trusted Dependabot cannot add, delete, rename, or modify non-dependency paths", () => {
  assert.deepEqual(dependabotChangeErrors(["M\tpackage.json", "M\t.github/workflows/quality.yml"]), []);
  for (const record of ["A\tpackage.json", "D\tcomposer.lock", "R100\tpackage.json\tREADME.md", "M\tREADME.md"]) {
    assert.ok(dependabotChangeErrors([record]).some((error) => error.includes("forbidden path or status")), record);
  }
});

test("Node type definitions cannot exceed the minimum supported runtime major", async () => {
  const root = await copyFoundation();
  const packagePath = path.join(root, "package.json");
  const lockPath = path.join(root, "package-lock.json");
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  const packageLock = JSON.parse(await readFile(lockPath, "utf8"));
  packageJson.devDependencies["@types/node"] = "26.2.0";
  packageLock.packages[""].devDependencies["@types/node"] = "26.2.0";
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
  await writeFile(lockPath, `${JSON.stringify(packageLock, null, 2)}\n`, "utf8");
  const result = await validateProject(root, { strict: true, now: FIXED_NOW });
  assert.ok(result.errors.some((error) => error.includes("@types/node must be exact and match")));
});

test("ruleset comparison ignores GitHub response defaults and detects semantic drift", () => {
  const expected = {
    name: "main protection",
    target: "branch",
    rules: [
      {
        type: "pull_request",
        parameters: {
          allowed_merge_methods: ["squash"],
          required_approving_review_count: 0,
        },
      },
      {
        type: "required_status_checks",
        parameters: {
          required_status_checks: [{ context: "foundation-policy" }, { context: "project-quality" }],
        },
      },
    ],
  };
  const response = structuredClone(expected);
  response.rules[0].parameters.required_reviewers = [];
  response.rules[0].parameters.require_extra_approval_for_unattributed_changes = true;
  response.rules.reverse();
  assert.deepEqual(comparableRuleset(response, expected), expected);

  response.rules.find((rule) => rule.type === "required_status_checks").parameters.required_status_checks.push({ context: "unexpected" });
  assert.notDeepEqual(comparableRuleset(response, expected), expected);
});

test("doctor rejects Docker daemon connection errors even with a zero status", () => {
  assert.equal(dockerDaemonConnected({ ok: true, stdout: "28.0.4", stderr: "" }), true);
  assert.equal(dockerDaemonConnected({ ok: true, stdout: "", stderr: "error during connect: Access is denied" }), false);
  assert.equal(dockerDaemonConnected({ ok: true, stdout: "28.0.4", stderr: "permission denied" }), false);
});

test("release validation requires draft, upload, and publish ordering", async () => {
  const root = await copyFoundation();
  const workflowPath = path.join(root, ".github", "workflows", "release.yml");
  const workflow = await readFile(workflowPath, "utf8");
  await writeFile(workflowPath, workflow.replace(" --draft --verify-tag", " --draft=false --verify-tag"), "utf8");
  const result = await validateProject(root, { strict: true, now: FIXED_NOW });
  assert.ok(result.errors.some((error) => error.includes("release must be created as a draft")));

  const compatibilityRoot = await copyFoundation();
  const compatibilityPath = path.join(compatibilityRoot, ".github", "workflows", "release.yml");
  const compatibilityWorkflow = await readFile(compatibilityPath, "utf8");
  await writeFile(compatibilityPath, compatibilityWorkflow.replace("HEAD^{tree}", "HEAD"), "utf8");
  const compatibilityResult = await validateProject(compatibilityRoot, { strict: true, now: FIXED_NOW });
  assert.ok(compatibilityResult.errors.some((error) => error.includes("tree object to preserve updater compatibility")));
});

test("full PHP initialization, page generation, and asset build are deterministic", async () => {
  const first = await copyFoundation();
  const second = await copyFoundation();
  for (const root of [first, second]) {
    await initializeConsumer(root);
    const page = runCli(root, ["page", "add", "sub-1", "--path", "/sub-1", "--title", "Sub 1", "--scss", "--typescript"]);
    assert.equal(page.status, 0, page.stderr);

    const homeViewPath = path.join(root, "resource", "views", "pages", "home.php");
    const homeView = await readFile(homeViewPath, "utf8");
    await rm(homeViewPath);
    const duplicateSlug = runCli(root, ["page", "add", "home", "--path", "/new-home", "--title", "Duplicate Home"]);
    assert.notEqual(duplicateSlug.status, 0);
    assert.match(duplicateSlug.stderr, /Page already exists: home/);
    await writeFile(homeViewPath, homeView, "utf8");

    const duplicateRoute = runCli(root, ["page", "add", "another-page", "--path", "/sub-1", "--title", "Duplicate Route"]);
    assert.notEqual(duplicateRoute.status, 0);
    assert.match(duplicateRoute.stderr, /Route path already exists: \/sub-1/);
    assert.equal(runCli(root, ["validate", "--strict"]).status, 0);
  }
  assert.deepEqual(await snapshotTree(first), await snapshotTree(second));
});

test("adopt plan and apply preserve an existing README", async () => {
  const root = await temporaryDirectory();
  await writeFile(path.join(root, "README.md"), "기존 PHP 프로젝트\n", "utf8");
  const planned = runCli(root, ["adopt", "plan", "--runtime", "php", "--profile", "github,docker,typescript,scss", "--project-name", "legacy-site", "--owner", "DevCrop"], {}, ROOT);
  assert.equal(planned.status, 0, planned.stderr);
  const plan = JSON.parse(planned.stdout);
  assert.deepEqual(plan.conflicts, []);
  const applied = runCli(root, ["adopt", "apply", "--plan-sha", plan.planSha, "--confirm"], {}, ROOT);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(await readFile(path.join(root, "README.md"), "utf8"), "기존 PHP 프로젝트\n");
  assert.equal(runCli(root, ["validate", "--strict"]).status, 0);
});

test("verified same-major update changes managed files and preserves Korean project text", async () => {
  const consumer = await copyFoundation();
  await initializeConsumer(consumer, "docker,typescript,scss");
  const projectPath = path.join(consumer, "PROJECT.md");
  await appendFile(projectPath, "\n한글 프로젝트 규칙 보존\n", "utf8");
  const originalProject = await readFile(projectPath, "utf8");

  const release = await copyFoundation();
  await appendFile(path.join(release, "SECURITY.md"), "\nRelease 2.0.1 note.\n", "utf8");
  const archive = await releaseArchive(release, "2.0.1");
  const server = await serveRelease(archive, "2.0.1");
  try {
    const result = await runCliAsync(consumer, ["update", "--version", "2.0.1"], {
      NODE_ENV: "test",
      FOUNDATION_RELEASE_BASE_URL: server.url,
    });
    assert.equal(result.status, 0, result.stderr);
  } finally {
    await server.close();
  }
  assert.equal(await readFile(projectPath, "utf8"), originalProject);
  assert.match(await readFile(path.join(consumer, "SECURITY.md"), "utf8"), /Release 2\.0\.1/);
});

test("major update is refused before download and leaves the consumer unchanged", async () => {
  const consumer = await copyFoundation();
  await initializeConsumer(consumer, "docker,typescript,scss");
  const manifestPath = path.join(consumer, ".foundation", "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.foundationVersion = "1.0.2";
  manifest.schemaVersion = 2;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const before = await snapshotTree(consumer);
  const result = runCli(consumer, ["update", "--version", "2.0.0"], {
    NODE_ENV: "test",
    FOUNDATION_RELEASE_BASE_URL: "http://127.0.0.1:1",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requires an approved seed migration/);
  assert.deepEqual(await snapshotTree(consumer), before);
});

test("PHP compatibility workflow rejects a runtime outside the 8.2 toolchain", async () => {
  const root = await copyFoundation();
  const workflowPath = path.join(root, ".github", "workflows", "quality.yml");
  const workflow = await readFile(workflowPath, "utf8");
  await writeFile(workflowPath, workflow.replace('- php: "8.2.33"', '- php: "8.5.8"'), "utf8");
  const result = await validateProject(root, { strict: true, now: FIXED_NOW });
  assert.ok(result.errors.some((error) => error.includes("PHP compatibility matrix must exactly match")));
});

test("Composer dependency stages reject the unpinned Composer runtime", async () => {
  const root = await copyFoundation();
  const dockerfilePath = path.join(root, "Dockerfile");
  const dockerfile = await readFile(dockerfilePath, "utf8");
  await writeFile(dockerfilePath, dockerfile.replace("FROM php-tooling AS php-dependencies", "FROM composer-bin AS php-dependencies"), "utf8");
  const result = await validateProject(root, { strict: true, now: FIXED_NOW });
  assert.ok(result.errors.some((error) => error.includes("pinned PHP tooling stage")));
});

test("Codex hooks load context, block destructive commands, and stop once", async () => {
  const destructive = runCli(ROOT, ["agent", "hook", "pre-tool-use"], {}, ROOT, JSON.stringify({
    tool_name: "Bash",
    tool_input: { command: "git reset --hard" },
  }));
  assert.equal(destructive.status, 0, destructive.stderr);
  assert.equal(JSON.parse(destructive.stdout).hookSpecificOutput.permissionDecision, "deny");

  const root = await copyFoundation();
  await initializeConsumer(root, "core");
  assert.equal(spawnSync("git", ["init"], { cwd: root, encoding: "utf8", windowsHide: true }).status, 0);
  await appendFile(path.join(root, "AGENTS.md"), "\ninvalid managed edit\n", "utf8");
  const first = runCli(root, ["agent", "hook", "stop"], {}, root, '{"stop_hook_active":false}');
  const second = runCli(root, ["agent", "hook", "stop"], {}, root, '{"stop_hook_active":true}');
  assert.equal(JSON.parse(first.stdout).decision, "block");
  assert.equal(JSON.parse(second.stdout).continue, false);
});

test("all declared managed files exist as regular files", async () => {
  for (const relativePath of MANAGED_PATHS) {
    const information = await lstat(path.join(ROOT, relativePath));
    assert.equal(information.isFile(), true, relativePath);
  }
});

test("exactly 120 canonical scenarios execute across twelve groups", async (context) => {
  const catalog = JSON.parse(await readFile(path.join(ROOT, ".foundation", "scenarios.json"), "utf8"));
  const scenarios = catalog.groups.flatMap((group) => group.cases.map((scenario) => ({ ...scenario, group: group.id })));
  assert.equal(catalog.groups.length, 12);
  assert.ok(catalog.groups.every((group) => group.cases.length === 10));
  assert.equal(scenarios.length, 120);
  for (const scenario of scenarios) {
    await context.test(`${scenario.id} [${scenario.group}] ${scenario.title}`, async () => {
      await runProbe(scenario.probe);
    });
  }
});
