// Events: timeline, calendar, event page, sign-up sheets.
import { h, $, $$, api, clear, go, href, icon, link, hint, parse, time, timeRange, longDate, shortDate, monthName, weekday,
  clubNow, isoLocal, relDays, anchor, googleCal, me, toast, field, input, onSubmit, honeypot, tagChip, empty, plural, query,
  setTitle, media, CFG, modal } from "./core.js";
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
  const thumb = h("span.tl-thumb");
  const rail = h("div.tl-rail", { "aria-hidden": "true" }, thumb);
  const wrap = h("div.tl-wrap", tl, h("div.wrap", rail));

  // Scrolling model: one animation loop owns scrollLeft. Wheel, keys, the rail, and snapping all move a target,
  // and the loop eases toward it, so inputs never fight each other. When input stops, the nearest event
  // glides to the center and opens. Past either end, the wheel goes back to scrolling the page.
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const desktop = () => window.innerWidth > 720;
  const evItems = () => $$(".tl-item", track);
  const px = (el, v) => parseFloat(getComputedStyle(el).getPropertyValue(v)) || 0;
  const maxLeft = () => Math.max(0, tl.scrollWidth - tl.clientWidth);
  const clamp = (x) => Math.max(0, Math.min(maxLeft(), x));
  let focus = -1, target = 0, raf = 0, settleTimer = 0;

  const loop = () => {
    const cur = tl.scrollLeft, diff = target - cur;
    if (Math.abs(diff) < 0.6 || reduced) { tl.scrollLeft = target; raf = 0; return; }
    tl.scrollLeft = cur + diff * 0.2;
    raf = requestAnimationFrame(loop);
  };
  const glide = (x) => { target = clamp(x); if (!raf) raf = requestAnimationFrame(loop); };
  const stopGlide = () => { cancelAnimationFrame(raf); raf = 0; target = tl.scrollLeft; };

  const settledLeft = (el) => {
    // Widths animate, so add up the widths each item is heading to rather than reading offsetLeft.
    let x = px(track, "padding-left");
    for (const c of track.children) {
      if (c === el) return x;
      x += c.classList.contains("tl-item") ? px(c, c.classList.contains("open") ? "--open" : "--w") : c.offsetWidth;
    }
    return x;
  };
  const nearest = (at = tl.scrollLeft) => {
    const mid = at + tl.clientWidth / 2;
    let best = 0, dist = Infinity;
    evItems().forEach((it, i) => { const d = Math.abs(it.offsetLeft + px(it, "--w") / 2 - mid); if (d < dist) { dist = d; best = i; } });
    return best;
  };
  const clearFocus = () => { focus = -1; evItems().forEach((x) => x.classList.remove("open")); };
  const focusOn = (i) => {
    const list = evItems();
    if (!list.length) return;
    focus = Math.max(0, Math.min(list.length - 1, i));
    list.forEach((x, k) => x.classList.toggle("open", k === focus));
    const it = list[focus];
    glide(settledLeft(it) + (px(it, "--open") - 28) / 2 - tl.clientWidth / 2);
  };
  const settle = (delay = 160) => {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => { focusOn(nearest(target)); }, delay);
  };
  const step = (dir) => {
    tl.classList.add("stepping");
    const list = evItems();
    const next = focus < 0 ? nearest() : focus + dir;
    if (next >= 0 && next < list.length) focusOn(next);
  };

  tl.addEventListener("wheel", (e) => {
    if (!desktop() || e.ctrlKey) return;
    const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY);
    const d = (horizontal ? e.deltaX : e.deltaY) * (e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? tl.clientWidth : 1);
    if (!d) return;
    const base = raf ? target : tl.scrollLeft;
    // At either end, let the page scroll on.
    if ((d < 0 && base <= 0.5) || (d > 0 && base >= maxLeft() - 0.5)) { tl.classList.remove("stepping"); return; }
    e.preventDefault();
    tl.classList.add("stepping");
    glide(base + d * 1.15);
    settle();
  }, { passive: false });
  // Real pointer movement hands control back to hover.
  tl.addEventListener("mousemove", (e) => { if ((e.movementX || e.movementY) && !raf) tl.classList.remove("stepping"); });
  track.addEventListener("mouseover", (e) => {
    if (tl.classList.contains("stepping")) return;
    const it = e.target.closest(".tl-item");
    if (it && focus >= 0 && !it.classList.contains("open")) clearFocus();
  });
  tl.addEventListener("keydown", (e) => {
    if (!desktop() || (e.key !== "ArrowRight" && e.key !== "ArrowLeft")) return;
    e.preventDefault();
    step(e.key === "ArrowRight" ? 1 : -1);
  });
  enableDrag(tl, () => { stopGlide(); clearFocus(); }, () => { target = tl.scrollLeft; settle(60); });

  // Rail: shows where you are and how much there is. Drag the thumb or click the rail to jump.
  let railFrame = 0;
  const drawRail = () => {
    railFrame = 0;
    const max = maxLeft(), w = rail.clientWidth;
    rail.hidden = max <= 1;
    const size = Math.max(36, w * (tl.clientWidth / tl.scrollWidth));
    thumb.style.width = `${size}px`;
    thumb.style.transform = `translateX(${max ? (tl.scrollLeft / max) * (w - size) : 0}px)`;
    wrap.classList.toggle("fade-l", tl.scrollLeft > 4);
    wrap.classList.toggle("fade-r", tl.scrollLeft < max - 4);
  };
  const queueRail = () => { if (!railFrame) railFrame = requestAnimationFrame(drawRail); };
  tl.addEventListener("scroll", queueRail, { passive: true });
  window.addEventListener("resize", queueRail);
  const railTo = (clientX, grabOffset) => {
    const r = rail.getBoundingClientRect(), size = thumb.offsetWidth;
    const frac = Math.max(0, Math.min(1, (clientX - r.left - grabOffset) / Math.max(1, r.width - size)));
    return frac * maxLeft();
  };
  rail.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    clearFocus(); clearTimeout(settleTimer);
    tl.classList.add("stepping");
    const onThumb = e.target === thumb;
    const grab = onThumb ? e.clientX - thumb.getBoundingClientRect().left : thumb.offsetWidth / 2;
    rail.setPointerCapture(e.pointerId);
    rail.classList.add("active");
    if (!onThumb) glide(railTo(e.clientX, grab));
    const move = (ev) => { stopGlide(); tl.scrollLeft = railTo(ev.clientX, grab); target = tl.scrollLeft; };
    const up = () => {
      rail.removeEventListener("pointermove", move);
      rail.classList.remove("active");
      settle(80);
    };
    rail.addEventListener("pointermove", move);
    rail.addEventListener("pointerup", up, { once: true });
    rail.addEventListener("pointercancel", up, { once: true });
  });

  requestAnimationFrame(() => {
    const t = $("#tl-today", tl);
    if (t && desktop()) tl.scrollLeft = Math.max(0, t.offsetLeft - (compact ? 260 : 320));
    target = tl.scrollLeft;
    drawRail();
  });
  return { el: wrap, arrows: null };
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

