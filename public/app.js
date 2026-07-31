const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const canvasEmpty = document.getElementById("canvasEmpty");

const rxInput = document.getElementById("rx");
const ryInput = document.getElementById("ry");
const rwInput = document.getElementById("rw");
const rhInput = document.getElementById("rh");

const pickBackgroundBtn = document.getElementById("pickBackgroundBtn");
const backgroundPathEl = document.getElementById("backgroundPath");
const backgroundListEl = document.getElementById("backgroundList");
const pickInputBtn = document.getElementById("pickInputBtn");
const inputPathEl = document.getElementById("inputPath");
const videoCountEl = document.getElementById("videoCount");
const pickOutputBtn = document.getElementById("pickOutputBtn");
const outputPathEl = document.getElementById("outputPath");
const processBtn = document.getElementById("processBtn");
const pauseBtn = document.getElementById("pauseBtn");
const stopBtn = document.getElementById("stopBtn");
const previewBtn = document.getElementById("previewBtn");
const progressFill = document.getElementById("progressFill");
const progressLabel = document.getElementById("progressLabel");
const videoListEl = document.getElementById("videoList");

const VIDEO_EXT = new Set([".mp4", ".mov", ".m4v", ".avi", ".webm", ".mkv"]);

const state = {
  backgroundFiles: [], // ciclo de fundos: video[i] usa backgroundFiles[i % length]
  activeBgPreview: 0, // qual fundo é mostrado no canvas de edição do retângulo
  outputDirHandle: null,
  videoEntries: [], // [{ name, handle }]
  bgImage: null,
  rect: { x: 180, y: 430, w: 720, h: 1242 },
  paused: false,
  cancelRequested: false,
};

let pauseResolve = null;
let currentAbortController = null;

function waitIfPaused() {
  if (!state.paused) return Promise.resolve();
  return new Promise((resolve) => {
    pauseResolve = resolve;
  });
}

if (!window.showDirectoryPicker) {
  alert(
    "Seu navegador não suporta a File System Access API (showDirectoryPicker). Use Chrome ou Edge recentes."
  );
}

function drawCanvas() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (state.bgImage) {
    ctx.drawImage(state.bgImage, 0, 0, canvas.width, canvas.height);
  }
  const { x, y, w, h } = state.rect;
  ctx.fillStyle = "rgba(45, 108, 223, 0.25)";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "#2d6cdf";
  ctx.lineWidth = 6;
  ctx.strokeRect(x, y, w, h);

  ctx.fillStyle = "#2d6cdf";
  const s = 20;
  for (const [hx, hy] of [
    [x, y],
    [x + w, y],
    [x, y + h],
    [x + w, y + h],
  ]) {
    ctx.fillRect(hx - s / 2, hy - s / 2, s, s);
  }
}

function syncInputsFromRect() {
  rxInput.value = state.rect.x;
  ryInput.value = state.rect.y;
  rwInput.value = state.rect.w;
  rhInput.value = state.rect.h;
}

function updateProcessButton() {
  processBtn.disabled = !(state.backgroundFiles.length > 0 && state.outputDirHandle && state.videoEntries.length > 0);
  previewBtn.disabled = !(state.backgroundFiles.length > 0 && state.videoEntries.length > 0);
}

[rxInput, ryInput, rwInput, rhInput].forEach((el) =>
  el.addEventListener("input", () => {
    state.rect = {
      x: parseInt(rxInput.value, 10) || 0,
      y: parseInt(ryInput.value, 10) || 0,
      w: parseInt(rwInput.value, 10) || 1,
      h: parseInt(rhInput.value, 10) || 1,
    };
    drawCanvas();
  })
);

// --- Arrastar/redimensionar o retângulo no canvas ---
let dragMode = null;
let dragStart = null;

function canvasPoint(evt) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (evt.clientX - rect.left) * scaleX,
    y: (evt.clientY - rect.top) * scaleY,
  };
}

function hitTest(pt) {
  const { x, y, w, h } = state.rect;
  const tol = 40;
  const corners = { nw: [x, y], ne: [x + w, y], sw: [x, y + h], se: [x + w, y + h] };
  for (const [name, [cx, cy]] of Object.entries(corners)) {
    if (Math.abs(pt.x - cx) < tol && Math.abs(pt.y - cy) < tol) return name;
  }
  if (pt.x >= x && pt.x <= x + w && pt.y >= y && pt.y <= y + h) return "move";
  return null;
}

