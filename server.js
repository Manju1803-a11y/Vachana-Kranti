// server.js – Vachana Kranti e‑paper platform (Render‑ready version)
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { Pool } = require("pg");

// ── Configuration ───────────────────────────────────────────────────────
const PORT = Number(process.env.PORT) || 3000; // Render supplies PORT
const HOST = process.env.HOST || "0.0.0.0";   // Bind to all interfaces
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const MAX_REQUEST_BYTES = 70 * 1024 * 1024;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const STORAGE_LIMIT_BYTES = 10 * 1024 * 1024 * 1024;
const ADMIN_SESSION_COOKIE = "vk_admin_session";
const ADMIN_SESSION_LIFETIME = 8 * 60 * 60 * 1000;
const REMEMBERED_SESSION_LIFETIME = 30 * 24 * 60 * 60 * 1000;
const LOGIN_ATTEMPT_WINDOW = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;

// ── In‑memory caches (sessions, login throttling) ────────────────────────
const adminSessions = new Map();
const loginAttempts = new Map();

// ── MIME helpers ────────────────────────────────────────────────────────
const MIME_BY_EXTENSION = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif"
};

// ── PostgreSQL pool (Render provides DATABASE_URL) ───────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes("render.com")
    ? { rejectUnauthorized: false }
    : false
});

// ── Database bootstrap (tables & seed data) ───────────────────────────────
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS issues (
      id        CHAR(12)   PRIMARY KEY,
      data      JSONB      NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS issue_files (
      id         SERIAL     PRIMARY KEY,
      issue_id   CHAR(12)   NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      sort_order INTEGER    NOT NULL DEFAULT 0,
      name       TEXT       NOT NULL,
      file_path  TEXT       NOT NULL,
      type       TEXT       NOT NULL,
      size       INTEGER    NOT NULL,
      data       BYTEA      NOT NULL
    );
    CREATE INDEX IF NOT EXISTS issue_files_issue_id_idx ON issue_files(issue_id, sort_order);
    CREATE TABLE IF NOT EXISTS app_data (
      key   TEXT  PRIMARY KEY,
      value JSONB NOT NULL
    );
  `);

  // Seed default rows if they do not exist
  const defaults = {
    categories: ["Main Edition", "Special Edition", "Supplement"],
    settings: {
      basic: { siteName: "Vachana Kranti", country: "India", timezone: "Asia/Kolkata", language: "en", credit: "Vachana Kranti", faviconUrl: "", logoUrl: "" },
      seo: { title: "Vachana Kranti — E‑paper", description: "Read the latest Vachana Kranti digital editions.", keywords: "", canonicalUrl: "", robots: "index,follow" },
      social: { facebook: "", instagram: "", youtube: "", whatsapp: "", x: "" },
      push: { enabled: false, publicKey: "", vapidSubject: "" },
      watermark: { enabled: false, text: "Vachana Kranti", opacity: 35, position: "bottom-right" },
      integrations: { googleAnalyticsId: "", googleSiteVerification: "", recaptchaSiteKey: "", recaptchaSecretKey: "", facebookPixelId: "", heatmapSiteId: "" },
      pwa: { enabled: true, appName: "Vachana Kranti", shortName: "Vachana", themeColor: "#174c3a", backgroundColor: "#f4f6f2" },
      comments: { enabled: false, requireApproval: true, provider: "local" }
    },
    theme: {
      navbar: { title: "Vachana Kranti", tagline: "Digital edition", sticky: true },
      appearance: { primaryColor: "#174c3a", accentColor: "#d8ac5b", backgroundColor: "#f2f3ef", pageWidth: "900", font: "DM Sans", showCategory: true },
      additionalCss: ""
    },
    pages: [
      { slug: "privacy-policy", title: "Privacy Policy", content: "Privacy information for Vachana Kranti readers.", status: "public", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { slug: "disclaimer", title: "Disclaimer", content: "Information in Vachana Kranti editions is provided for general reading.", status: "public", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { slug: "terms-and-conditions", title: "Terms and Conditions", content: "Terms for using the Vachana Kranti e‑paper site.", status: "public", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    ]
  };

  for (const [key, value] of Object.entries(defaults)) {
    await pool.query(
      `INSERT INTO app_data(key, value) VALUES($1, $2) ON CONFLICT(key) DO NOTHING`,
      [key, JSON.stringify(value)]
    );
  }
  console.log("✅ Database schema ready");
}

// ── Helper: fetch/store app_data (categories, settings, theme, pages) ───────
async function getAppData(key) {
  const { rows } = await pool.query(`SELECT value FROM app_data WHERE key=$1`, [key]);
  return rows.length ? rows[0].value : null;
}
async function setAppData(key, value) {
  await pool.query(
    `INSERT INTO app_data(key, value) VALUES($1,$2)
     ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,
    [key, JSON.stringify(value)]
  );
}
async function getCategories() { return (await getAppData("categories")) || []; }
async function getSettings()   { return (await getAppData("settings"))   || {}; }
async function getTheme()      { return (await getAppData("theme"))      || {}; }
async function getPages()      { return (await getAppData("pages"))      || []; }

