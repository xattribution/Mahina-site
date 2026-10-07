// Core helpers: DOM builder, API client, router, formatting, small UI pieces.

export const CFG = window.MAHINA || {};
export const BASE = CFG.base || "";

// ---------- DOM ----------
export function h(tag, attrs, ...kids) {
  const parts = tag.split(/(?=[.#])/);
  const name = parts[0].startsWith(".") || parts[0].startsWith("#") ? "div" : parts.shift();
  const el = name === "svg" ? document.createElementNS("http://www.w3.org/2000/svg", name) : document.createElement(name || "div");
  const classes = parts.filter((p) => p[0] === ".").map((p) => p.slice(1));
  const id = parts.find((p) => p[0] === "#");
  if (classes.length) el.setAttribute("class", classes.join(" "));
  if (id) el.id = id.slice(1);
  if (attrs && typeof attrs === "object" && !(attrs instanceof Node) && !Array.isArray(attrs)) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false || k === "svg") continue;
      if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === "class") el.setAttribute("class", [el.getAttribute("class"), v].filter(Boolean).join(" "));
      else if (k === "style" && typeof v === "object") {
        for (const [p, val] of Object.entries(v)) {
          if (val == null) continue;
          if (p.startsWith("--")) el.style.setProperty(p, val); else el.style[p] = val;
        }
      }
      else if (k === "html") el.innerHTML = v;
      else if (k in el && typeof v !== "string" && k !== "list") el[k] = v;
      else el.setAttribute(k, v === true ? "" : v);
    }
  } else if (attrs != null) kids.unshift(attrs);
  append(el, kids);
  return el;
}
function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
// Empties an element; the returned appender flattens arrays like h() does.
export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return { el, append: (...kids) => { append(el, kids); return el; } };
}

