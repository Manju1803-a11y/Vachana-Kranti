const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "127.0.0.1";
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data", "issues");
const CATEGORIES_FILE = path.join(ROOT, "data", "categories.json");
const SETTINGS_FILE = path.join(ROOT, "data", "settings.json");
const THEME_FILE = path.join(ROOT, "data", "theme.json");
const PAGES_FILE = path.join(ROOT, "data", "pages.json");
const PUBLIC_DIR = path.join(ROOT, "public");
const MAX_REQUEST_BYTES = 70 * 1024 * 1024;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const STORAGE_LIMIT_BYTES = 10 * 1024 * 1024 * 1024;
const ADMIN_SESSION_COOKIE = "vk_admin_session";
const ADMIN_SESSION_LIFETIME = 8 * 60 * 60 * 1000;
const REMEMBERED_SESSION_LIFETIME = 30 * 24 * 60 * 60 * 1000;
const LOGIN_ATTEMPT_WINDOW = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const adminSessions = new Map();
const loginAttempts = new Map();
const MIME_BY_EXTENSION = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif"
};

fs.mkdirSync(DATA_DIR, { recursive: true });
let issueCache = null;
let issueByIdCache = null;
if (!fs.existsSync(CATEGORIES_FILE)) {
  fs.writeFileSync(CATEGORIES_FILE, JSON.stringify(["Main Edition", "Special Edition", "Supplement"], null, 2));
}

