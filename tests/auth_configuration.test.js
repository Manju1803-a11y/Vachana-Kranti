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

  test("TEST 6: Expired or invalid session requires user to authenticate again", async () => {
    const srv = await startTestServer({
      ADMIN_EMAIL: "admin@epaperhub.test",
      ADMIN_PASSWORD: "CorrectPassword123"
    });

    try {
      const fakeCookie = "vk_admin_session=deadbeefdeadbeefdeadbeefdeadbeef";

      const sessionRes = await fetch(`${srv.baseUrl}/api/auth/session`, {
        headers: { Cookie: fakeCookie }
      });
      assert.equal(sessionRes.status, 200);
      const sessionData = await sessionRes.json();
      assert.equal(sessionData.authenticated, false);

      const apiRes = await fetch(`${srv.baseUrl}/api/issues`, {
        headers: { Cookie: fakeCookie }
      });
      assert.equal(apiRes.status, 401);
      const apiData = await apiRes.json();
      assert.equal(apiData.error, "Session expired or missing. Please sign in.");
    } finally {
      await stopTestServer(srv.child);
    }
  });

  test("TEST 7: Unauthorized access to administrator APIs returns HTTP 401 / redirect", async () => {
    const srv = await startTestServer({
      ADMIN_EMAIL: "admin@epaperhub.test",
      ADMIN_PASSWORD: "CorrectPassword123"
    });

    try {
      // API call without session
      const issuesRes = await fetch(`${srv.baseUrl}/api/issues`);
      assert.equal(issuesRes.status, 401);

      const bootstrapRes = await fetch(`${srv.baseUrl}/api/bootstrap`);
      assert.equal(bootstrapRes.status, 401);

      // Web page access redirects to /login
      const adminPageRes = await fetch(`${srv.baseUrl}/admin`, { redirect: "manual" });
      assert.equal(adminPageRes.status, 302);
      assert.equal(adminPageRes.headers.get("location"), "/login");
    } finally {
      await stopTestServer(srv.child);
    }
  });

  test("TEST 8: Successful administrator logout invalidates session", async () => {
    const validEmail = "admin@epaperhub.test";
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

});
