// Home, gallery, polls, give, contact, my sign-ups.
import { h, $, $$, api, clear, go, href, icon, link, hint, parse, time, timeRange, longDate, shortDate, monthName, weekday,
  clubNow, isoLocal, relDays, me, toast, modal, field, input, onSubmit, honeypot, tagChip, empty, plural, query, copy,
  setTitle, media, CFG, loading, replaceUrl, confirmBox } from "./core.js";
import { moonInfo, moonSVG, palmSVG } from "./moon.js";
import { timeline, joinButtons } from "./events.js";
import { EDIT, ed, tool, action, saveSettings, ask, patchEvent } from "./edit.js";

const money = (n) => "$" + Number(n || 0).toLocaleString("en-US");

// ---------- home ----------
const SECTION_NAMES = { coming: "Coming up", photos: "Photos", polls: "Polls", give: "Fundraising goal" };

export async function home() {
  setTitle();
  const S = window.SITE;
  const now = clubNow();
  const from = new Date(now); from.setDate(from.getDate() - 45);
  const [events, photos, polls] = await Promise.all([
    api(`/api/events?start=${isoLocal(from).slice(0, 10)}`), api("/api/photos"), S.polls_open || EDIT.on ? api("/api/polls") : []]);
  const upcoming = events.filter((e) => parse(e.starts_at) > now && e.status !== "cancelled");
  const openPolls = polls.filter((p) => !p.closed);
  const spot = S.spotlight || { kind: "next" };
  const feature = spot.kind === "none" ? null : await heroFeature(spot, upcoming, openPolls);

  const m = moonInfo();
  const moon = moonSVG(m.phase, 380);
  moon.classList.add("rise");
  const glade = h("div.glade.shimmer", { "aria-hidden": "true" }, [120, 84, 150, 60, 100, 40, 70, 24].map((w, i) =>
    h("i", { style: { width: `${Math.round(w * (0.35 + m.illum * 0.65))}px`, opacity: String((0.9 - i * 0.09) * (0.25 + m.illum * 0.75)), animationDelay: `${i * 0.4}s` } })));
  const sea = h("div.sea", glade);
  const showCaption = !!S.moon_caption;
  const toggleCaption = () => saveSettings({ moon_caption: !showCaption }, { redraw: true }).catch((e) => toast(e.message, "error"));
  const moonBox = h("div.hero-moon", moon,
    showCaption || EDIT.on ? h("div.moon-caption", { class: showCaption ? "" : "off" },
      "Tonight is", h("b", m.night),
      hint(`${m.night} is tonight's name in the kaulana mahina, the Hawaiian moon calendar. The moon is ${Math.round(m.illum * 100)}% lit.`),
      EDIT.on ? tool(showCaption ? "eyeOff" : "eye", showCaption ? "Hide the moon's name" : "Show the moon's name", toggleCaption, { "aria-pressed": String(showCaption) }) : null) : null);
  const name = ed(h("h1.display.hero-name", S.club_name), { label: "Club name", save: async (t) => {
    if (!t) throw new Error("The club needs a name.");
    await saveSettings({ club_name: t }, { redraw: true });
  } });
  const palms = h("div.palms", { "aria-hidden": "true", style: { width: "560px", height: "520px" } },
    Object.assign(palmSVG({ height: 500, lean: -0.16, seed: 3 }), { style: "right:-40px" }),
    Object.assign(palmSVG({ height: 380, lean: 0.24, seed: 8 }), { style: "right:150px" }));
  const hero = h("section.hero.on-night",
    palms,
    h("div.wrap.hero-inner",
      h("div", name, EDIT.on ? featurePicker(spot, upcoming, polls) : null, feature),
      moonBox),
    sea);
  const placeGlade = () => {
    const r = moon.getBoundingClientRect(), hr = hero.getBoundingClientRect();
    glade.style.left = `${r.left - hr.left + r.width / 2}px`;
  };
  requestAnimationFrame(placeGlade);
  window.addEventListener("resize", placeGlade);

  const L = S.labels || {};
  const heading = (key, cls = "h2.h2") => ed(h(cls, L[key] || SECTION_NAMES[key]), { label: `${SECTION_NAMES[key]} heading`,
    save: (t) => saveSettings({ labels: { [key]: t } }).then(() => (window.SITE.labels || {})[key]) });

  const build = {
    coming() {
      const live = events.filter((e) => e.status !== "cancelled");
      if (!live.length) return null;
      const narrow = window.innerWidth <= 720;
      const tl = timeline(narrow ? live.filter((e) => parse(e.starts_at) > now).slice(0, 5) : live.slice(-14), { compact: true });
      return h("section.section",
        h("div.wrap", h("div.section-head", heading("coming"), h("div.row", tools("coming"), link("/events", { class: "btn small ghost" }, "All events")))),
        tl.el || tl);
    },
    photos() {
      const recent = photos.slice(0, 10);
      if (!recent.length) return null;
      return h("section.section.wrap",
        h("div.section-head", heading("photos"), h("div.row", tools("photos"), link("/gallery", { class: "btn small ghost" }, "Gallery"))),
        h("div.strip", recent.map((p) => link(`/gallery?photo=${p.id}`, { class: "photo-tile" },
          h("img", { src: media(p.thumb), alt: p.caption || p.event?.title || "", loading: "lazy" }),
          p.event ? h("span.cap", p.event.title) : null))));
    },
    polls() {
      if (!openPolls.length) return null;
      return h("div",
        h("div.section-head", { style: { marginBottom: "18px" } }, heading("polls"), tools("polls")),
        h("div.poll-list", openPolls.slice(0, 3).map(pollRow)));
    },
    give() {
      if (!S.venmo) return null;
      const goal = S.donate_goal || {};
      return h("div",
        h("div.section-head", { style: { marginBottom: "10px" } },
          ed(h("h2.h2", goal.label || "Give"), { label: "Goal name", placeholder: "Goal name",
            save: (t) => saveSettings({ donate_goal: { ...goal, label: t } }) }), tools("give")),
        goal.goal || EDIT.on ? goalBar(goal, { onBand: true }) : null,
        link("/give", { class: "btn" }, "Give with Venmo"));
    },
  };

  const order = S.home_sections?.length ? S.home_sections : Object.keys(build).map((key) => ({ key, on: true }));
  const out = [];
  let band = null;
  // Polls and the fundraising goal share a two-column band. If only one of them is showing,
  // the calendar card fills the other side so the band stays balanced.
  const flushBand = () => {
    if (!band) return;
    if (band.length === 1) band.push(calendarCard());
    out.push(h("section.band", h("div.wrap.split", band)));
    band = null;
  };
  for (const sec of order) {
    if (!build[sec.key]) continue;
    const node = sec.on ? build[sec.key]() : null;
    if (!node) {
      if (EDIT.on) { flushBand(); out.push(hiddenRow(sec.key, sec.on)); }
      continue;
    }
    if (sec.key === "polls" || sec.key === "give") {
      (band ||= []).push(node);
      if (band.length === 2) flushBand();
    } else { flushBand(); out.push(node); }
  }
  flushBand();
  return h("div", hero, out);
}

