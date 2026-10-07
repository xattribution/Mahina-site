// Admin console.
import { h, $, $$, api, clear, go, href, icon, link, hint, parse, time, timeRange, longDate, shortDate, monthName, weekday,
  clubNow, isoLocal, toast, modal, confirmBox, field, input, onSubmit, formErrors, values, tagChip, empty, plural, copy,
  setTitle, media, loading, CFG, query, replaceUrl, anchor, linkPicker } from "./core.js";
import { moonInfo, moonSVG } from "./moon.js";
import { results } from "./pages.js";
import { shopAdmin } from "./shop-team.js";

let ME = null;
let STATE = {};
let COUNTS = {};
const TAG_COLORS = ["reef", "plumeria", "fern", "lagoon", "lehua", "taro"];
const REMINDERS = [[168, "1 week before"], [48, "2 days before"], [24, "1 day before"], [3, "3 hours before"]];
const Q_KINDS = [["single", "Multiple choice"], ["multi", "Checkboxes"], ["rating", "Rating 1–5"], ["text", "Written answer"]];
const ACCENTS = [["", "Theme color"], ["#C8233B", "Lehua"], ["#C2185B", "Hibiscus"], ["#0E7C7B", "Reef"], ["#2F6DB5", "Lagoon"], ["#6F558F", "Taro"], ["#C98A0E", "Plumeria"], ["#0F2340", "Night"]];

// ---------- small components ----------
const sw = (name, label, checked, attrs = {}) => h("label.switch", h("span", label, attrs.hintText ? hint(attrs.hintText) : null), h("input", { type: "checkbox", name, checked: !!checked, role: "switch", onchange: attrs.onchange }));
const sel = (name, options, value, attrs = {}) => h("select", { name, ...attrs }, options.map(([v, t]) => h("option", { value: v, selected: String(v) === String(value ?? "") }, t)));
const pill = (s, label) => h("span.pill", { class: s }, label || s[0].toUpperCase() + s.slice(1));
const dateCell = (s) => { const d = parse(s); return `${monthName(d, "short")} ${d.getDate()}${d.getFullYear() !== clubNow().getFullYear() ? ", " + d.getFullYear() : ""}`; };
const ago = (s) => {
  const d = parse(s), n = (clubNow() - d) / 60000;
  if (n < 1) return "just now";
  if (n < 60) return `${Math.round(n)} min ago`;
  if (n < 1440) return `${Math.round(n / 60)} hr ago`;
  if (n < 10080) return `${Math.round(n / 1440)} d ago`;
  return dateCell(s);
};
const aHref = (p) => href("/team" + p);
const aLink = (p, attrs, ...kids) => link("/team" + p, attrs, ...kids);
const can = (...perms) => ME?.role === "admin" || perms.some((p) => ME?.perms?.includes(p));
const isAdmin = () => ME?.role === "admin";
const money = (n) => (n == null || n === "" ? "" : "$" + Number(n).toFixed(2));
const csv = (path) => (CFG.demo ? () => toast("Exports work on the live site") : () => { location.href = path; });
async function refreshSite() { try { window.SITE = await api("/api/site"); } catch {} }

// ---------- entry ----------
export async function render(path) {
  const app = $("#app");
  const parts = path.replace(/^\/(team|login)\/?/, "").split("/").filter(Boolean);
  const [section = "", rawId] = parts;
  const id = rawId && /^(\d+|new)$/.test(rawId) ? rawId : undefined;  // ids go into API paths, so only numbers
  if (path === "/join") return joinScreen(app);
  let state;
  try { state = await api("/api/admin/state"); } catch (e) { clear(app).append(h("div.auth", h("div.auth-card", h("p", e.message)))); return; }
  STATE = state;
  if (!state.setup) return authScreen(app, "setup");
  if (!state.admin) return authScreen(app, "login", path);
  if (path === "/login") return go("/team", { replace: true });
  ME = state.admin;
  STATE = state;
  const main = h("main.admin-main", loading());
  clear(app).append(layout(section, main));
  window.scrollTo(0, 0);
  const pages = { "": overview, planning: id ? planPage : planningList, events: id ? eventEditor : eventsList, signups: id ? sheetEditorPage : sheetsList,
    polls: id ? pollEditor : pollsList, gallery: galleryAdmin, messages: inbox, people, email: emailPage, shop: shopAdmin, accounts, activity, settings, account };
  const navItem = NAV.find((n) => n[0] === section);
  try {
    if (navItem && !navAllowed(navItem)) throw new Error("You don't have access to this part. Ask an admin.");
    const node = await (pages[section] || overview)(id, main);
    clear(main).append(node);
  } catch (e) {
    clear(main).append(h("div.empty", h("p.empty-title", e.message), aLink("", { class: "btn dark" }, "Back to overview")));
  }
  refreshCounts();
}

async function refreshCounts() {
  try {
    const o = await api("/api/admin/overview");
    COUNTS = { messages: o.unread, gallery: o.pending_photos, email: o.outbox_held, planning: o.my_tasks, shop: (o.shop_waiting || 0) + (o.shop_hand_out || 0) };
    $$(".side nav a").forEach((a) => {
      const n = COUNTS[a.dataset.sec];
      $(".count", a)?.remove();
      if (n) a.append(h("span.count", n));
    });
  } catch {}
}

// [path, label, icon, who can see it: null = everyone, "admin" = admins only, or a list of permissions]
const NAV = [["", "Overview", "home", null], ["planning", "Planning", "clipboard", ["planning", "events"]], ["events", "Events", "calendar", ["events"]],
  ["signups", "Sign-ups", "list", ["signups", "events"]], ["polls", "Polls", "poll", ["polls"]], ["gallery", "Gallery", "image", ["photos"]],
  ["messages", "Messages", "inbox", ["messages"]], ["people", "People", "people", ["people"]], ["email", "Email", "mail", ["email"]],
  ["shop", "Shop", "bag", ["shop"]],
  ["accounts", "Team", "shield", ["team"]], ["activity", "Activity", "history", "admin"], ["settings", "Settings", "gear", "admin"]];
const navAllowed = ([, , , who]) => !who || (who === "admin" ? isAdmin() : can(...who));

function layout(section, main) {
  const nav = NAV.filter(navAllowed);
  const m = moonInfo();
  const mark = () => link("/team", { class: "wordmark" }, moonSVG(m.phase, 22, { maria: false }), window.SITE?.club_name || "Mahina Club");
  const side = h("aside.side",
    h("div.row", { style: { justifyContent: "space-between" } }, mark(), h("button.icon-btn.menu-close", { type: "button", "aria-label": "Close menu", style: { display: "none" }, onclick: () => side.classList.remove("open") }, icon("close"))),
    h("nav", { "aria-label": "Admin" }, nav.map(([s, t, i]) => aLink(s ? "/" + s : "", { "data-sec": s, "aria-current": s === section ? "page" : null, onclick: () => side.classList.remove("open") },
      icon(i), t, COUNTS[s] ? h("span.count", COUNTS[s]) : null))),
    h("div.side-foot",
      CFG.demo ? h("div.callout", { style: { margin: "0 0 8px", fontSize: "13px" } }, "Preview only. Edits here aren't saved.") : null,
      aLink("/account", { class: "side-who", "aria-current": section === "account" ? "page" : null }, h("b", ME.name), h("span", ME.email), h("span.role", isAdmin() ? "Admin" : "Member")),
      link("/", {}, icon("external"), "View site"),
      h("button", { type: "button", onclick: async () => { await api("/api/admin/logout", { method: "POST" }); go("/login"); } }, icon("logout"), "Sign out")));
  const top = h("div.admin-top", mark(), h("button.icon-btn", { type: "button", "aria-label": "Menu", onclick: () => { side.classList.add("open"); $(".menu-close", side).style.display = "inline-grid"; } }, icon("menu", 24)));
  return h("div.admin", side, h("div", top, main));
}

// Password field with a show/hide toggle. Paste and password managers work; nothing is restricted but length.
function pwField(label, name, { autocomplete = "current-password", isNew = false, hintText } = {}) {
  const inp = input(name, { type: "password", required: true, autocomplete, maxlength: 128, minlength: isNew ? STATE.min_password || 15 : null,
    spellcheck: "false", autocapitalize: "off" });
  const toggle = h("button.pw-toggle", { type: "button", "aria-label": "Show password", "aria-pressed": "false", onclick: () => {
    const show = inp.type === "password";
    inp.type = show ? "text" : "password";
    toggle.setAttribute("aria-pressed", String(show));
    toggle.setAttribute("aria-label", show ? "Hide password" : "Show password");
    clear(toggle).append(icon(show ? "eyeOff" : "eye", 18));
  } }, icon("eye", 18));
  const f = field(label, inp, { hintText: hintText ?? (isNew ? `At least ${STATE.min_password || 15} characters, any kind. A few words strung together works well.` : null) });
  const wrap = h("span.pw-wrap");
  inp.replaceWith(wrap);
  wrap.append(inp, toggle);
  return f;
}

const SSO_ERRORS = { notadmin: "That account doesn't have access here. Ask an admin to add your email.",
  noemail: "Your sign-in provider didn't share a verified email.", failed: "Single sign-on didn't finish. Try again." };

function authScreen(app, mode, path = "/team") {
  setTitle(mode === "setup" ? "Set up" : "Sign in");
  const m = moonInfo();
  const pwOn = mode === "setup" || STATE.password_login !== false;
  const err = query().get("sso_error");
  const form = pwOn ? h("form",
    mode === "setup" ? field("Your name", input("name", { required: true, autocomplete: "name" })) : null,
    field("Email", input("email", { type: "email", required: true, autocomplete: "username" })),
    pwField("Password", "password", mode === "setup" ? { autocomplete: "new-password", isNew: true } : {}),
    h("p.form-error"),
    h("button.btn.block", { type: "submit" }, mode === "setup" ? "Create admin account" : "Sign in")) : null;
  if (form) onSubmit(form, async (v) => {
    await api(`/api/admin/${mode === "setup" ? "setup" : "login"}`, { method: "POST", body: v });
    // Signed in from /login: go to the dashboard. Signed in from a deep link: stay on it.
    if (path === "/login") go("/team", { replace: true }); else render(path);
  });
  const sso = mode === "login" && STATE.sso ? h("a.btn.block", { class: pwOn ? "ghost" : "", href: "/api/admin/sso/start" }, `Sign in with ${STATE.sso.name}`) : null;
  clear(app).append(h("div.auth", h("div.auth-card",
    link("/", { class: "wordmark" }, moonSVG(m.phase, 22, { maria: false }), window.SITE?.club_name || "Mahina Club"),
    h("h1", mode === "setup" ? "Create the first admin" : "Sign in"),
    err && SSO_ERRORS[err] ? h("p.form-error", { style: { marginBottom: "14px" } }, SSO_ERRORS[err]) : null,
    sso, sso && form ? h("div.auth-or", "or") : null, form)));
  form?.querySelector("input").focus();
}

// ---------- joining from an invite ----------
// The token rides in the URL fragment, which browsers never send to the server. We read it, then clear it
// from the address bar so it doesn't linger in history or screenshots.
async function joinScreen(app) {
  setTitle("Join");
  const KEY = "mahina.join";
  let tok = location.hash.length > 1 ? location.hash.slice(1) : "";
  try { if (tok) sessionStorage.setItem(KEY, tok); else tok = sessionStorage.getItem(KEY) || ""; } catch {}
  if (location.hash && !CFG.hashRouting && !CFG.memoryRouting) history.replaceState(null, "", location.pathname);
  const m = moonInfo();
  const card = h("div.auth-card", link("/", { class: "wordmark" }, moonSVG(m.phase, 22, { maria: false }), window.SITE?.club_name || "Mahina Club"), loading());
  clear(app).append(h("div.auth", card));
  let info;
  try { info = await api("/api/admin/join/check", { method: "POST", body: { token: tok } }); }
  catch (e) {
    $(".loading", card)?.remove();
    card.append(h("h1", "Link not valid"), h("p.muted", e.message), link("/login", { class: "btn block ghost" }, "Go to sign in"));
    return;
  }
  STATE = { ...STATE, min_password: info.min_password, password_login: info.password_login, sso: info.sso };
  const form = h("form",
    h("input", { type: "email", name: "username", value: info.email, autocomplete: "username", hidden: true, readonly: true }),
    field("Email", h("input", { type: "email", value: info.email, readonly: true, tabindex: -1, class: "readonly" })),
    field("Your name", input("name", { value: info.name || "", required: true, autocomplete: "name" })),
    info.password_login ? pwField("Choose a password", "password", { autocomplete: "new-password", isNew: true }) : null,
    h("p.form-error"),
    h("button.btn.block", { type: "submit" }, info.password_login ? "Create account" : `Continue with ${info.sso?.name || "single sign-on"}`));
  onSubmit(form, async (v) => {
    const r = await api("/api/admin/join", { method: "POST", body: { token: tok, name: v.name, password: v.password } });
    try { sessionStorage.removeItem(KEY); } catch {}
    if (r.signed_in) go("/team", { replace: true }); else location.href = "/api/admin/sso/start";
  });
  $(".loading", card)?.remove();
  card.append(h("h1", `Join the ${info.club || "Mahina Club"} team`),
    h("p.join-from", `${info.invited_by || "An admin"} invited you as ${info.role === "admin" ? "an admin" : "a member"}.`), form);
  form.querySelector("[name=name]").value ? form.querySelector("[name=password]")?.focus() : form.querySelector("[name=name]").focus();
}

function head(title, { back, actions, sub } = {}) {
  setTitle(title);
  return h("div.a-head", h("div", back ? aLink(back[0], { class: "back" }, icon("left", 18), back[1]) : null, h("h1", title), sub ? h("div.a-sub", sub) : null),
    actions ? h("div.row", actions) : null);
}

// ---------- overview ----------
async function overview() {
  const withTasks = can("planning", "events");
  const [o, plan] = await Promise.all([api("/api/admin/overview"), withTasks ? api("/api/admin/planning") : null]);
  const todos = [];
  if (o.smtp_ready === false) todos.push(["mail", "Connect an email service so confirmations and reminders go out", "/settings#email", "Set up"]);
  if (o.venmo === false) todos.push(["heart", "Add the club Venmo handle to turn on the Give page", "/settings#give", "Set up"]);
  if (o.outbox_held) todos.push(["send", `${plural(o.outbox_held, "email")} waiting to send`, "/email", "Review"]);
  const verb = { rsvp: "is going to", signup: "signed up for", poll: "answered" };
  const stats = [
    [can("events") ? "/events" : "/planning", o.upcoming.length, "Upcoming events"],
    o.my_tasks != null ? ["/planning", o.my_tasks, "Assigned to you"] : null,
    o.unread != null ? ["/messages", o.unread, "Unread messages"] : null,
    o.pending_photos != null ? ["/gallery?show=pending", o.pending_photos, "Photos to review"] : null,
    o.subscribers != null ? [can("people") ? "/people" : "/email", o.subscribers, "On the mailing list"] : null].filter(Boolean).slice(0, 4);
  const mine = plan?.mine || [];
  const showRecent = can("events", "signups", "polls");
  return h("div",
    head(`Aloha, ${ME.name.split(" ")[0]}`, { actions: [
      can("events") ? aLink("/events/new", { class: "btn" }, icon("plus", 18), "New event") : null,
      can("email") ? aLink("/email", { class: "btn ghost" }, "Email people") : null] }),
    todos.length ? h("div.todo", todos.map(([i, t, p, go]) => aLink(p, {}, icon(i), t, h("span.go", go)))) : null,
    h("div.stats", stats.map(([p, n, t]) => aLink(p, { class: "stat" }, h("b", n), h("span", t)))),
    mine.length && showRecent ? h("section.a-section", h("h2", "Assigned to you", aLink("/planning", { class: "text-link small" }, "Planning")), myTaskList(mine)) : null,
    h("div.two-col",
      h("section.a-section", h("h2", "Coming up", aLink(can("events") ? "/events" : "/planning", { class: "text-link small" }, "All events")),
        o.upcoming.length ? eventTable(o.upcoming) : empty("Nothing scheduled.", can("events") ? aLink("/events/new", { class: "btn dark" }, "New event") : null)),
      showRecent ? h("section.a-section", h("h2", "Recent activity"),
        o.recent.length ? h("div.activity", o.recent.map((r) => h("div", h("span", h("b", r.name), ` ${verb[r.kind]} `, r.what), h("time", ago(r.created))))) : h("p.muted", "No activity yet."))
        : withTasks ? h("section.a-section", h("h2", "Assigned to you"), mine.length ? myTaskList(mine) : h("p.muted", "Nothing assigned to you right now.")) : null));
}

