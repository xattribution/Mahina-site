// Events: timeline, calendar, event page, sign-up sheets.
import { h, $, $$, api, clear, go, href, icon, link, hint, parse, time, timeRange, longDate, shortDate, monthName, weekday,
  clubNow, isoLocal, relDays, anchor, googleCal, me, toast, field, input, onSubmit, honeypot, tagChip, empty, plural, query,
  setTitle, media, CFG } from "./core.js";
import { fullMoons, moonSVG, moonInfo } from "./moon.js";
import { EDIT, ed, tool, action, ask, patchEvent, pickImage, rebuild } from "./edit.js";

const tagColor = (ev) => ev.tags?.[0]?.color || "night";

// ---------- timeline ----------
export function timeline(events, { compact = false, from = null } = {}) {
  const now = clubNow();
  const items = [];
  const sorted = [...events].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  if (!sorted.length) return empty("Nothing on the calendar yet.");
  const first = parse(sorted[0].starts_at), last = parse(sorted[sorted.length - 1].starts_at);
  const moons = fullMoons(new Date(first.getTime() - 86400000 * 3), new Date(last.getTime() + 86400000 * 3)).map((d) => {
    const s = d.toLocaleString("sv-SE", { timeZone: window.SITE?.timezone || "Pacific/Honolulu" }).replace(" ", "T");
    return { kind: "moon", at: s.slice(0, 16) };
  });
  const stream = [...sorted.map((e) => ({ kind: "event", at: e.starts_at, e })), ...moons, { kind: "today", at: isoLocal(now) }]
    .sort((a, b) => a.at.localeCompare(b.at) || (a.kind === "today" ? -1 : 1));
  let month = null;
  for (const s of stream) {
    const d = parse(s.at);
    const m = d.getFullYear() * 12 + d.getMonth();
    if (s.kind !== "today" && m !== month) {
      month = m;
      const label = monthName(d) + (d.getFullYear() !== now.getFullYear() ? " " + d.getFullYear() : "");
      items.push(h("div.tl-month", h("span", label)));
    }
    if (s.kind === "today") items.push(h("div.tl-today", { id: "tl-today" }, h("span", "Today")));
    else if (s.kind === "moon") items.push(h("div.tl-moon", { title: `Full moon, ${shortDate(d)}` }, moonSVG(0.5, 20, { maria: false })));
    else items.push(tlItem(s.e, now));
  }
  const track = h("div.tl-track", items);
  const tl = h("div.timeline", { class: compact ? "compact" : "", tabindex: 0, "aria-label": "Event timeline" }, track);
  requestAnimationFrame(() => {
    const t = $("#tl-today", tl);
    if (t && window.innerWidth > 720) tl.scrollLeft = Math.max(0, t.offsetLeft - (compact ? 260 : 320));
  });

  // Scroll-to-step: over the timeline, the wheel (or arrow keys/buttons) moves one event at a time,
  // centers it, and opens it. Past either end, the page scrolls as usual.
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const evItems = () => $$(".tl-item", track);
  const px = (el, v) => parseFloat(getComputedStyle(el).getPropertyValue(v)) || 0;
  let focus = -1;
  const settledLeft = (target) => {
    // Widths animate, so add up the widths each item is heading to rather than reading offsetLeft.
    let x = px(track, "padding-left");
    for (const c of track.children) {
      if (c === target) return x;
      x += c.classList.contains("tl-item") ? px(c, c.classList.contains("open") ? "--open" : "--w") : c.offsetWidth;
    }
    return x;
  };
  const nearest = () => {
    const mid = tl.scrollLeft + tl.clientWidth / 2;
    let best = 0, dist = Infinity;
    evItems().forEach((it, i) => { const d = Math.abs(it.offsetLeft + it.offsetWidth / 2 - mid); if (d < dist) { dist = d; best = i; } });
    return best;
  };
  const clearFocus = () => { focus = -1; evItems().forEach((x) => x.classList.remove("open", "centered")); };
  const focusOn = (i) => {
    const list = evItems();
    focus = Math.max(0, Math.min(list.length - 1, i));
    list.forEach((x, k) => x.classList.toggle("open", k === focus));
    const it = list[focus];
    tl.scrollTo({ left: settledLeft(it) + (px(it, "--open") - 28) / 2 - tl.clientWidth / 2, behavior: reduced ? "auto" : "smooth" });
  };
  const step = (dir) => {
    const list = evItems();
    const next = focus < 0 ? nearest() : focus + dir;
    if (next < 0 || next >= list.length) return false;
    focusOn(next);
    return true;
  };
  let acc = 0, lastStep = 0;
  tl.addEventListener("wheel", (e) => {
    if (window.innerWidth <= 720 || e.ctrlKey) return;
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    const dir = Math.sign(d);
    if (!dir) return;
    const list = evItems();
    if (focus >= 0 && ((dir > 0 && focus >= list.length - 1) || (dir < 0 && focus <= 0))) { tl.classList.remove("stepping"); return; }
    e.preventDefault();
    tl.classList.add("stepping");
    acc += d * (e.deltaMode === 1 ? 40 : 1);
    const t = performance.now();
    if (Math.abs(acc) < 40 || t - lastStep < 170) return;
    acc = 0; lastStep = t;
    step(dir);
  }, { passive: false });
  // Real pointer movement hands control back to hover.
  tl.addEventListener("mousemove", (e) => { if (e.movementX || e.movementY) tl.classList.remove("stepping"); });
  track.addEventListener("mouseover", (e) => {
    if (tl.classList.contains("stepping")) return;
    const it = e.target.closest(".tl-item");
    if (it && focus >= 0 && !it.classList.contains("open")) clearFocus();
  });
  tl.addEventListener("keydown", (e) => {
    if (window.innerWidth <= 720 || (e.key !== "ArrowRight" && e.key !== "ArrowLeft")) return;
    e.preventDefault();
    tl.classList.add("stepping");
    step(e.key === "ArrowRight" ? 1 : -1);
  });
  enableDrag(tl, clearFocus);

  const press = (dir) => { tl.classList.add("stepping"); step(dir); };
  const arrows = h("div.tl-arrows",
    h("button.icon-btn", { type: "button", "aria-label": "Earlier event", onclick: () => press(-1) }, icon("left")),
    h("button.icon-btn", { type: "button", "aria-label": "Later event", onclick: () => press(1) }, icon("right")));
  return { el: tl, arrows };
}

