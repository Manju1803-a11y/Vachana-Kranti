const form = document.querySelector("#publish-form");
const fileInput = document.querySelector("#issue-files");
const dropZone = document.querySelector("#drop-zone");
const fileList = document.querySelector("#selected-files");
const fileCount = document.querySelector("#file-count");
const errorBox = document.querySelector("#form-error");
const deployButton = document.querySelector("#deploy-button");
const issueRows = document.querySelector("#manage-rows");
const searchInput = document.querySelector("#manage-search");
const statusFilter = document.querySelector("#status-filter");
const categoryFilter = document.querySelector("#category-filter");
const categorySelect = document.querySelector("#issue-category");
const statusSelect = document.querySelector("#issue-status");
const scheduleField = document.querySelector("#schedule-field");
const publishResult = document.querySelector("#publish-result");
const categories = [];
let issues = [];
let editingId = null;
let defaultCategory = "Main Edition";
let editingCategory = null;
let pages = [];
let editingPage = null;
let noticeTimer = null;

function localDateValue(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function formatDate(value, options = { year: "numeric", month: "short", day: "numeric" }) {
  if (!value) return "—";
  return new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, options);
}

function formatDateTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function readableFiles(files) {
  return Array.from(files).filter((file) => /\.(pdf|jpe?g|png|webp|gif)$/i.test(file.name));
}

function showToast(message, isError = false) {
  let toast = document.querySelector("#toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    toast.setAttribute("role", "status");
    document.body.append(toast);
  }
  toast.textContent = message;
  toast.className = isError ? "toast toast-error" : "toast";
  toast.hidden = false;
  window.clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => { toast.hidden = true; }, 4000);
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  let result = null;
  const rawText = await response.text();
  try {
    result = rawText ? JSON.parse(rawText) : {};
  } catch {
    result = { error: rawText || `Request failed (${response.status})` };
  }
  if (response.status === 401 && !url.startsWith("/api/auth/")) {
    window.location.replace("/login");
    throw new Error("Your session has expired. Sign in again.");
  }
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
  return result;
}

function renderSelectedFiles() {
  const files = readableFiles(fileInput.files);
  fileCount.textContent = `${files.length} ${files.length === 1 ? "file" : "files"}`;
  fileList.replaceChildren();
  files.forEach((file) => {
    const row = document.createElement("li");
    const icon = document.createElement("span");
    const details = document.createElement("span");
    const size = document.createElement("small");
    icon.className = "file-type";
    icon.textContent = file.name.toLowerCase().endsWith(".pdf") ? "PDF" : "IMG";
    details.className = "selected-file-name";
    details.textContent = file.name;
    size.textContent = formatBytes(file.size);
    row.append(icon, details, size);
    fileList.append(row);
  });
}

