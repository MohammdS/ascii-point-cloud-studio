const RAMP = " .,:;irsXA253hMHGS#9B&@";
const DEFAULT_DATA_URL = new URL("./haifa-logo-points.json?v=16", import.meta.url);

const template = document.createElement("template");
template.innerHTML = `
  <style>
    :host {
      display: block;
      width: 100%;
      max-width: 100%;
      min-width: 0;
      aspect-ratio: 3 / 1;
      min-height: 180px;
      overflow: hidden;
      background: var(--haifa-ascii-background, #07111f);
      border-radius: var(--haifa-ascii-radius, 0.75rem);
      contain: content;
    }

    canvas {
      display: block;
      width: 100%;
      height: 100%;
    }

    .message {
      box-sizing: border-box;
      display: grid;
      width: 100%;
      height: 100%;
      place-items: center;
      padding: 1rem;
      color: #dce9f7;
      font: 14px/1.5 system-ui, sans-serif;
      text-align: center;
    }
  </style>
  <canvas part="canvas" role="img"></canvas>
  <div class="message" hidden></div>
`;

const pointSets = new Map();

function expandPoints(points) {
  const result = [];
  for (const [x, y, r, g, b] of points) {
    const surface = 0.26 * Math.sin(x * 1.15) + 0.12 * Math.cos(y * 2);
    for (const depth of [-1.0, -0.5, 0, 0.5, 1.0]) {
      result.push([x, y, surface + depth, r, g, b]);
    }
  }
  return result;
}

function loadPoints(url) {
  if (!pointSets.has(url.href)) {
    const request = fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`Point data request failed (${response.status})`);
        return response.json();
      })
      .then(expandPoints);
    pointSets.set(url.href, request);
  }
  return pointSets.get(url.href);
}

class HaifaLogoAscii extends HTMLElement {
  static observedAttributes = ["label", "paused", "speed", "fps", "motion", "src"];

  constructor() {
    super();
    this.attachShadow({ mode: "open" }).append(template.content.cloneNode(true));
    this.canvas = this.shadowRoot.querySelector("canvas");
    this.message = this.shadowRoot.querySelector(".message");
    this.context = this.canvas.getContext("2d", { alpha: false });
    this.points = null;
    this.startTime = performance.now();
    this.animationFrame = 0;
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
    cancelAnimationFrame(this.animationFrame);
    clearInterval(this.animationTimer);
    this.resizeObserver?.disconnect();
    this.reduceMotion.removeEventListener?.("change", this.onMotionChange);
  }

  attributeChangedCallback(name) {
    if (name === "label") this.updateLabel();
    if (name === "src" && this.isConnected) {
      this.loadArtwork();
      return;
    }
    if (this.points) this.startAnimation();
  }

  onMotionChange = () => {
    this.startTime = performance.now();
    this.startAnimation();
  };

  get motionReduced() {
    return this.getAttribute("motion") !== "always" && this.reduceMotion.matches;
  }

  loadArtwork() {
    const source = this.getAttribute("src");
    const url = source ? new URL(source, document.baseURI) : DEFAULT_DATA_URL;
    const requestId = Symbol();
    this.activeRequest = requestId;
    this.points = null;
    this.canvas.hidden = false;
    this.message.hidden = true;

    loadPoints(url)
      .then((points) => {
        if (this.activeRequest !== requestId) return;
        this.points = points;
        this.startTime = performance.now();
        this.resize();
        this.startAnimation();
      })
      .catch((error) => {
        if (this.activeRequest === requestId) this.showError(error);
      });
  }

  startAnimation() {
    cancelAnimationFrame(this.animationFrame);
    clearInterval(this.animationTimer);
    this.draw(performance.now());
    if (this.hasAttribute("paused") || this.motionReduced) return;

    const fps = Math.max(1, Math.min(60, Number(this.getAttribute("fps")) || 24));
    this.animationTimer = setInterval(() => this.draw(performance.now()), 1000 / fps);
  }

  updateLabel() {
    this.canvas.setAttribute(
      "aria-label",
      this.getAttribute("label") || "Animated 3D ASCII art of the University of Haifa logo",
    );
  }

