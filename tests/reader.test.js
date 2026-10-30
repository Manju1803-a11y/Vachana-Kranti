const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const crypto = require("node:crypto");
const { after, before, test } = require("node:test");

const root = path.resolve(__dirname, "..");
const issuesDirectory = path.join(root, "data", "issues");
const createdIssueDirectories = [];
const editorEmail = "reader-test@example.invalid";
const editorPassword = crypto.randomBytes(24).toString("hex");
let serverProcess;
let serverBaseUrl;
let publishedFixture;
let draftFixture;

async function unusedPort() {
  const listener = http.createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const { port } = listener.address();
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  return port;
}

function createIssue(status) {
  let id;
  let directory;
  do {
    id = crypto.randomBytes(6).toString("hex");
    directory = path.join(issuesDirectory, id);
  } while (fs.existsSync(directory));

  fs.mkdirSync(directory, { recursive: false });
  createdIssueDirectories.push(directory);
  const image = Buffer.from("R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=", "base64");
  fs.writeFileSync(path.join(directory, "01.gif"), image);
  fs.writeFileSync(path.join(directory, "issue.json"), JSON.stringify({
    name: `Reader test ${status}`,
    date: new Date().toISOString().slice(0, 10),
    category: "Main Edition",
    status,
    views: 0,
    viewsByMonth: {},
    files: [{ name: "test.gif", path: "01.gif", type: "image/gif", size: image.length }],
    createdAt: new Date().toISOString()
  }, null, 2));
  return { id, image };
}

async function startServer(overrides = {}) {
  const port = await unusedPort();
  const env = { ...process.env, HOST: "127.0.0.1", PORT: String(port), ...overrides };
  if (!Object.hasOwn(overrides, "DATABASE_URL")) delete env.DATABASE_URL;
  const child = spawn(process.execPath, [path.join(root, "server.js")], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let logs = "";
  child.stdout.on("data", (chunk) => { logs += chunk.toString(); });
  child.stderr.on("data", (chunk) => { logs += chunk.toString(); });
  const baseUrl = `http://127.0.0.1:${port}`;

  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Test server exited unexpectedly:\n${logs}`);
    try {
      await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(500) });
      return { child, baseUrl, getLogs: () => logs };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  child.kill();
  throw new Error(`Test server did not start:\n${logs}`);
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await Promise.race([
    once(child, "exit"),
    new Promise((resolve) => setTimeout(resolve, 3000))
  ]);
}

before(async () => {
  fs.mkdirSync(issuesDirectory, { recursive: true });
  publishedFixture = createIssue("public");
  draftFixture = createIssue("draft");
  const started = await startServer({
    ADMIN_EMAIL: editorEmail,
    ADMIN_PASSWORD: editorPassword
  });
  serverProcess = started.child;
  serverBaseUrl = started.baseUrl;
});

after(async () => {
  await stopServer(serverProcess);
  for (const directory of createdIssueDirectories) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("public edition loading and error regressions", async (t) => {
  await t.test("local health check reports the active development storage", async () => {
    const response = await fetch(`${serverBaseUrl}/api/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok", db: "local-file" });
  });

  await t.test("published issue loads, refreshes, and serves its asset", async () => {
    const { id, image } = publishedFixture;
    const response = await fetch(`${serverBaseUrl}/api/reader/${id}`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.issue.id, id);
    assert.equal(payload.issue.url, `${serverBaseUrl}/paper/${id}`);

    const direct = await fetch(`${serverBaseUrl}/paper/${id}`);
    assert.equal(direct.status, 200);
    assert.match(await direct.text(), /id="reader-status"/);

    const refreshed = await fetch(`${serverBaseUrl}/api/reader/${id}`);
    assert.equal(refreshed.status, 200);

    const media = await fetch(`${serverBaseUrl}/media/${id}/01.gif`);
    assert.equal(media.status, 200);
    assert.match(media.headers.get("content-type"), /image\/gif/);
    assert.deepEqual(Buffer.from(await media.arrayBuffer()), image);
  });

  await t.test("reported 13-character ID is not truncated to another edition", async () => {
    const malformedId = `e${publishedFixture.id}`;
    assert.equal(malformedId.length, 13);
    const response = await fetch(`${serverBaseUrl}/api/reader/${malformedId}`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "This edition is unavailable." });

    const page = await fetch(`${serverBaseUrl}/paper/${malformedId}`);
    assert.equal(page.status, 404);
    assert.match(await page.text(), /id="reader-status"/);
  });

  await t.test("unknown and malformed IDs return a reader shell with 404", async () => {
    const missing = await fetch(`${serverBaseUrl}/api/reader/not-an-edition`);
    assert.equal(missing.status, 404);

    const malformedPage = await fetch(`${serverBaseUrl}/paper/invalid!id`);
    assert.equal(malformedPage.status, 404);
    assert.match(await malformedPage.text(), /id="reader-status"/);
  });

  await t.test("public readers cannot access management APIs", async () => {
    const response = await fetch(`${serverBaseUrl}/api/issues`);
    assert.equal(response.status, 401);
  });

  await t.test("unpublished edition stays private until an editor publishes it", async () => {
    const { id } = draftFixture;
    const beforePublish = await fetch(`${serverBaseUrl}/api/reader/${id}`);
    assert.equal(beforePublish.status, 404);
    const privatePage = await fetch(`${serverBaseUrl}/paper/${id}`);
    assert.equal(privatePage.status, 404);
    assert.match(await privatePage.text(), /id="reader-status"/);

    const login = await fetch(`${serverBaseUrl}/api/auth/login`, {
      method: "POST",
      headers: { Origin: serverBaseUrl, "Content-Type": "application/json" },
      body: JSON.stringify({ email: editorEmail, password: editorPassword })
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie").split(";", 1)[0];
    const publish = await fetch(`${serverBaseUrl}/api/issues/${id}`, {
      method: "PUT",
      headers: { Origin: serverBaseUrl, Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ status: "public" })
    });
    assert.equal(publish.status, 200);
    assert.equal((await (await fetch(`${serverBaseUrl}/api/reader/${id}`)).json()).issue.id, id);
  });
});

test("configured database outage is reported as 503, not 404", async () => {
  const unavailable = await startServer({
    DATABASE_URL: "postgresql://test:test@127.0.0.1:1/test?connect_timeout=1"
  });
  try {
    const health = await fetch(`${unavailable.baseUrl}/api/health`);
    assert.equal(health.status, 503);
    assert.deepEqual(await health.json(), { status: "error", db: "unavailable" });

    const response = await fetch(`${unavailable.baseUrl}/api/reader/123456abcdef`);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("x-error-id")?.length, 12);
    assert.match((await response.json()).error, /storage is temporarily unavailable/i);

    const page = await fetch(`${unavailable.baseUrl}/paper/123456abcdef`);
    assert.equal(page.status, 503);
    assert.match(page.headers.get("x-error-id"), /^[a-f0-9]{12}$/);
    assert.match(await page.text(), /id="reader-status"/);
  } finally {
    await stopServer(unavailable.child);
  }
});

test("production without DATABASE_URL reports unhealthy storage", async () => {
  const unavailable = await startServer({
    DATABASE_URL: "",
    NODE_ENV: "production"
  });
  try {
    const health = await fetch(`${unavailable.baseUrl}/api/health`);
    assert.equal(health.status, 503);
    assert.deepEqual(await health.json(), { status: "error", db: "unavailable" });

    const edition = await fetch(`${unavailable.baseUrl}/api/reader/123456abcdef`);
    assert.equal(edition.status, 503);
  } finally {
    await stopServer(unavailable.child);
  }
});