function setView(name) {
  document.querySelectorAll(".view-panel").forEach((panel) => panel.classList.toggle("active", panel.id === `view-${name}`));
  document.querySelectorAll(".nav-link[data-view]").forEach((link) => link.classList.toggle("active", link.dataset.view === name));
  const labels = {
    dashboard: "DASHBOARD",
    publish: editingId ? "EDIT EDITION" : "NEW EDITION",
    manage: "MANAGE EDITIONS",
    categories: "EDITION CATEGORIES",
    settings: "E-PAPER SETTINGS",
    theme: "THEME SETUP",
    pages: "PAGE MANAGEMENT"
  };
  document.querySelector("#current-page-label").textContent = labels[name] || name.toUpperCase();
  if (name === "dashboard") loadDashboard();
  if (name === "manage") renderManageTable();
  if (name === "settings") loadSettingsSection(activeSettingsSection);
  if (name === "theme") loadTheme();
  if (name === "pages") loadPages();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function updateSelect(select, values, selected = "") {
  const first = select.options[0]
    ? select.options[0].cloneNode(true)
    : new Option("Main Edition", "Main Edition");
  select.replaceChildren(first);
  values.forEach((value) => {
    if (value === first.value) return;
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.append(option);
  });
  select.value = values.includes(selected) ? selected : first.value;
}

async function loadCategories() {
  const result = await requestJson("/api/categories");
  categories.splice(0, categories.length, ...result.categories);
  defaultCategory = result.defaultCategory || categories[0];
  updateSelect(categorySelect, categories, categorySelect.value || defaultCategory);
  const filterValue = categoryFilter.value;
  updateSelect(categoryFilter, categories, filterValue);
  renderCategoryList();
}

function renderCategoryList() {
  const list = document.querySelector("#category-list");
  document.querySelector("#category-total").textContent = String(categories.length);
  list.replaceChildren();
  categories.forEach((category, index) => {
    const count = issues.filter((issue) => (issue.category || "Main Edition") === category).length;
    const row = document.createElement("tr");
    const number = document.createElement("td");
    number.textContent = String(index + 1);
    const name = document.createElement("td");
    name.textContent = category;
    const status = document.createElement("td");
    const active = document.createElement("span");
    active.className = "category-status";
    active.textContent = "ACTIVE";
    status.append(active);
    const defaultCell = document.createElement("td");
    if (category === defaultCategory) {
      const badge = document.createElement("span");
      badge.className = "default-category-badge";
      badge.textContent = "PRIMARY";
      defaultCell.append(badge);
    } else {
      const makeDefault = document.createElement("button");
      makeDefault.className = "row-action";
      makeDefault.type = "button";
      makeDefault.dataset.categoryAction = "default";
      makeDefault.dataset.category = category;
      makeDefault.textContent = "Make default";
      defaultCell.append(makeDefault);
    }
    const editCell = document.createElement("td");
    const edit = document.createElement("button");
    edit.className = "row-action";
    edit.type = "button";
    edit.dataset.categoryAction = "edit";
    edit.dataset.category = category;
    edit.textContent = "Edit";
    editCell.append(edit);
    const removeCell = document.createElement("td");
    const remove = document.createElement("button");
    remove.className = "row-action delete-action";
    remove.type = "button";
    remove.dataset.categoryAction = "delete";
    remove.dataset.category = category;
    remove.textContent = "Remove";
    remove.disabled = category === defaultCategory || count > 0 || categories.length < 2;
    remove.title = category === defaultCategory ? "Choose a different default category first" : count ? "Move editions out of this category first" : "";
    removeCell.append(remove);
    row.append(number, name, status, defaultCell, editCell, removeCell);
    list.append(row);
  });
}

let activeSettingsSection = "basic";
let activeThemeSection = "navbar";
let settingsCache = {};
let themeCache = {};

async function loadSettingsSection(section = activeSettingsSection) {
  try {
    const result = await requestJson("/api/settings");
    settingsCache = result.settings;
    activeSettingsSection = section;
    document.querySelectorAll("[data-settings-section]").forEach((button) => button.classList.toggle("active", button.dataset.settingsSection === section));
    document.querySelectorAll("[data-settings-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.settingsPanel === section));
    const group = settingsCache[section] || {};
    const panel = document.querySelector(`[data-settings-panel="${section}"]`);
    if (!panel) return;
    for (const input of panel.querySelectorAll("[name]")) {
      const value = group[input.name];
      if (input.type === "checkbox") input.checked = Boolean(value);
      else if (value !== undefined) input.value = String(value);
    }
    document.querySelector("#settings-error").hidden = true;
    document.querySelector("#settings-saved").textContent = "";
  } catch (error) {
    showToast(error.message, true);
  }
}

async function loadTheme(section = activeThemeSection) {
  try {
    const result = await requestJson("/api/theme");
    themeCache = result.theme;
    activeThemeSection = section;
    document.querySelectorAll("[data-theme-section]").forEach((button) => button.classList.toggle("active", button.dataset.themeSection === section));
    document.querySelectorAll("[data-theme-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.themePanel === section));
    const values = section === "additionalCss" ? { additionalCss: themeCache.additionalCss || "" } : (themeCache[section] || {});
    const panel = document.querySelector(`[data-theme-panel="${section}"]`);
    for (const input of panel.querySelectorAll("[name]")) {
      const value = values[input.name];
      if (input.type === "checkbox") input.checked = Boolean(value);
      else if (value !== undefined) input.value = String(value);
    }
    document.querySelector("#theme-error").hidden = true;
  } catch (error) {
    showToast(error.message, true);
  }
}

function resetPageForm() {
  document.querySelector("#page-form").reset();
  editingPage = null;
  delete document.querySelector("#page-slug").dataset.touched;
  document.querySelector("#page-form-title").textContent = "Add information page";
  document.querySelector("#page-save").textContent = "Save page";
  document.querySelector("#page-cancel").hidden = true;
  document.querySelector("#page-error").hidden = true;
}

function renderPages() {
  const rows = document.querySelector("#page-rows");
  rows.replaceChildren();
  document.querySelector("#page-total").textContent = String(pages.length);
  if (!pages.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 7;
    cell.className = "table-empty";
    cell.textContent = "No information pages yet. Add a page to get started.";
    row.append(cell);
    rows.append(row);
    return;
  }
  pages.forEach((page, index) => {
    const row = document.createElement("tr");
    const number = document.createElement("td");
    number.textContent = String(index + 1);
    const title = document.createElement("td");
    title.textContent = page.title;
    const urlCell = document.createElement("td");
    const link = document.createElement("a");
    link.href = `/page/${encodeURIComponent(page.slug)}`;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = `${location.origin}/page/${page.slug}`;
    urlCell.append(link);
    const status = document.createElement("td");
    status.append(makeStatus(page.status));
    const copyCell = document.createElement("td");
    const copy = document.createElement("button");
    copy.className = "row-action";
    copy.type = "button";
    copy.dataset.pageAction = "copy";
    copy.dataset.slug = page.slug;
    copy.textContent = "Copy URL";
    copyCell.append(copy);
    const editCell = document.createElement("td");
    const edit = document.createElement("button");
    edit.className = "row-action";
    edit.type = "button";
    edit.dataset.pageAction = "edit";
    edit.dataset.slug = page.slug;
    edit.textContent = "Edit";
    editCell.append(edit);
    const deleteCell = document.createElement("td");
    const remove = document.createElement("button");
    remove.className = "row-action delete-action";
    remove.type = "button";
    remove.dataset.pageAction = "delete";
    remove.dataset.slug = page.slug;
    remove.textContent = "Remove";
    deleteCell.append(remove);
    row.append(number, title, urlCell, status, copyCell, editCell, deleteCell);
    rows.append(row);
  });
}

async function loadPages() {
  try {
    const result = await requestJson("/api/pages");
    pages = result.pages;
    renderPages();
  } catch (error) {
    showToast(error.message, true);
  }
}

function makeStatus(status) {
  const badge = document.createElement("span");
  badge.className = `status-badge status-${status || "public"}`;
  badge.textContent = status || "public";
  return badge;
}

function makeActionButton(label, action, issueId, className = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `row-action ${className}`.trim();
  button.dataset.action = action;
  button.dataset.id = issueId;
  button.textContent = label;
  button.setAttribute("aria-label", `${label} edition`);
  return button;
}

function filteredIssues() {
  const query = searchInput.value.trim().toLowerCase();
  const status = statusFilter.value;
  const category = categoryFilter.value;
  return issues.filter((issue) => {
    const matchesText = [issue.name, issue.date, issue.category, issue.alias].some((value) => String(value || "").toLowerCase().includes(query));
    return matchesText && (!status || issue.status === status) && (!category || (issue.category || "Main Edition") === category);
  });
}

function renderManageTable() {
  const filtered = filteredIssues();
  issueRows.replaceChildren();
  document.querySelector("#table-summary").textContent = `Showing ${filtered.length} of ${issues.length} editions`;
  if (!filtered.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 8;
    cell.className = "table-empty";
    cell.textContent = issues.length ? "No editions match your filters." : "No editions yet. Create your first edition to get started.";
    row.append(cell);
    issueRows.append(row);
    return;
  }

  filtered.forEach((issue, index) => {
    const row = document.createElement("tr");
    const checkCell = document.createElement("td");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "issue-checkbox";
    checkbox.value = issue.id;
    checkbox.setAttribute("aria-label", `Select ${issue.name}`);
    checkCell.append(checkbox);
    const numberCell = document.createElement("td");
    numberCell.textContent = String(index + 1).padStart(2, "0");
    const nameCell = document.createElement("td");
    nameCell.className = "edition-name-cell";
    const name = document.createElement("strong");
    name.textContent = issue.name;
    const subline = document.createElement("small");
    subline.textContent = `${issue.category || "Main Edition"}${issue.alias ? ` · /${issue.alias}` : ""}`;
    nameCell.append(name, subline);
    const dateCell = document.createElement("td");
    dateCell.textContent = formatDate(issue.date);
    const stateCell = document.createElement("td");
    stateCell.append(makeStatus(issue.status || "public"));
    const scheduleCell = document.createElement("td");
    scheduleCell.textContent = issue.status === "scheduled" ? formatDateTime(issue.scheduledAt) : "—";
    const pagesCell = document.createElement("td");
    pagesCell.textContent = `${issue.files.length} ${issue.files.length === 1 ? "page" : "pages"}`;
        const actionsCell = document.createElement("td");
    actionsCell.className = "action-cell";
    const isPublic = issue.status === "public";
    actionsCell.append(
      makeActionButton("Preview", "preview", issue.id, "action-preview"),
      makeActionButton("Edit Info", "edit-info", issue.id, "action-edit-info"),
      makeActionButton("Edit Pages", "edit-pages", issue.id, "action-edit-pages"),
      makeActionButton("Area Mapping", "area-mapping", issue.id, "action-area-mapping"),
      makeActionButton(isPublic ? "Make Private" : "Make Public", "toggle-status", issue.id, isPublic ? "action-make-private" : "action-make-public"),
      makeActionButton("Schedule", "schedule", issue.id, "action-schedule"),
      makeActionButton("Remove", "delete", issue.id, "delete-action")
    );
    row.append(checkCell, numberCell, nameCell, dateCell, stateCell, scheduleCell, pagesCell, actionsCell);
    issueRows.append(row);
  });
  document.querySelector("#select-all").checked = false;
  updateBulkToolbar();
}

function updateBulkToolbar() {
  const selected = document.querySelectorAll(".issue-checkbox:checked").length;
  const toolbar = document.querySelector("#bulk-toolbar");
  toolbar.hidden = selected === 0;
  document.querySelector("#selected-count").textContent = `${selected} selected`;
}

function renderRecent() {
  const list = document.querySelector("#recent-list");
  list.replaceChildren();
  const recent = issues.slice(0, 4);
  if (!recent.length) {
    const empty = document.createElement("div");
    empty.className = "recent-empty";
    empty.textContent = "Your published editions will appear here.";
    list.append(empty);
    return;
  }
  recent.forEach((issue) => {
    const row = document.createElement("div");
    row.className = "recent-row";
    const mark = document.createElement("span");
    mark.className = "recent-mark";
    mark.textContent = "VK";
    const details = document.createElement("span");
    details.className = "recent-details";
    const title = document.createElement("strong");
    title.textContent = issue.name;
    const date = document.createElement("small");
    date.textContent = `${formatDate(issue.date)} · ${issue.category || "Main Edition"}`;
    details.append(title, date);
    const status = makeStatus(issue.status || "public");
    row.append(mark, details, status);
    list.append(row);
  });
}

function renderSchedule(stats) {
  const list = document.querySelector("#schedule-list");
  list.replaceChildren();
  if (!stats.upcoming.length) {
    const empty = document.createElement("div");
    empty.className = "schedule-empty";
    empty.innerHTML = "<span>◷</span><strong>No editions scheduled</strong><small>Schedule an edition from the publish form.</small>";
    list.append(empty);
    return;
  }
  stats.upcoming.forEach((issue) => {
    const item = document.createElement("div");
    item.className = "schedule-item";
    const date = document.createElement("span");
    date.className = "schedule-date";
    date.textContent = formatDateTime(issue.scheduledAt);
    const title = document.createElement("strong");
    title.textContent = issue.name;
    item.append(date, title);
    list.append(item);
  });
}

function renderChart(chart) {
  const container = document.querySelector("#analytics-chart");
  container.replaceChildren();
  const max = Math.max(1, ...chart.map((item) => item.views));
  chart.forEach((item) => {
    const column = document.createElement("div");
    column.className = "chart-column";
    const value = document.createElement("span");
    value.className = "chart-value";
    value.textContent = item.views ? String(item.views) : "";
    const track = document.createElement("div");
    track.className = "chart-track";
    const bar = document.createElement("i");
    bar.style.height = `${Math.max(item.views ? 8 : 2, (item.views / max) * 100)}%`;
    track.append(bar);
    const label = document.createElement("small");
    label.textContent = item.label;
    column.append(value, track, label);
    container.append(column);
  });
  document.querySelector("#analytics-total").textContent = `${chart.reduce((sum, item) => sum + item.views, 0)} total`;
}

function renderDashboard(stats) {
  if (!stats) return;
  const totalEditions   = stats.totalEditions    != null ? stats.totalEditions   : (stats.total         || 0);
  const categoriesCount = stats.categoriesCount  != null ? stats.categoriesCount : (stats.categoryCount || 0);
  const thisMonth       = stats.currentMonthViews != null ? stats.currentMonthViews : (stats.thisMonthVisitors || 0);
  const lastMonth       = stats.prevMonthViews    != null ? stats.prevMonthViews    : (stats.lastMonthVisitors  || 0);
  const storage = stats.storage || {};
  const used  = storage.usedBytes  != null ? storage.usedBytes  : (stats.usedBytes  || 0);
  const limit = storage.limitBytes != null ? storage.limitBytes : (stats.totalBytes || 10737418240);
  const pct   = limit > 0 ? Math.min(100, Math.round((used / limit) * 1000) / 10) : 0;

  const setT = (sel, val) => { const el = document.querySelector(sel); if (el) el.textContent = val; };
  setT('#stat-editions',   String(totalEditions));
  setT('#stat-categories', String(categoriesCount));
  setT('#stat-this-month', Number(thisMonth).toLocaleString());
  setT('#stat-last-month', Number(lastMonth).toLocaleString());
  setT('#storage-percent', pct + '%');
  setT('#storage-used',    formatBytes(used));
  setT('#storage-free',    formatBytes(Math.max(0, limit - used)));
  setT('#storage-total',   formatBytes(limit));
  const ring = document.querySelector('#storage-ring');
  if (ring) ring.style.background = 'conic-gradient(var(--copper,#B8734F) ' + pct + '%, var(--mist,#DCE1E6) ' + pct + '%)';
  if (stats.chart) renderChart(stats.chart);
  renderSchedule(stats);
  renderRecent();
}

async function loadDashboard() {
  try {
    renderDashboard(await requestJson("/api/dashboard"));
  } catch (error) {
    showToast(error.message, true);
  }
}

async function loadIssues() {
  const result = await requestJson("/api/issues");
  issues = result.issues;
  const latestPublic = issues.find((issue) => issue.status === "public");
  const siteLink = latestPublic ? (latestPublic.url || latestPublic.readerUrl || `/paper/${latestPublic.alias || latestPublic.id}`) : "/paper";
  document.querySelectorAll(".external-nav, .visit-site").forEach((link) => { link.href = siteLink; });
  renderManageTable();
  renderRecent();
  renderCategoryList();
}

async function refreshData() {
  try {
    const result = await requestJson("/api/bootstrap");
    categories.splice(0, categories.length, ...result.categories);
    defaultCategory = result.defaultCategory || categories[0];
    updateSelect(categorySelect, categories, categorySelect.value || defaultCategory);
    updateSelect(categoryFilter, categories, categoryFilter.value);
    issues = result.issues;
    const latestPublic = issues.find((issue) => issue.status === "public");
    const siteLink = latestPublic ? (latestPublic.url || latestPublic.readerUrl || `/paper/${latestPublic.alias || latestPublic.id}`) : "/paper";
    document.querySelectorAll(".external-nav, .visit-site").forEach((link) => { link.href = siteLink; });
    renderManageTable();
    renderRecent();
    renderCategoryList();
    renderDashboard(result.stats);
    applyAdminBranding(result.settings);
  } catch (error) {
    showToast(error.message, true);
  }
}

async function loadAdminBranding() {
  const result = await requestJson("/api/settings");
  applyAdminBranding(result.settings);
}

function applyAdminBranding(settings) {
  const basic = settings.basic || {};
  const siteName = basic.siteName || "Vachana Kranti";
  const sbStrong = document.querySelector(".sidebar-brand strong"); if (sbStrong) sbStrong.textContent = siteName;
  document.title = `${siteName} — E-paper desk`;
  if (basic.faviconUrl) {
    let favicon = document.querySelector('link[rel="icon"]');
    if (!favicon) {
      favicon = document.createElement("link");
      favicon.rel = "icon";
      document.head.append(favicon);
    }
    favicon.href = basic.faviconUrl;
  }
}

function resetForm() {
  form.reset();
  editingId = null;
  document.querySelector("#publish-heading").textContent = "Create new edition";
  document.querySelector("#edit-file-note").hidden = true;
  document.querySelector("#issue-date").value = localDateValue();
  if (categories.includes(defaultCategory)) categorySelect.value = defaultCategory;
  document.querySelector("#issue-status").value = "public";
  document.querySelector("#issue-upload-type").value = "mixed";
  document.querySelector("#file-count").textContent = "0 files";
  fileList.replaceChildren();
  errorBox.hidden = true;
  publishResult.hidden = true;
  document.querySelector("#reset-button").textContent = "Reset form";
  document.querySelector("#current-page-label").textContent = "NEW EDITION";
  updateScheduleField();
}

function updateScheduleField() {
  const scheduled = statusSelect.value === "scheduled";
  scheduleField.hidden = !scheduled;
  document.querySelector("#issue-schedule").required = scheduled;
}

function editIssue(issue) {
  resetForm();
  editingId = issue.id;
  form.elements.name.value = issue.name;
  form.elements.alias.value = issue.alias || "";
  form.elements.date.value = issue.date;
  form.elements.metaTitle.value = issue.metaTitle || "";
  form.elements.metaDescription.value = issue.metaDescription || "";
  form.elements.category.value = issue.category || "Main Edition";
  form.elements.status.value = issue.status || "public";
  form.elements.uploadType.value = issue.uploadType || "mixed";
  form.elements.scheduledAt.value = issue.scheduledAt ? issue.scheduledAt.slice(0, 16) : "";
  document.querySelector("#publish-heading").textContent = "Edit edition";
  document.querySelector("#edit-file-note").hidden = false;
  document.querySelector("#reset-button").textContent = "Cancel editing";
  updateScheduleField();
  setView("publish");
}

function fileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return reject(new Error(`Could not read ${file.name}.`));
      resolve({ name: file.name, data: reader.result.split(",")[1] });
    };
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

async function saveIssue(event) {
  event.preventDefault();
  const files = readableFiles(fileInput.files);
  if (!editingId && files.length === 0) {
    errorBox.textContent = "Choose at least one PDF or image page before deploying.";
    errorBox.hidden = false;
    return;
  }
  if (files.length > 30 || files.some((file) => file.size > 50 * 1024 * 1024)) {
    errorBox.textContent = "Choose up to 30 files, each smaller than 50 MB.";
    errorBox.hidden = false;
    return;
  }
  if (files.some((file) => form.elements.uploadType.value === "pdf" && !file.name.toLowerCase().endsWith(".pdf"))) {
    errorBox.textContent = "Upload type is set to PDF. Remove image files or choose PDF + images.";
    errorBox.hidden = false;
    return;
  }
  if (files.some((file) => form.elements.uploadType.value === "images" && file.name.toLowerCase().endsWith(".pdf"))) {
    errorBox.textContent = "Upload type is set to Images. Remove PDFs or choose PDF + images.";
    errorBox.hidden = false;
    return;
  }

  deployButton.disabled = true;
  deployButton.innerHTML = "<span>Saving edition…</span><span class=\"button-spinner\" aria-hidden=\"true\"></span>";
  errorBox.hidden = true;
  publishResult.hidden = true;
  try {
    const body = {
      name: form.elements.name.value,
      alias: form.elements.alias.value,
      date: form.elements.date.value,
      metaTitle: form.elements.metaTitle.value,
      metaDescription: form.elements.metaDescription.value,
      category: form.elements.category.value,
      status: form.elements.status.value,
      uploadType: form.elements.uploadType.value,
      scheduledAt: form.elements.scheduledAt.value ? new Date(form.elements.scheduledAt.value).toISOString() : ""
    };
    const url = editingId ? `/api/issues/${editingId}` : "/api/issues";
    const method = editingId ? "PUT" : "POST";
    if (files.length) body.files = await Promise.all(files.map(fileAsBase64));
    const result = await requestJson(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const savedIssue = result.issue;
    const wasEditing = Boolean(editingId);
    resetForm();
    await refreshData();
    const label = savedIssue.status === "scheduled" ? "Edition scheduled" : savedIssue.status === "draft" ? "Draft saved" : wasEditing ? "Edition updated" : "Edition deployed";
    const message = document.createElement("strong");
    message.textContent = `${label}: ${savedIssue.name}`;
    const link = document.createElement("a");
    link.href = savedIssue.url;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = savedIssue.url;
    const resultActions = document.createElement("div");
    resultActions.className = "result-actions";
    resultActions.append(message, link);
    publishResult.replaceChildren(resultActions);
    publishResult.hidden = false;
    showToast(label);
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
  } finally {
    deployButton.disabled = false;
    deployButton.innerHTML = "<span>Review &amp; deploy</span><span aria-hidden=\"true\">↗</span>";
  }
}

async function updateIssue(issue, changes) {
  const updated = { ...issue, ...changes };
  const result = await requestJson(`/api/issues/${issue.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: updated.name,
      alias: updated.alias || "",
      date: updated.date,
      metaTitle: updated.metaTitle || "",
      metaDescription: updated.metaDescription || "",
      category: updated.category || "Main Edition",
      status: updated.status || "public",
      uploadType: updated.uploadType || "mixed",
      scheduledAt: updated.scheduledAt || ""
    })
  });
  return result.issue;
}

async function bulkUpdate(status) {
  const selectedIds = Array.from(document.querySelectorAll(".issue-checkbox:checked")).map((checkbox) => checkbox.value);
  if (!selectedIds.length) return;
  const selectedIssues = issues.filter((issue) => selectedIds.includes(issue.id));
  try {
    for (const issue of selectedIssues) {
      await updateIssue(issue, { status, scheduledAt: "" });
    }
    await refreshData();
    showToast(`${selectedIssues.length} edition${selectedIssues.length === 1 ? "" : "s"} updated.`);
  } catch (error) {
    showToast(error.message, true);
  }
}

document.querySelectorAll("[data-view]").forEach((link) => link.addEventListener("click", () => setView(link.dataset.view)));
document.querySelectorAll("[data-go]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.go)));
document.querySelector("#issue-date").value = localDateValue();
document.querySelector("#refresh-button").addEventListener("click", () => refreshData().catch((error) => showToast(error.message, true)));
document.querySelector("#reset-button").addEventListener("click", () => {
  if (editingId) resetForm();
  else form.reset();
});
document.querySelector("#issue-status").addEventListener("change", updateScheduleField);
fileInput.addEventListener("change", renderSelectedFiles);
form.addEventListener("submit", saveIssue);
searchInput.addEventListener("input", renderManageTable);
statusFilter.addEventListener("change", renderManageTable);
categoryFilter.addEventListener("change", renderManageTable);
document.querySelector("#select-all").addEventListener("change", (event) => {
  document.querySelectorAll(".issue-checkbox").forEach((checkbox) => { checkbox.checked = event.target.checked; });
  updateBulkToolbar();
});
issueRows.addEventListener("change", (event) => {
  if (event.target.matches(".issue-checkbox")) updateBulkToolbar();
});

issueRows.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const issue = issues.find((item) => item.id === button.dataset.id);
  if (!issue) return;
  try {
    const action = button.dataset.action;
    const editionTitle = issue.name || issue.title || "Edition";
    const previewUrl = issue.url || issue.readerUrl || `/paper/${issue.alias || issue.id}`;

    if (action === "open" || action === "preview") {
      window.open(previewUrl, "_blank", "noopener");
      return;
    }
    if (action === "edit" || action === "edit-info") {
      editIssue(issue);
      document.querySelector("#issue-name")?.focus();
      return;
    }
    if (action === "edit-pages") {
      editIssue(issue);
      const uploadCol = document.querySelector("#upload-column");
      if (uploadCol) {
        uploadCol.scrollIntoView({ behavior: "smooth", block: "center" });
        uploadCol.style.transition = "box-shadow 0.3s";
        uploadCol.style.boxShadow = "0 0 0 4px #3b82f6";
        setTimeout(() => { uploadCol.style.boxShadow = ""; }, 1800);
      }
      return;
    }
    if (action === "area-mapping") {
      openAreaMappingModal(issue);
      return;
    }
    if (action === "toggle-status") {
      const newStatus = issue.status === "public" ? "draft" : "public";
      const confirmPrompt = newStatus === "draft"
        ? `Make edition "${editionTitle}" private?\nReaders will not be able to view it until published again.`
        : `Make edition "${editionTitle}" public?\nReaders will be able to view it immediately.`;
      if (!window.confirm(confirmPrompt)) return;
      await requestJson(`/api/issues/${issue.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus })
      });
      await refreshData();
      showToast(`Edition "${editionTitle}" is now ${newStatus === "draft" ? "Private (draft)" : "Public"}.`);
      return;
    }
    if (action === "schedule") {
      openScheduleModal(issue);
      return;
    }
    if (action === "copy") {
      await navigator.clipboard.writeText(previewUrl);
      showToast("Edition URL copied to clipboard.");
      return;
    }
    if (action === "delete") {
      if (!window.confirm(`Are you sure you want to permanently remove edition "${editionTitle}" and its uploaded pages?\n\nThis action cannot be undone.`)) return;
      await requestJson(`/api/issues/${issue.id}`, { method: "DELETE" });
      await refreshData();
      showToast(`Edition "${editionTitle}" was successfully removed.`);
      return;
    }
  } catch (error) {
    showToast(error.message, true);
  }
});

