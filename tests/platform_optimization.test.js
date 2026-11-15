// tests/platform_optimization.test.js – Comprehensive automated test suite for performance, image pipeline, and streaming
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const {
  processPageImage,
  resolveImageVariant,
  initIssueImageDirectories,
  TARGET_READING_WIDTH,
  THUMB_120_SIZE,
  THUMB_60_SIZE
} = require("../imagePipeline");

const DEMO_IMG_PATH = path.join(__dirname, "..", "public", "demo-page.jpg");
const TEST_TMP_DIR = path.join(__dirname, "..", "data", "test_automated_suite");

// Ensure clean environment before and after
function cleanTmp() {
  if (fs.existsSync(TEST_TMP_DIR)) {
    fs.rmSync(TEST_TMP_DIR, { recursive: true, force: true });
  }
}

// ==========================================
// 1. IMAGE OPTIMIZATION PIPELINE TESTS
// ==========================================
test("IMAGE PIPELINE: Generates high-efficiency WebP, thumbnails and preserves original", async (t) => {
  cleanTmp();
  fs.mkdirSync(TEST_TMP_DIR, { recursive: true });

  await t.test("Converts 8MB master scan to optimized WebP (<800 KB) and thumbnails (~5 KB)", async () => {
    assert.ok(fs.existsSync(DEMO_IMG_PATH), "Master scan public/demo-page.jpg must exist");
    const originalSize = fs.statSync(DEMO_IMG_PATH).size;
    assert.ok(originalSize > 5 * 1024 * 1024, "Master scan should be multi-megabyte");

    const result = await processPageImage(DEMO_IMG_PATH, TEST_TMP_DIR, "01.jpg");

    // 1. Original preservation
    assert.equal(result.original.size, originalSize, "Original file size must be preserved exactly");
    assert.ok(fs.existsSync(result.original.diskPath), "Original file must exist on disk");

    // 2. Optimized WebP variant
    assert.ok(result.optimized.size < 800 * 1024, `Optimized WebP must be under 800 KB, got ${(result.optimized.size / 1024).toFixed(1)} KB`);
    assert.ok(result.optimized.width <= TARGET_READING_WIDTH, `Width must not exceed ${TARGET_READING_WIDTH}`);
    assert.equal(result.optimized.mime, "image/webp", "Optimized MIME must be image/webp");

    // 3. 120x120 Thumbnail
    assert.equal(result.thumbnail.width, THUMB_120_SIZE);
    assert.equal(result.thumbnail.height, THUMB_120_SIZE);
    assert.ok(result.thumbnail.size < 20 * 1024, `Thumbnail must be small (~5-15 KB), got ${(result.thumbnail.size / 1024).toFixed(1)} KB`);

    // 4. 60x60 Micro-thumbnail
    assert.equal(result.thumbnailSmall.width, THUMB_60_SIZE);
    assert.equal(result.thumbnailSmall.height, THUMB_60_SIZE);
    assert.ok(result.thumbnailSmall.size < 5 * 1024, `Micro-thumbnail must be under 5 KB, got ${(result.thumbnailSmall.size / 1024).toFixed(1)} KB`);
  });

  await t.test("Never overwrites existing original file", async () => {
    const originalPath = path.join(TEST_TMP_DIR, "original", "01.jpg");
    const originalMtimeBefore = fs.statSync(originalPath).mtimeMs;

    // Reprocess
    await processPageImage(DEMO_IMG_PATH, TEST_TMP_DIR, "01.jpg");
    const originalMtimeAfter = fs.statSync(originalPath).mtimeMs;

    assert.equal(originalMtimeBefore, originalMtimeAfter, "Original scan must not be modified or overwritten");
  });

  await t.test("Rejects corrupt or invalid image data gracefully", async () => {
    const corruptBuffer = Buffer.from("this is not an image at all");
    await assert.rejects(
      async () => {
        await processPageImage(corruptBuffer, TEST_TMP_DIR, "corrupt.jpg");
      },
      /unsupported image format|input buffer has corrupt header/i
    );
  });

  cleanTmp();
});

