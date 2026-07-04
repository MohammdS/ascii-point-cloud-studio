# 3D ASCII Logo Previews

I made this as a small university computer graphics project. The idea is to take logo point-cloud data, give it a simple fake 3D depth, rotate it in JavaScript, and render it as colored ASCII art in the browser.

The project currently includes two logo previews:

- University of Haifa - old logo
- University of Haifa - new logo

It also includes a small point-cloud editor/viewer so I can inspect, paint, erase, and export the JSON point data used by the previews.

## How To Run

This project should be opened through a local server, not by double-clicking `index.html`.

The reason is that the page loads JavaScript modules and JSON files with `fetch()`. Browsers often block those requests when the page is opened directly from `file://`.

From the project folder, run:

```bash
python -m http.server 8000
```

Then open:

```text
http://127.0.0.1:8000/index.html
```

## What Each Page Does

`index.html`

This is the main preview page. It shows the two animated ASCII logo previews and links to the point-cloud editor.

`point-cloud-editor.html`

This is the editor/viewer page. I use it to load a logo point-cloud JSON file, view the raw points, view an ASCII-style render, add points, remove points, undo/redo edits, reset, and export the edited JSON.

## What Each File Does

`haifa-logo-ascii.js`

This is the main renderer. It defines the custom HTML element:

```html
<haifa-logo-ascii></haifa-logo-ascii>
```

It loads point data, adds shallow depth, spins the points around the Y axis, projects them into a 2D ASCII grid, colors the characters, and writes the final result into a `<pre>` element.

`haifa-logo-points.json`

This contains the point-cloud data for the University of Haifa - old logo.

`second-logo-points.json`

This contains the point-cloud data for the University of Haifa - new logo.

Each point uses this format:

```js
[x, y, r, g, b]
```

Where:

- `x` and `y` are the 2D point position
- `r`, `g`, and `b` are the point color

`point-cloud-editor.js`

This powers the editor. It loads JSON point files, draws them on a canvas, lets me add/remove points, and exports updated JSON.

`point-cloud-editor.css`

This styles the editor page.

## Methodology

My pipeline is:

1. Start with a 2D colored point cloud.
2. Add a shallow fake Z depth to the points.
3. Rotate the points around the Y axis.
4. Drop/project the rotated points onto a 2D ASCII grid.
5. Use a z-buffer so the front-most point wins when multiple points land on the same cell.
6. Convert brightness into ASCII characters.
7. Render the final colored ASCII frame into a `<pre>`.
8. Repeat the process on a timer to create animation.

## Depth Logic

The original JSON files are 2D, so I generate a small depth value in JavaScript.

For each point, I calculate a soft surface offset:

```js
const surface = 0.12 * Math.sin(x * 1.15) + 0.06 * Math.cos(y * 2);
```

Then I add a front layer:

```js
z = surface + 0.42;
```

I also add a lighter back layer for every third point:

```js
z = surface - 0.42;
```

For rim points, I add a few short side-depth samples:

```js
[-0.28, 0, 0.28]
```

I kept this depth shallow because large depth made the logo look noisy and stretched.

## Rotation Math

I rotate only around the Y axis. I intentionally removed X-axis tilt so the logo stays upright.

The angle is based on the frame number:

```js
const angleY = frameIndex * 0.052 * Math.abs(rotationSpeed);
```

For every point, I rotate `x` and `z`:

```js
const x2 = x * cosY + z * sinY;
const z2 = -x * sinY + z * cosY;
```

This is the standard Y-axis rotation formula.

## Projection Math

For projection, I keep it simple and orthographic. That means I do not use perspective. I just drop the Z value for screen position:

```js
const sx = Math.trunc(COLUMNS / 2 + x2 * scale * 1.18);
const sy = Math.trunc(ROWS / 2 - y * scale * 0.92);
```

So:

- rotated `x2` controls horizontal screen position
- original `y` controls vertical screen position
- `z2` is not used for screen position
- `z2` is still used for depth sorting and lighting

## Z-Buffer

When more than one point lands on the same ASCII cell, I keep only the point closest to the viewer.

```js
if (z2 <= zBuffer[index]) continue;
zBuffer[index] = z2;
```

This is what makes the rotating logo feel more like a 3D object instead of a flat pile of points.

## ASCII Shading

I use a character ramp from light to dense:

```js
const RAMP = " .,:;irsXA253hMHGS#9B&@";
```

After calculating a light value, I choose a character from that ramp:

```js
chars[index] = Math.trunc(light * (RAMP.length - 1));
```

Then I color each character using the original point color, slightly shaded by depth.

## Why I Used `<pre>`

I originally tested rendering approaches with canvas and generated frames. The current preview renders into a `<pre>` because it makes the ASCII output real text-like content and keeps the final effect closer to the idea of ASCII art.

Each frame is rebuilt as colored `<span>` elements inside the `<pre>`.

## Notes

This is not a full 3D engine. It is a small graphics experiment focused on:

- point-cloud representation
- simple depth generation
- Y-axis rotation
- orthographic projection
- z-buffer visibility
- ASCII shading
- browser-based interaction

That was the goal of the project: keep the math understandable, make the animation visible, and keep the data editable.