document.querySelectorAll("[data-bulk-status]").forEach((button) => button.addEventListener("click", () => bulkUpdate(button.dataset.bulkStatus)));
document.querySelector("#clear-selection").addEventListener("click", () => {
  document.querySelectorAll(".issue-checkbox, #select-all").forEach((checkbox) => { checkbox.checked = false; });
  updateBulkToolbar();
});
document.querySelector("#bulk-delete").addEventListener("click", async () => {
  const selectedIds = Array.from(document.querySelectorAll(".issue-checkbox:checked")).map((checkbox) => checkbox.value);
  if (!selectedIds.length || !window.confirm(`Permanently delete ${selectedIds.length} selected edition(s) and their uploaded files?`)) return;
  try {
    for (const id of selectedIds) await requestJson(`/api/issues/${id}`, { method: "DELETE" });
    await refreshData();
    showToast(`${selectedIds.length} edition(s) deleted.`);
  } catch (error) {
    showToast(error.message, true);
  }
});

dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropZone.classList.add("is-dragging");
});
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("is-dragging"));
dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropZone.classList.remove("is-dragging");
  const transfer = new DataTransfer();
  [...fileInput.files, ...event.dataTransfer.files].forEach((file) => transfer.items.add(file));
  fileInput.files = transfer.files;
  renderSelectedFiles();
});
document.addEventListener("paste", (event) => {
  if (!document.querySelector("#view-publish").classList.contains("active")) return;
  const images = Array.from(event.clipboardData.items)
    .filter((item) => item.type.startsWith("image/"))
    .map((item, index) => item.getAsFile() && new File([item.getAsFile()], `pasted-page-${Date.now()}-${index}.png`, { type: item.type }));
  const files = images.filter(Boolean);
  if (!files.length) return;
  const transfer = new DataTransfer();
  [...fileInput.files, ...files].forEach((file) => transfer.items.add(file));
  fileInput.files = transfer.files;
  renderSelectedFiles();
  showToast(`${files.length} pasted page${files.length === 1 ? "" : "s"} added.`);
});

