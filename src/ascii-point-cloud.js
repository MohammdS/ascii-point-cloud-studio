const DEFAULT_RAMP = " .,:;irsXA253hMHGS#9B&@";

const template = document.createElement("template");
template.innerHTML = `
  <style>
    :host {
      display: grid;
      width: 100%;
      max-width: 100%;
      min-width: 0;
      aspect-ratio: var(--ascii-cloud-aspect, 3 / 1);
      min-height: 180px;
      place-items: center;
      overflow: hidden;
      background: var(--ascii-cloud-background, var(--haifa-ascii-background, #07111f));
      border-radius: var(--ascii-cloud-radius, var(--haifa-ascii-radius, 0.9rem));
      contain: content;
    }

    pre {
      box-sizing: border-box;
      display: block;
      width: max-content;
      height: auto;
      margin: 0;
      overflow: hidden;
      font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
      font-variant-ligatures: none;
      letter-spacing: 0;
      white-space: pre;
    }

    .message {
      box-sizing: border-box;
      display: grid;
      width: 100%;
      height: 100%;
      place-items: center;
      padding: 1rem;
      color: var(--ascii-cloud-message, #dce9f7);
      font: 14px/1.5 system-ui, sans-serif;
      text-align: center;
    }
  </style>
  <pre part="screen" role="img"></pre>
  <div class="message" hidden></div>
`;

const pointSets = new Map();

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function validatePointData(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Point data must be a non-empty JSON array.");
  }

  return value.map((point, index) => {
    if (!Array.isArray(point) || point.length !== 5 || !point.every(Number.isFinite)) {
      throw new Error(`Point ${index + 1} must contain five numbers: [x, y, r, g, b].`);
    }
    const [x, y, r, g, b] = point;
    return [x, y, clamp(Math.round(r), 0, 255), clamp(Math.round(g), 0, 255), clamp(Math.round(b), 0, 255)];
  });
}

function preparePoints(rawPoints, depth) {
  const points = validatePointData(rawPoints);
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const inputScale = Math.max(maxX - minX, maxY - minY, 0.0001) / 2;
  const normalized = points.map(([rawX, rawY, r, g, b]) => [
    (rawX - centerX) / inputScale,
    (rawY - centerY) / inputScale,
    r,
    g,
    b,
  ]);
  const cellSize = 0.04;
  const occupied = new Set(
    normalized.map(([x, y]) => `${Math.round(x / cellSize)},${Math.round(y / cellSize)}`),
  );
  const expanded = [];

  for (const [x, y, r, g, b] of normalized) {
    const qx = Math.round(x / cellSize);
    const qy = Math.round(y / cellSize);
    const surface = depth * (0.12 * Math.sin(x * 3.4) + 0.06 * Math.cos(y * 4));
    expanded.push([x, y, surface + depth, r, g, b]);
    expanded.push([x, y, surface - depth, r, g, b]);

    const isRim =
      !occupied.has(`${qx - 1},${qy}`) ||
      !occupied.has(`${qx + 1},${qy}`) ||
      !occupied.has(`${qx},${qy - 1}`) ||
      !occupied.has(`${qx},${qy + 1}`);

    if (isRim) {
      for (const sideDepth of [-0.6, -0.2, 0.2, 0.6]) {
        expanded.push([x, y, surface + depth * sideDepth, r, g, b]);
      }
    }
  }

  return {
    points: expanded,
    maxHorizontalRadius: Math.max(...expanded.map(([x, , z]) => Math.hypot(x, z)), 0.1),
    maxY: Math.max(...expanded.map(([, y]) => Math.abs(y)), 0.1),
  };
}

function loadPoints(url, depth) {
  const key = `${url.href}|${depth}`;
  if (!pointSets.has(key)) {
    const request = fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`Point data request failed (${response.status}).`);
        return response.json();
      })
      .then((points) => preparePoints(points, depth));
    pointSets.set(key, request);
  }
  return pointSets.get(key);
}

function escapeHtml(value) {
  if (value === "&") return "&amp;";
  if (value === "<") return "&lt;";
  if (value === ">") return "&gt;";
  return value;
}

function colorToHex(color) {
  return `#${color.toString(16).padStart(6, "0")}`;
}

class AsciiPointCloud extends HTMLElement {
  static observedAttributes = ["columns", "depth", "fps", "label", "motion", "paused", "ramp", "rows", "speed", "src"];

  constructor() {
    super();
    this.attachShadow({ mode: "open" }).append(template.content.cloneNode(true));
    this.screen = this.shadowRoot.querySelector("pre");
    this.message = this.shadowRoot.querySelector(".message");
    this.pointSet = null;
    this.frameIndex = 0;
    this.animationTimer = 0;
    this.reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
  }