function enableDrag(el, onStart = () => {}, onEnd = () => {}) {
  let down = null, moved = false;
  el.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse" || e.button !== 0 || window.innerWidth <= 720) return;
    down = { x: e.clientX, left: el.scrollLeft }; moved = false;
  });
  window.addEventListener("pointermove", (e) => {
    if (!down) return;
    const dx = e.clientX - down.x;
    if (Math.abs(dx) > 5 && !moved) { moved = true; el.classList.add("dragging"); onStart(); down.left = el.scrollLeft + dx; }
    if (moved) el.scrollLeft = down.left - dx;
  });
  window.addEventListener("pointerup", () => {
    if (down && moved) onEnd();
    down = null; setTimeout(() => el.classList.remove("dragging"), 0);
  });
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
  const [events, sheets] = await Promise.all([api(`/api/events?start=${isoLocal(from).slice(0, 10)}`), api("/api/sheets").catch(() => [])]);
  // Sign-ups that aren't tied to an event (a meal train, a supply drive) show above the list.
  const standalone = sheets.filter((x) => !x.event);
  const others = standalone.length ? h("section.ev-others", h("h2.ev-month-label", "Sign-ups"),
    h("div.sheet-list", standalone.map((x) => link(`/signups/${x.id}`, { class: "sheet-link" },
      h("div.when", h("span.d", icon("list", 34))),
      h("div", h("h3", x.title), x.description ? h("div.sub", x.description) : null),
      h("div.fill-meter", x.capacity ? [h("b.num", x.capacity - x.filled), h("span.muted", " spots open")] : h("span.muted", plural(x.people, "person", "people") + " in"))))) ) : null;
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
    clear(body).append(...(state.view === "list" ? [others, eventList(list)] : [calendar(list, state, rerender)]).filter(Boolean));
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

