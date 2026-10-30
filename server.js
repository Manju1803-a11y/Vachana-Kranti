// server.js – Vachana Kranti e‑paper platform (Production & Render‑ready)
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const {
  createDatabasePool,
  databaseErrorDetails,
  getDatabaseConfig,
  retryDatabaseConnection,
  runMigrations
} = require("./database");

// ── Configuration ───────────────────────────────────────────────────────
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data", "issues");
const CATEGORIES_FILE = path.join(ROOT, "data", "categories.json");
const SETTINGS_FILE = path.join(ROOT, "data", "settings.json");
const THEME_FILE = path.join(ROOT, "data", "theme.json");
const PAGES_FILE = path.join(ROOT, "data", "pages.json");

const MAX_REQUEST_BYTES = 70 * 1024 * 1024;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const STORAGE_LIMIT_BYTES = 10 * 1024 * 1024 * 1024;
const ADMIN_SESSION_COOKIE = "vk_admin_session";
const ADMIN_SESSION_LIFETIME = 8 * 60 * 60 * 1000;
const REMEMBERED_SESSION_LIFETIME = 30 * 24 * 60 * 60 * 1000;
const LOGIN_ATTEMPT_WINDOW = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const databaseConfig = getDatabaseConfig();
const databaseConfigured = databaseConfig.mode === "postgres";
const localFileStorageEnabled = databaseConfig.mode === "local-file";
let databaseInitializationError = null;

class StorageUnavailableError extends Error {
  constructor(operation, cause) {
    super(`Persistent storage operation failed: ${operation}`, { cause });
    this.name = "StorageUnavailableError";
    this.code = "STORAGE_UNAVAILABLE";
  }
}

// Ensure local data directories exist
fs.mkdirSync(DATA_DIR, { recursive: true });

const DEMO_ISSUE_ID = "9cec51df7a48";

function getDemoIssue() {
  const demoImgPath = path.join(PUBLIC_DIR, "demo-page.jpg");
  const size = fs.existsSync(demoImgPath) ? fs.statSync(demoImgPath).size : 8306211;
  return {
    id: DEMO_ISSUE_ID,
    name: "Vachana Kranti Main Edition",
    title: "Vachana Kranti Main Edition",
    date: new Date().toISOString().slice(0, 10),
    createdAt: "2026-10-26T07:05:56.549Z",
    publishedAt: new Date().toISOString(),
    category: "Main Edition",
    status: "public",
    uploadType: "images",
    alias: "demo",
    metaTitle: "Vachana Kranti — ePaper",
    metaDescription: "Read today's Vachana Kranti ePaper digital edition.",
    files: [
      {
        name: "kranti 26.jpg",
        path: "01.jpg",
        type: "image/jpeg",
        size
      }
    ],
    views: 120,
    viewsByMonth: {
      [new Date().toISOString().slice(0, 7)]: 120
    }
  };
}

function ensureDemoIssueOnDisk() {
  try {
    const demoDir = path.join(DATA_DIR, DEMO_ISSUE_ID);
    fs.mkdirSync(demoDir, { recursive: true });
    const issueFile = path.join(demoDir, "issue.json");
    if (!fs.existsSync(issueFile)) {
      fs.writeFileSync(issueFile, JSON.stringify(getDemoIssue(), null, 2));
    }
    const imgDest = path.join(demoDir, "01.jpg");
    const demoSrc = path.join(PUBLIC_DIR, "demo-page.jpg");
    if (!fs.existsSync(imgDest) && fs.existsSync(demoSrc)) {
      fs.copyFileSync(demoSrc, imgDest);
    }
  } catch (err) {
    console.warn("Could not seed demo issue on disk:", err.message);
  }
}

// Ensure demo issue is always available on disk
ensureDemoIssueOnDisk();

// ── In‑memory caches ────────────────────────────────────────────────────
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

// ── PostgreSQL & Local Storage State ─────────────────────────────────────
let useDb = false;
const pool = createDatabasePool(databaseConfig);
if (databaseConfig.mode === "unavailable") {
  databaseInitializationError = new Error(databaseConfig.error);
}
let databaseInitializationPromise = null;
let databaseRetryTimer = null;