// ── Issue helpers (PostgreSQL) ───────────────────────────────────────────────
async function dbListIssues() {
  const { rows } = await pool.query(`SELECT id, data FROM issues ORDER BY data->>'date' DESC, data->>'createdAt' DESC`);
  return rows.map(r => ({ id: r.id, ...r.data }));
}
async function dbGetIssue(id) { if (!/^[a-f0-9]{12}$/.test(id)) return null; const { rows } = await pool.query(`SELECT id, data FROM issues WHERE id=$1`, [id]); return rows.length ? { id: rows[0].id, ...rows[0].data } : null; }
async function dbSaveIssue(issue) {
  const { id, ...data } = issue;
  await pool.query(`INSERT INTO issues(id, data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data`, [id, JSON.stringify(data)]);
}
async function dbDeleteIssue(id) { await pool.query(`DELETE FROM issues WHERE id=$1`, [id]); }
async function dbSaveFiles(issueId, decodedFiles) {
  // Remove previous files for the issue first
  await pool.query(`DELETE FROM issue_files WHERE issue_id=$1`, [issueId]);
  const savedMeta = [];
  for (let i = 0; i < decodedFiles.length; i++) {
    const file = decodedFiles[i];
    const fileName = `${String(i + 1).padStart(2, "0")}${file.extension}`;
    await pool.query(
      `INSERT INTO issue_files(issue_id, sort_order, name, file_path, type, size, data)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [issueId, i, file.name, fileName, file.type, file.size, file.buffer]
    );
    savedMeta.push({ name: file.name, path: fileName, type: file.type, size: file.size });
  }
  return savedMeta;
}
async function dbGetFileByPath(issueId, filePath) {
  const { rows } = await pool.query(`SELECT type, size, data FROM issue_files WHERE issue_id=$1 AND file_path=$2`, [issueId, filePath]);
  return rows.length ? rows[0] : null;
}
async function dbTotalFileSize() {
  const { rows } = await pool.query(`SELECT COALESCE(SUM(size),0)::bigint AS total FROM issue_files`);
  return Number(rows[0].total);
}
async function dbFindIssue(key) {
  if (/^[a-f0-9]{12}$/.test(key)) return dbGetIssue(key);
  const { rows } = await pool.query(`SELECT id, data FROM issues WHERE data->>'alias'=$1`, [key]);
  return rows.length ? { id: rows[0].id, ...rows[0].data } : null;
}

// ── Scheduler (publish scheduled editions) ─────────────────────────────────
async function activateDueSchedules() {
  const { rows } = await pool.query(
    `SELECT id, data FROM issues
     WHERE data->>'status'='scheduled'
       AND (data->>'scheduledAt') IS NOT NULL
       AND (data->>'scheduledAt')::timestamptz <= NOW()`
  );
  for (const row of rows) {
    const issue = { id: row.id, ...row.data };
    issue.status = "public";
    issue.publishedAt = new Date().toISOString();
    await dbSaveIssue(issue);
  }
}

// ── Dashboard stats (aggregate view counts, storage, etc.) ──────────────────
async function getDashboardStats() {
  const issues = await dbListIssues();
  const now = new Date();
  const currentMonth = now.toISOString().slice(0, 7);
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const previousMonth = prev.toISOString().slice(0, 7);
  const usedBytes = await dbTotalFileSize();
  const categories = await getCategories();

  const monthlyViews = {};
  for (const issue of issues) {
    for (const [m, cnt] of Object.entries(issue.viewsByMonth || {})) {
      monthlyViews[m] = (monthlyViews[m] || 0) + cnt;
    }
  }

  const chart = [];
  for (let offset = 5; offset >= 0; offset--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    const m = d.toISOString().slice(0, 7);
    chart.push({ month: m, label: d.toLocaleDateString("en", { month: "short", timeZone: "UTC" }), views: monthlyViews[m] || 0 });
  }

  return {
    totalEditions: issues.length,
    categoryCount: categories.length,
    thisMonthVisitors: monthlyViews[currentMonth] || 0,
    lastMonthVisitors: monthlyViews[previousMonth] || 0,
    usedBytes,
    totalBytes: STORAGE_LIMIT_BYTES,
    chart,
    scheduled: issues.filter(i => i.status === "scheduled").length,
    upcoming: issues.filter(i => i.status === "scheduled").sort((a,b)=>a.scheduledAt.localeCompare(b.scheduledAt)).slice(0,5)
  };
}

// ── Misc helpers (JSON responses, cookies, auth, etc.) ────────────────────
function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(payload));
}
function cookieValue(req, name) {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const [k, v] = part.split("=");
    if (k && k.trim() === name) return v ? v.trim() : "";
  }
  return "";
}
function getAdminSession(req) {
  const token = cookieValue(req, ADMIN_SESSION_COOKIE);
  const sess = adminSessions.get(token);
  if (!sess) return null;
  if (sess.expiresAt <= Date.now()) { adminSessions.delete(token); return null; }
  return { token, sess };
}
function isSameOrigin(req) {
  // SameSite=Strict cookie already provides CSRF protection.
  // This is a lightweight extra check: just verify the host matches.
  const origin = req.headers.origin;
  if (!origin) return true; // same-origin requests may omit the Origin header
  try {
    const url = new URL(origin);
    const host = req.headers.host || "";
    return url.host === host;
  } catch { return false; }
}
function passwordsMatch(provided, expected) {
  const a = crypto.createHash("sha256").update(provided).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}
function isSecureRequest(req) {
  // Behind a reverse proxy (Render, Railway, etc.) the socket is plain HTTP
  // but the client connected over HTTPS. Trust x-forwarded-proto.
  const fwdProto = (req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  return fwdProto === "https" || req.socket.encrypted;
}
function clearAdminSession(res, req, token = "") {
  if (token) adminSessions.delete(token);
  const secure = isSecureRequest(req) ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${ADMIN_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
}
function slugify(text) {
  return text.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}
function getBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers.host || `localhost:${PORT}`;
  return `${proto}://${host}`;
}

// ── Body parsing (JSON) ───────────────────────────────────────────────────
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", chunk => {
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) { reject(new Error("Request too large (max 70 MB)")); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(new Error("Request body must be valid JSON")); }
    });
    req.on("error", reject);
  });
}