function eventTable(list) {
  return h("div.tbl-wrap", h("table.tbl",
    h("thead", h("tr", h("th", "Date"), h("th", "Event"), h("th", "Status"), h("th.num", "Going"), h("th.num", "Sign-ups"))),
    h("tbody", list.map((e) => h("tr.click", { onclick: () => go(`/team/${can("events") ? "events" : "planning"}/${e.id}`) },
      h("td.date", dateCell(e.starts_at)),
      h("td", h("a.strong", { href: aHref(`/${can("events") ? "events" : "planning"}/${e.id}`), style: { textDecoration: "none" } }, e.title), h("div.sub", `${weekday(parse(e.starts_at))} ${e.all_day ? "" : time(parse(e.starts_at))}`)),
      h("td", pill(e.status)),
      h("td.num", e.going || "–"),
      h("td.num", e.signup ? `${e.signup.open} open` : "–"))))));
}

// ---------- events ----------
async function eventsList() {
  const all = await api("/api/admin/events");
  const now = isoLocal(clubNow());
  const f = { view: query().get("view") || "upcoming" };
  const body = h("div");
  const draw = () => {
    const list = all.filter((e) => f.view === "drafts" ? e.status === "draft" : f.view === "past" ? e.starts_at < now && e.status !== "draft" : e.starts_at >= now && e.status !== "draft");
    if (f.view === "upcoming" || f.view === "drafts") list.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    clear(body).append(
      h("div.seg", { style: { marginBottom: "20px" } }, [["upcoming", "Upcoming"], ["past", "Past"], ["drafts", "Drafts"]].map(([v, t]) =>
        h("button", { type: "button", "aria-pressed": String(f.view === v), onclick: () => { f.view = v; draw(); } }, t))),
      list.length ? eventTable(list) : empty(f.view === "drafts" ? "No drafts." : "No events here."));
  };
  draw();
  return h("div", head("Events", { actions: [aLink("/events/new", { class: "btn" }, icon("plus", 18), "New event")] }), body);
}

async function eventEditor(id) {
  const isNew = id === "new";
  const [ev, tags] = await Promise.all([isNew ? null : api(`/api/admin/events/${id}`), api("/api/admin/tags")]);
  const tab = query().get("tab") || "details";
  if (isNew) return h("div", head("New event", { back: ["/events", "Events"] }), eventForm(null, tags));
  const tabs = [["details", "Details"], ["signups", "Sign-ups", ev.sheets.length], ["rsvps", "RSVPs", ev.rsvps.filter((r) => r.status === "going").length],
    ["planning", "Planning"], can("polls") ? ["polls", "Polls", ev.polls.length] : null, can("email") ? ["invite", "Invite"] : null].filter(Boolean);
  const body = h("div");
  const setTab = (t) => {
    replaceUrl(`/team/events/${id}?tab=${t}`);
    $$(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.t === t)));
    clear(body).append(t === "signups" ? eventSheets(ev) : t === "rsvps" ? rsvpTab(ev) : t === "invite" ? inviteTab(ev) : t === "planning" ? planBoard(ev.id) : t === "polls" ? eventPolls(ev) : eventForm(ev, tags));
  };
  const page = h("div",
    head(ev.title, { back: ["/events", "Events"], sub: `${longDate(parse(ev.starts_at))}, ${timeRange(ev)}`,
      actions: [
        link(`/events/${ev.slug}`, { class: "btn small ghost", target: "_blank" }, icon("external", 16), "View"),
        h("button.btn.small.ghost", { type: "button", onclick: async () => { const r = await api(`/api/admin/events/${id}/duplicate`, { method: "POST" }); toast("Duplicated as a draft"); go(`/team/events/${r.id}`); } }, icon("copy", 16), "Duplicate"),
        h("button.btn.small.ghost", { type: "button", onclick: async () => {
          if (await confirmBox(`Delete ${ev.title}? RSVPs and sign-ups for it go too.`)) { await api(`/api/admin/events/${id}`, { method: "DELETE" }); toast("Event deleted"); go("/team/events"); }
        } }, icon("trash", 16), "Delete")] }),
    h("div.tabs", { role: "tablist" }, tabs.map(([t, label, n]) => h("button", { type: "button", role: "tab", "data-t": t, "aria-selected": String(t === tab), onclick: () => setTab(t) }, label, n != null ? h("span.n", n) : null))),
    body);
  setTab(tab);
  return page;
}

// Starting points for a new event, and common sentences for any event. Plain club voice, easy to edit.
const EVENT_TEMPLATES = [
  { label: "Potluck", title: "ʻOhana Potluck", summary: "Bring a dish to share. The club covers drinks and plates.",
    details: "Come hungry and bring a dish to share. Sign up below for a main, side, or dessert so we get a good spread.\n\nThe club provides drinks, plates, and utensils. Families and keiki are welcome.\n\nRSVP so we know how much food to plan for." },
  { label: "Holiday party", title: "Holiday Party", summary: "Dinner, keiki gifts, and a white elephant exchange.",
    details: "Join us for dinner and the holiday celebration. Spouses, families, and keiki are welcome.\n\nWhite elephant: bring one wrapped gift, about $20, if you want to play.\n\nRSVP with your guest count so we can plan food and gifts." },
  { label: "Pau hana", title: "Pau Hana", summary: "End the week together. Drinks and pūpū provided.",
    details: "Pau hana after work. Drinks and pūpū provided while they last.\n\nCome as you are, and bring someone who's new to the unit." },
  { label: "Volunteer", title: "Community Service Day", summary: "A few hours giving back. Gloves and water provided.",
    details: "We're giving back to the community. Gloves, bags, and water are provided.\n\nWear closed-toe shoes, a hat, and sunscreen. Sign up for a shift below so we can plan the crew." },
  { label: "Sports", title: "Volleyball Tournament", summary: "Teams of six. All skill levels welcome.",
    details: "Bring a team or come solo and we'll place you. All skill levels welcome.\n\nBring water, sunscreen, and a chair for the sidelines." },
  { label: "Fundraiser", title: "Fundraiser", summary: "Every dollar goes to the holiday party fund.", donate: true,
    details: "Help us raise money for the club. Every dollar goes to the holiday party fund and keiki gifts.\n\nYou can chip in on Venmo with the QR code on this page." },
  { label: "Farewell", title: "Aloha ʻOe Farewell", summary: "Send off our departing Guardians and families.",
    details: "Come say aloha to the Guardians and families heading to their next assignment.\n\nPūpū provided. Feel free to bring a dish to share." },
];
const SNIPPETS = [
  ["RSVP", "RSVP so we know how much food to plan for."],
  ["Bring a dish", "Sign up below to bring a dish so we get a good mix of mains, sides, and desserts."],
  ["Club provides", "The club provides drinks, plates, and utensils."],
  ["Families welcome", "Families and keiki are welcome."],
  ["Guests welcome", "Spouses and guests are welcome. Add them to your RSVP."],
  ["Base access", "Guests without base access: send their full names to the club email at least three days ahead for a visitor pass."],
  ["What to bring", "Bring a chair, sunscreen, and water."],
  ["Shoes", "Wear closed-toe shoes."],
  ["Parking", "Parking is limited, so carpool if you can."],
  ["Rain or shine", "Rain or shine."],
  ["Free", "Free for members and families."],
  ["Questions", "Questions? Send us a note on the Contact page."],
];

function snippetMenu(textarea) {
  const pick = h("select.snippet", { "aria-label": "Insert common text", onchange: (e) => {
    const text = e.target.value;
    e.target.value = "";
    if (!text) return;
    const { selectionStart: a = textarea.value.length, selectionEnd: b = a, value } = textarea;
    const before = value.slice(0, a).replace(/\s+$/, ""), after = value.slice(b);
    const glue = before ? (before.endsWith("\n") ? "" : "\n\n") : "";
    textarea.value = before + glue + text + after;
    const at = (before + glue + text).length;
    textarea.focus(); textarea.setSelectionRange(at, at);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  } }, h("option", { value: "" }, "Insert…"), SNIPPETS.map(([label, text]) => h("option", { value: text }, label)));
  return pick;
}

function eventForm(ev, allTags) {
  const e = ev || { title: "", starts_at: "", ends_at: "", location: "", map_url: "", summary: "", description: "", status: "published",
    rsvp_enabled: true, capacity: null, reminders: [24], tag_ids: [], cover: null, cover_photo_id: null, all_day: false };
  const st = { tags: new Set(e.tag_ids), cover: e.cover, cover_id: e.cover_photo_id, status: e.status, reminders: new Set(e.reminders) };
  const tagBox = h("div.chips-edit");
  const drawTags = () => clear(tagBox).append(allTags.map((t) => tagChip(t, { active: st.tags.has(t.id), onclick: () => { st.tags.has(t.id) ? st.tags.delete(t.id) : st.tags.add(t.id); drawTags(); } })),
    h("form.add-tag", { onsubmit: async (x) => {
      x.preventDefault();
      const name = x.target.tagname.value.trim(); if (!name) return;
      const t = await api("/api/admin/tags", { method: "POST", body: { name, color: TAG_COLORS[allTags.length % TAG_COLORS.length] } });
      allTags.push(t); st.tags.add(t.id); drawTags(); refreshSite();
    } }, h("input", { name: "tagname", placeholder: "New tag", "aria-label": "New tag" }), h("button.icon-btn", { type: "submit", "aria-label": "Add tag" }, icon("plus", 18))));
  drawTags();
  const coverBox = h("div");
  const drawCover = () => clear(coverBox).append(
    h("div.cover-pick", st.cover ? h("img", { src: media(st.cover.thumb), alt: "" }) : icon("image", 28)),
    h("div.row", { style: { marginTop: "10px" } },
      h("label.btn.small.ghost", { style: { cursor: "pointer" } }, st.cover ? "Replace" : "Upload",
        h("input", { type: "file", accept: "image/*", hidden: true, onchange: async (x) => {
          const fd = new FormData(); fd.append("file", x.target.files[0]);
          const p = await api("/api/admin/settings/cover", { method: "POST", form: fd });
          st.cover = p; st.cover_id = p.id; drawCover();
        } })),
      h("button.btn.small.ghost", { type: "button", onclick: () => pickPhoto((p) => { st.cover = p; st.cover_id = p.id; drawCover(); }) }, "From gallery"),
      st.cover ? h("button.btn.small.ghost", { type: "button", onclick: () => { st.cover = null; st.cover_id = null; drawCover(); } }, "Remove") : null));
  drawCover();
  const statusSeg = h("div.seg");
  const drawStatus = () => clear(statusSeg).append([["draft", "Draft"], ["published", "Published"], ["cancelled", "Cancelled"]].map(([v, t]) =>
    h("button", { type: "button", "aria-pressed": String(st.status === v), onclick: () => { st.status = v; drawStatus(); } }, t)));
  drawStatus();
  const [sd, stime] = (e.starts_at || "").split("T");
  const [ed, etime] = (e.ends_at || "").split("T");
  const details = h("textarea", { name: "description", rows: 7 }, e.description || "");
  const detailsField = field("Details", details);
  detailsField.querySelector(".field-label").append(snippetMenu(details));
  const starters = ev ? null : h("div.starters", { role: "group", "aria-label": "Start from" },
    h("span.field-label", "Start from", hint("Fills in a title, summary, and details you can edit. Pick Blank to start empty.")),
    h("div.starter-row", [...EVENT_TEMPLATES, { label: "Blank", title: "", summary: "", details: "" }].map((t) =>
      h("button", { type: "button", "aria-pressed": "false", onclick: (x) => {
        $$(".starter-row button", form).forEach((b) => b.setAttribute("aria-pressed", String(b === x.currentTarget)));
        const titleIn = $("[name=title]", form);
        titleIn.value = t.title; $("[name=summary]", form).value = t.summary; details.value = t.details;
        const don = $("[name=donate]", panel); if (don) don.checked = !!t.donate;
        titleIn.focus(); titleIn.select();
      } }, t.label))));
  const form = h("form",
    starters,
    field("Title", input("title", { value: e.title, required: true, placeholder: "ʻOhana Potluck" })),
    h("div.two", field("Date", input("date", { type: "date", value: sd || "", required: true })),
      h("div.two", field("Starts", input("start", { type: "time", value: stime || "", step: 300 })), field("Ends", input("end", { type: "time", value: etime || "", step: 300 }), { optional: true }))),
    h("label.check", h("input", { type: "checkbox", name: "all_day", checked: !!e.all_day }), "All day"),
    h("div.two", field("Place", input("location", { value: e.location, placeholder: "Hickam Beach, Pavilion 3" })),
      field("Map link", input("map_url", { type: "url", value: e.map_url, placeholder: "https://maps.google.com/..." }), { optional: true, hintText: "Leave blank and the site links to a map search for the place." })),
    field("Summary", input("summary", { value: e.summary, maxlength: 240 }), { hintText: "One line. Shows on the timeline and in emails." }),
    detailsField,
    ev && ev.status === "published" ? h("label.check", h("input", { type: "checkbox", name: "notify_change" }), "Email attendees if the date, place, or status changes") : null,
    h("p.form-error"),
    null);
  form.id = "event-form";
  onSubmit(form, async (v) => {
    if (!v.date) throw Object.assign(new Error("Pick a date."), { field: "date" });
    const starts_at = `${v.date}T${v.all_day ? "00:00" : v.start || "00:00"}`;
    const ends_at = v.end && !v.all_day ? `${v.date}T${v.end}` : (v.all_day ? `${v.date}T23:59` : "");
    const body = { ...v, starts_at, ends_at, status: st.status, tag_ids: [...st.tags], cover_photo_id: st.cover_id, reminders: [...st.reminders],
      rsvp_enabled: $("[name=rsvp_enabled]", panel).checked, capacity: $("[name=capacity]", panel).value,
      donate: $("[name=donate]", panel).checked, donate_note: $("[name=donate_note]", panel).value };
    if (ev) {
      await api(`/api/admin/events/${ev.id}`, { method: "PUT", body });
      toast("Saved");
      Object.assign(ev, body);
    } else {
      const r = await api("/api/admin/events", { method: "POST", body });
      toast(st.status === "draft" ? "Draft saved" : "Event created");
      go(`/team/events/${r.id}?tab=signups`);
    }
  });
  const panel = h("div.panel",
    h("div.panel-block", h("span.field-label", "Status"), statusSeg),
    h("div.panel-block", h("span.field-label", "Cover photo"), coverBox),
    h("div.panel-block", h("span.field-label", "Tags", hint("Tags color the timeline and link events to gallery photos.")), tagBox),
    h("div.panel-block", h("span.field-label", "RSVPs"),
      sw("rsvp_enabled", "Take RSVPs", e.rsvp_enabled),
      field("Capacity", input("capacity", { type: "number", min: 1, value: e.capacity || "", placeholder: "No limit" }), { optional: true })),
    h("div.panel-block", h("span.field-label", "Donations", hint(window.SITE?.venmo
        ? "Shows a Venmo QR code on the event page. Payments open with the event name as the note."
        : "Add the club's Venmo handle under Settings > Give first.")),
      sw("donate", "Show a Venmo QR code", e.donate_on),
      field("Note", input("donate_note", { value: e.donate_note || "", maxlength: 120, placeholder: "Help cover the turkey and sides" }), { optional: true })),
    h("div.panel-block", h("span.field-label", "Reminder emails", hint("Sent to everyone who RSVPs or signs up, unless they turned reminders off.")),
      REMINDERS.map(([hrs, t]) => h("label.check", h("input", { type: "checkbox", checked: st.reminders.has(hrs), onchange: (x) => x.target.checked ? st.reminders.add(hrs) : st.reminders.delete(hrs) }), t))));
  return h("div.editor", form, panel, h("div.savebar", h("button.btn", { type: "submit", form: "event-form" }, ev ? "Save changes" : "Create event")));
}

