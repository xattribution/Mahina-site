import { h, $, $$, api, clear, go, href, icon, link, loading, onRender, route, fallback, startRouter, render, toast, currentPath, CFG, setTitle, honeypot, onSubmit, formErrors, modal, linkPicker } from "./core.js";
import { moonInfo, moonSVG } from "./moon.js";
import * as P from "./pages.js";
import * as E from "./events.js";
import { EDIT, ed, tool, saveSettings, initEditing, ask } from "./edit.js";

// Sign-ups live on each event's page, so there's no separate Sign up page in the menu.
const NAV = [["/events", "Events"], ["/gallery", "Gallery"], ["/polls", "Polls"], ["/contact", "Contact"]];

export const PALETTES = {
  classic: { name: "Red, white & blue", night: "#0F2340", accent: "#C8233B" },
  ocean: { name: "Ocean", night: "#0B4552", accent: "#C2185B" },
};

// Palette sets the whole color scheme (see site.css); an optional accent overrides just the button color.
function applyTheme(S = window.SITE || {}) {
  const root = document.documentElement;
  root.dataset.palette = PALETTES[S.palette] ? S.palette : "classic";
  applyAccent(S.accent);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", PALETTES[root.dataset.palette].night);
}

function applyAccent(hex) {
  const root = document.documentElement.style;
  if (!/^#[0-9a-f]{6}$/i.test(hex || "")) { root.removeProperty("--accent"); root.removeProperty("--accent-deep"); return; }
  const n = parseInt(hex.slice(1), 16);
  const d = (v) => Math.max(0, Math.round(v * 0.84));
  const deep = "#" + [d(n >> 16), d((n >> 8) & 255), d(n & 255)].map((v) => v.toString(16).padStart(2, "0")).join("");
  root.setProperty("--accent", hex);
  root.setProperty("--accent-deep", deep);
}

function wordmark(onNight = false) {
  const m = moonInfo();
  return link("/", { class: "wordmark", "aria-label": `${window.SITE.club_name} home` }, moonSVG(m.phase, 22, { maria: false }), window.SITE.club_name);
}

function drawer() {
  const d = h("div.drawer", { role: "dialog", "aria-modal": "true", "aria-label": "Menu" },
    h("div.drawer-top", wordmark(true), h("button.icon-btn", { "aria-label": "Close menu", onclick: () => d.remove() }, icon("close", 24))),
    h("nav", [["/", "Home"], ...NAV, ["/give", "Give"]].map(([p, t]) => link(p, { onclick: () => d.remove(), "aria-current": currentPath() === p ? "page" : null }, t))));
  document.body.append(d);
  d.querySelector("nav a").focus();
  d.addEventListener("keydown", (e) => e.key === "Escape" && d.remove());
}

function banner() {
  const S = window.SITE;
  const b = S.banner || {};
  if (!EDIT.on) {
    if (!b.active || !b.text) return null;
    return h("div.banner", /^\/(?!\/)/.test(b.link || "") ? link(b.link, {}, b.text, icon("right", 16))
      : /^https:\/\//.test(b.link || "") ? h("a", { href: b.link, rel: "noopener" }, b.text, icon("right", 16)) : b.text);
  }
  const save = (patch, redraw = false) => saveSettings({ banner: { text: b.text || "", link: b.link || "", active: !!b.active, ...patch } }, { redraw });
  const text = ed(h("span", b.text || ""), { placeholder: "Banner text", label: "Banner text", save: (t) => save({ text: t }) });
  return h("div.banner", { class: b.active ? "" : "off" },
    h("span.banner-edit", text,
      tool("link", "Banner link", () => {
        const pick = linkPicker(b.link || "");
        const form = h("form", h("label.field", h("span.field-label", "Goes to"), pick.el), h("p.form-error"),
          h("div.row.end", h("button.btn.ghost", { type: "button", onclick: () => m.close() }, "Cancel"), h("button.btn", { type: "submit" }, "Save")));
        onSubmit(form, async () => { await save({ link: pick.get() }, true); m.close(); });
        const m = modal(h("div", h("h2", "Banner link"), form), { label: "Banner link" });
      }),
      tool(b.active ? "eye" : "eyeOff", b.active ? "Hide banner" : "Show banner", () =>
        save({ active: !b.active }, true).catch((e) => toast(e.message, "error")), { "aria-pressed": String(!!b.active) })));
}

function header() {
  const S = window.SITE;
  return [
    banner(),
    h("header.site-header", h("div.wrap",
      wordmark(),
      h("nav.nav", { "aria-label": "Main" }, NAV.map(([p, t]) => link(p, { "data-nav": p }, t)), link("/give", { class: "btn" }, "Give")),
      h("button.icon-btn.menu-btn", { "aria-label": "Open menu", onclick: drawer }, icon("menu", 24)))),
  ];
}

function footer() {
  const S = window.SITE;
  const sub = h("form.inline-form", h("label.visually-hidden", { for: "foot-email" }, "Email"),
    h("input", { id: "foot-email", type: "email", name: "email", placeholder: "Email address", required: true, autocomplete: "email" }),
    honeypot(), h("button.btn", { type: "submit" }, "Join"));
  onSubmit(sub, async (v) => {
    try {
      await api("/api/subscribe", { method: "POST", body: { email: v.email, website: v.website, source: "footer" } });
      sub.replaceWith(h("p", { style: { color: "#fff", fontWeight: 650 } }, "You're on the list. Mahalo!"));
    } catch (e) { toast(e.message, "error"); }
  });
  const feed = CFG.demo ? "#" : `webcal://${location.host}/calendar.ics`;
  return h("footer.site-footer", h("div.wrap",
    h("div.foot-grid",
      h("div", wordmark(true), S.org_line || EDIT.on ? ed(h("p.foot-org", S.org_line || ""), { placeholder: "Organization", label: "Organization",
        save: (t) => saveSettings({ org_line: t }) }) : null),
      h("div.foot-links", [...NAV, ["/give", "Give"]].map(([p, t]) => link(p, {}, t)),
        h("a", { href: feed }, "Calendar feed"), S.email ? h("a", { href: `mailto:${S.email}` }, "Email us") : null),
      h("div.foot-sub", h("h3", "Get club news"), sub)),
    h("div.foot-legal", ed(h("p", S.disclaimer || ""), { multiline: true, placeholder: "Footer notice", label: "Footer notice",
      save: (t) => saveSettings({ disclaimer: t }) }), link("/login", {}, "Login"))));
}

const isConsolePath = (p) => p === "/login" || p === "/join" || p === "/team" || p.startsWith("/team/");
let shellBuilt = false;
function buildShell() {
  const app = $("#app");
  clear(app).append(...header().filter(Boolean), h("main#main", { tabindex: -1 }), footer());
  shellBuilt = true;
}

let lastPath = null;
let cameFromAdmin = false;
onRender(async (fn, params, path) => {
  if (path === "/admin" || path.startsWith("/admin/")) return go(path.replace(/^\/admin/, "/team") + location.search, { replace: true });  // old links
  const isConsole = isConsolePath(path);
  document.body.classList.toggle("admin-mode", isConsole);
  if (isConsole) {
    shellBuilt = false;
    cameFromAdmin = true;
    const A = await import("./admin.js");
    return A.render(path, params);
  }
  if (!shellBuilt) {
    if (cameFromAdmin) await initEditing();   // signing in or out happens in the dashboard; match the edit bar to it
    cameFromAdmin = false;
    applyTheme(); buildShell();
  }
  document.body.classList.toggle("is-home", path === "/");
  $$("[data-nav]").forEach((a) => a.setAttribute("aria-current", path.startsWith(a.dataset.nav) ? "page" : "false"));
  const main = $("#main");
  const samePage = lastPath && lastPath.split("?")[0] === path;
  lastPath = path;
  if (!samePage) clear(main).append(loading());
  try {
    const node = await (fn || P.notFound)(params);
    clear(main).append(node);
  } catch (e) {
    clear(main).append(P.errorPage(e));
  }
  if (!samePage) window.scrollTo(0, 0);
});

window.addEventListener("mahina:rebuild", async (e) => {
  if (e.detail?.reloadSite) {
    try { window.SITE = await api("/api/site"); } catch {}
    applyTheme();
  }
  if (isConsolePath(currentPath())) return;
  const y = window.scrollY;
  shellBuilt = false;
  lastPath = currentPath();
  await render();
  window.scrollTo(0, y);
});

window.addEventListener("scroll", () => document.body.classList.toggle("scrolled", window.scrollY > 40), { passive: true });

route("/", P.home);
route("/events", E.eventsPage);
route("/events/:slug", E.eventPage);
route("/signups", () => { go("/events", { replace: true }); return h("div"); });
route("/signups/:id", E.sheetPage);
route("/gallery", P.gallery);
route("/polls", P.polls);
route("/polls/:slug", P.pollPage);
route("/give", P.give);
route("/contact", P.contact);
route("/me/:token", P.mine);
// One sign-in for everyone at /login. The dashboard at /team shows each person only what their account allows.
route("/login", () => null);
route("/join", () => null);
route("/team", () => null);
route("/team/:section", () => null);
route("/team/:section/:id", () => null);
route("/admin", () => null);
route("/admin/:section", () => null);
route("/admin/:section/:id", () => null);
fallback(P.notFound);

(async () => {
  try { window.SITE = await api("/api/site"); }
  catch (e) { window.SITE = { club_name: "Mahina Club", tags: [], disclaimer: "" }; }
  applyTheme();
  setTitle();
  await initEditing();
  startRouter();
})();

export { applyAccent, applyTheme };