// ---------- icons (hand-drawn 20px line set) ----------
const ICONS = {
  calendar: "M4 6.5h12v10H4zM4 9.5h12M7.5 4v4M12.5 4v4",
  clock: "M10 3.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM10 6.5V10l2.5 1.5",
  pin: "M10 17s-5-4.6-5-8.5a5 5 0 0 1 10 0C15 12.4 10 17 10 17zM10 10.3a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6z",
  people: "M7.5 9.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM3 16c.4-2.6 2.2-4 4.5-4s4.1 1.4 4.5 4M13 4.8a2.4 2.4 0 0 1 0 4.5M14.2 12.2c1.5.4 2.5 1.7 2.8 3.8",
  left: "M12 4.5 6.5 10l5.5 5.5", right: "M8 4.5l5.5 5.5L8 15.5",
  close: "M5 5l10 10M15 5 5 15", plus: "M10 4.5v11M4.5 10h11", minus: "M4.5 10h11", check: "M4.5 10.5l3.5 3.5 7.5-8",
  info: "M10 3.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM10 9v4.5M10 6.6v.1",
  camera: "M3.5 7h3l1.5-2h4l1.5 2h3v9h-13zM10 13.8a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2z",
  external: "M11 4h5v5M16 4l-7 7M14 12v4H4V6h4",
  menu: "M3.5 6.5h13M3.5 10h13M3.5 13.5h13",
  copy: "M7 7h9v9H7zM4 13V4h9", download: "M10 3.5v9M6 9l4 4 4-4M4 16.5h12",
  trash: "M4.5 6h11M8 6V4h4v2M6 6l.8 10h6.4L14 6", edit: "M4 16l1-4 8-8 3 3-8 8zM11.5 5.5l3 3",
  grip: "M8 5h.1M12 5h.1M8 10h.1M12 10h.1M8 15h.1M12 15h.1",
  up: "M5 12.5 10 7.5l5 5", down: "M5 7.5l5 5 5-5", mail: "M3.5 5.5h13v9h-13zM3.5 6l6.5 5 6.5-5",
  image: "M3.5 4.5h13v11h-13zM3.5 13l4-4 3 3 2-2 4 4M13 8a1 1 0 1 0 0-.1",
  poll: "M4 16V9M8 16V4M12 16v-5M16 16V7", heart: "M10 16s-6-3.6-6-8a3.3 3.3 0 0 1 6-1.8A3.3 3.3 0 0 1 16 8c0 4.4-6 8-6 8z",
  list: "M7.5 5.5h9M7.5 10h9M7.5 14.5h9M3.5 5.5h.1M3.5 10h.1M3.5 14.5h.1",
  grid: "M4 4h5v5H4zM11 4h5v5h-5zM4 11h5v5H4zM11 11h5v5h-5z",
  home: "M3.5 9.5 10 4l6.5 5.5M5.5 8v8h9V8", gear: "M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM10 2.5v2M10 15.5v2M17.5 10h-2M4.5 10h-2M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4M15.3 15.3l-1.4-1.4M6.1 6.1 4.7 4.7",
  send: "M3.5 10 16.5 4l-4 12.5-3-5.5z", inbox: "M3.5 11.5h4l1 2h3l1-2h4M5 5h10l1.5 6.5V16h-13v-4.5z",
  eye: "M2.5 10S5 5 10 5s7.5 5 7.5 5-2.5 5-7.5 5-7.5-5-7.5-5zM10 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  eyeOff: "M2.5 10S5 5 10 5s7.5 5 7.5 5-2.5 5-7.5 5-7.5-5-7.5-5zM10 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM3.5 3.5l13 13",
  logout: "M8 4H4v12h4M11.5 6.5 15 10l-3.5 3.5M15 10H7.5",
  clipboard: "M7 4.5H5.5v12h9v-12H13M7.5 3.5h5v2.5h-5zM7.5 11l1.8 1.8 3.4-3.6",
  cart: "M2.5 4h2.2l1.7 8.5h8.4L16.8 7H5.6M8 16.3h.1M14 16.3h.1",
  shield: "M10 3l6 2.2V10c0 3.5-2.6 6-6 7-3.4-1-6-3.5-6-7V5.2zM7.5 10l1.8 1.8 3.4-3.6",
  history: "M3.5 10a6.5 6.5 0 1 0 2-4.7M3.5 4v3.5H7M10 6.5V10l2.5 1.5",
  user: "M10 9.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4 17c.6-3.2 3-5 6-5s5.4 1.8 6 5",
  note: "M5 3.5h7.5l3 3v10h-10.5zM12 3.5v3.5h3.5M7.5 10.5h5M7.5 13.5h3.5", link: "M8.5 11.5l3-3M7 9.5l-1.8 1.8a2.5 2.5 0 0 0 3.5 3.5L10.5 13M13 10.5l1.8-1.8a2.5 2.5 0 0 0-3.5-3.5L9.5 7",
};
export function icon(name, size = 20) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 20 20");
  s.setAttribute("width", size);
  s.setAttribute("height", size);
  s.setAttribute("aria-hidden", "true");
  s.setAttribute("class", "icon");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", ICONS[name] || "");
  s.append(p);
  return s;
}

// A small (i) that shows a hint on hover or focus.
// Keep an open tooltip inside the screen, or inside the popup it belongs to.
function nudgeHint(e) {
  const t = e.target.closest?.(".hint");
  const b = t && t.querySelector(".hint-bubble");
  if (!b) return;
  b.style.setProperty("--nudge", "0px");
  requestAnimationFrame(() => {
    const r = b.getBoundingClientRect(), box = (t.closest("dialog[open]") || document.documentElement).getBoundingClientRect();
    const right = Math.min(box.right, window.innerWidth) - 8, left = Math.max(box.left, 0) + 8;
    let n = 0;
    if (r.right > right) n = right - r.right;
    if (r.left + n < left) n = left - r.left;
    b.style.setProperty("--nudge", `${Math.round(n)}px`);
  });
}
document.addEventListener("mouseover", nudgeHint);
document.addEventListener("focusin", nudgeHint);

export function hint(text) {
  return h("span.hint", { tabindex: 0, role: "note", "aria-label": text }, icon("info", 16), h("span.hint-bubble", text));
}

// ---------- API ----------
export class ApiError extends Error {
  constructor(msg, status, field) { super(msg); this.status = status; this.field = field; }
}
export async function api(path, opts = {}) {
  if (CFG.demo) return window.MAHINA_DEMO.handle(path, opts);
  const init = { method: opts.method || "GET", headers: { "X-Mahina": "1" }, credentials: "same-origin" };
  if (opts.form) init.body = opts.form;
  else if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body);
    init.headers["Content-Type"] = "application/json";
  }
  let res;
  try { res = await fetch(path, init); } catch { throw new ApiError("Can't reach the server. Check your connection.", 0); }
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(data?.error || data?.detail || "Something went wrong on our side. Try again.", res.status, data?.field);
  return data;
}
export const media = (src) => (src && CFG.demo && src.startsWith("/") ? (CFG.mediaBase || ".") + src : src);