if (!fs.existsSync(SETTINGS_FILE)) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify({
    basic: { siteName: "Vachana Kranti", country: "India", timezone: "Asia/Kolkata", language: "en", credit: "Vachana Kranti", faviconUrl: "", logoUrl: "" },
    seo: { title: "Vachana Kranti — E-paper", description: "Read the latest Vachana Kranti digital editions.", keywords: "", canonicalUrl: "", robots: "index,follow" },
    social: { facebook: "", instagram: "", youtube: "", whatsapp: "", x: "" },
    push: { enabled: false, publicKey: "", vapidSubject: "" },
    watermark: { enabled: false, text: "Vachana Kranti", opacity: 35, position: "bottom-right" },
    integrations: { googleAnalyticsId: "", googleSiteVerification: "", recaptchaSiteKey: "", recaptchaSecretKey: "", facebookPixelId: "", heatmapSiteId: "" },
    pwa: { enabled: true, appName: "Vachana Kranti", shortName: "Vachana", themeColor: "#174c3a", backgroundColor: "#f4f6f2" },
    comments: { enabled: false, requireApproval: true, provider: "local" }
  }, null, 2));
}
if (!fs.existsSync(THEME_FILE)) {
  fs.writeFileSync(THEME_FILE, JSON.stringify({
    navbar: { title: "Vachana Kranti", tagline: "Digital edition", sticky: true },
    appearance: { primaryColor: "#174c3a", accentColor: "#d8ac5b", backgroundColor: "#f2f3ef", pageWidth: "900", font: "DM Sans", showCategory: true },
    additionalCss: ""
  }, null, 2));
}
if (!fs.existsSync(PAGES_FILE)) {
  fs.writeFileSync(PAGES_FILE, JSON.stringify([
    { slug: "privacy-policy", title: "Privacy Policy", content: "Privacy information for Vachana Kranti readers.", status: "public", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { slug: "disclaimer", title: "Disclaimer", content: "Information in Vachana Kranti editions is provided for general reading.", status: "public", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { slug: "terms-and-conditions", title: "Terms and Conditions", content: "Terms for using the Vachana Kranti e-paper site.", status: "public", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
  ], null, 2));
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function cookieValue(request, name) {
  const cookieHeader = request.headers.cookie || "";
  for (const item of cookieHeader.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() === name) return item.slice(separator + 1).trim();
  }
  return "";
}

function getAdminSession(request) {
  const token = cookieValue(request, ADMIN_SESSION_COOKIE);
  const session = adminSessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    adminSessions.delete(token);
    return null;
  }
  return { token, session };
}

function isSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return false;
  try {
    const parsedOrigin = new URL(origin);
    const expectedProtocol = request.socket.encrypted ? "https:" : "http:";
    return parsedOrigin.protocol === expectedProtocol && parsedOrigin.host === request.headers.host;
  } catch {
    return false;
  }
}

function passwordsMatch(provided, expected) {
  const providedDigest = crypto.createHash("sha256").update(provided).digest();
  const expectedDigest = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(providedDigest, expectedDigest);
}

function clearAdminSession(response, request, token = "") {
  if (token) adminSessions.delete(token);
  const secure = request.socket.encrypted ? "; Secure" : "";
  response.setHeader("Set-Cookie", `${ADMIN_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
}

function safeId(value) {
  return /^[a-f0-9]{12}$/.test(value);
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) {
        reject(new Error("Request is too large. The upload limit is 50 MB per file."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("The request body must be valid JSON."));
      }
    });
    request.on("error", reject);
  });
}

function getIssue(id) {
  if (!safeId(id)) return null;
  if (issueByIdCache?.has(id)) return issueByIdCache.get(id);
  const issuePath = path.join(DATA_DIR, id, "issue.json");
  try {
    const issue = JSON.parse(fs.readFileSync(issuePath, "utf8"));
    if (issueByIdCache) issueByIdCache.set(id, issue);
    return issue;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function saveIssue(issue) {
  const issuePath = path.join(DATA_DIR, issue.id, "issue.json");
  const temporaryPath = `${issuePath}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(issue, null, 2), { flag: "wx" });
    fs.renameSync(temporaryPath, issuePath);
    if (issueByIdCache) issueByIdCache.set(issue.id, issue);
    if (issueCache) {
      const index = issueCache.findIndex((item) => item.id === issue.id);
      if (index < 0) issueCache.push(issue);
      else issueCache[index] = issue;
      issueCache.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
    }
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

function saveJson(filePath, value) {
  const temporaryPath = `${filePath}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), { flag: "wx" });
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

function slugify(value) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

function listIssues() {
  if (!issueCache) {
    issueByIdCache = new Map();
    issueCache = fs.readdirSync(DATA_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && safeId(entry.name))
      .map((entry) => getIssue(entry.name))
      .filter(Boolean)
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }
  return issueCache;
}

function activateDueSchedules() {
  const now = Date.now();
  for (const issue of listIssues()) {
    if (issue.status === "scheduled" && issue.scheduledAt && Date.parse(issue.scheduledAt) <= now) {
      issue.status = "public";
      issue.publishedAt = new Date().toISOString();
      saveIssue(issue);
    }
  }
}

function findIssue(key) {
  if (safeId(key)) return getIssue(key);
  return listIssues().find((issue) => issue.alias === key) || null;
}

function publicIssue(issue, baseUrl) {
  return {
    ...issue,
    status: issue.status || "public",
    category: issue.category || "Main Edition",
    uploadType: issue.uploadType || inferUploadType(issue.files || []),
    metaTitle: issue.metaTitle || "",
    metaDescription: issue.metaDescription || "",
    alias: issue.alias || "",
    url: `${baseUrl}/paper/${issue.alias || issue.id}`
  };
}

function inferUploadType(files) {
  const pdfCount = files.filter((file) => file.type === "application/pdf").length;
  if (pdfCount === files.length) return "pdf";
  if (pdfCount === 0) return "images";
  return "mixed";
}

function getBaseUrl(request) {
  const protocol = request.headers["x-forwarded-proto"] || "http";
  const host = request.headers.host || `localhost:${PORT}`;
  return `${protocol}://${host}`;
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function decodeFiles(files, uploadType) {
  if (!Array.isArray(files) || files.length < 1 || files.length > 30) {
    throw new Error("Add between 1 and 30 PDF or image files.");
  }
  let totalBytes = 0;
  const decoded = files.map((file) => {
    if (!file || typeof file.name !== "string" || typeof file.data !== "string") {
      throw new Error("One of the selected files could not be read.");
    }
    const extension = path.extname(file.name).toLowerCase();
    const mimeType = MIME_BY_EXTENSION[extension];
    if (!mimeType) throw new Error(`“${file.name}” is not supported. Use PDF, JPG, PNG, WEBP, or GIF files.`);
    if (uploadType === "pdf" && mimeType !== "application/pdf") throw new Error("Upload type is set to PDF. Remove image files or choose PDF + images.");
    if (uploadType === "images" && mimeType === "application/pdf") throw new Error("Upload type is set to Images. Remove PDFs or choose PDF + images.");
    const buffer = Buffer.from(file.data, "base64");
    if (buffer.length === 0 || buffer.length > MAX_FILE_BYTES) throw new Error(`Each file must be smaller than 50 MB. Check “${file.name}”.`);
    totalBytes += buffer.length;
    return {
      name: path.basename(file.name).slice(0, 180),
      extension,
      type: mimeType,
      size: buffer.length,
      buffer
    };
  });
  return { files: decoded, totalBytes };
}

function getCategories() {
  return JSON.parse(fs.readFileSync(CATEGORIES_FILE, "utf8"));
}

function getSettings() {
  return readJsonFile(SETTINGS_FILE, {});
}

function getTheme() {
  return readJsonFile(THEME_FILE, {});
}

function getPages() {
  return readJsonFile(PAGES_FILE, []);
}

function validateIssueFields(body, existingIssue = null) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const date = typeof body.date === "string" ? body.date : "";
  const category = typeof body.category === "string" ? body.category.trim() : "Main Edition";
  const status = ["draft", "public", "scheduled"].includes(body.status) ? body.status : "public";
  const incomingFiles = Array.isArray(body.files) ? body.files : [];
  const inferredType = existingIssue
    ? existingIssue.uploadType || inferUploadType(existingIssue.files || [])
    : incomingFiles.length
      ? inferUploadType(incomingFiles.map((file) => ({
        type: MIME_BY_EXTENSION[path.extname(file.name || "").toLowerCase()]
      })))
      : "mixed";
  const uploadType = ["pdf", "images", "mixed"].includes(body.uploadType) ? body.uploadType : inferredType;
  const alias = typeof body.alias === "string" ? body.alias.trim().toLowerCase() : "";
  const metaTitle = typeof body.metaTitle === "string" ? body.metaTitle.trim().slice(0, 160) : "";
  const metaDescription = typeof body.metaDescription === "string" ? body.metaDescription.trim().slice(0, 500) : "";
  const scheduledAt = typeof body.scheduledAt === "string" && body.scheduledAt ? body.scheduledAt : "";

  if (!name || name.length > 120) throw new Error("Enter an edition name (up to 120 characters).");
  if (!validDate(date)) throw new Error("Choose a valid publication date.");
  if (!getCategories().includes(category)) throw new Error("Choose a category from the list.");
  if (alias && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(alias)) {
    throw new Error("URL alias can contain lowercase letters, numbers, and single hyphens.");
  }
  const aliasOwner = alias && listIssues().find((issue) =>
    (issue.alias === alias || issue.id === alias) && issue.id !== existingIssue?.id
  );
  if (aliasOwner) throw new Error("That URL alias is already being used by another edition.");
  if (status === "scheduled") {
    if (!scheduledAt || !Number.isFinite(Date.parse(scheduledAt)) || Date.parse(scheduledAt) <= Date.now()) {
      throw new Error("Choose a future date and time to schedule this edition.");
    }
  }

  return { name, date, category, status, uploadType, alias, metaTitle, metaDescription, scheduledAt };
}

function fileSizeTotal(issues = listIssues()) {
  let total = 0;
  for (const issue of issues) {
    for (const file of issue.files || []) total += file.size || 0;
  }
  return total;
}

function getDashboardStats() {
  const issues = listIssues();
  const now = new Date();
  const currentMonth = now.toISOString().slice(0, 7);
  const previousDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const previousMonth = previousDate.toISOString().slice(0, 7);
  const usedBytes = fileSizeTotal(issues);
  const categories = getCategories();
  const monthlyViews = {};

  for (const issue of issues) {
    for (const [month, count] of Object.entries(issue.viewsByMonth || {})) {
      monthlyViews[month] = (monthlyViews[month] || 0) + count;
    }
  }

  const chart = [];
  for (let offset = 5; offset >= 0; offset -= 1) {
    const monthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    const month = monthDate.toISOString().slice(0, 7);
    chart.push({
      month,
      label: monthDate.toLocaleDateString("en", { month: "short", timeZone: "UTC" }),
      views: monthlyViews[month] || 0
    });
  }

  return {
    totalEditions: issues.length,
    categoryCount: categories.length,
    thisMonthVisitors: monthlyViews[currentMonth] || 0,
    lastMonthVisitors: monthlyViews[previousMonth] || 0,
    usedBytes,
    totalBytes: STORAGE_LIMIT_BYTES,
    chart,
    scheduled: issues.filter((issue) => issue.status === "scheduled").length,
    upcoming: issues
      .filter((issue) => issue.status === "scheduled")
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
      .slice(0, 5)
  };
}

function serveFile(response, filePath, contentType) {
  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-cache"
    });
    response.end(content);
  });
}