canvas.addEventListener("mousedown", (evt) => {
  const pt = canvasPoint(evt);
  dragMode = hitTest(pt);
  dragStart = { pt, rect: { ...state.rect } };
});

window.addEventListener("mousemove", (evt) => {
  if (!dragMode) return;
  const pt = canvasPoint(evt);
  const dx = pt.x - dragStart.pt.x;
  const dy = pt.y - dragStart.pt.y;
  const r0 = dragStart.rect;

  if (dragMode === "move") {
    state.rect.x = Math.round(r0.x + dx);
    state.rect.y = Math.round(r0.y + dy);
  } else if (dragMode === "se") {
    state.rect.w = Math.max(10, Math.round(r0.w + dx));
    state.rect.h = Math.max(10, Math.round(r0.h + dy));
  } else if (dragMode === "ne") {
    state.rect.w = Math.max(10, Math.round(r0.w + dx));
    state.rect.y = Math.round(r0.y + dy);
    state.rect.h = Math.max(10, Math.round(r0.h - dy));
  } else if (dragMode === "sw") {
    state.rect.x = Math.round(r0.x + dx);
    state.rect.w = Math.max(10, Math.round(r0.w - dx));
    state.rect.h = Math.max(10, Math.round(r0.h + dy));
  } else if (dragMode === "nw") {
    state.rect.x = Math.round(r0.x + dx);
    state.rect.y = Math.round(r0.y + dy);
    state.rect.w = Math.max(10, Math.round(r0.w - dx));
    state.rect.h = Math.max(10, Math.round(r0.h - dy));
  }
  syncInputsFromRect();
  drawCanvas();
});

window.addEventListener("mouseup", () => {
  dragMode = null;
});

// --- Escolher imagens de fundo (seletor nativo do navegador, várias de uma vez) ---
function showBackgroundOnCanvas(index) {
  const file = state.backgroundFiles[index];
  if (!file) return;
  state.activeBgPreview = index;
  const img = new Image();
  img.onload = () => {
    state.bgImage = img;
    canvasEmpty.style.display = "none";
    drawCanvas();
  };
  img.src = URL.createObjectURL(file);
  renderBackgroundList();
}

let draggedBgIndex = null;

function reorderBackgrounds(fromIndex, toIndex) {
  const activeFile = state.backgroundFiles[state.activeBgPreview];
  const [moved] = state.backgroundFiles.splice(fromIndex, 1);
  state.backgroundFiles.splice(toIndex, 0, moved);
  const newActiveIndex = state.backgroundFiles.indexOf(activeFile);
  state.activeBgPreview = newActiveIndex >= 0 ? newActiveIndex : 0;
  renderBackgroundList();
  uploadBackgrounds();
}

function renderBackgroundList() {
  backgroundListEl.innerHTML = "";
  state.backgroundFiles.forEach((file, i) => {
    const item = document.createElement("div");
    item.className = "background-item" + (i === state.activeBgPreview ? " active" : "");
    item.draggable = true;
    item.title = `${file.name} — arraste para reordenar`;

    const img = document.createElement("img");
    img.src = URL.createObjectURL(file);
    item.appendChild(img);

    const order = document.createElement("span");
    order.className = "bg-order";
    order.textContent = i + 1;
    item.appendChild(order);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "bg-remove";
    removeBtn.textContent = "×";
    removeBtn.title = "Remover este fundo";
    removeBtn.addEventListener("click", (evt) => {
      evt.stopPropagation();
      removeBackground(i);
    });
    item.appendChild(removeBtn);

    item.addEventListener("click", () => showBackgroundOnCanvas(i));

    item.addEventListener("dragstart", (evt) => {
      draggedBgIndex = i;
      evt.dataTransfer.effectAllowed = "move";
      item.classList.add("dragging");
    });
    item.addEventListener("dragend", () => {
      item.classList.remove("dragging");
      draggedBgIndex = null;
    });
    item.addEventListener("dragover", (evt) => {
      evt.preventDefault();
      if (draggedBgIndex !== null && draggedBgIndex !== i) item.classList.add("drag-over");
    });
    item.addEventListener("dragleave", () => {
      item.classList.remove("drag-over");
    });
    item.addEventListener("drop", (evt) => {
      evt.preventDefault();
      item.classList.remove("drag-over");
      if (draggedBgIndex === null || draggedBgIndex === i) return;
      reorderBackgrounds(draggedBgIndex, i);
    });

    backgroundListEl.appendChild(item);
  });
  backgroundPathEl.textContent =
    state.backgroundFiles.length > 0
      ? `${state.backgroundFiles.length} imagem(ns) — alternando a cada vídeo`
      : "Nenhuma escolhida";
}