// ── Database bootstrap ──────────────────────────────────────────────────
async function initDb() {
  if (!pool) {
    if (!localFileStorageEnabled) {
      console.error("⚠️ PostgreSQL is unavailable.", { reason: databaseConfig.error || "Database pool could not be initialized." });
      return;
    }
    console.log("ℹ️ Running in local file storage mode (./data).");
    useDb = false;
    return;
  }

  try {
    await retryDatabaseConnection(pool);
    await runMigrations(pool);

    const defaults = {
      categories: ["Main Edition", "Special Edition", "Supplement"],
      settings: {
        basic: { siteName: "Vachana Kranti", country: "India", timezone: "Asia/Kolkata", language: "kn", credit: "Vachana Kranti", faviconUrl: "/logo.png", logoUrl: "/logo.png" },
        seo: { title: "Vachana Kranti — E‑paper", description: "Read the latest Vachana Kranti digital editions.", keywords: "Vachana Kranti, epaper, Kannada news", canonicalUrl: "", robots: "index,follow" },
        social: { facebook: "", instagram: "", youtube: "", whatsapp: "", x: "" },
        push: { enabled: false, publicKey: "", vapidSubject: "" },
        watermark: { enabled: false, text: "Vachana Kranti", opacity: 35, position: "bottom-right" },
        integrations: { googleAnalyticsId: "", googleSiteVerification: "", recaptchaSiteKey: "", recaptchaSecretKey: "", facebookPixelId: "", heatmapSiteId: "" },
        pwa: { enabled: true, appName: "Vachana Kranti", shortName: "ePaper", themeColor: "#174c3a", backgroundColor: "#f4f6f2" },
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

    // Seed demo edition into PostgreSQL if issues table is empty
    const { rows: countRows } = await pool.query(`SELECT COUNT(*) AS total FROM issues`);
    if (Number(countRows[0].total) === 0) {
      console.log("ℹ️ Seeding default demo edition into PostgreSQL...");
      const demo = getDemoIssue();
      await pool.query(
        `INSERT INTO issues(id, data) VALUES($1, $2) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data`,
        [demo.id, JSON.stringify(demo)]
      );
      const demoImgPath = path.join(PUBLIC_DIR, "demo-page.jpg");
      if (fs.existsSync(demoImgPath)) {
        const buf = fs.readFileSync(demoImgPath);
        await pool.query(
          `INSERT INTO issue_files(issue_id, sort_order, name, file_path, type, size, data)
           VALUES($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT DO NOTHING`,
          [demo.id, 0, "kranti 26.jpg", "01.jpg", "image/jpeg", buf.length, buf]
        );
      }
    }
    useDb = true;
    databaseInitializationError = null;
    console.log("✅ PostgreSQL schema ready – database active.");
  } catch (err) {
    console.error("⚠️ PostgreSQL initialization failed.", databaseErrorDetails(err));
    databaseInitializationError = err;
    if (databaseConfigured) {
      console.warn("➡️ Database is configured but unavailable; falling back to local file storage for read operations.");
    } else {
      console.warn("➡️ Falling back to local file storage.");
    }
    useDb = false;
  }
}

function initializeDatabase() {
  if (databaseInitializationPromise) return databaseInitializationPromise;
  databaseInitializationPromise = initDb().finally(() => {
    databaseInitializationPromise = null;
    if (databaseConfigured && !useDb && !databaseRetryTimer) {
      databaseRetryTimer = setTimeout(() => {
        databaseRetryTimer = null;
        initializeDatabase();
      }, 15_000);
      databaseRetryTimer.unref();
    }
  });
  return databaseInitializationPromise;
}

function assertStorageAvailable(operation) {
  // Allow local-file fallback even when DATABASE_URL is configured but unavailable.
  // Local-file storage is always available on disk as a read-only fallback.
  if (!useDb && !fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  // Only throw if storage is truly unreachable (no db AND no local files AND not writable)
}

// ── Helper: app_data (categories, settings, theme, pages) ───────────────
async function getAppData(key) {
  assertStorageAvailable(`read ${key}`);
  if (useDb && pool) {
    try {
      const { rows } = await pool.query(`SELECT value FROM app_data WHERE key=$1`, [key]);
      if (rows.length) return rows[0].value;
    } catch (err) {
      throw new StorageUnavailableError(`read ${key}`, err);
    }
  }
  const fileMap = { categories: CATEGORIES_FILE, settings: SETTINGS_FILE, theme: THEME_FILE, pages: PAGES_FILE };
  const target = fileMap[key];
  if (target && fs.existsSync(target)) {
    try { return JSON.parse(fs.readFileSync(target, "utf-8")); } catch {}
  }
  return null;
}

async function setAppData(key, value) {
  if (databaseConfigured && !useDb) {
    throw new StorageUnavailableError(`write ${key}`, databaseInitializationError);
  }
  assertStorageAvailable(`write ${key}`);
  if (useDb && pool) {
    try {
      await pool.query(
        `INSERT INTO app_data(key, value) VALUES($1,$2)
         ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,
        [key, JSON.stringify(value)]
      );
      return;
    } catch (err) {
      throw new StorageUnavailableError(`write ${key}`, err);
    }
  }
  const fileMap = { categories: CATEGORIES_FILE, settings: SETTINGS_FILE, theme: THEME_FILE, pages: PAGES_FILE };
  const target = fileMap[key];
  if (target) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(value, null, 2));
  }
}

async function getCategories() { return (await getAppData("categories")) || ["Main Edition", "Special Edition", "Supplement"]; }
async function getSettings()   { return (await getAppData("settings"))   || {}; }
async function getTheme()      { return (await getAppData("theme"))      || {}; }
async function getPages()      { return (await getAppData("pages"))      || []; }

// ── Issue helpers ───────────────────────────────────────────────────────
async function dbListIssues() {
  assertStorageAvailable("list editions");
  if (useDb && pool) {
    try {
      const { rows } = await pool.query(`SELECT id, data FROM issues ORDER BY data->>'date' DESC, data->>'createdAt' DESC`);
      if (rows.length) return rows.map(r => ({ ...r.data, id: String(r.id).trim() }));
    } catch (err) {
      throw new StorageUnavailableError("list editions", err);
    }
  }
  ensureDemoIssueOnDisk();
  if (!fs.existsSync(DATA_DIR)) return [getDemoIssue()];
  const entries = fs.readdirSync(DATA_DIR, { withFileTypes: true });
  const list = [];
  for (const ent of entries) {
    if (ent.isDirectory() && /^[a-f0-9]{12,16}$/.test(ent.name)) {
      const issueFile = path.join(DATA_DIR, ent.name, "issue.json");
      if (fs.existsSync(issueFile)) {
        try {
          const data = JSON.parse(fs.readFileSync(issueFile, "utf-8"));
          list.push({ ...data, id: ent.name });
        } catch (err) {
          if (err.code !== "ENOENT") throw new StorageUnavailableError("read edition metadata", err);
        }
      }
    }
  }
  if (list.length === 0) {
    list.push(getDemoIssue());
  }
  return list.sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || "").localeCompare(a.createdAt || ""));
}

async function dbGetIssue(id) {
  if (!/^[a-f0-9]{12,16}$/.test(id)) return null;
  assertStorageAvailable("read edition");
  if (useDb && pool) {
    try {
      const { rows } = await pool.query(`SELECT id, data FROM issues WHERE id=$1`, [id]);
      if (rows.length) return { ...rows[0].data, id: String(rows[0].id).trim() };
    } catch (err) {
      throw new StorageUnavailableError("read edition", err);
    }
  }
  const issueFile = path.join(DATA_DIR, id, "issue.json");
  try {
    const data = JSON.parse(fs.readFileSync(issueFile, "utf-8"));
    return { ...data, id };
  } catch (err) {
    if (err.code === "ENOENT") {
      if (id === DEMO_ISSUE_ID || id === "ec22a9d0bbbd5") {
        return getDemoIssue();
      }
      return null;
    }
    throw new StorageUnavailableError("read edition metadata", err);
  }
}

async function dbSaveIssue(issue) {
  if (databaseConfigured && !useDb) {
    throw new StorageUnavailableError("save edition", databaseInitializationError);
  }
  assertStorageAvailable("save edition");
  const { id, ...data } = issue;
  if (useDb && pool) {
    try {
      await pool.query(
        `INSERT INTO issues(id, data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data`,
        [id, JSON.stringify(data)]
      );
      return;
    } catch (err) {
      throw new StorageUnavailableError("save edition", err);
    }
  }
  const dir = path.join(DATA_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "issue.json"), JSON.stringify(data, null, 2));
}

async function dbDeleteIssue(id) {
  if (databaseConfigured && !useDb) {
    throw new StorageUnavailableError("delete edition", databaseInitializationError);
  }
  assertStorageAvailable("delete edition");
  if (useDb && pool) {
    try {
      await pool.query(`DELETE FROM issues WHERE id=$1`, [id]);
    } catch (err) {
      throw new StorageUnavailableError("delete edition", err);
    }
  }
  const dir = path.join(DATA_DIR, id);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

async function dbSaveFiles(issueId, decodedFiles) {
  if (databaseConfigured && !useDb) {
    throw new StorageUnavailableError("save edition files", databaseInitializationError);
  }
  assertStorageAvailable("save edition files");
  const dir = path.join(DATA_DIR, issueId);
  fs.mkdirSync(dir, { recursive: true });
  const savedMeta = [];

  if (useDb && pool) {
    try {
      await pool.query(`DELETE FROM issue_files WHERE issue_id=$1`, [issueId]);
    } catch (err) {
      throw new StorageUnavailableError("replace edition files", err);
    }
  }

  for (let i = 0; i < decodedFiles.length; i++) {
    const file = decodedFiles[i];
    const fileName = `${String(i + 1).padStart(2, "0")}${file.extension}`;

    if (useDb && pool) {
      try {
        await pool.query(
          `INSERT INTO issue_files(issue_id, sort_order, name, file_path, type, size, data)
           VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [issueId, i, file.name, fileName, file.type, file.size, file.buffer]
        );
      } catch (err) {
        throw new StorageUnavailableError("save edition file", err);
      }
    } else {
      fs.writeFileSync(path.join(dir, fileName), file.buffer);
    }
    savedMeta.push({ name: file.name, path: fileName, type: file.type, size: file.size });
  }
  return savedMeta;
}

async function dbGetFileByPath(issueId, filePath) {
  assertStorageAvailable("read edition file");
  if (useDb && pool) {
    try {
      const { rows } = await pool.query(
        `SELECT type, size, data FROM issue_files WHERE issue_id=$1 AND file_path=$2`,
        [issueId, filePath]
      );
      if (rows.length) return rows[0];
    } catch (err) {
      throw new StorageUnavailableError("read edition file", err);
    }
  }
  const diskPath = path.join(DATA_DIR, issueId, filePath);
  if (fs.existsSync(diskPath)) {
    const data = fs.readFileSync(diskPath);
    const ext = path.extname(filePath).toLowerCase();
    return {
      type: MIME_BY_EXTENSION[ext] || "application/octet-stream",
      size: data.length,
      data
    };
  }

  // Fallback for demo print edition if file not found in issue_files or data dir
  const demoFallbackPath = path.join(PUBLIC_DIR, "demo-page.jpg");
  if (fs.existsSync(demoFallbackPath) && (filePath === "01.jpg" || issueId === DEMO_ISSUE_ID || issueId === "demo")) {
    const data = fs.readFileSync(demoFallbackPath);
    return {
      type: "image/jpeg",
      size: data.length,
      data
    };
  }
  return null;
}

async function dbTotalFileSize() {
  assertStorageAvailable("calculate storage usage");
  if (useDb && pool) {
    try {
      const { rows } = await pool.query(`SELECT COALESCE(SUM(size),0)::bigint AS total FROM issue_files`);
      return Number(rows[0].total);
    } catch (err) {
      throw new StorageUnavailableError("calculate storage usage", err);
    }
  }
  let total = 0;
  if (fs.existsSync(DATA_DIR)) {
    const walk = (d) => {
      const entries = fs.readdirSync(d, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.isFile() && e.name !== "issue.json" && e.name !== ".gitkeep") {
          total += fs.statSync(full).size;
        }
      }
    };
    try { walk(DATA_DIR); } catch {}
  }
  return total;
}

// Helper to find issue by ID, alias, or slug
async function dbFindIssue(key) {
  if (!key) return null;

  // Extract trailing hex ID if user passes a slug or preview URL (e.g., http-localhost-3000-paper-9cec51df7a48)
  const slugMatch = key.match(/([a-f0-9]{12,16})$/);
  if (slugMatch) {
    const issue = await dbGetIssue(slugMatch[1]);
    if (issue) return issue;
  }

  if (/^[a-f0-9]{12,16}$/.test(key)) {
    const issue = await dbGetIssue(key);
    if (issue) return issue;
  }

  assertStorageAvailable("find edition");
  if (useDb && pool) {
    try {
      const { rows } = await pool.query(`SELECT id, data FROM issues WHERE data->>'alias'=$1`, [key]);
      if (rows.length) return { ...rows[0].data, id: String(rows[0].id).trim() };
    } catch (err) {
      throw new StorageUnavailableError("find edition by alias", err);
    }
  }
  const all = await dbListIssues();
  const byAlias = all.find(i => i.alias === key);
  if (byAlias) return byAlias;

  // Fallbacks for demo, latest, current, or legacy IDs
  if (key === "demo" || key === "latest" || key === "current" || key.includes("demo") || key === "ec22a9d0bbbd5" || key.includes("9cec51df7a48")) {
    return all.find(i => i.status === "public") || getDemoIssue();
  }

  return null;
}

// ── Scheduler ───────────────────────────────────────────────────────────
async function activateDueSchedules() {
  const issues = await dbListIssues();
  const now = new Date();
  for (const issue of issues) {
    if (issue.status === "scheduled" && issue.scheduledAt) {
      if (new Date(issue.scheduledAt) <= now) {
        issue.status = "public";
        issue.publishedAt = now.toISOString();
        await dbSaveIssue(issue);
        console.log(`⏰ Published scheduled issue: ${issue.title} (${issue.id})`);
      }
    }
  }
}

// ── Dashboard stats ─────────────────────────────────────────────────────
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

  const currentMonthViews = monthlyViews[currentMonth] || 0;
  const prevMonthViews = monthlyViews[previousMonth] || 0;
  const growth = prevMonthViews === 0 ? (currentMonthViews > 0 ? 100 : 0) : Math.round(((currentMonthViews - prevMonthViews) / prevMonthViews) * 100);

  const topIssues = [...issues].sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 5).map(i => ({ id: i.id, title: i.title, views: i.views || 0, date: i.date }));

  return {
    totalEditions: issues.length,
    activeEditions: issues.filter(i => i.status === "public").length,
    scheduledEditions: issues.filter(i => i.status === "scheduled").length,
    draftEditions: issues.filter(i => i.status === "draft").length,
    totalViews: issues.reduce((s, i) => s + (i.views || 0), 0),
    currentMonthViews,
    viewsGrowthPercent: growth,
    storage: {
      usedBytes,
      limitBytes: STORAGE_LIMIT_BYTES,
      usedPercentage: Math.min(100, Math.round((usedBytes / STORAGE_LIMIT_BYTES) * 1000) / 10),
      fileCount: issues.reduce((acc, i) => acc + (i.files ? i.files.length : 0), 0)
    },
    categoriesCount: categories.length,
    chart,
    topIssues
  };
}