function tlItem(ev, now) {
  const d = parse(ev.starts_at);
  const past = d < now;
  const rel = relDays(d);
  const cover = ev.cover ? h("img", { src: media(ev.cover.thumb), alt: "", loading: "lazy" }) : null;
  const actions = [];
  if (!past && ev.status !== "cancelled") {
    if (ev.signup?.open) actions.push(link(`/events/${ev.slug}#signups`, { class: "btn small" }, "Sign up"));
    else if (ev.rsvp_enabled) actions.push(link(`/events/${ev.slug}#rsvp`, { class: "btn small" }, "RSVP"));
  }
  if (past && ev.photos) actions.push(link(`/gallery?event=${ev.slug}`, { class: "btn small dark" }, icon("camera", 16), "Photos"));
  actions.push(link(`/events/${ev.slug}`, { class: "btn small ghost" }, "Details"));
  const item = h("div.tl-item", { class: `c-${tagColor(ev)}` + (past ? " past" : "") + (ev.status === "cancelled" ? " cancelled" : ""), tabindex: -1 },
    h("div.tl-cover", cover),
    h("div.tl-date", h("span.d", d.getDate()), h("span.w", weekday(d) + (ev.all_day ? "" : " " + time(d)))),
    h("span.tl-node"),
    h("div.tl-body",
      link(`/events/${ev.slug}`, { class: "tl-title" }, ev.title),
      h("div.tl-when", ev.status === "cancelled" ? "Cancelled" : past ? (ev.photos ? plural(ev.photos, "photo") : "Done") : rel || ev.location),
      h("div.tl-more", h("div",
        cover ? h("div.tl-m-cover", h("img", { src: media(ev.cover.thumb), alt: "", loading: "lazy" })) : null,
        h("div.tl-meta",
          h("span", icon("clock"), timeRange(ev)),
          ev.location ? h("span", icon("pin"), ev.location) : null,
          ev.going ? h("span", icon("people"), `${ev.going} ${past ? "went" : "going"}`) : null,
          !past && ev.signup ? h("span.tl-badge", icon("list"), ev.signup.open ? `${ev.signup.open} sign-up spots open` : "Sign-ups full") : null),
        h("div.tl-actions", actions)))));
  item.addEventListener("click", (e) => {
    if (window.innerWidth <= 720 && !e.target.closest("a")) {
      $$(".tl-item.open").forEach((x) => x !== item && x.classList.remove("open"));
      item.classList.toggle("open");
    }
  });
  return item;
}

