// imagePipeline.js – High-Performance Image Optimization & Variant Pipeline for Vachana Kranti
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const TARGET_READING_WIDTH = 1400;
const WEBP_QUALITY = 75;
const THUMB_120_SIZE = 120;
const THUMB_60_SIZE = 60;

/**
 * Ensures the standard directory structure for an edition's media assets
 * /data/issues/<id>/
 *   ├── original/
 *   ├── optimized/
 *   ├── thumbnails/
 *   └── archive/
 */
function initIssueImageDirectories(issueDir) {
  const dirs = {
    original: path.join(issueDir, "original"),
    optimized: path.join(issueDir, "optimized"),
    thumbnails: path.join(issueDir, "thumbnails"),
    archive: path.join(issueDir, "archive")
  };

  for (const dir of Object.values(dirs)) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  return dirs;
}

/**
 * Optimizes an input newspaper scan into standard reading WebP and dedicated thumbnails.
 * Never overwrites the original scan.
 * 
 * @param {Buffer|string} input - Image buffer or source file path
 * @param {string} issueDir - Destination issue directory
 * @param {string} filename - Base filename, e.g. "01.jpg"
 * @returns {Promise<object>} Metadata of generated variants
 */
async function processPageImage(input, issueDir, filename) {
  const dirs = initIssueImageDirectories(issueDir);
  const parsed = path.parse(filename);
  const baseName = parsed.name;
  const originalExt = parsed.ext || ".jpg";

  const originalTarget = path.join(dirs.original, `${baseName}${originalExt}`);
  const optimizedTarget = path.join(dirs.optimized, `${baseName}.webp`);
  const thumb120Target = path.join(dirs.thumbnails, `${baseName}-120.webp`);
  const thumb60Target = path.join(dirs.thumbnails, `${baseName}-60.webp`);

  // 1. Preserve original file safely
  if (typeof input === "string") {
    if (path.resolve(input) !== path.resolve(originalTarget) && !fs.existsSync(originalTarget)) {
      fs.copyFileSync(input, originalTarget);
    }
  } else if (Buffer.isBuffer(input) && !fs.existsSync(originalTarget)) {
    fs.writeFileSync(originalTarget, input);
  }

  const pipelineInput = fs.existsSync(originalTarget) ? originalTarget : input;

  // 2. Generate Optimized WebP for standard reading (~1400px width)
  const meta = await sharp(pipelineInput).metadata();
  const originalWidth = meta.width || 2500;
  const originalHeight = meta.height || 4000;

  let optimizedMeta;
  if (!fs.existsSync(optimizedTarget)) {
    const optBuffer = await sharp(pipelineInput)
      .resize({
        width: Math.min(originalWidth, TARGET_READING_WIDTH),
        withoutEnlargement: true
      })
      .webp({ quality: WEBP_QUALITY, effort: 4 })
      .toFile(optimizedTarget);

    optimizedMeta = {
      path: path.relative(issueDir, optimizedTarget).replace(/\\/g, "/"),
      diskPath: optimizedTarget,
      width: optBuffer.width,
      height: optBuffer.height,
      size: optBuffer.size,
      mime: "image/webp"
    };
  } else {
    const stat = fs.statSync(optimizedTarget);
    optimizedMeta = {
      path: path.relative(issueDir, optimizedTarget).replace(/\\/g, "/"),
      diskPath: optimizedTarget,
      width: Math.min(originalWidth, TARGET_READING_WIDTH),
      height: Math.round((Math.min(originalWidth, TARGET_READING_WIDTH) / originalWidth) * originalHeight),
      size: stat.size,
      mime: "image/webp"
    };
  }

  // 3. Generate 120x120 Thumbnail (for carousel preview & cards)
  let thumb120Meta;
  if (!fs.existsSync(thumb120Target)) {
    const t120Buffer = await sharp(pipelineInput)
      .resize({
        width: THUMB_120_SIZE,
        height: THUMB_120_SIZE,
        fit: "cover",
        position: "top"
      })
      .webp({ quality: 75 })
      .toFile(thumb120Target);

    thumb120Meta = {
      path: path.relative(issueDir, thumb120Target).replace(/\\/g, "/"),
      diskPath: thumb120Target,
      width: THUMB_120_SIZE,
      height: THUMB_120_SIZE,
      size: t120Buffer.size,
      mime: "image/webp"
    };
  } else {
    thumb120Meta = {
      path: path.relative(issueDir, thumb120Target).replace(/\\/g, "/"),
      diskPath: thumb120Target,
      width: THUMB_120_SIZE,
      height: THUMB_120_SIZE,
      size: fs.statSync(thumb120Target).size,
      mime: "image/webp"
    };
  }

  // 4. Generate 60x60 Micro-Thumbnail (for quick dates & pagination)
  let thumb60Meta;
  if (!fs.existsSync(thumb60Target)) {
    const t60Buffer = await sharp(pipelineInput)
      .resize({
        width: THUMB_60_SIZE,
        height: THUMB_60_SIZE,
        fit: "cover",
        position: "top"
      })
      .webp({ quality: 75 })
      .toFile(thumb60Target);

    thumb60Meta = {
      path: path.relative(issueDir, thumb60Target).replace(/\\/g, "/"),
      diskPath: thumb60Target,
      width: THUMB_60_SIZE,
      height: THUMB_60_SIZE,
      size: t60Buffer.size,
      mime: "image/webp"
    };
  } else {
    thumb60Meta = {
      path: path.relative(issueDir, thumb60Target).replace(/\\/g, "/"),
      diskPath: thumb60Target,
      width: THUMB_60_SIZE,
      height: THUMB_60_SIZE,
      size: fs.statSync(thumb60Target).size,
      mime: "image/webp"
    };
  }

  return {
    original: {
      path: path.relative(issueDir, originalTarget).replace(/\\/g, "/"),
      diskPath: originalTarget,
      width: originalWidth,
      height: originalHeight,
      size: fs.existsSync(originalTarget) ? fs.statSync(originalTarget).size : 0,
      mime: originalExt === ".png" ? "image/png" : "image/jpeg"
    },
    optimized: optimizedMeta,
    thumbnail: thumb120Meta,
    thumbnailSmall: thumb60Meta
  };
}