// ---------- router ----------
const routes = [];
let notFound = null;
export function route(pattern, fn) {
  const keys = [];
  const re = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), "([^/]+)")) + "/?$");
  routes.push({ re, keys, fn });
}
export function fallback(fn) { notFound = fn; }
// Memory routing keeps the path in a variable (used by the offline preview).
let MEM = "/";
export function currentPath() {
  if (CFG.memoryRouting) return MEM.split("?")[0].split("#")[0] || "/";
  if (CFG.hashRouting) return (location.hash.slice(1) || "/").split("?")[0].split("#")[0];
  return location.pathname.replace(BASE, "") || "/";
}
export function anchor() {
  if (CFG.memoryRouting) return MEM.split("#")[1] || "";
  if (CFG.hashRouting) return location.hash.slice(1).split("#")[1] || "";
  return location.hash.slice(1);
}
export function query() {
  const s = CFG.memoryRouting ? (MEM.split("?")[1] || "").split("#")[0]
    : CFG.hashRouting ? (location.hash.split("?")[1] || "").split("#")[0] : location.search.slice(1);
  return new URLSearchParams(s);
}
export function href(path) { return CFG.hashRouting || CFG.memoryRouting ? "#" + path : BASE + path; }
export function replaceUrl(path) {
  if (CFG.memoryRouting) MEM = path;
  else if (CFG.hashRouting) history.replaceState(null, "", "#" + path);
  else history.replaceState(null, "", BASE + path);
}
export function go(path, { replace = false } = {}) {
  if (CFG.memoryRouting) { MEM = path; render(); return; }
  if (CFG.hashRouting) {
    if (replace) history.replaceState(null, "", "#" + path); else location.hash = path;
    if (replace) render();
    return;
  }
  history[replace ? "replaceState" : "pushState"](null, "", BASE + path);
  render();
}
let renderHook = () => {};
export function onRender(fn) { renderHook = fn; }
export async function render() {
  const path = currentPath();
  for (const r of routes) {
    const m = path.match(r.re);
    if (m) {
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      return renderHook(r.fn, params, path);
    }
  }
  return renderHook(notFound, {}, path);
}
export function startRouter() {
  document.addEventListener("click", (e) => {
    if (document.body.classList.contains("editing") && e.target.closest?.(".ed, .ed-btn, .ed-action, .ed-tools")) {
      if (e.target.closest("a[href]")) e.preventDefault();
      return;
    }
    const a = e.target.closest("a[href]");
    if (!a || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || a.target || a.hasAttribute("download")) return;
    const url = a.getAttribute("href");
    if (CFG.memoryRouting) {
      if (url.startsWith("#/")) { e.preventDefault(); go(url.slice(1)); }
      else if (url === "#") e.preventDefault();
      return;
    }
    if (CFG.hashRouting) return; // hash links route themselves
    if (!url.startsWith("/") || url.startsWith("//") || url.startsWith("/api/") || url.startsWith("/media/") || url.endsWith(".ics")) return;
    e.preventDefault();
    if (url !== location.pathname + location.search) go(url.replace(BASE, ""));
  });
  if (!CFG.memoryRouting) window.addEventListener(CFG.hashRouting ? "hashchange" : "popstate", render);
  render();
}
export const link = (path, attrs, ...kids) => h("a", { href: href(path), ...attrs }, ...kids);