// Subscribe to the club calendar in one tap. Events then show up, and stay updated, in people's own calendar apps.
function calendarCard() {
  const httpUrl = `${location.origin}/calendar.ics`;
  const webcal = httpUrl.replace(/^https?:/, "webcal:");
  const name = encodeURIComponent(window.SITE?.club_name || "Mahina Club");
  const href = (u) => (CFG.demo ? "#" : u);
  return h("div.cal-card",
    h("div.section-head", { style: { marginBottom: "18px" } }, h("h2.h2", "Add our calendar",
      hint("New events show up in your calendar on their own, and changes and cancellations update there too."))),
    h("div.cal-sub",
      h("a.btn", { href: href(`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`), target: "_blank", rel: "noopener" }, "Google"),
      h("a.btn.ghost", { href: href(webcal) }, "Apple"),
      h("a.btn.ghost", { href: href(`https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(httpUrl)}&name=${name}`), target: "_blank", rel: "noopener" }, "Outlook"),
      h("button.icon-btn", { type: "button", "aria-label": "Copy calendar link", title: "Copy calendar link", onclick: () => copy(httpUrl) }, icon("link", 18))));
}

// Section controls in edit mode: move up, move down, hide.
function tools(key) {
  if (!EDIT.on) return null;
  const list = [...(window.SITE.home_sections || [])];
  const i = list.findIndex((s) => s.key === key);
  const move = (d) => async () => {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    await saveSettings({ home_sections: list }, { redraw: true });
  };
  const hide = async () => { list[i] = { ...list[i], on: false }; await saveSettings({ home_sections: list }, { redraw: true }); toast(`${SECTION_NAMES[key]} hidden`); };
  return h("span.ed-tools",
    tool("up", "Move up", move(-1), { disabled: i <= 0 }),
    tool("down", "Move down", move(1), { disabled: i >= list.length - 1 }),
    tool("eyeOff", `Hide ${SECTION_NAMES[key]}`, hide));
}

function hiddenRow(key, on) {
  const list = [...(window.SITE.home_sections || [])];
  const i = list.findIndex((s) => s.key === key);
  const why = { coming: "Shows when there are events.", photos: "Shows once photos are published.", polls: "Shows while a poll is open.",
    give: "Shows once a Venmo handle is set." }[key];
  return h("div.wrap", h("div.ed-hidden",
    h("span", h("b", SECTION_NAMES[key]), on ? hint(why) : null),
    h("span.row", { style: { gap: "6px" } },
      tool("up", "Move up", async () => { if (i > 0) { [list[i], list[i - 1]] = [list[i - 1], list[i]]; await saveSettings({ home_sections: list }, { redraw: true }); } }, { disabled: i <= 0 }),
      tool("down", "Move down", async () => { if (i < list.length - 1) { [list[i], list[i + 1]] = [list[i + 1], list[i]]; await saveSettings({ home_sections: list }, { redraw: true }); } }, { disabled: i >= list.length - 1 }),
      on ? null : action("Show", async () => { list[i] = { ...list[i], on: true }; await saveSettings({ home_sections: list }, { redraw: true }); }, "eye"))));
}