function pickPhoto(onPick) {
  const grid = h("div.pgrid", loading());
  const m = modal(h("div", h("h2", "Choose a photo"), grid), { wide: true, label: "Choose a photo" });
  api("/api/admin/photos").then((list) => {
    clear(grid).append(list.filter((p) => p.status !== "pending").map((p) => h("button.pthumb", { type: "button", onclick: () => { onPick(p); m.close(); } }, h("img", { src: media(p.thumb), alt: p.caption || "" }))));
  });
}

// ---------- sign-up sheets ----------
const TEMPLATES = {
  potluck: { title: "Bring a dish", description: "Tell us what you're bringing.", allow_other: true,
    slots: [["Main dish", 6, true, true], ["Side dish", 8, true, true], ["Dessert", 6, true, true], ["Drinks and ice", 3, true, false], ["Plates and napkins", 2, false, false]] },
  volunteer: { title: "Help out", description: "", slots: [["Setup", 4], ["Check-in table", 2], ["Cleanup", 4]] },
  blank: { title: "", description: "", slots: [["", 1]] },
};

function eventSheets(ev) {
  const wrap = h("div");
  const draw = () => {
    clear(wrap);
    ev.sheets.forEach((s) => wrap.append(sheetCard(s, ev, draw)));
    wrap.append(h("section.a-section",
      h("h2", ev.sheets.length ? "Add another sign-up" : "Add a sign-up"),
      h("div.templates",
        [["potluck", "Potluck dishes", "Mains, sides, desserts, drinks"], ["volunteer", "Volunteer shifts", "Timed shifts with a set number of people"], ["blank", "Blank", "Build your own slots"]].map(([k, t, d]) =>
          h("button", { type: "button", onclick: () => openSheetEditor(ev, null, k, async () => { ev.sheets = (await api(`/api/admin/events/${ev.id}`)).sheets; draw(); }) }, h("b", t), h("span", d))))));
  };
  draw();
  return wrap;
}

function sheetCard(s, ev, redraw) {
  const reload = async () => {
    if (ev) ev.sheets = (await api(`/api/admin/events/${ev.id}`)).sheets;
    redraw();
  };
  return h("div.sheet-card",
    h("div.sheet-card-head",
      h("div", h("h3", s.title), h("div.a-sub", [s.capacity ? `${s.filled} of ${s.capacity} filled` : `${plural(s.people, "person", "people")} signed up`,
        s.servings ? `about ${s.servings} servings` : ""].filter(Boolean).join(", "), s.status !== "open" ? ", " : "", s.status !== "open" ? pill(s.status) : null)),
      h("div.row",
        h("button.btn.small.ghost", { type: "button", onclick: csv(`/api/admin/sheets/${s.id}/export.csv`) }, icon("download", 16), "CSV"),
        h("button.btn.small.ghost", { type: "button", onclick: () => openSheetEditor(ev, s, null, reload) }, icon("edit", 16), "Edit"),
        h("button.btn.small.ghost", { type: "button", "aria-label": "Delete sign-up", onclick: async () => {
          if (await confirmBox(`Delete “${s.title}” and everyone signed up for it?`)) { await api(`/api/admin/sheets/${s.id}`, { method: "DELETE" }); toast("Sign-up deleted"); reload(); }
        } }, icon("trash", 16)))),
    h("div.roster",
      h("div.who.who-head", h("span", "Name"), h("span", "Email"), h("span", "Bringing"), h("span.num", "Qty"), h("span.num", "Feeds"), h("span")),
      s.slots.map((sl) => h("div",
        h("div.slot-name", h("span", sl.image ? h("img.slot-thumb", { src: media(sl.image.thumb), alt: "" }) : null, sl.title, sl.starts_at ? h("span.muted", { style: { fontWeight: 500 } }, "  " + timeRange({ starts_at: sl.starts_at, ends_at: sl.ends_at })) : null),
          h("span.muted.small", [sl.unlimited ? plural(sl.taken, "person", "people") : `${sl.taken} of ${sl.capacity}`, sl.servings ? `about ${sl.servings} servings` : ""].filter(Boolean).join(", "))),
        sl.signups.length ? sl.signups.map((u) => h("div.who",
          h("span.strong", u.name),
          h("a", { href: `mailto:${u.email}`, class: "muted" }, u.email),
          h("span", u.item || h("span.muted", "–")),
          h("span.num.qty", { title: `${u.name} is bringing ${u.qty}` }, `×${u.qty}`),
          h("span.num", u.servings || h("span.muted", "–")),
          h("button.icon-btn", { type: "button", "aria-label": `Remove ${u.name}`, onclick: async () => {
            if (await confirmBox(`Remove ${u.name} from ${sl.title}?`, { ok: "Remove" })) { await api(`/api/admin/signups/${u.id}`, { method: "DELETE" }); reload(); }
          } }, icon("close", 16)))) : h("div.who.none", h("span.muted", "No one yet"))))));
}

function openSheetEditor(ev, sheet, template, onSaved) {
  const t = template ? TEMPLATES[template] : null;
  const s = sheet ? JSON.parse(JSON.stringify(sheet)) : { title: t.title, description: t.description, status: "open", show_names: true, closes_at: "", allow_other: !!t.allow_other,
    slots: t.slots.map(([title, capacity, ask, serves]) => ({ title, capacity, ask_item: !!ask, ask_servings: !!serves, note: "" })) };
  const node = sheetForm(s, ev, async (saved) => { m.close(); toast(sheet ? "Sign-up saved" : "Sign-up added"); await onSaved(saved); });
  const m = modal(h("div", h("h2", sheet ? "Edit sign-up" : "New sign-up"), node), { wide: true, label: "Sign-up editor" });
  m.el.classList.add("xwide");
}

// Specific items inside a slot (Turkey, Ham, Rolls). Each can need more than one person.
function editChoices(sl, onDone) {
  const list = (sl.choices || []).map((c) => ({ ...c }));
  const box = h("div.choice-edit");
  const draw = () => clear(box).append(
    list.length ? h("div.choice-edit-head", h("span", "Item"), h("span", "How many")) : null,
    list.map((c, i) => h("div.choice-edit-row",
      h("input", { type: "text", value: c.title, placeholder: "Turkey", "aria-label": `Item ${i + 1}`, maxlength: 80, oninput: (e) => (c.title = e.target.value),
        onkeydown: (e) => { if (e.key === "Enter") { e.preventDefault(); list.splice(i + 1, 0, { title: "", need: 1 }); draw(); $$("input[type=text]", box)[i + 1]?.focus(); } } }),
      h("input", { type: "number", min: 1, max: 99, value: c.need || 1, "aria-label": "How many people", oninput: (e) => (c.need = Number(e.target.value) || 1) }),
      h("button.icon-btn", { type: "button", "aria-label": "Remove item", onclick: () => { list.splice(i, 1); draw(); } }, icon("close", 16)))),
    h("button.btn.small.ghost", { type: "button", onclick: () => { list.push({ title: "", need: 1 }); draw(); $$("input[type=text]", box).at(-1)?.focus(); } }, icon("plus", 16), "Add item"));
  if (!list.length) list.push({ title: "", need: 1 });
  draw();
  const m = modal(h("div", h("h2", sl.title ? `Items for ${sl.title}` : "Items"), box,
    h("div.row.end", { style: { marginTop: "20px" } },
      h("button.btn", { type: "button", onclick: () => { sl.choices = list.filter((c) => c.title.trim()); m.close(); onDone(); } }, "Done"))), { label: "Items" });
  $("input[type=text]", box)?.focus();
}

// Pick a picture for a sign-up slot: upload one, or reuse a gallery photo.
function pickSlotImage(current, onPick) {
  const grid = h("div.pgrid", loading());
  const upload = h("label.btn.small", { style: { cursor: "pointer" } }, icon("image", 16), "Upload",
    h("input", { type: "file", accept: "image/*", hidden: true, onchange: async (x) => {
      const fd = new FormData(); fd.append("file", x.target.files[0]);
      try { onPick(await api("/api/admin/settings/cover", { method: "POST", form: fd })); m.close(); } catch (e) { toast(e.message, "error"); }
    } }));
  const m = modal(h("div", h("h2", "Picture"), h("div.row", { style: { marginBottom: "16px" } }, upload,
    current ? h("button.btn.small.ghost", { type: "button", onclick: () => { onPick(null); m.close(); } }, "Remove") : null), grid), { wide: true, label: "Picture" });
  api("/api/admin/photos").then((list) => clear(grid).append(list.filter((p) => p.status !== "pending").map((p) =>
    h("button.pthumb", { type: "button", onclick: () => { onPick(p); m.close(); } }, h("img", { src: media(p.thumb), alt: p.caption || "" })))))
    .catch(() => clear(grid));
}

function sheetForm(s, ev, onSaved, events) {
  s = { ...s, slots: (s.slots || []).filter((x) => !x.is_other).map((x) => ({ ...x })) };
  const rows = h("div.rows-edit");
  const evDate = ev ? ev.starts_at.slice(0, 10) : "";
  const drawRows = () => {
    clear(rows).append(s.slots.map((sl, i) => {
      const up = () => { if (i) { [s.slots[i - 1], s.slots[i]] = [s.slots[i], s.slots[i - 1]]; drawRows(); } };
      const down = () => { if (i < s.slots.length - 1) { [s.slots[i + 1], s.slots[i]] = [s.slots[i], s.slots[i + 1]]; drawRows(); } };
      const bind = (k, conv = (x) => x) => (x) => { sl[k] = conv(x.target.type === "checkbox" ? x.target.checked : x.target.value); };
      const tval = (v) => (v ? v.slice(11, 16) : "");
      const toIso = (v) => (v ? `${(sl.starts_at || sl.ends_at || evDate || isoLocal(clubNow())).slice(0, 10)}T${v}` : "");
      const pic = h("button.slot-pic", { type: "button", "aria-label": sl.image ? "Change picture" : "Add a picture", title: sl.image ? "Change picture" : "Add a picture",
        onclick: () => pickSlotImage(sl.image, (p) => { sl.image = p; sl.photo_id = p?.id || null; drawRows(); }) },
        sl.image ? h("img", { src: media(sl.image.thumb), alt: "" }) : icon("image", 18));
      return h("div.row-edit",
        h("div.mv", h("button", { type: "button", "aria-label": "Move up", onclick: up }, icon("up", 16)), h("button", { type: "button", "aria-label": "Move down", onclick: down }, icon("down", 16))),
        pic,
        h("input", { type: "text", value: sl.title, placeholder: "Slot name", "aria-label": "Slot name", oninput: bind("title") }),
        h("input", { type: "number", min: 0, value: sl.capacity || "", placeholder: "No limit", "aria-label": "How many", oninput: (x) => { sl.capacity = x.target.value === "" ? 0 : Number(x.target.value); } }),
        h("input", { type: "time", value: tval(sl.starts_at), "aria-label": "Start time", oninput: (x) => (sl.starts_at = toIso(x.target.value)) }),
        h("input", { type: "time", value: tval(sl.ends_at), "aria-label": "End time", oninput: (x) => (sl.ends_at = toIso(x.target.value)) }),
        h("label.check.center", { "data-label": "Ask what" }, h("input", { type: "checkbox", checked: sl.ask_item, "aria-label": "Ask what they're bringing", onchange: bind("ask_item") })),
        h("label.check.center", { "data-label": "Servings" }, h("input", { type: "checkbox", checked: !!sl.ask_servings, "aria-label": "Ask how many it feeds", onchange: bind("ask_servings") })),
        h("button.btn.small.ghost.items-btn", { type: "button", "aria-label": `Specific items for ${sl.title || "this slot"}`, onclick: () => editChoices(sl, drawRows) },
          (sl.choices || []).length ? h("span.items-n", sl.choices.length) : icon("plus", 14), "Items"),
        h("button.icon-btn", { type: "button", "aria-label": "Remove slot", onclick: () => { s.slots.splice(i, 1); drawRows(); } }, icon("trash", 18)));
    }));
  };
  drawRows();
  const form = h("form.stack",
    field("Title", input("title", { value: s.title, required: true, placeholder: "Bring a dish" })),
    field("Note", input("description", { value: s.description }), { optional: true }),
    events ? field("Event", sel("event_id", [["", "No event"], ...events.map((e) => [e.id, `${e.title}, ${dateCell(e.starts_at)}`])], s.event_id)) : null,
    h("div",
      h("div.row-head", h("span"), h("span"), h("span", "Slot"), h("span", "How many", hint("Leave blank for no limit.")), h("span", "Starts"), h("span", "Ends"),
        h("span", "Ask what", hint("People say what they're bringing, like a dish name. Everyone can see the list.")),
        h("span", "Servings", hint("People say about how many it feeds, so you can see if there's enough of each thing.")),
        h("span", "", hint("Optional. List specific things for this slot, like Turkey or Ham. People pick one and it shows as taken.")), h("span")),
      rows,
      h("button.btn.small.ghost", { type: "button", style: { marginTop: "12px" }, onclick: () => { s.slots.push({ title: "", capacity: 1, ask_item: false, ask_servings: false }); drawRows(); $$(".row-edit input[aria-label='Slot name']", rows).at(-1)?.focus(); } }, icon("plus", 16), "Add slot")),
    h("div.two",
      field("Status", sel("status", [["open", "Open"], ["closed", "Closed"], ["hidden", "Hidden"]], s.status)),
      field("Closes", input("closes_at", { type: "datetime-local", value: s.closes_at || "" }), { optional: true })),
    sw("show_names", "Show names publicly", s.show_names, { hintText: "Shows first name and last initial next to each slot. What people bring always shows." }),
    sw("allow_other", "Let people add something not on the list", s.allow_other, { hintText: "Adds a “Something else” row where people write in what they're bringing." }),
    h("p.form-error"),
    h("div.row.end", h("button.btn", { type: "submit" }, "Save sign-up")));
  onSubmit(form, async (v) => {
    const body = { ...v, event_id: events ? v.event_id || null : ev?.id || null, slots: s.slots };
    if (!s.slots.some((x) => x.title?.trim())) throw new Error("Add at least one slot.");
    const r = s.id ? await api(`/api/admin/sheets/${s.id}`, { method: "PUT", body }) : await api("/api/admin/sheets", { method: "POST", body });
    await onSaved(r);
  });
  return form;
}