/**
 * Resolves or lazily generates an image variant on demand.
 * 
 * @param {string} issueDir - Root issue directory
 * @param {string} variant - 'original' | 'optimized' | 'thumb-120' | 'thumb-60'
 * @param {string} pageFile - Base filename e.g. "01.jpg"
 * @param {string} fallbackOriginalPath - Path to master scan if variant is missing
 * @returns {Promise<{ diskPath: string, mime: string, size: number } | null>}
 */
async function resolveImageVariant(issueDir, variant, pageFile, fallbackOriginalPath) {
  const dirs = initIssueImageDirectories(issueDir);
  const parsed = path.parse(pageFile);
  const baseName = parsed.name.replace(/-(120|60)$/, "");

  let targetPath;
  let mime = "image/webp";

  if (variant === "optimized") {
    targetPath = path.join(dirs.optimized, `${baseName}.webp`);
  } else if (variant === "thumb-120" || variant === "thumbnail" || variant === "thumbnails") {
    targetPath = path.join(dirs.thumbnails, `${baseName}-120.webp`);
  } else if (variant === "thumb-60") {
    targetPath = path.join(dirs.thumbnails, `${baseName}-60.webp`);
  } else {
    // Original master scan
    const possibleExts = [parsed.ext, ".jpg", ".jpeg", ".png", ".webp"].filter(Boolean);
    for (const ext of possibleExts) {
      const p = path.join(dirs.original, `${baseName}${ext}`);
      if (fs.existsSync(p)) {
        targetPath = p;
        mime = ext === ".png" ? "image/png" : "image/jpeg";
        break;
      }
    }
    if (!targetPath) {
      targetPath = path.join(dirs.original, `${baseName}${parsed.ext || ".jpg"}`);
      mime = parsed.ext === ".png" ? "image/png" : "image/jpeg";
    }
  }

  // If the variant already exists on disk, return it immediately
  if (fs.existsSync(targetPath)) {
    const stat = fs.statSync(targetPath);
    return { diskPath: targetPath, mime, size: stat.size };
  }

  // If not found, attempt on-demand generation from master source if available
  let masterSource = null;
  if (fallbackOriginalPath && fs.existsSync(fallbackOriginalPath)) {
    masterSource = fallbackOriginalPath;
  } else {
    // Check if original exists in original/
    const possibleExts = [".jpg", ".jpeg", ".png", ".webp"];
    for (const ext of possibleExts) {
      const origCandidate = path.join(dirs.original, `${baseName}${ext}`);
      if (fs.existsSync(origCandidate)) {
        masterSource = origCandidate;
        break;
      }
    }
    // Check if original exists directly in issueDir
    if (!masterSource) {
      for (const ext of possibleExts) {
        const legacyCandidate = path.join(issueDir, `${baseName}${ext}`);
        if (fs.existsSync(legacyCandidate)) {
          masterSource = legacyCandidate;
          break;
        }
      }
    }
  }

  if (!masterSource) {
    return null;
  }

  // Generate all variants from master source
  await processPageImage(masterSource, issueDir, `${baseName}.jpg`);

  if (fs.existsSync(targetPath)) {
    return { diskPath: targetPath, mime, size: fs.statSync(targetPath).size };
  }

  return null;
}

module.exports = {
  TARGET_READING_WIDTH,
  WEBP_QUALITY,
  THUMB_120_SIZE,
  THUMB_60_SIZE,
  initIssueImageDirectories,
  processPageImage,
  resolveImageVariant
};