function featurePicker(spot, upcoming, polls) {
  const val = spot.kind === "event" || spot.kind === "poll" ? `${spot.kind}:${spot.id}` : spot.kind;
  const opts = [["next", "Next event"], ...upcoming.slice(0, 12).map((e) => [`event:${e.id}`, e.title]),
    ...polls.filter((p) => !p.closed).map((p) => [`poll:${p.id}`, `Poll: ${p.title}`]), ["give", "Fundraising goal"], ["none", "Nothing"]];
  const sel = h("select.ed-select", { "aria-label": "Featured on the home page", onchange: async (e) => {
    const [kind, id] = e.target.value.split(":");
    try { await saveSettings({ spotlight: { kind, id: id ? Number(id) : null } }, { redraw: true }); } catch (err) { toast(err.message, "error"); }
  } }, opts.map(([v, t]) => h("option", { value: v, selected: v === val }, t)));
  return h("div.ed-tools.ed-feature", h("span", "Featured"), sel);
}

// Progress toward the fundraising goal. In edit mode the numbers are editable.
function goalBar(goal, { onBand = false } = {}) {
  const g = { label: goal.label || "", goal: Number(goal.goal) || 0, raised: Number(goal.raised) || 0 };
  const bar = h("span", { style: { width: `${g.goal ? Math.min(100, (g.raised / g.goal) * 100) : 0}%` } });
  const redraw = () => { bar.style.width = `${g.goal ? Math.min(100, (g.raised / g.goal) * 100) : 0}%`; };
  const num = (key) => ed(h("span", money(g[key])), { number: true, value: g[key], format: money, label: key === "raised" ? "Amount raised" : "Goal amount",
    save: async (v) => { g[key] = v; await saveSettings({ donate_goal: { ...g } }); redraw(); } });
  const raised = num("raised");
  if (!EDIT.on) raised.textContent = money(g.raised);
  return h("div", { style: { margin: onBand ? "22px 0 26px" : "22px 0 0" } },
    h("div.progress", { style: onBand ? null : { background: "var(--mist)" } }, bar),
    h("div.goal-nums", h("span", h("b.num", raised), " raised"), h("span", "of ", num("goal"))));
}

async function heroFeature(spot, upcoming, polls) {
  const S = window.SITE;
  if (spot.kind === "poll") {
    const p = polls.find((x) => String(x.id) === String(spot.id)) || polls[0];
    if (p) return h("div.hero-feature",
      h("div.hero-kicker", h("span.pip"), "Poll"),
      ed(h("h2", p.title), { label: "Poll title", save: (t) => api(`/api/admin/polls/${p.id}`, { method: "PATCH", body: { title: t } }) }),
      h("div.hero-facts", h("span", icon("people"), plural(p.responses, "response")), p.closes_at ? h("span", icon("clock"), `Closes ${shortDate(parse(p.closes_at))}`) : null),
      h("div.row", link(`/polls/${p.slug}`, { class: "btn" }, "Vote"), link("/polls", { class: "btn ghost" }, "All polls")));
  }
  if (spot.kind === "give" && S.venmo) {
    const g = S.donate_goal || {};
    return h("div.hero-feature",
      h("div.hero-kicker", h("span.pip"), g.goal ? `${money(g.raised)} of ${money(g.goal)}` : "Give"),
      ed(h("h2", g.label || "Support the club"), { label: "Goal name", save: (t) => saveSettings({ donate_goal: { ...g, label: t } }) }),
      h("div.row", link("/give", { class: "btn" }, "Give with Venmo"), link("/events", { class: "btn ghost" }, "Events")));
  }
  let ev = spot.kind === "event" ? upcoming.find((e) => String(e.id) === String(spot.id)) : null;
  ev ||= upcoming[0];
  if (!ev) return h("div.hero-feature", h("div.row", link("/events", { class: "btn" }, "Events"), link("/contact", { class: "btn ghost" }, "Get in touch")));
  const d = parse(ev.starts_at);
  return h("div.hero-feature",
    h("div.hero-kicker", h("span.pip"), relDays(d) === "Today" ? "Today" : "Next up"),
    ed(h("h2", ev.title), { label: "Event title", save: (t) => patchEvent(ev.id, { title: t }).then((r) => r.title) }),
    h("div.hero-facts",
      h("span", icon("calendar"), shortDate(d)),
      h("span", icon("clock"), timeRange(ev)),
      ev.location ? h("span", icon("pin"), ev.location) : null),
    h("div.row", ...joinButtons(ev, "", { onDark: true }), link(`/events/${ev.slug}`, { class: "btn ghost" }, "Details")));
}

function pollRow(p) {
  return link(`/polls/${p.slug}`, { class: "poll-row" },
    h("div", h("h3", p.title), h("div.muted", p.closed ? `Closed, ${plural(p.responses, "response")}` :
      [plural(p.responses, "response"), p.closes_at ? `closes ${shortDate(parse(p.closes_at))}` : null].filter(Boolean).join(", "))),
    h("span.btn.small", { class: p.closed ? "ghost" : "" }, p.closed ? "Results" : "Vote"));
}