async function sheetsList() {
  const list = await api("/api/admin/sheets");
  const body = list.length ? h("div.tbl-wrap", h("table.tbl",
    h("thead", h("tr", h("th", "Sign-up"), h("th", "Event"), h("th", "Status"), h("th.num", "Filled"))),
    h("tbody", list.map((s) => h("tr.click", { onclick: () => go(s.event_id ? `/team/events/${s.event_id}?tab=signups` : `/team/signups/${s.id}`) },
      h("td.strong", s.title), h("td", s.event ? h("span", s.event.title, h("div.sub", dateCell(s.event.starts_at))) : h("span.muted", "Standalone")),
      h("td", pill(s.closed && s.status === "open" ? "closed" : s.status)), h("td.num", `${s.filled} / ${s.capacity}`))))))
    : empty("No sign-ups yet.");
  return h("div", head("Sign-ups", { actions: [aLink("/signups/new", { class: "btn" }, icon("plus", 18), "New sign-up")] }), body);
}

async function sheetEditorPage(id) {
  const events = (await api("/api/admin/events")).filter((e) => e.starts_at >= isoLocal(clubNow()).slice(0, 10));
  if (id === "new") {
    const s = { title: "", description: "", status: "open", show_names: true, slots: [{ title: "", capacity: 1, ask_item: false }] };
    return h("div", head("New sign-up", { back: ["/signups", "Sign-ups"] }), sheetForm(s, null, (r) => {
      toast("Sign-up created"); go(r.event_id ? `/team/events/${r.event_id}?tab=signups` : `/team/signups/${r.id}`);
    }, events));
  }
  const s = await api(`/api/admin/sheets/${id}`);
  const wrap = h("div");
  const draw = async () => {
    const fresh = await api(`/api/admin/sheets/${id}`);
    clear(wrap).append(sheetCard(fresh, null, draw));
  };
  wrap.append(sheetCard(s, null, draw));
  return h("div", head(s.title, { back: ["/signups", "Sign-ups"], actions: [link(`/signups/${s.id}`, { class: "btn small ghost", target: "_blank" }, icon("external", 16), "View")] }),
    wrap,
    h("section.a-section", h("h2", "Edit"), sheetForm(s, null, () => { toast("Saved"); draw(); }, events)));
}

function rsvpTab(ev) {
  const going = ev.rsvps.filter((r) => r.status === "going");
  const total = going.reduce((a, r) => a + 1 + r.guests, 0);
  const wrap = h("div");
  const draw = () => clear(wrap).append(
    h("div.a-head", h("div", h("h2.h3", `${total} going`), h("div.a-sub", `${plural(going.length, "RSVP")}, ${total - going.length} guests`)),
      h("div.row",
        can("email") ? aLink(`/email?event=${ev.id}`, { class: "btn small ghost" }, icon("mail", 16), "Email attendees") : null,
        h("button.btn.small.ghost", { type: "button", onclick: csv(`/api/admin/events/${ev.id}/export.csv`) }, icon("download", 16), "Roster CSV"))),
    ev.rsvps.length ? h("div.tbl-wrap", h("table.tbl",
      h("thead", h("tr", h("th", "Name"), h("th", "Email"), h("th", "Status"), h("th.num", "Guests"), h("th", "When"), h("th"))),
      h("tbody", ev.rsvps.map((r) => h("tr",
        h("td.strong", r.name), h("td", h("a", { href: `mailto:${r.email}` }, r.email)), h("td", pill(r.status === "going" ? "yes" : r.status === "no" ? "closed" : "pending", r.status === "no" ? "Not going" : r.status[0].toUpperCase() + r.status.slice(1))),
        h("td.num", r.guests || "–"), h("td.sub", ago(r.created)),
        h("td.actions", h("button.icon-btn", { type: "button", "aria-label": `Remove ${r.name}`, onclick: async () => {
          if (await confirmBox(`Remove ${r.name}'s RSVP?`, { ok: "Remove" })) { await api(`/api/admin/rsvps/${r.id}`, { method: "DELETE" }); ev.rsvps.splice(ev.rsvps.indexOf(r), 1); draw(); }
        } }, icon("close", 16))))))))
      : empty("No RSVPs yet.", aLink(`/events/${ev.id}?tab=invite`, { class: "btn dark", onclick: () => setTimeout(() => $$(".tabs button").find((b) => b.dataset.t === "invite")?.click(), 0) }, "Send an invite")));
  draw();
  return wrap;
}

function inviteTab(ev) {
  return composer({ subject: `You're invited: ${ev.title}`, body: `${ev.summary || ""}\n\nRSVP on the site so we know how many to plan for.`.trim(), event_id: ev.id, audience: "subscribers", lockEvent: true });
}

// ---------- polls ----------
async function pollsList() {
  const list = await api("/api/admin/polls");
  return h("div", head("Polls", { actions: [aLink("/polls/new", { class: "btn" }, icon("plus", 18), "New poll")] }),
    list.length ? h("div.tbl-wrap", h("table.tbl",
      h("thead", h("tr", h("th", "Poll"), h("th", "Status"), h("th.num", "Responses"), h("th", "Closes"))),
      h("tbody", list.map((p) => h("tr.click", { onclick: () => go(`/team/polls/${p.id}`) },
        h("td", h("span.strong", p.title), p.event ? h("div.sub", p.event.title) : null),
        h("td", pill(p.closed && p.status === "open" ? "closed" : p.status)), h("td.num", p.responses), h("td.sub", p.closes_at ? dateCell(p.closes_at) : "–"))))))
      : empty("No polls yet.", aLink("/polls/new", { class: "btn dark" }, "New poll")));
}

async function pollEditor(id) {
  const isNew = id === "new";
  const [p, events] = await Promise.all([isNew ? null : api(`/api/admin/polls/${id}`), api("/api/admin/events")]);
  const poll = p || { title: "", intro: "", status: "open", results: "after", collect_name: true, one_per_email: true, closes_at: "", event_id: Number(query().get("event")) || null,
    questions: [{ kind: "single", prompt: "", options: ["", ""], required: true }] };
  const body = h("div");
  const tab = isNew ? "build" : query().get("tab") || (poll.responses ? "results" : "build");
  const setTab = (t) => {
    $$(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.t === t)));
    clear(body).append(t === "results" ? pollResults(poll) : pollBuilder(poll, events));
  };
  const page = h("div",
    head(isNew ? "New poll" : poll.title, { back: ["/polls", "Polls"], actions: isNew ? null : [
      h("button.btn.small.ghost", { type: "button", onclick: () => copy(location.origin + (CFG.hashRouting ? location.pathname + "#" : "") + `/polls/${poll.slug}`) }, icon("link", 16), "Copy link"),
      link(`/polls/${poll.slug}`, { class: "btn small ghost", target: "_blank" }, icon("external", 16), "View"),
      h("button.btn.small.ghost", { type: "button", onclick: async () => {
        if (await confirmBox(`Delete “${poll.title}” and its ${plural(poll.responses, "response")}?`)) { await api(`/api/admin/polls/${id}`, { method: "DELETE" }); toast("Poll deleted"); go("/team/polls"); }
      } }, icon("trash", 16), "Delete")] }),
    isNew ? null : h("div.tabs", { role: "tablist" }, [["build", "Questions"], ["results", "Results", poll.responses]].map(([t, l, n]) =>
      h("button", { type: "button", role: "tab", "data-t": t, "aria-selected": String(t === tab), onclick: () => setTab(t) }, l, n != null ? h("span.n", n) : null))),
    body);
  setTab(tab);
  return page;
}

// Polls tied to this event. A poll can also stand on its own; those can be added here.
function eventPolls(ev) {
  const wrap = h("div", loading());
  const draw = async () => {
    const all = await api("/api/admin/polls");
    const linked = all.filter((p) => p.event_id === ev.id);
    const loose = all.filter((p) => !p.event_id);
    ev.polls = linked;
    const n = $(".tabs button[data-t=polls] .n");
    if (n) n.textContent = linked.length;
    const link_ = async (p, eventId) => {
      await api(`/api/admin/polls/${p.id}`, { method: "PATCH", body: { event_id: eventId } });
      toast(eventId ? "Poll added to this event" : "Poll is on its own now");
      draw();
    };
    const add = loose.length ? h("select.poll-add", { "aria-label": "Add a poll that's on its own", onchange: (e) => e.target.value && link_(loose.find((p) => String(p.id) === e.target.value), ev.id) },
      h("option", { value: "" }, "Add an existing poll"), loose.map((p) => h("option", { value: p.id }, p.title))) : null;
    clear(wrap).append(
      h("div.a-toolbar", h("span"), h("div.row", add, aLink(`/polls/new?event=${ev.id}`, { class: "btn" }, icon("plus", 18), "New poll"))),
      linked.length ? h("div.tbl-wrap", h("table.tbl",
        h("thead", h("tr", h("th", "Poll"), h("th", "Status"), h("th.num", "Responses"), h("th", "Closes"), h("th"))),
        h("tbody", linked.map((p) => h("tr.click", { onclick: (e) => !e.target.closest("button") && go(`/team/polls/${p.id}`) },
          h("td", h("span.strong", p.title)),
          h("td", pill(p.closed && p.status === "open" ? "closed" : p.status)), h("td.num", p.responses), h("td.sub", p.closes_at ? dateCell(p.closes_at) : "–"),
          h("td.actions", h("button.icon-btn", { type: "button", "aria-label": `Take ${p.title} off this event`, title: "Take off this event", onclick: () => link_(p, null) }, icon("close", 16))))))))
        : empty("No polls for this event yet."));
  };
  draw().catch((e) => clear(wrap).append(h("p.form-error", e.message)));
  return wrap;
}

// Event picker for a poll: on its own, or one event (upcoming first, then past).
function eventPicker(events, value) {
  const now = isoLocal(clubNow());
  const opt = (e) => h("option", { value: e.id, selected: String(e.id) === String(value ?? "") }, `${e.title}, ${dateCell(e.starts_at)}`);
  const up = events.filter((e) => e.starts_at >= now).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const past = events.filter((e) => e.starts_at < now).sort((a, b) => b.starts_at.localeCompare(a.starts_at));
  return h("select", { name: "event_id" }, h("option", { value: "", selected: !value }, "None, it stands on its own"),
    up.length ? h("optgroup", { label: "Upcoming" }, up.map(opt)) : null, past.length ? h("optgroup", { label: "Past" }, past.map(opt)) : null);
}

function pollBuilder(poll, events) {
  const qs = poll.questions.map((q) => ({ ...q, options: [...(q.options || [])] }));
  const list = h("div");
  const draw = () => {
    clear(list).append(qs.map((q, i) => {
      const opts = h("div.list-edit");
      const drawOpts = () => clear(opts).append(
        q.options.map((o, j) => h("div.opt-edit", h("span.mk", { class: q.kind === "multi" ? "sq" : "" }),
          h("input", { value: o, placeholder: `Choice ${j + 1}`, "aria-label": `Choice ${j + 1}`, oninput: (x) => (q.options[j] = x.target.value),
            onkeydown: (x) => { if (x.key === "Enter") { x.preventDefault(); q.options.splice(j + 1, 0, ""); drawOpts(); $$("input", opts)[j + 1]?.focus(); } } }),
          h("button.icon-btn", { type: "button", "aria-label": "Remove choice", onclick: () => { q.options.splice(j, 1); drawOpts(); } }, icon("close", 16)))),
        h("div.opt-edit", h("span"), h("button.btn.small.ghost", { type: "button", style: { justifySelf: "start" }, onclick: () => { q.options.push(""); drawOpts(); $$("input", opts).at(-1)?.focus(); } }, icon("plus", 16), "Add choice")));
      if (q.kind === "single" || q.kind === "multi") drawOpts();
      return h("div.qcard",
        h("div.qcard-top", h("span.n", i + 1),
          h("input", { value: q.prompt, placeholder: "Question", "aria-label": `Question ${i + 1}`, oninput: (x) => (q.prompt = x.target.value) }),
          sel("", Q_KINDS, q.kind, { "aria-label": "Question type", onchange: (x) => { q.kind = x.target.value; if ((q.kind === "single" || q.kind === "multi") && q.options.length < 2) q.options = ["", ""]; draw(); } }),
          h("div.row", { style: { gap: "2px", flexWrap: "nowrap" } },
            h("button.icon-btn", { type: "button", "aria-label": "Move up", disabled: i === 0, onclick: () => { [qs[i - 1], qs[i]] = [qs[i], qs[i - 1]]; draw(); } }, icon("up", 18)),
            h("button.icon-btn", { type: "button", "aria-label": "Move down", disabled: i === qs.length - 1, onclick: () => { [qs[i + 1], qs[i]] = [qs[i], qs[i + 1]]; draw(); } }, icon("down", 18)),
            h("button.icon-btn", { type: "button", "aria-label": "Delete question", onclick: () => { qs.splice(i, 1); draw(); } }, icon("trash", 18)))),
        q.kind === "single" || q.kind === "multi" ? h("div", { style: { paddingLeft: "0" } }, opts) : h("div.qcard-foot", { style: { justifyContent: "flex-start" } }, h("span.muted.small", q.kind === "rating" ? "People pick 1 to 5." : "People type an answer.")),
        h("div.qcard-foot", h("span"), sw("", "Required", q.required, { onchange: (x) => (q.required = x.target.checked) })));
    }),
    h("div.add-q", Q_KINDS.map(([k, t]) => h("button.btn.small.ghost", { type: "button", onclick: () => { qs.push({ kind: k, prompt: "", options: k === "single" || k === "multi" ? ["", ""] : [], required: true }); draw(); $$(".qcard input", list).filter((x) => x.getAttribute("aria-label")?.startsWith("Question")).at(-1)?.focus(); } }, icon("plus", 16), t))));
  };
  draw();
  const statusSeg = h("div.seg");
  let status = poll.status;
  const drawStatus = () => clear(statusSeg).append([["draft", "Draft"], ["open", "Open"], ["closed", "Closed"]].map(([v, t]) => h("button", { type: "button", "aria-pressed": String(status === v), onclick: () => { status = v; drawStatus(); } }, t)));
  drawStatus();
  const form = h("form",
    field("Title", input("title", { value: poll.title, required: true, placeholder: "Holiday party: pick the theme" })),
    field("Intro", input("intro", { value: poll.intro }), { optional: true }),
    h("div", { style: { marginTop: "12px" } }, list),
    h("p.form-error"),
    null);
  form.id = "poll-form";
  const panel = h("div.panel",
    h("div.panel-block", h("span.field-label", "Status"), statusSeg),
    h("div.panel-block",
      field("Results", sel("results", [["after", "Show after the poll closes"], ["public", "Show right after voting"], ["admin", "Only admins"]], poll.results)),
      field("Closes", input("closes_at", { type: "datetime-local", value: poll.closes_at || "" }), { optional: true }),
      field("Event", eventPicker(events, poll.event_id), { optional: true, hintText: "Linked polls show on the event's page. Every poll still shows on the Polls page." })),
    h("div.panel-block",
      sw("collect_name", "Ask for name and email", poll.collect_name),
      sw("one_per_email", "One response per email", poll.one_per_email, { hintText: "Sending again updates the earlier answers." })));
  onSubmit(form, async (v) => {
    const body = { title: v.title, intro: v.intro, status, results: $("[name=results]", panel).value, closes_at: $("[name=closes_at]", panel).value,
      event_id: $("[name=event_id]", panel).value || null, collect_name: $("[name=collect_name]", panel).checked, one_per_email: $("[name=one_per_email]", panel).checked,
      questions: qs.map((q) => ({ ...q, options: q.options.filter((o) => o.trim()) })) };
    if (poll.id) {
      await api(`/api/admin/polls/${poll.id}`, { method: "PUT", body });
      toast("Poll saved");
    } else {
      const r = await api("/api/admin/polls", { method: "POST", body });
      toast("Poll created");
      go(`/team/polls/${r.id}?tab=build`);
    }
  });
  return h("div.editor", form, panel, h("div.savebar", h("button.btn", { type: "submit", form: "poll-form" }, poll.id ? "Save poll" : "Create poll")));
}