function enableDrag(el, onStart = () => {}) {
  let down = null, moved = false;
  el.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse" || e.button !== 0 || window.innerWidth <= 720) return;
    down = { x: e.clientX, left: el.scrollLeft }; moved = false;
  });
  window.addEventListener("pointermove", (e) => {
    if (!down) return;
    const dx = e.clientX - down.x;
    if (Math.abs(dx) > 5 && !moved) { moved = true; el.classList.add("dragging"); onStart(); }
    if (moved) el.scrollLeft = down.left - dx;
  });
  window.addEventListener("pointerup", () => { down = null; setTimeout(() => el.classList.remove("dragging"), 0); });
  el.addEventListener("click", (e) => { if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; } }, true);
}

// ---------- calendar ----------
function calendar(events, state, rerender) {
  const now = clubNow();
  const y = state.y, m = state.m;
  const first = new Date(y, m, 1);
  const start = new Date(y, m, 1 - first.getDay());
  const days = [];
  const byDay = {};
  events.forEach((e) => (byDay[e.starts_at.slice(0, 10)] ||= []).push(e));
  const moons = new Set(fullMoons(new Date(y, m - 1, 20), new Date(y, m + 1, 10)).map((d) =>
    d.toLocaleString("sv-SE", { timeZone: window.SITE?.timezone || "Pacific/Honolulu" }).slice(0, 10)));
  const cells = Math.ceil((first.getDay() + new Date(y, m + 1, 0).getDate()) / 7) * 7;
  for (let i = 0; i < cells; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const key = isoLocal(d).slice(0, 10);
    const today = key === isoLocal(now).slice(0, 10);
    days.push(h("div.cal-day", { class: (d.getMonth() !== m ? "out" : "") + (today ? " today" : "") },
      h("span.cal-n", { "aria-label": longDate(d) }, d.getDate()),
      moons.has(key) ? h("span", { title: "Full moon" }, moonSVG(0.5, 14, { maria: false, className: "moon cal-moon" })) : null,
      (byDay[key] || []).map((e) => link(`/events/${e.slug}`, { class: `cal-ev c-${tagColor(e)}` + (parse(e.starts_at) < now ? " past" : ""), style: { background: "var(--c)" }, title: e.title },
        e.all_day ? null : h("span.t", time(parse(e.starts_at))), e.title))));
  }
  const monthEvents = events.filter((e) => e.starts_at.startsWith(`${y}-${String(m + 1).padStart(2, "0")}`));
  const move = (n) => { const d = new Date(y, m + n, 1); state.y = d.getFullYear(); state.m = d.getMonth(); rerender(); };
  return h("div",
    h("div.cal-head",
      h("h2", `${monthName(first)} ${y}`),
      h("button.icon-btn", { type: "button", "aria-label": "Previous month", onclick: () => move(-1) }, icon("left")),
      h("button.icon-btn", { type: "button", "aria-label": "Next month", onclick: () => move(1) }, icon("right")),
      (y !== now.getFullYear() || m !== now.getMonth()) ? h("button.btn.small.ghost", { type: "button", onclick: () => { state.y = now.getFullYear(); state.m = now.getMonth(); rerender(); } }, "This month") : null),
    h("div.cal", ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => h("div.cal-dow", d)), days),
    h("div.cal-list", monthEvents.length ? h("div.sheet-list", monthEvents.map(eventRow)) : h("p.muted", "No events this month.")));
}

function eventRow(e) {
  const d = parse(e.starts_at);
  return link(`/events/${e.slug}`, { class: "sheet-link" },
    h("div.when", h("span.d", d.getDate()), h("span.m", `${monthName(d, "short")} ${weekday(d)}`)),
    h("div", h("h3", e.title), h("div.sub", `${timeRange(e)}, ${e.location}`)));
}

