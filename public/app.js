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
  const result = await response.json();
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
    actionsCell.append(
      makeActionButton("Open", "open", issue.id),
      makeActionButton("Edit", "edit", issue.id),
      makeActionButton("Copy link", "copy", issue.id),
      makeActionButton("Delete", "delete", issue.id, "delete-action"),
      makeActionButton("⋯", "more", issue.id, "more-action")
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
  document.querySelector("#stat-editions").textContent = String(stats.totalEditions);
  document.querySelector("#stat-categories").textContent = String(stats.categoryCount);
  document.querySelector("#stat-this-month").textContent = stats.thisMonthVisitors.toLocaleString();
  document.querySelector("#stat-last-month").textContent = stats.lastMonthVisitors.toLocaleString();
  const used = stats.usedBytes;
  const total = stats.totalBytes;
  const percentage = Math.min(100, Math.round((used / total) * 100));
  document.querySelector("#storage-percent").textContent = `${percentage}%`;
  document.querySelector("#storage-used").textContent = formatBytes(used);
  document.querySelector("#storage-free").textContent = formatBytes(Math.max(0, total - used));
  document.querySelector("#storage-total").textContent = formatBytes(total);
  document.querySelector("#storage-ring").style.setProperty("--storage-used", `${percentage}%`);
  renderChart(stats.chart);
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
  const siteLink = latestPublic ? latestPublic.url : "/";
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
    const siteLink = latestPublic ? latestPublic.url : "/";
    document.querySelectorAll(".external-nav, .visit-site").forEach((link) => { link.href = siteLink; });
    renderManageTable();
    renderRecent();
    renderCategoryList();
    renderDashboard(result.dashboard);
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
  document.querySelector(".sidebar-brand strong").textContent = siteName;
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
    if (button.dataset.action === "open") window.open(issue.url, "_blank", "noopener");
    if (button.dataset.action === "edit") editIssue(issue);
    if (button.dataset.action === "copy") {
      await navigator.clipboard.writeText(issue.url);
      showToast("Edition URL copied.");
    }
    if (button.dataset.action === "delete") {
      if (!window.confirm(`Permanently delete “${issue.name}” and its uploaded files?`)) return;
      await requestJson(`/api/issues/${issue.id}`, { method: "DELETE" });
      await refreshData();
      showToast("Edition deleted.");
    }
    if (button.dataset.action === "more") {
      const action = issue.status === "public" ? "Move to draft" : "Publish now";
      if (!window.confirm(`${action}: ${issue.name}?`)) return;
      await updateIssue(issue, { status: issue.status === "public" ? "draft" : "public", scheduledAt: "" });
      await refreshData();
      showToast(`${issue.name} updated.`);
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
      document.querySelector(".sidebar-brand strong").textContent = siteName;
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
