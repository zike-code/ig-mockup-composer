// Local server (localhost only) for IG Mockup Composer.
// File and folder pickers run entirely in the browser (File System Access
// API) — the server only receives each file's bytes via upload and runs
// ffmpeg. This avoids driving native Windows dialogs from an external
// process, which sometimes opened unfocused or hidden behind the browser.

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const { buffer: readBody } = require("node:stream/consumers");

const PORT = 5177;
const PUBLIC_DIR = path.join(__dirname, "public");

let backgroundPaths = []; // background cycle: video[i] uses backgroundPaths[i % length]

function safeName(name) {
  return (name || "file").replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function serveStatic(req, res, pathname) {
  let filePath = pathname === "/" ? "/index.html" : pathname;
  filePath = path.join(PUBLIC_DIR, filePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const types = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css" };
    res.writeHead(200, {
      "Content-Type": (types[ext] || "application/octet-stream") + "; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(data);
  });
}

function buildFilter(w, h, x, y) {
  return (
    `[1:v]scale=w=${w}:h=${h}:force_original_aspect_ratio=decrease:force_divisible_by=2,` +
    `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=white[fg];[0:v][fg]overlay=${x}:${y}:shortest=1[out]`
  );
}

function runFfmpeg(args) {
  return new Promise((resolve) => {
    const proc = spawn("ffmpeg", args, { windowsHide: true });
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => resolve({ code, stderr }));
    proc.on("error", (e) => resolve({ code: -1, stderr: String(e) }));
  });
}

function rectFromQuery(parsed) {
  return {
    x: parseInt(parsed.searchParams.get("x"), 10) || 0,
    y: parseInt(parsed.searchParams.get("y"), 10) || 0,
    w: parseInt(parsed.searchParams.get("w"), 10) || 1,
    h: parseInt(parsed.searchParams.get("h"), 10) || 1,
  };
}

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsed.pathname;

  if (pathname === "/api/set-background" && req.method === "POST") {
    const ext = safeName(parsed.searchParams.get("ext") || "png");
    const reset = parsed.searchParams.get("reset") === "1";
    if (reset) backgroundPaths = [];
    const data = await readBody(req);
    const tmpPath = path.join(os.tmpdir(), `ig-mockup-bg-${backgroundPaths.length}-${Date.now()}.${ext}`);
    fs.writeFileSync(tmpPath, data);
    backgroundPaths.push(tmpPath);
    return sendJson(res, 200, { ok: true, count: backgroundPaths.length });
  }

  if (pathname === "/api/preview" && req.method === "POST") {
    if (backgroundPaths.length === 0) return sendJson(res, 400, { error: "No background image set" });
    const { x, y, w, h } = rectFromQuery(parsed);
    const bgIndex = parseInt(parsed.searchParams.get("bgIndex"), 10) || 0;
    const backgroundPath = backgroundPaths[bgIndex % backgroundPaths.length];
    const data = await readBody(req);
    const tmpVideo = path.join(os.tmpdir(), `ig-mockup-preview-in-${Date.now()}.mp4`);
    const tmpOut = path.join(os.tmpdir(), `ig-mockup-preview-out-${Date.now()}.png`);
    fs.writeFileSync(tmpVideo, data);

    const args = [
      "-y",
      "-loop", "1",
      "-i", backgroundPath,
      "-ss", "1",
      "-i", tmpVideo,
      "-filter_complex", buildFilter(w, h, x, y),
      "-map", "[out]",
      "-frames:v", "1",
      "-update", "1",
      tmpOut,
    ];
    const { code } = await runFfmpeg(args);
    fs.unlink(tmpVideo, () => {});
    if (code !== 0 || !fs.existsSync(tmpOut)) {
      return sendJson(res, 500, { error: "Failed to render preview" });
    }
    const out = fs.readFileSync(tmpOut);
    fs.unlink(tmpOut, () => {});
    res.writeHead(200, { "Content-Type": "image/png" });
    return res.end(out);
  }

  if (pathname === "/api/process-one" && req.method === "POST") {
    if (backgroundPaths.length === 0) return sendJson(res, 400, { error: "No background image set" });
    const { x, y, w, h } = rectFromQuery(parsed);
    const bgIndex = parseInt(parsed.searchParams.get("bgIndex"), 10) || 0;
    const backgroundPath = backgroundPaths[bgIndex % backgroundPaths.length];
    const name = safeName(parsed.searchParams.get("name") || `video-${Date.now()}.mp4`);
    const data = await readBody(req);

    const tmpVideo = path.join(os.tmpdir(), `ig-mockup-in-${Date.now()}-${name}`);
    const tmpOut = path.join(os.tmpdir(), `ig-mockup-out-${Date.now()}-${name}`);
    fs.writeFileSync(tmpVideo, data);

    const args = [
      "-y",
      "-loop", "1",
      "-i", backgroundPath,
      "-i", tmpVideo,
      "-filter_complex", buildFilter(w, h, x, y),
      "-map", "[out]",
      "-map", "1:a?",
      "-c:v", "libx264",
      "-preset", "fast",
      "-crf", "20",
      "-c:a", "aac",
      "-pix_fmt", "yuv420p",
      "-shortest",
      tmpOut,
    ];
    const { code, stderr } = await runFfmpeg(args);
    fs.unlink(tmpVideo, () => {});
    if (code !== 0) {
      return sendJson(res, 500, { error: stderr.slice(-800) });
    }
    const out = fs.readFileSync(tmpOut);
    fs.unlink(tmpOut, () => {});
    res.writeHead(200, { "Content-Type": "video/mp4" });
    return res.end(out);
  }

  return serveStatic(req, res, pathname);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`IG Mockup Composer running at http://localhost:${PORT}`);
});