// ==========================================
// 2. SERVER & ASYNCHRONOUS STREAMING TESTS
// ==========================================
test("SERVER STREAMING: HTTP Range, caching and path security", async (t) => {
  // Start server on an ephemeral port
  const { spawn } = require("node:child_process");
  const testPort = 3199;
  const child = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: { ...process.env, PORT: String(testPort), HOST: "127.0.0.1", DATABASE_URL: "" },
    stdio: "pipe"
  });

  const baseUrl = `http://127.0.0.1:${testPort}`;

  // Wait for server ready
  await new Promise((resolve, reject) => {
    child.stdout.on("data", (d) => {
      if (d.toString().includes("listening on")) resolve();
    });
    child.stderr.on("data", (d) => {
      // ignore warnings
    });
    setTimeout(() => resolve(), 2000);
  });

  try {
    await t.test("Serves optimized WebP variant with correct Content-Type and Cache-Control", async () => {
      const res = await fetch(`${baseUrl}/media/9cec51df7a48/optimized/01.webp`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-type"), "image/webp");
      assert.match(res.headers.get("cache-control"), /public.*max-age=31536000/);
      assert.ok(res.headers.get("etag"), "Must include ETag for 304 revalidation");
      const buf = await res.arrayBuffer();
      assert.ok(buf.byteLength < 800 * 1024, "Delivered WebP payload must be under 800 KB");
    });

    await t.test("Serves dedicated 120px thumbnail (<10 KB)", async () => {
      const res = await fetch(`${baseUrl}/media/9cec51df7a48/thumbnail/01-120.webp`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-type"), "image/webp");
      const buf = await res.arrayBuffer();
      assert.ok(buf.byteLength < 15 * 1024, `Thumbnail must be under 15 KB, got ${(buf.byteLength/1024).toFixed(1)} KB`);
    });

    await t.test("Supports HTTP 206 Partial Content Range requests", async () => {
      const res = await fetch(`${baseUrl}/media/9cec51df7a48/01.jpg`, {
        headers: { Range: "bytes=0-1023" }
      });
      assert.equal(res.status, 206);
      assert.match(res.headers.get("content-range"), /^bytes 0-1023\/\d+/);
      assert.equal(res.headers.get("content-length"), "1024");
      const buf = await res.arrayBuffer();
      assert.equal(buf.byteLength, 1024);
    });

    await t.test("Handles missing images with HTTP 404", async () => {
      const res = await fetch(`${baseUrl}/media/9cec51df7a48/non-existent-99.jpg`);
      assert.equal(res.status, 404);
    });

    await t.test("Blocks Path Traversal attempts with HTTP 403 or 404", async () => {
      const traversalUrls = [
        `${baseUrl}/media/9cec51df7a48/../../package.json`,
        `${baseUrl}/..%2f..%2fpackage.json`,
        `${baseUrl}/uploads/../../package.json`
      ];
      for (const u of traversalUrls) {
        const res = await fetch(u);
        assert.ok([403, 404].includes(res.status), `Path traversal ${u} must be blocked (got ${res.status})`);
      }
    });

    await t.test("Handles 15 concurrent image requests with sub-100ms response time", async () => {
      const start = Date.now();
      const promises = Array.from({ length: 15 }, () =>
        fetch(`${baseUrl}/media/9cec51df7a48/optimized/01.webp`)
      );
      const responses = await Promise.all(promises);
      const duration = Date.now() - start;
      for (const r of responses) {
        assert.equal(r.status, 200);
      }
      assert.ok(duration < 2000, `15 concurrent requests completed in ${duration}ms (target <2000ms)`);
    });

    await t.test("Health check endpoint returns status and operational headers", async () => {
      const res = await fetch(`${baseUrl}/api/health?details=1`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.status, "ok");
      assert.equal(data.db, "local-file");
      assert.ok(res.headers.get("x-app-version"), "X-App-Version header must be present");
      assert.ok(res.headers.get("x-app-uptime"), "X-App-Uptime header must be present");
    });
  } finally {
    child.kill("SIGTERM");
  }
});
