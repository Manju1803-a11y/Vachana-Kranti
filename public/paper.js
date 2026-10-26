const issueKey = window.location.pathname.split("/").filter(Boolean).at(-1);
const status = document.querySelector("#reader-status");
const content = document.querySelector("#paper-content");
const pageStack = document.querySelector("#page-stack");
const viewer = document.querySelector("#image-viewer");
const viewerImage = document.querySelector("#viewer-image");
const viewerCaption = document.querySelector("#viewer-caption");

function formatDate(value) {
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric"
  });
}

function openViewer(source, caption) {
  viewerImage.src = source;
  viewerImage.alt = caption;
  viewerCaption.textContent = caption;
  viewer.hidden = false;
  document.body.classList.add("viewer-open");
  document.querySelector("#viewer-close").focus();
}

function closeViewer() {
  viewer.hidden = true;
  document.body.classList.remove("viewer-open");
  viewerImage.src = "";
}

function renderFile(file, index, issueIdValue) {
  const source = `/media/${issueIdValue}/${encodeURIComponent(file.path)}`;
  const section = document.createElement("article");
  section.className = "paper-page";
  const heading = document.createElement("div");
  heading.className = "paper-page-heading";
  const pageLabel = document.createElement("span");
  pageLabel.textContent = `PAGE ${String(index + 1).padStart(2, "0")}`;
  const fileName = document.createElement("span");
  fileName.textContent = file.name;
  heading.append(pageLabel, fileName);
  section.append(heading);
  if (file.type === "application/pdf") {
    const frame = document.createElement("iframe");
    frame.className = "pdf-frame";
    frame.src = `${source}#toolbar=1&navpanes=0`;
    frame.loading = index === 0 ? "eager" : "lazy";
    frame.title = file.name;
    const download = document.createElement("a");
    download.className = "pdf-fallback";
    download.href = source;
    download.download = file.name;
    download.textContent = "Open or download this PDF";
    section.append(frame, download);
  } else {
    const image = document.createElement("img");
    image.className = "paper-image";
    image.src = source;
    image.alt = `${file.name}, page ${index + 1}`;
    image.loading = index === 0 ? "eager" : "lazy";
    if (index === 0) image.fetchPriority = "high";
    image.tabIndex = 0;
    image.setAttribute("role", "button");
    image.setAttribute("aria-label", `Expand ${file.name}`);
    image.addEventListener("click", () => openViewer(source, file.name));
    image.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openViewer(source, file.name);
      }
    });
    section.append(image);
  }
  const download = document.createElement("a");
  download.className = "page-download";
  download.href = source;
  download.download = file.name;
  download.textContent = "Download page ↓";
  section.append(download);
  return section;
}