  resize() {
    const rect = this.getBoundingClientRect();
    const ratio = Math.min(devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * ratio));
    const height = Math.max(1, Math.round(rect.height * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.draw(performance.now());
    }
  }

  draw(now) {
    if (!this.points || !this.canvas.width || !this.canvas.height) return;

    const ctx = this.context;
    const width = this.canvas.width;
    const height = this.canvas.height;
    const columns = Math.max(60, Math.min(132, Math.floor(width / 10)));
    const rows = Math.max(24, Math.min(48, Math.floor(height / 14)));
    const cellWidth = width / columns;
    const cellHeight = height / rows;
    const count = columns * rows;
    const chars = new Uint8Array(count);
    const colors = new Uint32Array(count);
    const zBuffer = new Float32Array(count);
    zBuffer.fill(-1e9);

    const speed = Number(this.getAttribute("speed"));
    const rotationSpeed = Number.isFinite(speed) ? speed : 0.85;
    const elapsed = this.hasAttribute("paused") || this.motionReduced
      ? 0
      : (now - this.startTime) / 1000;
    const angleY = elapsed * rotationSpeed;
    this.dataset.frame = String(Math.floor(elapsed * 24) % 1000);
    const angleX = -0.18;
    const cosX = Math.cos(angleX);
    const sinX = Math.sin(angleX);
    const cosY = Math.cos(angleY);
    const sinY = Math.sin(angleY);
    const scale = Math.min(columns / 10.8, rows / 5.6);

    for (const [x, y, z, r, g, b] of this.points) {
      const y1 = y * cosX - z * sinX;
      const z1 = y * sinX + z * cosX;
      const x2 = x * cosY + z1 * sinY;
      const z2 = -x * sinY + z1 * cosY;
      const perspective = 1 / (1 + Math.max(-0.65, Math.min(0.85, z2 * 0.08)));
      const sx = Math.trunc(columns / 2 + x2 * scale * 1.18 * perspective);
      const sy = Math.trunc(rows / 2 - y1 * scale * 0.92 * perspective);
      if (sx < 0 || sx >= columns || sy < 0 || sy >= rows) continue;

      const index = sy * columns + sx;
      if (z2 <= zBuffer[index]) continue;
      zBuffer[index] = z2;

      const depthLight = Math.max(0, Math.min(1, (z2 + 5.4) / 10.8));
      const edgeLight = Math.abs(sinY) * Math.min(0.18, Math.abs(z) * 0.08);
      const light = Math.max(0, Math.min(1, 0.45 + 0.42 * depthLight + edgeLight));
      chars[index] = Math.min(RAMP.length - 1, Math.trunc(light * (RAMP.length - 1)));
      const shade = 0.7 + 0.38 * light;
      const rr = Math.max(0, Math.min(255, Math.trunc(r * shade)));
      const gg = Math.max(0, Math.min(255, Math.trunc(g * shade)));
      const bb = Math.max(0, Math.min(255, Math.trunc(b * shade)));
      colors[index] = (rr << 16) | (gg << 8) | bb;
    }

    ctx.fillStyle = getComputedStyle(this).getPropertyValue("--haifa-ascii-background").trim() || "#07111f";
    ctx.fillRect(0, 0, width, height);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${Math.max(8, cellHeight * 0.88)}px ui-monospace, SFMono-Regular, Consolas, monospace`;

    for (let index = 0; index < count; index += 1) {
      if (!chars[index]) continue;
      const color = colors[index];
      ctx.fillStyle = `rgb(${color >> 16}, ${(color >> 8) & 255}, ${color & 255})`;
      const x = (index % columns + 0.5) * cellWidth;
      const y = (Math.floor(index / columns) + 0.5) * cellHeight;
      ctx.fillText(RAMP[chars[index]], x, y);
    }
  }

  showError(error) {
    this.canvas.hidden = true;
    this.message.hidden = false;
    this.message.textContent = "The Haifa logo artwork could not be loaded.";
    console.error(error);
  }
}

if (!customElements.get("haifa-logo-ascii")) {
  customElements.define("haifa-logo-ascii", HaifaLogoAscii);
}

export { HaifaLogoAscii };
