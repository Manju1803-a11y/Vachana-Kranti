const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { test, describe } = require("node:test");

const root = path.resolve(__dirname, "..");

async function getFreePort() {
  const srv = http.createServer();
  srv.listen(0, "127.0.0.1");
  await once(srv, "listening");
  const { port } = srv.address();
  await new Promise(r => srv.close(r));
  return port;
}

async function startTestServer(envOverrides = {}) {
  const port = await getFreePort();
  const env = {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    ...envOverrides
  };
  // Ensure DATABASE_URL is not set unless requested so server runs in local storage mode
  if (!Object.hasOwn(envOverrides, "DATABASE_URL")) delete env.DATABASE_URL;

  const child = spawn(process.execPath, [path.join(root, "server.js")], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });

  let logs = "";
  child.stdout.on("data", chunk => { logs += chunk.toString(); });
  child.stderr.on("data", chunk => { logs += chunk.toString(); });

  const baseUrl = `http://127.0.0.1:${port}`;

  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null) {
      throw new Error(`Test server crashed:\n${logs}`);
    }
    try {
      const res = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(500) });
      if (res.ok || res.status === 200 || res.status === 503) {
        return { child, baseUrl, logs: () => logs };
      }
    } catch {
      await new Promise(r => setTimeout(r, 50));
    }
  }
  child.kill();
  throw new Error(`Test server failed to respond on port ${port}:\n${logs}`);
}

async function stopTestServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await Promise.race([
    once(child, "exit"),
    new Promise(r => setTimeout(r, 2000))
  ]);
}