// ---------- dates (all times are the club's wall clock) ----------
export const parse = (s) => (s ? new Date(s.length <= 10 ? s + "T00:00" : s) : null);
const fmt = (d, o) => d.toLocaleString("en-US", o);
export const monthName = (d, style = "long") => fmt(d, { month: style });
export const weekday = (d, style = "short") => fmt(d, { weekday: style });
export function time(d) {
  const s = fmt(d, { hour: "numeric", minute: "2-digit" });
  return s.replace(":00", "");
}
export function timeRange(ev) {
  if (ev.all_day) return "All day";
  const a = parse(ev.starts_at), b = parse(ev.ends_at);
  if (!b) return time(a);
  const sa = time(a), sb = time(b);
  const same = sa.slice(-2) === sb.slice(-2);
  return (same ? sa.slice(0, -3) : sa) + "–" + sb;
}
export function longDate(d) { return fmt(d, { weekday: "long", month: "long", day: "numeric" }); }
export function shortDate(d) { return fmt(d, { weekday: "short", month: "short", day: "numeric" }); }
export function clubNow() {
  const tz = window.SITE?.timezone || "Pacific/Honolulu";
  const s = new Date().toLocaleString("sv-SE", { timeZone: tz }).replace(" ", "T");
  return new Date(s);
}
export function isoLocal(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function relDays(d) {
  const a = clubNow(); a.setHours(0, 0, 0, 0);
  const b = new Date(d); b.setHours(0, 0, 0, 0);
  const n = Math.round((b - a) / 86400000);
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  if (n > 1 && n < 7) return weekday(d, "long");
  if (n > 0) return `In ${n} days`;
  return null;
}
export function googleCal(ev) {
  const z = (s) => s.replace(/[-:]/g, "") + "00";
  const end = ev.ends_at || isoLocal(new Date(parse(ev.starts_at).getTime() + 7200000));
  const p = new URLSearchParams({ action: "TEMPLATE", text: ev.title, dates: `${z(ev.starts_at)}/${z(end)}`,
    ctz: window.SITE?.timezone || "Pacific/Honolulu", location: ev.location || "", details: ev.summary || "" });
  return "https://calendar.google.com/calendar/render?" + p;
}

// ---------- remembered visitor (prefills forms) ----------
export const me = {
  get() { try { return JSON.parse(localStorage.getItem("mahina.me") || "{}"); } catch { return {}; } },
  set(v) { try { localStorage.setItem("mahina.me", JSON.stringify({ ...me.get(), ...v })); } catch {} },
  forget() { try { localStorage.removeItem("mahina.me"); } catch {} },
};

// ---------- UI bits ----------
export function toast(msg, kind = "") {
  let host = $(".toasts");
  if (!host) document.body.append((host = h("div.toasts", { role: "status", "aria-live": "polite" })));
  const t = h("div.toast", { class: kind }, msg);
  host.append(t);
  setTimeout(() => t.classList.add("out"), 3200);
  setTimeout(() => t.remove(), 3700);
}

export function modal(content, { label = "Dialog", wide = false, onClose } = {}) {
  const prev = document.activeElement;
  const close = () => { dlg.close(); };
  const dlg = h("dialog.modal", { class: wide ? "wide" : "", "aria-label": label },
    h("button.modal-x.icon-btn", { type: "button", "aria-label": "Close", onclick: close }, icon("close")),
    content);
  dlg.addEventListener("close", () => { dlg.remove(); onClose?.(); prev?.focus?.(); });
  dlg.addEventListener("click", (e) => { if (e.target === dlg) close(); });
  document.body.append(dlg);
  dlg.showModal();
  return { close, el: dlg };
}

export function confirmBox(message, { ok = "Delete", danger = true } = {}) {
  return new Promise((resolve) => {
    let result = false;
    const m = modal(h("div.confirm",
      h("p.confirm-msg", message),
      h("div.row.end",
        h("button.btn.ghost", { type: "button", onclick: () => m.close() }, "Cancel"),
        h("button.btn", { type: "button", class: danger ? "danger" : "", onclick: () => { result = true; m.close(); } }, ok))),
      { label: "Confirm", onClose: () => resolve(result) });
  });
}

// Form field with label and inline error slot.
export function field(label, input, { hintText, optional } = {}) {
  const id = input.id || (input.id = "f" + Math.random().toString(36).slice(2, 8));
  return h("label.field", { for: id },
    h("span.field-label", label, optional ? h("span.optional", " optional") : null, hintText ? hint(hintText) : null),
    input, h("span.field-error", { "aria-live": "polite" }));
}
export function input(name, attrs = {}) { return h("input", { name, type: "text", ...attrs }); }

export function formErrors(form, err) {
  $$(".field.invalid", form).forEach((f) => f.classList.remove("invalid"));
  $$(".field-error", form).forEach((e) => (e.textContent = ""));
  const general = $(".form-error", form);
  if (general) general.textContent = "";
  if (!err) return;
  const target = err.field && form.querySelector(`[name="${err.field}"]`);
  const f = target?.closest(".field");
  if (f) {
    f.classList.add("invalid");
    $(".field-error", f).textContent = err.message;
    target.focus();
  } else if (general) general.textContent = err.message;
  else toast(err.message, "error");
}

export function values(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === "checkbox") out[el.name] = el.checked;
    else if (el.type === "radio") { if (el.checked) out[el.name] = el.value; }
    else out[el.name] = el.value;
  }
  return out;
}