// ---------- gallery ----------
export async function gallery() {
  setTitle("Gallery");
  const S = window.SITE;
  const [photos, events] = await Promise.all([api("/api/photos"), api("/api/events")]);
  const q = query();
  const state = { tag: q.get("tag") || "", event: q.get("event") || "" };
  const tagsWithPhotos = (S.tags || []).filter((t) => photos.some((p) => p.tags.some((x) => x.id === t.id)));
  const evsWithPhotos = events.filter((e) => e.photos).sort((a, b) => b.starts_at.localeCompare(a.starts_at));
  const tools = h("div.gallery-tools");
  const lead = h("div");
  const grid = h("div.masonry");

  const syncUrl = () => {
    const p = new URLSearchParams();
    if (state.tag) p.set("tag", state.tag);
    if (state.event) p.set("event", state.event);
    const qs = p.toString() ? "?" + p : "";
    replaceUrl("/gallery" + qs);
  };
  const filtered = () => photos.filter((p) => (!state.tag || p.tags.some((t) => t.slug === state.tag)) && (!state.event || p.event?.slug === state.event));

  function draw() {
    const list = filtered();
    const sel = h("select", { "aria-label": "Event", onchange: (e) => { state.event = e.target.value; draw(); syncUrl(); } },
      h("option", { value: "" }, "All events"),
      evsWithPhotos.map((e) => h("option", { value: e.slug, selected: e.slug === state.event }, `${e.title}, ${monthName(parse(e.starts_at), "short")} ${parse(e.starts_at).getFullYear()}`)));
    clear(tools).append(
      h("div.tags", tagChip({ name: "All", slug: "", color: "night" }, { active: !state.tag, onclick: () => { state.tag = ""; draw(); syncUrl(); } }),
        tagsWithPhotos.map((t) => tagChip(t, { active: state.tag === t.slug, onclick: () => { state.tag = state.tag === t.slug ? "" : t.slug; draw(); syncUrl(); } }))),
      h("div.row", sel, S.public_uploads ? h("button.btn.small.dark", { type: "button", onclick: () => shareDialog(events.find((e) => e.slug === state.event)) }, icon("camera", 16), "Share photos") : null));
    clear(lead);
    if (state.event) {
      const ev = events.find((e) => e.slug === state.event);
      if (ev) lead.append(h("div.section-head", { style: { marginBottom: "22px" } }, h("div", h("h2.h3", ev.title), h("p.muted", { style: { margin: "4px 0 0" } }, longDate(parse(ev.starts_at)))), link(`/events/${ev.slug}`, { class: "text-link" }, "Event details")));
    } else if (state.tag) {
      const tagged = events.filter((e) => e.tags.some((t) => t.slug === state.tag)).sort((a, b) => b.starts_at.localeCompare(a.starts_at)).slice(0, 12);
      if (tagged.length) lead.append(h("div.tagged-events", tagged.map((e) => h("a", {
        href: href(e.photos ? `/gallery?event=${e.slug}` : `/events/${e.slug}`),
        onclick: e.photos ? (ev) => { ev.preventDefault(); state.event = e.slug; state.tag = ""; draw(); syncUrl(); } : null },
      e.cover ? h("img", { src: media(e.cover.thumb), alt: "" }) : null,
      h("div", h("b", e.title), h("span", e.photos ? plural(e.photos, "photo") : shortDate(parse(e.starts_at))))))));
    }
    clear(grid);
    if (!list.length) grid.append(empty("No photos here yet."));
    list.forEach((p, i) => grid.append(h("button.ph", { type: "button", onclick: () => lightbox(list, i, { onTag: (slug) => { state.tag = slug; state.event = ""; draw(); syncUrl(); },
      onHide: (ph) => { photos.splice(photos.indexOf(ph), 1); draw(); } }) },
      h("img", { src: media(p.thumb), alt: p.caption || p.event?.title || "Club photo", loading: "lazy", width: p.w, height: p.h }),
      p.event || p.caption ? h("span.ph-over", p.caption || p.event.title) : null)));
  }
  draw();
  const start = q.get("photo");
  if (start) {
    const list = filtered();
    const i = list.findIndex((p) => String(p.id) === start);
    if (i >= 0) setTimeout(() => lightbox(list, i, {}), 50);
  }
  return h("div.wrap", h("div.page-head", h("h1.h1", "Gallery")), tools, lead, grid);
}