// ── File‑type inference & base64 decode for uploads ───────────────────────
function decodeFiles(files, uploadType) {
  if (!Array.isArray(files) || files.length < 1 || files.length > 30) throw new Error("Add between 1 and 30 PDF or image files.");
  let total = 0;
  const decoded = files.map(f => {
    if (!f || typeof f.name !== "string" || typeof f.data !== "string") throw new Error("Invalid file object.");
    const ext = path.extname(f.name).toLowerCase();
    const mime = MIME_BY_EXTENSION[ext];
    if (!mime) throw new Error(`"${f.name}" has unsupported type.`);
    if (uploadType === "pdf" && mime !== "application/pdf") throw new Error("Upload type set to PDF but contains images.");
    if (uploadType === "images" && mime === "application/pdf") throw new Error("Upload type set to Images but contains PDFs.");
    const buf = Buffer.from(f.data, "base64");
    if (buf.length === 0 || buf.length > MAX_FILE_BYTES) throw new Error(`Each file must be < 50 MB – check "${f.name}".`);
    total += buf.length;
    return { name: path.basename(f.name).slice(0,180), extension: ext, type: mime, size: buf.length, buffer: buf };
  });
  return { files: decoded, totalBytes: total };
}
function inferUploadType(files) {
  const pdfs = files.filter(f => f.type === "application/pdf").length;
  if (pdfs === files.length) return "pdf";
  if (pdfs === 0) return "images";
  return "mixed";
}
function publicIssue(issue, base) {
  return { ...issue, url: `${base}/paper/${issue.alias || issue.id}` };
}