document.querySelector("#category-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const error = document.querySelector("#category-error");
  error.hidden = true;
  try {
    const name = document.querySelector("#category-name").value.trim();
    const endpoint = editingCategory ? `/api/categories/${encodeURIComponent(editingCategory)}` : "/api/categories";
    const result = await requestJson(endpoint, {
      method: editingCategory ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });
    document.querySelector("#category-name").value = "";
    editingCategory = null;
    document.querySelector("#category-form-title").textContent = "Create a category";
    document.querySelector("#category-save").textContent = "Save category";
    document.querySelector("#category-cancel").hidden = true;
    await loadCategories();
    await loadIssues();
    await loadDashboard();
    showToast("Category saved.");
  } catch (requestError) {
    error.textContent = requestError.message;
    error.hidden = false;
  }
});

document.querySelector("#category-cancel").addEventListener("click", () => {
  editingCategory = null;
  document.querySelector("#category-form").reset();
  document.querySelector("#category-form-title").textContent = "Create a category";
  document.querySelector("#category-save").textContent = "Save category";
  document.querySelector("#category-cancel").hidden = true;
  document.querySelector("#category-error").hidden = true;
});

document.querySelector("#category-list").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-category-action]");
  if (!button) return;
  const category = button.dataset.category;
  try {
    if (button.dataset.categoryAction === "edit") {
      editingCategory = category;
      document.querySelector("#category-name").value = category;
      document.querySelector("#category-form-title").textContent = "Edit category";
      document.querySelector("#category-save").textContent = "Update category";
      document.querySelector("#category-cancel").hidden = false;
      document.querySelector("#category-name").focus();
      return;
    }
    if (button.dataset.categoryAction === "default") {
      await requestJson("/api/categories/default", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: category })
      });
      await loadCategories();
      await loadDashboard();
      showToast(`${category} is now the default category.`);
      return;
    }
    if (button.dataset.categoryAction === "delete") {
      if (!window.confirm(`Remove the “${category}” category?`)) return;
      await requestJson(`/api/categories/${encodeURIComponent(category)}`, { method: "DELETE" });
      await loadCategories();
      await loadDashboard();
      showToast("Category removed.");
    }
  } catch (error) {
    showToast(error.message, true);
  }
});