export function lightbox(list, index, { onTag, onHide } = {}) {
  let i = index;
  const img = h("img", { alt: "" });
  const bar = h("div.lb-bar");
  const count = h("div.lb-count");
  const close = () => { lb.remove(); document.removeEventListener("keydown", key); document.body.style.overflow = ""; prev?.focus(); };
  const show = (n) => {
    i = (n + list.length) % list.length;
    const p = list[i];
    img.src = media(p.src); img.alt = p.caption || p.event?.title || "Club photo";
    count.textContent = `${i + 1} / ${list.length}`;
    const cap = EDIT.on
      ? ed(h("div.cap", p.caption || ""), { label: "Caption", placeholder: "Add a caption", save: async (t) => {
        await api(`/api/admin/photos/${p.id}`, { method: "PUT", body: { caption: t } }); p.caption = t; } })
      : p.caption ? h("div.cap", p.caption) : null;
    clear(bar).append(
      h("div", cap,
        p.event ? link(`/events/${p.event.slug}`, { class: "ev", onclick: close }, p.event.title, ", ", shortDate(parse(p.event.starts_at))) : null),
      h("div.tags", p.tags.map((t) => h("button", { type: "button", class: `tag c-${t.color}`, onclick: () => { close(); onTag ? onTag(t.slug) : go(`/gallery?tag=${t.slug}`); } }, h("span.dot"), t.name)),
        EDIT.on ? h("button.btn.small.ghost.lb-hide", { type: "button", onclick: async () => {
          await api("/api/admin/photos/bulk", { method: "POST", body: { ids: [p.id], action: "hidden" } });
          toast("Photo hidden");
          list.splice(i, 1);
          if (!list.length) { close(); return go("/gallery", { replace: true }); }
          show(i);
          onHide?.(p);
        } }, icon("eyeOff", 16), "Hide photo") : null));
    new Image().src = media(list[(i + 1) % list.length].src);
  };
  const key = (e) => {
    if (e.target.closest?.(".ed, input, textarea, select, dialog")) return;
    if (e.key === "Escape") close(); if (e.key === "ArrowRight") show(i + 1); if (e.key === "ArrowLeft") show(i - 1);
  };
  const prev = document.activeElement;
  const stage = h("div.lb-stage", img, count,
    h("button.icon-btn.lb-close", { type: "button", "aria-label": "Close", onclick: close }, icon("close", 24)),
    list.length > 1 ? h("button.icon-btn.lb-prev", { type: "button", "aria-label": "Previous photo", onclick: () => show(i - 1) }, icon("left", 24)) : null,
    list.length > 1 ? h("button.icon-btn.lb-next", { type: "button", "aria-label": "Next photo", onclick: () => show(i + 1) }, icon("right", 24)) : null);
  stage.addEventListener("click", (e) => { if (e.target === stage) close(); });
  let tx = null;
  stage.addEventListener("touchstart", (e) => (tx = e.touches[0].clientX), { passive: true });
  stage.addEventListener("touchend", (e) => { if (tx == null) return; const dx = e.changedTouches[0].clientX - tx; if (Math.abs(dx) > 50) show(i + (dx < 0 ? 1 : -1)); tx = null; });
  const lb = h("div.lightbox", { role: "dialog", "aria-modal": "true", "aria-label": "Photo viewer" }, stage, bar);
  document.body.append(lb);
  document.body.style.overflow = "hidden";
  document.addEventListener("keydown", key);
  show(i);
  $(".lb-close", lb).focus();
}