function pollResults(poll) {
  if (!poll.responses) return empty("No responses yet.", h("button.btn.dark", { type: "button", onclick: () => copy(location.origin + `/polls/${poll.slug}`) }, icon("link", 18), "Copy poll link"));
  return h("div",
    h("div.a-head", h("h2.h3", plural(poll.responses, "response")), h("button.btn.small.ghost", { type: "button", onclick: csv(`/api/admin/polls/${poll.id}/export.csv`) }, icon("download", 16), "Responses CSV")),
    h("div", { style: { maxWidth: "760px" } }, results(poll.tally)));
}

// ---------- gallery ----------
async function galleryAdmin() {
  const [photos, events, tags] = await Promise.all([api("/api/admin/photos"), api("/api/admin/events"), api("/api/admin/tags")]);
  const st = { show: query().get("show") || (photos.some((p) => p.status === "pending") ? "pending" : "all"), selected: new Set() };
  const evOpts = [["", "No event"], ...events.map((e) => [e.id, `${e.title}, ${dateCell(e.starts_at)}`])];
  const body = h("div");
  const bulk = h("div");
  const grid = h("div.pgrid");
  const reload = async () => { const fresh = await api("/api/admin/photos"); photos.splice(0, photos.length, ...fresh); st.selected.clear(); draw(); refreshCounts(); };

  // uploader
  const files = [];
  const thumbs = h("div.thumbs");
  const fi = h("input", { type: "file", accept: "image/*", multiple: true, hidden: true, onchange: (e) => add(e.target.files) });
  const drop = h("div.dropzone", { tabindex: 0, role: "button", onclick: () => fi.click(), onkeydown: (e) => (e.key === "Enter" || e.key === " ") && fi.click() },
    icon("image", 28), h("b", "Add photos"), h("span.small", "Drop images here or choose them"));
  const add = (list) => { for (const f of list) if (f.type.startsWith("image/")) { files.push(f); thumbs.append(h("img", { src: URL.createObjectURL(f), alt: "" })); } drop.querySelector("b").textContent = files.length ? plural(files.length, "photo") + " ready" : "Add photos"; };
  ["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => add(e.dataTransfer.files));
  const upTags = new Set();
  const upTagBox = h("div.chips-edit");
  const drawUpTags = () => clear(upTagBox).append(tags.map((t) => tagChip(t, { active: upTags.has(t.id), onclick: () => { upTags.has(t.id) ? upTags.delete(t.id) : upTags.add(t.id); drawUpTags(); } })));
  drawUpTags();
  const upForm = h("form.stack",
    field("Event", sel("event_id", evOpts, ""), { hintText: "Photos pick up the event's tags automatically." }),
    h("div", h("span.field-label", { style: { marginBottom: "8px" } }, "Tags"), upTagBox),
    h("p.form-error"),
    h("button.btn", { type: "submit" }, "Upload"));
  onSubmit(upForm, async (v) => {
    if (!files.length) throw new Error("Add some photos first.");
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    fd.append("event_id", v.event_id); fd.append("tag_ids", [...upTags].join(","));
    const r = await api("/api/admin/photos", { method: "POST", form: fd });
    files.length = 0; clear(thumbs); drop.querySelector("b").textContent = "Add photos";
    toast(`${plural(r.ids.length, "photo")} added` + (r.errors.length ? `, ${r.errors.length} skipped` : ""));
    st.show = "all"; reload();
  });

  function draw() {
    const counts = { all: photos.filter((p) => p.status === "approved").length, pending: photos.filter((p) => p.status === "pending").length, hidden: photos.filter((p) => p.status === "hidden").length };
    const list = photos.filter((p) => st.show === "all" ? p.status === "approved" : p.status === st.show);
    clear(body).append(h("div.row", { style: { justifyContent: "space-between", marginBottom: "18px" } },
      h("div.seg", [["all", "Published"], ["pending", "To review"], ["hidden", "Hidden"]].map(([v, t]) =>
        h("button", { type: "button", "aria-pressed": String(st.show === v), onclick: () => { st.show = v; st.selected.clear(); draw(); } }, t, h("span", { style: { opacity: .6 } }, counts[v])))),
      list.length ? h("button.btn.small.ghost", { type: "button", onclick: () => { list.forEach((p) => st.selected.add(p.id)); draw(); } }, "Select all") : null));
    clear(bulk);
    if (st.selected.size) {
      const ids = [...st.selected];
      const act = async (action, extra = {}) => { await api("/api/admin/photos/bulk", { method: "POST", body: { ids, action, ...extra } }); toast("Updated"); reload(); };
      bulk.append(h("div.bulk",
        h("b", `${st.selected.size} selected`),
        st.show !== "all" ? h("button.btn.small", { type: "button", onclick: () => act("approved") }, "Publish") : null,
        st.show !== "hidden" ? h("button.btn.small.ghost", { type: "button", onclick: () => act("hidden") }, "Hide") : null,
        sel("", [["", "Add tag…"], ...tags.map((t) => [t.id, t.name])], "", { "aria-label": "Add tag", onchange: (e) => e.target.value && act("tag", { tag_ids: [e.target.value] }) }),
        sel("", [["", "Set event…"], ["0", "No event"], ...events.map((e) => [e.id, e.title])], "", { "aria-label": "Set event", onchange: (e) => e.target.value && act("event", { event_id: Number(e.target.value) || null }) }),
        h("button.btn.small.ghost", { type: "button", onclick: async () => { if (await confirmBox(`Delete ${plural(ids.length, "photo")}? This can't be undone.`)) act("delete"); } }, icon("trash", 16), "Delete"),
        h("button.icon-btn", { type: "button", "aria-label": "Clear selection", style: { color: "#fff", marginLeft: "auto" }, onclick: () => { st.selected.clear(); draw(); } }, icon("close"))));
    }
    clear(grid);
    if (!list.length) grid.append(h("p.muted", st.show === "pending" ? "Nothing to review." : "No photos here."));
    list.forEach((p) => {
      const on = st.selected.has(p.id);
      grid.append(h("button.pthumb", { type: "button", class: (on ? "on " : "") + (p.status === "hidden" ? "hidden" : ""), "aria-pressed": String(on),
        onclick: (e) => { if (st.selected.size || e.shiftKey || e.metaKey) { on ? st.selected.delete(p.id) : st.selected.add(p.id); draw(); } else editPhoto(p); } },
        h("img", { src: media(p.thumb), alt: p.caption || "", loading: "lazy" }),
        h("span.sel", { onclick: (e) => { e.stopPropagation(); on ? st.selected.delete(p.id) : st.selected.add(p.id); draw(); } }, icon("check")),
        p.status === "pending" ? pill("pending", "Review") : null));
    });
  }
  function editPhoto(p) {
    const ptags = new Set(p.tag_ids);
    const box = h("div.chips-edit");
    const dt = () => clear(box).append(tags.map((t) => tagChip(t, { active: ptags.has(t.id), onclick: () => { ptags.has(t.id) ? ptags.delete(t.id) : ptags.add(t.id); dt(); } })));
    dt();
    const form = h("form",
      h("img", { src: media(p.src), alt: "", style: { borderRadius: "10px", maxHeight: "46vh", width: "100%", objectFit: "contain", background: "var(--mist)" } }),
      p.submitted_by && p.status === "pending" ? h("p.muted.small", { style: { margin: 0 } }, `Shared by ${p.submitted_by}`) : null,
      field("Caption", input("caption", { value: p.caption }), { optional: true }),
      field("Event", sel("event_id", evOpts, p.event_id)),
      h("div", h("span.field-label", { style: { marginBottom: "8px" } }, "Tags"), box),
      field("Status", sel("status", [["approved", "Published"], ["pending", "To review"], ["hidden", "Hidden"]], p.status)),
      h("p.form-error"),
      h("div.row.end",
        h("button.btn.ghost", { type: "button", onclick: async () => { if (await confirmBox("Delete this photo?")) { await api("/api/admin/photos/bulk", { method: "POST", body: { ids: [p.id], action: "delete" } }); m.close(); reload(); } } }, "Delete"),
        h("button.btn", { type: "submit" }, "Save")));
    onSubmit(form, async (v) => {
      await api(`/api/admin/photos/${p.id}`, { method: "PUT", body: { ...v, event_id: v.event_id || null, tag_ids: [...ptags] } });
      m.close(); toast("Photo saved"); reload();
    });
    const m = modal(h("div", h("h2", "Photo"), form), { label: "Edit photo" });
  }
  draw();
  return h("div", head("Gallery"),
    h("div.upload-row", h("div.stack", drop, fi, thumbs), upForm),
    body, bulk, grid);
}

// ---------- messages ----------
async function inbox() {
  const list = await api("/api/admin/messages");
  const st = { id: list.find((m) => !m.archived)?.id, archived: false };
  const listEl = h("div.inbox-list");
  const read = h("div.inbox-read");
  const draw = () => {
    const shown = list.filter((m) => !!m.archived === st.archived);
    clear(listEl).append(shown.length ? shown.map((m) => h("button.inbox-item", { type: "button", class: m.read ? "" : "unread", "aria-selected": String(m.id === st.id), onclick: () => open(m) },
      h("b", m.name, h("time", ago(m.created))), h("div.s", m.subject || "No subject"), h("div.p", m.body))) : h("p.muted", { style: { padding: "20px 0" } }, st.archived ? "Nothing archived." : "Inbox zero."));
    const cur = list.find((m) => m.id === st.id && !!m.archived === st.archived);
    clear(read).append(cur ? h("div",
      h("h2", cur.subject || "No subject"),
      h("div.from", h("b", { style: { color: "var(--ink)" } }, cur.name), ` <${cur.email}>, ${longDate(parse(cur.created))} at ${time(parse(cur.created))}`),
      h("div.body", cur.body),
      h("div.row",
        h("a.btn", { href: `mailto:${cur.email}?subject=${encodeURIComponent("Re: " + (cur.subject || "Your message"))}` }, icon("mail", 18), "Reply"),
        h("button.btn.ghost", { type: "button", onclick: async () => { await api(`/api/admin/messages/${cur.id}`, { method: "PUT", body: { archived: !cur.archived } }); cur.archived = cur.archived ? 0 : 1; st.id = null; draw(); } }, cur.archived ? "Move to inbox" : "Archive"),
        h("button.btn.ghost", { type: "button", onclick: async () => { if (await confirmBox("Delete this message?")) { await api(`/api/admin/messages/${cur.id}`, { method: "DELETE" }); list.splice(list.indexOf(cur), 1); st.id = null; draw(); } } }, "Delete")))
      : h("p.muted", "Pick a message."));
  };
  const open = async (m) => {
    st.id = m.id;
    if (!m.read) { m.read = 1; api(`/api/admin/messages/${m.id}`, { method: "PUT", body: { read: true } }).then(refreshCounts); }
    draw();
  };
  const first = list.find((m) => m.id === st.id);
  if (first && !first.read) open(first); else draw();
  const seg = h("div.seg", [[false, "Inbox"], [true, "Archived"]].map(([v, t]) => h("button", { type: "button", "aria-pressed": String(st.archived === v), onclick: (e) => { st.archived = v; st.id = null; $$("button", seg).forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget))); draw(); } }, t)));
  return h("div", head("Messages", { actions: [seg] }), h("div.inbox", listEl, read));
}

// ---------- people ----------
async function people() {
  const list = await api("/api/admin/people");
  const tbody = h("tbody");
  let q = "";
  const draw = () => {
    const shown = list.filter((p) => !q || (p.name || "").toLowerCase().includes(q) || p.email.includes(q));
    clear(tbody).append(shown.map((p) => h("tr",
      h("td", h("span.strong", p.name || "–"), h("div.sub", p.email)),
      h("td.num", p.events || "–"), h("td.num", p.signups || "–"),
      h("td", h("label.switch", { style: { justifyContent: "flex-start" } }, h("input", { type: "checkbox", checked: !!p.active, "aria-label": `${p.email} on mailing list`, onchange: async (e) => {
        await api("/api/admin/people", { method: "PUT", body: { email: p.email, name: p.name, active: e.target.checked } }); p.active = e.target.checked ? 1 : 0;
        toast(e.target.checked ? "Added to the list" : "Removed from the list");
      } }))),
      h("td.actions", h("button.icon-btn", { type: "button", "aria-label": `Delete ${p.name || p.email}`, title: "Delete", onclick: async () => {
        const who = p.name || p.email;
        if (!(await confirmBox(`Delete ${who}? This erases their name and email from the mailing list, RSVPs, sign-ups, and messages. It can't be undone.`))) return;
        await api("/api/admin/people/delete", { method: "POST", body: { email: p.email } });
        list.splice(list.indexOf(p), 1); draw(); toast(`${who} deleted`);
      } }, icon("trash", 16))))));
  };
  draw();
  const addForm = h("form.stack",
    field("Emails", h("textarea", { name: "emails", rows: 5, placeholder: "kalani@example.com\nMaria Santos <maria@example.com>" }), { hintText: "One per line, or separated by commas." }),
    h("div.row.end", h("button.btn", { type: "submit" }, "Add to list")));
  onSubmit(addForm, async (v) => {
    const r = await api("/api/admin/people", { method: "POST", body: v });
    m?.close(); toast(`${plural(r.added, "person", "people")} added`); go("/team/people", { replace: true });
  });
  let m;
  const active = list.filter((p) => p.active).length;
  return h("div",
    head("People", { sub: `${active} on the mailing list, ${list.length} total`, actions: [
      h("button.btn.small.ghost", { type: "button", onclick: csv("/api/admin/people/export.csv") }, icon("download", 16), "CSV"),
      h("button.btn", { type: "button", onclick: () => (m = modal(h("div", h("h2", "Add people"), addForm), { label: "Add people" })) }, icon("plus", 18), "Add people")] }),
    h("input.search", { type: "search", placeholder: "Search", "aria-label": "Search people", style: { marginBottom: "16px" }, oninput: (e) => { q = e.target.value.toLowerCase(); draw(); } }),
    h("div.tbl-wrap", h("table.tbl", h("thead", h("tr", h("th", "Person"), h("th.num", "RSVPs"), h("th.num", "Sign-ups"), h("th", "Mailing list", hint("People on the list get announcements and invites. Everyone still gets confirmations and reminders for what they join.")),
      h("th", h("span.visually-hidden", "Delete")))), tbody)));
}

