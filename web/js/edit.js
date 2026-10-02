// On-page editing for signed-in admins.
// Pages mark text with ed(el, { save }) and read EDIT.on to add controls. Toggling edit mode re-renders the page.
import { h, $, $$, api, icon, hint, toast, modal, field, input, onSubmit, CFG, clear } from "./core.js";

export const EDIT = { admin: null, on: false };
const bindings = new WeakMap();
const KEY = "mahina.editing";

// Check whether an admin is signed in, and show or remove the edit bar to match.
// Runs at page load and whenever someone comes back to the site from the Admin console.
export async function initEditing() {
  try {
    const st = await api("/api/admin/state");
    EDIT.admin = st.admin;
  } catch { EDIT.admin = null; }
  if (!EDIT.admin) return signedOut();
  try { EDIT.on = sessionStorage.getItem(KEY) === "1"; } catch {}
  document.body.classList.toggle("editing", EDIT.on);
  document.body.classList.add("has-edit-bar");
  drawBar();
}

export function signedOut() {
  EDIT.admin = null;
  EDIT.on = false;
  try { sessionStorage.removeItem(KEY); } catch {}
  document.body.classList.remove("editing", "has-edit-bar");
  bar?.remove();
  bar = null;
}

export function setEditing(on) {
  EDIT.on = on;
  try { sessionStorage.setItem(KEY, on ? "1" : "0"); } catch {}
  document.body.classList.toggle("editing", on);
  drawBar();
  rebuild();
}

// Ask the app to reload site settings and redraw the header, footer and current page.
export function rebuild({ reloadSite = false } = {}) {
  window.dispatchEvent(new CustomEvent("mahina:rebuild", { detail: { reloadSite } }));
}

let bar = null;
function drawBar() {
  if (!EDIT.admin) return;
  if (!bar) {
    bar = h("div.edit-bar", { role: "toolbar", "aria-label": "Page editing" });
    document.body.append(bar);
  }
  clear(bar).append(EDIT.on
    ? [hint("Click any outlined text to change it. Changes save when you click away. Press Esc to undo."),
       palettePick(),
       h("a.btn.small.ghost", { href: CFG.hashRouting || CFG.memoryRouting ? "#/admin" : "/admin" }, "Admin"),
       h("button.btn.small", { type: "button", onclick: () => setEditing(false) }, icon("check", 16), "Done")]
    : [h("button.btn.small.light", { type: "button", onclick: () => setEditing(true) }, icon("edit", 16), "Edit page"),
       h("a.btn.small.ghost", { href: CFG.hashRouting || CFG.memoryRouting ? "#/admin" : "/admin" }, "Admin")]);
}

const SWATCHES = [["classic", "Red, white & blue", "#0F2340", "#C8233B"], ["ocean", "Ocean", "#0B4552", "#C2185B"]];
function palettePick() {
  const cur = window.SITE?.palette || "classic";
  return h("span.palette-pick", { role: "group", "aria-label": "Colors" },
    SWATCHES.map(([key, name, a, b]) => h("button", { type: "button", title: name, "aria-label": `${name} colors`, "aria-pressed": String(cur === key),
      style: { "--a": a, "--b": b },
      onclick: async () => {
        if (key === (window.SITE?.palette || "classic")) return;
        try { await saveSettings({ palette: key, accent: "" }, { redraw: true }); drawBar(); toast(`${name} colors on`); }
        catch (err) { toast(err.message, "error"); }
      } })));
}

// ---------- editable text ----------
let plaintextOK = null;
function supportsPlaintext() {
  if (plaintextOK === null) {
    const t = document.createElement("div");
    try { t.contentEditable = "plaintext-only"; plaintextOK = t.contentEditable === "plaintext-only"; } catch { plaintextOK = false; }
  }
  return plaintextOK;
}

/**
 * Make an element's text editable while edit mode is on.
 * save(text) persists it and may return the text to display; throw to reject.
 * Options: multiline, placeholder, number (shows raw number while editing), format(value) for display.
 */
