// Moon phase math and drawing. Mahina is the moon; the site shows tonight's.

const SYNODIC = 29.530588853;
const REF_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14); // a known new moon

// Kaulana mahina: the thirty named nights of the Hawaiian lunar month.
export const NIGHTS = ["Hilo", "Hoaka", "Kūkahi", "Kūlua", "Kūkolu", "Kūpau", "ʻOlekūkahi", "ʻOlekūlua", "ʻOlekūkolu",
  "ʻOlepau", "Huna", "Mōhalu", "Hua", "Akua", "Hoku", "Māhealani", "Kulu", "Lāʻaukūkahi", "Lāʻaukūlua", "Lāʻaupau",
  "ʻOlekūkahi", "ʻOlekūlua", "ʻOlepau", "Kāloakūkahi", "Kāloakūlua", "Kāloapau", "Kāne", "Lono", "Mauli", "Muku"];

export function moonAge(date = new Date()) {
  const days = (date.getTime() - REF_NEW_MOON) / 86400000;
  return ((days % SYNODIC) + SYNODIC) % SYNODIC;
}

export function moonInfo(date = new Date()) {
  const age = moonAge(date);
  const phase = age / SYNODIC; // 0 new, .5 full
  const illum = (1 - Math.cos(phase * 2 * Math.PI)) / 2;
  const night = NIGHTS[(Math.floor(age) + 29) % 30];
  return { age, phase, illum, night };
}

// Full moons between two dates (UTC instants).
export function fullMoons(from, to) {
  const out = [];
  const firstFull = REF_NEW_MOON + (SYNODIC / 2) * 86400000;
  let n = Math.ceil((from.getTime() - firstFull) / (SYNODIC * 86400000));
  for (;;) {
    const t = firstFull + n * SYNODIC * 86400000;
    if (t > to.getTime()) break;
    out.push(new Date(t));
    n++;
  }
  return out;
}

// SVG path for the lit part of a moon of radius r centered at (r, r).
export function litPath(phase, r) {
  const waxing = phase < 0.5;
  const k = Math.cos(phase * 2 * Math.PI); // 1 new, -1 full
  const rx = Math.abs(k) * r;
  const top = `${r} 0`, bottom = `${r} ${2 * r}`;
  // Outer edge on the lit side, then the terminator back.
  const outerSweep = waxing ? 1 : 0;
  const termSweep = (waxing ? k > 0 : k < 0) ? 0 : 1;
  return `M ${top} A ${r} ${r} 0 0 ${outerSweep} ${bottom} A ${rx} ${r} 0 0 ${termSweep} ${top} Z`;
}

const NS = "http://www.w3.org/2000/svg";
function el(name, attrs) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

// Flat moon: dark disc, lit shape, a few maria clipped to the lit part.
export function moonSVG(phase, size = 320, { maria = true, className = "moon" } = {}) {
  const r = 50;
  const id = "m" + Math.random().toString(36).slice(2, 7);
  const svg = el("svg", { viewBox: "0 0 100 100", width: size, height: size, class: className, "aria-hidden": "true" });
  svg.append(el("circle", { cx: 50, cy: 50, r: 49.5, class: "moon-dark" }));
  const lit = el("path", { d: litPath(phase, r), class: "moon-lit" });
  svg.append(lit);
  if (maria) {
    const clip = el("clipPath", { id });
    clip.append(el("path", { d: litPath(phase, r) }));
    svg.append(clip);
    const g = el("g", { "clip-path": `url(#${id})`, class: "moon-maria" });
    [[36, 34, 12], [56, 28, 7], [63, 47, 10], [44, 55, 6], [67, 68, 5], [27, 52, 4]].forEach(([cx, cy, rr]) =>
      g.append(el("circle", { cx, cy, r: rr })));
    svg.append(g);
  }
  return svg;
}

