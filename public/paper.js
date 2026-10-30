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

function openArticleModal(area) {
  let modal = document.querySelector("#article-viewer-modal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "article-viewer-modal";
    modal.className = "image-viewer";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.innerHTML = [
      '<div style="background:#fff; border-radius:12px; padding:28px; max-width:620px; width:92%; position:relative; box-shadow:0 16px 48px rgba(0,0,0,0.3); max-height:85vh; overflow-y:auto;">',
      '  <button id="article-modal-close" type="button" style="position:absolute; top:14px; right:16px; background:none; border:none; font-size:26px; cursor:pointer; color:#64748b; line-height:1;">×</button>',
      '  <div style="font-size:12px; font-weight:700; color:var(--gold, #d8ac5b); text-transform:uppercase; letter-spacing:0.06em; margin-bottom:8px;" id="article-modal-cat"></div>',
      '  <h2 style="font-size:22px; font-weight:700; color:#1a202c; margin:0 0 16px; line-height:1.35;" id="article-modal-title"></h2>',
      '  <div style="font-size:15px; line-height:1.75; color:#374151; white-space:pre-wrap;" id="article-modal-summary"></div>',
      '</div>'
    ].join("");
    document.body.appendChild(modal);
    modal.querySelector("#article-modal-close").addEventListener("click", () => {
      modal.hidden = true;
      document.body.classList.remove("viewer-open");
    });
    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        modal.hidden = true;
        document.body.classList.remove("viewer-open");
      }
    });
  }
  modal.querySelector("#article-modal-cat").textContent = area.category || "Article";
  modal.querySelector("#article-modal-title").textContent = area.title || "Article Detail";
  modal.querySelector("#article-modal-summary").textContent = area.summary || "No summary provided for this mapped article.";
  modal.hidden = false;
  document.body.classList.add("viewer-open");
}

function renderFile(file, index, issueIdValue, issue) {
  const source = `/media/${issueIdValue}/${encodeURIComponent(file.path)}`;
  const section = document.createElement("article");
  section.className = "paper-page";
  section.style.position = "relative";
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
    const wrapper = document.createElement("div");
    wrapper.style.position = "relative";
    wrapper.style.display = "block";
    wrapper.style.width = "100%";

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
    wrapper.append(image);

    const pageAreas = (issue?.areas || []).filter(a => a.pageIndex === index);
    pageAreas.forEach(area => {
      const hotspot = document.createElement("a");
      hotspot.className = "reader-hotspot";
      hotspot.href = "#";
      hotspot.title = area.title || "Read article";
      hotspot.style.position = "absolute";
      hotspot.style.left = `${area.coords?.x || 10}%`;
      hotspot.style.top = `${area.coords?.y || 10}%`;
      hotspot.style.width = `${area.coords?.width || 20}%`;
      hotspot.style.height = `${area.coords?.height || 20}%`;
      hotspot.style.cursor = "pointer";
      hotspot.style.border = "2px dashed rgba(23, 76, 58, 0.45)";
      hotspot.style.background = "rgba(216, 172, 91, 0.18)";
      hotspot.style.borderRadius = "4px";
      hotspot.style.transition = "all 0.2s ease";
      hotspot.addEventListener("mouseenter", () => {
        hotspot.style.background = "rgba(23, 76, 58, 0.3)";
        hotspot.style.borderColor = "var(--green, #174c3a)";
      });
      hotspot.addEventListener("mouseleave", () => {
        hotspot.style.background = "rgba(216, 172, 91, 0.18)";
        hotspot.style.borderColor = "rgba(23, 76, 58, 0.45)";
      });
      hotspot.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openArticleModal(area);
      });
      wrapper.append(hotspot);
    });

    section.append(wrapper);
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

    if (basic.logoUrl) {
      const brand = document.querySelector(".paper-topbar .brand");
      if (brand) {
        brand.innerHTML = `<img src="${basic.logoUrl}" alt="${basic.siteName || 'Vachana Kranti'}" style="max-height:42px; width:auto; object-fit:contain; display:block;">`;
      }
    }
    if (basic.faviconUrl) {
      let iconLink = document.querySelector("link[rel*='icon']");
      if (!iconLink) {
        iconLink = document.createElement("link");
        iconLink.rel = "icon";
        document.head.appendChild(iconLink);
      }
      iconLink.href = basic.faviconUrl;
    }

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
    if (!response.ok) {
      let details = {};
      try {
        details = await response.json();
      } catch {
        // Keep a useful reader error when the server does not return JSON.
      }
      const error = new Error(details.error || "The edition could not be loaded.");
      error.status = response.status;
      error.errorId = details.errorId || response.headers.get("x-error-id");
      throw error;
    }
    const result = await response.json();
    const issue = result.issue;
    if (!issue) {
      const error = new Error("This edition is unavailable.");
      error.status = 404;
      throw error;
    }

    document.title = `${issue.metaTitle || issue.name} — Vachana Kranti`;
    const description = document.createElement("meta");
    description.name = "description";
    description.content = issue.metaDescription || `${issue.name} — Vachana Kranti digital edition`;
    document.head.append(description);
    document.querySelector("#paper-title").textContent = issue.name;
    document.querySelector("#paper-date").textContent = formatDate(issue.date);
    document.querySelector("#page-count").textContent = `${issue.files.length} ${issue.files.length === 1 ? "page" : "pages"}`;
    document.querySelector("#paper-category").textContent = issue.category || "Main Edition";
    issue.files.forEach((file, index) => pageStack.append(renderFile(file, index, issue.id, issue)));
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
    document.title = error.status === 404
      ? "This edition is unavailable — Vachana Kranti"
      : "E-paper temporarily unavailable — Vachana Kranti";

    const unavailable = document.createElement("section");
    unavailable.className = "reader-unavailable";
    const mark = document.createElement("span");
    mark.className = "reader-unavailable-mark";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = "VK";
    const heading = document.createElement("h1");
    heading.textContent = error.status === 404
      ? "This edition is unavailable"
      : "We can’t load this edition right now";
    const message = document.createElement("p");
    message.textContent = error.status === 404
      ? "This ePaper may have been removed, the link may be incorrect, or the edition may not yet be published."
      : "Please check your connection and try again. Your edition has not been changed.";
    const actions = document.createElement("div");
    actions.className = "reader-unavailable-actions";
    const backLink = document.createElement("a");
    backLink.className = "button button-light";
    backLink.href = "/paper";
    backLink.textContent = "Back to ePaper Home";
    actions.append(backLink);
    if (!error.status || error.status >= 500) {
      const retryButton = document.createElement("button");
      retryButton.className = "button button-primary";
      retryButton.type = "button";
      retryButton.textContent = "Try again";
      retryButton.addEventListener("click", loadIssue);
      actions.append(retryButton);
    }
    unavailable.append(mark, heading, message, actions);
    if (error.errorId) {
      const reference = document.createElement("small");
      reference.className = "reader-error-id";
      reference.textContent = `Reference: ${error.errorId}`;
      unavailable.append(reference);
    }
    status.replaceChildren(unavailable);
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