export function ed(el, opts) {
  if (!EDIT.on) return el;
  const o = { multiline: false, placeholder: "", number: false, format: null, value: null, ...opts };
  bindings.set(el, o);
  el.classList.add("ed");
  el.contentEditable = supportsPlaintext() ? "plaintext-only" : "true";
  el.spellcheck = !o.number;
  el.setAttribute("role", "textbox");
  if (o.multiline) el.setAttribute("aria-multiline", "true");
  if (o.label) el.setAttribute("aria-label", o.label);
  if (o.placeholder) el.dataset.placeholder = o.placeholder;
  let before = "";
  const read = () => (el.innerText || "").replace(/ /g, " ").replace(/\n{3,}/g, "\n\n").trim();
  el.addEventListener("focus", () => {
    if (o.number && o.value != null) el.textContent = String(o.value);
    before = read();
  });
  el.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { el.textContent = before; el.blur(); e.preventDefault(); }
    else if (e.key === "Enter" && (!o.multiline || e.metaKey || e.ctrlKey)) { e.preventDefault(); el.blur(); }
  });
  el.addEventListener("paste", (e) => {
    e.preventDefault();
    const text = (e.clipboardData?.getData("text/plain") || "").replace(/\r/g, "");
    document.execCommand("insertText", false, o.multiline ? text : text.replace(/\s*\n\s*/g, " "));
  });
  el.addEventListener("blur", async () => {
    const now = read();
    if (now === before) { if (o.number) el.textContent = o.format ? o.format(o.value) : now; return; }
    let val = now;
    if (o.number) {
      val = Number(now.replace(/[^0-9.]/g, ""));
      if (!Number.isFinite(val)) { toast("Enter a number.", "error"); el.textContent = o.format ? o.format(o.value) : before; return; }
    }
    el.classList.add("saving");
    try {
      const shown = await o.save(val);
      if (o.number) o.value = val;
      el.textContent = shown ?? (o.format ? o.format(val) : now);
      toast("Saved");
    } catch (err) {
      el.textContent = o.number && o.format ? o.format(o.value) : before;
      toast(err.message || "That didn't save.", "error");
      if (err.status === 401) { signedOut(); rebuild(); }
    } finally { el.classList.remove("saving"); }
  });
  return el;
}

// Small icon button for edit controls.
export function tool(iconName, label, onclick, attrs = {}) {
  return h("button.ed-btn", { type: "button", "aria-label": label, title: label, onclick, ...attrs }, icon(iconName, 16));
}

// Text button for edit controls.
export function action(label, onclick, iconName = "plus") {
  return h("button.ed-action", { type: "button", onclick }, icon(iconName, 16), label);
}

// ---------- saving helpers ----------
export async function saveSettings(patch, { redraw = false } = {}) {
  const res = await api("/api/admin/settings", { method: "PUT", body: patch });
  Object.assign(window.SITE, pickPublic(res));
  if (redraw) rebuild({ reloadSite: true });
  return res;
}
function pickPublic(s) {
  const out = {};
  for (const k of ["club_name", "org_line", "email", "venmo", "donate_goal", "donate_uses", "officers", "disclaimer",
    "home_sections", "labels", "spotlight", "public_uploads", "accent", "palette", "moon_caption"]) if (k in s) out[k] = s[k];
  if ("banner" in s) out.banner = s.banner;
  return out;
}

export const patchEvent = (id, body) => api(`/api/admin/events/${id}`, { method: "PATCH", body });

// Upload one image (not added to the gallery). Returns { id, src, thumb }.
export function pickImage() {
  return new Promise((resolve, reject) => {
    const fi = h("input", { type: "file", accept: "image/*", hidden: true });
    fi.addEventListener("change", async () => {
      const f = fi.files[0];
      fi.remove();
      if (!f) return reject(new Error("No photo chosen."));
      const fd = new FormData();
      fd.append("file", f);
      try { resolve(await api("/api/admin/settings/cover", { method: "POST", form: fd })); }
      catch (e) { reject(e); }
    });
    document.body.append(fi);
    fi.click();
  });
}

// A small form in a dialog. fields: [{ name, label, type, value, options, attrs }]. Resolves with values or null.
export function ask(title, fields, { ok = "Save" } = {}) {
  return new Promise((resolve) => {
    let result = null;
    const form = h("form",
      fields.map((f) => {
        if (f.type === "check") return h("label.check", h("input", { type: "checkbox", name: f.name, checked: !!f.value }), f.label);
        if (f.type === "select") return field(f.label, h("select", { name: f.name },
          f.options.map(([v, t]) => h("option", { value: v, selected: String(v) === String(f.value ?? "") }, t))));
        return field(f.label, input(f.name, { type: f.type || "text", value: f.value ?? "", ...(f.attrs || {}) }), { optional: f.optional });
      }),
      h("p.form-error"),
      h("div.row.end", h("button.btn.ghost", { type: "button", onclick: () => m.close() }, "Cancel"), h("button.btn", { type: "submit" }, ok)));
    onSubmit(form, async (v) => { result = v; m.close(); });
    const m = modal(h("div", h("h2", title), form), { label: title, onClose: () => resolve(result) });
    form.querySelector("input, select")?.focus();
  });
}