// ---------- email ----------
function composer({ subject = "", body = "", event_id = null, audience = "subscribers", lockEvent = false, events = [] } = {}) {
  const st = { type: audience, count: null };
  const countEl = h("span.muted.small");
  const audBox = h("div.stack");
  const form = h("form.stack");
  const spec = () => ({ type: st.type, event_id: st.type === "event" ? (lockEvent ? event_id : $("[name=aud_event]", form)?.value) : null, emails: $("[name=aud_emails]", form)?.value });
  const recount = async () => {
    try { const r = await api("/api/admin/email/preview", { method: "POST", body: { audience: spec() } }); countEl.textContent = `Goes to ${plural(r.count, "person", "people")}`; }
    catch { countEl.textContent = ""; }
  };
  const drawAud = () => {
    clear(audBox).append(
      h("div.seg", [["subscribers", "Mailing list"], ["everyone", "Everyone"], ["event", lockEvent ? "This event's attendees" : "Event attendees"], ["custom", "Specific people"]].map(([v, t]) =>
        h("button", { type: "button", "aria-pressed": String(st.type === v), onclick: () => { st.type = v; drawAud(); } }, t))),
      st.type === "event" && !lockEvent ? field("Event", sel("aud_event", events.map((e) => [e.id, `${e.title}, ${dateCell(e.starts_at)}`]), event_id, { onchange: recount })) : null,
      st.type === "custom" ? field("Emails", h("textarea", { name: "aud_emails", rows: 3, oninput: recount })) : null,
      st.type === "everyone" ? h("p.muted.small", { style: { margin: 0 } }, "The mailing list plus anyone who has RSVPed or signed up, minus people who unsubscribed.") : null,
      countEl);
    recount();
  };
  form.append(
    h("div", h("span.field-label", { style: { marginBottom: "8px" } }, "To"), audBox),
    lockEvent ? null : field("Attach an event", sel("event_id", [["", "None"], ...events.map((e) => [e.id, `${e.title}, ${dateCell(e.starts_at)}`])], event_id),
      { optional: true, hintText: "Adds the date, place, an RSVP button, and a calendar file." }),
    field("Subject", input("subject", { value: subject, required: true })),
    field("Message", h("textarea", { name: "body", rows: 9, required: true }, body), { hintText: "Blank lines start new paragraphs." }),
    h("p.form-error"),
    h("div.row.end", h("button.btn", { type: "submit" }, icon("send", 18), "Send")));
  drawAud();
  onSubmit(form, async (v) => {
    const payload = { subject: v.subject, body: v.body, audience: spec(), event_id: lockEvent ? event_id : v.event_id || null };
    const n = countEl.textContent.replace("Goes to ", "");
    if (!(await confirmBox(`Send “${v.subject}” to ${n}?`, { ok: "Send", danger: false }))) return;
    const r = await api("/api/admin/email/send", { method: "POST", body: payload });
    toast(r.smtp_ready ? `Sending to ${plural(r.queued, "person", "people")}` : `Saved ${plural(r.queued, "email")}. They send once email is set up.`);
    form.reset();
  });
  return h("div", { style: { maxWidth: "760px" } }, form);
}

async function emailPage() {
  const [events, outbox, s] = await Promise.all([api("/api/admin/events"), api("/api/admin/outbox"), api("/api/admin/settings")]);
  const upcoming = events.filter((e) => e.starts_at >= isoLocal(clubNow()).slice(0, 10) && e.status === "published").reverse();
  const q = query();
  const pre = q.get("event");
  const held = outbox.filter((o) => o.status === "held" || o.status === "failed").length;
  const out = h("div.tbl-wrap", outbox.length ? h("table.tbl",
    h("thead", h("tr", h("th", "To"), h("th", "Subject"), h("th", "Type"), h("th", "Status"), h("th", "When"))),
    h("tbody", outbox.slice(0, 100).map((o) => h("tr.click", { onclick: async () => {
      const full = await api(`/api/admin/outbox/${o.id}`);
      const frame = h("iframe.preview-frame", { title: "Email preview", sandbox: "" });
      frame.srcdoc = full.html;
      modal(h("div", h("h2", full.subject), full.error ? h("div.callout", icon("info"), full.error) : null, frame), { wide: true, label: "Email preview" });
    } },
      h("td", o.to_email), h("td.strong", o.subject), h("td.sub", o.kind), h("td", pill(o.status, o.status === "held" ? "Waiting" : null)), h("td.sub", ago(o.created))))))
    : h("p.muted", "Nothing sent yet."));
  return h("div",
    head("Email"),
    !s.smtp_ready ? h("div.callout", icon("info"), h("span", "Email isn't connected yet, so messages wait in the outbox. ", aLink("/settings#email", {}, "Set up email"))) : null,
    composer({ events: upcoming, audience: pre ? "event" : "subscribers", event_id: pre ? Number(pre) : null }),
    h("section.a-section",
      h("h2", "Outbox", h("div.row",
        held && s.smtp_ready ? h("button.btn.small", { type: "button", onclick: async () => { await api("/api/admin/outbox/retry", { method: "POST" }); toast("Sending"); go("/team/email", { replace: true }); } }, `Send ${held} waiting`) : null,
        held ? h("button.btn.small.ghost", { type: "button", onclick: async () => { if (await confirmBox(`Discard ${plural(held, "unsent email")}?`, { ok: "Discard" })) { await api("/api/admin/outbox/clear", { method: "POST" }); go("/team/email", { replace: true }); } } }, "Discard waiting") : null)),
      out));
}

// ---------- settings ----------
async function settings() {
  const [s, events, polls] = await Promise.all([api("/api/admin/settings"), api("/api/admin/events"), api("/api/admin/polls")]);
  const save = async (patch, msg = "Saved") => { Object.assign(s, await api("/api/admin/settings", { method: "PUT", body: patch })); toast(msg); refreshSite(); };
  const sec = (id, title, body, hintText) => h("section.settings-sec", { id }, h("div", h("h2", title, hintText ? hint(hintText) : null)), body);

  // club
  let accent = s.accent || "";
  let palette = s.palette || "classic";
  const PAL = { classic: ["Red, white & blue", "#0F2340", "#C8233B", "#F4ECD6"], ocean: ["Ocean", "#0B4552", "#C2185B", "#FFF1D6"] };
  const palBox = h("div.palettes");
  const preview = () => import("./app.js").then((A) => A.applyTheme({ palette, accent }));
  const drawPal = () => clear(palBox).append(Object.entries(PAL).map(([k, [name, night, acc, moon]]) =>
    h("button.palette", { type: "button", "aria-pressed": String(palette === k), onclick: () => { palette = k; accent = ""; drawPal(); drawSw(); preview(); } },
      h("span.palette-chip", { style: { background: night } }, h("i", { style: { background: moon } }), h("i", { style: { background: acc } })), name)));
  const swatches = h("div.swatches");
  const drawSw = () => clear(swatches).append(ACCENTS.map(([c, n]) => h("button.swatch", { type: "button",
    style: { "--c": c || PAL[palette][2] }, class: c ? "" : "theme-default", "aria-label": n, title: n, "aria-pressed": String(accent.toLowerCase() === c.toLowerCase()),
    onclick: () => { accent = c; drawSw(); preview(); } })));
  drawPal();
  drawSw();
  const club = h("form",
    h("div.two", field("Club name", input("club_name", { value: s.club_name, required: true })), field("Organization", input("org_line", { value: s.org_line }), { optional: true })),
    h("div.two", field("Club email", input("email", { type: "email", value: s.email }), { hintText: "Contact form messages go here. Replies to club emails go here too." }),
      field("Site address", input("site_url", { type: "url", value: s.site_url, placeholder: "https://mahinaclub.org" }), { hintText: "Used for links inside emails." })),
    field("Time zone", sel("timezone", [["Pacific/Honolulu", "Hawaiʻi"], ["America/Los_Angeles", "Pacific"], ["America/Denver", "Mountain"], ["America/Chicago", "Central"], ["America/New_York", "Eastern"], ["Asia/Tokyo", "Japan"], ["Pacific/Guam", "Guam"]], s.timezone)),
    h("div", h("span.field-label", { style: { marginBottom: "8px" } }, "Colors"), palBox),
    h("div", h("span.field-label", { style: { marginBottom: "8px" } }, "Button color", hint("Theme color follows the colors above. Pick another to override it.")), swatches),
    field("Footer notice", h("textarea", { name: "disclaimer", rows: 3 }, s.disclaimer), { hintText: "Private organizations on an installation usually need this statement." }),
    h("div", h("button.btn", { type: "submit" }, "Save")));
  onSubmit(club, (v) => save({ ...v, accent, palette }));

  // home
  const open = polls.filter((p) => p.status === "open");
  const upcoming = events.filter((e) => e.starts_at >= isoLocal(clubNow()) && e.status === "published").reverse();
  const spot = s.spotlight || { kind: "next" };
  const spotVal = spot.kind === "event" ? `event:${spot.id}` : spot.kind === "poll" ? `poll:${spot.id}` : spot.kind;
  const SECTIONS = { coming: "Coming up", photos: "Photos", polls: "Polls", give: "Fundraising goal" };
  const secs = (s.home_sections || []).map((x) => ({ ...x }));
  const secBox = h("div.list-edit.sections-edit");
  const drawSecs = () => clear(secBox).append(secs.map((x, i) => h("div.li",
    h("label.switch", { style: { justifyContent: "flex-start", gap: "14px" } },
      h("input", { type: "checkbox", role: "switch", checked: x.on, onchange: (e) => (x.on = e.target.checked) }), SECTIONS[x.key] || x.key),
    h("span.row", { style: { gap: "2px", flexWrap: "nowrap" } },
      h("button.icon-btn", { type: "button", "aria-label": `Move ${SECTIONS[x.key]} up`, disabled: i === 0, onclick: () => { [secs[i - 1], secs[i]] = [secs[i], secs[i - 1]]; drawSecs(); } }, icon("up", 18)),
      h("button.icon-btn", { type: "button", "aria-label": `Move ${SECTIONS[x.key]} down`, disabled: i === secs.length - 1, onclick: () => { [secs[i + 1], secs[i]] = [secs[i], secs[i + 1]]; drawSecs(); } }, icon("down", 18))))));
  drawSecs();
  const bannerLink = linkPicker(s.banner?.link || "", { name: "banner_link", label: "Banner link" });
  const home = h("form",
    field("Featured at the top", sel("spot", [["next", "The next event"], ...upcoming.map((e) => [`event:${e.id}`, `Event: ${e.title}`]), ...open.map((p) => [`poll:${p.id}`, `Poll: ${p.title}`]), ["give", "Fundraising goal"], ["none", "Nothing"]], spotVal)),
    h("div", h("span.field-label", { style: { marginBottom: "8px" } }, "Sections", hint("Turn sections on or off and set their order. You can also do this on the home page with Edit page.")), secBox),
    h("div.two", field("Banner text", input("banner_text", { value: s.banner?.text || "", placeholder: "Potluck sign-ups are open" }), { optional: true }),
      h("label.field", h("span.field-label", "Banner link", h("span.optional", " optional")), bannerLink.el)),
    sw("banner_active", "Show the banner", s.banner?.active),
    sw("moon_caption", "Show tonight's moon name", s.moon_caption, { hintText: "The Hawaiian name for tonight's moon, under the moon on the home page." }),
    h("div", h("button.btn", { type: "submit" }, "Save")));
  onSubmit(home, (v) => {
    const [kind, id] = v.spot.split(":");
    return save({ spotlight: { kind, id: id ? Number(id) : null }, home_sections: secs, moon_caption: v.moon_caption,
      banner: { text: v.banner_text, link: bannerLink.get(), active: v.banner_active } });
  });

  // give
  const uses = [...(s.donate_uses || [])];
  const usesBox = h("div.list-edit");
  const drawUses = () => clear(usesBox).append(uses.map((u, i) => h("div.li", h("input", { value: u, "aria-label": `Use ${i + 1}`, oninput: (e) => (uses[i] = e.target.value) }),
    h("button.icon-btn", { type: "button", "aria-label": "Remove", onclick: () => { uses.splice(i, 1); drawUses(); } }, icon("close", 16)))),
    h("div", h("button.btn.small.ghost", { type: "button", onclick: () => { uses.push(""); drawUses(); } }, icon("plus", 16), "Add")));
  drawUses();
  const g = s.donate_goal || {};
  const give = h("form",
    field("Venmo handle", input("venmo", { value: s.venmo, placeholder: "MahinaClub" }), { hintText: "Without the @. Leave blank to hide the Give page." }),
    field("Goal name", input("goal_label", { value: g.label || "", placeholder: "Holiday party fund" }), { optional: true }),
    h("div.two", field("Goal amount", input("goal", { type: "number", min: 0, value: g.goal || "" }), { optional: true }),
      field("Raised so far", input("raised", { type: "number", min: 0, value: g.raised || "" }), { hintText: "Update this by hand as money comes in." })),
    h("div", h("span.field-label", { style: { marginBottom: "8px" } }, "Where it goes"), usesBox),
    h("div", h("button.btn", { type: "submit" }, "Save")));
  onSubmit(give, (v) => save({ venmo: v.venmo.replace(/^@/, "").trim(), donate_goal: { label: v.goal_label, goal: Number(v.goal) || 0, raised: Number(v.raised) || 0 }, donate_uses: uses.filter((u) => u.trim()) }));

  // officers
  const off = (s.officers || []).map((o) => ({ ...o }));
  const offBox = h("div.list-edit");
  const drawOff = () => clear(offBox).append(off.map((o, i) => h("div.li.three",
    h("input", { value: o.role, placeholder: "Role", "aria-label": "Role", oninput: (e) => (o.role = e.target.value) }),
    h("input", { value: o.name, placeholder: "Name", "aria-label": "Name", oninput: (e) => (o.name = e.target.value) }),
    h("input", { value: o.email, type: "email", placeholder: "Email (optional)", "aria-label": "Email", oninput: (e) => (o.email = e.target.value) }),
    h("button.icon-btn", { type: "button", "aria-label": "Remove", onclick: () => { off.splice(i, 1); drawOff(); } }, icon("close", 16)))),
    h("div", h("button.btn.small.ghost", { type: "button", onclick: () => { off.push({ role: "", name: "", email: "" }); drawOff(); } }, icon("plus", 16), "Add officer")));
  drawOff();
  const officers = h("form", offBox, h("div", h("button.btn", { type: "submit" }, "Save")));
  onSubmit(officers, () => save({ officers: off.filter((o) => o.name.trim()) }));

  // gallery
  const gal = h("div.stack", sw("public_uploads", "Let visitors share photos", s.public_uploads, { onchange: (e) => save({ public_uploads: e.target.checked }),
    hintText: "Shared photos wait in Gallery > To review until an admin publishes them." }));

  // email
  const smtp = s.smtp || {};
  const mail = h("form",
    s.smtp_from_env ? h("div.callout", icon("info"), "Email is configured by the server's environment settings. Changes here won't apply.") : null,
    h("div", h("span.muted", s.smtp_ready ? "Connected. " : "Not connected yet. "), h("span.muted", "Works with any SMTP service, like Brevo, Resend, SendGrid, Postmark, or Google Workspace.")),
    h("div.two", field("SMTP server", input("host", { value: smtp.host, placeholder: "smtp-relay.brevo.com" })),
      h("div.two", field("Port", input("port", { type: "number", value: smtp.port || 587 })), field("Security", sel("security", [["starttls", "STARTTLS"], ["ssl", "SSL/TLS"], ["none", "None"]], smtp.security)))),
    h("div.two", field("Username", input("user", { value: smtp.user, autocomplete: "off" })), field("Password", input("password", { type: "password", value: smtp.password, autocomplete: "new-password" }))),
    field("Send from", input("from", { type: "email", value: smtp.from, placeholder: "events@mahinaclub.org" }), { hintText: "Must be an address your email service lets you send from." }),
    h("p.form-error"),
    h("div.row", h("button.btn", { type: "submit" }, "Save"),
      h("button.btn.ghost", { type: "button", onclick: async (e) => {
        e.target.disabled = true;
        try { const r = await api("/api/admin/email/test", { method: "POST" }); toast(`Test sent to ${r.to}`); } catch (err) { toast(err.message, "error"); }
        e.target.disabled = false;
      } }, "Send a test")));
  onSubmit(mail, (v) => save({ smtp: { host: v.host.trim(), port: Number(v.port) || 587, security: v.security, user: v.user.trim(), password: v.password, from: v.from.trim() } }, "Email settings saved"));

  const page = h("div", head("Settings"),
    sec("club", "Club", club),
    sec("home", "Home page", home),
    sec("give", "Give", give),
    sec("officers", "Officers", officers, "Listed on the Contact page."),
    sec("gallery", "Gallery", gal),
    sec("email", "Email", mail),
    sec("accounts", "Accounts", h("p.muted", { style: { margin: 0 } }, "Admin and member accounts are under ", aLink("/accounts", {}, "Team"), ".")));
  const target = anchor();
  if (target) setTimeout(() => document.getElementById(target)?.scrollIntoView({ behavior: "smooth" }), 80);
  return page;
}

