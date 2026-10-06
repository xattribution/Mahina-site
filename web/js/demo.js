// Offline preview backend: serves a snapshot of the API from window.MAHINA_DATA.
// Public actions (RSVP, sign up, vote) work for the session. Admin edits are not saved.
(function () {
  const D = window.MAHINA_DATA || {};
  const mine = { rsvps: [], signups: [] };
  class DemoError extends Error {
    constructor(msg, status = 400, field = null) { super(msg); this.status = status; this.field = field; }
  }
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const emailOk = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e || "");
  const who = (b) => {
    if (!(b.name || "").trim()) throw new DemoError("Enter your name.", 400, "name");
    if (!emailOk(b.email)) throw new DemoError("Enter an email address like name@example.com.", 400, "email");
  };
  const wait = (v) => new Promise((r) => setTimeout(() => r(clone(v)), 120));
  const readOnly = () => { throw new DemoError("This preview doesn't save changes. Run the club's site to edit for real.", 400); };

  // Visit every object in the snapshot (used to apply edits wherever a record appears).
  function eachObj(fn) {
    const seen = new Set();
    const walk = (x) => {
      if (!x || typeof x !== "object" || seen.has(x)) return;
      seen.add(x);
      if (!Array.isArray(x)) fn(x);
      for (const v of Array.isArray(x) ? x : Object.values(x)) walk(v);
    };
    walk(D);
  }

  function findSlot(id) {
    for (const [k, v] of Object.entries(D)) {
      if (!k.startsWith("/api/events/") && !k.startsWith("/api/sheets/")) continue;
      for (const s of v.sheets || [v]) for (const sl of s.slots || []) if (String(sl.id) === String(id)) return { sheet: s, slot: sl, key: k };
    }
    return null;
  }

  async function handle(fullPath, opts = {}) {
    const method = (opts.method || "GET").toUpperCase();
    const [path, qs] = fullPath.split("?");
    const params = new URLSearchParams(qs || "");
    const body = opts.body || {};

    if (method === "GET") {
      if (path === "/api/events") {
        const s = params.get("start") || "0000", e = params.get("end") || "9999";
        return wait(D["/api/events"].filter((x) => x.starts_at >= s && x.starts_at <= e));
      }
      if (path.startsWith("/api/me/")) {
        return wait({ email: mine.email || "you@example.com", name: mine.name || "", subscribed: true, rsvps: mine.rsvps, signups: mine.signups });
      }
      if (path === "/api/admin/email/preview") return wait({ count: 14 });
      if (D[path] !== undefined) return wait(D[path]);
      throw new DemoError("That isn't part of this preview.", 404);
    }

    // ----- public actions -----
    let m;
    if ((m = path.match(/^\/api\/events\/([^/]+)\/rsvp$/))) {
      who(body);
      const ev = D[`/api/events/${m[1]}`];
      const guests = Number(body.guests || 0);
      ev.going += 1 + guests;
      const row = D["/api/events"].find((x) => x.slug === m[1]);
      if (row) row.going = ev.going;
      Object.assign(mine, { name: body.name, email: body.email });
      mine.rsvps.push({ id: Date.now(), status: "going", guests, name: body.name, slug: ev.slug, title: ev.title, starts_at: ev.starts_at, location: ev.location });
      return wait({ status: "going", token: "preview", going: ev.going });
    }
    if ((m = path.match(/^\/api\/slots\/(\d+)\/signup$/))) {
      who(body);
      const f = findSlot(m[1]);
      if (!f) throw new DemoError("That slot no longer exists.", 404);
      if (f.slot.ask_item && !(body.item || "").trim()) throw new DemoError("Tell everyone what you're bringing.", 400, "item");
      const qty = Number(body.qty || 1);
      if (f.slot.taken + qty > f.slot.capacity) throw new DemoError("This slot just filled up.", 400, "qty");
      Object.assign(mine, { name: body.name, email: body.email });
      mine.signups.push({ id: Date.now(), qty, item: body.item || "", name: body.name, slot: f.slot.title, sheet: f.sheet.title,
        slug: f.sheet.event?.slug, event: f.sheet.event?.title, starts_at: f.sheet.event?.starts_at });
      return wait({ id: Date.now(), token: "preview" });
    }
    if ((m = path.match(/^\/api\/me\/[^/]+\/cancel$/))) {
      const list = body.kind === "rsvp" ? mine.rsvps : mine.signups;
      const i = list.findIndex((x) => x.id === body.id);
      if (i >= 0) list.splice(i, 1);
      return wait({ ok: true });
    }
    if ((m = path.match(/^\/api\/polls\/([^/]+)\/respond$/))) {
      const p = D[`/api/polls/${m[1]}`];
      for (const q of p.questions) {
        const v = (body.answers || {})[q.id];
        if (q.required && (v == null || v === "" || (Array.isArray(v) && !v.length))) throw new DemoError("Answer every required question.", 400, `q${q.id}`);
      }
      if (p.collect_name) who(body);
      let tally = p.tally ? clone(p.tally) : null;
      if (tally) for (const r of tally) {
        const v = body.answers[r.id];
        if (v == null || v === "") continue;
        r.answered += 1;
        if (r.counts) for (const c of r.counts) if ((Array.isArray(v) ? v : [String(v)]).includes(c.option)) c.n += 1;
        if (r.text && typeof v === "string") r.text.push(v);
      }
      if (tally) p.tally = tally;
      return wait({ updated: false, tally: p.results === "admin" ? undefined : tally });
    }
    if (path === "/api/contact") { who(body); if (!(body.message || "").trim()) throw new DemoError("Write a message.", 400, "message"); return wait({ ok: true }); }
    if (path === "/api/subscribe") { if (!emailOk(body.email)) throw new DemoError("Enter an email address like name@example.com.", 400, "email"); return wait({ ok: true }); }
    if (path === "/api/photos/submit") return wait({ received: opts.form ? opts.form.getAll("files").length : 0 });

    // ----- admin -----
    if (path === "/api/admin/login" || path === "/api/admin/setup" || path === "/api/admin/logout") return wait({ ok: true });
    if (path === "/api/admin/settings" && method === "PUT") {
      const b = clone(body);
      if (b.labels) b.labels = { ...(D["/api/site"].labels || {}), ...b.labels };
      for (const k of Object.keys(b)) {
        if (k in D["/api/site"] || ["home_sections", "labels", "banner", "spotlight"].includes(k)) D["/api/site"][k] = b[k];
        if (D["/api/admin/settings"]) D["/api/admin/settings"][k] = b[k];
      }
      return wait({ ...D["/api/admin/settings"], ...D["/api/site"] });
    }
    if (path === "/api/admin/settings/cover") {
      const f = opts.form?.get("file");
      const url = f ? URL.createObjectURL(f) : "";
      return wait({ id: Date.now(), src: url, thumb: url, w: 1600, h: 1000, caption: "" });
    }
    if ((m = path.match(/^\/api\/admin\/events\/(\d+)$/)) && method === "PATCH") {
      const p = { ...body };
      if ("_cover" in p) { p.cover = p._cover; delete p._cover; }
      let out = null;
      eachObj((o) => { if (o.id === Number(m[1]) && "slug" in o && "starts_at" in o) { Object.assign(o, p); out = o; } });
      return wait(out || { ok: true });
    }
    if ((m = path.match(/^\/api\/admin\/polls\/(\d+)$/)) && method === "PATCH") {
      eachObj((o) => { if (o.id === Number(m[1]) && "slug" in o && "results" in o) Object.assign(o, body); });
      return wait({ ok: true });
    }
    if ((m = path.match(/^\/api\/admin\/sheets\/(\d+)$/)) && method === "PATCH") {
      eachObj((o) => { if (o.id === Number(m[1]) && Array.isArray(o.slots)) Object.assign(o, body); });
      return wait({ ok: true });
    }
    if ((m = path.match(/^\/api\/admin\/sheets\/(\d+)\/slots$/))) {
      const id = Date.now();
      eachObj((o) => { if (o.id === Number(m[1]) && Array.isArray(o.slots)) o.slots.push({ id, title: body.title, note: "", capacity: Number(body.capacity), taken: 0, left: Number(body.capacity), ask_item: !!body.ask_item, people: [] }); });
      return wait({ id });
    }
    if ((m = path.match(/^\/api\/admin\/slots\/(\d+)$/))) {
      eachObj((o) => {
        if (!Array.isArray(o.slots)) return;
        const i = o.slots.findIndex((x) => x.id === Number(m[1]));
        if (i < 0) return;
        if (method === "DELETE") o.slots.splice(i, 1);
        else Object.assign(o.slots[i], body, body.capacity ? { left: Number(body.capacity) - o.slots[i].taken } : {});
      });
      return wait({ ok: true });
    }
    if ((m = path.match(/^\/api\/admin\/photos\/(\d+)$/)) && method === "PUT") {
      eachObj((o) => { if (o.id === Number(m[1]) && "thumb" in o) Object.assign(o, { caption: body.caption ?? o.caption }); });
      return wait({ ok: true });
    }
    if (path === "/api/admin/photos/bulk" && body.action === "hidden") {
      const ids = new Set(body.ids);
      D["/api/photos"] = D["/api/photos"].filter((p) => !ids.has(p.id));
      return wait({ ok: true });
    }
    if (path === "/api/admin/email/preview") return wait({ count: (body.audience?.type === "subscribers" ? 14 : 20) });
    // planning works in memory so the board can be tried out
    const board = (eid) => D[`/api/admin/planning/${eid}`];
    const findItem = (id) => { for (const k of Object.keys(D)) if (k.startsWith("/api/admin/planning/") && D[k].items) { const i = D[k].items.find((x) => x.id === id); if (i) return [D[k], i]; } return []; };
    const teamName = (id) => (D["/api/admin/team"] || []).find((t) => t.id === id)?.name || "";
    const shape = (b, cur = {}) => {
      const o = { ...cur, ...b };
      for (const k of ["est_cost", "cost"]) if (k in b) o[k] = b[k] === "" || b[k] == null ? null : Number(String(b[k]).replace(/[$,]/g, ""));
      if ("assignee_id" in b || "assignee_name" in b) o.assignee = o.assignee_id ? teamName(o.assignee_id) : o.assignee_name || "";
      if ("done" in b) o.done_by = b.done ? D["/api/admin/state"].admin.name : "";
      return o;
    };
    if ((m = path.match(/^\/api\/admin\/planning\/(\d+)\/items$/))) {
      if (!(body.title || "").trim()) throw new DemoError("Write what needs doing.", 400, "title");
      const item = shape(body, { id: Date.now(), event_id: Number(m[1]), kind: body.kind, done: false, details: "", qty: "", due: null, est_cost: null, cost: null, assignee_id: null, assignee_name: "" });
      board(m[1])?.items.push(item);
      return wait(clone(item));
    }
    if ((m = path.match(/^\/api\/admin\/planning\/items\/(\d+)$/))) {
      const [b, item] = findItem(Number(m[1]));
      if (!item) return wait({ ok: true });
      if (method === "DELETE") { b.items.splice(b.items.indexOf(item), 1); return wait({ ok: true }); }
      Object.assign(item, shape(body, item));
      return wait(clone(item));
    }
    if ((m = path.match(/^\/api\/admin\/planning\/(\d+)\/notes$/))) {
      const a = D["/api/admin/state"].admin;
      return wait({ id: Date.now(), author_id: a.id, author: a.name, body: body.body, created: new Date().toISOString().slice(0, 19) });
    }
    if (method === "PUT" || method === "DELETE" || path.endsWith("/bulk")) return wait({ ok: true, id: 0 });
    readOnly();
  }

  window.MAHINA_DEMO = {
    handle: (p, o) => handle(p, o).catch((e) => { throw e; }),
    qr: () => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(D.qr || ""),
  };
  window.MAHINA_DEMO.Error = DemoError;
})();