function serveMedia(request, response, filePath, contentType) {
  fs.stat(filePath, (statError, stats) => {
    if (statError) {
      response.writeHead(statError.code === "ENOENT" ? 404 : 500);
      response.end(statError.code === "ENOENT" ? "Not found" : "Unable to read file");
      return;
    }

    let start = 0;
    let end = stats.size - 1;
    let status = 200;
    const range = request.headers.range;
    if (range) {
      const match = range.match(/^bytes=(\d*)-(\d*)$/);
      if (!match || (!match[1] && !match[2])) {
        response.writeHead(416, { "Content-Range": `bytes */${stats.size}` });
        response.end();
        return;
      }
      if (!match[1]) {
        const suffixLength = Number(match[2]);
        start = Math.max(0, stats.size - suffixLength);
      } else {
        start = Number(match[1]);
        if (match[2]) end = Math.min(Number(match[2]), stats.size - 1);
      }
      if (start >= stats.size || start > end) {
        response.writeHead(416, { "Content-Range": `bytes */${stats.size}` });
        response.end();
        return;
      }
      status = 206;
    }

    const headers = {
      "Content-Type": contentType,
      "Content-Length": end - start + 1,
      "Accept-Ranges": "bytes",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=31536000, immutable"
    };
    if (status === 206) headers["Content-Range"] = `bytes ${start}-${end}/${stats.size}`;
    const stream = fs.createReadStream(filePath, { start, end });
    stream.on("error", (error) => {
      console.error("Media stream failed:", error);
      if (!response.headersSent) {
        response.writeHead(500);
        response.end("Unable to read file");
      } else {
        response.destroy(error);
      }
    });
    response.writeHead(status, headers);
    stream.pipe(response);
  });
}

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  if (request.method === "GET" && url.pathname === "/login") {
    if (getAdminSession(request)) {
      response.writeHead(302, { Location: "/" });
      return response.end();
    }
    return serveFile(response, path.join(PUBLIC_DIR, "login.html"), "text/html; charset=utf-8");
  }

  if (request.method === "GET" && url.pathname === "/api/auth/session") {
    return sendJson(response, 200, {
      authenticated: Boolean(getAdminSession(request)),
      configured: Boolean(process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD)
    });
  }

  if (request.method === "POST" && url.pathname === "/api/auth/login") {
    if (!isSameOrigin(request)) return sendJson(response, 403, { error: "Sign-in requests must come from this site." });
    if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
      return sendJson(response, 503, { error: "Admin sign-in is not configured. Set ADMIN_EMAIL and ADMIN_PASSWORD in the server environment." });
    }

    const address = request.socket.remoteAddress || "unknown";
    const now = Date.now();
    for (const [key, attempt] of loginAttempts) {
      if (attempt.expiresAt <= now) loginAttempts.delete(key);
    }
    const attempt = loginAttempts.get(address);
    if (attempt && attempt.count >= MAX_LOGIN_ATTEMPTS && attempt.expiresAt > now) {
      return sendJson(response, 429, { error: "Too many sign-in attempts. Try again in 15 minutes." });
    }

    let body;
    try {
      body = await readJson(request);
    } catch (error) {
      return sendJson(response, 400, { error: error.message });
    }
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const emailValid = passwordsMatch(email, process.env.ADMIN_EMAIL);
    const passwordValid = passwordsMatch(password, process.env.ADMIN_PASSWORD);
    if (!emailValid || !passwordValid) {
      const nextAttempt = attempt && attempt.expiresAt > now
        ? { count: attempt.count + 1, expiresAt: attempt.expiresAt }
        : { count: 1, expiresAt: now + LOGIN_ATTEMPT_WINDOW };
      loginAttempts.set(address, nextAttempt);
      if (nextAttempt.count >= MAX_LOGIN_ATTEMPTS) {
        return sendJson(response, 429, { error: "Too many sign-in attempts. Try again in 15 minutes." });
      }
      return sendJson(response, 401, { error: "The email or password is incorrect." });
    }

    loginAttempts.delete(address);
    for (const [token, session] of adminSessions) {
      if (session.expiresAt <= now) adminSessions.delete(token);
    }
    const token = crypto.randomBytes(32).toString("hex");
    const lifetime = body.remember === true ? REMEMBERED_SESSION_LIFETIME : ADMIN_SESSION_LIFETIME;
    adminSessions.set(token, { expiresAt: now + lifetime });
    const secure = request.socket.encrypted ? "; Secure" : "";
    response.setHeader("Set-Cookie", `${ADMIN_SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(lifetime / 1000)}${secure}`);
    return sendJson(response, 200, { authenticated: true });
  }

  if (request.method === "POST" && url.pathname === "/api/auth/logout") {
    if (!isSameOrigin(request)) return sendJson(response, 403, { error: "Sign-out requests must come from this site." });
    const session = getAdminSession(request);
    clearAdminSession(response, request, session?.token);
    return sendJson(response, 200, { authenticated: false });
  }

  const adminSession = getAdminSession(request);
  const isAdminPage = request.method === "GET" && ["/", "/index.html", "/app.js"].includes(url.pathname);
  const isAdminApi = /^\/api\/(bootstrap|dashboard|issues(?:\/.*)?|categories(?:\/.*)?|settings|theme|pages(?:\/.*)?)$/.test(url.pathname);
  if (!adminSession && (isAdminPage || isAdminApi)) {
    if (isAdminPage) {
      response.writeHead(302, { Location: "/login" });
      return response.end();
    }
    return sendJson(response, 401, { error: "Your session is missing or expired. Sign in to continue." });
  }
  if (adminSession && isAdminApi && !["GET", "HEAD", "OPTIONS"].includes(request.method) && !isSameOrigin(request)) {
    return sendJson(response, 403, { error: "This request did not originate from the signed-in site." });
  }

  if (request.method === "GET" && url.pathname === "/api/bootstrap") {
    activateDueSchedules();
    const allIssues = listIssues();
    const categories = getCategories();
    const settings = getSettings();
    return sendJson(response, 200, {
      issues: allIssues.map((issue) => publicIssue(issue, getBaseUrl(request))),
      categories,
      defaultCategory: categories.includes(settings.defaultCategory) ? settings.defaultCategory : categories[0],
      settings: { basic: settings.basic || {} },
      dashboard: getDashboardStats()
    });
  }

  const readerApiMatch = url.pathname.match(/^\/api\/reader\/([a-z0-9-]{1,60})$/);
  if (request.method === "GET" && readerApiMatch) {
    activateDueSchedules();
    const allIssues = listIssues();
    const index = allIssues.findIndex((item) => item.id === readerApiMatch[1] || item.alias === readerApiMatch[1]);
    const issue = index >= 0 ? allIssues[index] : null;
    if (!issue || (issue.status && issue.status !== "public")) {
      return sendJson(response, 404, { error: "This e-paper issue was not found." });
    }
    const settings = getSettings();
    return sendJson(response, 200, {
      issue: publicIssue(issue, getBaseUrl(request)),
      newerIssue: index > 0 ? publicIssue(allIssues[index - 1], getBaseUrl(request)) : null,
      olderIssue: index < allIssues.length - 1 ? publicIssue(allIssues[index + 1], getBaseUrl(request)) : null,
      theme: getTheme(),
      config: {
        basic: settings.basic || {},
        watermark: settings.watermark || {},
        social: settings.social || {},
        seo: settings.seo || {}
      },
      pages: getPages().filter((page) => page.status === "public").map(({ slug, title }) => ({ slug, title }))
    });
  }

  if (request.method === "GET" && url.pathname === "/api/issues") {
    activateDueSchedules();
    return sendJson(response, 200, { issues: listIssues().map((issue) => publicIssue(issue, getBaseUrl(request))) });
  }

  if (request.method === "GET" && url.pathname === "/api/dashboard") {
    activateDueSchedules();
    return sendJson(response, 200, getDashboardStats());
  }

  if (request.method === "GET" && url.pathname === "/api/categories") {
    const settings = getSettings();
    const categories = getCategories();
    const defaultCategory = categories.includes(settings.defaultCategory) ? settings.defaultCategory : categories[0];
    return sendJson(response, 200, { categories, defaultCategory });
  }

  if (request.method === "POST" && url.pathname === "/api/categories") {
    try {
      const body = await readJson(request);
      const category = typeof body.name === "string" ? body.name.trim() : "";
      if (!category || category.length > 50) return sendJson(response, 400, { error: "Enter a category name up to 50 characters." });
      const categories = getCategories();
      if (categories.some((item) => item.toLowerCase() === category.toLowerCase())) {
        return sendJson(response, 409, { error: "That category already exists." });
      }
      categories.push(category);
      saveJson(CATEGORIES_FILE, categories);
      if (categories.length === 1) {
        const settings = getSettings();
        settings.defaultCategory = category;
        saveJson(SETTINGS_FILE, settings);
      }
      return sendJson(response, 201, { categories, defaultCategory: getSettings().defaultCategory || categories[0] });
    } catch (error) {
      return sendJson(response, 400, { error: error.message || "Unable to add category." });
    }
  }

  if (request.method === "POST" && url.pathname === "/api/categories/default") {
    try {
      const body = await readJson(request);
      const category = typeof body.name === "string" ? body.name.trim() : "";
      if (!getCategories().includes(category)) return sendJson(response, 400, { error: "Choose an existing category as the default." });
      const settings = getSettings();
      settings.defaultCategory = category;
      saveJson(SETTINGS_FILE, settings);
      return sendJson(response, 200, { defaultCategory: category });
    } catch (error) {
      return sendJson(response, 400, { error: error.message || "Unable to set the default category." });
    }
  }

  const categoryMatch = url.pathname.match(/^\/api\/categories\/([^/]+)$/);
  if (categoryMatch && ["PUT", "DELETE"].includes(request.method)) {
    let previousName;
    try {
      previousName = decodeURIComponent(categoryMatch[1]);
    } catch {
      return sendJson(response, 400, { error: "The category name is not a valid URL value." });
    }
    const categories = getCategories();
    if (!categories.includes(previousName)) return sendJson(response, 404, { error: "Category not found." });
    if (request.method === "PUT") {
      try {
        const body = await readJson(request);
        const nextName = typeof body.name === "string" ? body.name.trim() : "";
        if (!nextName || nextName.length > 50) return sendJson(response, 400, { error: "Enter a category name up to 50 characters." });
        if (categories.some((item) => item.toLowerCase() === nextName.toLowerCase() && item !== previousName)) {
          return sendJson(response, 409, { error: "That category already exists." });
        }
        const nextCategories = categories.map((item) => item === previousName ? nextName : item);
        saveJson(CATEGORIES_FILE, nextCategories);
        for (const issue of listIssues().filter((item) => item.category === previousName)) {
          issue.category = nextName;
          saveIssue(issue);
        }
        const settings = getSettings();
        if (settings.defaultCategory === previousName) {
          settings.defaultCategory = nextName;
          saveJson(SETTINGS_FILE, settings);
        }
        return sendJson(response, 200, { categories: nextCategories, defaultCategory: settings.defaultCategory || nextCategories[0] });
      } catch (error) {
        return sendJson(response, 400, { error: error.message || "Unable to rename category." });
      }
    }
    const settings = getSettings();
    if (settings.defaultCategory === previousName) return sendJson(response, 409, { error: "Choose a different default category before removing this one." });
    if (listIssues().some((issue) => issue.category === previousName)) {
      return sendJson(response, 409, { error: "This category is assigned to editions. Move those editions to another category before removing it." });
    }
    if (categories.length <= 1) return sendJson(response, 409, { error: "At least one category must remain." });
    const nextCategories = categories.filter((item) => item !== previousName);
    saveJson(CATEGORIES_FILE, nextCategories);
    return sendJson(response, 200, { categories: nextCategories, defaultCategory: settings.defaultCategory || nextCategories[0] });
  }

  if (request.method === "GET" && url.pathname === "/api/settings") {
    return sendJson(response, 200, { settings: getSettings() });
  }

  if (request.method === "GET" && url.pathname === "/api/public-config") {
    const settings = getSettings();
    const { basic, watermark, social, seo } = settings;
    return sendJson(response, 200, {
      basic: basic || {},
      watermark: watermark || {},
      social: social || {},
      seo: seo || {}
    });
  }

  if (request.method === "PUT" && url.pathname === "/api/settings") {
    try {
      const body = await readJson(request);
      const section = typeof body.section === "string" ? body.section : "";
      const allowedSections = ["basic", "seo", "social", "push", "watermark", "integrations", "pwa", "comments"];
      if (!allowedSections.includes(section) || !body.values || typeof body.values !== "object" || Array.isArray(body.values)) {
        return sendJson(response, 400, { error: "Choose a settings section and provide its values." });
      }
      const settings = getSettings();
      const current = settings[section] || {};
      const values = {};
      for (const [key, value] of Object.entries(body.values)) {
        if (!(key in current)) continue;
        if (typeof current[key] === "boolean") values[key] = Boolean(value);
        else if (typeof current[key] === "number") {
          const number = Number(value);
          if (!Number.isFinite(number)) return sendJson(response, 400, { error: `Enter a valid value for ${key}.` });
          values[key] = Math.min(100, Math.max(0, number));
        } else if (typeof value === "string") values[key] = value.trim().slice(0, key.toLowerCase().includes("css") ? 12000 : 2000);
      }
      settings[section] = { ...current, ...values };
      saveJson(SETTINGS_FILE, settings);
      return sendJson(response, 200, { settings });
    } catch (error) {
      return sendJson(response, 400, { error: error.message || "Unable to save site settings." });
    }
  }

  if (request.method === "GET" && url.pathname === "/api/theme") {
    return sendJson(response, 200, { theme: getTheme() });
  }

  if (request.method === "PUT" && url.pathname === "/api/theme") {
    try {
      const body = await readJson(request);
      const section = typeof body.section === "string" ? body.section : "";
      const allowedSections = ["navbar", "appearance", "additionalCss"];
      if (!allowedSections.includes(section)) return sendJson(response, 400, { error: "Choose a theme section to save." });
      const theme = getTheme();
      if (section === "additionalCss") {
        theme.additionalCss = typeof body.value === "string" ? body.value.slice(0, 12000) : "";
      } else if (body.values && typeof body.values === "object" && !Array.isArray(body.values)) {
        const current = theme[section] || {};
        const next = { ...current };
        for (const [key, value] of Object.entries(body.values)) {
          if (!(key in current)) continue;
          if (section === "appearance" && key === "pageWidth") {
            const width = Number(value);
            if (!Number.isFinite(width) || width < 600 || width > 1400) {
              return sendJson(response, 400, { error: "Reader page width must be between 600 and 1400 pixels." });
            }
            next[key] = String(width);
            continue;
          }
          if (section === "appearance" && ["primaryColor", "accentColor", "backgroundColor"].includes(key)) {
            if (typeof value !== "string" || !/^#[a-f0-9]{6}$/i.test(value)) {
              return sendJson(response, 400, { error: `Choose a valid color for ${key}.` });
            }
            next[key] = value;
            continue;
          }
          if (section === "appearance" && key === "font") {
            if (!["DM Sans", "Arial", "Georgia", "system-ui"].includes(value)) {
              return sendJson(response, 400, { error: "Choose a supported reader font." });
            }
            next[key] = value;
            continue;
          }
          if (typeof current[key] === "boolean") next[key] = Boolean(value);
          else if (typeof value === "string") next[key] = value.trim().slice(0, 200);
        }
        theme[section] = next;
      } else {
        return sendJson(response, 400, { error: "Provide theme settings to save." });
      }
      saveJson(THEME_FILE, theme);
      return sendJson(response, 200, { theme });
    } catch (error) {
      return sendJson(response, 400, { error: error.message || "Unable to save theme." });
    }
  }

  if (request.method === "GET" && url.pathname === "/api/pages") {
    return sendJson(response, 200, { pages: getPages().sort((a, b) => a.title.localeCompare(b.title)) });
  }

  if (request.method === "POST" && url.pathname === "/api/pages") {
    try {
      const body = await readJson(request);
      const title = typeof body.title === "string" ? body.title.trim() : "";
      const content = typeof body.content === "string" ? body.content.trim() : "";
      const slug = slugify(typeof body.slug === "string" && body.slug.trim() ? body.slug : title);
      const status = body.status === "draft" ? "draft" : "public";
      if (!title || title.length > 120) return sendJson(response, 400, { error: "Enter a page title up to 120 characters." });
      if (!content || content.length > 100000) return sendJson(response, 400, { error: "Enter page content up to 100,000 characters." });
      if (!slug) return sendJson(response, 400, { error: "Enter a valid page URL slug." });
      const pages = getPages();
      if (pages.some((page) => page.slug === slug)) return sendJson(response, 409, { error: "That page URL already exists." });
      const page = { slug, title, content, status, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      pages.push(page);
      saveJson(PAGES_FILE, pages);
      return sendJson(response, 201, { page });
    } catch (error) {
      return sendJson(response, 400, { error: error.message || "Unable to create page." });
    }
  }

  const pageApiMatch = url.pathname.match(/^\/api\/pages\/([a-z0-9-]{1,60})$/);
  if (pageApiMatch && ["PUT", "DELETE"].includes(request.method)) {
    const pages = getPages();
    const index = pages.findIndex((page) => page.slug === pageApiMatch[1]);
    if (index < 0) return sendJson(response, 404, { error: "Page not found." });
    if (request.method === "DELETE") {
      pages.splice(index, 1);
      saveJson(PAGES_FILE, pages);
      return sendJson(response, 200, { deleted: pageApiMatch[1] });
    }
    try {
      const body = await readJson(request);
      const title = typeof body.title === "string" ? body.title.trim() : "";
      const content = typeof body.content === "string" ? body.content.trim() : "";
      const slug = slugify(typeof body.slug === "string" && body.slug.trim() ? body.slug : title);
      const status = body.status === "draft" ? "draft" : "public";
      if (!title || title.length > 120) return sendJson(response, 400, { error: "Enter a page title up to 120 characters." });
      if (!content || content.length > 100000) return sendJson(response, 400, { error: "Enter page content up to 100,000 characters." });
      if (!slug) return sendJson(response, 400, { error: "Enter a valid page URL slug." });
      if (pages.some((page, pageIndex) => page.slug === slug && pageIndex !== index)) return sendJson(response, 409, { error: "That page URL already exists." });
      const page = { ...pages[index], slug, title, content, status, updatedAt: new Date().toISOString() };
      pages[index] = page;
      saveJson(PAGES_FILE, pages);
      return sendJson(response, 200, { page });
    } catch (error) {
      return sendJson(response, 400, { error: error.message || "Unable to update page." });
    }
  }

  if (request.method === "POST" && url.pathname === "/api/issues") {
    let issueDirectory;
    try {
      const body = await readJson(request);
      const files = Array.isArray(body.files) ? body.files : [];
      if (files.length < 1 || files.length > 30) {
        return sendJson(response, 400, { error: "Add between 1 and 30 PDF or image files." });
      }
      const fields = validateIssueFields(body);
      const uploads = decodeFiles(files, fields.uploadType);
      if (fileSizeTotal() + uploads.totalBytes > STORAGE_LIMIT_BYTES) {
        throw new Error("This upload would exceed the 10 GB local storage allowance.");
      }
      const id = crypto.randomBytes(6).toString("hex");
      issueDirectory = path.join(DATA_DIR, id);
      fs.mkdirSync(issueDirectory, { recursive: false });
      const savedFiles = uploads.files.map((file, index) => {
        const fileName = `${String(index + 1).padStart(2, "0")}${file.extension}`;
        fs.writeFileSync(path.join(issueDirectory, fileName), file.buffer, { flag: "wx" });
        return { name: file.name, path: fileName, type: file.type, size: file.size };
      });

      const issue = {
        id,
        ...fields,
        createdAt: new Date().toISOString(),
        publishedAt: fields.status === "public" ? new Date().toISOString() : null,
        viewsByMonth: {},
        files: savedFiles
      };
      saveIssue(issue);
      return sendJson(response, 201, { issue: publicIssue(issue, getBaseUrl(request)) });
    } catch (error) {
      if (issueDirectory) fs.rmSync(issueDirectory, { recursive: true, force: true });
      if (error.message.includes("too large")) return sendJson(response, 413, { error: error.message });
      return sendJson(response, 400, { error: error.message || "Unable to publish this issue." });
    }
  }

  const issueApiMatch = url.pathname.match(/^\/api\/issues\/([a-f0-9]{12})$/);
  if (issueApiMatch && request.method === "PUT") {
    const issue = getIssue(issueApiMatch[1]);
    if (!issue) return sendJson(response, 404, { error: "Edition not found." });
    let stagingDirectory = null;
    let replacementPaths = [];
    let saved = false;
    try {
      const body = await readJson(request);
      const fields = validateIssueFields(body, issue);
      const oldFiles = issue.files || [];
      let replacementFiles = null;
      if (!Object.hasOwn(body, "files")) {
        const existingPdfCount = oldFiles.filter((file) => file.type === "application/pdf").length;
        if (fields.uploadType === "pdf" && existingPdfCount !== oldFiles.length) {
          throw new Error("Upload type is set to PDF but this edition contains images. Replace the pages or choose PDF + images.");
        }
        if (fields.uploadType === "images" && existingPdfCount > 0) {
          throw new Error("Upload type is set to Images but this edition contains PDFs. Replace the pages or choose PDF + images.");
        }
      }
      if (Object.hasOwn(body, "files")) {
        if (!Array.isArray(body.files)) throw new Error("Replacement pages must be uploaded as a file list.");
        if (body.files.length > 0) {
          const uploads = decodeFiles(body.files, fields.uploadType);
          const oldBytes = oldFiles.reduce((total, file) => total + (file.size || 0), 0);
          if (fileSizeTotal() - oldBytes + uploads.totalBytes > STORAGE_LIMIT_BYTES) {
            throw new Error("This upload would exceed the 10 GB local storage allowance.");
          }
          const version = `rev-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
          stagingDirectory = path.join(DATA_DIR, `${issue.id}.staging-${crypto.randomBytes(4).toString("hex")}`);
          fs.mkdirSync(stagingDirectory, { recursive: false });
          replacementFiles = uploads.files.map((file, index) => {
            const fileName = `${version}-${String(index + 1).padStart(2, "0")}${file.extension}`;
            fs.writeFileSync(path.join(stagingDirectory, fileName), file.buffer, { flag: "wx" });
            return { name: file.name, path: fileName, type: file.type, size: file.size };
          });
          for (const file of replacementFiles) {
            const targetPath = path.join(DATA_DIR, issue.id, file.path);
            fs.renameSync(path.join(stagingDirectory, file.path), targetPath);
            replacementPaths.push(targetPath);
          }
        }
      }
      Object.assign(issue, fields, {
        publishedAt: fields.status === "public" ? (issue.publishedAt || new Date().toISOString()) : null,
        updatedAt: new Date().toISOString(),
        ...(replacementFiles ? { files: replacementFiles } : {})
      });
      saveIssue(issue);
      saved = true;
      if (replacementFiles) {
        for (const file of oldFiles) {
          if (file.path && path.basename(file.path) === file.path) {
            fs.rmSync(path.join(DATA_DIR, issue.id, file.path), { force: true });
          }
        }
      }
      return sendJson(response, 200, { issue: publicIssue(issue, getBaseUrl(request)) });
    } catch (error) {
      return sendJson(response, 400, { error: error.message || "Unable to update this edition." });
    } finally {
      if (!saved) replacementPaths.forEach((filePath) => fs.rmSync(filePath, { force: true }));
      if (stagingDirectory) fs.rmSync(stagingDirectory, { recursive: true, force: true });
    }
  }

  if (issueApiMatch && request.method === "DELETE") {
    const issue = getIssue(issueApiMatch[1]);
    if (!issue) return sendJson(response, 404, { error: "Edition not found." });
    fs.rmSync(path.join(DATA_DIR, issue.id), { recursive: true, force: false });
    issueByIdCache?.delete(issue.id);
    if (issueCache) issueCache = issueCache.filter((item) => item.id !== issue.id);
    return sendJson(response, 200, { deleted: issue.id });
  }

  const publicPageMatch = url.pathname.match(/^\/api\/public-pages\/([a-z0-9-]{1,60})$/);
  if (request.method === "GET" && url.pathname === "/api/public-pages") {
    const publicPages = getPages()
      .filter((page) => page.status === "public")
      .map(({ slug, title }) => ({ slug, title }));
    return sendJson(response, 200, { pages: publicPages });
  }
  if (request.method === "GET" && publicPageMatch) {
    const page = getPages().find((item) => item.slug === publicPageMatch[1] && item.status === "public");
    if (!page) return sendJson(response, 404, { error: "This information page was not found." });
    return sendJson(response, 200, { page });
  }

  const publicPageRoute = url.pathname.match(/^\/page\/([a-z0-9-]{1,60})$/);
  if (request.method === "GET" && publicPageRoute) {
    const page = getPages().find((item) => item.slug === publicPageRoute[1] && item.status === "public");
    if (!page) {
      response.writeHead(404);
      return response.end("This information page was not found.");
    }
    return serveFile(response, path.join(PUBLIC_DIR, "info-page.html"), "text/html; charset=utf-8");
  }

  const paperMatch = url.pathname.match(/^\/paper\/([a-z0-9-]{1,60})$/);
  if (request.method === "GET" && paperMatch) {
    const issue = findIssue(paperMatch[1]);
    if (!issue || (issue.status && issue.status !== "public")) {
      response.writeHead(404);
      return response.end("This e-paper issue was not found.");
    }
    const month = new Date().toISOString().slice(0, 7);
    issue.viewsByMonth = issue.viewsByMonth || {};
    issue.viewsByMonth[month] = (issue.viewsByMonth[month] || 0) + 1;
    saveIssue(issue);
    return serveFile(response, path.join(PUBLIC_DIR, "paper.html"), "text/html; charset=utf-8");
  }

  const issueFileMatch = url.pathname.match(/^\/media\/([a-f0-9]{12})\/((?:[0-9]{2}|rev-[0-9]+-[a-f0-9]{6}-[0-9]{2})\.(?:pdf|jpg|jpeg|png|webp|gif))$/);
  if (request.method === "GET" && issueFileMatch) {
    const issue = getIssue(issueFileMatch[1]);
    const file = issue && issue.files.find((item) => item.path === issueFileMatch[2]);
    if (!file) {
      response.writeHead(404);
      return response.end("Not found");
    }
    return serveMedia(request, response, path.join(DATA_DIR, issue.id, file.path), file.type);
  }

  if (request.method === "GET" && url.pathname === "/api/health") {
    return sendJson(response, 200, { status: "ok" });
  }

  if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    return serveFile(response, path.join(PUBLIC_DIR, "index.html"), "text/html; charset=utf-8");
  }

  const staticFiles = {
    "/styles.css": ["styles.css", "text/css; charset=utf-8"],
    "/app.js": ["app.js", "text/javascript; charset=utf-8"],
    "/login.css": ["login.css", "text/css; charset=utf-8"],
    "/login.js": ["login.js", "text/javascript; charset=utf-8"],
    "/paper.js": ["paper.js", "text/javascript; charset=utf-8"],
    "/info-page.js": ["info-page.js", "text/javascript; charset=utf-8"]
  };
  if (request.method === "GET" && staticFiles[url.pathname]) {
    const [fileName, contentType] = staticFiles[url.pathname];
    return serveFile(response, path.join(PUBLIC_DIR, fileName), contentType);
  }

  response.writeHead(404);
  response.end("Not found");
}

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    console.error("Request failed:", error);
    if (!response.headersSent) sendJson(response, 500, { error: "The server could not complete that request." });
    else response.destroy();
  });
});

setInterval(() => {
  try {
    activateDueSchedules();
  } catch (error) {
    console.error("Scheduled edition update failed:", error);
  }
}, 30 * 1000).unref();

server.listen(PORT, HOST, () => {
  console.log(`Vachana Kranti is running at http://localhost:${PORT}`);
});