document.querySelectorAll("[data-settings-section]").forEach((button) => {
  button.addEventListener("click", () => loadSettingsSection(button.dataset.settingsSection));
});

document.querySelector("#settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const errorBox = document.querySelector("#settings-error");
  errorBox.hidden = true;
  document.querySelector("#settings-saved").textContent = "";
  const panel = document.querySelector(`[data-settings-panel="${activeSettingsSection}"]`);
  const invalidInput = Array.from(panel.querySelectorAll("input, select, textarea")).find((input) => !input.checkValidity());
  if (invalidInput) {
    invalidInput.reportValidity();
    return;
  }
  const values = {};
  for (const input of panel.querySelectorAll("[name]")) {
    values[input.name] = input.type === "checkbox"
      ? input.checked
      : input.type === "number"
        ? Number(input.value)
        : input.value.trim();
  }
  try {
    const result = await requestJson("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ section: activeSettingsSection, values })
    });
    settingsCache = result.settings;
    if (activeSettingsSection === "basic") {
      const siteName = values.siteName || "Vachana Kranti";
      document.title = `${siteName} — E-paper desk`;
      const sbStrong = document.querySelector(".sidebar-brand strong"); if (sbStrong) sbStrong.textContent = siteName;
    }
    document.querySelector("#settings-saved").textContent = "Saved successfully.";
    showToast("Site settings saved.");
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
  }
});