// ---------- sign-up popup ----------
// One popup for RSVPs and sign-ups: who you are, the details for this slot, and two email choices.
// Reminders start ticked. Club news starts unticked, so no one lands on the list by accident.
export function signupPopup({ title, sub, fields = [], submit = "Sign up", onSubmit: send, done }) {
  const known = me.get();
  const form = h("form.popup-form",
    field("Name", input("name", { autocomplete: "name", value: known.name || "", required: true })),
    field("Email", input("email", { type: "email", autocomplete: "email", value: known.email || "", required: true })),
    ...fields,
    h("div.email-prefs",
      h("label.check", h("input", { type: "checkbox", name: "reminders", checked: true }),
        h("span", "Email me reminders for this event", hint("You'll still get your confirmation, and a heads-up if the event is cancelled or moved."))),
      h("label.check", h("input", { type: "checkbox", name: "news", checked: false }), "Email me about future events and club news")),
    honeypot(),
    h("p.form-error"),
    h("button.btn.block", { type: "submit" }, submit));
  onSubmit(form, async (v) => {
    const res = await send(v);
    me.set({ name: v.name, email: v.email });
    m.close();
    done?.(res, v);
  });
  const m = modal(h("div.popup", h("h2", title), sub ? h("p.popup-sub", sub) : null, form), { label: title });
  (form.querySelector("input[name=name]").value ? form.querySelector("input:not([value]), input[value='']") : form.querySelector("input[name=name]"))?.focus();
  return m;
}

// Optional Venmo QR on an event, when an admin turns it on and the club has a Venmo handle.
function giveBlock(ev) {
  if (!ev.donate || !ev.venmo) return null;
  const qr = CFG.demo ? (window.MAHINA_DEMO.qr?.() || "") : `/api/events/${ev.slug}/give.svg`;
  return h("section.ev-give", { "aria-label": "Chip in" },
    h("img.ev-give-qr", { src: qr, alt: `Venmo QR code for @${ev.venmo.handle}`, width: 96, height: 96 }),
    h("div.ev-give-text",
      h("h3", "Chip in"),
      ev.donate_note && ev.donate_note.trim() !== ev.title.trim() ? h("p", ev.donate_note) : null,
      h("a.ev-give-link", { href: ev.venmo.link, target: "_blank", rel: "noopener" }, `Venmo @${ev.venmo.handle}`, icon("right", 16))));
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
    const full = ev.capacity && ev.spots_left <= 0;
    const open = () => {
      let guests = 0;
      const out = h("output", "0");
      signupPopup({
        title: ev.title, sub: `${longDate(parse(ev.starts_at))}, ${timeRange(ev)}`, submit: "I'm going",
        fields: [h("div.row.guest-row",
          h("span.field-label", "Guests", hint("Family or friends coming with you.")),
          h("div.stepper",
            h("button", { type: "button", "aria-label": "Fewer guests", onclick: () => { guests = Math.max(0, guests - 1); out.value = guests; } }, icon("minus", 18)),
            out,
            h("button", { type: "button", "aria-label": "More guests", onclick: () => { guests = Math.min(20, guests + 1); out.value = guests; } }, icon("plus", 18))))],
        onSubmit: (v) => api(`/api/events/${ev.slug}/rsvp`, { method: "POST", body: { ...v, guests, status: "going" } }),
        done: (res) => { ev.going = res.going; draw(res); },
      });
    };
    box.append(h("h3", "Are you coming?"),
      h("p.going", icon("people", 18), ev.going ? `${ev.going} going` : "Be the first to RSVP",
        ev.capacity ? h("span", ` of ${ev.capacity}`) : null),
      h("button.btn.block", { type: "button", disabled: full, onclick: open }, full ? "Full" : "I'm going"));
  };
  draw(null);
  // The RSVP card and the donation block sit apart, so neither feels crowded.
  return h("div.ev-side", box, giveBlock(ev));
}