describe("ADMINISTRATOR AUTHENTICATION SUITE", () => {

  test("TEST 1: Missing ADMIN_EMAIL returns configuration error with no credentials exposed", async () => {
    const srv = await startTestServer({
      ADMIN_EMAIL: "",
      ADMIN_PASSWORD: "SuperSecretPassword123"
    });

    try {
      // 1. Session check reports unconfigured
      const sessionRes = await fetch(`${srv.baseUrl}/api/auth/session`);
      assert.equal(sessionRes.status, 200);
      const sessionData = await sessionRes.json();
      assert.equal(sessionData.configured, false);
      assert.equal(sessionData.authenticated, false);
      assert.equal(JSON.stringify(sessionData).includes("SuperSecretPassword123"), false);

      // 2. Login attempt returns HTTP 503
      const loginRes = await fetch(`${srv.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { Origin: srv.baseUrl, "Content-Type": "application/json" },
        body: JSON.stringify({ email: "admin@example.com", password: "SuperSecretPassword123" })
      });
      assert.equal(loginRes.status, 503);
      const loginData = await loginRes.json();
      assert.equal(loginData.error, "Admin credentials not configured.");
      assert.equal(JSON.stringify(loginData).includes("SuperSecretPassword123"), false);
    } finally {
      await stopTestServer(srv.child);
    }
  });

  test("TEST 2: Missing ADMIN_PASSWORD returns configuration error", async () => {
    const srv = await startTestServer({
      ADMIN_EMAIL: "configured-admin@example.com",
      ADMIN_PASSWORD: ""
    });

    try {
      const sessionRes = await fetch(`${srv.baseUrl}/api/auth/session`);
      assert.equal(sessionRes.status, 200);
      const sessionData = await sessionRes.json();
      assert.equal(sessionData.configured, false);
      assert.equal(sessionData.authenticated, false);

      const loginRes = await fetch(`${srv.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { Origin: srv.baseUrl, "Content-Type": "application/json" },
        body: JSON.stringify({ email: "configured-admin@example.com", password: "AnyPassword" })
      });
      assert.equal(loginRes.status, 503);
      const loginData = await loginRes.json();
      assert.equal(loginData.error, "Admin credentials not configured.");
    } finally {
      await stopTestServer(srv.child);
    }
  });

  test("TEST 3: Valid email and valid password succeeds with HttpOnly secure session cookie", async () => {
    const validEmail = "master.admin@epaperhub.test";
    const validPassword = "CorrectHorseBatteryStaple!2026";
    const srv = await startTestServer({
      ADMIN_EMAIL: validEmail,
      ADMIN_PASSWORD: validPassword
    });

    try {
      // 1. Session endpoint reports configured
      const sessionRes = await fetch(`${srv.baseUrl}/api/auth/session`);
      assert.equal(sessionRes.status, 200);
      const sessionData = await sessionRes.json();
      assert.equal(sessionData.configured, true);
      assert.equal(sessionData.authenticated, false);

      // 2. Successful login
      const loginRes = await fetch(`${srv.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { Origin: srv.baseUrl, "Content-Type": "application/json" },
        body: JSON.stringify({ email: validEmail, password: validPassword, remember: true })
      });
      assert.equal(loginRes.status, 200);
      const loginData = await loginRes.json();
      assert.equal(loginData.authenticated, true);

      // 3. Verify cookie attributes
      const setCookie = loginRes.headers.get("set-cookie");
      assert.ok(setCookie, "Set-Cookie header must be present");
      assert.ok(setCookie.includes("vk_admin_session="), "Cookie name must match vk_admin_session");
      assert.ok(setCookie.includes("HttpOnly"), "Cookie must be HttpOnly");
      assert.ok(setCookie.includes("SameSite=Lax"), "Cookie must have SameSite=Lax");
    } finally {
      await stopTestServer(srv.child);
    }
  });

  test("TEST 4: Incorrect email rejects authentication with HTTP 401", async () => {
    const srv = await startTestServer({
      ADMIN_EMAIL: "admin@epaperhub.test",
      ADMIN_PASSWORD: "CorrectPassword123"
    });

    try {
      const loginRes = await fetch(`${srv.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { Origin: srv.baseUrl, "Content-Type": "application/json" },
        body: JSON.stringify({ email: "wrong-user@epaperhub.test", password: "CorrectPassword123" })
      });
      assert.equal(loginRes.status, 401);
      const data = await loginRes.json();
      assert.equal(data.error, "Invalid email or password.");
    } finally {
      await stopTestServer(srv.child);
    }
  });

  test("TEST 5: Incorrect password rejects authentication with HTTP 401", async () => {
    const srv = await startTestServer({
      ADMIN_EMAIL: "admin@epaperhub.test",
      ADMIN_PASSWORD: "CorrectPassword123"
    });

    try {
      const loginRes = await fetch(`${srv.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { Origin: srv.baseUrl, "Content-Type": "application/json" },
        body: JSON.stringify({ email: "admin@epaperhub.test", password: "IncorrectPassword999" })
      });
      assert.equal(loginRes.status, 401);
      const data = await loginRes.json();
      assert.equal(data.error, "Invalid email or password.");
    } finally {
      await stopTestServer(srv.child);
    }
  });

  test("TEST 6: Valid login followed by dashboard access reports authorized access", async () => {
    const validEmail = "admin@epaperhub.com";
    const validPassword = "NewSecretPassword2026!";
    const srv = await startTestServer({
      ADMIN_EMAIL: validEmail,
      ADMIN_PASSWORD: validPassword
    });

    try {
      // 1. Authenticate
      const loginRes = await fetch(`${srv.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { Origin: srv.baseUrl, "Content-Type": "application/json" },
        body: JSON.stringify({ email: validEmail, password: validPassword })
      });
      assert.equal(loginRes.status, 200);
      const cookieHeader = loginRes.headers.get("set-cookie").split(";")[0];

      // 2. Access dashboard stats API
      const dashboardRes = await fetch(`${srv.baseUrl}/api/dashboard`, {
        headers: { Cookie: cookieHeader }
      });
      assert.equal(dashboardRes.status, 200);
      const stats = await dashboardRes.json();
      assert.ok(typeof stats.totalEditions === "number");
      assert.ok(typeof stats.storage === "object");

      // 3. Access bootstrap API
      const bootstrapRes = await fetch(`${srv.baseUrl}/api/bootstrap`, {
        headers: { Cookie: cookieHeader }
      });
      assert.equal(bootstrapRes.status, 200);
      const bootstrap = await bootstrapRes.json();
      assert.ok(Array.isArray(bootstrap.issues));
      assert.ok(Array.isArray(bootstrap.categories));
    } finally {
      await stopTestServer(srv.child);
    }
  });

  test("TEST 7: Unauthorized admin API access returns HTTP 401 or 403", async () => {
    const srv = await startTestServer({
      ADMIN_EMAIL: "admin@epaperhub.com",
      ADMIN_PASSWORD: "CorrectPassword123"
    });

    try {
      // API call without session
      const issuesRes = await fetch(`${srv.baseUrl}/api/issues`);
      assert.equal(issuesRes.status, 401);

      const bootstrapRes = await fetch(`${srv.baseUrl}/api/bootstrap`);
      assert.equal(bootstrapRes.status, 401);

      const dashboardRes = await fetch(`${srv.baseUrl}/api/dashboard`);
      assert.equal(dashboardRes.status, 401);

      // Web page access redirects to /login
      const adminPageRes = await fetch(`${srv.baseUrl}/admin`, { redirect: "manual" });
      assert.equal(adminPageRes.status, 302);
      assert.equal(adminPageRes.headers.get("location"), "/login");
    } finally {
      await stopTestServer(srv.child);
    }
  });

  test("TEST 8: Logout invalidates administrator session", async () => {
    const validEmail = "admin@epaperhub.com";
    const validPassword = "CorrectPassword123";
    const srv = await startTestServer({
      ADMIN_EMAIL: validEmail,
      ADMIN_PASSWORD: validPassword
    });

    try {
      // 1. Log in
      const loginRes = await fetch(`${srv.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { Origin: srv.baseUrl, "Content-Type": "application/json" },
        body: JSON.stringify({ email: validEmail, password: validPassword })
      });
      assert.equal(loginRes.status, 200);
      const cookieHeader = loginRes.headers.get("set-cookie").split(";")[0];

      // 2. Verify authenticated session can access admin API
      const checkRes = await fetch(`${srv.baseUrl}/api/issues`, {
        headers: { Cookie: cookieHeader }
      });
      assert.equal(checkRes.status, 200);

      // 3. Log out
      const logoutRes = await fetch(`${srv.baseUrl}/api/auth/logout`, {
        method: "POST",
        headers: { Origin: srv.baseUrl, Cookie: cookieHeader }
      });
      assert.equal(logoutRes.status, 200);
      const logoutData = await logoutRes.json();
      assert.equal(logoutData.authenticated, false);

      const logoutCookie = logoutRes.headers.get("set-cookie");
      assert.ok(logoutCookie.includes("Max-Age=0"), "Logout must expire the cookie");

      // 4. Subsequent access with old cookie is rejected with 401
      const afterLogoutRes = await fetch(`${srv.baseUrl}/api/issues`, {
        headers: { Cookie: cookieHeader }
      });
      assert.equal(afterLogoutRes.status, 401);
    } finally {
      await stopTestServer(srv.child);
    }
  });

  test("TEST 9: PostgreSQL connection succeeds when valid database is provided", async () => {
    const { checkDatabaseConnection, retryDatabaseConnection } = require("../database");
    let queryCount = 0;
    const mockPool = {
      async query(sql) {
        queryCount += 1;
        assert.equal(sql, "SELECT 1");
        return { rows: [{ "?column?": 1 }] };
      }
    };
    await checkDatabaseConnection(mockPool);
    await retryDatabaseConnection(mockPool, { attempts: 2 });
    assert.equal(queryCount, 2);
  });

  test("TEST 10: Database unavailable handles storage failure safely without corrupting data", async () => {
    const srv = await startTestServer({
      DATABASE_URL: "postgresql://nonexistent_user:fake_pw@127.0.0.1:1/nonexistent?connect_timeout=1"
    });

    try {
      const healthRes = await fetch(`${srv.baseUrl}/api/health`);
      assert.equal(healthRes.status, 503);
      const healthData = await healthRes.json();
      assert.equal(healthData.status, "error");
      assert.equal(healthData.db, "unavailable");

      // Attempting to read a nonexistent issue during DB outage returns clean 503 with error ID
      const readerRes = await fetch(`${srv.baseUrl}/api/reader/deadbeef1234`);
      assert.equal(readerRes.status, 503);
      const readerData = await readerRes.json();
      assert.match(readerData.error, /storage is temporarily unavailable/i);
    } finally {
      await stopTestServer(srv.child);
    }
  });

  test("TEST 11: Production environment loads Render credentials accurately and succeeds", async () => {
    const renderAdminEmail = "admin@epaperhub.com";
    const renderAdminPassword = "SecureRenderSecret!2026";
    const srv = await startTestServer({
      NODE_ENV: "production",
      ADMIN_EMAIL: renderAdminEmail,
      ADMIN_PASSWORD: renderAdminPassword
    });

    try {
      // 1. Session reports configured
      const sessionRes = await fetch(`${srv.baseUrl}/api/auth/session`);
      assert.equal(sessionRes.status, 200);
      const sessionData = await sessionRes.json();
      assert.equal(sessionData.configured, true);
      assert.equal(sessionData.authenticated, false);

      // 2. Production login succeeds
      const loginRes = await fetch(`${srv.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { Origin: srv.baseUrl, "Content-Type": "application/json" },
        body: JSON.stringify({ email: renderAdminEmail, password: renderAdminPassword })
      });
      assert.equal(loginRes.status, 200);
      const loginData = await loginRes.json();
      assert.equal(loginData.authenticated, true);
    } finally {
      await stopTestServer(srv.child);
    }
  });

});
