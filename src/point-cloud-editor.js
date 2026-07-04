const canvas = document.querySelector("#editor");
const context = canvas.getContext("2d");
const logoSelect = document.querySelector("#logo");
const fileInput = document.querySelector("#json-file");
const viewSelect = document.querySelector("#view-mode");
const colorInput = document.querySelector("#color");
const brushSelect = document.querySelector("#brush-size");
const countOutput = document.querySelector("#count");
const statusOutput = document.querySelector("#status");
const undoButton = document.querySelector("#undo");
const redoButton = document.querySelector("#redo");
const resetButton = document.querySelector("#reset");
const downloadButton = document.querySelector("#download");

let points = [];
let originalPoints = [];
let undoStack = [];
let redoStack = [];
let drawing = false;
let strokeBefore = null;
let transform = { scale: 1, centerX: 0, centerY: 0 };
let activeFilename = "haifa-logo-points.json";
let asciiGrid = null;
const RAMP = " .,:;irsXA253hMHGS#9B&@";

const clonePoints = (value) => value.map((point) => [...point]);

function selectedTool(event) {
  if (event?.button === 2) return "remove";
  return document.querySelector('input[name="tool"]:checked').value;
}

function selectedColor() {
  const value = colorInput.value;
  return [1, 3, 5].map((index) => Number.parseInt(value.slice(index, index + 2), 16));
}

function updateHistoryButtons() {
  undoButton.disabled = undoStack.length === 0;
  redoButton.disabled = redoStack.length === 0;
}

function setStatus(message) {
  statusOutput.textContent = message;
  countOutput.textContent = points.length.toLocaleString();
}

function filenameFromPath(value) {
  return value.split("?")[0].split("/").pop() || "points.json";
}

function fitTransform() {
  const padding = 48 * Math.min(devicePixelRatio || 1, 2);
  const xExtent = 4.45;
  const yExtent = 2.4;
  transform = {
    scale: Math.min((canvas.width - padding * 2) / (xExtent * 2), (canvas.height - padding * 2) / (yExtent * 2)),
    centerX: canvas.width / 2,
    centerY: canvas.height / 2,
  };
}

function modelToCanvas(x, y) {
  return [transform.centerX + x * transform.scale, transform.centerY - y * transform.scale];
}

function canvasToModel(x, y) {
  return [(x - transform.centerX) / transform.scale, (transform.centerY - y) / transform.scale];
}

function render() {
  if (viewSelect.value === "ascii") {
    renderAscii();
    return;
  }

  const darkBackground = logoSelect.selectedIndex === 0;
  context.fillStyle = darkBackground ? "#07111f" : "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const radius = Math.max(1.2, Math.min(2.5, transform.scale * 0.012));

  for (const [x, y, r, g, b] of points) {
    const [screenX, screenY] = modelToCanvas(x, y);
    context.fillStyle = `rgb(${r}, ${g}, ${b})`;
    context.beginPath();
    context.arc(screenX, screenY, radius, 0, Math.PI * 2);
    context.fill();
  }
  countOutput.textContent = points.length.toLocaleString();
}

function buildAsciiGrid() {
  const columns = Math.max(60, Math.min(132, Math.floor(canvas.width / 10)));
  const rows = Math.max(24, Math.min(48, Math.floor(canvas.height / 14)));
  const scale = Math.min(columns / 11, rows / 5.8);
  const count = columns * rows;
  const chars = new Uint8Array(count);
  const colors = new Uint32Array(count);
  const zBuffer = new Float32Array(count);
  zBuffer.fill(-1e9);

  for (const [x, y, r, g, b] of points) {
    const baseZ = 0.22 * Math.sin(x * 1.15) + 0.1 * Math.cos(y * 2);
    for (const dz of [-0.1, 0, 0.1]) {
      const z = baseZ + dz;
      const sx = Math.trunc(columns / 2 + x * scale * 1.18);
      const sy = Math.trunc(rows / 2 - y * scale * 0.92);
      if (sx < 0 || sx >= columns || sy < 0 || sy >= rows) continue;
      const index = sy * columns + sx;
      if (z <= zBuffer[index]) continue;
      zBuffer[index] = z;
      const light = Math.max(0, Math.min(1, 0.52 + 0.38 * ((z + 1) / 2.2) + 0.1 * Math.sin(x)));
      chars[index] = Math.min(RAMP.length - 1, Math.trunc(light * (RAMP.length - 1)));
      const shade = 0.72 + 0.34 * light;
      const rr = Math.max(0, Math.min(255, Math.trunc(r * shade)));
      const gg = Math.max(0, Math.min(255, Math.trunc(g * shade)));
      const bb = Math.max(0, Math.min(255, Math.trunc(b * shade)));
      colors[index] = (rr << 16) | (gg << 8) | bb;
    }
  }
  return { columns, rows, scale, chars, colors };
}

