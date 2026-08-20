import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  appendFile,
  cp,
  lstat,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  FoundationError,
  MANAGED_PATHS,
  parseTarGz,
  refreshManifest,
  resolveInside,
  validateProject,
} from "./foundation.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMPORARIES = new Set();

async function temporaryDirectory(prefix = "project-foundation-test-") {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  TEMPORARIES.add(directory);
  return directory;
}

async function copyFoundation() {
  const target = await temporaryDirectory();
  await cp(ROOT, target, {
    recursive: true,
    filter: (source) => ![".git", "node_modules", "dist", ".release"].includes(path.basename(source)),
  });
  return target;
}

function runCli(root, args, environment = {}, scriptRoot = root) {
  return spawnSync(process.execPath, [path.join(scriptRoot, "scripts", "foundation.mjs"), ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...environment },
    timeout: 30_000,
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

function runNpm(root, args) {
  return spawnSync("npm", args, {
    cwd: root,
    encoding: "utf8",
    timeout: 30_000,
    windowsHide: true,
    shell: process.platform === "win32",
  });
}

async function listFiles(root, current = "") {
  const entries = await import("node:fs/promises").then(({ readdir }) => readdir(path.join(root, current), { withFileTypes: true }));
  const files = [];
  for (const entry of entries) {
    if ([".git", "node_modules", "dist"].includes(entry.name)) continue;
    const relative = path.join(current, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(root, relative)));
    else files.push(relative.split(path.sep).join("/"));
  }
  return files.sort();
}

async function snapshotTree(root) {
  const snapshot = {};
  for (const relativePath of await listFiles(root)) snapshot[relativePath] = createHash("sha256").update(await readFile(path.join(root, relativePath))).digest("hex");
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

test.after(async () => {
  for (const directory of TEMPORARIES) await rm(directory, { recursive: true, force: true });
});

test("upstream passes strict validation", async () => {
  const result = await validateProject(ROOT, { strict: true, now: new Date("2026-08-21T12:00:00Z") });
  assert.deepEqual(result.errors, []);
  assert.ok(result.ruleCount >= 30);
  assert.ok(result.sourceCount >= 20);
});

test("typescript, scss, and docker initialization is deterministic", async () => {
  const first = await copyFoundation();
  const second = await copyFoundation();
  for (const root of [first, second]) {
    const result = runCli(root, ["init", "--profile", "typescript,scss,docker", "--project-name", "sample-app"]);
    assert.equal(result.status, 0, result.stderr);
  }
  assert.deepEqual(await snapshotTree(first), await snapshotTree(second));
  const manifest = JSON.parse(await readFile(path.join(first, ".foundation", "manifest.json"), "utf8"));
  assert.equal(manifest.mode, "consumer");
  assert.deepEqual(manifest.activeProfiles, ["core", "typescript", "scss", "docker"]);
  assert.equal(await readFile(path.join(first, "PROJECT.md"), "utf8").then((text) => text.includes("sample-app")), true);
  const install = runNpm(first, ["ci", "--ignore-scripts"]);
  assert.equal(install.status, 0, install.stderr);
  assert.equal(runNpm(first, ["run", "build"]).status, 0);
  assert.equal(runNpm(first, ["run", "styles:build"]).status, 0);
  assert.equal(runCli(first, ["validate", "--strict"]).status, 0);
});

test("core initialization removes optional and upstream-only files", async () => {
  const root = await copyFoundation();
  const result = runCli(root, ["init", "--profile", "core", "--project-name", "core-only"]);
  assert.equal(result.status, 0, result.stderr);
  for (const relativePath of ["Dockerfile", "compose.yaml", "Makefile", "tsconfig.json", "src/main.ts", "styles/main.scss", "CHANGELOG.md", "CONTRIBUTING.md", "scripts/foundation.test.mjs", ".github/workflows/release.yml"]) {
    await assert.rejects(lstat(path.join(root, relativePath)));
  }
  const validation = await validateProject(root, { strict: false, now: new Date("2026-08-21T12:00:00Z") });
  assert.deepEqual(validation.errors, []);
  const install = runNpm(root, ["ci", "--ignore-scripts"]);
  assert.equal(install.status, 0, install.stderr);
  assert.equal(runNpm(root, ["test"]).status, 0);
});

test("initialization refuses unrelated existing files and preserves them", async () => {
  const root = await temporaryDirectory();
  await writeFile(path.join(root, "README.md"), "사용자 문서\n", "utf8");
  const result = runCli(root, ["init", "--profile", "typescript"], {}, ROOT);
  assert.notEqual(result.status, 0);
  assert.equal(await readFile(path.join(root, "README.md"), "utf8"), "사용자 문서\n");
});

test("duplicate rules and sources are rejected", async () => {
  const root = await copyFoundation();
  const foundationPath = path.join(root, "FOUNDATION.md");
  await appendFile(foundationPath, "\n### PF-CORE-001 — duplicate\n\n- Level: MUST\n- Profiles: core\n- Authority: policy:project-foundation\n- Exception: no\n- Rule: 이 본문은 중복 ID 검사를 위한 테스트 규칙이다.\n", "utf8");
  const sourcesPath = path.join(root, "SOURCES.json");
  const sources = JSON.parse(await readFile(sourcesPath, "utf8"));
  sources.sources.push({ ...sources.sources[0] });
  await writeFile(sourcesPath, `${JSON.stringify(sources, null, 2)}\n`, "utf8");
  const result = await validateProject(root, { strict: false, now: new Date("2026-08-21T12:00:00Z") });
  assert.ok(result.errors.some((error) => error.includes("Duplicate rule ID")));
  assert.ok(result.errors.some((error) => error.includes("Duplicate or missing source ID")));
});

test("expired official sources and project exceptions fail strict validation", async () => {
  const root = await copyFoundation();
  await appendFile(path.join(root, "PROJECT.md"), "\n### PF-GIT-001\n- Reason: temporary test\n- Owner: tester\n- Review by: 2026-01-01\n- Compensating control: protected test branch\n", "utf8");
  const result = await validateProject(root, { strict: true, now: new Date("2026-10-01T12:00:00Z") });
  assert.ok(result.errors.some((error) => error.includes("source verification")));
  assert.ok(result.errors.some((error) => error.includes("exception expired")));
});

test("unsafe paths and tar traversal are rejected", () => {
  assert.throws(() => resolveInside(ROOT, "../outside"), FoundationError);
  assert.throws(() => resolveInside(ROOT, path.resolve(ROOT, "absolute")), FoundationError);
  const archive = createTarGz([["../escape.txt", "no"]]);
  assert.throws(() => parseTarGz(archive), FoundationError);
});

test("managed symlinks are rejected when supported", async (context) => {
  const root = await copyFoundation();
  const target = path.join(root, "FOUNDATION.md");
  await rm(target);
  try {
    await symlink(path.join(root, "README.md"), target);
  } catch (error) {
    if (["EPERM", "EACCES"].includes(error.code)) {
      context.skip("Symlink creation is unavailable on this Windows configuration.");
      return;
    }
    throw error;
  }
  const result = await validateProject(root, { strict: false, now: new Date("2026-08-21T12:00:00Z") });
  assert.ok(result.errors.some((error) => error.includes("symbolic link")));
});

test("modified managed files abort update before any download", async () => {
  const root = await copyFoundation();
  assert.equal(runCli(root, ["init", "--profile", "typescript,scss,docker", "--project-name", "managed-change"]).status, 0);
  await appendFile(path.join(root, "AGENTS.md"), "\nlocal edit\n", "utf8");
  const result = runCli(root, ["update", "--version", "1.0.1"], {
    NODE_ENV: "test",
    FOUNDATION_RELEASE_BASE_URL: "http://127.0.0.1:1",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Managed files were modified/);
});

test("verified update changes only managed files and preserves Korean project text", async () => {
  const consumer = await copyFoundation();
  assert.equal(runCli(consumer, ["init", "--profile", "typescript,scss,docker", "--project-name", "update-test"]).status, 0);
  const projectPath = path.join(consumer, "PROJECT.md");
  await appendFile(projectPath, "\n한글 프로젝트 규칙 보존\n", "utf8");
  const originalProject = await readFile(projectPath, "utf8");

  const release = await copyFoundation();
  await appendFile(path.join(release, "SECURITY.md"), "\nRelease 1.0.1 security note.\n", "utf8");
  const archive = await releaseArchive(release, "1.0.1");
  const server = await serveRelease(archive, "1.0.1");
  try {
    const result = await runCliAsync(consumer, ["update", "--version", "1.0.1"], {
      NODE_ENV: "test",
      FOUNDATION_RELEASE_BASE_URL: server.url,
    });
    assert.equal(result.status, 0, result.stderr);
  } finally {
    await server.close();
  }
  assert.equal(await readFile(projectPath, "utf8"), originalProject);
  assert.match(await readFile(path.join(consumer, "SECURITY.md"), "utf8"), /Release 1\.0\.1/);
  const manifest = JSON.parse(await readFile(path.join(consumer, ".foundation", "manifest.json"), "utf8"));
  assert.equal(manifest.foundationVersion, "1.0.1");
});

test("bad release checksum leaves the project unchanged", async () => {
  const consumer = await copyFoundation();
  assert.equal(runCli(consumer, ["init", "--profile", "typescript,scss,docker", "--project-name", "checksum-test"]).status, 0);
  const before = await snapshotTree(consumer);
  const archive = createTarGz([["project-foundation/.foundation/manifest.json", "{}"]]);
  const server = createServer((request, response) => {
    response.writeHead(200);
    response.end(request.url?.endsWith(".sha256") ? `${"0".repeat(64)}  invalid.tar.gz\n` : archive);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    const result = await runCliAsync(consumer, ["update", "--version", "1.0.2"], {
      NODE_ENV: "test",
      FOUNDATION_RELEASE_BASE_URL: `http://127.0.0.1:${address.port}`,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /checksum mismatch/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  assert.deepEqual(await snapshotTree(consumer), before);
});

test("Docker and package-manager policy violations are detected", async () => {
  const root = await copyFoundation();
  await writeFile(path.join(root, "compose.yml"), "services: {}\n", "utf8");
  await writeFile(path.join(root, "yarn.lock"), "# test\n", "utf8");
  await writeFile(path.join(root, "Dockerfile"), "ARG NODE_IMAGE=node:latest\nFROM ${NODE_IMAGE}\n", "utf8");
  const result = await validateProject(root, { strict: false, now: new Date("2026-08-21T12:00:00Z") });
  assert.ok(result.errors.some((error) => error.includes("compose.yml conflicts")));
  assert.ok(result.errors.some((error) => error.includes("Multiple package-manager lockfiles")));
  assert.ok(result.errors.some((error) => error.includes("version tag and SHA-256")));
});

test("GitHub apply requires exact repository and explicit confirmation", () => {
  const wrongRepo = runCli(ROOT, ["github", "apply", "--repo", "someone/example", "--confirm"]);
  assert.notEqual(wrongRepo.status, 0);
  assert.match(wrongRepo.stderr, /restricted/);
  const missingConfirm = runCli(ROOT, ["github", "apply", "--repo", "DevCrop/project-foundation"]);
  assert.notEqual(missingConfirm.status, 0);
  assert.match(missingConfirm.stderr, /requires --confirm/);
});

test("all declared managed files exist and use regular files", async () => {
  for (const relativePath of MANAGED_PATHS) {
    const information = await lstat(path.join(ROOT, relativePath));
    assert.equal(information.isFile(), true, relativePath);
  }
});