// ── HTTP response helpers ───────────────────────────────────────────────
function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(payload));
}

function serveFile(res, filePath, contentType, status = 200, extraHeaders = {}) {
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(status, { "Content-Type": contentType, "Cache-Control": "no-cache", ...extraHeaders });
    res.end(data);
  });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    let size = 0;
    req.on("data", chunk => {
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) { reject(new Error("Request payload exceeds limit")); req.destroy(); }
      raw += chunk;
    });
    req.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch (e) { reject(new Error("Malformed JSON")); }
    });
    req.on("error", reject);
  });
}

// ── Auth & Security helpers (Reverse‑proxy and HTTPS friendly) ───────────
function parseCookies(header = "") {
  return header.split(";").reduce((acc, pair) => {
    const idx = pair.indexOf("=");
    if (idx > -1) acc[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
    return acc;
  }, {});
}

function getAdminSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[ADMIN_SESSION_COOKIE];
  if (!token) return null;
  const sess = adminSessions.get(token);
  if (!sess) return null;
  if (sess.expiresAt <= Date.now()) { adminSessions.delete(token); return null; }
  return { token, sess };
}

// Protocol-agnostic CSRF verification: works seamlessly behind Render/reverse proxy
function isSameOrigin(req) {
  const origin = req.headers.origin || req.headers.referer;
  if (!origin) return true; // Direct same-origin browser navigations
  try {
    const url = new URL(origin);
    const rawHost = req.headers["x-forwarded-host"] || req.headers.host;
    if (!rawHost) return true;
    const clientHost = rawHost.split(",")[0].trim().split(":")[0].toLowerCase();
    const originHost = url.hostname.toLowerCase();
    return originHost === clientHost || originHost === "localhost" || originHost === "127.0.0.1";
  } catch {
    return true;
  }
}