// ---------- events list ----------
// The full schedule, stacked vertically and grouped by month. Upcoming first, then earlier events newest first.
function eventList(events) {
  const now = clubNow();
  const today = isoLocal(now).slice(0, 10);
  const isPast = (e) => (e.ends_at || e.starts_at).slice(0, 10) < today;
  const upcoming = events.filter((e) => !isPast(e)).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const past = events.filter(isPast).sort((a, b) => b.starts_at.localeCompare(a.starts_at));
  const group = (list) => {
    const out = [];
    let month = null;
    for (const e of list) {
      const d = parse(e.starts_at);
      const m = d.getFullYear() * 12 + d.getMonth();
      if (m !== month) {
        month = m;
        out.push(h("div.ev-month", h("span", monthName(d) + (d.getFullYear() !== now.getFullYear() ? " " + d.getFullYear() : ""))));
      }
      out.push(evRow(e, now, isPast(e)));
    }
    return out;
  };
  if (!upcoming.length && !past.length) return empty("Nothing on the calendar yet.");
  return h("div.ev-list",
    upcoming.length ? group(upcoming) : h("p.muted.ev-none", "Nothing scheduled yet. Check back soon."),
    past.length ? h("h2.ev-earlier", "Earlier") : null,
    past.length ? h("div.ev-past", group(past)) : null);
}

function evRow(ev, now, past) {
  const d = parse(ev.starts_at);
  const cancelled = ev.status === "cancelled";
  const rel = relDays(d);
  const actions = [];
  if (!past && !cancelled) {
    if (ev.signup?.open) actions.push(link(`/events/${ev.slug}#signups`, { class: "btn small" }, "Sign up"));
    else if (ev.rsvp_enabled) actions.push(link(`/events/${ev.slug}#rsvp`, { class: "btn small" }, "RSVP"));
  }
  if (past && ev.photos) actions.push(link(`/gallery?event=${ev.slug}`, { class: "btn small dark" }, icon("camera", 16), plural(ev.photos, "photo")));
  return h("article.ev-row", { class: `c-${tagColor(ev)}` + (past ? " past" : "") + (cancelled ? " cancelled" : "") },
    h("div.ev-date", h("span.d", d.getDate()), h("span.w", weekday(d))),
    h("span.ev-node", { "aria-hidden": "true" }),
    h("div.ev-body",
      h("div.ev-when", cancelled ? h("b", "Cancelled") : !past && rel ? h("b", rel) : null, h("span", timeRange(ev))),
      link(`/events/${ev.slug}`, { class: "ev-title" }, ev.title),
      ev.summary ? h("p.ev-sum", ev.summary) : null,
      h("div.ev-meta",
        ev.location ? h("span", icon("pin", 16), ev.location) : null,
        ev.going ? h("span", icon("people", 16), `${ev.going} ${past ? "went" : "going"}`) : null,
        !past && ev.signup ? h("span", icon("list", 16), ev.signup.open ? `${plural(ev.signup.open, "spot")} open` : "Sign-ups full") : null,
        ev.tags.map((t) => h("span.tag", { class: `c-${t.color}` }, h("span.dot"), t.name))),
      actions.length ? h("div.ev-actions", actions) : null),
    ev.cover ? link(`/events/${ev.slug}`, { class: "ev-cover", tabindex: -1, "aria-hidden": "true" }, h("img", { src: media(ev.cover.thumb), alt: "", loading: "lazy" })) : h("span.ev-cover.none"));
}

// ---------- events page ----------
export async function eventsPage() {
  setTitle("Events");
  const now = clubNow();
  const from = new Date(now); from.setMonth(from.getMonth() - 3);
  const events = await api(`/api/events?start=${isoLocal(from).slice(0, 10)}`);
  const q = query();
  const state = { view: q.get("view") === "calendar" ? "calendar" : "list", tag: q.get("tag") || "", y: now.getFullYear(), m: now.getMonth() };
  const usedTags = (window.SITE.tags || []).filter((t) => events.some((e) => e.tags.some((x) => x.id === t.id)));
  const body = h("div.wrap");
  const controls = h("div.tl-controls");
  function rerender() {
    const list = state.tag ? events.filter((e) => e.tags.some((t) => t.slug === state.tag)) : events;
    const chips = h("div.tags", tagChip({ name: "All", slug: "", color: "night" }, { active: !state.tag, onclick: () => { state.tag = ""; rerender(); } }),
      usedTags.map((t) => tagChip(t, { active: state.tag === t.slug, onclick: () => { state.tag = state.tag === t.slug ? "" : t.slug; rerender(); } })));
    const seg = h("div.seg", { role: "group", "aria-label": "View" },
      h("button", { type: "button", "aria-pressed": String(state.view === "list"), onclick: () => { state.view = "list"; rerender(); } }, icon("list", 16), "List"),
      h("button", { type: "button", "aria-pressed": String(state.view === "calendar"), onclick: () => { state.view = "calendar"; rerender(); } }, icon("calendar", 16), "Calendar"));
    clear(controls).append(chips, seg);
    clear(body).append(state.view === "list" ? eventList(list) : calendar(list, state, rerender));
  }
  rerender();
  return h("div",
    h("div.wrap.page-head", h("h1.h1", "Events")),
    h("div.wrap", controls),
    body);
}