function calButtons(ev) {
  return [h("a.btn.small.ghost", { href: googleCal(ev), target: "_blank", rel: "noopener" }, "Google Calendar"),
    h("a.btn.small.ghost", { href: CFG.demo ? "#" : `/api/events/${ev.slug}/calendar.ics`, download: `${ev.slug}.ics` }, "Apple / Outlook")];
}

// ---------- sign-up sheet ----------
// A small solid circle with someone's initials, or a check when names are hidden.
function avatar(name) {
  const initials = (name || "").replace(/\./g, "").split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return h("span.avatar", { "aria-hidden": "true" }, initials || icon("check", 14));
}

const servingsText = (n) => `about ${n} serving${n === 1 ? "" : "s"}`;

function sheetMeter(sheet) {
  if (sheet.closed) return "Closed";
  const parts = [];
  if (sheet.servings) parts.push(h("b", servingsText(sheet.servings).replace(/^a/, "A")), sheet.event?.going ? ` for ${sheet.event.going} going` : "");
  else if (sheet.capacity) parts.push(`${sheet.filled} of ${sheet.capacity} filled`);
  else parts.push(plural(sheet.people, "person", "people") + " signed up");
  return parts;
}

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
        h("div.sheet-meter", sheetMeter(sheet))),
      h("div.slots", sheet.slots.map((sl) => slotRow(sheet, sl, open, draw)),
        EDIT.on ? h("div.slot.ed-add", action("Add a slot", async () => {
          const v = await ask("Add a slot", [{ name: "title", label: "Slot", attrs: { required: true, placeholder: "Dessert" } },
            { name: "capacity", label: "How many people (0 for no limit)", type: "number", value: 1, attrs: { min: 0, max: 999, required: true } },
            { name: "ask_item", label: "Ask what they're bringing", type: "check" },
            { name: "ask_servings", label: "Ask how many it feeds", type: "check" }], { ok: "Add" });
          if (!v) return;
          try {
            const r = await api(`/api/admin/sheets/${sheet.id}/slots`, { method: "POST", body: v });
            const cap = Number(v.capacity);
            const at = sheet.slots.findIndex((x) => x.is_other);
            sheet.slots.splice(at < 0 ? sheet.slots.length : at, 0, { id: r.id, title: v.title, note: "", capacity: cap, unlimited: !cap, taken: 0, left: cap || 999,
              ask_item: v.ask_item, ask_servings: v.ask_servings, servings: 0, image: null, people: [] });
            sheet.capacity += cap; draw();
          } catch (e) { toast(e.message, "error"); }
        })) : null));
  };
  draw();
  return wrap;
}