function getCookieSecurity(req) {
  const isHttps = Boolean(
    req.socket.encrypted ||
    req.headers["x-forwarded-proto"] === "https" ||
    (req.headers.origin && req.headers.origin.startsWith("https://")) ||
    (req.headers.referer && req.headers.referer.startsWith("https://"))
  );
  return isHttps ? "; Secure" : "";
}

function passwordsMatch(provided, expected) {
  const a = crypto.createHash("sha256").update(provided).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

function clearAdminSession(res, req, token = "") {
  if (token) adminSessions.delete(token);
  res.setHeader("Set-Cookie", `${ADMIN_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${getCookieSecurity(req)}`);
}

function slugify(text) {
  return text.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

function getBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || (req.socket.encrypted ? "https" : "http");
  const host = req.headers["x-forwarded-host"] || req.headers.host || `localhost:${PORT}`;
  return `${proto}://${host}`;
}

function publicIssue(issue, baseUrl) {
  const title = issue.name || issue.title || "Untitled Edition";
  const alias = issue.alias || "";
  const readerUrl = `${baseUrl}/paper/${alias || issue.id}`;
  return {
    id: issue.id,
    name: title,
    title: title,
    date: issue.date,
    category: issue.category || "Main Edition",
    status: issue.status || "public",
    scheduledAt: issue.scheduledAt || null,
    publishedAt: issue.publishedAt || null,
    alias,
    featured: Boolean(issue.featured),
    totalFiles: issue.files ? issue.files.length : 0,
    files: (issue.files || []).map(f => ({
      name: f.name,
      path: f.path,
      type: f.type,
      size: f.size,
      url: `${baseUrl}/media/${issue.id}/${f.path}`
    })),
    areas: issue.areas || [],
    url: readerUrl,
    readerUrl
  };
}

function decodeFiles(files = []) {
  if (!Array.isArray(files) || files.length === 0) throw new Error("At least one page/file must be provided.");
  return files.map((f, i) => {
    if (!f.data || typeof f.data !== "string") throw new Error(`File #${i + 1} has invalid content.`);
    const comma = f.data.indexOf(",");
    const b64 = comma > -1 ? f.data.slice(comma + 1) : f.data;
    const buf = Buffer.from(b64, "base64");
    if (buf.length > MAX_FILE_BYTES) throw new Error(`File #${i + 1} exceeds the 50 MB limit.`);
    const ext = path.extname(f.name || "").toLowerCase() || ".jpg";
    if (!MIME_BY_EXTENSION[ext]) throw new Error(`File #${i + 1} format (${ext}) is not supported.`);
    return { name: f.name || `page-${i + 1}${ext}`, buffer: buf, size: buf.length, type: MIME_BY_EXTENSION[ext], extension: ext };
  });
}

// ── Main HTTP Request Handler ───────────────────────────────────────────
async function handleRequest(req, res) {
  const baseUrl = getBaseUrl(req);
  const url = new URL(req.url, baseUrl);

  // Quick health-check while initial boot finishes
  if (url.pathname === "/" && !global.dbReady) {
    return sendJson(res, 200, { status: "warming-up", app: "Vachana Kranti" });
  }

  // ----- Auth endpoints -----
  if (req.method === "GET" && url.pathname === "/api/auth/session") {
    return sendJson(res, 200, {
      authenticated: Boolean(getAdminSession(req)),
      configured: Boolean(ADMIN_EMAIL && ADMIN_PASSWORD)
    });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    if (!isSameOrigin(req)) {
      return sendJson(res, 403, { error: "Login must originate from this site." });
    }
    if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
      return sendJson(res, 503, { error: "Admin credentials not configured." });
    }

    const now = Date.now();
    for (const [ip, a] of loginAttempts) if (a.expiresAt <= now) loginAttempts.delete(ip);
    const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket.remoteAddress || "unknown";
    const attempt = loginAttempts.get(ip);
    if (attempt && attempt.count >= MAX_LOGIN_ATTEMPTS && attempt.expiresAt > now) {
      return sendJson(res, 429, { error: "Too many login attempts. Please wait 15 minutes." });
    }

    const body = await readJson(req);
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const pw = typeof body.password === "string" ? body.password : "";
    const okEmail = email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
    const okPw = passwordsMatch(pw, ADMIN_PASSWORD);

    if (!okEmail || !okPw) {
      const next = attempt && attempt.expiresAt > now ? { count: attempt.count + 1, expiresAt: attempt.expiresAt } : { count: 1, expiresAt: now + LOGIN_ATTEMPT_WINDOW };
      loginAttempts.set(ip, next);
      if (next.count >= MAX_LOGIN_ATTEMPTS) return sendJson(res, 429, { error: "Too many login attempts. Please wait 15 minutes." });
      return sendJson(res, 401, { error: "Invalid email or password." });
    }

    loginAttempts.delete(ip);
    const token = crypto.randomBytes(32).toString("hex");
    const ttl = body.remember ? REMEMBERED_SESSION_LIFETIME : ADMIN_SESSION_LIFETIME;
    adminSessions.set(token, { expiresAt: Date.now() + ttl });
    res.setHeader("Set-Cookie", `${ADMIN_SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(ttl / 1000)}${getCookieSecurity(req)}`);
    return sendJson(res, 200, { authenticated: true });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    if (!isSameOrigin(req)) return sendJson(res, 403, { error: "Logout must originate from this site." });
    const sess = getAdminSession(req);
    clearAdminSession(res, req, sess?.token);
    return sendJson(res, 200, { authenticated: false });
  }

  // ----- Require auth for admin UI / management APIs -----
  const admin = getAdminSession(req);

  // Root URL: Public readers go straight to /paper; authenticated admin gets the admin desk
  if (req.method === "GET" && url.pathname === "/") {
    if (admin) {
      return serveFile(res, path.join(PUBLIC_DIR, "index.html"), "text/html; charset=utf-8");
    }
    res.writeHead(302, { Location: "/paper" });
    return res.end();
  }

  // Admin alias
  if (req.method === "GET" && url.pathname === "/admin") {
    if (admin) {
      res.writeHead(302, { Location: "/" });
      return res.end();
    }
    res.writeHead(302, { Location: "/login" });
    return res.end();
  }

  const adminPage = req.method === "GET" && ["/index.html", "/app.js"].includes(url.pathname);
  const adminApi = /^\/api\/(bootstrap|dashboard|issues(?:\/.*)?|categories(?:\/.*)?|settings|theme|pages(?:\/.*)?)$/.test(url.pathname);

  if (!admin && (adminPage || adminApi)) {
    if (adminPage) {
      res.writeHead(302, { Location: "/login" });
      return res.end();
    }
    return sendJson(res, 401, { error: "Session expired or missing. Please sign in." });
  }

  // Login page
  if (req.method === "GET" && (url.pathname === "/login" || url.pathname === "/login.html")) {
    if (admin) { res.writeHead(302, { Location: "/" }); return res.end(); }
    return serveFile(res, path.join(PUBLIC_DIR, "login.html"), "text/html; charset=utf-8");
  }

  // ----- Admin Bootstrap / Dashboard -----
  if (req.method === "GET" && url.pathname === "/api/bootstrap") {
    const [issues, categories, settings, theme, pages, stats] = await Promise.all([
      dbListIssues(), getCategories(), getSettings(), getTheme(), getPages(), getDashboardStats()
    ]);
    return sendJson(res, 200, {
      issues: issues.map(i => publicIssue(i, baseUrl)),
      categories, settings, theme, pages, stats
    });
  }

  if (req.method === "GET" && url.pathname === "/api/dashboard") {
    return sendJson(res, 200, await getDashboardStats());
  }

  // ----- Image Upload API -----
  if (req.method === "POST" && url.pathname === "/api/upload") {
    try {
      const b = await readJson(req);
      if (!b.data || typeof b.data !== "string") return sendJson(res, 400, { error: "No image data provided." });
      const rawComma = b.data.indexOf(",");
      const b64 = rawComma > -1 ? b.data.slice(rawComma + 1) : b.data;
      const buf = Buffer.from(b64, "base64");
      if (buf.length > 5 * 1024 * 1024) return sendJson(res, 400, { error: "Image exceeds 5 MB limit." });

      const ext = path.extname(b.name || "").toLowerCase() || ".png";
      const allowed = [".png", ".jpg", ".jpeg", ".webp", ".svg", ".ico", ".gif"];
      if (!allowed.includes(ext)) return sendJson(res, 400, { error: `Unsupported image format (${ext}). Allowed: ${allowed.join(", ")}` });

      const uploadsDir = path.join(PUBLIC_DIR, "uploads");
      fs.mkdirSync(uploadsDir, { recursive: true });
      const filename = `up-${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`;
      fs.writeFileSync(path.join(uploadsDir, filename), buf);

      return sendJson(res, 200, { url: `/uploads/${filename}`, filename, size: buf.length });
    } catch (err) {
      return sendJson(res, 500, { error: err.message || "Failed to upload image." });
    }
  }

  // ----- App Data (Settings, Theme, Pages, Categories) -----
  if (url.pathname === "/api/settings") {
    if (req.method === "GET") return sendJson(res, 200, { settings: await getSettings() });
    if (req.method === "PUT") {
      const b = await readJson(req);
      const curr = await getSettings();
      const next = { ...curr, ...b };
      await setAppData("settings", next);
      return sendJson(res, 200, { settings: next });
    }
  }

  if (url.pathname === "/api/theme") {
    if (req.method === "GET") return sendJson(res, 200, { theme: await getTheme() });
    if (req.method === "PUT") {
      const b = await readJson(req);
      const curr = await getTheme();
      const next = { ...curr, ...b };
      await setAppData("theme", next);
      return sendJson(res, 200, { theme: next });
    }
  }

  if (url.pathname === "/api/categories") {
    if (req.method === "GET") {
      const categories = await getCategories();
      const defaultCategory = (await getAppData("defaultCategory")) || categories[0] || "Main Edition";
      return sendJson(res, 200, { categories, defaultCategory });
    }
    if (req.method === "POST") {
      const b = await readJson(req);
      const name = typeof b.name === "string" ? b.name.trim() : "";
      if (!name) return sendJson(res, 400, { error: "Category name is required." });
      const cats = await getCategories();
      if (!cats.includes(name)) cats.push(name);
      await setAppData("categories", cats);
      return sendJson(res, 201, { categories: cats });
    }
  }

  if (url.pathname === "/api/categories/default" && req.method === "POST") {
    const b = await readJson(req);
    const name = typeof b.name === "string" ? b.name.trim() : "";
    if (name) {
      await setAppData("defaultCategory", name);
      return sendJson(res, 200, { defaultCategory: name });
    }
    return sendJson(res, 400, { error: "Category name is required." });
  }

  const catMatch = url.pathname.match(/^\/api\/categories\/(.+)$/);
  if (catMatch && url.pathname !== "/api/categories/default") {
    const oldName = decodeURIComponent(catMatch[1]);
    if (req.method === "PUT") {
      const b = await readJson(req);
      const newName = typeof b.name === "string" ? b.name.trim() : "";
      if (!newName) return sendJson(res, 400, { error: "New category name is required." });
      let cats = await getCategories();
      const idx = cats.indexOf(oldName);
      if (idx !== -1) {
        cats[idx] = newName;
      } else if (!cats.includes(newName)) {
        cats.push(newName);
      }
      await setAppData("categories", cats);
      const defCat = await getAppData("defaultCategory");
      if (defCat === oldName) await setAppData("defaultCategory", newName);

      // Update any issues having the old category name
      const issues = await dbListIssues();
      for (const issue of issues) {
        if (issue.category === oldName) {
          issue.category = newName;
          await dbSaveIssue(issue);
        }
      }
      return sendJson(res, 200, { categories: cats });
    }
    if (req.method === "DELETE") {
      let cats = await getCategories();
      cats = cats.filter(c => c !== oldName);
      await setAppData("categories", cats);
      return sendJson(res, 200, { categories: cats });
    }
  }

  if (url.pathname === "/api/pages") {
    if (req.method === "GET") return sendJson(res, 200, { pages: await getPages() });
    if (req.method === "POST") {
      const b = await readJson(req);
      const title = typeof b.title === "string" ? b.title.trim() : "";
      if (!title) return sendJson(res, 400, { error: "Page title is required." });
      const slug = slugify(b.slug || title);
      const pages = await getPages();
      if (pages.some(p => p.slug === slug)) return sendJson(res, 409, { error: "A page with this slug already exists." });
      const newPage = { slug, title, content: b.content || "", status: b.status || "public", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      pages.push(newPage);
      await setAppData("pages", pages);
      return sendJson(res, 201, { page: newPage });
    }
  }

  const pageMatch = url.pathname.match(/^\/api\/pages\/([a-z0-9-]+)$/);
  if (pageMatch) {
    const slug = pageMatch[1];
    let pages = await getPages();
    const idx = pages.findIndex(p => p.slug === slug);
    if (idx === -1) return sendJson(res, 404, { error: "Page not found." });
    if (req.method === "PUT") {
      const b = await readJson(req);
      pages[idx] = { ...pages[idx], ...b, updatedAt: new Date().toISOString() };
      await setAppData("pages", pages);
      return sendJson(res, 200, { page: pages[idx] });
    }
    if (req.method === "DELETE") {
      pages = pages.filter(p => p.slug !== slug);
      await setAppData("pages", pages);
      return sendJson(res, 200, { deleted: slug });
    }
  }

  // ----- Issues API -----
  if (url.pathname === "/api/issues") {
    if (req.method === "GET") {
      const issues = await dbListIssues();
      return sendJson(res, 200, { issues: issues.map(i => publicIssue(i, baseUrl)) });
    }
    if (req.method === "POST") {
      const body = await readJson(req);
      const id = crypto.randomBytes(6).toString("hex");
      const title = typeof body.name === "string" && body.name.trim()
        ? body.name.trim()
        : typeof body.title === "string" && body.title.trim()
        ? body.title.trim()
        : "Untitled Edition";
      const date = typeof body.date === "string" ? body.date : new Date().toISOString().slice(0, 10);
      const decoded = decodeFiles(body.files);

      const savedFiles = await dbSaveFiles(id, decoded);
      const issue = {
        id,
        name: title,
        title,
        date,
        category: body.category || "Main Edition",
        status: body.status || "draft",
        scheduledAt: body.scheduledAt || null,
        publishedAt: body.status === "public" ? new Date().toISOString() : null,
        alias: body.alias ? slugify(body.alias) : "",
        featured: Boolean(body.featured),
        views: 0,
        viewsByMonth: {},
        files: savedFiles,
        areas: Array.isArray(body.areas) ? body.areas : [],
        createdAt: new Date().toISOString()
      };
      await dbSaveIssue(issue);
      return sendJson(res, 201, { issue: publicIssue(issue, baseUrl) });
    }
  }

  const issueMatch = url.pathname.match(/^\/api\/issues\/([a-f0-9]{12})$/);
  if (issueMatch) {
    const id = issueMatch[1];
    const issue = await dbGetIssue(id);
    if (!issue) return sendJson(res, 404, { error: "Edition not found." });

    if (req.method === "GET") {
      return sendJson(res, 200, { issue: publicIssue(issue, baseUrl) });
    }
    if (req.method === "PUT") {
      const body = await readJson(req);
      if (body.name || body.title) {
        const val = (body.name || body.title).trim();
        issue.name = val;
        issue.title = val;
      }
      if (body.date) issue.date = body.date;
      if (body.category) issue.category = body.category;
      if (body.status) {
        issue.status = body.status;
        if (body.status === "public" && !issue.publishedAt) {
          issue.publishedAt = new Date().toISOString();
        }
      }
      if (body.alias !== undefined) issue.alias = body.alias ? slugify(body.alias) : "";
      if (body.featured !== undefined) issue.featured = Boolean(body.featured);
      if (body.scheduledAt !== undefined) issue.scheduledAt = body.scheduledAt;
      if (body.areas !== undefined) issue.areas = body.areas;

      if (body.files && Array.isArray(body.files) && body.files.length > 0) {
        const decoded = decodeFiles(body.files);
        issue.files = await dbSaveFiles(id, decoded);
      }
      issue.updatedAt = new Date().toISOString();
      await dbSaveIssue(issue);
      return sendJson(res, 200, { issue: publicIssue(issue, baseUrl) });
    }
    if (req.method === "DELETE") {
      await dbDeleteIssue(id);
      return sendJson(res, 200, { deleted: id });
    }
  }

  // ----- Public Reader & Pages endpoints -----
  if (req.method === "GET" && url.pathname === "/api/public-pages") {
    const pages = (await getPages()).filter(p => p.status === "public").map(p => ({ slug: p.slug, title: p.title }));
    return sendJson(res, 200, { pages });
  }

  const pubPageMatch = url.pathname.match(/^\/api\/public-pages\/([a-z0-9-]+)$/);
  if (req.method === "GET" && pubPageMatch) {
    const page = (await getPages()).find(p => p.slug === pubPageMatch[1] && p.status === "public");
    if (!page) return sendJson(res, 404, { error: "Page not found." });
    return sendJson(res, 200, { page });
  }

  const pubHtmlMatch = url.pathname.match(/^\/page\/([a-z0-9-]+)$/);
  if (req.method === "GET" && pubHtmlMatch) {
    return serveFile(res, path.join(PUBLIC_DIR, "info-page.html"), "text/html; charset=utf-8");
  }

  // ----- Public Reader API endpoint -----
  const readerApiMatch = url.pathname.match(/^\/api\/reader\/([a-z0-9-]+)$/);
  if (req.method === "GET" && readerApiMatch) {
    const key = readerApiMatch[1];
    let issue = null;
    const allPublic = (await dbListIssues()).filter(i => i.status === "public");
    if (key === "latest" || key === "current") {
      issue = allPublic[0] || null;
    } else {
      issue = await dbFindIssue(key);
    }

    if (!issue || (issue.status && issue.status !== "public")) {
      console.info(`Public edition lookup ${issue ? "unpublished" : "not found"}: ${key}`);
      return sendJson(res, 404, { error: "This edition is unavailable." });
    }

    const idx = allPublic.findIndex(i => i.id === issue.id);
    const newerIssue = idx > 0 ? { name: allPublic[idx - 1].name || allPublic[idx - 1].title, url: `/paper/${allPublic[idx - 1].alias || allPublic[idx - 1].id}` } : null;
    const olderIssue = idx < allPublic.length - 1 && idx !== -1 ? { name: allPublic[idx + 1].name || allPublic[idx + 1].title, url: `/paper/${allPublic[idx + 1].alias || allPublic[idx + 1].id}` } : null;
    const settings = await getSettings();
    const theme = await getTheme();

    return sendJson(res, 200, {
      issue: publicIssue(issue, baseUrl),
      newerIssue,
      olderIssue,
      settings,
      theme
    });
  }

  // Reader app page fallback & /demo alias
  if (req.method === "GET" && (url.pathname === "/paper" || url.pathname === "/paper/" || url.pathname === "/site" || url.pathname === "/demo")) {
    const allPublic = (await dbListIssues()).filter(i => i.status === "public");
    const latest = allPublic[0] || getDemoIssue();
    if (latest) {
      res.writeHead(302, { Location: `/paper/${latest.alias || latest.id}` });
      return res.end();
    }
    return serveFile(res, path.join(PUBLIC_DIR, "paper.html"), "text/html; charset=utf-8");
  }

  // Reader app page for specific edition
  const paperMatch = url.pathname.match(/^\/paper\/([a-z0-9-]+)$/);
  if (req.method === "GET" && paperMatch) {
    const rawKey = paperMatch[1];
    let issue = await dbFindIssue(rawKey);

    if (!issue || (issue.status && issue.status !== "public")) {
      console.info(`Public edition page ${issue ? "unpublished" : "not found"}: ${rawKey}`);
      return serveFile(res, path.join(PUBLIC_DIR, "paper.html"), "text/html; charset=utf-8", 404);
    }
    const month = new Date().toISOString().slice(0, 7);
    issue.views = (issue.views || 0) + 1;
    issue.viewsByMonth = issue.viewsByMonth || {};
    issue.viewsByMonth[month] = (issue.viewsByMonth[month] || 0) + 1;
    try {
      await dbSaveIssue(issue);
    } catch (err) {
      // View counter save failed (likely DB unavailable) — continue serving the page
      console.warn("View counter not saved:", err.message);
    }
    return serveFile(res, path.join(PUBLIC_DIR, "paper.html"), "text/html; charset=utf-8");
  }

  // ----- Static Uploaded Images (/uploads/*) -----
  if (req.method === "GET" && url.pathname.startsWith("/uploads/")) {
    const filename = path.basename(url.pathname);
    const targetPath = path.join(PUBLIC_DIR, "uploads", filename);
    if (fs.existsSync(targetPath)) {
      const ext = path.extname(filename).toLowerCase();
      const mime = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".svg": "image/svg+xml",
        ".ico": "image/x-icon",
        ".gif": "image/gif"
      }[ext] || "application/octet-stream";
      return serveFile(res, targetPath, mime);
    }
    res.writeHead(404);
    return res.end("Upload not found");
  }

  // ----- Media files -----
  const mediaMatch = url.pathname.match(/^\/media\/([a-z0-9-]+)\/((?:[0-9]{2}|rev-[0-9]+-[a-f0-9]{6}-[0-9]{2})\.(?:pdf|jpg|jpeg|png|webp|gif))$/);
  if (req.method === "GET" && mediaMatch) {
    const file = await dbGetFileByPath(mediaMatch[1], mediaMatch[2]);
    if (!file) { res.writeHead(404); return res.end("Media not found"); }

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
    if (useDb && pool) {
      try {
        await pool.query("SELECT 1");
        return sendJson(res, 200, { status: "ok", db: "connected" });
      } catch (error) {
        databaseInitializationError = error;
        console.error("PostgreSQL health check failed.", databaseErrorDetails(error));
        // Still return 200 so Render doesn't restart us — we can serve from local files
        return sendJson(res, 200, { status: "degraded", db: "fallback-local-file", note: "PostgreSQL unavailable, using local file storage" });
      }
    }

    // Local-file storage is always available (whether configured or as fallback)
    return sendJson(res, 200, { status: "ok", db: localFileStorageEnabled ? "local-file" : "fallback-local-file" });
  }

  // ----- Static assets (HTML, CSS, JS) -----
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    return serveFile(res, path.join(PUBLIC_DIR, "index.html"), "text/html; charset=utf-8");
  }

  const staticMap = {
    "/logo.png": ["logo.png", "image/png"],
    "/favicon.ico": ["logo.png", "image/png"],
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

  if (req.method === "GET" && url.pathname.startsWith("/paper/")) {
    return serveFile(res, path.join(PUBLIC_DIR, "paper.html"), "text/html; charset=utf-8", 404);
  }

  // Also serve any other static files from PUBLIC_DIR if they exist
  if (req.method === "GET") {
    const safePath = path.normalize(url.pathname).replace(/^(\.\.[\/\\])+/, "");
    const diskPath = path.join(PUBLIC_DIR, safePath);
    if (fs.existsSync(diskPath) && fs.statSync(diskPath).isFile()) {
      const ext = path.extname(diskPath).toLowerCase();
      const mime = MIME_BY_EXTENSION[ext] || "application/octet-stream";
      return serveFile(res, diskPath, mime);
    }
  }

  // Fallback 404
  res.writeHead(404);
  res.end("Not found");
}

