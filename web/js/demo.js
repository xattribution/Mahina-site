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

  // ----- shop: orders live in memory so selling and checkout can be tried -----
  const shopOrders = () => (D["/api/admin/shop/orders"] ||= []);
  const VIEW = { open: (o) => o.status === "pending" || (o.status === "paid" && !o.picked_up), waiting: (o) => o.status === "pending",
    hand_out: (o) => o.status === "paid" && !o.picked_up, all: () => true };
  const handle_ = () => (D["/api/site"].venmo || "").replace(/^@/, "");
  const payLink = (o) => `https://venmo.com/?txn=pay&recipients=${encodeURIComponent(handle_())}&amount=${(o.total / 100).toFixed(2)}&note=${encodeURIComponent(`${D["/api/site"].club_name} order ${o.code}`)}&audience=private`;
  const withPay = (o) => { if (o.status === "pending") o.venmo = { handle: handle_(), link: payLink(o) }; else delete o.venmo; return o; };
  const publicOrder = (o) => { const { id, name, email, method, note, paid_at, paid_by, picked_up_at, ...rest } = withPay(o); return { ...rest, pickup: D["/api/shop"]?.note || "" }; };
  function newOrder(body, channel) {
    const products = (D["/api/admin/shop"] || {}).products || [];
    const items = (body.items || []).map((it) => {
      const p = products.find((x) => x.id === Number(it.product_id));
      if (!p) throw new DemoError("Something in the cart isn't for sale anymore.");
      if (p.options.length && !p.options.includes(it.option)) throw new DemoError(`Pick a size for ${p.name}.`);
      return { product_id: p.id, name: p.name, option: it.option || "", qty: Number(it.qty || 1), price: p.price };
    });
    if (!items.length) throw new DemoError("The cart is empty.");
    const code = "MC-" + Array.from({ length: 5 }, () => "ABCDEFGHJKMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 31)]).join("");
    const now = new Date().toISOString().slice(0, 19);
    const cash = body.method === "cash";
    const o = { id: Date.now(), code, status: cash ? "paid" : "pending", total: items.reduce((s, i) => s + i.qty * i.price, 0), items, created: now,
      paid: cash, picked_up: cash, channel, name: body.name || "", email: body.email || "", method: channel === "table" ? body.method : "", note: "",
      paid_at: cash ? now : null, paid_by: cash ? D["/api/admin/state"].admin.name : "", picked_up_at: cash ? now : null };
    shopOrders().unshift(withPay(o));
    return o;
  }

  async function handle(fullPath, opts = {}) {
    const method = (opts.method || "GET").toUpperCase();
    const [path, qs] = fullPath.split("?");
    const params = new URLSearchParams(qs || "");
    const body = opts.body || {};
    let m;

    if (method === "GET") {
      if (path === "/api/events") {
        const s = params.get("start") || "0000", e = params.get("end") || "9999";
        return wait(D["/api/events"].filter((x) => x.starts_at >= s && x.starts_at <= e));
      }
      if (path.startsWith("/api/me/")) {
        return wait({ email: mine.email || "you@example.com", name: mine.name || "", subscribed: true, rsvps: mine.rsvps, signups: mine.signups });
      }
      if (path === "/api/admin/email/preview") return wait({ count: 14 });
      if (path === "/api/admin/invites") return wait(D[path] || []);
      if (path === "/api/admin/shop/orders") return wait(shopOrders().filter(VIEW[params.get("view") || "open"] || (() => true)));
      if ((m = path.match(/^\/api\/admin\/shop\/orders\/(\d+)$/))) return wait(shopOrders().find((o) => o.id === Number(m[1])));
      if ((m = path.match(/^\/api\/shop\/orders\/([^/]+)$/))) {
        const o = shopOrders().find((x) => x.code === decodeURIComponent(m[1]).toUpperCase());
        if (!o) throw new DemoError("We couldn't find that order.", 404);
        return wait(publicOrder(o));
      }
      if (D[path] !== undefined) return wait(D[path]);
      throw new DemoError("That isn't part of this preview.", 404);
    }

    // ----- public actions -----
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
    if (path === "/api/shop/orders") { who(body); return wait(publicOrder(newOrder(body, "online"))); }
    if (path === "/api/admin/shop/orders") return wait(newOrder(body, "table"));
    if ((m = path.match(/^\/api\/admin\/shop\/orders\/(\d+)\/status$/))) {
      const o = shopOrders().find((x) => x.id === Number(m[1]));
      const now = new Date().toISOString().slice(0, 19);
      if (body.action === "paid") Object.assign(o, { status: "paid", paid: true, method: body.method || "venmo", paid_at: now, paid_by: D["/api/admin/state"].admin.name },
        o.channel === "table" ? { picked_up: true, picked_up_at: now } : {});
      if (body.action === "picked_up") Object.assign(o, { picked_up: true, picked_up_at: now });
      if (body.action === "not_picked_up") Object.assign(o, { picked_up: false, picked_up_at: null });
      if (body.action === "cancel") Object.assign(o, { status: "cancelled" });
      return wait(withPay(o));
    }
    if ((m = path.match(/^\/api\/admin\/shop\/orders\/(\d+)\/send$/))) {
      const o = shopOrders().find((x) => x.id === Number(m[1]));
      const names = (D["/api/admin/shop"].people || []).filter((p) => (body.to || []).includes(p.id)).map((p) => p.name);
      if (!names.length) throw new DemoError("Pick who to send it to.", 400, "to");
      (o.sent_to ||= []).push({ at: new Date().toISOString().slice(0, 19), by: D["/api/admin/state"].admin.name, to: names, note: body.note || "" });
      return wait(o);
    }
    if (path === "/api/admin/shop/check-mail") return wait({ at: new Date().toISOString().slice(0, 19), ok: false, message: "The preview can't reach a mailbox." });
    if (path === "/api/admin/shop/settings") {
      const s = D["/api/admin/shop"].settings;
      if ("enabled" in body) { s.enabled = D["/api/admin/shop"].enabled = !!body.enabled; D["/api/site"].shop = body.enabled ? { title: s.title } : null; }
      if ("title" in body) { s.title = body.title || "Shop"; if (D["/api/site"].shop) D["/api/site"].shop.title = s.title; if (D["/api/shop"]) D["/api/shop"].title = s.title; }
      if ("note" in body) { s.note = body.note; if (D["/api/shop"]) D["/api/shop"].note = body.note; }
      if (body.mail) s.mail = { ...body.mail };
      if (body.notify) s.notify = [...body.notify];
      if (body.imap) s.imap = { ...body.imap, password: body.imap.password ? "••••••••" : "" };
      return wait(s);
    }

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
    if (path === "/api/admin/invites") {
      if (!emailOk(body.email)) throw new DemoError("Enter an email address like name@example.com.", 400, "email");
      (D["/api/admin/invites"] ||= []).unshift({ id: Date.now(), email: body.email, name: body.name || "", role: body.role, perms: body.perms || [],
        invited_by: D["/api/admin/state"].admin.name, created: new Date().toISOString().slice(0, 19), expires: new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 19), expired: false });
      return wait({ ok: true, emailed: true, link: null });
    }
    if (/^\/api\/admin\/invites\/\d+\/resend$/.test(path)) return wait({ ok: true, emailed: true });
    if ((m = path.match(/^\/api\/admin\/invites\/(\d+)$/)) && method === "DELETE") {
      D["/api/admin/invites"] = (D["/api/admin/invites"] || []).filter((i) => i.id !== Number(m[1]));
      return wait({ ok: true });
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