document.querySelectorAll("[data-theme-section]").forEach((button) => {
  button.addEventListener("click", () => loadTheme(button.dataset.themeSection));
});

document.querySelector("#theme-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const errorBox = document.querySelector("#theme-error");
  errorBox.hidden = true;
  const panel = document.querySelector(`[data-theme-panel="${activeThemeSection}"]`);
  const invalidInput = Array.from(panel.querySelectorAll("input, select, textarea")).find((input) => !input.checkValidity());
  if (invalidInput) {
    invalidInput.reportValidity();
    return;
  }
  try {
    const result = await requestJson("/api/theme", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(activeThemeSection === "additionalCss"
        ? { section: activeThemeSection, value: document.querySelector("#additional-css").value }
        : {
          section: activeThemeSection,
          values: Object.fromEntries(Array.from(panel.querySelectorAll("[name]")).map((input) => [
            input.name,
            input.type === "checkbox" ? input.checked : input.value.trim()
          ]))
        })
    });
    themeCache = result.theme;
    showToast("Theme settings saved.");
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
  }
});

document.querySelector("#preview-theme").addEventListener("click", () => {
  const latest = issues.find((issue) => issue.status === "public");
  if (!latest) {
    showToast("Publish an edition before previewing the reader.", true);
    return;
  }
  window.open(latest.url, "_blank", "noopener");
});

document.querySelector("#new-page-button").addEventListener("click", () => {
  resetPageForm();
  document.querySelector("#page-title").focus();
});

document.querySelector("#page-title").addEventListener("input", () => {
  if (editingPage || document.querySelector("#page-slug").dataset.touched === "true") return;
  document.querySelector("#page-slug").value = document.querySelector("#page-title").value
    .trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
});
document.querySelector("#page-slug").addEventListener("input", (event) => {
  event.target.dataset.touched = "true";
});
document.querySelector("#page-cancel").addEventListener("click", resetPageForm);

document.querySelector("#page-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const errorBox = document.querySelector("#page-error");
  errorBox.hidden = true;
  const body = {
    title: document.querySelector("#page-title").value,
    slug: document.querySelector("#page-slug").value,
    status: document.querySelector("#page-status").value,
    content: document.querySelector("#page-content").value
  };
  try {
    const endpoint = editingPage ? `/api/pages/${encodeURIComponent(editingPage)}` : "/api/pages";
    const result = await requestJson(endpoint, {
      method: editingPage ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    resetPageForm();
    await loadPages();
    showToast(`“${result.page.title}” saved.`);
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
  }
});

document.querySelector("#page-rows").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-page-action]");
  if (!button) return;
  const page = pages.find((item) => item.slug === button.dataset.slug);
  if (!page) return;
  try {
    if (button.dataset.pageAction === "edit") {
      editingPage = page.slug;
      document.querySelector("#page-title").value = page.title;
      document.querySelector("#page-slug").value = page.slug;
      document.querySelector("#page-slug").dataset.touched = "true";
      document.querySelector("#page-status").value = page.status;
      document.querySelector("#page-content").value = page.content;
      document.querySelector("#page-form-title").textContent = "Edit information page";
      document.querySelector("#page-save").textContent = "Update page";
      document.querySelector("#page-cancel").hidden = false;
      document.querySelector("#page-title").focus();
      return;
    }
    if (button.dataset.pageAction === "copy") {
      await navigator.clipboard.writeText(`${location.origin}/page/${page.slug}`);
      showToast("Page URL copied.");
      return;
    }
    if (button.dataset.pageAction === "delete") {
      if (!window.confirm(`Remove the “${page.title}” page?`)) return;
      await requestJson(`/api/pages/${encodeURIComponent(page.slug)}`, { method: "DELETE" });
      if (editingPage === page.slug) resetPageForm();
      await loadPages();
      showToast("Page removed.");
    }
  } catch (error) {
    showToast(error.message, true);
  }
});

document.querySelector("#menu-search").addEventListener("input", (event) => {
  const query = event.target.value.trim().toLowerCase();
  document.querySelectorAll(".side-navigation .nav-link").forEach((link) => {
    link.hidden = Boolean(query) && !link.textContent.toLowerCase().includes(query);
  });
  document.querySelectorAll(".side-navigation .nav-group").forEach((group) => {
    group.hidden = Boolean(query);
  });
});

document.querySelector("#admin-signout").addEventListener("click", async () => {
  try {
    await requestJson("/api/auth/logout", { method: "POST" });
    window.location.replace("/login");
  } catch (error) {
    showToast(error.message, true);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) {
    event.preventDefault();
    document.querySelector("#manage-search").focus();
    setView("manage");
  }
});

updateScheduleField();
refreshData().catch((error) => showToast(error.message, true));


// ── Image Upload & Preview Helpers ─────────────────────────────────────
function updateFaviconPreview(url) {
  const img = document.querySelector("#favicon-preview-img");
  const placeholder = document.querySelector("#favicon-preview-placeholder");
  const clearBtn = document.querySelector("#clear-favicon-btn");
  if (url && typeof url === "string" && url.trim()) {
    if (img) { img.src = url; img.hidden = false; }
    if (placeholder) placeholder.hidden = true;
    if (clearBtn) clearBtn.hidden = false;
  } else {
    if (img) { img.src = ""; img.hidden = true; }
    if (placeholder) placeholder.hidden = false;
    if (clearBtn) clearBtn.hidden = true;
  }
}