// ---------- event page ----------
export async function eventPage({ slug }) {
  const ev = await api(`/api/events/${slug}`);
  setTitle(ev.title);
  const d = parse(ev.starts_at);
  const now = clubNow();
  const past = (ev.ends_at ? parse(ev.ends_at) : d) < now;
  const icsHref = CFG.demo ? "#" : `/api/events/${ev.slug}/calendar.ics`;
  const place = ev.location ? (ev.map_url ? h("a", { href: ev.map_url, target: "_blank", rel: "noopener" }, ev.location)
    : h("a", { href: `https://maps.google.com/?q=${encodeURIComponent(ev.location)}`, target: "_blank", rel: "noopener" }, ev.location)) : null;

  const side = past || ev.status === "cancelled" ? pastPanel(ev, past) : rsvpPanel(ev);
  const save = (body) => patchEvent(ev.id, body);
  const editWhen = async () => {
    const [sd, st] = ev.starts_at.split("T"), et = (ev.ends_at || "").split("T")[1] || "";
    const v = await ask("Date and time", [
      { name: "date", label: "Date", type: "date", value: sd, attrs: { required: true } },
      { name: "start", label: "Starts", type: "time", value: ev.all_day ? "" : st, attrs: { step: 300 } },
      { name: "end", label: "Ends", type: "time", value: ev.all_day ? "" : et, attrs: { step: 300 }, optional: true },
      { name: "all_day", label: "All day", type: "check", value: ev.all_day }]);
    if (!v) return;
    try {
      await save({ starts_at: `${v.date}T${v.all_day ? "00:00" : v.start || "00:00"}`,
        ends_at: v.all_day ? `${v.date}T23:59` : v.end ? `${v.date}T${v.end}` : "", all_day: v.all_day });
      toast("Saved"); rebuild();
    } catch (e) { toast(e.message, "error"); }
  };
  const swapCover = async () => {
    try { const p = await pickImage(); await save({ cover_photo_id: p.id, _cover: p }); toast("Photo changed"); rebuild(); }
    catch (e) { if (e.message !== "No photo chosen.") toast(e.message, "error"); }
  };
  const coverEl = ev.cover ? h("img.ev-cover", { src: media(ev.cover.src), alt: "" }) : null;
  const heroEl = EDIT.on
    ? h("div.ev-hero", coverEl || h("div.ev-cover-empty"),
      h("div.ed-tools.ed-cover", action(ev.cover ? "Change photo" : "Add a cover photo", swapCover, "image"),
        ev.cover ? tool("trash", "Remove photo", async () => { await save({ cover_photo_id: null, _cover: null }); rebuild(); }) : null))
    : h("div.ev-hero", coverEl);
  const placeEl = EDIT.on
    ? h("div.fact", icon("pin"), ed(h("span", ev.location || ""), { label: "Place", placeholder: "Where", save: (t) => save({ location: t }) }))
    : place ? h("div.fact", icon("pin"), place) : null;
  const desc = ev.description || (EDIT.on ? "" : ev.summary);
  const page = h("article",
    heroEl,
    h("div.wrap.ev-head",
      h("div",
        link("/events", { class: "back" }, icon("left", 18), "Events"),
        ev.status === "cancelled" ? h("div.ev-status", "Cancelled") : null,
        ed(h("h1.h1", ev.title), { label: "Event title", save: (t) => save({ title: t }).then((r) => { setTitle(r.title); return r.title; }) }),
        h("div.facts",
          h("div.fact", icon("calendar"), h("div", longDate(d), relDays(d) && !past ? h("small", relDays(d)) : null),
            EDIT.on ? tool("edit", "Change date and time", editWhen) : null),
          h("div.fact", icon("clock"), timeRange(ev), EDIT.on ? tool("edit", "Change date and time", editWhen) : null),
          placeEl),
        ev.tags.length ? h("div.tags", ev.tags.map((t) => tagChip(t, { as: "a" }))) : null,
        desc || EDIT.on ? ed(h("div.ev-desc", desc || ""), { multiline: true, label: "Details", placeholder: "Details", save: (t) => save({ description: t }) }) : null,
        ev.polls.length ? h("div", { style: { marginTop: "28px" } }, ev.polls.map((p) =>
          link(`/polls/${p.slug}`, { class: "btn ghost" }, icon("poll", 18), p.title))) : null,
        EDIT.on ? h("p", { style: { marginTop: "28px" } }, h("a.ed-action", { href: href(`/admin/events/${ev.id}`) }, icon("gear", 16), "More event settings")) : null),
      side),
    ev.sheets.length ? h("section.wrap#signups", ev.sheets.map((s) => sheetView(s, { past })))
      : EDIT.on ? h("section.wrap#signups", h("div.ed-hidden", h("b", "Sign-ups"),
        h("a.ed-action", { href: href(`/admin/events/${ev.id}?tab=signups`) }, icon("plus", 16), "Add a sign-up"))) : null,
    ev.gallery.length ? h("section.wrap.section",
      h("div.section-head", h("h2.h2", "Photos"), link(`/gallery?event=${ev.slug}`, { class: "text-link" }, `See all ${ev.photos}`)),
      h("div.strip", ev.gallery.slice(0, 8).map((p) => link(`/gallery?event=${ev.slug}&photo=${p.id}`, { class: "photo-tile" }, h("img", { src: media(p.thumb), alt: p.caption, loading: "lazy" }))))) : null);
  const target = anchor();
  if (target) setTimeout(() => document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  return page;
}

function pastPanel(ev, past) {
  return h("aside.rsvp",
    h("h3", ev.status === "cancelled" ? "This event is cancelled" : "This event has ended"),
    ev.going ? h("p.going", icon("people", 18), `${ev.going} went`) : null,
    h("div.row", ev.photos ? link(`/gallery?event=${ev.slug}`, { class: "btn dark" }, icon("camera", 18), "See photos") : null,
      window.SITE.public_uploads && past ? h("button.btn.ghost", { type: "button", onclick: () => import("./pages.js").then((P) => P.shareDialog(ev)) }, "Share yours") : null));
}

function rsvpPanel(ev) {
  const box = h("aside.rsvp#rsvp");
  const draw = (done) => {
    clear(box);
    if (!ev.rsvp_enabled) {
      box.append(h("h3", "Add it to your calendar"), h("div.cal-links", { style: { marginTop: "14px" } }, calButtons(ev)));
      return;
    }
    if (done) {
      box.append(h("div.rsvp-done",
        h("div.big", icon("check"), done.already ? "You're already going" : "You're going"),
        h("p.muted", { style: { margin: 0 } }, done.already
          ? "We sent the link to change or cancel to your email again."
          : "Check your email for your confirmation and a link to change or cancel."),
        h("div.cal-links", calButtons(ev))));
      return;
    }
    const known = me.get();
    let guests = 0;
    const out = h("output", "0");
    const full = ev.capacity && ev.spots_left <= 0;
    const form = h("form",
      field("Name", input("name", { autocomplete: "name", value: known.name || "", required: true })),
      field("Email", input("email", { type: "email", autocomplete: "email", value: known.email || "", required: true })),
      h("div.row", { style: { justifyContent: "space-between" } },
        h("span.field-label", "Guests", hint("Family or friends coming with you.")),
        h("div.stepper",
          h("button", { type: "button", "aria-label": "Fewer guests", onclick: () => { guests = Math.max(0, guests - 1); out.value = guests; } }, icon("minus", 18)),
          out,
          h("button", { type: "button", "aria-label": "More guests", onclick: () => { guests = Math.min(20, guests + 1); out.value = guests; } }, icon("plus", 18)))),
      h("label.check", h("input", { type: "checkbox", name: "subscribe", checked: !known.email }), "Email me about future events"),
      honeypot(),
      h("p.form-error"),
      h("button.btn.block", { type: "submit", disabled: full }, full ? "Full" : "I'm going"));
    onSubmit(form, async (v) => {
      const res = await api(`/api/events/${ev.slug}/rsvp`, { method: "POST", body: { ...v, guests, status: "going" } });
      me.set({ name: v.name, email: v.email });
      if (v.subscribe) api("/api/subscribe", { method: "POST", body: { email: v.email, name: v.name, source: "rsvp" } }).catch(() => {});
      ev.going = res.going;
      draw(res);
    });
    box.append(h("h3", "Are you coming?"),
      h("p.going", icon("people", 18), ev.going ? `${ev.going} going` : "Be the first to RSVP",
        ev.capacity ? h("span", ` of ${ev.capacity}`) : null),
      form);
  };
  draw(null);
  return box;
}

function calButtons(ev) {
  return [h("a.btn.small.ghost", { href: googleCal(ev), target: "_blank", rel: "noopener" }, "Google Calendar"),
    h("a.btn.small.ghost", { href: CFG.demo ? "#" : `/api/events/${ev.slug}/calendar.ics`, download: `${ev.slug}.ics` }, "Apple / Outlook")];
}

// ---------- sign-up sheet ----------
export function sheetView(sheet, { past = false, showEvent = false } = {}) {
  const wrap = h("div.sheet", { id: `sheet-${sheet.id}` });
  const draw = () => {
    clear(wrap);
    const open = !sheet.closed && !past;
    const patch = (body) => api(`/api/admin/sheets/${sheet.id}`, { method: "PATCH", body });
    wrap.append(
      h("div.sheet-head",
        h("div", ed(h("h2.h3", sheet.title), { label: "Sign-up title", save: (t) => patch({ title: t }) }),
          sheet.description || EDIT.on ? ed(h("p", sheet.description || ""), { label: "Sign-up note", placeholder: "Note", save: (t) => patch({ description: t }) }) : null,
          showEvent && sheet.event ? h("p", link(`/events/${sheet.event.slug}`, { class: "text-link" }, sheet.event.title)) : null),
        h("div.sheet-meter", sheet.closed ? "Closed" : `${sheet.filled} of ${sheet.capacity} filled`)),
      h("div.slots", sheet.slots.map((sl) => slotRow(sheet, sl, open, draw)),
        EDIT.on ? h("div.slot.ed-add", action("Add a slot", async () => {
          const v = await ask("Add a slot", [{ name: "title", label: "Slot", attrs: { required: true, placeholder: "Dessert" } },
            { name: "capacity", label: "How many people", type: "number", value: 1, attrs: { min: 1, max: 999, required: true } },
            { name: "ask_item", label: "Ask what they're bringing", type: "check" }], { ok: "Add" });
          if (!v) return;
          try {
            const r = await api(`/api/admin/sheets/${sheet.id}/slots`, { method: "POST", body: v });
            sheet.slots.push({ id: r.id, title: v.title, note: "", capacity: Number(v.capacity), taken: 0, left: Number(v.capacity), ask_item: v.ask_item, people: [] });
            sheet.capacity += Number(v.capacity); draw();
          } catch (e) { toast(e.message, "error"); }
        })) : null));
  };
  draw();
  return wrap;
}

function slotRow(sheet, sl, open, redraw) {
  const row = h("div.slot");
  const pips = sl.capacity <= 16
    ? h("div.pips", { "aria-hidden": "true" }, Array.from({ length: sl.capacity }, (_, i) => h("i", { class: i < sl.taken ? "" : "free" })))
    : h("div.fill-meter", { style: { textAlign: "left" } }, h("div.bar", h("span", { style: { width: `${(sl.taken / sl.capacity) * 100}%` } })));
  const people = sl.people?.length ? h("div.slot-people", sl.people.map((p) => h("span", p.name, p.item ? h("em", ` (${p.item})`) : null, p.qty > 1 ? ` ×${p.qty}` : null))) : null;
  const formHost = h("div.slot-form");
  const btn = !open ? null : sl.left > 0
    ? h("button.btn.small", { type: "button", "aria-expanded": "false", onclick: () => toggle() }, "Sign up")
    : h("span.full-label", "Full");
  function toggle() {
    const isOpen = formHost.childElementCount > 0;
    $$(".slot-form").forEach((f) => clear(f));
    $$(".slot [aria-expanded=true]").forEach((b) => b.setAttribute("aria-expanded", "false"));
    if (isOpen) return;
    btn.setAttribute("aria-expanded", "true");
    const known = me.get();
    const form = h("form",
      field("Name", input("name", { autocomplete: "name", value: known.name || "", required: true })),
      field("Email", input("email", { type: "email", autocomplete: "email", value: known.email || "", required: true })),
      sl.ask_item ? field("What are you bringing?", input("item", { required: true, placeholder: sl.note || "" })) : null,
      sl.left > 1 ? field("How many", h("select", { name: "qty" }, Array.from({ length: Math.min(sl.left, 10) }, (_, i) => h("option", { value: i + 1 }, i + 1)))) : null,
      honeypot(),
      h("button.btn", { type: "submit" }, "Sign up"),
      h("p.form-error"));
    onSubmit(form, async (v) => {
      const res = await api(`/api/slots/${sl.id}/signup`, { method: "POST", body: v });
      me.set({ name: v.name, email: v.email });
      const qty = Number(v.qty || 1);
      sl.taken += qty; sl.left -= qty; sheet.filled += qty;
      (sl.people ||= []).push({ name: v.name.split(" ")[0] + (v.name.split(" ")[1] ? " " + v.name.split(" ").pop()[0] + "." : ""), item: v.item || "", qty });
      toast(`You're signed up for ${sl.title}`);
      redraw();
    });
    formHost.append(form);
    form.querySelector("input:not([value]), input[value='']")?.focus();
  }
  const slotPatch = (body) => api(`/api/admin/slots/${sl.id}`, { method: "PATCH", body });
  const editTools = EDIT.on ? h("span.ed-tools",
    tool("people", "Change how many", async () => {
      const v = await ask(`How many for ${sl.title}?`, [{ name: "capacity", label: "People", type: "number", value: sl.capacity, attrs: { min: Math.max(1, sl.taken), max: 999, required: true } }]);
      if (!v) return;
      try { await slotPatch({ capacity: Number(v.capacity) }); sheet.capacity += Number(v.capacity) - sl.capacity; sl.capacity = Number(v.capacity); sl.left = sl.capacity - sl.taken; redraw(); toast("Saved"); }
      catch (e) { toast(e.message, "error"); }
    }),
    sl.taken ? null : tool("trash", `Remove ${sl.title}`, async () => {
      try { await api(`/api/admin/slots/${sl.id}`, { method: "DELETE" }); sheet.slots.splice(sheet.slots.indexOf(sl), 1); sheet.capacity -= sl.capacity; redraw(); }
      catch (e) { toast(e.message, "error"); }
    })) : null;
  row.append(
    h("div.slot-row",
      h("div.slot-title", ed(h("span", sl.title), { label: "Slot name", save: async (t) => { await slotPatch({ title: t }); sl.title = t; } }), sl.starts_at ? h("small", timeRange({ starts_at: sl.starts_at, ends_at: sl.ends_at })) : sl.note && !sl.ask_item ? h("small", sl.note) : null),
      h("div.slot-fill", pips, h("div.slot-count", sl.left ? `${sl.taken} of ${sl.capacity}` : `All ${sl.capacity} filled`), people),
      EDIT.on ? editTools : btn),
    formHost);
  return row;
}

// ---------- sign-ups index ----------
export async function signupsPage() {
  setTitle("Sign up");
  const sheets = await api("/api/sheets");
  const groups = new Map();
  sheets.forEach((s) => {
    const key = s.event ? s.event.slug : `s${s.id}`;
    if (!groups.has(key)) groups.set(key, { event: s.event, sheets: [] });
    groups.get(key).sheets.push(s);
  });
  const rows = [...groups.values()].map((g) => {
    const filled = g.sheets.reduce((a, s) => a + s.filled, 0), cap = g.sheets.reduce((a, s) => a + s.capacity, 0);
    const d = g.event ? parse(g.event.starts_at) : null;
    return link(g.event ? `/events/${g.event.slug}#signups` : `/signups/${g.sheets[0].id}`, { class: "sheet-link" },
      h("div.when", d ? [h("span.d", d.getDate()), h("span.m", `${monthName(d, "short")} ${weekday(d)}`)] : h("span.d", icon("list", 34))),
      h("div", h("h3", g.event ? g.event.title : g.sheets[0].title),
        h("div.sub", g.sheets.map((s) => s.title).join(", "))),
      h("div.fill-meter", h("b.num", cap - filled), h("span.muted", " spots open"), h("div.bar", h("span", { style: { width: `${cap ? (filled / cap) * 100 : 0}%` } }))));
  });
  return h("div.wrap",
    h("div.page-head", h("h1.h1", "Sign up")),
    rows.length ? h("div.sheet-list", rows) : empty("No open sign-ups right now.", link("/events", { class: "btn dark" }, "See events")));
}

export async function sheetPage({ id }) {
  const s = await api(`/api/sheets/${id}`);
  setTitle(s.title);
  if (s.event) { go(`/events/${s.event.slug}#signups`, { replace: true }); return h("div"); }
  return h("div.wrap", h("div.page-head", link("/signups", { class: "back" }, icon("left", 18), "Sign up"), h("h1.h1", s.title),
    s.description ? h("p.lede", s.description) : null), sheetView({ ...s, description: "" }));
}