function renderAscii() {
  asciiGrid = buildAsciiGrid();
  const { columns, rows, chars, colors } = asciiGrid;
  const cellWidth = canvas.width / columns;
  const cellHeight = canvas.height / rows;
  const darkBackground = logoSelect.selectedIndex === 0;
  context.fillStyle = darkBackground ? "#07111f" : "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = `${Math.max(8, cellHeight * 0.88)}px ui-monospace, SFMono-Regular, Consolas, monospace`;

  for (let index = 0; index < chars.length; index += 1) {
    if (!chars[index]) continue;
    const color = colors[index];
    context.fillStyle = `rgb(${color >> 16}, ${(color >> 8) & 255}, ${color & 255})`;
    const x = (index % columns + 0.5) * cellWidth;
    const y = (Math.floor(index / columns) + 0.5) * cellHeight;
    context.fillText(RAMP[chars[index]], x, y);
  }
}

function resize() {
  const bounds = canvas.getBoundingClientRect();
  const ratio = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(bounds.width * ratio));
  canvas.height = Math.max(1, Math.round(bounds.height * ratio));
  fitTransform();
  render();
}

async function loadLogo() {
  setStatus("Loading point data...");
  try {
    const response = await fetch(logoSelect.value);
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    points = await response.json();
    activeFilename = filenameFromPath(logoSelect.value);
    originalPoints = clonePoints(points);
    undoStack = [];
    redoStack = [];
    updateHistoryButtons();
    setStatus("Ready - drag on the canvas to edit");
    render();
  } catch (error) {
    setStatus("Could not load the selected point data");
    console.error(error);
  }
}

function validatePointData(value) {
  if (!Array.isArray(value)) throw new Error("The JSON root must be an array.");
  return value.map((point, index) => {
    if (!Array.isArray(point) || point.length !== 5 || !point.every(Number.isFinite)) {
      throw new Error(`Point ${index + 1} must contain exactly five numbers: [x, y, r, g, b].`);
    }
    const [x, y, r, g, b] = point;
    if ([r, g, b].some((channel) => channel < 0 || channel > 255)) {
      throw new Error(`Point ${index + 1} contains an RGB value outside 0-255.`);
    }
    return [x, y, Math.round(r), Math.round(g), Math.round(b)];
  });
}

async function loadLocalFile() {
  const file = fileInput.files?.[0];
  if (!file) return;
  setStatus(`Loading ${file.name}...`);
  try {
    const parsed = JSON.parse(await file.text());
    points = validatePointData(parsed);
    originalPoints = clonePoints(points);
    activeFilename = file.name.endsWith(".json") ? file.name : `${file.name}.json`;
    undoStack = [];
    redoStack = [];
    updateHistoryButtons();
    setStatus(`Loaded ${file.name}`);
    render();
  } catch (error) {
    setStatus(`Invalid JSON: ${error.message}`);
  }
}

function eventPosition(event) {
  const bounds = canvas.getBoundingClientRect();
  return [
    (event.clientX - bounds.left) * canvas.width / bounds.width,
    (event.clientY - bounds.top) * canvas.height / bounds.height,
  ];
}