async function uploadBackgrounds() {
  for (let i = 0; i < state.backgroundFiles.length; i++) {
    const file = state.backgroundFiles[i];
    const ext = (file.name.split(".").pop() || "png").toLowerCase();
    const reset = i === 0 ? "1" : "0";
    await fetch(`/api/set-background?ext=${encodeURIComponent(ext)}&reset=${reset}`, {
      method: "POST",
      body: file,
    });
  }
}

function removeBackground(index) {
  state.backgroundFiles.splice(index, 1);
  if (state.activeBgPreview >= state.backgroundFiles.length) {
    state.activeBgPreview = Math.max(0, state.backgroundFiles.length - 1);
  }
  if (state.backgroundFiles.length > 0) {
    showBackgroundOnCanvas(state.activeBgPreview);
  } else {
    state.bgImage = null;
    canvasEmpty.style.display = "flex";
    drawCanvas();
    renderBackgroundList();
  }
  uploadBackgrounds();
  updateProcessButton();
}

pickBackgroundBtn.addEventListener("click", async () => {
  try {
    const handles = await window.showOpenFilePicker({
      types: [
        {
          description: "Imagens",
          accept: { "image/png": [".png"], "image/jpeg": [".jpg", ".jpeg"] },
        },
      ],
      multiple: true,
    });
    const files = await Promise.all(handles.map((h) => h.getFile()));
    state.backgroundFiles = files;
    state.activeBgPreview = 0;
    showBackgroundOnCanvas(0);

    // envia todos pro servidor (fica cacheado lá pra usar na prévia/processamento)
    await uploadBackgrounds();
    updateProcessButton();
  } catch (e) {
    if (e.name !== "AbortError") console.error(e);
  }
});

// --- Escolher pasta de vídeos ---
pickInputBtn.addEventListener("click", async () => {
  try {
    const dirHandle = await window.showDirectoryPicker({ mode: "read" });
    inputPathEl.textContent = dirHandle.name;

    const entries = [];
    for await (const [name, handle] of dirHandle.entries()) {
      if (handle.kind !== "file") continue;
      const ext = "." + (name.split(".").pop() || "").toLowerCase();
      if (VIDEO_EXT.has(ext)) entries.push({ name, handle });
    }
    state.videoEntries = entries;
    videoCountEl.textContent = `${entries.length} vídeo(s) encontrado(s)`;
    renderVideoList();
    updateProcessButton();
  } catch (e) {
    if (e.name !== "AbortError") console.error(e);
  }
});

// --- Escolher pasta de saída (precisa de permissão de escrita) ---
pickOutputBtn.addEventListener("click", async () => {
  try {
    const dirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
    state.outputDirHandle = dirHandle;
    outputPathEl.textContent = dirHandle.name;
    updateProcessButton();
  } catch (e) {
    if (e.name !== "AbortError") console.error(e);
  }
});

// --- Prévia com o primeiro vídeo (usa o fundo selecionado no momento) ---
previewBtn.addEventListener("click", async () => {
  if (state.backgroundFiles.length === 0 || state.videoEntries.length === 0) return;
  previewBtn.disabled = true;
  previewBtn.textContent = "Gerando prévia...";
  try {
    const file = await state.videoEntries[0].handle.getFile();
    const { x, y, w, h } = state.rect;
    const res = await fetch(`/api/preview?x=${x}&y=${y}&w=${w}&h=${h}&bgIndex=${state.activeBgPreview}`, {
      method: "POST",
      body: file,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "falha ao gerar prévia");
    }
    const blob = await res.blob();
    const img = new Image();
    img.onload = () => {
      state.bgImage = img;
      drawCanvas();
    };
    img.src = URL.createObjectURL(blob);
  } catch (e) {
    alert(e.message || String(e));
  } finally {
    previewBtn.disabled = false;
    previewBtn.textContent = "Gerar prévia com 1º vídeo";
    updateProcessButton();
  }
});