function updateLogoPreview(url) {
  const img = document.querySelector("#logo-preview-img");
  const placeholder = document.querySelector("#logo-preview-placeholder");
  const clearBtn = document.querySelector("#clear-logo-btn");
  if (url && typeof url === "string" && url.trim()) {
    if (img) { img.src = url; img.hidden = false; }
    if (placeholder) placeholder.hidden = true;
    if (clearBtn) clearBtn.hidden = false;
  } else {
    if (img) { img.src = ""; img.hidden = true; }
    if (placeholder) placeholder.hidden = false;
    if (clearBtn) clearBtn.hidden = true;
  }
}

async function handleImageUpload(file, type = "image") {
  if (!file) return null;
  const maxBytes = type === "favicon" ? 2 * 1024 * 1024 : 5 * 1024 * 1024;
  if (file.size > maxBytes) {
    throw new Error(`File "${file.name}" is too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Maximum allowed is ${type === "favicon" ? "2 MB" : "5 MB"}.`);
  }
  const allowed = ["image/png", "image/jpeg", "image/webp", "image/svg+xml", "image/x-icon", "image/gif"];
  if (!allowed.includes(file.type)) {
    throw new Error(`Unsupported image format (${file.type || file.name}). Please select a PNG, SVG, JPG, or WEBP image.`);
  }

  const base64Data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Failed to read image file."));
    reader.readAsDataURL(file);
  });

  try {
    const result = await requestJson("/api/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: file.name, data: base64Data, type: file.type })
    });
    return result.url;
  } catch (err) {
    console.warn("Server upload failed, using data URL:", err.message);
    return base64Data;
  }
}

// ── Schedule Publication Controller ────────────────────────────────────
let schedulingIssue = null;
function openScheduleModal(issue) {
  schedulingIssue = issue;
  const modal = document.querySelector("#schedule-modal");
  document.querySelector("#schedule-modal-title").textContent = `Schedule: ${issue.name || issue.title}`;
  const dtInput = document.querySelector("#schedule-datetime-input");
  if (issue.scheduledAt) {
    dtInput.value = new Date(issue.scheduledAt).toISOString().slice(0, 16);
  } else {
    const tmrw = new Date();
    tmrw.setDate(tmrw.getDate() + 1);
    tmrw.setHours(6, 0, 0, 0);
    dtInput.value = tmrw.toISOString().slice(0, 16);
  }
  document.querySelector("#schedule-error").hidden = true;
  modal.hidden = false;
}

function closeScheduleModal() {
  const modal = document.querySelector("#schedule-modal");
  if (modal) modal.hidden = true;
  schedulingIssue = null;
}

// ── Area Mapping Controller ───────────────────────────────────────────
let mappingIssue = null;
let currentMappingPageIndex = 0;
let activeHotspotIndex = -1;

function openAreaMappingModal(issue) {
  mappingIssue = issue;
  mappingIssue.areas = Array.isArray(issue.areas) ? issue.areas : [];
  currentMappingPageIndex = 0;
  activeHotspotIndex = -1;

  const modal = document.querySelector("#area-mapping-modal");
  document.querySelector("#area-modal-title").textContent = `Area Mapping: ${issue.name || issue.title}`;
  
  const select = document.querySelector("#area-page-select");
  select.replaceChildren();
  (issue.files || []).forEach((file, idx) => {
    const opt = document.createElement("option");
    opt.value = String(idx);
    opt.textContent = `Page ${idx + 1} (${file.name})`;
    select.append(opt);
  });
  
  modal.hidden = false;
  renderAreaPage();
}

function closeAreaMappingModal() {
  const modal = document.querySelector("#area-mapping-modal");
  if (modal) modal.hidden = true;
  mappingIssue = null;
}

function renderAreaPage() {
  if (!mappingIssue || !mappingIssue.files || !mappingIssue.files.length) return;
  const file = mappingIssue.files[currentMappingPageIndex] || mappingIssue.files[0];
  const pageImg = document.querySelector("#area-page-img");
  const overlay = document.querySelector("#area-overlay");
  
  const src = `/media/${mappingIssue.id}/${encodeURIComponent(file.path)}`;
  pageImg.src = src;

  overlay.replaceChildren();
  const pageAreas = (mappingIssue.areas || []).filter(a => a.pageIndex === currentMappingPageIndex);
  document.querySelector("#area-total-count").textContent = String(pageAreas.length);

  pageAreas.forEach((area, idx) => {
    const box = document.createElement("div");
    box.className = "hotspot-box";
    if (activeHotspotIndex === idx) box.classList.add("is-selected");
    box.style.left = `${area.x}%`;
    box.style.top = `${area.y}%`;
    box.style.width = `${area.width}%`;
    box.style.height = `${area.height}%`;

    const label = document.createElement("span");
    label.textContent = area.title || `Hotspot #${idx + 1}`;
    box.append(label);

    box.addEventListener("click", (e) => {
      e.stopPropagation();
      selectHotspot(idx);
    });

    overlay.append(box);
  });

  renderHotspotItemsList(pageAreas);
}

function renderHotspotItemsList(pageAreas) {
  const list = document.querySelector("#area-items-list");
  list.replaceChildren();
  if (!pageAreas.length) {
    const empty = document.createElement("p");
    empty.className = "area-empty-hint";
    empty.textContent = "No hotspots mapped on this page yet. Click 'Draw / Add Hotspot' to add clickable articles.";
    list.append(empty);
    return;
  }

  pageAreas.forEach((area, idx) => {
    const item = document.createElement("div");
    item.className = `hotspot-item ${activeHotspotIndex === idx ? "is-active" : ""}`;
    
    const details = document.createElement("div");
    details.className = "hotspot-item-details";
    const title = document.createElement("strong");
    title.textContent = area.title || `Article #${idx + 1}`;
    const meta = document.createElement("small");
    meta.textContent = `${area.category || "General"} · ${Math.round(area.width)}% × ${Math.round(area.height)}%`;
    details.append(title, meta);

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "hotspot-item-delete";
    delBtn.title = "Delete hotspot";
    delBtn.textContent = "🗑";
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteHotspot(area);
    });

    item.append(details, delBtn);
    item.addEventListener("click", () => selectHotspot(idx));
    list.append(item);
  });
}

function selectHotspot(idx) {
  activeHotspotIndex = idx;
  const pageAreas = (mappingIssue.areas || []).filter(a => a.pageIndex === currentMappingPageIndex);
  const target = pageAreas[idx];
  const panel = document.querySelector("#hotspot-editor-panel");
  if (!target) {
    panel.hidden = true;
    return;
  }
  document.querySelector("#hotspot-title").value = target.title || "";
  document.querySelector("#hotspot-category").value = target.category || "";
  document.querySelector("#hotspot-summary").value = target.summary || "";
  panel.hidden = false;
  renderAreaPage();
}