  connectedCallback() {
    this.updateLabel();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this);
    this.reduceMotion.addEventListener?.("change", this.onMotionChange);
    this.loadArtwork();
  }

  disconnectedCallback() {
    clearInterval(this.animationTimer);
    this.resizeObserver?.disconnect();
    this.reduceMotion.removeEventListener?.("change", this.onMotionChange);
  }

  attributeChangedCallback(name) {
    if (!this.isConnected) return;
    if (name === "label") this.updateLabel();
    if (name === "src" || name === "depth") {
      this.loadArtwork();
      return;
    }
    if (this.pointSet) this.startAnimation();
  }

  onMotionChange = () => this.startAnimation();

  get motionReduced() {
    return this.getAttribute("motion") !== "always" && this.reduceMotion.matches;
  }

  get grid() {
    return {
      columns: clamp(Math.round(Number(this.getAttribute("columns")) || 132), 30, 240),
      rows: clamp(Math.round(Number(this.getAttribute("rows")) || 48), 16, 100),
    };
  }

  loadArtwork() {
    const source = this.getAttribute("src");
    if (!source) {
      this.pointSet = null;
      this.showError(new Error("Missing src attribute."), "Add a JSON point-cloud source to preview it.");
      return;
    }

    const url = new URL(source, document.baseURI);
    const depth = clamp(Number(this.getAttribute("depth")) || 0.11, 0.02, 0.5);
    const requestId = Symbol();
    this.activeRequest = requestId;
    this.pointSet = null;
    this.screen.hidden = false;
    this.message.hidden = true;

    loadPoints(url, depth)
      .then((pointSet) => {
        if (this.activeRequest !== requestId) return;
        this.pointSet = pointSet;
        this.frameIndex = 0;
        this.resize();
        this.startAnimation();
      })
      .catch((error) => {
        if (this.activeRequest === requestId) this.showError(error);
      });
  }

  startAnimation() {
    clearInterval(this.animationTimer);
    this.draw();
    if (this.hasAttribute("paused") || this.motionReduced) return;

    const fps = clamp(Number(this.getAttribute("fps")) || 18, 1, 30);
    this.animationTimer = setInterval(() => this.draw(), 1000 / fps);
  }

  updateLabel() {
    this.screen.setAttribute("aria-label", this.getAttribute("label") || "Animated 3D ASCII point cloud");
  }

  resize() {
    const rect = this.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const { columns, rows } = this.grid;
    const fontSize = Math.max(5, Math.min(rect.width / (columns * 0.62), rect.height / rows));
    this.screen.style.fontSize = `${fontSize}px`;
    this.screen.style.lineHeight = `${rect.height / rows}px`;
    if (this.pointSet) this.draw();
  }

  draw() {
    if (!this.pointSet) return;
    const { columns, rows } = this.grid;
    const rampAttribute = this.getAttribute("ramp");
    const ramp = rampAttribute?.length >= 2 ? rampAttribute : DEFAULT_RAMP;
    const count = columns * rows;
    const chars = new Uint8Array(count);
    const colors = new Uint32Array(count);
    const zBuffer = new Float32Array(count);
    zBuffer.fill(-1e9);

    const speedAttribute = this.getAttribute("speed");
    const speedValue = speedAttribute === null || speedAttribute.trim() === "" ? 1 : Number(speedAttribute);
    const speed = Number.isFinite(speedValue) ? speedValue : 1;
    if (!this.hasAttribute("paused") && !this.motionReduced) this.frameIndex += speed < 0 ? -1 : 1;
    const angleY = this.frameIndex * 0.052 * Math.abs(speed);
    const cosY = Math.cos(angleY);
    const sinY = Math.sin(angleY);
    const scale = Math.min(
      columns * 0.46 / (this.pointSet.maxHorizontalRadius * 1.18),
      rows * 0.44 / (this.pointSet.maxY * 0.92),
    );

    for (const [x, y, z, r, g, b] of this.pointSet.points) {
      const x2 = x * cosY + z * sinY;
      const z2 = -x * sinY + z * cosY;
      const sx = Math.trunc(columns / 2 + x2 * scale * 1.18);
      const sy = Math.trunc(rows / 2 - y * scale * 0.92);
      if (sx < 0 || sx >= columns || sy < 0 || sy >= rows) continue;

      const index = sy * columns + sx;
      if (z2 <= zBuffer[index]) continue;
      zBuffer[index] = z2;
      const depthLight = clamp((z2 + 1.5) / 3, 0, 1);
      const light = clamp(0.45 + 0.45 * depthLight, 0, 1);
      chars[index] = Math.max(1, Math.min(ramp.length - 1, Math.trunc(light * (ramp.length - 1))));
      const shade = 0.68 + 0.4 * light;
      const rr = clamp(Math.trunc(r * shade), 0, 255);
      const gg = clamp(Math.trunc(g * shade), 0, 255);
      const bb = clamp(Math.trunc(b * shade), 0, 255);
      colors[index] = (rr << 16) | (gg << 8) | bb;
    }

    const output = [];
    for (let row = 0; row < rows; row += 1) {
      let line = "";
      for (let column = 0; column < columns; column += 1) {
        const index = row * columns + column;
        const charIndex = chars[index];
        line += charIndex
          ? `<span style="color:${colorToHex(colors[index])}">${escapeHtml(ramp[charIndex])}</span>`
          : " ";
      }
      output.push(line);
    }
    this.screen.innerHTML = output.join("\n");
  }

  showError(error, message = "The point-cloud artwork could not be loaded.") {
    clearInterval(this.animationTimer);
    this.screen.hidden = true;
    this.message.hidden = false;
    this.message.textContent = message;
    console.error(error);
  }
}

if (!customElements.get("ascii-point-cloud")) {
  customElements.define("ascii-point-cloud", AsciiPointCloud);
}

export { AsciiPointCloud };