// ---------- planning (team only) ----------
// Tasks and volunteer jobs, the shopping list, and notes for each event. Never shown on the public site.
const dueCell = (s) => (s ? dateCell(s.length === 10 ? s + "T00:00" : s) : "");
const overdue = (i) => i.due && !i.done && i.due.slice(0, 10) < isoLocal(clubNow()).slice(0, 10);

function myTaskList(items, onChange) {
  return h("div.plan-list", items.map((i) => h("div.plan-row", { class: i.done ? "done" : "" },
    doneBox(i, async (done) => { await api(`/api/admin/planning/items/${i.id}`, { method: "PATCH", body: { done } }); i.done = done; toast(done ? (i.kind === "buy" ? "Marked bought" : "Done") : "Reopened"); onChange?.(); refreshCounts(); }),
    h("div.plan-main", h("span.plan-title", i.kind === "buy" ? h("span.kind", icon("cart", 14)) : null, i.title, i.qty ? h("span.muted", ` ×${i.qty}`) : null),
      h("div.sub", aLink(`/planning/${i.event_id}`, {}, i.event?.title || "Event"), i.due ? h("span", { class: overdue(i) ? "late" : "" }, ` · due ${dueCell(i.due)}`) : null)))));
}

function doneBox(i, onToggle) {
  const label = i.kind === "buy" ? `Bought ${i.title}` : `Done: ${i.title}`;
  return h("label.plan-check", { title: i.kind === "buy" ? "Bought" : "Done" },
    h("input", { type: "checkbox", checked: !!i.done, "aria-label": label, onchange: async (e) => {
      try { await onToggle(e.target.checked); } catch (err) { e.target.checked = !e.target.checked; toast(err.message, "error"); }
    } }), h("span", icon("check", 14)));
}

async function planningList() {
  const data = await api("/api/admin/planning");
  const meter = (n, of) => h("span.meter", h("i", { style: { width: of ? `${Math.round((n / of) * 100)}%` : "0" } }));
  const card = (e) => {
    const t = e.totals, d = parse(e.starts_at);
    return aLink(`/planning/${e.id}`, { class: "plan-card" },
      h("div.when", h("span.d", d.getDate()), h("span.m", `${monthName(d, "short")} ${weekday(d)}`)),
      h("div.plan-card-body",
        h("h3", e.title, e.status === "draft" ? pill("draft") : null),
        h("div.plan-stats",
          h("span", icon("check", 16), t.tasks ? `${t.tasks_done}/${t.tasks} tasks` : "No tasks", t.tasks ? meter(t.tasks_done, t.tasks) : null),
          h("span", icon("cart", 16), t.buy ? `${t.bought}/${t.buy} bought` : "No shopping", t.buy ? meter(t.bought, t.buy) : null),
          t.estimate || t.spent ? h("span", `${money(t.spent)} spent`, t.estimate ? h("span.muted", ` of ${money(t.estimate)}`) : null) : null,
          e.notes ? h("span", icon("note", 16), plural(e.notes, "note")) : null)));
  };
  const reload = () => go("/team/planning", { replace: true });
  return h("div", head("Planning"),
    data.mine.length ? h("section.a-section", h("h2", "Assigned to you"), myTaskList(data.mine, reload)) : null,
    h("section.a-section", h("h2", "Upcoming events"),
      data.events.length ? h("div.plan-cards", data.events.map(card)) : empty("No upcoming events.", can("events") ? aLink("/events/new", { class: "btn dark" }, "New event") : null)));
}

async function planPage(id) {
  const data = await api(`/api/admin/planning/${id}`);
  const ev = data.event;
  return h("div",
    head(ev.title, { back: ["/planning", "Planning"], sub: `${longDate(parse(ev.starts_at))}, ${timeRange(ev)}`, actions: [
      link(`/events/${ev.slug}`, { class: "btn small ghost", target: "_blank" }, icon("external", 16), "View"),
      can("events") ? aLink(`/events/${ev.id}`, { class: "btn small ghost" }, icon("edit", 16), "Edit event") : null] }),
    planBoard(ev.id, data));
}

function planBoard(eid, first) {
  const wrap = h("div.plan", loading());
  let data = first;
  const load = async () => { data = await api(`/api/admin/planning/${eid}`); draw(); };
  const patch = async (i, body) => { Object.assign(i, await api(`/api/admin/planning/items/${i.id}`, { method: "PATCH", body })); data.totals = totals(); };
  const totals = () => {
    const buy = data.items.filter((i) => i.kind === "buy"), tasks = data.items.filter((i) => i.kind === "task" && !i.parent_id);
    return { tasks: tasks.length, tasks_done: tasks.filter((i) => i.done).length, buy: buy.length, bought: buy.filter((i) => i.done).length,
      estimate: buy.reduce((a, i) => a + (i.est_cost || 0), 0), spent: buy.filter((i) => i.done).reduce((a, i) => a + (i.cost || 0), 0) };
  };
  const summary = h("div.plan-summary");
  const drawSummary = () => {
    const t = totals();
    clear(summary).append(
      h("div", h("b", `${t.tasks_done}/${t.tasks}`), h("span", "Tasks done")),
      h("div", h("b", `${t.bought}/${t.buy}`), h("span", "Bought")),
      h("div", h("b", money(t.estimate) || "$0.00"), h("span", "Estimated")),
      h("div", h("b", money(t.spent) || "$0.00"), h("span", "Spent")),
      data.event.going ? h("div", h("b", data.event.going), h("span", "Going")) : null);
  };
  const who = (i) => i.assignee ? h("span.who-chip", { class: i.assignee_id === ME.id ? "me" : "" }, i.assignee_id === ME.id ? "You" : i.assignee) : h("span.muted.small", "Unassigned");

  function itemRow(i) {
    const row = h("div.plan-row", { class: (i.done ? "done" : "") + (i.kind === "buy" ? " buy" : "") + (i.parent_id ? " step" : "") },
      doneBox(i, async (done) => { await patch(i, { done }); draw(); }),
      h("div.plan-main",
        h("button.plan-title.linkish", { type: "button", onclick: () => editItem(i) }, i.title, i.qty ? h("span.muted", ` ×${i.qty}`) : null),
        h("div.sub", who(i),
          i.due ? h("span", { class: overdue(i) ? "late" : "" }, `Due ${dueCell(i.due)}`) : null,
          i.done && i.done_by ? h("span", `${i.kind === "buy" ? "Bought" : "Done"} by ${i.done_by}`) : null,
          i.details ? h("span.plan-details", i.details) : null)),
      i.kind === "buy" ? h("div.plan-money",
        h("span.muted.small", i.est_cost != null ? `est. ${money(i.est_cost)}` : ""),
        h("input.money", { value: i.cost ?? "", inputmode: "decimal", placeholder: "Paid", "aria-label": `Amount paid for ${i.title}`,
          onchange: async (e) => { try { await patch(i, { cost: e.target.value }); drawSummary(); toast("Saved"); } catch (err) { toast(err.message, "error"); e.target.value = i.cost ?? ""; } } })) : null,
      h("button.icon-btn", { type: "button", "aria-label": `Edit ${i.title}`, onclick: () => editItem(i) }, icon("edit", 16)));
    return row;
  }

  function assigneeSelect(cur = {}, name = "assignee") {
    const other = h("input", { name: `${name}_name`, placeholder: "Name", "aria-label": "Someone else's name", value: cur.assignee_id ? "" : cur.assignee_name || "", hidden: !!cur.assignee_id || !cur.assignee_name });
    const s = sel(name, [["", "Unassigned"], ...data.team.map((t) => [t.id, t.id === ME.id ? `${t.name} (you)` : t.name]), ["other", "Someone else…"]],
      cur.assignee_id || (cur.assignee_name ? "other" : ""), { "aria-label": "Assigned to", onchange: (e) => { other.hidden = e.target.value !== "other"; if (!other.hidden) other.focus(); } });
    return h("span.assignee", s, other);
  }
  const assigneeBody = (v, name = "assignee") => v[name] === "other" ? { assignee_id: null, assignee_name: v[`${name}_name`] || "" } : { assignee_id: v[name] ? Number(v[name]) : null, assignee_name: "" };

  function addForm(kind) {
    const f = h("form.plan-add",
      h("input", { name: "title", required: true, placeholder: kind === "buy" ? "Add something to buy" : "Add a task or volunteer job", "aria-label": kind === "buy" ? "Item" : "Task" }),
      kind === "buy" ? h("input.qty", { name: "qty", placeholder: "Qty", "aria-label": "Quantity" }) : null,
      assigneeSelect(),
      kind === "buy" ? h("input.money", { name: "est_cost", inputmode: "decimal", placeholder: "Est. $", "aria-label": "Estimated cost" })
        : h("input", { name: "due", type: "date", "aria-label": "Due date" }),
      h("button.btn.small", { type: "submit" }, icon("plus", 16), "Add"));
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const v = values(f);
      if (!v.title?.trim()) return;
      try {
        const item = await api(`/api/admin/planning/${eid}/items`, { method: "POST", body: { kind, title: v.title, qty: v.qty, est_cost: v.est_cost, due: v.due, ...assigneeBody(v) } });
        data.items.push(item); draw();
        $(`.plan-sec[data-kind=${kind}] .plan-add input[name=title]`, wrap)?.focus();
        if (item.assignee_id && item.assignee_id !== ME.id) toast(`Added. ${item.assignee} gets an email.`); 
      } catch (err) { toast(err.message, "error"); }
    });
    return f;
  }

  function editItem(i) {
    const form = h("form.stack",
      field(i.kind === "buy" ? "Item" : "Task", input("title", { value: i.title, required: true })),
      h("div.two", h("label.field", h("span.field-label", "Assigned to"), assigneeSelect(i)),
        i.kind === "buy" ? field("Quantity", input("qty", { value: i.qty || "" }), { optional: true }) : field("Due", input("due", { type: "date", value: (i.due || "").slice(0, 10) }), { optional: true })),
      i.kind === "buy" ? h("div.two", field("Estimated cost", input("est_cost", { value: i.est_cost ?? "", inputmode: "decimal" }), { optional: true }),
        field("Amount paid", input("cost", { value: i.cost ?? "", inputmode: "decimal" }), { optional: true })) : null,
      i.kind === "buy" ? field("Due", input("due", { type: "date", value: (i.due || "").slice(0, 10) }), { optional: true }) : null,
      field("Notes", h("textarea", { name: "details", rows: 3 }, i.details || ""), { optional: true }),
      h("label.check", h("input", { type: "checkbox", name: "done", checked: !!i.done }), i.kind === "buy" ? "Bought" : "Done"),
      h("p.form-error"),
      h("div.row.end",
        h("button.btn.ghost", { type: "button", onclick: async () => {
          if (!(await confirmBox(`Remove “${i.title}”?`, { ok: "Remove" }))) return;
          await api(`/api/admin/planning/items/${i.id}`, { method: "DELETE" }); data.items.splice(data.items.indexOf(i), 1); m.close(); draw();
        } }, "Remove"),
        h("button.btn", { type: "submit" }, "Save")));
    onSubmit(form, async (v) => {
      await patch(i, { title: v.title, qty: v.qty ?? i.qty, due: v.due || null, est_cost: v.est_cost ?? i.est_cost, cost: v.cost ?? i.cost, details: v.details, done: !!v.done, ...assigneeBody(v) });
      m.close(); draw(); toast("Saved");
    });
    const m = modal(h("div", h("h2", i.kind === "buy" ? "Shopping item" : "Task"), form), { label: "Edit item" });
  }

  function notes() {
    const box = h("form.plan-note-form", h("textarea", { name: "body", rows: 3, placeholder: "Add a note for the team", "aria-label": "Note", required: true }),
      h("div.row.end", h("button.btn.small", { type: "submit" }, "Post")));
    box.addEventListener("submit", async (e) => {
      e.preventDefault();
      const ta = $("textarea", box);
      if (!ta.value.trim()) return;
      try { data.notes.unshift(await api(`/api/admin/planning/${eid}/notes`, { method: "POST", body: { body: ta.value } })); draw(); }
      catch (err) { toast(err.message, "error"); }
    });
    return h("aside.plan-notes", h("h3", icon("note", 18), "Notes"), box,
      data.notes.length ? data.notes.map((n) => h("div.plan-note",
        h("div.plan-note-head", h("b", n.author_id === ME.id ? "You" : n.author), h("time", ago(n.created)),
          n.author_id === ME.id || isAdmin() ? h("button.icon-btn", { type: "button", "aria-label": "Delete note", onclick: async () => {
            if (!(await confirmBox("Delete this note?"))) return;
            await api(`/api/admin/planning/notes/${n.id}`, { method: "DELETE" }); data.notes.splice(data.notes.indexOf(n), 1); draw();
          } }, icon("close", 14)) : null),
        h("p", n.body))) : h("p.muted.small", "No notes yet."));
  }

  // Steps: smaller to-dos inside a task, each with its own person.
  function stepForm(parent) {
    const f = h("form.plan-add.step-add",
      h("input", { name: "title", required: true, placeholder: "Add a step", "aria-label": `Step for ${parent.title}` }),
      assigneeSelect({}, "assignee"),
      h("button.btn.small.ghost", { type: "submit" }, icon("plus", 16), "Add"));
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const v = values(f);
      if (!v.title?.trim()) return;
      try {
        const item = await api(`/api/admin/planning/${eid}/items`, { method: "POST", body: { kind: "task", parent_id: parent.id, title: v.title, ...assigneeBody(v) } });
        data.items.push(item); openSteps.add(parent.id); draw();
        $(`.step-add[data-for="${parent.id}"] input[name=title]`, wrap)?.focus();
        if (item.assignee_id && item.assignee_id !== ME.id) toast(`Added. ${item.assignee} gets an email.`);
      } catch (err) { toast(err.message, "error"); }
    });
    f.dataset.for = parent.id;
    return f;
  }
  const openSteps = new Set();
  function taskBlock(i) {
    const steps = data.items.filter((s) => s.parent_id === i.id).sort((a, b) => a.done - b.done);
    const showing = openSteps.has(i.id);
    return h("div.plan-task",
      itemRow(i),
      steps.length ? h("div.plan-steps", steps.map(itemRow)) : null,
      showing ? stepForm(i) : h("button.step-toggle", { type: "button", onclick: () => { openSteps.add(i.id); draw(); $(`.step-add[data-for="${i.id}"] input`, wrap)?.focus(); } },
        icon("plus", 14), steps.length ? "Add a step" : "Break into steps"));
  }

  function section(kind, title, iconName) {
    const list = data.items.filter((i) => i.kind === kind && !i.parent_id).sort((a, b) => a.done - b.done);
    const open = list.filter((i) => !i.done).length;
    return h("section.plan-sec", { "data-kind": kind },
      h("h3", icon(iconName, 18), title, h("span.muted", list.length ? `${open} open` : "")),
      h("div.plan-list", list.length ? list.map(kind === "task" ? taskBlock : itemRow) : h("p.muted.small.plan-empty", kind === "buy" ? "Nothing on the list yet." : "No tasks yet.")),
      addForm(kind));
  }

  // Email the to-do list to teammates: each gets their own open items, and the whole list if picked.
  function sendTasks() {
    const open = data.items.filter((i) => !i.done);
    const count = (id) => open.filter((i) => i.assignee_id === id).length;
    const people = [...data.team].sort((a, b) => count(b.id) - count(a.id) || a.name.localeCompare(b.name));
    let scope = "theirs";
    const seg = h("div.seg", [["theirs", "Their own tasks"], ["all", "The whole list"]].map(([v, t]) => h("button", { type: "button", "aria-pressed": String(v === scope),
      onclick: (e) => { scope = v; $$("button", seg).forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget))); } }, t)));
    const form = h("form.stack",
      h("div.field", h("span.field-label", "Send to"),
        h("div.send-to", people.map((p) => h("label.check", h("input", { type: "checkbox", name: "to", value: p.id, checked: count(p.id) > 0 }),
          h("span", p.id === ME.id ? `${p.name} (you)` : p.name, count(p.id) ? h("span.muted", ` · ${count(p.id)} open`) : null)))),
        h("span.field-error")),
      h("div", h("span.field-label", { style: { marginBottom: "8px" } }, "Include", hint("Everyone always sees their own open tasks and steps first.")), seg),
      field("Note", h("textarea", { name: "note", rows: 2, maxlength: 1000, placeholder: "Setup crew, meet at the pavilion at 9." }), { optional: true }),
      h("p.form-error"),
      h("div.row.end", h("button.btn.ghost", { type: "button", onclick: () => m.close() }, "Cancel"), h("button.btn", { type: "submit" }, icon("send", 16), "Send")));
    onSubmit(form, async (v) => {
      const to = $$("input[name=to]:checked", form).map((x) => Number(x.value));
      const r = await api(`/api/admin/planning/${eid}/send`, { method: "POST", body: { to, scope, note: v.note } });
      m.close(); toast(`Sent to ${plural(r.sent, "person", "people")}`);
    });
    const m = modal(h("div", h("h2", "Send the to-do list"), form), { label: "Send tasks", wide: true });
  }

  function draw() {
    drawSummary();
    clear(wrap).append(h("div.plan-top", summary,
      h("button.btn.small.ghost", { type: "button", onclick: sendTasks, disabled: !data.items.some((i) => !i.done) }, icon("send", 16), "Send tasks")),
      h("div.plan-grid", h("div", section("task", "Tasks and volunteers", "check"), section("buy", "Shopping list", "cart")), notes()));
  }
  if (data) draw(); else load().catch((e) => clear(wrap).append(h("p.form-error", e.message)));
  return wrap;
}

