const pageSlug = window.location.pathname.split("/").filter(Boolean).at(-1);
const status = document.querySelector("#info-status");

async function loadInfoPage() {
  try {
    const [pageResponse, pagesResponse, configResponse, themeResponse] = await Promise.all([
      fetch(`/api/public-pages/${encodeURIComponent(pageSlug)}`),
      fetch("/api/public-pages"),
      fetch("/api/public-config"),
      fetch("/api/theme")
    ]);
    const pageResult = await pageResponse.json();
    if (!pageResponse.ok) throw new Error(pageResult.error || "This information page was not found.");
    const [pagesResult, configResult, themeResult] = await Promise.all([
      pagesResponse.json(),
      configResponse.json(),
      themeResponse.json()
    ]);
    const basic = configResult.basic || {};
    const theme = themeResult.theme || {};
    const siteName = basic.siteName || "Vachana Kranti";
    document.querySelector(".brand strong").textContent = theme.navbar?.title || siteName;
    document.querySelector(".brand small").textContent = theme.navbar?.tagline || "Information";
    if (theme.appearance) {
      document.documentElement.style.setProperty("--green", theme.appearance.primaryColor || "#174c3a");
      document.documentElement.style.setProperty("--reader-background", theme.appearance.backgroundColor || "#f2f3ef");
      document.documentElement.style.setProperty("--reader-width", `${Math.min(1400, Math.max(600, Number(theme.appearance.pageWidth) || 900))}px`);
    }
    if (theme.additionalCss) {
      const style = document.createElement("style");
      style.textContent = theme.additionalCss;
      document.head.append(style);
    }
    document.title = `${pageResult.page.title} — ${siteName}`;
    document.querySelector("#info-title").textContent = pageResult.page.title;
    document.querySelector("#info-updated").textContent = `Updated ${new Date(pageResult.page.updatedAt).toLocaleDateString()}`;
    document.querySelector("#info-copy").textContent = pageResult.page.content;
    document.querySelector("#info-content").hidden = false;
    status.hidden = true;
    for (const page of pagesResult.pages.filter((item) => item.slug !== pageSlug)) {
      const link = document.createElement("a");
      link.href = `/page/${encodeURIComponent(page.slug)}`;
      link.textContent = page.title;
      document.querySelector("#info-page-links").append(link);
    }
  } catch (error) {
    status.className = "reader-status reader-error";
    status.textContent = error.message;
  }
}

loadInfoPage();