export function shareDialog(ev) {
  const files = [];
  const thumbs = h("div.thumbs");
  const fileInput = h("input", { type: "file", accept: "image/*", multiple: true, hidden: true, onchange: (e) => add(e.target.files) });
  const add = (list) => {
    for (const f of list) if (f.type.startsWith("image/") && files.length < 20) {
      files.push(f);
      thumbs.append(h("img", { src: URL.createObjectURL(f), alt: "" }));
    }
    drop.querySelector("b").textContent = files.length ? plural(files.length, "photo") + " ready" : "Choose photos";
  };
  const drop = h("div.dropzone", { tabindex: 0, role: "button", onclick: () => fileInput.click(), onkeydown: (e) => (e.key === "Enter" || e.key === " ") && fileInput.click() },
    icon("camera", 28), h("b", "Choose photos"), h("span.small", "or drop them here"));
  ["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => add(e.dataTransfer.files));
  const known = me.get();
  const form = h("form",
    drop, fileInput, thumbs,
    field("Name", input("name", { value: known.name || "", required: true, autocomplete: "name" })),
    field("Email", input("email", { type: "email", value: known.email || "", autocomplete: "email" }), { optional: true }),
    honeypot(), h("p.form-error"),
    h("button.btn.block", { type: "submit" }, "Send photos"));
  onSubmit(form, async (v) => {
    if (!files.length) throw new Error("Choose at least one photo.");
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    fd.append("name", v.name); fd.append("email", v.email || ""); fd.append("website", v.website || "");
    if (ev?.id) fd.append("event_id", ev.id);
    const res = await api("/api/photos/submit", { method: "POST", form: fd });
    m.close();
    toast(`Mahalo! ${plural(res.received, "photo")} sent for review.`);
  });
  const m = modal(h("div", h("h2", ev ? `Share photos from ${ev.title}` : "Share photos"), form), { label: "Share photos" });
}

// ---------- polls ----------
export async function polls() {
  setTitle("Polls");
  const list = await api("/api/polls");
  const open = list.filter((p) => !p.closed), closed = list.filter((p) => p.closed);
  return h("div.wrap",
    h("div.page-head", h("h1.h1", "Polls")),
    open.length ? h("div.poll-list", open.map(pollRow)) : empty("No open polls right now."),
    closed.length ? h("section.section", h("h2.h3", { style: { marginBottom: "14px" } }, "Closed"), h("div.poll-list", closed.map(pollRow))) : null);
}

export async function pollPage({ slug }) {
  const p = await api(`/api/polls/${slug}`);
  setTitle(p.title);
  const page = h("div.wrap.poll-page");
  const patch = (body) => api(`/api/admin/polls/${p.id}`, { method: "PATCH", body });
  const head = h("div.page-head", link("/polls", { class: "back" }, icon("left", 18), "Polls"),
    ed(h("h1.h1", p.title), { label: "Poll title", save: (t) => patch({ title: t }) }),
    p.intro || EDIT.on ? ed(h("p.lede", p.intro || ""), { label: "Intro", placeholder: "Intro", save: (t) => patch({ intro: t }) }) : null,
    EDIT.on ? h("p", h("a.ed-action", { href: href(`/admin/polls/${p.id}?tab=build`) }, icon("edit", 16), "Edit questions")) : null,
    p.event ? h("p", link(`/events/${p.event.slug}`, { class: "text-link" }, p.event.title)) : null);
  page.append(head);
  if (p.closed) {
    page.append(p.tally ? results(p.tally) : h("p.lede", "This poll is closed."));
    return page;
  }
  const known = me.get();
  const form = h("form",
    p.questions.map((q, n) => h("fieldset.q",
      h("legend.q-prompt", h("span.n", n + 1), h("span", q.prompt, q.required ? h("span.req", { "aria-label": "required" }, " *") : null)),
      question(q))),
    p.collect_name ? h("div.q", h("div.two",
      field("Name", input("name", { value: known.name || "", required: true, autocomplete: "name" })),
      field("Email", input("email", { type: "email", value: known.email || "", required: p.one_per_email, autocomplete: "email" }), { optional: !p.one_per_email, hintText: p.one_per_email ? "One response per email. Sending again updates your answers." : null }))) : null,
    honeypot(),
    h("p.form-error"),
    h("button.btn", { type: "submit", style: { marginTop: "12px" } }, "Send"));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const answers = {};
    for (const q of p.questions) {
      const els = $$(`[name="q${q.id}"]`, form);
      if (q.kind === "multi") answers[q.id] = els.filter((x) => x.checked).map((x) => x.value);
      else if (q.kind === "text") answers[q.id] = els[0].value;
      else answers[q.id] = els.find((x) => x.checked)?.value ?? null;
    }
    const btn = form.querySelector("button[type=submit]"); btn.disabled = true;
    const err = $(".form-error", form); err.textContent = "";
    try {
      const body = { answers, name: form.name?.value, email: form.email?.value, website: form.website.value };
      const res = await api(`/api/polls/${slug}/respond`, { method: "POST", body });
      if (body.name) me.set({ name: body.name, email: body.email });
      clear(page).append(head, h("div.q", { style: { borderTop: "2px solid var(--ink)" } },
        h("h2.h2", res.updated ? "Your answers are updated." : "Mahalo for voting."),
        res.tally ? h("div", { style: { marginTop: "36px" } }, results(res.tally)) : h("p.lede", { style: { marginTop: "12px" } }, "Results will be shared by the club.")));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (ex) {
      err.textContent = ex.message;
      if (ex.field) form.querySelector(`[name="${ex.field}"]`)?.focus();
    } finally { btn.disabled = false; }
  });
  page.append(form);
  return page;
}

function question(q) {
  const name = `q${q.id}`;
  if (q.kind === "single" || q.kind === "multi") {
    return h("div.opts", q.options.map((o) => h("label.opt", { class: q.kind },
      h("input", { type: q.kind === "multi" ? "checkbox" : "radio", name, value: o, required: q.kind === "single" && q.required }),
      h("span.mark", icon("check")), o)));
  }
  if (q.kind === "rating") {
    return h("div", h("div.rating", [1, 2, 3, 4, 5].map((n) => h("label", h("input", { type: "radio", name, value: n, required: q.required, "aria-label": `${n} of 5` }), n))),
      h("div.rating-ends", h("span", "Not great"), h("span", "Loved it")));
  }
  return h("textarea", { name, rows: 3, required: q.required, "aria-label": q.prompt });
}

export function results(tally) {
  return h("div.results", tally.map((r) => {
    if (r.counts && r.kind !== "rating") {
      const total = r.kind === "multi" ? r.answered : r.counts.reduce((a, c) => a + c.n, 0);
      const max = Math.max(...r.counts.map((c) => c.n));
      return h("div.res", h("h3", r.prompt), r.counts.map((c) => h("div.res-bar", { class: c.n === max && max > 0 ? "top" : "" },
        h("span", c.option), h("div.track", h("span", { style: { width: `${total ? (c.n / total) * 100 : 0}%` } })),
        h("span.pct", total ? Math.round((c.n / total) * 100) + "%" : "0%"))),
        h("p.muted.small", plural(r.answered, "response")));
    }
    if (r.kind === "rating") {
      const max = Math.max(...r.counts.map((c) => c.n), 1);
      return h("div.res", h("h3", r.prompt), h("div.res-avg", r.average ?? "–", h("span.muted", { style: { fontSize: "18px", fontWeight: 600, letterSpacing: 0 } }, " out of 5")),
        r.counts.slice().reverse().map((c) => h("div.res-bar", h("span", `${c.option} ★`), h("div.track", h("span", { style: { width: `${(c.n / max) * 100}%` } })), h("span.pct", c.n))));
    }
    return h("div.res", h("h3", r.prompt), r.text?.length ? h("div.res-text", r.text.map((t) => h("p", t))) : h("p.muted", "No answers yet."));
  }));
}