// ── Server bootstrap ────────────────────────────────────────────────────
global.dbReady = false;
const server = http.createServer((req, res) => {
  handleRequest(req, res).catch(err => {
    const errorId = crypto.randomBytes(6).toString("hex");
    if (err instanceof StorageUnavailableError) {
      console.error(`Request ${errorId} failed during ${err.message}.`, databaseErrorDetails(err.cause || err));
    } else {
      console.error(`Request ${errorId} failed:`, err);
    }
    if (!res.headersSent) {
      const status = err instanceof StorageUnavailableError ? 503 : 500;
      const requestUrl = new URL(req.url, "http://localhost");
      if (req.method === "GET" && requestUrl.pathname.startsWith("/paper/")) {
        return serveFile(res, path.join(PUBLIC_DIR, "paper.html"), "text/html; charset=utf-8", status, { "X-Error-ID": errorId });
      }
      res.setHeader("X-Error-ID", errorId);
      return sendJson(res, status, {
        error: status === 503 ? "Edition storage is temporarily unavailable." : "The server could not complete this request.",
        errorId
      });
    }
    else res.destroy();
  });
});

server.listen(PORT, HOST, () => {
  console.log(`🚀 Vachana Kranti listening on http://${HOST}:${PORT}`);
  initializeDatabase()
    .then(() => {
      global.dbReady = true;
      if (!localFileStorageEnabled && !useDb) {
        console.warn("⚠️ Server started with database storage unavailable; edition requests will return 503.", {
          reason: databaseConfig.error || databaseErrorDetails(databaseInitializationError).code
        });
      } else {
        console.log("✅ System ready – API fully operational");
      }
    })
    .catch(err => {
      console.error("⚠️ Database initialization failed.", databaseErrorDetails(err));
      global.dbReady = true;
    });
});

// Periodic scheduler
setInterval(() => {
  if (global.dbReady && (localFileStorageEnabled || useDb)) {
    activateDueSchedules().catch(e => console.error("Scheduler error:", e));
  }
}, 30_000).unref();