function deleteHotspot(targetArea) {
  if (!mappingIssue || !mappingIssue.areas) return;
  mappingIssue.areas = mappingIssue.areas.filter(a => a !== targetArea);
  activeHotspotIndex = -1;
  document.querySelector("#hotspot-editor-panel").hidden = true;
  renderAreaPage();
  showToast("Hotspot removed.");
}

// Attach DOM Event Listeners for Modals & Uploads
function initEnhancedFeatures() {
  // Favicon & Logo file upload events
  document.querySelector("#favicon-file-input")?.addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      showToast("Uploading favicon…");
      const url = await handleImageUpload(file, "favicon");
      if (url) {
        const input = document.querySelector("#setting-favicon-url");
        if (input) input.value = url;
        updateFaviconPreview(url);
        showToast("Favicon uploaded. Click 'Save settings' to apply.");
      }
    } catch (err) {
      showToast(err.message, true);
    } finally {
      event.target.value = "";
    }
  });

  document.querySelector("#logo-file-input")?.addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      showToast("Uploading logo…");
      const url = await handleImageUpload(file, "logo");
      if (url) {
        const input = document.querySelector("#setting-logo-url");
        if (input) input.value = url;
        updateLogoPreview(url);
        showToast("Logo uploaded. Click 'Save settings' to apply.");
      }
    } catch (err) {
      showToast(err.message, true);
    } finally {
      event.target.value = "";
    }
  });

  document.querySelector("#setting-favicon-url")?.addEventListener("input", (e) => {
    updateFaviconPreview(e.target.value.trim());
  });

  document.querySelector("#setting-logo-url")?.addEventListener("input", (e) => {
    updateLogoPreview(e.target.value.trim());
  });

  document.querySelector("#clear-favicon-btn")?.addEventListener("click", () => {
    const input = document.querySelector("#setting-favicon-url");
    if (input) input.value = "";
    updateFaviconPreview("");
  });

  document.querySelector("#clear-logo-btn")?.addEventListener("click", () => {
    const input = document.querySelector("#setting-logo-url");
    if (input) input.value = "";
    updateLogoPreview("");
  });

  // Schedule Modal events
  document.querySelector("#schedule-modal-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!schedulingIssue) return;
    const dtVal = document.querySelector("#schedule-datetime-input").value;
    if (!dtVal) return;
    try {
      const isoDate = new Date(dtVal).toISOString();
      await requestJson(`/api/issues/${schedulingIssue.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "scheduled", scheduledAt: isoDate })
      });
      closeScheduleModal();
      await refreshData();
      showToast(`Edition scheduled for ${formatDateTime(isoDate)}.`);
    } catch (err) {
      const errBox = document.querySelector("#schedule-error");
      if (errBox) {
        errBox.textContent = err.message;
        errBox.hidden = false;
      }
    }
  });

  document.querySelector("#close-schedule-modal")?.addEventListener("click", closeScheduleModal);
  document.querySelector("#btn-cancel-schedule")?.addEventListener("click", closeScheduleModal);
  document.querySelector("#schedule-modal-backdrop")?.addEventListener("click", closeScheduleModal);

  // Area Mapping Modal events
  document.querySelector("#btn-apply-hotspot")?.addEventListener("click", () => {
    const pageAreas = (mappingIssue.areas || []).filter(a => a.pageIndex === currentMappingPageIndex);
    const target = pageAreas[activeHotspotIndex];
    if (!target) return;
    target.title = document.querySelector("#hotspot-title").value.trim() || `Article #${activeHotspotIndex + 1}`;
    target.category = document.querySelector("#hotspot-category").value.trim();
    target.summary = document.querySelector("#hotspot-summary").value.trim();
    document.querySelector("#hotspot-editor-panel").hidden = true;
    renderAreaPage();
    showToast("Hotspot details updated.");
  });

  document.querySelector("#btn-cancel-hotspot")?.addEventListener("click", () => {
    document.querySelector("#hotspot-editor-panel").hidden = true;
    activeHotspotIndex = -1;
    renderAreaPage();
  });

  document.querySelector("#btn-draw-hotspot")?.addEventListener("click", () => {
    if (!mappingIssue) return;
    mappingIssue.areas = mappingIssue.areas || [];
    const count = mappingIssue.areas.filter(a => a.pageIndex === currentMappingPageIndex).length;
    const newArea = {
      pageIndex: currentMappingPageIndex,
      title: `Article #${count + 1}`,
      category: "Main News",
      summary: "",
      x: 10 + (count % 3) * 15,
      y: 15 + (count % 3) * 15,
      width: 40,
      height: 25
    };
    mappingIssue.areas.push(newArea);
    const pageAreas = mappingIssue.areas.filter(a => a.pageIndex === currentMappingPageIndex);
    selectHotspot(pageAreas.length - 1);
  });

  document.querySelector("#btn-clear-areas")?.addEventListener("click", () => {
    if (!mappingIssue) return;
    if (!window.confirm("Clear all mapped hotspots on this page?")) return;
    mappingIssue.areas = (mappingIssue.areas || []).filter(a => a.pageIndex !== currentMappingPageIndex);
    activeHotspotIndex = -1;
    document.querySelector("#hotspot-editor-panel").hidden = true;
    renderAreaPage();
    showToast("Page hotspots cleared.");
  });

  document.querySelector("#area-page-select")?.addEventListener("change", (e) => {
    currentMappingPageIndex = Number(e.target.value) || 0;
    activeHotspotIndex = -1;
    document.querySelector("#hotspot-editor-panel").hidden = true;
    renderAreaPage();
  });

  document.querySelector("#btn-save-all-areas")?.addEventListener("click", async () => {
    if (!mappingIssue) return;
    try {
      await requestJson(`/api/issues/${mappingIssue.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ areas: mappingIssue.areas || [] })
      });
      closeAreaMappingModal();
      await refreshData();
      showToast(`Area mappings saved for ${mappingIssue.name || mappingIssue.title}.`);
    } catch (err) {
      showToast(err.message, true);
    }
  });

  document.querySelector("#close-area-modal")?.addEventListener("click", closeAreaMappingModal);
  document.querySelector("#btn-dismiss-area")?.addEventListener("click", closeAreaMappingModal);
  document.querySelector("#area-modal-backdrop")?.addEventListener("click", closeAreaMappingModal);
}

// Hook into loadSettingsSection to update previews
const origLoadSettings = loadSettingsSection;
loadSettingsSection = async function(section = activeSettingsSection) {
  await origLoadSettings(section);
  if (section === "basic" && settingsCache && settingsCache.basic) {
    updateFaviconPreview(settingsCache.basic.faviconUrl || "");
    updateLogoPreview(settingsCache.basic.logoUrl || "");
  }
};

initEnhancedFeatures();