// ---------- give ----------
export async function give() {
  setTitle("Give");
  const S = window.SITE;
  const handle = (S.venmo || "").replace(/^@/, "");
  const g = S.donate_goal || {};
  const saveHandle = async (t) => {
    const clean = t.replace(/^@/, "").trim();
    await saveSettings({ venmo: clean }, { redraw: true });
    return "@" + window.SITE.venmo;
  };
  if (!handle && !EDIT.on) return h("div.wrap", h("div.page-head", h("h1.h1", "Give")), empty("Donations aren't set up yet.", link("/contact", { class: "btn dark" }, "Contact us")));
  const qr = CFG.demo ? (window.MAHINA_DEMO.qr?.() || "") : "/api/donate/qr.svg";
  const uses = [...(S.donate_uses || [])];
  const usesList = h("ul.uses");
  const drawUses = () => {
    clear(usesList).append(uses.map((u, i) => h("li",
      ed(h("span", u), { label: "Use of funds", save: async (t) => {
        if (!t) throw new Error("Write something, or remove the line instead.");
        uses[i] = t; await saveSettings({ donate_uses: uses });
      } }),
      EDIT.on ? tool("close", "Remove", async () => { uses.splice(i, 1); await saveSettings({ donate_uses: uses }); drawUses(); }) : null)));
    if (EDIT.on) usesList.append(h("li.ed-add", action("Add a line", async () => {
      const v = await ask("Where it goes", [{ name: "text", label: "Line", attrs: { required: true, maxlength: 120 } }], { ok: "Add" });
      if (v?.text) { uses.push(v.text); await saveSettings({ donate_uses: uses }); drawUses(); }
    })));
  };
  drawUses();
  return h("div.wrap",
    h("div.page-head", h("h1.h1", "Give")),
    h("div.give",
      h("div.venmo",
        h("div", h("div.muted", { style: { color: "rgba(255,255,255,.65)", fontWeight: 600, marginBottom: "6px" } }, "Venmo"),
          ed(h("div.handle", handle ? "@" + handle : ""), { label: "Venmo handle", placeholder: "@YourClub", save: saveHandle })),
        handle ? h("div.qr", h("img", { src: qr, alt: `QR code for @${handle} on Venmo`, width: 188, height: 188 })) : null,
        handle ? h("div.row",
          h("a.btn", { href: `https://venmo.com/u/${handle}`, target: "_blank", rel: "noopener" }, "Open Venmo"),
          h("button.btn.ghost", { type: "button", onclick: () => copy("@" + handle) }, icon("copy", 18), "Copy handle")) : null),
      h("div",
        g.goal || EDIT.on ? h("div", { style: { marginBottom: "48px" } },
          ed(h("h2.h2", g.label || ""), { label: "Goal name", placeholder: "Goal name", save: (t) => saveSettings({ donate_goal: { ...g, label: t } }) }),
          goalBar(g)) : null,
        uses.length || EDIT.on ? h("div", h("h2.h3", "Where it goes"), usesList) : null)));
}

// ---------- contact ----------
export async function contact() {
  setTitle("Contact");
  const S = window.SITE;
  const known = me.get();
  const form = h("form",
    h("div.two",
      field("Name", input("name", { value: known.name || "", required: true, autocomplete: "name" })),
      field("Email", input("email", { type: "email", value: known.email || "", required: true, autocomplete: "email" }))),
    field("Subject", input("subject"), { optional: true }),
    field("Message", h("textarea", { name: "message", rows: 6, required: true })),
    h("label.check", h("input", { type: "checkbox", name: "subscribe" }), "Email me about club events"),
    honeypot(), h("p.form-error"),
    h("div", h("button.btn", { type: "submit" }, "Send message")));
  onSubmit(form, async (v) => {
    await api("/api/contact", { method: "POST", body: v });
    me.set({ name: v.name, email: v.email });
    form.replaceWith(h("div", h("h2.h2", "Message sent."), h("p.lede", { style: { marginTop: "12px" } }, "We'll get back to you soon.")));
  });
  const officers = (S.officers || []).map((o) => ({ ...o }));
  const offBox = h("div.officers");
  const saveOff = () => saveSettings({ officers });
  const drawOff = () => {
    clear(offBox).append(officers.map((o, i) => h("div.officer",
      ed(h("b", o.name), { label: "Officer name", placeholder: "Name", save: async (t) => { officers[i].name = t; await saveOff(); } }),
      h("span.row", { style: { gap: "6px" } },
        EDIT.on ? ed(h("span", o.role), { label: "Role", placeholder: "Role", save: async (t) => { officers[i].role = t; await saveOff(); } })
          : o.email ? h("a", { href: `mailto:${o.email}`, class: "text-link" }, o.role) : h("span", o.role),
        EDIT.on ? tool("mail", o.email ? `Email: ${o.email}` : "Add email", async () => {
          const v = await ask(`Email for ${o.name}`, [{ name: "email", label: "Email", type: "email", value: o.email, optional: true }]);
          if (v) { officers[i].email = v.email; try { await saveOff(); toast("Saved"); } catch (e) { officers[i].email = o.email; toast(e.message, "error"); } }
        }) : null,
        EDIT.on ? tool("close", `Remove ${o.name}`, async () => { officers.splice(i, 1); await saveOff(); drawOff(); }) : null))));
    if (EDIT.on) offBox.append(h("div.officer.ed-add", action("Add an officer", async () => {
      const v = await ask("Add an officer", [{ name: "name", label: "Name", attrs: { required: true } }, { name: "role", label: "Role", attrs: { required: true, placeholder: "Treasurer" } },
        { name: "email", label: "Email", type: "email", optional: true }], { ok: "Add" });
      if (v) { officers.push({ name: v.name, role: v.role, email: v.email }); try { await saveOff(); drawOff(); } catch (e) { officers.pop(); toast(e.message, "error"); } }
    })));
  };
  drawOff();
  return h("div.wrap",
    h("div.page-head", h("h1.h1", "Contact")),
    h("div.contact",
      form,
      h("div",
        officers.length || EDIT.on ? h("div", { style: { marginBottom: "40px" } }, h("h2.h3", { style: { marginBottom: "14px" } }, "Officers"), offBox) : null,
        S.email || EDIT.on ? h("div", h("h2.h3", { style: { marginBottom: "8px" } }, "Email"),
          EDIT.on ? ed(h("span.text-link", S.email || ""), { label: "Club email", placeholder: "club@example.com", save: (t) => saveSettings({ email: t }) })
            : h("a.text-link", { href: `mailto:${S.email}` }, S.email)) : null)));
}

