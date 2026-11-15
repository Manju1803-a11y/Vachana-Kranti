// paper.js — Vachana Kranti Modern ePaper Reader with Scrolling, Zoom, Crop & Archive
(function () {
  "use strict";

  // URL / Path params
  const pathParts = window.location.pathname.split("/").filter(Boolean);
  const issueKey = pathParts.length > 1 ? pathParts[1] : "demo";
  const urlParams = new URLSearchParams(window.location.search);
  const selectedDateParam = urlParams.get("date");

  // DOM Elements
  const statusEl = document.querySelector("#reader-status");
  const stageWrapper = document.querySelector("#paper-stage-wrapper");
  const pagesStack = document.querySelector("#paper-pages-stack");
  const paginationTrack = document.querySelector("#pagination-track");
  const datesCarousel = document.querySelector("#edition-dates-carousel");
  const bannerEditionName = document.querySelector("#banner-edition-name");
  const bannerEditionDate = document.querySelector("#banner-edition-date");
  const bannerPageNum = document.querySelector("#banner-page-num");
  const prevPageBtn = document.querySelector("#prev-page-btn");
  const nextPageBtn = document.querySelector("#next-page-btn");
  const editionSelect = document.querySelector("#edition-select");
  const darkModeBtn = document.querySelector("#btn-dark-toggle");
  const darkModeIcon = document.querySelector("#dark-mode-icon");
  const menuToggleBtn = document.querySelector("#menu-toggle-btn");
  const mobileNavDrawer = document.querySelector("#mobile-nav-drawer");

  // Zoom Modal Elements
  const zoomModal = document.querySelector("#zoom-modal");
  const zoomImage = document.querySelector("#zoom-image");
  const zoomTitle = document.querySelector("#zoom-modal-title");
  const btnZoom = document.querySelector("#btn-zoom");
  const zoomInBtn = document.querySelector("#zoom-in-btn");
  const zoomOutBtn = document.querySelector("#zoom-out-btn");
  const zoomResetBtn = document.querySelector("#zoom-reset-btn");
  const zoomDownloadBtn = document.querySelector("#zoom-download-btn");
  const zoomCloseBtn = document.querySelector("#zoom-close-btn");
  const zoomPanContainer = document.querySelector("#zoom-pan-container");

  // Crop Modal Elements
  const cropModal = document.querySelector("#crop-modal");
  const btnCrop = document.querySelector("#btn-crop");
  const cropCloseBtn = document.querySelector("#crop-close-btn");
  const cropDownloadBtn = document.querySelector("#crop-download-btn");
  const cropShareBtn = document.querySelector("#crop-share-btn");
  const cropSourceImage = document.querySelector("#crop-source-image");
  const cropSelectionBox = document.querySelector("#crop-selection-box");
  const cropWorkspace = document.querySelector("#crop-workspace-container");
  const cropCanvasWrapper = document.querySelector("#crop-canvas-wrapper");
  const cropRenderCanvas = document.querySelector("#crop-render-canvas");

  // Archive Modal Elements
  const archiveModal = document.querySelector("#archive-modal");
  const btnArchive = document.querySelector("#btn-archive");
  const archiveCloseBtn = document.querySelector("#archive-close-btn");
  const archiveDatePicker = document.querySelector("#archive-date-picker");
  const archiveGoBtn = document.querySelector("#archive-go-btn");
  const archiveRecentList = document.querySelector("#archive-recent-list");
  const drawerArchiveBtn = document.querySelector("#drawer-archive-btn");

  // Info Modal Elements
  const infoModal = document.querySelector("#info-modal");
  const infoCloseBtn = document.querySelector("#info-close-btn");
  const infoModalTitle = document.querySelector("#info-modal-title");
  const infoModalContent = document.querySelector("#info-modal-content");

  // PWA Banner Elements
  const pwaBanner = document.querySelector("#pwa-install-banner");
  const btnPwaDismiss = document.querySelector("#btn-pwa-dismiss");
  const btnPwaInstall = document.querySelector("#btn-pwa-install");

  // Reader State
  let currentIssue = null;
  let pagesData = [];
  let currentPage = 1;
  let totalPages = 1;
  let deferredPrompt = null;

  // Zoom State
  let zoomScale = 1;
  let zoomTranslateX = 0;
  let zoomTranslateY = 0;
  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;

  // Crop State
  let isDraggingCrop = false;
  let isResizingCrop = false;
  let currentHandle = null;
  let cropStartX = 0;
  let cropStartY = 0;
  let cropBoxLeft = 50;
  let cropBoxTop = 50;
  let cropBoxWidth = 200;
  let cropBoxHeight = 200;

  // Format date helper: "05/11/2026"
  function formatDateSlash(dateStr) {
    if (!dateStr) return "05/11/2026";
    const d = new Date(`${dateStr.slice(0, 10)}T00:00:00`);
    if (isNaN(d.getTime())) return dateStr;
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }

  // Format date readable: "05 Nov 2026"
  function formatDateReadable(dateStr) {
    if (!dateStr) return "05 Nov 2026";
    const d = new Date(`${dateStr.slice(0, 10)}T00:00:00`);
    if (isNaN(d.getTime())) return dateStr;
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const dd = String(d.getDate()).padStart(2, "0");
    const mon = months[d.getMonth()];
    const yyyy = d.getFullYear();
    return `${dd} ${mon} ${yyyy}`;
  }

  // Build Recent Dates Carousel (Matching Screenshot 1)
  function initDatesCarousel(activeDateStr) {
    if (!datesCarousel) return;
    datesCarousel.replaceChildren();

    const baseDate = activeDateStr ? new Date(`${activeDateStr.slice(0, 10)}T00:00:00`) : new Date();
    const daysToShow = 7;

    for (let i = 0; i < daysToShow; i++) {
      const d = new Date(baseDate);
      d.setDate(baseDate.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      const slash = formatDateSlash(iso);

      const circleItem = document.createElement("a");
      circleItem.className = `date-thumb-circle ${i === 0 ? "active" : ""}`;
      circleItem.href = `/paper/demo?date=${iso}`;
      circleItem.title = `Read edition for ${slash}`;
      circleItem.setAttribute("aria-label", `Edition date ${slash}`);

      const thumbSrc = currentIssue?.files?.[0]?.thumbnailUrl || `/media/${currentIssue?.id || "9cec51df7a48"}/thumbnail/01-120.webp`;
      circleItem.innerHTML = `
        <div class="thumb-avatar">
          <img src="${thumbSrc}" alt="Page 1 preview" width="58" height="58" loading="lazy">
          <span class="thumb-date-badge">${slash}</span>
        </div>
      `;

      circleItem.addEventListener("click", (e) => {
        e.preventDefault();
        document.querySelectorAll(".date-thumb-circle").forEach(el => el.classList.remove("active"));
        circleItem.classList.add("active");
        bannerEditionDate.textContent = slash;
        window.history.replaceState(null, "", `/paper/demo?date=${iso}`);
      });

      datesCarousel.appendChild(circleItem);
    }
  }

  // Build Recent Editions List for Archive Modal & Footer
  function initArchiveLists() {
    const dates = [
      { iso: "2026-11-05", label: "05 Nov 2026 (ಇಂದಿನ ಪತ್ರಿಕೆ / Today)" },
      { iso: "2026-11-04", label: "04 Nov 2026" },
      { iso: "2026-11-03", label: "03 Nov 2026" },
      { iso: "2026-11-02", label: "02 Nov 2026" },
      { iso: "2026-11-01", label: "01 Nov 2026" },
      { iso: "2026-10-31", label: "31 Oct 2026" },
      { iso: "2026-10-30", label: "30 Oct 2026" }
    ];

    if (archiveRecentList) {
      archiveRecentList.replaceChildren();
      dates.forEach(item => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "archive-item-btn";
        row.innerHTML = `<span class="arch-icon">📅</span> <strong>${item.label}</strong>`;
        row.addEventListener("click", () => {
          archiveModal.hidden = true;
          document.body.classList.remove("modal-open");
          bannerEditionDate.textContent = formatDateSlash(item.iso);
          window.history.replaceState(null, "", `/paper/demo?date=${item.iso}`);
          initDatesCarousel(item.iso);
        });
        archiveRecentList.appendChild(row);
      });
    }

    if (archiveDatePicker) {
      archiveDatePicker.value = new Date().toISOString().slice(0, 10);
    }
  }

  // Dark Mode Toggle
  function initDarkMode() {
    const isDark = localStorage.getItem("vk_reader_theme") === "dark";
    if (isDark) {
      document.body.classList.add("dark-mode");
      if (darkModeIcon) darkModeIcon.textContent = "☀️";
    }

    if (darkModeBtn) {
      darkModeBtn.addEventListener("click", () => {
        const currentlyDark = document.body.classList.toggle("dark-mode");
        localStorage.setItem("vk_reader_theme", currentlyDark ? "dark" : "light");
        if (darkModeIcon) darkModeIcon.textContent = currentlyDark ? "☀️" : "🌙";
      });
    }
  }

  // PWA Prompt
  function initPWA() {
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferredPrompt = e;
      if (pwaBanner && !localStorage.getItem("vk_pwa_dismissed")) {
        pwaBanner.classList.add("visible");
      }
    });

    if (btnPwaInstall) {
      btnPwaInstall.addEventListener("click", async () => {
        if (deferredPrompt) {
          deferredPrompt.prompt();
          const { outcome } = await deferredPrompt.userChoice;
          deferredPrompt = null;
          pwaBanner.classList.remove("visible");
        } else {
          alert("To install: tap Share (iOS Safari) or the browser menu ⋮ (Chrome) and select 'Add to Home Screen'.");
        }
      });
    }

    if (btnPwaDismiss && pwaBanner) {
      btnPwaDismiss.addEventListener("click", () => {
        pwaBanner.classList.remove("visible");
        localStorage.setItem("vk_pwa_dismissed", "true");
      });
      if (!localStorage.getItem("vk_pwa_dismissed")) {
        setTimeout(() => pwaBanner.classList.add("visible"), 2000);
      }
    }
  }

  // Mobile menu toggle
  if (menuToggleBtn && mobileNavDrawer) {
    menuToggleBtn.addEventListener("click", () => {
      const isExpanded = menuToggleBtn.getAttribute("aria-expanded") === "true";
      menuToggleBtn.setAttribute("aria-expanded", String(!isExpanded));
      mobileNavDrawer.hidden = isExpanded;
    });
  }

  // Edition selection dropdown
  if (editionSelect) {
    editionSelect.addEventListener("change", () => {
      const selected = editionSelect.value;
      if (bannerEditionName) bannerEditionName.textContent = selected;
    });
  }

  // Update Page Navigation & Active Indicators
  function setCurrentPage(pageNum) {
    if (pageNum < 1) pageNum = 1;
    if (pageNum > totalPages) pageNum = totalPages;
    currentPage = pageNum;

    // Update banner
    if (bannerPageNum) bannerPageNum.textContent = String(currentPage);

    // Update bottom pagination
    document.querySelectorAll(".page-num-pill").forEach(pill => {
      const p = Number(pill.dataset.page);
      if (p === currentPage) {
        pill.classList.add("active");
        pill.setAttribute("aria-current", "page");
      } else {
        pill.classList.remove("active");
        pill.removeAttribute("aria-current");
      }
    });

    // Update floating nav arrows
    if (prevPageBtn) prevPageBtn.disabled = currentPage <= 1;
    if (nextPageBtn) nextPageBtn.disabled = currentPage >= totalPages;
  }

  function scrollToPage(pageNum) {
    setCurrentPage(pageNum);
    const targetCard = document.querySelector(`#page-card-${pageNum}`);
    if (targetCard) {
      targetCard.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  // Render Page Stack & Bottom Pagination Bar
  function renderPages(files, issueId) {
    pagesStack.replaceChildren();
    paginationTrack.replaceChildren();

    // Fallback if files is empty: create 8 pages
    if (!files || files.length === 0) {
      files = Array.from({ length: 8 }, (_, i) => ({
        name: `Page ${i + 1}`,
        path: `0${i + 1}.jpg`,
        type: "image/jpeg"
      }));
    }

    pagesData = files;
    totalPages = files.length;

    files.forEach((file, index) => {
      const pageIndex = index + 1;
      const fileUrl = file.url || `/media/${issueId}/${encodeURIComponent(file.path)}`;
      const readingUrl = file.optimizedUrl || fileUrl;
      const fullResUrl = file.originalUrl || fileUrl;

      // 1. Create Page Card in Stack
      const pageCard = document.createElement("article");
      pageCard.className = "paper-page-card";
      pageCard.id = `page-card-${pageIndex}`;
      pageCard.dataset.page = String(pageIndex);

      // Page header tag
      const cardHeader = document.createElement("div");
      cardHeader.className = "page-card-header";
      cardHeader.innerHTML = `
        <span class="page-badge">PAGE ${pageIndex} / ${totalPages}</span>
        <span class="page-actions-inline">
          <button type="button" class="inline-tool-btn" data-action="zoom" data-src="${fullResUrl}" data-page="${pageIndex}">🔍 Zoom</button>
          <button type="button" class="inline-tool-btn" data-action="crop" data-src="${fullResUrl}" data-page="${pageIndex}">✂ Crop</button>
          <a class="inline-tool-btn" href="${fullResUrl}" download="vachana-kranti-p${pageIndex}.jpg">⬇ Download</a>
        </span>
      `;
      pageCard.appendChild(cardHeader);

      // Image container
      const imageWrapper = document.createElement("div");
      imageWrapper.className = "newspaper-image-wrapper";

      const pageImg = document.createElement("img");
      pageImg.className = "newspaper-page-img";
      pageImg.src = readingUrl;
      pageImg.alt = `Vachana Kranti - Page ${pageIndex}`;
      pageImg.width = 1400;
      pageImg.height = 2220;
      pageImg.loading = index === 0 ? "eager" : "lazy";
      pageImg.decoding = "async";
      if (index === 0) pageImg.fetchPriority = "high";

      // Click on image opens Zoom modal with crystal-clear full-res scan
      pageImg.addEventListener("click", () => openZoomModal(fullResUrl, pageIndex));

      imageWrapper.appendChild(pageImg);
      pageCard.appendChild(imageWrapper);
      pagesStack.appendChild(pageCard);

      // 2. Create Bottom Pagination Button [ 1 ] [ 2 ] ...
      const pillBtn = document.createElement("button");
      pillBtn.type = "button";
      pillBtn.className = `page-num-pill ${pageIndex === 1 ? "active" : ""}`;
      pillBtn.dataset.page = String(pageIndex);
      pillBtn.textContent = String(pageIndex);
      pillBtn.setAttribute("aria-label", `Go to page ${pageIndex}`);
      pillBtn.addEventListener("click", () => scrollToPage(pageIndex));
      paginationTrack.appendChild(pillBtn);
    });

    // Delegate inline tool clicks
    pagesStack.addEventListener("click", (e) => {
      const btn = e.target.closest(".inline-tool-btn");
      if (!btn) return;
      const action = btn.dataset.action;
      const src = btn.dataset.src;
      const page = Number(btn.dataset.page);
      if (action === "zoom") {
        openZoomModal(src, page);
      } else if (action === "crop") {
        openCropModal(src, page);
      }
    });

    // Setup IntersectionObserver for Smooth Scroll Page Detection
    setupScrollObserver();

    // Floating Prev/Next Buttons
    if (prevPageBtn) {
      prevPageBtn.addEventListener("click", () => {
        if (currentPage > 1) scrollToPage(currentPage - 1);
      });
    }
    if (nextPageBtn) {
      nextPageBtn.addEventListener("click", () => {
        if (currentPage < totalPages) scrollToPage(currentPage + 1);
      });
    }

    setCurrentPage(1);
  }

  // Smooth Scroll Page Tracking
  function setupScrollObserver() {
    if (!("IntersectionObserver" in window)) {
      // Fallback scroll listener
      window.addEventListener("scroll", () => {
        const cards = document.querySelectorAll(".paper-page-card");
        const scrollMid = window.scrollY + window.innerHeight * 0.35;
        for (const card of cards) {
          const rect = card.getBoundingClientRect();
          const cardTop = rect.top + window.scrollY;
          const cardBottom = cardTop + rect.height;
          if (scrollMid >= cardTop && scrollMid <= cardBottom) {
            const page = Number(card.dataset.page);
            if (page && page !== currentPage) setCurrentPage(page);
            break;
          }
        }
      }, { passive: true });
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.35) {
          const page = Number(entry.target.dataset.page);
          if (page && page !== currentPage) {
            setCurrentPage(page);
          }
        }
      });
    }, {
      threshold: [0.35, 0.6]
    });

    document.querySelectorAll(".paper-page-card").forEach(card => observer.observe(card));
  }

  // Touch Swipe Gesture for Mobile Readers
  function initSwipeNavigation() {
    let touchStartX = 0;
    let touchStartY = 0;
    let touchEndX = 0;
    let touchEndY = 0;

    pagesStack.addEventListener("touchstart", (e) => {
      touchStartX = e.changedTouches[0].screenX;
      touchStartY = e.changedTouches[0].screenY;
    }, { passive: true });

    pagesStack.addEventListener("touchend", (e) => {
      touchEndX = e.changedTouches[0].screenX;
      touchEndY = e.changedTouches[0].screenY;
      handleSwipe();
    }, { passive: true });

    function handleSwipe() {
      const diffX = touchEndX - touchStartX;
      const diffY = touchEndY - touchStartY;
      // Only register horizontal swipes if greater than vertical movement
      if (Math.abs(diffX) > 60 && Math.abs(diffX) > Math.abs(diffY)) {
        if (diffX < 0 && currentPage < totalPages) {
          // Swipe Left -> Next Page
          scrollToPage(currentPage + 1);
        } else if (diffX > 0 && currentPage > 1) {
          // Swipe Right -> Prev Page
          scrollToPage(currentPage - 1);
        }
      }
    }

    // Keyboard navigation
    window.addEventListener("keydown", (e) => {
      if (zoomModal && !zoomModal.hidden) return;
      if (cropModal && !cropModal.hidden) return;
      if (archiveModal && !archiveModal.hidden) return;

      if (e.key === "ArrowLeft" && currentPage > 1) {
        scrollToPage(currentPage - 1);
      } else if (e.key === "ArrowRight" && currentPage < totalPages) {
        scrollToPage(currentPage + 1);
      }
    });
  }

  // ==========================================
  // 🔍 ZOOM MODAL IMPLEMENTATION
  // ==========================================
  function openZoomModal(imageSrc, pageNum) {
    if (!zoomModal) return;
    pageNum = pageNum || currentPage;
    const src = imageSrc || `/media/${currentIssue?.id || "9cec51df7a48"}/${pagesData[pageNum - 1]?.path || "01.jpg"}`;

    zoomImage.src = src;
    if (zoomTitle) zoomTitle.textContent = `Page ${pageNum} — Crystal Zoom View`;
    zoomScale = 1;
    zoomTranslateX = 0;
    zoomTranslateY = 0;
    applyZoomTransform();

    zoomModal.hidden = false;
    document.body.classList.add("modal-open");
  }

  function closeZoomModal() {
    if (!zoomModal) return;
    zoomModal.hidden = true;
    document.body.classList.remove("modal-open");
    zoomImage.src = "";
  }

  function applyZoomTransform() {
    if (zoomImage) {
      zoomImage.style.transform = `translate(${zoomTranslateX}px, ${zoomTranslateY}px) scale(${zoomScale})`;
    }
  }

  function initZoomModal() {
    if (btnZoom) {
      btnZoom.addEventListener("click", () => {
        const curFile = pagesData[currentPage - 1];
        const src = `/media/${currentIssue?.id || "9cec51df7a48"}/${curFile?.path || "01.jpg"}`;
        openZoomModal(src, currentPage);
      });
    }

    if (zoomCloseBtn) zoomCloseBtn.addEventListener("click", closeZoomModal);

    if (zoomInBtn) {
      zoomInBtn.addEventListener("click", () => {
        zoomScale = Math.min(zoomScale + 0.35, 4.0);
        applyZoomTransform();
      });
    }

    if (zoomOutBtn) {
      zoomOutBtn.addEventListener("click", () => {
        zoomScale = Math.max(zoomScale - 0.35, 0.7);
        applyZoomTransform();
      });
    }

    if (zoomResetBtn) {
      zoomResetBtn.addEventListener("click", () => {
        zoomScale = 1;
        zoomTranslateX = 0;
        zoomTranslateY = 0;
        applyZoomTransform();
      });
    }

    if (zoomDownloadBtn) {
      zoomDownloadBtn.addEventListener("click", () => {
        if (!zoomImage.src) return;
        const a = document.createElement("a");
        a.href = zoomImage.src;
        a.download = `vachana-kranti-page-${currentPage}.jpg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      });
    }

    // Mouse drag pan support
    if (zoomPanContainer) {
      zoomPanContainer.addEventListener("pointerdown", (e) => {
        if (e.target !== zoomImage && e.target !== zoomPanContainer) return;
        isPanning = true;
        panStartX = e.clientX - zoomTranslateX;
        panStartY = e.clientY - zoomTranslateY;
        zoomPanContainer.setPointerCapture(e.pointerId);
      });

      zoomPanContainer.addEventListener("pointermove", (e) => {
        if (!isPanning) return;
        zoomTranslateX = e.clientX - panStartX;
        zoomTranslateY = e.clientY - panStartY;
        applyZoomTransform();
      });

      const endPan = (e) => {
        if (isPanning) {
          isPanning = false;
          try { zoomPanContainer.releasePointerCapture(e.pointerId); } catch {}
        }
      };

      zoomPanContainer.addEventListener("pointerup", endPan);
      zoomPanContainer.addEventListener("pointercancel", endPan);

      // Wheel Zoom
      zoomPanContainer.addEventListener("wheel", (e) => {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.2 : -0.2;
        zoomScale = Math.min(Math.max(0.7, zoomScale + delta), 4.0);
        applyZoomTransform();
      }, { passive: false });
    }
  }

  // ==========================================
  // ✂ CROP ARTICLE CLIPPING TOOL
  // ==========================================
  function openCropModal(imageSrc, pageNum) {
    if (!cropModal) return;
    pageNum = pageNum || currentPage;
    const src = imageSrc || `/media/${currentIssue?.id || "9cec51df7a48"}/${pagesData[pageNum - 1]?.path || "01.jpg"}`;

    cropSourceImage.src = src;
    cropModal.hidden = false;
    document.body.classList.add("modal-open");

    // Position initial crop box once image loads
    cropSourceImage.onload = () => {
      const rect = cropSourceImage.getBoundingClientRect();
      cropBoxWidth = Math.min(rect.width * 0.7, 260);
      cropBoxHeight = Math.min(rect.height * 0.4, 260);
      cropBoxLeft = Math.max(10, (rect.width - cropBoxWidth) / 2);
      cropBoxTop = Math.max(10, (rect.height - cropBoxHeight) / 3);
      updateCropBoxStyles();
    };
  }

  function closeCropModal() {
    if (!cropModal) return;
    cropModal.hidden = true;
    document.body.classList.remove("modal-open");
    cropSourceImage.src = "";
  }

  function updateCropBoxStyles() {
    if (!cropSelectionBox) return;
    cropSelectionBox.style.left = `${cropBoxLeft}px`;
    cropSelectionBox.style.top = `${cropBoxTop}px`;
    cropSelectionBox.style.width = `${cropBoxWidth}px`;
    cropSelectionBox.style.height = `${cropBoxHeight}px`;
  }

  function initCropTool() {
    if (btnCrop) {
      btnCrop.addEventListener("click", () => {
        const curFile = pagesData[currentPage - 1];
        const src = `/media/${currentIssue?.id || "9cec51df7a48"}/${curFile?.path || "01.jpg"}`;
        openCropModal(src, currentPage);
      });
    }

    if (cropCloseBtn) cropCloseBtn.addEventListener("click", closeCropModal);

    // Draggable / Resizable Crop Box
    if (cropSelectionBox && cropCanvasWrapper) {
      cropSelectionBox.addEventListener("pointerdown", (e) => {
        const handle = e.target.closest(".crop-handle");
        if (handle) {
          isResizingCrop = true;
          currentHandle = handle.dataset.dir;
          cropStartX = e.clientX;
          cropStartY = e.clientY;
          e.stopPropagation();
          cropSelectionBox.setPointerCapture(e.pointerId);
          return;
        }

        isDraggingCrop = true;
        cropStartX = e.clientX - cropBoxLeft;
        cropStartY = e.clientY - cropBoxTop;
        cropSelectionBox.setPointerCapture(e.pointerId);
      });

      cropSelectionBox.addEventListener("pointermove", (e) => {
        const imgRect = cropSourceImage.getBoundingClientRect();

        if (isDraggingCrop) {
          let nextLeft = e.clientX - cropStartX;
          let nextTop = e.clientY - cropStartY;

          nextLeft = Math.max(0, Math.min(nextLeft, imgRect.width - cropBoxWidth));
          nextTop = Math.max(0, Math.min(nextTop, imgRect.height - cropBoxHeight));

          cropBoxLeft = nextLeft;
          cropBoxTop = nextTop;
          updateCropBoxStyles();
        } else if (isResizingCrop && currentHandle) {
          const dx = e.clientX - cropStartX;
          const dy = e.clientY - cropStartY;
          cropStartX = e.clientX;
          cropStartY = e.clientY;

          const minSize = 40;

          if (currentHandle.includes("r")) {
            cropBoxWidth = Math.max(minSize, Math.min(cropBoxWidth + dx, imgRect.width - cropBoxLeft));
          }
          if (currentHandle.includes("b")) {
            cropBoxHeight = Math.max(minSize, Math.min(cropBoxHeight + dy, imgRect.height - cropBoxTop));
          }
          if (currentHandle.includes("l")) {
            const nextWidth = cropBoxWidth - dx;
            if (nextWidth >= minSize && cropBoxLeft + dx >= 0) {
              cropBoxLeft += dx;
              cropBoxWidth = nextWidth;
            }
          }
          if (currentHandle.includes("t")) {
            const nextHeight = cropBoxHeight - dy;
            if (nextHeight >= minSize && cropBoxTop + dy >= 0) {
              cropBoxTop += dy;
              cropBoxHeight = nextHeight;
            }
          }
          updateCropBoxStyles();
        }
      });

      const stopCropPointer = (e) => {
        isDraggingCrop = false;
        isResizingCrop = false;
        currentHandle = null;
        try { cropSelectionBox.releasePointerCapture(e.pointerId); } catch {}
      };

      cropSelectionBox.addEventListener("pointerup", stopCropPointer);
      cropSelectionBox.addEventListener("pointercancel", stopCropPointer);
    }

    // Download Cropped Clipping in Full Resolution
    async function getCroppedBlob() {
      return new Promise((resolve, reject) => {
        const naturalWidth = cropSourceImage.naturalWidth;
        const naturalHeight = cropSourceImage.naturalHeight;
        const displayWidth = cropSourceImage.clientWidth;
        const displayHeight = cropSourceImage.clientHeight;

        if (!naturalWidth || !displayWidth) return reject(new Error("Image not ready"));

        const scaleX = naturalWidth / displayWidth;
        const scaleY = naturalHeight / displayHeight;

        const sourceX = cropBoxLeft * scaleX;
        const sourceY = cropBoxTop * scaleY;
        const sourceW = cropBoxWidth * scaleX;
        const sourceH = cropBoxHeight * scaleY;

        cropRenderCanvas.width = sourceW;
        cropRenderCanvas.height = sourceH;
        const ctx = cropRenderCanvas.getContext("2d");

        ctx.drawImage(
          cropSourceImage,
          sourceX, sourceY, sourceW, sourceH,
          0, 0, sourceW, sourceH
        );

        cropRenderCanvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Could not create clipping blob"));
        }, "image/jpeg", 0.95);
      });
    }

    if (cropDownloadBtn) {
      cropDownloadBtn.addEventListener("click", async () => {
        try {
          const blob = await getCroppedBlob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `vachana-kranti-clip-${bannerEditionDate.textContent.replace(/\//g, "-")}-p${currentPage}.jpg`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        } catch (err) {
          alert("Could not download clipping: " + err.message);
        }
      });
    }

    if (cropShareBtn) {
      cropShareBtn.addEventListener("click", async () => {
        try {
          const blob = await getCroppedBlob();
          const file = new File([blob], `vk-clipping-p${currentPage}.jpg`, { type: "image/jpeg" });
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({
              title: "ವಚನ ಕ್ರಾಂತಿ ಪತ್ರಿಕಾ ಕ್ಲಿಪ್ಪಿಂಗ್ (Vachana Kranti)",
              text: `ವಚನ ಕ್ರಾಂತಿ ಇ-ಪೇಪರ್ ಕ್ಲಿಪ್ಪಿಂಗ್: ${bannerEditionName.textContent} - Page ${currentPage}`,
              files: [file]
            });
          } else {
            // Fallback download & share link
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `vk-clipping-p${currentPage}.jpg`;
            a.click();
            URL.revokeObjectURL(url);
            navigator.clipboard?.writeText(window.location.href);
            alert("Clipping downloaded! Reader link copied to clipboard.");
          }
        } catch (err) {
          if (err.name !== "AbortError") {
            alert("Could not share clipping: " + err.message);
          }
        }
      });
    }
  }

  // ==========================================
  // 📅 ARCHIVE MODAL IMPLEMENTATION
  // ==========================================
  function openArchiveModal() {
    if (!archiveModal) return;
    archiveModal.hidden = false;
    document.body.classList.add("modal-open");
  }

  function closeArchiveModal() {
    if (!archiveModal) return;
    archiveModal.hidden = true;
    document.body.classList.remove("modal-open");
  }

  function initArchiveModal() {
    if (btnArchive) btnArchive.addEventListener("click", openArchiveModal);
    if (drawerArchiveBtn) {
      drawerArchiveBtn.addEventListener("click", (e) => {
        e.preventDefault();
        if (mobileNavDrawer) mobileNavDrawer.hidden = true;
        openArchiveModal();
      });
    }
    if (archiveCloseBtn) archiveCloseBtn.addEventListener("click", closeArchiveModal);

    if (archiveGoBtn && archiveDatePicker) {
      archiveGoBtn.addEventListener("click", () => {
        const val = archiveDatePicker.value;
        if (!val) return;
        closeArchiveModal();
        bannerEditionDate.textContent = formatDateSlash(val);
        window.history.replaceState(null, "", `/paper/demo?date=${val}`);
        initDatesCarousel(val);
      });
    }
  }

  // Info modal for Footer links
  function initFooterLinks() {
    const showInfo = (title, html) => {
      if (!infoModal) return;
      infoModalTitle.textContent = title;
      infoModalContent.innerHTML = html;
      infoModal.hidden = false;
      document.body.classList.add("modal-open");
    };

    if (infoCloseBtn) {
      infoCloseBtn.addEventListener("click", () => {
        infoModal.hidden = true;
        document.body.classList.remove("modal-open");
      });
    }

    document.querySelector("#link-privacy")?.addEventListener("click", (e) => {
      e.preventDefault();
      showInfo("Privacy Policy", "<p>ವಚನ ಕ್ರಾಂತಿ (Vachana Kranti) respects your privacy. We do not collect personal identifying information without your consent. Reader session statistics are collected purely to maintain quality and performance.</p>");
    });

    document.querySelector("#link-disclaimer")?.addEventListener("click", (e) => {
      e.preventDefault();
      showInfo("Disclaimer", "<p>All news reports, opinions, and images published in Vachana Kranti ePaper are the property of Vachana Kranti Publications. Unauthorized commercial re-publication is strictly prohibited.</p>");
    });

    document.querySelector("#link-terms")?.addEventListener("click", (e) => {
      e.preventDefault();
      showInfo("Terms And Conditions", "<p>By accessing Vachana Kranti digital edition, you agree to comply with our Terms of Use. Readers are welcome to read, zoom, and share article clippings for personal, non-commercial purposes.</p>");
    });

    document.querySelector("#link-social")?.addEventListener("click", (e) => {
      e.preventDefault();
      showInfo("Social Pages", "<p>Follow Vachana Kranti on social media:</p><ul><li><a href='https://facebook.com' target='_blank' rel='noopener'>Facebook: Vachana Kranti News</a></li><li><a href='https://twitter.com' target='_blank' rel='noopener'>Twitter / X: @vknewsbdr</a></li><li><a href='https://instagram.com' target='_blank' rel='noopener'>Instagram: @vachanakranti</a></li><li><a href='https://whatsapp.com' target='_blank' rel='noopener'>WhatsApp Channel</a></li></ul>");
    });
  }

  // Global Escape Key Listener for Modals
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeZoomModal();
      closeCropModal();
      closeArchiveModal();
      if (infoModal) {
        infoModal.hidden = true;
        document.body.classList.remove("modal-open");
      }
    }
  });

  // ==========================================
  // 🚀 MAIN ISSUE LOADER
  // ==========================================
  async function loadEdition() {
    try {
      const targetKey = issueKey || "demo";
      const resp = await fetch(`/api/reader/${encodeURIComponent(targetKey)}`);
      if (!resp.ok) {
        throw new Error(`Failed to load edition (HTTP ${resp.status})`);
      }
      const data = await resp.json();
      currentIssue = data.issue;

      if (!currentIssue) {
        throw new Error("Edition data not found");
      }

      // Title & Date setup
      const activeDate = selectedDateParam || currentIssue.date || "2026-11-05";
      const formattedDate = formatDateSlash(activeDate);

      if (bannerEditionDate) bannerEditionDate.textContent = formattedDate;
      if (bannerEditionName) bannerEditionName.textContent = currentIssue.category || "Main Edition";
      document.title = `${currentIssue.name || "Main Edition"} (${formattedDate}) — ವಚನ ಕ್ರಾಂತಿ`;

      // Render carousel
      initDatesCarousel(activeDate);

      // Render all 8 pages
      renderPages(currentIssue.files, currentIssue.id);

      // Display stage
      if (statusEl) statusEl.hidden = true;
      if (stageWrapper) stageWrapper.hidden = false;

    } catch (err) {
      console.warn("Could not load from API, falling back to local demo edition:", err.message);
      // Fallback demo issue
      const demoFiles = Array.from({ length: 8 }, (_, i) => ({
        name: `Page ${i + 1}`,
        path: `0${i + 1}.jpg`,
        type: "image/jpeg"
      }));

      const activeDate = selectedDateParam || "2026-11-05";
      if (bannerEditionDate) bannerEditionDate.textContent = formatDateSlash(activeDate);
      if (bannerEditionName) bannerEditionName.textContent = "Main Edition";
      initDatesCarousel(activeDate);
      renderPages(demoFiles, "9cec51df7a48");

      if (statusEl) statusEl.hidden = true;
      if (stageWrapper) stageWrapper.hidden = false;
    }
  }

  // Initialize features
  initDarkMode();
  initArchiveLists();
  initArchiveModal();
  initZoomModal();
  initCropTool();
  initFooterLinks();
  initPWA();
  initSwipeNavigation();

  // Load edition
  loadEdition();
})();