function slotRow(sheet, sl, open, redraw) {
  const row = h("div.slot", { class: (sl.is_other ? "other " : "") + (sl.image ? "has-img" : "") });
  const limited = !sl.unlimited;
  const pips = !limited ? null : sl.capacity <= 16
    ? h("div.pips", { "aria-hidden": "true" }, Array.from({ length: sl.capacity }, (_, i) => h("i", { class: i < sl.taken ? "" : "free" })))
    : h("div.fill-meter", { style: { textAlign: "left" } }, h("div.bar", h("span", { style: { width: `${(sl.taken / sl.capacity) * 100}%` } })));
  const count = [limited ? (sl.left ? `${sl.taken} of ${sl.capacity}` : `All ${sl.capacity} filled`) : sl.taken ? `${sl.taken} bringing` : "",
    sl.servings ? servingsText(sl.servings) : ""].filter(Boolean).join(", ");
  // What people are bringing is public. Each one carries the person's initials, so it reads as a promise, not a suggestion.
  const choiceIds = new Set((sl.choices || []).map((c) => c.id));
  const withItems = (sl.people || []).filter((p) => p.item && !choiceIds.has(p.choice));
  const dishes = withItems.length ? h("div.dishes", { "aria-label": `Bringing for ${sl.title}` }, withItems.map((p) => h("div.dish",
    avatar(p.name),
    h("div", h("span.who", p.name ? `${p.name} is bringing` : "Someone is bringing"),
      h("b", p.item),
      p.servings || p.qty > 1 ? h("span.meta", [p.servings ? `Feeds ${p.servings}` : "", p.qty > 1 ? `×${p.qty}` : ""].filter(Boolean).join(", ")) : null)))) : null;
  // Specific items the organizer listed. Open ones can be claimed with one tap.
  const choiceList = sl.choices?.length ? h("div.choices", sl.choices.map((c) => h("div.choice", { class: c.left ? "" : "taken" },
    h("span.choice-mark", c.left ? null : icon("check", 14)),
    h("span.choice-title", c.title, c.need > 1 ? h("small", ` ${c.taken} of ${c.need}`) : null),
    h("span.choice-by", c.by.length ? c.by.join(", ") : c.left ? "" : "Taken"),
    open && c.left && sl.left > 0 && !EDIT.on ? h("button.btn.small.ghost", { type: "button", onclick: () => toggle(c.id) }, "I'll bring it") : null))) : null;
  const names = (sl.people || []).filter((p) => !p.item && p.name);
  const people = names.length ? h("div.slot-people", names.map((p) => h("span", p.name, p.qty > 1 ? ` ×${p.qty}` : null))) : null;
  const choicesGone = sl.choices?.length && !sl.ask_item && !sl.choices.some((c) => c.left);
  const btn = !open ? null : sl.left > 0 && !choicesGone
    ? h("button.btn.small", { class: sl.is_other ? "ghost" : "", type: "button", "aria-haspopup": "dialog", onclick: () => toggle() }, sl.is_other ? "Add yours" : "Sign up")
    : h("span.full-label", "Full");
  function toggle(pick) {
    const openChoices = (sl.choices || []).filter((c) => c.left);
    const itemField = sl.ask_item || sl.is_other ? field("What are you bringing?", input("item", { required: true, maxlength: 120, placeholder: sl.is_other ? "Kalua pig" : sl.note || "" })) : null;
    const choiceField = openChoices.length ? field("What are you bringing?", h("select", { name: "choice", onchange: (e) => {
      const write = e.target.value === "";
      itemField.hidden = !write; itemField.querySelector("input").required = write;
    } }, openChoices.map((c) => h("option", { value: c.id, selected: c.id === pick }, c.title)),
      sl.ask_item ? h("option", { value: "" }, "Something else") : null)) : null;
    if (choiceField && itemField) { itemField.hidden = true; itemField.querySelector("input").required = false; itemField.querySelector(".field-label").firstChild.textContent = "What is it?"; }
    const fields = [choiceField, itemField,
      sl.ask_servings ? field("How many people will it feed?", input("servings", { type: "number", min: 1, max: 500, inputmode: "numeric", required: true, placeholder: "12" }),
        { hintText: "A rough guess is fine. It helps us see if there's enough of everything." }) : null,
      limited && sl.left > 1 && !openChoices.length ? field("How many?", h("select", { name: "qty" }, Array.from({ length: Math.min(sl.left, 10) }, (_, i) => h("option", { value: i + 1 }, i + 1))),
        { hintText: "How many of this you're bringing or covering." }) : null].filter(Boolean);
    const when = sl.starts_at ? timeRange({ starts_at: sl.starts_at, ends_at: sl.ends_at }) : "";
    signupPopup({
      title: sl.is_other ? "Bring something else" : sl.title,
      sub: [sheet.event?.title || sheet.title, when].filter(Boolean).join(", "),
      fields,
      onSubmit: async (v) => {
        const ch = (sl.choices || []).find((c) => c.id === v.choice);
        if (ch) { v.item = ch.title; v.qty = 1; }
        await api(`/api/slots/${sl.id}/signup`, { method: "POST", body: v });
        return ch;
      },
      done: (ch, v) => {
        if (ch) { ch.taken += 1; ch.left -= 1; }
        const qty = Number(v.qty || 1), serves = Number(v.servings || 0);
        sl.taken += qty; if (limited) { sl.left -= qty; sheet.filled += qty; }
        sl.servings += serves; sheet.servings = (sheet.servings || 0) + serves; sheet.people = (sheet.people || 0) + qty;
        const parts = v.name.trim().split(/\s+/);
        const short = sheet.show_names ? parts[0] + (parts.length > 1 ? " " + parts.at(-1)[0] + "." : "") : "";
        if (ch && short) ch.by.push(short);
        (sl.people ||= []).push({ name: short, item: v.item || "", qty, servings: serves || null, choice: ch ? ch.id : null });
        toast(sl.is_other ? "Thanks! You're on the list." : `You're signed up for ${sl.title}`);
        redraw();
      },
    });
  }
  const slotPatch = (body) => api(`/api/admin/slots/${sl.id}`, { method: "PATCH", body });
  const editTools = EDIT.on ? h("span.ed-tools",
    sl.is_other ? null : tool("image", sl.image ? "Change picture" : "Add a picture", async () => {
      try { const p = await pickImage(); await slotPatch({ photo_id: p.id }); sl.image = p; sl.photo_id = p.id; redraw(); toast("Saved"); }
      catch (e) { if (e.message !== "No photo chosen.") toast(e.message, "error"); }
    }),
    sl.image ? tool("close", "Remove picture", async () => { await slotPatch({ photo_id: null }); sl.image = null; sl.photo_id = null; redraw(); }) : null,
    sl.is_other ? null : tool("people", "Change how many", async () => {
      const v = await ask(`How many for ${sl.title}?`, [{ name: "capacity", label: "People (0 for no limit)", type: "number", value: sl.capacity, attrs: { min: 0, max: 999, required: true } }]);
      if (!v) return;
      try {
        await slotPatch({ capacity: Number(v.capacity) });
        const cap = Number(v.capacity);
        if (limited) { sheet.capacity -= sl.capacity; sheet.filled -= sl.taken; }
        sl.capacity = cap; sl.unlimited = cap === 0; sl.left = cap ? cap - sl.taken : 999;
        if (cap) { sheet.capacity += cap; sheet.filled += sl.taken; }
        redraw(); toast("Saved");
      } catch (e) { toast(e.message, "error"); }
    }),
    sl.taken || sl.is_other ? null : tool("trash", `Remove ${sl.title}`, async () => {
      try { await api(`/api/admin/slots/${sl.id}`, { method: "DELETE" }); sheet.slots.splice(sheet.slots.indexOf(sl), 1); if (limited) sheet.capacity -= sl.capacity; redraw(); }
      catch (e) { toast(e.message, "error"); }
    })) : null;
  const title = sl.is_other ? h("span", sl.title) : ed(h("span", sl.title), { label: "Slot name", save: async (t) => { await slotPatch({ title: t }); sl.title = t; } });
  row.append(
    h("div.slot-row",
      sl.image ? h("div.slot-img", h("img", { src: media(sl.image.thumb), alt: "", loading: "lazy" })) : null,
      h("div.slot-title", title, sl.starts_at ? h("small", timeRange({ starts_at: sl.starts_at, ends_at: sl.ends_at })) : sl.note && !sl.ask_item ? h("small", sl.note) : null),
      h("div.slot-fill", pips, count ? h("div.slot-count", count) : null, people),
      EDIT.on ? editTools : btn),
    ...[choiceList, dishes].filter(Boolean));
  return row;
}

// ---------- sign-ups index ----------
export async function sheetPage({ id }) {
  const s = await api(`/api/sheets/${id}`);
  setTitle(s.title);
  if (s.event) { go(`/events/${s.event.slug}#signups`, { replace: true }); return h("div"); }
  return h("div.wrap", h("div.page-head", link("/events", { class: "back" }, icon("left", 18), "Events"), h("h1.h1", s.title),
    s.description ? h("p.lede", s.description) : null), sheetView({ ...s, description: "" }));
}