async function applyReaderSettings(issue, readerData) {
  try {
    const theme = readerData.theme || {};
    const { basic = {}, watermark = {}, social = {}, seo = {} } = readerData.config || {};
    const pages = readerData.pages || [];
    if (theme.appearance) {
      const root = document.documentElement;
      root.style.setProperty("--green", theme.appearance.primaryColor || "#174c3a");
      root.style.setProperty("--deep-green", theme.appearance.primaryColor || "#103a2d");
      root.style.setProperty("--gold", theme.appearance.accentColor || "#d8ac5b");
      root.style.setProperty("--reader-background", theme.appearance.backgroundColor || "#f2f3ef");
      root.style.setProperty("--reader-width", `${Math.min(1400, Math.max(600, Number(theme.appearance.pageWidth) || 900))}px`);
      root.style.setProperty("--reader-font", `"${theme.appearance.font || "DM Sans"}", sans-serif`);
    }
    if (theme.navbar) {
      const siteName = basic.siteName || "Vachana Kranti";
      document.querySelector(".paper-topbar .brand strong").textContent = theme.navbar.title || siteName;
      document.querySelector(".paper-topbar .brand small").textContent = theme.navbar.tagline || "Digital edition";
      if (theme.navbar.sticky) document.querySelector(".paper-topbar").classList.add("reader-sticky");
    }
    document.querySelector("#reader-credit").textContent = basic.credit || basic.siteName || "Vachana Kranti";
    const category = document.querySelector("#paper-category");
    if (!theme.appearance?.showCategory) category.hidden = true;
    if (watermark.enabled) {
      const mark = document.createElement("div");
      mark.className = `reader-watermark watermark-${watermark.position || "bottom-right"}`;
      mark.textContent = watermark.text || basic.siteName || "Vachana Kranti";
      mark.style.opacity = String(Math.min(100, Math.max(0, Number(watermark.opacity) || 35)) / 100);
      document.querySelector("#paper-content").append(mark);
    }
    const infoLinks = document.querySelector("#info-pages");
    for (const page of pages) {
      const link = document.createElement("a");
      link.href = `/page/${encodeURIComponent(page.slug)}`;
      link.textContent = page.title;
      infoLinks.append(link);
    }
    for (const [network, href] of Object.entries(social)) {
      if (!href) continue;
      const link = document.createElement("a");
      link.href = href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = network === "x" ? "X" : network[0].toUpperCase() + network.slice(1);
      infoLinks.append(link);
    }
    document.title = issue.metaTitle
      ? `${issue.metaTitle} — ${siteName}`
      : seo.title || `${issue.name} — ${siteName}`;
    if (!issue.metaDescription && seo.description) {
      const description = document.querySelector('meta[name="description"]');
      if (description) description.content = seo.description;
    }
    if (theme.additionalCss) {
      const customStyle = document.createElement("style");
      customStyle.textContent = theme.additionalCss;
      document.head.append(customStyle);
    }
  } catch (error) {
    console.error("Reader settings could not be loaded:", error);
  }
}

async function loadIssue() {
  try {
    const response = await fetch(`/api/reader/${encodeURIComponent(issueKey)}`);
    if (!response.ok) throw new Error("The edition could not be loaded.");
    const result = await response.json();
    const issue = result.issue;
    if (!issue) throw new Error("This e-paper issue was not found.");

    document.title = `${issue.metaTitle || issue.name} — Vachana Kranti`;
    const description = document.createElement("meta");
    description.name = "description";
    description.content = issue.metaDescription || `${issue.name} — Vachana Kranti digital edition`;
    document.head.append(description);
    document.querySelector("#paper-title").textContent = issue.name;
    document.querySelector("#paper-date").textContent = formatDate(issue.date);
    document.querySelector("#page-count").textContent = `${issue.files.length} ${issue.files.length === 1 ? "page" : "pages"}`;
    document.querySelector("#paper-category").textContent = issue.category || "Main Edition";
    issue.files.forEach((file, index) => pageStack.append(renderFile(file, index, issue.id)));
    const navigation = document.querySelector("#edition-navigation");
    const newerIssue = result.newerIssue;
    const olderIssue = result.olderIssue;
    navigation.replaceChildren();
    if (newerIssue) {
      const newer = document.createElement("a");
      newer.href = newerIssue.url;
      newer.innerHTML = `<span>← NEWER EDITION</span><strong></strong>`;
      newer.querySelector("strong").textContent = newerIssue.name;
      navigation.append(newer);
    } else {
      navigation.append(document.createElement("span"));
    }
    if (olderIssue) {
      const older = document.createElement("a");
      older.href = olderIssue.url;
      older.className = "nav-older";
      older.innerHTML = `<span>OLDER EDITION →</span><strong></strong>`;
      older.querySelector("strong").textContent = olderIssue.name;
      navigation.append(older);
    }
    status.hidden = true;
    content.hidden = false;
    await applyReaderSettings(issue, result);
  } catch (error) {
    status.className = "reader-status reader-error";
    status.textContent = error.message;
  }
}

document.querySelector("#print-button").addEventListener("click", () => window.print());
document.querySelector("#viewer-close").addEventListener("click", closeViewer);
viewer.addEventListener("click", (event) => {
  if (event.target === viewer) closeViewer();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !viewer.hidden) closeViewer();
});

loadIssue();