// ---------- palms (ocean theme) ----------
// A coconut palm silhouette: a curved, ringed trunk and arching fronds with hanging leaflets.
export function palmSVG({ height = 420, lean = -0.25, fronds = 11, seed = 1 } = {}) {
  const W = 600, H = 600;
  const rnd = (() => { let s = seed * 9301 + 49297; return () => ((s = (s * 9301 + 49297) % 233280) / 233280); })();
  const crown = { x: W / 2, y: 215 }, base = { x: W / 2 - lean * 230, y: H };
  const ctrl = { x: base.x + lean * 30, y: (base.y + crown.y) / 2 + 40 };
  const q = (a, c, b, t) => (1 - t) * (1 - t) * a + 2 * (1 - t) * t * c + t * t * b;
  const qd = (a, c, b, t) => 2 * (1 - t) * (c - a) + 2 * t * (b - c);
  const f1 = (n) => n.toFixed(1);
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("height", height);
  svg.setAttribute("width", Math.round((height * W) / H));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "palm");
  const path = (d, cls) => { const p = document.createElementNS(NS, "path"); p.setAttribute("d", d); if (cls) p.setAttribute("class", cls); svg.append(p); };

  // trunk: tapered outline with slight bulges for the rings
  const L = [], R = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const x = q(base.x, ctrl.x, crown.x, t), y = q(base.y, ctrl.y, crown.y, t);
    const dx = qd(base.x, ctrl.x, crown.x, t), dy = qd(base.y, ctrl.y, crown.y, t);
    const len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
    const w = 12 - 6 * t + (i % 4 === 0 ? 1.3 : 0);
    L.push(`${f1(x + nx * w)} ${f1(y + ny * w)}`); R.unshift(`${f1(x - nx * w)} ${f1(y - ny * w)}`);
  }
  path(`M ${L.join(" L ")} L ${R.join(" L ")} Z`, "trunk");

  // fronds: an arching midrib, with leaflets hanging from both sides
  let rib = "", leaflets = "";
  for (let k = 0; k < fronds; k++) {
    const side = k % 2 ? 1 : -1;
    const lin = (k / (fronds - 1)) * 2 - 1;
    const spread = Math.sign(lin) * Math.abs(lin) ** 0.65;       // -1 .. 1, more fronds toward the sides
    const ang = -Math.PI / 2 + spread * 1.55 + (rnd() - 0.5) * 0.18;
    const len = 190 + rnd() * 80;
    const out = Math.cos(ang), up = Math.sin(ang);
    const droop = 10 + out * out * 95 + rnd() * 25;              // side fronds arc down, top fronds stay up
    const c = { x: crown.x + out * len * 0.6, y: crown.y + up * len * 0.75 - 45 };
    const tip = { x: crown.x + out * len, y: crown.y + up * len * 0.45 + droop };
    rib += `M ${f1(crown.x)} ${f1(crown.y)} Q ${f1(c.x)} ${f1(c.y)} ${f1(tip.x)} ${f1(tip.y)} `;
    const N = 30;
    for (let i = 2; i <= N; i++) {
      const t = i / N;
      const x = q(crown.x, c.x, tip.x, t), y = q(crown.y, c.y, tip.y, t);
      const dx = qd(crown.x, c.x, tip.x, t), dy = qd(crown.y, c.y, tip.y, t);
      const l = Math.hypot(dx, dy) || 1, tx = dx / l, ty = dy / l;
      const size = Math.sin(Math.PI * Math.min(1, t * 1.05)) * (40 - 14 * t);
      for (const s2 of [-1, 1]) {
        // leaflet points away from the midrib, swept toward the tip, and pulled down by gravity
        let lx = -ty * s2 * 0.8 + tx * 0.5, ly = tx * s2 * 0.8 + ty * 0.5 + 0.7;
        const m = Math.hypot(lx, ly); lx /= m; ly /= m;
        leaflets += `M ${f1(x)} ${f1(y)} l ${f1(lx * size)} ${f1(ly * size)} `;
      }
    }
  }
  path(rib, "rib");
  path(leaflets, "leaflet");
  [[-9, 8], [7, 11], [-1, 17]].forEach(([dx, dy]) => {
    const c = document.createElementNS(NS, "circle");
    c.setAttribute("cx", crown.x + dx); c.setAttribute("cy", crown.y + dy); c.setAttribute("r", 8); svg.append(c);
  });
  return svg;
}