function editAt(event) {
  const [canvasX, canvasY] = eventPosition(event);
  const brush = Number(brushSelect.value);
  const tool = selectedTool(event);
  let x;
  let y;
  let spacing = 0.022;

  if (viewSelect.value === "ascii") {
    asciiGrid ||= buildAsciiGrid();
    const sx = Math.max(0, Math.min(asciiGrid.columns - 1, Math.floor(canvasX / canvas.width * asciiGrid.columns)));
    const sy = Math.max(0, Math.min(asciiGrid.rows - 1, Math.floor(canvasY / canvas.height * asciiGrid.rows)));
    x = (sx + 0.5 - asciiGrid.columns / 2) / (asciiGrid.scale * 1.18);
    y = (asciiGrid.rows / 2 - sy - 0.5) / (asciiGrid.scale * 0.92);
    spacing = 1 / (asciiGrid.scale * 1.18);
  } else {
    [x, y] = canvasToModel(canvasX, canvasY);
  }

  if (tool === "add") {
    const [r, g, b] = selectedColor();
    const half = Math.floor(brush / 2);
    for (let row = -half; row <= half; row += 1) {
      for (let column = -half; column <= half; column += 1) {
        const px = x + column * spacing;
        const py = y + row * spacing;
        const duplicate = points.some((point) => (point[0] - px) ** 2 + (point[1] - py) ** 2 < 0.00008);
        if (!duplicate) points.push([Number(px.toFixed(3)), Number(py.toFixed(3)), r, g, b]);
      }
    }
    setStatus("Point added");
  } else {
    const radius = viewSelect.value === "ascii"
      ? spacing * Math.max(0.62, brush * 0.55)
      : Math.max(0.045, brush * 0.025);
    const before = points.length;
    points = points.filter((point) => (point[0] - x) ** 2 + (point[1] - y) ** 2 > radius ** 2);
    setStatus(before === points.length ? "No point under the brush" : `${before - points.length} point(s) removed`);
  }
  render();
}

function beginStroke(event) {
  if (event.button !== 0 && event.button !== 2) return;
  event.preventDefault();
  drawing = true;
  strokeBefore = clonePoints(points);
  canvas.setPointerCapture(event.pointerId);
  editAt(event);
}

function continueStroke(event) {
  if (!drawing) return;
  editAt(event);
}

function endStroke(event) {
  if (!drawing) return;
  drawing = false;
  canvas.releasePointerCapture(event.pointerId);
  if (JSON.stringify(strokeBefore) !== JSON.stringify(points)) {
    undoStack.push(strokeBefore);
    redoStack = [];
    updateHistoryButtons();
  }
  strokeBefore = null;
}

function restoreFrom(source, destination, message) {
  if (!source.length) return;
  destination.push(clonePoints(points));
  points = source.pop();
  updateHistoryButtons();
  setStatus(message);
  render();
}

logoSelect.addEventListener("change", loadLogo);
fileInput.addEventListener("change", loadLocalFile);
viewSelect.addEventListener("change", () => {
  asciiGrid = null;
  setStatus(viewSelect.value === "ascii" ? "ASCII cells are editable" : "Cloud points are editable");
  render();
});
canvas.addEventListener("pointerdown", beginStroke);
canvas.addEventListener("pointermove", continueStroke);
canvas.addEventListener("pointerup", endStroke);
canvas.addEventListener("pointercancel", endStroke);
canvas.addEventListener("contextmenu", (event) => event.preventDefault());
undoButton.addEventListener("click", () => restoreFrom(undoStack, redoStack, "Undid last edit"));
redoButton.addEventListener("click", () => restoreFrom(redoStack, undoStack, "Redid last edit"));
resetButton.addEventListener("click", () => {
  undoStack.push(clonePoints(points));
  points = clonePoints(originalPoints);
  redoStack = [];
  updateHistoryButtons();
  setStatus("Reset to loaded data");
  render();
});
downloadButton.addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(points)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = activeFilename;
  link.click();
  URL.revokeObjectURL(url);
  setStatus(`Exported ${activeFilename}`);
});

new ResizeObserver(resize).observe(canvas);
loadLogo();