// ── Request handler --------------------------------------------------------
async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  // ----- Early health check for Render's port scanner -----
  if (!global.dbReady && req.method === "GET" && url.pathname === "/") {
    return sendJson(res, 200, { status: "warming‑up" });
  }

  // ----- Auth endpoints (login, logout, session status) -----
  if (req.method === "GET" && url.pathname === "/api/auth/session") {
    return sendJson(res, 200, { authenticated: Boolean(getAdminSession(req)), configured: Boolean(process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) });
  }
  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    if (!isSameOrigin(req)) return sendJson(res, 403, { error: "Login must originate from this site." });
    if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) return sendJson(res, 503, { error: "Admin credentials not configured." });
    const now = Date.now();
    // clean old attempts
    for (const [ip, a] of loginAttempts) if (a.expiresAt <= now) loginAttempts.delete(ip);
    const ip = req.socket.remoteAddress || "unknown";
    const attempt = loginAttempts.get(ip);
    if (attempt && attempt.count >= MAX_LOGIN_ATTEMPTS && attempt.expiresAt > now) return sendJson(res, 429, { error: "Too many login attempts – try later." });
    const body = await readJson(req);
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const pw = typeof body.password === "string" ? body.password : "";
    const okEmail = passwordsMatch(email, process.env.ADMIN_EMAIL);
    const okPw = passwordsMatch(pw, process.env.ADMIN_PASSWORD);
    if (!okEmail || !okPw) {
      const next = attempt && attempt.expiresAt > now ? { count: attempt.count + 1, expiresAt: attempt.expiresAt } : { count: 1, expiresAt: now + LOGIN_ATTEMPT_WINDOW };
      loginAttempts.set(ip, next);
      if (next.count >= MAX_LOGIN_ATTEMPTS) return sendJson(res, 429, { error: "Too many login attempts – try later." });
      return sendJson(res, 401, { error: "Invalid email or password." });
    }
    // successful login
    loginAttempts.delete(ip);
    const token = crypto.randomBytes(32).toString("hex");
    const ttl = body.remember ? REMEMBERED_SESSION_LIFETIME : ADMIN_SESSION_LIFETIME;
    adminSessions.set(token, { expiresAt: Date.now() + ttl });
    const secure = isSecureRequest(req) ? "; Secure" : "";
    res.setHeader("Set-Cookie", `${ADMIN_SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(ttl/1000)}${secure}`);
    return sendJson(res, 200, { authenticated: true });
  }
  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    if (!isSameOrigin(req)) return sendJson(res, 403, { error: "Logout must originate from this site." });
    const sess = getAdminSession(req);
    clearAdminSession(res, req, sess?.token);
    return sendJson(res, 200, { authenticated: false });
  }

  // ----- Require auth for admin UI/APIs -----
  const admin = getAdminSession(req);
  const adminPage = req.method === "GET" && ["/", "/index.html", "/app.js"].includes(url.pathname);
  const adminApi = /^\/api\/(bootstrap|dashboard|issues(?:\/.*)?|categories(?:\/.*)?|settings|theme|pages(?:\/.*)?)$/.test(url.pathname);
  if (!admin && (adminPage || adminApi)) {
    if (adminPage) { res.writeHead(302, { Location: "/login" }); return res.end(); }
    return sendJson(res, 401, { error: "Session missing or expired – please sign in." });
  }

  // ------------------------------------------------------------------------
  // At this point DB is ready for most routes; we still guard against race
  // conditions for DB‑dependent calls by checking `global.dbReady` where needed.

  // ----- Bootstrap (public) -----
  if (req.method === "GET" && url.pathname === "/api/bootstrap") {
    await activateDueSchedules();
    const issues = (await dbListIssues()).map(i => publicIssue(i, getBaseUrl(req)));
    const categories = await getCategories();
    const settings = await getSettings();
    return sendJson(res, 200, { issues, categories, defaultCategory: categories.includes(settings.defaultCategory) ? settings.defaultCategory : categories[0], settings: { basic: settings.basic || {} }, dashboard: await getDashboardStats() });
  }

  // ----- Reader endpoint (public issue data) -----
  const readerMatch = url.pathname.match(/^\/api\/reader\/([a-z0-9-]{1,60})$/);
  if (req.method === "GET" && readerMatch) {
    await activateDueSchedules();
    const all = await dbListIssues();
    const idx = all.findIndex(i => i.id === readerMatch[1] || i.alias === readerMatch[1]);
    const issue = idx >= 0 ? all[idx] : null;
    if (!issue || (issue.status && issue.status !== "public")) return sendJson(res, 404, { error: "Issue not found." });
    const settings = await getSettings();
    return sendJson(res, 200, {
      issue: publicIssue(issue, getBaseUrl(req)),
      newerIssue: idx > 0 ? publicIssue(all[idx-1], getBaseUrl(req)) : null,
      olderIssue: idx < all.length-1 ? publicIssue(all[idx+1], getBaseUrl(req)) : null,
      theme: await getTheme(),
      config: { basic: settings.basic || {}, watermark: settings.watermark || {}, social: settings.social || {}, seo: settings.seo || {} },
      pages: (await getPages()).filter(p=>p.status==="public").map(p=>({slug:p.slug,title:p.title}))
    });
  }

  // ----- Issues list (public) -----
  if (req.method === "GET" && url.pathname === "/api/issues") {
    await activateDueSchedules();
    return sendJson(res, 200, { issues: (await dbListIssues()).map(i=>publicIssue(i,getBaseUrl(req))) });
  }

  // ----- Dashboard stats (admin) -----
  if (req.method === "GET" && url.pathname === "/api/dashboard") {
    await activateDueSchedules();
    return sendJson(res, 200, await getDashboardStats());
  }

  // ----- Categories CRUD -----
  if (req.method === "GET" && url.pathname === "/api/categories") {
    const cats = await getCategories();
    const set = await getSettings();
    return sendJson(res, 200, { categories: cats, defaultCategory: cats.includes(set.defaultCategory) ? set.defaultCategory : cats[0] });
  }
  if (req.method === "POST" && url.pathname === "/api/categories") {
    const body = await readJson(req);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 50) return sendJson(res, 400, { error: "Category name up to 50 chars required." });
    const cats = await getCategories();
    if (cats.some(c=>c.toLowerCase()===name.toLowerCase())) return sendJson(res, 409, { error: "Category already exists." });
    cats.push(name);
    await setAppData("categories", cats);
    const settings = await getSettings();
    if (cats.length===1) { settings.defaultCategory = name; await setAppData("settings", settings); }
    return sendJson(res, 201, { categories: cats, defaultCategory: settings.defaultCategory || cats[0] });
  }
  if (req.method === "POST" && url.pathname === "/api/categories/default") {
    const body = await readJson(req);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const cats = await getCategories();
    if (!cats.includes(name)) return sendJson(res, 400, { error: "Category must exist." });
    const settings = await getSettings();
    settings.defaultCategory = name;
    await setAppData("settings", settings);
    return sendJson(res, 200, { defaultCategory: name });
  }
  const categoryMatch = url.pathname.match(/^\/api\/categories\/([^/]+)$/);
  if (categoryMatch && ["PUT","DELETE"].includes(req.method)) {
    const old = decodeURIComponent(categoryMatch[1]);
    const cats = await getCategories();
    if (!cats.includes(old)) return sendJson(res, 404, { error: "Category not found." });
    if (req.method === "PUT") {
      const body = await readJson(req);
      const neu = typeof body.name === "string" ? body.name.trim() : "";
      if (!neu || neu.length > 50) return sendJson(res, 400, { error: "New name up to 50 chars required." });
      if (cats.some(c=>c.toLowerCase()===neu.toLowerCase() && c!==old)) return sendJson(res, 409, { error: "Another category already uses that name." });
      const updated = cats.map(c=>c===old?neu:c);
      await setAppData("categories", updated);
      // Update existing issues
      await pool.query(`UPDATE issues SET data = jsonb_set(data, '{category}', to_jsonb($1::text)) WHERE data->>'category'=$2`, [neu, old]);
      const settings = await getSettings();
      if (settings.defaultCategory===old) { settings.defaultCategory=neu; await setAppData("settings", settings); }
      return sendJson(res, 200, { categories: updated, defaultCategory: settings.defaultCategory || updated[0] });
    } else { // DELETE
      const settings = await getSettings();
      if (settings.defaultCategory===old) return sendJson(res, 409, { error: "Cannot delete the default category – change it first." });
      const { rows } = await pool.query(`SELECT id FROM issues WHERE data->>'category'=$1 LIMIT 1`, [old]);
      if (rows.length) return sendJson(res, 409, { error: "Category in use – reassign issues before deletion." });
      if (cats.length<=1) return sendJson(res, 409, { error: "At least one category must remain." });
      const remaining = cats.filter(c=>c!==old);
      await setAppData("categories", remaining);
      return sendJson(res, 200, { categories: remaining, defaultCategory: settings.defaultCategory || remaining[0] });
    }
  }

  // ----- Settings (admin) -----
  if (req.method === "GET" && url.pathname === "/api/settings") {
    return sendJson(res, 200, { settings: await getSettings() });
  }
  if (req.method === "PUT" && url.pathname === "/api/settings") {
    const body = await readJson(req);
    const section = typeof body.section === "string" ? body.section : "";
    const allowed = ["basic","seo","social","push","watermark","integrations","pwa","comments"];
    if (!allowed.includes(section) || !body.values || typeof body.values !== "object" || Array.isArray(body.values)) {
      return sendJson(res, 400, { error: "Invalid section or values." });
    }
    const settings = await getSettings();
    const cur = settings[section] || {};
    const vals = {};
    for (const [k,v] of Object.entries(body.values)) {
      if (!(k in cur)) continue;
      if (typeof cur[k] === "boolean") vals[k]=Boolean(v);
      else if (typeof cur[k] === "number") {
        const n = Number(v);
        if (!Number.isFinite(n)) return sendJson(res, 400, { error: `Invalid number for ${k}.` });
        vals[k]=Math.min(100, Math.max(0, n));
      } else if (typeof v === "string") vals[k]=v.trim().slice(0, k.toLowerCase().includes("css")?12000:2000);
    }
    settings[section] = { ...cur, ...vals };
    await setAppData("settings", settings);
    return sendJson(res, 200, { settings });
  }

  // ----- Theme (admin) -----
  if (req.method === "GET" && url.pathname === "/api/theme") {
    return sendJson(res, 200, { theme: await getTheme() });
  }
  if (req.method === "PUT" && url.pathname === "/api/theme") {
    const body = await readJson(req);
    const section = typeof body.section === "string" ? body.section : "";
    const okSecs = ["navbar","appearance","additionalCss"];
    if (!okSecs.includes(section)) return sendJson(res, 400, { error: "Invalid theme section." });
    const theme = await getTheme();
    if (section === "additionalCss") {
      theme.additionalCss = typeof body.value === "string" ? body.value.slice(0,12000) : "";
    } else if (body.values && typeof body.values === "object") {
      const cur = theme[section] || {};
      const next = { ...cur };
      for (const [k,v] of Object.entries(body.values)) {
        if (!(k in cur)) continue;
        if (section === "appearance" && k === "pageWidth") {
          const w = Number(v);
          if (!Number.isFinite(w) || w < 600 || w > 1400) return sendJson(res, 400, { error: "Page width must be 600‑1400px." });
          next[k] = String(w);
        } else if (section === "appearance" && ["primaryColor","accentColor","backgroundColor"].includes(k)) {
          if (!/^#[a-f0-9]{6}$/i.test(v)) return sendJson(res, 400, { error: `Invalid hex color for ${k}.` });
          next[k] = v;
        } else if (section === "appearance" && k === "font") {
          if (!["DM Sans","Arial","Georgia","system-ui"].includes(v)) return sendJson(res, 400, { error: "Unsupported font." });
          next[k] = v;
        } else if (typeof cur[k] === "boolean") next[k] = Boolean(v);
        else if (typeof v === "string") next[k] = v.trim().slice(0,200);
      }
      theme[section] = next;
    } else return sendJson(res, 400, { error: "Missing theme values." });
    await setAppData("theme", theme);
    return sendJson(res, 200, { theme });
  }

  // ----- Pages (admin) -----
  if (req.method === "GET" && url.pathname === "/api/pages") {
    return sendJson(res, 200, { pages: (await getPages()).sort((a,b)=>a.title.localeCompare(b.title)) });
  }
  if (req.method === "POST" && url.pathname === "/api/pages") {
    const body = await readJson(req);
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const content = typeof body.content === "string" ? body.content.trim() : "";
    const slug = slugify(typeof body.slug === "string" && body.slug.trim() ? body.slug : title);
    const status = body.status === "draft" ? "draft" : "public";
    if (!title || title.length>120) return sendJson(res, 400, { error: "Title up to 120 chars required." });
    if (!content || content.length>100000) return sendJson(res, 400, { error: "Content up to 100 k chars required." });
    if (!slug) return sendJson(res, 400, { error: "Valid slug required." });
    const pages = await getPages();
    if (pages.some(p=>p.slug===slug)) return sendJson(res, 409, { error: "Slug already exists." });
    const page = { slug, title, content, status, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    pages.push(page);
    await setAppData("pages", pages);
    return sendJson(res, 201, { page });
  }
  const pageMatch = url.pathname.match(/^\/api\/pages\/([a-z0-9-]{1,60})$/);
  if (pageMatch && ["PUT","DELETE"].includes(req.method)) {
    const pages = await getPages();
    const idx = pages.findIndex(p=>p.slug===pageMatch[1]);
    if (idx<0) return sendJson(res, 404, { error: "Page not found." });
    if (req.method === "DELETE") {
      pages.splice(idx,1);
      await setAppData("pages", pages);
      return sendJson(res, 200, { deleted: pageMatch[1] });
    }
    const body = await readJson(req);
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const content = typeof body.content === "string" ? body.content.trim() : "";
    const slug = slugify(typeof body.slug === "string" && body.slug.trim() ? body.slug : title);
    const status = body.status === "draft" ? "draft" : "public";
    if (!title || title.length>120) return sendJson(res, 400, { error: "Title up to 120 chars required." });
    if (!content || content.length>100000) return sendJson(res, 400, { error: "Content up to 100 k chars required." });
    if (!slug) return sendJson(res, 400, { error: "Valid slug required." });
    if (pages.some((p,i)=>p.slug===slug && i!==idx)) return sendJson(res, 409, { error: "Slug already exists." });
    pages[idx] = { ...pages[idx], slug, title, content, status, updatedAt: new Date().toISOString() };
    await setAppData("pages", pages);
    return sendJson(res, 200, { page: pages[idx] });
  }

  // ----- Issue creation (admin) -----
  if (req.method === "POST" && url.pathname === "/api/issues") {
    const body = await readJson(req);
    const files = Array.isArray(body.files) ? body.files : [];
    const fields = await validateIssueFields(body);
    const uploads = decodeFiles(files, fields.uploadType);
    const used = await dbTotalFileSize();
    if (used + uploads.totalBytes > STORAGE_LIMIT_BYTES) throw new Error("Upload would exceed 10 GB limit.");
    const id = crypto.randomBytes(6).toString("hex");
    const savedFiles = await dbSaveFiles(id, uploads.files);
    const issue = { id, ...fields, createdAt: new Date().toISOString(), publishedAt: fields.status === "public" ? new Date().toISOString() : null, viewsByMonth: {}, files: savedFiles };
    await dbSaveIssue(issue);
    return sendJson(res, 201, { issue: publicIssue(issue, getBaseUrl(req)) });
  }

  // ----- Issue update/delete -----
  const issueMatch = url.pathname.match(/^\/api\/issues\/([a-f0-9]{12})$/);
  if (issueMatch && req.method === "PUT") {
    const existing = await dbGetIssue(issueMatch[1]);
    if (!existing) return sendJson(res, 404, { error: "Edition not found." });
    const body = await readJson(req);
    const fields = await validateIssueFields(body, existing);
    const oldFiles = existing.files || [];
    let newFiles = null;
    if (Object.hasOwn(body, "files")) {
      if (!Array.isArray(body.files) || body.files.length===0) throw new Error("File list required for replacement.");
      const uploads = decodeFiles(body.files, fields.uploadType);
      const oldBytes = oldFiles.reduce((t,f)=>t+(f.size||0),0);
      const used = await dbTotalFileSize();
      if (used - oldBytes + uploads.totalBytes > STORAGE_LIMIT_BYTES) throw new Error("Upload would exceed 10 GB limit.");
      newFiles = await dbSaveFiles(existing.id, uploads.files);
    }
    Object.assign(existing, fields, {
      publishedAt: fields.status === "public" ? (existing.publishedAt || new Date().toISOString()) : null,
      updatedAt: new Date().toISOString(),
      ...(newFiles ? { files: newFiles } : {})
    });
    await dbSaveIssue(existing);
    return sendJson(res, 200, { issue: publicIssue(existing, getBaseUrl(req)) });
  }
  if (issueMatch && req.method === "DELETE") {
    const issue = await dbGetIssue(issueMatch[1]);
    if (!issue) return sendJson(res, 404, { error: "Edition not found." });
    await dbDeleteIssue(issue.id);
    return sendJson(res, 200, { deleted: issue.id });
  }

  // ----- Public pages (reader) -----
  const pubPageMatch = url.pathname.match(/^\/api\/public-pages\/([a-z0-9-]{1,60})$/);
  if (req.method === "GET" && url.pathname === "/api/public-pages") {
    const pub = (await getPages()).filter(p=>p.status==="public").map(p=>({slug:p.slug,title:p.title}));
    return sendJson(res, 200, { pages: pub });
  }
  if (req.method === "GET" && pubPageMatch) {
    const page = (await getPages()).find(p=>p.slug===pubPageMatch[1] && p.status==="public");
    if (!page) return sendJson(res, 404, { error: "Page not found." });
    return sendJson(res, 200, { page });
  }

  // ----- UI routes -----
  const pageRoute = url.pathname.match(/^\/page\/([a-z0-9-]{1,60})$/);
  if (req.method === "GET" && pageRoute) {
    const page = (await getPages()).find(p=>p.slug===pageRoute[1] && p.status==="public");
    if (!page) { res.writeHead(404); return res.end("Page not found."); }
    return serveFile(res, path.join(PUBLIC_DIR, "info-page.html"), "text/html; charset=utf-8");
  }
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    return serveFile(res, path.join(PUBLIC_DIR, "index.html"), "text/html; charset=utf-8");
  }

  // ----- Paper viewer -----
  const paperMatch = url.pathname.match(/^\/paper\/([a-z0-9-]{1,60})$/);
  if (req.method === "GET" && paperMatch) {
    const issue = await dbFindIssue(paperMatch[1]);
    if (!issue || (issue.status && issue.status !== "public")) { res.writeHead(404); return res.end("Issue not found."); }
    const month = new Date().toISOString().slice(0,7);
    issue.viewsByMonth = issue.viewsByMonth || {};
    issue.viewsByMonth[month] = (issue.viewsByMonth[month]||0)+1;
    await dbSaveIssue(issue);
    return serveFile(res, path.join(PUBLIC_DIR, "paper.html"), "text/html; charset=utf-8");
  }

  // ----- Media files (served from PostgreSQL) -----
  const mediaMatch = url.pathname.match(/^\/media\/([a-f0-9]{12})\/((?:[0-9]{2}|rev-[0-9]+-[a-f0-9]{6}-[0-9]{2})\.(?:pdf|jpg|jpeg|png|webp|gif))$/);
  if (req.method === "GET" && mediaMatch) {
    const file = await dbGetFileByPath(mediaMatch[1], mediaMatch[2]);
    if (!file) { res.writeHead(404); return res.end("Not found"); }
    // Stream buffer (supports range requests)
    const size = file.data.length;
    let start = 0, end = size - 1, status = 200;
    const range = req.headers.range;
    if (range) {
      const m = range.match(/^bytes=(\d*)-(\d*)$/);
      if (m) {
        if (m[1]) start = Number(m[1]);
        if (m[2]) end = Math.min(Number(m[2]), size - 1);
        if (start > end) { res.writeHead(416, { "Content-Range": `bytes */${size}` }); return res.end(); }
        status = 206;
      }
    }
    const headers = {
      "Content-Type": file.type,
      "Accept-Ranges": "bytes",
      "Content-Length": end - start + 1,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff"
    };
    if (status === 206) headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
    res.writeHead(status, headers);
    res.end(file.data.slice(start, end + 1));
    return;
  }

  // ----- Health check endpoint -----
  if (req.method === "GET" && url.pathname === "/api/health") {
    return sendJson(res, 200, { status: "ok" });
  }

  // ----- Static assets (CSS/JS) -----
  const staticMap = {
    "/styles.css": ["styles.css", "text/css; charset=utf-8"],
    "/app.js": ["app.js", "text/javascript; charset=utf-8"],
    "/login.css": ["login.css", "text/css; charset=utf-8"],
    "/login.js": ["login.js", "text/javascript; charset=utf-8"],
    "/paper.js": ["paper.js", "text/javascript; charset=utf-8"],
    "/info-page.js": ["info-page.js", "text/javascript; charset=utf-8"]
  };
  if (req.method === "GET" && staticMap[url.pathname]) {
    const [fname, ctype] = staticMap[url.pathname];
    return serveFile(res, path.join(PUBLIC_DIR, fname), ctype);
  }

  // ----- Fallback 404 -----
  res.writeHead(404);
  res.end("Not found");
}

// ── Server start (listen first, then DB bootstrap) -------------------------
global.dbReady = false;
const server = http.createServer((req, res) => {
  handleRequest(req, res).catch(err => {
    console.error("Request error:", err);
    if (!res.headersSent) sendJson(res, 500, { error: "Server error" });
    else res.destroy();
  });
});

server.listen(PORT, HOST, () => {
  console.log(`🚀 Vachana Kranti listening on http://${HOST}:${PORT}`);
  // Start DB init after the socket is up (Render needs the port open ASAP)
  initDb()
    .then(() => { global.dbReady = true; console.log("✅ DB initialized – API fully operational"); })
    .catch(err => { console.error("❌ DB init failed:", err); process.exit(1); });
});

// Periodic scheduler (runs only after DB is ready)
setInterval(() => { if (global.dbReady) { activateDueSchedules().catch(e=>console.error(e)); } }, 30_000).unref();