// ---------- my sign-ups ----------
export async function mine({ token }) {
  setTitle("Your sign-ups");
  const data = await api(`/api/me/${token}`);
  me.set({ name: data.name, email: data.email });
  const list = h("div.mine");
  const rows = [
    ...data.rsvps.filter((r) => r.status !== "no").map((r) => ({ kind: "rsvp", id: r.id, at: r.starts_at, title: r.title, slug: r.slug,
      sub: `${longDate(parse(r.starts_at))}, ${time(parse(r.starts_at))}` + (r.guests ? `, you + ${r.guests}` : "") + (r.status === "maybe" ? ", maybe" : ""), what: "RSVP" })),
    ...data.signups.map((s) => ({ kind: "signup", id: s.id, at: s.starts_at || s.slot_start || "", title: `${s.slot}${s.item ? ": " + s.item : ""}`, slug: s.slug,
      sub: [s.event || s.sheet, s.starts_at ? longDate(parse(s.starts_at)) : null].filter(Boolean).join(", "), what: "Sign-up" })),
  ].sort((a, b) => (a.at || "").localeCompare(b.at || ""));
  const draw = () => {
    clear(list);
    if (!rows.length) return list.append(empty("Nothing coming up.", link("/events", { class: "btn dark" }, "Find an event")));
    rows.forEach((r) => list.append(h("div.mine-row",
      h("div", h("b", r.slug ? link(`/events/${r.slug}`, {}, r.title) : r.title), h("div.muted", r.sub)),
      h("button.btn.small.ghost", { type: "button", onclick: async () => {
        await api(`/api/me/${token}/cancel`, { method: "POST", body: { kind: r.kind, id: r.id } });
        rows.splice(rows.indexOf(r), 1); draw(); toast(r.kind === "rsvp" ? "RSVP cancelled" : "Sign-up cancelled");
      } }, r.kind === "rsvp" ? "Not going" : "Cancel"))));
  };
  draw();
  const remove = h("section.forget",
    h("h2", "Remove me"),
    h("p.muted", "Delete your name and email from the club's records: RSVPs, sign-ups, the mailing list, and messages you sent."),
    h("button.btn.ghost", { type: "button", onclick: async () => {
      if (!(await confirmBox("Delete your info? You'll be taken off every event and sign-up. This can't be undone.", { ok: "Delete my info" }))) return;
      await api(`/api/me/${token}/remove`, { method: "POST" });
      me.forget();
      clear(page).append(h("div.page-head", h("h1.h1", "You're removed."), h("p.lede", "Your name and email are deleted from the club's records.")),
        link("/", { class: "btn dark" }, "Go home"));
    } }, "Remove me"));
  const page = h("div.wrap", h("div.page-head", h("h1.h1", data.name ? `Aloha, ${data.name.split(" ")[0]}` : "Your sign-ups"),
    h("p.lede", data.email)), list, remove);
  return page;
}

// ---------- errors ----------
export function notFound() {
  setTitle("Not found");
  return h("div.wrap.notfound", h("h1.h1", "Nothing here."), h("p.lede", { style: { margin: "18px 0 28px" } }, "The page moved or the link has a typo."), link("/", { class: "btn dark" }, "Go home"));
}
export function errorPage(e) {
  if (e.status === 404) return h("div.wrap.notfound", h("h1.h1", "Nothing here."), h("p.lede", { style: { margin: "18px 0 28px" } }, e.message), link("/", { class: "btn dark" }, "Go home"));
  return h("div.wrap.notfound", h("h1.h1", "That didn't load."), h("p.lede", { style: { margin: "18px 0 28px" } }, e.message), h("button.btn.dark", { onclick: () => location.reload() }, "Reload"));
}