// ---------- team (admins only) ----------
const PERM_HELP = {
  planning: "See event plans, take tasks, check off the shopping list, add notes.",
  events: "Create and edit events, see RSVPs, and plan events.",
  signups: "Build sign-up sheets and see who signed up.",
  polls: "Create polls and see responses.",
  photos: "Upload, review, and publish photos.",
  messages: "Read the Contact inbox.",
  people: "See the mailing list. Add and delete people.",
  email: "Email the mailing list and event attendees.",
  shop: "Sell at the table, see orders, and edit products.",
  team: "See the team and invite members, with access they have themselves.",
};

function accountForm(acct, perms, defaults, onDone, grantable = Object.keys(perms)) {
  const isNew = !acct;
  const memberMode = !isAdmin();  // members with Team access: invite members, with access they have themselves
  const pwOn = STATE.password_login !== false;
  const st = { role: acct?.role || "member", perms: new Set(acct ? acct.perms : defaults), mode: "invite" };
  const roleBox = h("div");
  const permBox = h("div.perm-list");
  const drawRole = () => {
    clear(roleBox).append(h("div.seg", { role: "group", "aria-label": "Role" }, [["member", "Member"], ["admin", "Admin"]].map(([v, t]) =>
      h("button", { type: "button", "aria-pressed": String(st.role === v), disabled: acct?.id === ME.id, onclick: () => { st.role = v; drawRole(); } }, t))),
      hint(st.role === "admin" ? "Admins can do everything, including settings, colors, the home page, accounts, and the activity log." : "Members get only what you tick below. They can't change settings or the site's layout."));
    permBox.hidden = st.role === "admin";
  };
  clear(permBox).append(Object.entries(perms).filter(([k]) => grantable.includes(k)).map(([k, name]) => h("label.perm", h("input", { type: "checkbox", checked: st.perms.has(k), onchange: (e) => e.target.checked ? st.perms.add(k) : st.perms.delete(k) }),
    h("span", h("b", name), h("span.muted.small", PERM_HELP[k] || "")))));
  drawRole();
  // New people get an emailed invite by default, so no one has to make up a password for them.
  const pwBox = h("div");
  const submit = h("button.btn", { type: "submit" });
  const drawMode = () => {
    const invite = isNew && st.mode === "invite";
    clear(pwBox).append(
      !invite && pwOn && (isNew || acct.id !== ME.id) ? pwField(isNew ? "Starting password" : "New password", "password", { autocomplete: "new-password", isNew: true,
        hintText: `${isNew ? "" : "Optional. Signs them out everywhere. "}At least ${STATE.min_password || 15} characters. Share it privately; they can change it after signing in.` }) : null,
      !invite && !pwOn && isNew ? h("p.muted.small", { style: { margin: 0 } }, `They sign in with ${STATE.sso?.name || "single sign-on"} using this email.`) : null);
    const pw = pwBox.querySelector("[name=password]");
    if (pw && !isNew) pw.required = false;
    clear(submit).append(invite ? icon("send", 16) : null, invite ? "Send invite" : isNew ? "Add" : "Save");
    $$("[data-mode]", form).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === st.mode)));
    const nameIn = form.querySelector("[name=name]");
    nameIn.required = !invite;
  };
  const form = h("form.stack",
    isNew && !memberMode ? h("div.seg", { role: "group", "aria-label": "How to add them" },
      h("button", { type: "button", "data-mode": "invite", onclick: () => { st.mode = "invite"; drawMode(); } }, icon("mail", 16), "Email an invite"),
      h("button", { type: "button", "data-mode": "direct", onclick: () => { st.mode = "direct"; drawMode(); } }, pwOn ? "Set a password" : "Add directly"),
      hint("An invite emails a one-time link. They pick their own name and password. The link expires in 7 days.")) : null,
    h("div.two", field("Name", input("name", { value: acct?.name || "", autocomplete: "off" })),
      isNew ? field("Email", input("email", { type: "email", required: true, autocomplete: "off" })) : h("label.field", h("span.field-label", "Email"), h("div.muted", { style: { padding: "12px 0" } }, acct.email))),
    memberMode ? null : h("div", h("span.field-label", { style: { marginBottom: "8px" } }, "Role"), roleBox),
    h("div", permBox),
    pwBox,
    h("p.form-error"),
    h("div.row.end", submit));
  drawMode();
  onSubmit(form, async (v) => {
    const body = { name: v.name, role: st.role, perms: [...st.perms] };
    if (isNew && st.mode === "invite") {
      const r = await api("/api/admin/invites", { method: "POST", body: { ...body, email: v.email } });
      return onDone(r.emailed ? `Invite sent to ${v.email}` : null, r.link ? { link: r.link, email: v.email, expires: r.expires } : null);
    }
    if (v.password) body.password = v.password;
    if (isNew) await api("/api/admin/admins", { method: "POST", body: { ...body, email: v.email } });
    else await api(`/api/admin/admins/${acct.id}`, { method: "PUT", body });
    onDone(isNew ? "Added" : "Saved");
  });
  return form;
}

// Shown only when email isn't set up yet: the link appears once, for the admin to pass along privately.
function showInviteLink({ link: url, email, expires }) {
  modal(h("div",
    h("h2", "Send this link yourself"),
    h("p.muted", `Email isn't connected, so the invite for ${email} wasn't sent. Text or email this link to them privately. It works once and expires ${dateCell(expires)}.`),
    h("div.invite-link", h("input", { value: url, readonly: true, "aria-label": "Invite link", onfocus: (e) => e.target.select() }),
      h("button.btn", { type: "button", onclick: () => copy(url) }, icon("copy", 16), "Copy"))), { label: "Invite link", wide: true });
}

async function accounts() {
  const [data, invites] = await Promise.all([api("/api/admin/admins"), api("/api/admin/invites")]);
  const reload = () => go("/team/accounts", { replace: true });
  const open = (acct) => {
    if (acct && !isAdmin()) return;  // members invite; only admins edit accounts
    const m = modal(h("div", h("h2", acct ? acct.name : isAdmin() ? "Add someone" : "Invite someone"), accountForm(acct, data.perms, data.default_member_perms, (msg, linkInfo) => {
      m.close(); if (msg) toast(msg); reload(); if (linkInfo) setTimeout(() => showInviteLink(linkInfo), 150);
    }, data.grantable)), { label: "Account", wide: true });
  };
  const pending = invites.length ? h("section.a-section", h("h2", "Invites"),
    h("div.tbl-wrap", h("table.tbl",
      h("thead", h("tr", h("th", "Person"), h("th", "Role"), h("th", "Invited by"), h("th", "Link"), h("th"))),
      h("tbody", invites.map((i) => h("tr",
        h("td", h("span.strong", i.name || i.email), i.name ? h("div.sub", i.email) : null),
        h("td", pill(i.role === "admin" ? "published" : "draft", i.role === "admin" ? "Admin" : "Member")),
        h("td.sub", `${i.invited_by}, ${ago(i.created)}`),
        h("td.sub", i.expired ? pill("closed", "Expired") : `Works until ${dateCell(i.expires)}`),
        h("td.actions", !isAdmin() && i.role === "admin" ? null : h("div.row", { style: { gap: "4px", flexWrap: "nowrap", justifyContent: "flex-end" } },
          h("button.btn.small.ghost", { type: "button", onclick: async () => {
            const r = await api(`/api/admin/invites/${i.id}/resend`, { method: "POST" });
            if (r.emailed) toast(`New link sent to ${i.email}`); else showInviteLink({ link: r.link, email: i.email, expires: r.expires });
            if (r.emailed) reload();
          } }, icon("send", 16), "Resend"),
          h("button.icon-btn", { type: "button", "aria-label": `Cancel invite for ${i.email}`, title: "Cancel invite", onclick: async () => {
            if (await confirmBox(`Cancel the invite for ${i.email}? The link stops working.`, { ok: "Cancel invite" })) { await api(`/api/admin/invites/${i.id}`, { method: "DELETE" }); toast("Invite cancelled"); reload(); }
          } }, icon("close", 16)))))))))) : null;
  const access = (a) => a.role === "admin" ? h("span", "Everything") : a.perms.length ? h("span", a.perms.map((p) => data.perms[p]).join(", ")) : h("span.muted", "Nothing yet");
  return h("div", head("Team", { actions: [h("button.btn", { type: "button", onclick: () => open(null) }, icon("plus", 18), isAdmin() ? "Add someone" : "Invite someone")] }),
    h("div.tbl-wrap", h("table.tbl",
      h("thead", h("tr", h("th", "Person"), h("th", "Role"), h("th", "Access"), h("th", "Last sign-in"), h("th"))),
      h("tbody", data.accounts.map((a) => h(isAdmin() ? "tr.click" : "tr", { onclick: (e) => isAdmin() && !e.target.closest("button") && open(a) },
        h("td", h("span.strong", a.name, a.id === ME.id ? h("span.muted", " (you)") : null), h("div.sub", a.email)),
        h("td", pill(a.role === "admin" ? "published" : "draft", a.role === "admin" ? "Admin" : "Member")),
        h("td.sub", access(a)),
        h("td.sub", a.last_login ? ago(a.last_login) : "Never"),
        h("td.actions", a.id === ME.id || !isAdmin() ? null : h("button.icon-btn", { type: "button", "aria-label": `Remove ${a.name}`, onclick: async () => {
          if (await confirmBox(`Remove ${a.name}'s account? They're signed out right away. Tasks assigned to them stay, with their name.`, { ok: "Remove" })) {
            await api(`/api/admin/admins/${a.id}`, { method: "DELETE" }); toast("Removed"); reload();
          }
        } }, icon("trash", 16)))))))),
    pending);
}

// ---------- activity log (admins only) ----------
async function activity() {
  const [first, accts] = await Promise.all([api("/api/admin/activity"), api("/api/admin/admins")]);
  const st = { items: first.items, more: first.more, who: 0 };
  const tbody = h("tbody");
  const moreBox = h("div", { style: { marginTop: "16px" } });
  const fetchPage = async (reset) => {
    const before = reset ? 0 : st.items.at(-1)?.id || 0;
    const r = await api(`/api/admin/activity?before=${before}&who=${st.who}`);
    st.items = reset ? r.items : st.items.concat(r.items); st.more = r.more; draw();
  };
  const draw = () => {
    clear(tbody).append(st.items.map((x) => h("tr",
      h("td.sub", { title: x.at.replace("T", " ") }, `${dateCell(x.at)}, ${time(parse(x.at))}`),
      h("td.strong", x.actor),
      h("td", x.action, x.target ? h("span.muted", ` · ${x.target}`) : null))));
    if (!st.items.length) tbody.append(h("tr", h("td", { colspan: 3 }, h("p.muted", "Nothing logged yet."))));
    clear(moreBox).append(st.more ? h("button.btn.small.ghost", { type: "button", onclick: () => fetchPage(false) }, "Show older") : null);
  };
  draw();
  const filter = sel("who", [["0", "Everyone"], ...accts.accounts.map((a) => [a.id, a.name])], "0", { "aria-label": "Filter by person", onchange: (e) => { st.who = Number(e.target.value); fetchPage(true); } });
  return h("div", head("Activity", { actions: [filter] }),
    h("div.tbl-wrap", h("table.tbl", h("thead", h("tr", h("th", "When"), h("th", "Who"), h("th", "What"))), tbody)), moreBox);
}

// ---------- your account ----------
async function account() {
  const pwOn = STATE.password_login !== false;
  const pw = h("form.stack",
    h("div.two", pwField("Current password", "current"), pwField("New password", "new", { autocomplete: "new-password", isNew: true })),
    h("p.form-error"), h("div", h("button.btn", { type: "submit" }, "Change password")));
  onSubmit(pw, async (v) => { await api("/api/admin/password", { method: "POST", body: v }); pw.reset(); toast("Password changed. Other devices are signed out."); });
  const names = STATE.perm_names || {};
  return h("div", head("Your account"),
    h("section.settings-sec", h("div", h("h2", "You")), h("div.stack",
      h("div", h("b", { style: { color: "var(--ink)" } }, ME.name), h("div.muted", ME.email)),
      h("div.muted.small", isAdmin() ? "Admin. You can do everything." : `Member. Access: ${ME.perms.map((p) => names[p] || p).join(", ") || "none yet"}.`))),
    pwOn ? h("section.settings-sec", h("div", h("h2", "Password")), pw)
      : h("section.settings-sec", h("div", h("h2", "Password")), h("p.muted", `You sign in with ${STATE.sso?.name || "single sign-on"}.`)));
}

// Shared with the dashboard shop (shop-team.js).
export { head, sw, pill, ago, dateCell, isAdmin, csv, pickSlotImage, refreshSite, aLink };
