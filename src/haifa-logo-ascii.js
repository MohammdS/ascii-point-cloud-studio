const RAMP = " .,:;irsXA253hMHGS#9B&@";
const COLUMNS = 132;
const ROWS = 48;
const DEFAULT_DATA_URL = new URL("../data/haifa-logo-points.json?v=26", import.meta.url);

const template = document.createElement("template");
template.innerHTML = `
  <style>
    :host {
      display: grid;
      width: 100%;
      max-width: 100%;
      min-width: 0;
      aspect-ratio: 3 / 1;
      min-height: 180px;
      place-items: center;
      overflow: hidden;
      background: var(--haifa-ascii-background, #07111f);
      border-radius: var(--haifa-ascii-radius, 0.75rem);
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
      color: #dce9f7;
      font: 14px/1.5 system-ui, sans-serif;
      text-align: center;
    }
  </style>
  <pre part="screen" role="img"></pre>
  <div class="message" hidden></div>
`;

const pointSets = new Map();

function expandPoints(points) {
  const quantized = new Set(points.map(([x, y]) => `${Math.round(x / 0.16)},${Math.round(y / 0.16)}`));
  const result = [];
  for (const [index, point] of points.entries()) {
    const [x, y, r, g, b] = point;
    const qx = Math.round(x / 0.16);
    const qy = Math.round(y / 0.16);
    const surface = 0.12 * Math.sin(x * 1.15) + 0.06 * Math.cos(y * 2);

    result.push([x, y, surface + 0.42, r, g, b]);
    if (index % 3 === 0) result.push([x, y, surface - 0.42, r, g, b]);

    const isRim =
      !quantized.has(`${qx - 1},${qy}`) ||
      !quantized.has(`${qx + 1},${qy}`) ||
      !quantized.has(`${qx},${qy - 1}`) ||
      !quantized.has(`${qx},${qy + 1}`);

    if (!isRim) continue;
    for (const depth of [-0.28, 0, 0.28]) {
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

function escapeHtml(value) {
  if (value === "&") return "&amp;";
  if (value === "<") return "&lt;";
  if (value === ">") return "&gt;";
  return value;
}

function colorToHex(color) {
  return `#${color.toString(16).padStart(6, "0")}`;
}

class HaifaLogoAscii extends HTMLElement {
  static observedAttributes = ["label", "paused", "speed", "fps", "motion", "src"];

  constructor() {
    super();
    this.attachShadow({ mode: "open" }).append(template.content.cloneNode(true));
    this.screen = this.shadowRoot.querySelector("pre");
    this.message = this.shadowRoot.querySelector(".message");
    this.points = null;
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
    if (name === "label") this.updateLabel();
    if (name === "src" && this.isConnected) {
      this.loadArtwork();
      return;
    }
    if (this.points) this.startAnimation();
  }

  onMotionChange = () => {
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
    this.screen.hidden = false;
    this.message.hidden = true;

    loadPoints(url)
      .then((points) => {
        if (this.activeRequest !== requestId) return;
        this.points = points;
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

    const fps = Math.max(1, Math.min(30, Number(this.getAttribute("fps")) || 18));
    this.animationTimer = setInterval(() => this.draw(), 1000 / fps);
  }

  updateLabel() {
    this.screen.setAttribute(
      "aria-label",
      this.getAttribute("label") || "Animated 3D ASCII art of the University of Haifa logo",
    );
  }

  resize() {
    const rect = this.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const fontSize = Math.max(6, Math.min(rect.width / (COLUMNS * 0.62), rect.height / ROWS));
    this.screen.style.fontSize = `${fontSize}px`;
    this.screen.style.lineHeight = `${rect.height / ROWS}px`;
    if (this.points) this.draw();
  }

  draw() {
    if (!this.points) return;

    const count = COLUMNS * ROWS;
    const chars = new Uint8Array(count);
    const colors = new Uint32Array(count);
    const zBuffer = new Float32Array(count);
    zBuffer.fill(-1e9);

    const speedAttribute = this.getAttribute("speed");
    const speed = speedAttribute === null ? 1 : Number(speedAttribute);
    const rotationSpeed = Number.isFinite(speed) ? speed : 1;
    const direction = rotationSpeed < 0 ? -1 : 1;
    if (!this.hasAttribute("paused") && !this.motionReduced) this.frameIndex += direction;
    const angleY = this.frameIndex * 0.052 * Math.abs(rotationSpeed);
    this.dataset.frame = String(this.frameIndex);

    const cosY = Math.cos(angleY);
    const sinY = Math.sin(angleY);
    const scale = Math.min(COLUMNS / 10.8, ROWS / 5.6);

    for (const [x, y, z, r, g, b] of this.points) {
      const x2 = x * cosY + z * sinY;
      const z2 = -x * sinY + z * cosY;
      const sx = Math.trunc(COLUMNS / 2 + x2 * scale * 1.18);
      const sy = Math.trunc(ROWS / 2 - y * scale * 0.92);
      if (sx < 0 || sx >= COLUMNS || sy < 0 || sy >= ROWS) continue;

      const index = sy * COLUMNS + sx;
      if (z2 <= zBuffer[index]) continue;
      zBuffer[index] = z2;

      const depthLight = Math.max(0, Math.min(1, (z2 + 3.2) / 6.4));
      const edgeLight = Math.abs(sinY) * Math.min(0.08, Math.abs(z) * 0.05);
      const light = Math.max(0, Math.min(1, 0.5 + 0.32 * depthLight + edgeLight));
      chars[index] = Math.min(RAMP.length - 1, Math.trunc(light * (RAMP.length - 1)));
      const shade = 0.7 + 0.38 * light;
      const rr = Math.max(0, Math.min(255, Math.trunc(r * shade)));
      const gg = Math.max(0, Math.min(255, Math.trunc(g * shade)));
      const bb = Math.max(0, Math.min(255, Math.trunc(b * shade)));
      colors[index] = (rr << 16) | (gg << 8) | bb;
    }

    const rows = [];
    for (let row = 0; row < ROWS; row += 1) {
      let line = "";
      for (let column = 0; column < COLUMNS; column += 1) {
        const index = row * COLUMNS + column;
        const charIndex = chars[index];
        if (!charIndex) {
          line += " ";
          continue;
        }
        line += `<span style="color:${colorToHex(colors[index])}">${escapeHtml(RAMP[charIndex])}</span>`;
      }
      rows.push(line);
    }

    this.screen.innerHTML = rows.join("\n");
  }

  showError(error) {
    this.screen.hidden = true;
    this.message.hidden = false;
    this.message.textContent = "The Haifa logo artwork could not be loaded.";
    console.error(error);
  }
}

if (!customElements.get("haifa-logo-ascii")) {
  customElements.define("haifa-logo-ascii", HaifaLogoAscii);
}

export { HaifaLogoAscii };
