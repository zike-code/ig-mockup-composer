# IG Mockup Composer

A local app (Node server + browser page) that batch-fits videos into the
reserved rectangle of a mockup image (background with logo + caption),
producing one final `.mp4` per input video.

## Requirements

- Node.js installed (`node --version`).
- `ffmpeg` installed and available on your PATH.
- A Chromium-based browser (Chrome or Edge) — the file and folder pickers use
  the File System Access API.

## Usage

1. Double-click `start.bat` — it opens the browser at `http://localhost:5177`
   and starts the local server (keep the terminal window open while you use
   the tool).
2. **Background images**: click "Choose image(s)…" and select your mockups.
   With more than one, they cycle: video *i* uses background *i % count*. Drag
   the thumbnails to reorder them.
3. **Rectangle**: drag the blue rectangle over the mockup preview (or edit the
   X/Y/Width/Height fields) until it matches the space reserved for the video.
   Click "Preview with first video" to see a real video fitted in, not just
   the outline.
4. **Video folder**: pick the folder holding the input videos.
5. **Output folder**: pick where the finished videos should be saved.
6. Click **"Start processing"** — each video's progress is shown live
   (pending → processing → OK/failed), and you can pause or stop mid-run.

## How it works

- `server.js`: local HTTP server (`127.0.0.1` only, no external dependencies).
  It receives the uploaded bytes of each background and video, renders previews
  and runs the batch through `child_process.spawn("ffmpeg", ...)`, returning the
  finished MP4 to the browser.
- `public/`: front end — a canvas with a rectangle you can drag and resize by
  its corners, the file/folder pickers, and the progress list.
- File and folder selection happens entirely in the browser through the File
  System Access API, so the finished videos are written straight into the
  folder you picked.
- For each video, `ffmpeg` scales it to fit entirely inside the rectangle
  (aspect ratio preserved — a thin white bar is padded in if the proportions do
  not match exactly, nothing is cropped) and overlays it at the chosen position
  on the background image, keeping the original audio.

## Default rectangle calibration

The starting values (x=180, y=430, width=720, height=1242) were calibrated by
comparing an existing finished video pixel by pixel against the blank mockup.
Treat them as a starting point — drag the rectangle on screen if your mockup
is different.

## Limitations

- No rounded corners or drop shadow — the video goes into the rectangle flat.
- No dynamic text (view counts, variable captions).
- The local server listens on `127.0.0.1` only; it is not meant to be exposed
  on a network.
