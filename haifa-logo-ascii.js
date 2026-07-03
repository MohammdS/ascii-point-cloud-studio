const RAMP = " .,:;irsXA253hMHGS#9B&@";
const DEFAULT_DATA_URL = new URL("./haifa-logo-points.json?v=14", import.meta.url);

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
      perspective: 1200px;
    }

    .scene {
      position: relative;
      width: 100%;
      height: 100%;
      animation: haifa-ascii-spin var(--haifa-ascii-duration, 5.5s) linear infinite;
      backface-visibility: visible;
      transform-origin: center;
      transform-style: preserve-3d;
      will-change: transform;
    }

    canvas {
      position: absolute;
      inset: 0;
      display: block;
      width: 100%;
      height: 100%;
      opacity: var(--layer-opacity, 1);
      transform: translateZ(var(--layer-z));
      transform-style: preserve-3d;
    }

    :host([paused]) .scene {
      animation: none;
      transform: rotateY(0deg);
    }

    @media (prefers-reduced-motion: reduce) {
      :host(:not([motion="always"])) .scene {
        animation: none;
        transform: rotateY(0deg);
      }
    }

    @keyframes haifa-ascii-spin {
      from {
        transform: rotateY(0deg);
      }

      to {
        transform: rotateY(360deg);
      }
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
  <div class="scene">
    <canvas aria-hidden="true" style="--layer-z: -16px; --layer-opacity: 0.14"></canvas>
    <canvas aria-hidden="true" style="--layer-z: -8px; --layer-opacity: 0.22"></canvas>
    <canvas part="canvas" role="img" style="--layer-z: 0px; --layer-opacity: 1"></canvas>
    <canvas aria-hidden="true" style="--layer-z: 8px; --layer-opacity: 0.22"></canvas>
    <canvas aria-hidden="true" style="--layer-z: 16px; --layer-opacity: 0.14"></canvas>
  </div>
  <div class="message" hidden></div>
`;

const pointSets = new Map();

function loadPoints(url) {
  if (!pointSets.has(url.href)) {
    const request = fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`Point data request failed (${response.status})`);
        return response.json();
      })
      .then((points) => {
        const result = [];
        for (const [x, y, r, g, b] of points) {
          const z = 0.22 * Math.sin(x * 1.15) + 0.1 * Math.cos(y * 2);
          for (const dz of [-0.1, 0, 0.1]) result.push([x, y, z + dz, r, g, b]);
        }
        return result;
      });
    pointSets.set(url.href, request);
  }
  return pointSets.get(url.href);
}

class HaifaLogoAscii extends HTMLElement {
  static observedAttributes = ["label", "paused", "speed", "fps", "motion", "src"];

  constructor() {
    super();
    this.attachShadow({ mode: "open" }).append(template.content.cloneNode(true));
    this.canvases = [...this.shadowRoot.querySelectorAll("canvas")];
    this.canvas = this.shadowRoot.querySelector('[part="canvas"]');
    this.message = this.shadowRoot.querySelector(".message");
    this.contexts = this.canvases.map((canvas) => canvas.getContext("2d"));
    this.points = null;
    this.startTime = performance.now();
    this.lastFrame = 0;
    this.visible = true;
    this.animationFrame = 0;
    this.reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
  }

  connectedCallback() {
    this.updateLabel();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this);
    this.intersectionObserver = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      if (this.visible) this.startAnimation();
    });
    this.intersectionObserver.observe(this);
    this.reduceMotion.addEventListener?.("change", this.onMotionChange);

    this.loadArtwork();
  }

  loadArtwork() {
    const source = this.getAttribute("src");
    const url = source ? new URL(source, document.baseURI) : DEFAULT_DATA_URL;
    const requestId = Symbol();
    this.activeRequest = requestId;
    this.points = null;
    for (const canvas of this.canvases) canvas.hidden = false;
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

  disconnectedCallback() {
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver?.disconnect();
    this.intersectionObserver?.disconnect();
    this.reduceMotion.removeEventListener?.("change", this.onMotionChange);
  }

  attributeChangedCallback(name) {
    if (name === "label") this.updateLabel();
    if (name === "src" && this.isConnected) {
      this.loadArtwork();
      return;
    }
    if (this.points) this.draw(performance.now());
  }

  onMotionChange = () => {
    this.startTime = performance.now();
    this.startAnimation();
  };

  get motionReduced() {
    return this.getAttribute("motion") !== "always" && this.reduceMotion.matches;
  }

  startAnimation() {
    cancelAnimationFrame(this.animationFrame);
    this.animate(performance.now());
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
      for (const canvas of this.canvases) {
        canvas.width = width;
        canvas.height = height;
      }
      this.draw(performance.now());
    }
  }

  animate = (now) => {
    if (!this.isConnected || !this.points) return;

    const fps = Math.max(1, Math.min(60, Number(this.getAttribute("fps")) || 24));
    const frameDuration = 1000 / fps;
    if (now - this.lastFrame >= frameDuration) {
      this.draw(now);
      this.lastFrame = now;
    }

    if (!this.hasAttribute("paused") && !this.motionReduced) {
      this.animationFrame = requestAnimationFrame(this.animate);
    }
  };

  draw(now) {
    if (!this.points || !this.canvas.width || !this.canvas.height) return;

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
    const angle = 0;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const scale = Math.min(columns / 11, rows / 5.8);
    const tilt = -0.22;
    const tiltCos = Math.cos(tilt);
    const tiltSin = Math.sin(tilt);

    for (const [x, y, z, r, g, b] of this.points) {
      const yawX = x * cos + z * sin;
      const yawZ = -x * sin + z * cos;
      const rx = yawX;
      const ry = y * tiltCos - yawZ * tiltSin;
      const rz = y * tiltSin + yawZ * tiltCos;
      const sx = Math.trunc(columns / 2 + rx * scale * 1.18);
      const sy = Math.trunc(rows / 2 - ry * scale * 0.92);
      if (sx < 0 || sx >= columns || sy < 0 || sy >= rows) continue;

      const index = sy * columns + sx;
      if (rz <= zBuffer[index]) continue;
      zBuffer[index] = rz;

      const depthLight = Math.max(0, Math.min(1, (rz + 4.4) / 8.8));
      const turnLight = Math.max(0, Math.min(1, Math.abs(sin) * 0.22));
      const light = Math.max(0, Math.min(1, 0.48 + 0.34 * depthLight + turnLight));
      chars[index] = Math.min(RAMP.length - 1, Math.trunc(light * (RAMP.length - 1)));
      const shade = 0.72 + 0.34 * light;
      const rr = Math.max(0, Math.min(255, Math.trunc(r * shade)));
      const gg = Math.max(0, Math.min(255, Math.trunc(g * shade)));
      const bb = Math.max(0, Math.min(255, Math.trunc(b * shade)));
      colors[index] = (rr << 16) | (gg << 8) | bb;
    }

    for (let layer = 0; layer < this.contexts.length; layer += 1) {
      const ctx = this.contexts[layer];
      const centerLayer = (this.contexts.length - 1) / 2;
      const depthShade = 1 - Math.abs(layer - centerLayer) * 0.08;
      ctx.clearRect(0, 0, width, height);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `${Math.max(8, cellHeight * 0.88)}px ui-monospace, SFMono-Regular, Consolas, monospace`;

      for (let index = 0; index < count; index += 1) {
        if (!chars[index]) continue;
        const color = colors[index];
        const rr = Math.max(0, Math.min(255, Math.trunc((color >> 16) * depthShade)));
        const gg = Math.max(0, Math.min(255, Math.trunc(((color >> 8) & 255) * depthShade)));
        const bb = Math.max(0, Math.min(255, Math.trunc((color & 255) * depthShade)));
        ctx.fillStyle = `rgb(${rr}, ${gg}, ${bb})`;
        const x = (index % columns + 0.5) * cellWidth;
        const y = (Math.floor(index / columns) + 0.5) * cellHeight;
        ctx.fillText(RAMP[chars[index]], x, y);
      }
    }
  }

  showError(error) {
    for (const canvas of this.canvases) canvas.hidden = true;
    this.message.hidden = false;
    this.message.textContent = "The Haifa logo artwork could not be loaded.";
    console.error(error);
  }
}

if (!customElements.get("haifa-logo-ascii")) {
  customElements.define("haifa-logo-ascii", HaifaLogoAscii);
}

export { HaifaLogoAscii };