// Submit handler wrapper: disables the button, shows errors inline.
export function onSubmit(form, fn) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector("button[type=submit]") || (form.id && document.querySelector(`button[form="${form.id}"]`));
    btn && (btn.disabled = true);
    formErrors(form, null);
    try { await fn(values(form)); }
    catch (err) { formErrors(form, err); }
    finally { btn && (btn.disabled = false); }
  });
  return form;
}

export const honeypot = () => h("input.hp", { name: "website", tabindex: -1, autocomplete: "off", "aria-hidden": "true" });

export function tagChip(t, { active, onclick, as = "button" } = {}) {
  const attrs = { class: `tag c-${t.color}` + (active ? " on" : ""), "aria-pressed": onclick ? String(!!active) : null, onclick };
  if (as === "a") return link(`/gallery?tag=${t.slug}`, attrs, h("span.dot"), t.name);
  if (as === "span") return h("span", attrs, h("span.dot"), t.name);
  return h("button", { type: "button", ...attrs }, h("span.dot"), t.name);
}

export function empty(title, action) {
  return h("div.empty", h("p.empty-title", title), action || null);
}

export function plural(n, one, many = one + "s") { return `${n} ${n === 1 ? one : many}`; }

export function copy(text) {
  (navigator.clipboard?.writeText(text) || Promise.reject()).then(() => toast("Copied"), () => toast(text));
}

export function loading() { return h("div.loading", { "aria-label": "Loading" }, h("span"), h("span"), h("span")); }

export function setTitle(t) { document.title = t ? `${t} | ${window.SITE?.club_name || "Mahina Club"}` : window.SITE?.club_name || "Mahina Club"; }

// ---------- link picker ----------
// Pick where something links to: a page, an upcoming event, an open poll, or a custom address.
const SITE_PAGES = [["/events", "Events"], ["/gallery", "Gallery"], ["/polls", "Polls"], ["/give", "Give"], ["/contact", "Contact"]];
export function linkPicker(current = "", { name = "link", label = "Goes to" } = {}) {
  const select = h("select", { name: `${name}_pick`, "aria-label": label });
  const custom = h("input", { type: "text", name: `${name}_custom`, placeholder: "https://… or /page", "aria-label": "Custom link", value: "" });
  const wrap = h("span.link-picker", select, custom);
  const sync = () => { custom.hidden = select.value !== "custom"; if (!custom.hidden) custom.focus(); };
  select.addEventListener("change", sync);
  const fill = (events = [], polls = []) => {
    const opts = [["", "No link"], ...SITE_PAGES.map(([v, t]) => [v, `Page: ${t}`]),
      ...events.map((e) => [`/events/${e.slug}`, `Event: ${e.title}`]), ...polls.map((p) => [`/polls/${p.slug}`, `Poll: ${p.title}`])];
    const known = opts.some(([v]) => v === current);
    clear(select).append(opts.map(([v, t]) => h("option", { value: v, selected: v === current }, t)),
      h("option", { value: "custom", selected: !known && !!current }, "Custom link…"));
    if (!known && current) custom.value = current;
    custom.hidden = select.value !== "custom";
  };
  fill();
  const today = isoLocal(clubNow()).slice(0, 10);
  Promise.all([api(`/api/events?start=${today}`).catch(() => []), api("/api/polls").catch(() => [])])
    .then(([evs, polls]) => fill(evs.filter((e) => e.status !== "cancelled"), polls.filter((p) => !p.closed)));
  return { el: wrap, get: () => (select.value === "custom" ? custom.value.trim() : select.value) };
}