function cssEscape(s) {
  return s.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function renderVideoList() {
  videoListEl.innerHTML = "";
  for (const { name } of state.videoEntries) {
    const div = document.createElement("div");
    div.className = "video-item";
    div.id = `video-${cssEscape(name)}`;
    const label = document.createElement("span");
    label.textContent = name;
    const badge = document.createElement("span");
    badge.className = "status-badge";
    badge.textContent = "pendente";
    div.appendChild(label);
    div.appendChild(badge);
    videoListEl.appendChild(div);
  }
}

function setStatus(name, text, cls) {
  const div = document.getElementById(`video-${cssEscape(name)}`);
  if (!div) return;
  const badge = div.querySelector(".status-badge");
  badge.textContent = text;
  badge.className = "status-badge " + cls;
}

// --- Processar tudo: baixa bytes do video (handle), envia pro servidor
//     compor, recebe o mp4 pronto e grava na pasta de saída escolhida. ---
processBtn.addEventListener("click", async () => {
  processBtn.disabled = true;
  pauseBtn.disabled = false;
  stopBtn.disabled = false;
  pauseBtn.textContent = "Pausar";
  state.paused = false;
  state.cancelRequested = false;
  renderVideoList();
  progressFill.style.width = "0%";
  progressLabel.textContent = "Iniciando...";

  const { x, y, w, h } = state.rect;
  const total = state.videoEntries.length;
  let done = 0;
  let ok = 0;
  let fail = 0;

  for (const [videoIndex, { name, handle }] of state.videoEntries.entries()) {
    if (state.cancelRequested) {
      setStatus(name, "cancelado", "fail");
      continue;
    }

    await waitIfPaused();

    if (state.cancelRequested) {
      setStatus(name, "cancelado", "fail");
      continue;
    }

    const bgIndex = videoIndex % state.backgroundFiles.length;
    setStatus(name, "processando...", "processing");
    progressLabel.textContent = `Processando: ${name} (fundo ${bgIndex + 1}/${state.backgroundFiles.length})`;
    currentAbortController = new AbortController();
    try {
      const file = await handle.getFile();
      const res = await fetch(
        `/api/process-one?x=${x}&y=${y}&w=${w}&h=${h}&name=${encodeURIComponent(name)}&bgIndex=${bgIndex}`,
        { method: "POST", body: file, signal: currentAbortController.signal }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const outHandle = await state.outputDirHandle.getFileHandle(name, { create: true });
      const writable = await outHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      ok++;
      setStatus(name, "OK", "ok");
    } catch (e) {
      if (e.name === "AbortError") {
        setStatus(name, "cancelado", "fail");
      } else {
        console.warn("Falha ao processar", name, e);
        fail++;
        setStatus(name, "falhou", "fail");
      }
    }
    done++;
    progressFill.style.width = `${Math.round((done / total) * 100)}%`;
  }

  const cancelled = state.cancelRequested;
  progressLabel.textContent = cancelled
    ? `Cancelado: ${ok} OK, ${fail} falha(s) antes de parar.`
    : `Concluído: ${ok} OK, ${fail} falha(s). Salvo na pasta escolhida.`;
  processBtn.disabled = false;
  pauseBtn.disabled = true;
  stopBtn.disabled = true;
});

pauseBtn.addEventListener("click", () => {
  state.paused = !state.paused;
  pauseBtn.textContent = state.paused ? "Continuar" : "Pausar";
  if (!state.paused && pauseResolve) {
    pauseResolve();
    pauseResolve = null;
  }
});

stopBtn.addEventListener("click", () => {
  state.cancelRequested = true;
  stopBtn.disabled = true;
  pauseBtn.disabled = true;
  if (currentAbortController) currentAbortController.abort();
  if (pauseResolve) {
    pauseResolve();
    pauseResolve = null;
  }
});

drawCanvas();
