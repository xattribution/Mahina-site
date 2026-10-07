// Dashboard shop: sell at the table, orders, products, and (admins) shop settings.
import { h, $, $$, api, clear, go, icon, link, hint, toast, modal, confirmBox, field, input, onSubmit, values, empty, plural, loading, media, CFG, query, replaceUrl } from "./core.js";
import { money } from "./shop.js";
import { head, sw, pill, ago, dateCell, isAdmin, csv, pickSlotImage, refreshSite, aLink } from "./admin.js";

const label = (it) => it.name + (it.option ? ` (${it.option})` : "");
const itemsText = (items) => items.map((it) => `${it.qty} × ${label(it)}`).join(", ");
const SIZE_PRESET = ["S", "M", "L", "XL", "2XL"];

export async function shopAdmin() {
  let data = await api("/api/admin/shop");
  const tabs = [["sell", "Sell"], ["orders", "Orders"], ["products", "Products"], ...(isAdmin() ? [["settings", "Settings"]] : [])];
  let tab = tabs.some(([t]) => t === query().get("tab")) ? query().get("tab") : "sell";
  let focus = query().get("order");  // order emails link straight to their order
  const body = h("div");
  const reload = async () => { data = await api("/api/admin/shop"); };
  const setTab = (t) => {
    tab = t;
    $$(".tabs button", wrap).forEach((b) => b.setAttribute("aria-selected", String(b.dataset.t === t)));
    replaceUrl(`/team/shop${t === "sell" ? "" : "?tab=" + t}`);
    const view = { sell: sellTab, orders: ordersTab, products: productsTab, settings: settingsTab }[t];
    clear(body).append(loading());
    const f = t === "orders" ? focus : null;
    focus = null;
    Promise.resolve(view(data, reload, setTab, f)).then((n) => clear(body).append(n)).catch((e) => clear(body).append(h("p.form-error", e.message)));
  };
  const status = data.enabled ? link("/shop", { class: "btn small ghost" }, icon("external", 16), "View shop") : h("span.pill.hidden", "Hidden from the site");
  const wrap = h("div", head("Shop", { actions: [status] }),
    h("div.tabs", { role: "tablist" }, tabs.map(([t, l]) => h("button", { type: "button", role: "tab", "data-t": t, "aria-selected": String(t === tab), onclick: () => setTab(t) }, l))),
    body);
  setTab(tab);
  return wrap;
}

// ---------- sell at the table ----------
function sellTab(data, reload, setTab) {
  const products = data.products.filter((p) => p.active);
  const lines = [];
  const cartBox = h("aside.pos-cart");
  if (!products.length) return empty("Add something to sell first.", h("button.btn.dark", { type: "button", onclick: () => setTab("products") }, "Add a product"));
  const leftOf = (p, o) => p.left[p.options.length ? o : ""];
  const inCart = (p, o) => lines.filter((l) => l.p.id === p.id && l.option === o).reduce((s, l) => s + l.qty, 0);
  const add = (p, option) => {
    const left = leftOf(p, option);
    if (typeof left === "number" && inCart(p, option) >= left) return toast(`No more ${label({ name: p.name, option })} left`, "error");
    const hit = lines.find((l) => l.p.id === p.id && l.option === option);
    if (hit) hit.qty++; else lines.push({ p, option, qty: 1 });
    drawCart();
  };
  const pickSize = (p) => {
    const m = modal(h("div", h("h2", p.name),
      h("div.pos-sizes", p.options.map((o) => {
        const left = p.left[o];
        return h("button", { type: "button", disabled: left === 0, onclick: () => { add(p, o); m.close(); } },
          h("b", o), typeof left === "number" ? h("span", left ? `${left} left` : "Sold out") : null);
      }))), { label: `${p.name} size` });
  };
  const total = () => lines.reduce((s, l) => s + l.qty * l.p.price, 0);
  const clearCart = () => { lines.splice(0); drawCart(); };
  const sale = (method) => api("/api/admin/shop/orders", { method: "POST", body: { method, items: lines.map((l) => ({ product_id: l.p.id, option: l.option, qty: l.qty })) } });
  const after = async () => { clearCart(); await reload(); clear(grid).append(tiles()); };
  const drawCart = () => {
    clear(cartBox).append(h("h2", "Sale"),
      lines.length ? h("div.pos-lines", lines.map((l, i) => h("div.pos-line",
        h("span.strong", label({ name: l.p.name, option: l.option })),
        h("div.stepper.small",
          h("button", { type: "button", "aria-label": "One fewer", onclick: () => { if (l.qty > 1) l.qty--; else lines.splice(i, 1); drawCart(); } }, icon(l.qty > 1 ? "minus" : "trash", 16)),
          h("output", l.qty),
          h("button", { type: "button", "aria-label": "One more", onclick: () => add(l.p, l.option) }, icon("plus", 16))),
        h("span.num", money(l.qty * l.p.price))))) : h("p.muted", "Tap an item to add it."),
      h("div.pos-total", h("span", "Total"), h("b.num", money(total()))),
      h("div.pos-pay",
        h("button.btn", { type: "button", disabled: !lines.length || !data.venmo, title: data.venmo ? null : "Add the club's Venmo handle in Settings", onclick: async (e) => {
          e.currentTarget.disabled = true;
          try { venmoSale(await sale("venmo"), after); } catch (err) { toast(err.message, "error"); drawCart(); }
        } }, icon("qr", 18), "Venmo"),
        h("button.btn.dark", { type: "button", disabled: !lines.length, onclick: () => cashSale(total(), async () => { const o = await sale("cash"); toast(`Sold. ${o.code}`); await after(); }) }, icon("cash", 18), "Cash")),
      lines.length ? h("button.text-link.small", { type: "button", onclick: clearCart }, "Clear") : null);
  };
  const tiles = () => products.map((p) => {
    const out = p.sold_out;
    return h("button.pos-tile", { type: "button", disabled: out, onclick: () => (p.options.length ? pickSize(p) : add(p, "")) },
      h("span.pos-img", p.photo ? h("img", { src: media(p.photo.thumb), alt: "" }) : icon("bag", 32)),
      h("span.pos-name", p.name), h("span.pos-price", out ? "Sold out" : money(p.price)));
  });
  const grid = h("div.pos-grid", tiles());
  drawCart();
  return h("div.pos", grid, cartBox);
}

function cashSale(total, done) {
  const change = h("b.num", "");
  const got = h("input", { type: "number", min: 0, step: "0.01", inputmode: "decimal", name: "received", placeholder: (total / 100).toFixed(2),
    oninput: () => { const c = Math.round(Number(got.value || 0) * 100) - total; change.textContent = got.value && c >= 0 ? money(c) : ""; } });
  const form = h("form",
    h("div.pos-amount", h("span", "Collect"), h("b.num", money(total))),
    field("Cash received", got, { optional: true }),
    h("div.pos-change", h("span", "Change"), change),
    h("p.form-error"),
    h("div.row.end", h("button.btn.ghost", { type: "button", onclick: () => m.close() }, "Cancel"), h("button.btn", { type: "submit" }, "Paid in cash")));
  onSubmit(form, async () => { await done(); m.close(); });
  const m = modal(h("div", h("h2", "Cash"), form), { label: "Cash sale" });
  got.focus();
}

function venmoSale(o, after) {
  const box = h("div.pos-venmo");
  let timer = null;
  const stop = () => { clearInterval(timer); timer = null; };
  const draw = () => {
    if (o.status === "paid") {
      clear(box).append(h("div.pos-paid", icon("check", 40), h("b", "Paid"), h("span.num", `${money(o.total)} · ${o.code}`)),
        h("button.btn.block", { type: "button", onclick: () => m.close() }, "Done"));
      return;
    }
    const qr = CFG.demo ? (window.MAHINA_DEMO.qr?.() || "") : `/api/admin/shop/orders/${o.id}/qr.svg`;
    clear(box).append(
      h("div.pos-amount", h("span", "Venmo"), h("b.num", money(o.total))),
      h("div.pos-qr", h("img", { src: qr, alt: `Venmo QR code for ${money(o.total)}`, width: 240, height: 240 })),
      h("div.pos-code", h("span", "Note"), h("b", o.code), hint("Ask them to leave the note as is. It matches the payment to this sale.")),
      h("div.pos-wait", h("span.dot"), "Waiting for payment"),
      h("div.row.end",
        h("button.btn.ghost", { type: "button", onclick: async () => {
          if (!(await confirmBox(`Cancel sale ${o.code}?`, { ok: "Cancel sale" }))) return;
          await api(`/api/admin/shop/orders/${o.id}/status`, { method: "POST", body: { action: "cancel" } }); stop(); m.close(); toast("Sale cancelled");
        } }, "Cancel sale"),
        h("button.btn", { type: "button", onclick: async () => {
          o = await api(`/api/admin/shop/orders/${o.id}/status`, { method: "POST", body: { action: "paid", method: "venmo" } }); stop(); draw();
        } }, icon("check", 18), "They paid")));
  };
  draw();
  const m = modal(box, { label: "Venmo payment", onClose: () => { stop(); after(); } });
  timer = setInterval(async () => {
    if (!box.isConnected) return stop();
    try { const n = await api(`/api/admin/shop/orders/${o.id}`); if (n.status !== o.status) { o = n; draw(); if (o.status !== "pending") stop(); } } catch {}
  }, 3000);
}

// ---------- orders ----------
const VIEWS = [["open", "To do"], ["waiting", "Waiting for payment"], ["hand_out", "To hand out"], ["all", "All"]];

function statusPill(o) {
  if (o.status === "cancelled") return pill("cancelled", "Cancelled");
  if (o.status === "pending") return pill("pending", "Waiting");
  return o.picked_up ? pill("published", o.channel === "table" ? "Sold" : "Picked up") : pill("open", "Paid");
}

// Email an order to people on the team who can see the shop, with a note. Replies come back to the sender.
function sendDialog(o, people, onSent) {
  const form = h("form",
    h("div.field", h("span.field-label", "Send to"),
      people.length ? h("div.send-to", people.map((p) => h("label.check", h("input", { type: "checkbox", name: "to", value: p.id }), p.name)))
        : h("p.muted", "No one else can see the shop yet. Give someone the Shop permission under Team."),
      h("span.field-error")),
    field("Note", h("textarea", { name: "note", rows: 3, maxlength: 1000, placeholder: "Can you bring this to Saturday's meeting?" }), { optional: true }),
    h("p.form-error"),
    h("div.row.end", h("button.btn.ghost", { type: "button", onclick: () => m.close() }, "Cancel"), h("button.btn", { type: "submit" }, icon("send", 18), "Send")));
  onSubmit(form, async (v) => {
    const to = $$("input[name=to]:checked", form).map((x) => Number(x.value));
    const r = await api(`/api/admin/shop/orders/${o.id}/send`, { method: "POST", body: { to, note: v.note } });
    m.close(); toast(`Sent to ${r.sent_to.at(-1).to.join(", ")}`); onSent();
  });
  const m = modal(h("div", h("h2", `Send ${o.code}`), form), { label: "Send order" });
}

const sentLine = (o) => {
  const last = (o.sent_to || []).at(-1);
  return last ? h("div.sub", { title: last.note || "" }, `Sent to ${last.to.join(", ")} ${ago(last.at)}`) : null;
};

async function ordersTab(data, reload, setTab, focus) {
  const st = { view: focus ? "all" : "open" };
  const s = data.stats;
  const tableBox = h("div");
  const seg = h("div.seg", VIEWS.map(([v, t]) => h("button", { type: "button", "aria-pressed": String(st.view === v),
    onclick: (e) => { st.view = v; $$("button", seg).forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget))); draw(); } }, t)));
  const act = async (o, action, extra = {}) => {
    try { await api(`/api/admin/shop/orders/${o.id}/status`, { method: "POST", body: { action, ...extra } }); draw(); }
    catch (e) { toast(e.message, "error"); }
  };
  const payDialog = (o) => {
    let method = "venmo";
    const segM = h("div.seg", [["venmo", "Venmo"], ["cash", "Cash"]].map(([v, t]) => h("button", { type: "button", "aria-pressed": String(v === method),
      onclick: (e) => { method = v; $$("button", segM).forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget))); } }, t)));
    const m = modal(h("div", h("h2", `${o.code} paid`),
      h("p", `${money(o.total)} from ${o.name || "someone"}`), segM,
      h("div.row.end", { style: { marginTop: "24px" } },
        h("button.btn.ghost", { type: "button", onclick: () => m.close() }, "Cancel"),
        h("button.btn", { type: "button", onclick: async () => { m.close(); await act(o, "paid", { method }); } }, "Mark paid"))), { label: "Mark paid" });
  };
  const actions = (o) => {
    const b = [];
    if (o.status === "pending") b.push(h("button.btn.small", { type: "button", onclick: () => payDialog(o) }, "Mark paid"));
    if (o.status === "paid" && !o.picked_up) b.push(h("button.btn.small.dark", { type: "button", onclick: () => act(o, "picked_up") }, "Handed out"));
    if (o.status === "paid" && o.picked_up && o.channel === "online") b.push(h("button.btn.small.ghost", { type: "button", onclick: () => act(o, "not_picked_up") }, "Undo"));
    b.push(h("button.icon-btn", { type: "button", "aria-label": `Send ${o.code} to someone`, title: "Send to someone", onclick: () => sendDialog(o, data.people || [], draw) }, icon("send", 16)));
    if (o.status === "pending" || (o.status === "paid" && isAdmin())) b.push(h("button.icon-btn", { type: "button", "aria-label": `Cancel ${o.code}`, title: "Cancel order", onclick: () => cancelDialog(o) }, icon("close", 16)));
    return h("div.row", { style: { gap: "6px", flexWrap: "nowrap", justifyContent: "flex-end" } }, b);
  };
  const cancelDialog = (o) => {
    const paid = o.status === "paid";
    const form = h("form",
      h("p", paid ? `Refund the ${money(o.total)} in Venmo or cash yourself.` : `${o.code} for ${money(o.total)}.`, o.picked_up ? "" : " The items go back in stock."),
      field("Reason", input("reason", { maxlength: 200, required: paid, placeholder: paid ? "Refunded, wrong size" : "" }), { optional: !paid }),
      h("p.form-error"),
      h("div.row.end", h("button.btn.ghost", { type: "button", onclick: () => m.close() }, "Keep it"), h("button.btn.danger", { type: "submit" }, "Cancel order")));
    onSubmit(form, async (v) => { await api(`/api/admin/shop/orders/${o.id}/status`, { method: "POST", body: { action: "cancel", reason: v.reason } }); m.close(); draw(); });
    const m = modal(h("div", h("h2", `Cancel ${o.code}?`), form), { label: "Cancel order" });
  };
  const draw = async () => {
    clear(tableBox).append(loading());
    const list = await api(`/api/admin/shop/orders?view=${st.view}`);
    clear(tableBox).append(list.length ? h("div.tbl-wrap", h("table.tbl.orders-tbl",
      h("thead", h("tr", h("th", "Order"), h("th", "Name"), h("th", "Items"), h("th.num", "Total"), h("th", "Status"), h("th"))),
      h("tbody", list.map((o) => h("tr", { class: o.code === focus ? "focus" : "", "data-code": o.code },
        h("td", h("span.strong.num", o.code), h("div.sub", ago(o.created))),
        h("td", o.name ? h("span", o.name) : h("span.muted", o.channel === "table" ? "At the table" : "–"), o.email ? h("div.sub", o.email) : null),
        h("td", itemsText(o.items), o.note ? h("div.sub.warn", o.note) : null),
        h("td.num", money(o.total), o.method ? h("div.sub", o.method === "cash" ? "Cash" : "Venmo") : null),
        h("td", statusPill(o), o.paid_by === "Venmo email" ? h("div.sub", "Auto-matched") : null, sentLine(o)),
        h("td.actions", actions(o))))))) : empty(st.view === "all" ? "No orders yet." : "Nothing to do here."));
    if (focus) requestAnimationFrame(() => $("tr.focus", tableBox)?.scrollIntoView({ block: "center" }));
  };
  draw();
  const units = s.units.length ? h("details.units", h("summary", "Items sold"),
    h("ul", s.units.map((u) => h("li", h("span", u.item), h("b.num", u.qty))))) : null;
  return h("div",
    h("div.stats.shop-stats", [[money(s.total), "Sold"], [money(s.today), "Today"], [money(s.venmo), "Venmo"], [money(s.cash), "Cash"],
      [s.waiting, "Waiting for payment"], [s.to_hand_out, "To hand out"]].map(([n, t]) => h("div.stat", h("b", n), h("span", t)))),
    units,
    h("div.a-toolbar", seg, h("button.btn.small.ghost", { type: "button", onclick: csv("/api/admin/shop/orders.csv") }, icon("download", 16), "CSV")),
    tableBox);
}

// ---------- products ----------
function stockText(p) {
  const keys = p.options.length ? p.options : [""];
  if (!p.tracked) return p.options.length ? p.options.join(" · ") : "";
  return keys.map((k) => `${k ? k + " " : ""}${p.left[k] ?? "–"}`).join(" · ") + (p.options.length ? "" : " in stock");
}

function productsTab(data, reload, setTab) {
  const redraw = async () => { await reload(); setTab("products"); };
  const open = (p) => productForm(p, redraw);
  return h("div",
    h("div.a-toolbar", h("span"), h("button.btn", { type: "button", onclick: () => open(null) }, icon("plus", 18), "Add product")),
    data.products.length ? h("div.tbl-wrap", h("table.tbl",
      h("thead", h("tr", h("th", "Product"), h("th.num", "Price"), h("th", "Stock"), h("th", "Status"), h("th"))),
      h("tbody", data.products.map((p) => h("tr.click", { onclick: (e) => !e.target.closest("button") && open(p) },
        h("td", h("div.prod-cell", p.photo ? h("img.slot-thumb", { src: media(p.photo.thumb), alt: "" }) : h("span.slot-thumb.blank", icon("bag", 18)), h("span.strong", p.name))),
        h("td.num", money(p.price)),
        h("td.sub", stockText(p) || h("span.muted", "Not counted")),
        h("td", p.active ? (p.sold_out ? pill("closed", "Sold out") : pill("published", "On sale")) : pill("hidden", "Hidden")),
        h("td.actions", h("button.icon-btn", { type: "button", "aria-label": `Edit ${p.name}`, onclick: () => open(p) }, icon("edit", 16)))))))) :
      empty("No products yet.", h("button.btn.dark", { type: "button", onclick: () => open(null) }, "Add a product")));
}

function productForm(p, onDone) {
  const st = { photo: p?.photo || null, options: [...(p?.options || [])], tracked: p ? p.tracked : false, stock: { ...(p?.left || {}) } };
  const loaded = { ...(p?.left || {}) };  // what the form showed, so sales made meanwhile aren't overwritten
  const photoBox = h("div.prod-photo");
  const drawPhoto = () => clear(photoBox).append(
    h("button.prod-photo-btn", { type: "button", "aria-label": st.photo ? "Change picture" : "Add a picture", onclick: () => pickSlotImage(st.photo, (ph) => { st.photo = ph; drawPhoto(); }) },
      st.photo ? h("img", { src: media(st.photo.thumb), alt: "" }) : h("span", icon("image", 28), "Picture")));
  drawPhoto();
  const sizeBox = h("div.size-edit");
  const stockBox = h("div.stock-edit");
  const drawSizes = () => {
    const entry = h("input", { type: "text", placeholder: st.options.length ? "Add" : "S, M, L…", maxlength: 24, "aria-label": "Add a size",
      onkeydown: (e) => {
        if (e.key !== "Enter" && e.key !== ",") return;
        e.preventDefault();
        const v = entry.value.trim();
        if (v && !st.options.includes(v)) st.options.push(v);
        entry.value = ""; drawSizes(); $("input", sizeBox)?.focus();
      } });
    clear(sizeBox).append(h("div.chips-edit",
      st.options.map((o, i) => h("span.chip-x", o, h("button", { type: "button", "aria-label": `Remove ${o}`, onclick: () => { st.options.splice(i, 1); drawSizes(); } }, icon("close", 14)))),
      entry,
      !st.options.length ? h("button.btn.small.ghost", { type: "button", onclick: () => { st.options = [...SIZE_PRESET]; drawSizes(); } }, SIZE_PRESET.join(" ")) : null));
    drawStock();
  };
  const drawStock = () => {
    const keys = st.options.length ? st.options : [""];
    clear(stockBox).append(st.tracked ? h("div.stock-grid", keys.map((k) => h("label.stock-cell", h("span", k || "In stock"),
      h("input", { type: "number", min: 0, max: 99999, inputmode: "numeric", value: st.stock[k] ?? "", oninput: (e) => (st.stock[k] = e.target.value) })))) : null);
  };
  drawSizes();
  const form = h("form.prod-form",
    h("div.prod-top", photoBox, h("div.prod-fields",
      field("Name", input("name", { value: p?.name || "", required: true, maxlength: 80, placeholder: "Club T-shirt" })),
      field("Price", h("div.money-input", h("span", "$"), input("price", { value: p ? (p.price / 100).toFixed(2) : "", required: true, inputmode: "decimal", placeholder: "20.00" }))))),
    field("Description", h("textarea", { name: "description", rows: 2, maxlength: 600 }, p?.description || ""), { optional: true }),
    h("div.field", h("span.field-label", "Sizes", h("span.optional", " optional")), sizeBox),
    h("div.field", sw("tracked", "Count stock", st.tracked, { hintText: "Sales take items off the count, and anything at zero shows as sold out.", onchange: (e) => { st.tracked = e.target.checked; drawStock(); } }), stockBox),
    sw("active", "On sale", p ? p.active : true),
    h("p.form-error"),
    h("div.row", { style: { justifyContent: "space-between", marginTop: "8px" } },
      p ? h("button.btn.ghost", { type: "button", onclick: async () => {
        if (await confirmBox(`Delete ${p.name}? Past orders keep their details.`)) { await api(`/api/admin/shop/products/${p.id}`, { method: "DELETE" }); m.close(); toast("Product deleted"); onDone(); }
      } }, icon("trash", 16), "Delete") : h("span"),
      h("button.btn", { type: "submit" }, p ? "Save" : "Add product")));
  onSubmit(form, async (v) => {
    const keys = st.options.length ? st.options : [""];
    const stock = st.tracked ? Object.fromEntries(keys.map((k) => [k, st.stock[k] === undefined || st.stock[k] === null ? "" : String(st.stock[k])])) : {};
    const body = { name: v.name, price: v.price, description: v.description, options: st.options, stock, active: v.active, photo_id: st.photo?.id || null,
      stock_was: p ? Object.fromEntries(Object.entries(loaded).filter(([, n]) => typeof n === "number")) : undefined };
    await api(p ? `/api/admin/shop/products/${p.id}` : "/api/admin/shop/products", { method: p ? "PUT" : "POST", body });
    m.close(); toast(p ? "Saved" : "Product added"); onDone();
  });
  const m = modal(h("div", h("h2", p ? p.name : "New product"), form), { wide: true, label: "Product" });
}

// ---------- settings (admins) ----------
function settingsTab(data, reload) {
  const s = data.settings;
  const save = async (body, msg = "Saved") => {
    const r = await api("/api/admin/shop/settings", { method: "PUT", body });
    data.settings = r; data.enabled = r.enabled;
    await refreshSite();
    toast(msg);
    return r;
  };
  const show = sw("enabled", "Show the shop on the site", s.enabled, { onchange: async (e) => {
    try { await save({ enabled: e.target.checked }, e.target.checked ? "The shop is on the site" : "The shop is hidden"); go("/team/shop?tab=settings", { replace: true }); }
    catch (err) { e.target.checked = !e.target.checked; toast(err.message, "error"); }
  } });
  const page = h("form",
    field("Page name", input("title", { value: s.title, maxlength: 40 })),
    field("Pickup note", h("textarea", { name: "note", rows: 2, maxlength: 300, placeholder: "Pick up your order at the next club event." }, s.note), { optional: true }),
    h("p.form-error"), h("div.row", h("button.btn", { type: "submit" }, "Save")));
  onSubmit(page, (v) => save({ title: v.title, note: v.note }));

  const statusLine = h("p.imap-status");
  const drawStatus = (x) => {
    clear(statusLine);
    if (!x?.at) return;
    statusLine.className = "imap-status " + (x.ok ? "ok" : "bad");
    statusLine.append(icon(x.ok ? "check" : "info", 16), `${x.message} ${ago(x.at)}.`);
  };
  drawStatus(s.imap_status);
  const imap = h("form",
    h("div.two", field("Mail server", input("host", { value: s.imap.host, placeholder: "imap.gmail.com", autocomplete: "off" })),
      field("Folder", input("folder", { value: s.imap.folder || "INBOX", autocomplete: "off" }), { optional: true })),
    h("div.two", field("Email address", input("user", { value: s.imap.user, type: "email", autocomplete: "off" })),
      field("App password", input("password", { value: s.imap.password, type: "password", autocomplete: "new-password" }),
        { hintText: "Gmail: turn on 2-Step Verification, then make an app password at myaccount.google.com/apppasswords. Use the mailbox Venmo emails when someone pays the club." })),
    field("Club's Venmo email", input("venmo_email", { value: s.imap.venmo_email || "", type: "email", autocomplete: "off", placeholder: s.imap.user || "" }),
      { optional: true, hintText: "The email address on the club's Venmo account. Only payments Venmo sent to this address count. Leave it blank when it's the same as the mailbox above." }),
    field("Trusted mail server", input("authserv", { value: s.imap.authserv || "", placeholder: /gmail/i.test(s.imap.host || "") ? "mx.google.com" : "", autocomplete: "off" }),
      { optional: true, hintText: "The name your mail provider stamps on its checks of incoming mail (the first word of the Authentication-Results header). Gmail is set automatically. Filling this in for other providers stops a forged header from counting." }),
    statusLine,
    h("p.form-error"),
    h("div.row",
      h("button.btn", { type: "submit" }, "Save"),
      h("button.btn.ghost", { type: "button", disabled: !s.imap.host, onclick: async (e) => {
        e.currentTarget.disabled = true;
        try { drawStatus(await api("/api/admin/shop/check-mail", { method: "POST" })); } catch (err) { toast(err.message, "error"); }
        e.currentTarget.disabled = false;
      } }, "Check now")));
  onSubmit(imap, async (v) => { const r = await save({ imap: { host: v.host, folder: v.folder, user: v.user, password: v.password, authserv: v.authserv, venmo_email: v.venmo_email } }); drawStatus(r.imap_status); });

  const mm = s.mail || {};
  const mailForm = h("form",
    field("Sender name", input("mail_from_name", { value: mm.from_name || "", maxlength: 80, placeholder: `${window.SITE?.club_name || "Mahina Club"} Shop` }), { optional: true }),
    h("div.two",
      field("Send from", input("mail_from", { type: "email", value: mm.from || "", placeholder: "shop@example.com" }),
        { optional: true, hintText: "Your email service has to allow sending from this address. With Brevo, Resend, or SendGrid, use an address on the club's verified domain." }),
      field("Replies go to", input("mail_reply_to", { type: "email", value: mm.reply_to || "", placeholder: "treasurer@example.com" }), { optional: true })),
    h("p.form-error"), h("div.row", h("button.btn", { type: "submit" }, "Save")));
  onSubmit(mailForm, (v) => save({ mail: { from_name: v.mail_from_name, from: v.mail_from, reply_to: v.mail_reply_to } }));
  const notify = new Set(s.notify || []);
  const alerts = h("div.stack", (data.people || []).length ? h("div.send-to", data.people.map((p) => h("label.check",
    h("input", { type: "checkbox", checked: notify.has(p.id), onchange: async (e) => {
      if (e.target.checked) notify.add(p.id); else notify.delete(p.id);
      try { await save({ notify: [...notify] }, "Alerts saved"); } catch (err) { toast(err.message, "error"); }
    } }), p.name))) : h("p.muted", "No one can see the shop yet."));
  const sec = (title, body, hintText) => h("section.settings-sec", h("div", h("h2", title, hintText ? hint(hintText) : null)), body);
  return h("div",
    sec("On the site", h("div.stack", show)),
    sec("Page", page),
    sec("Venmo", h("div.stack", data.venmo ? h("p", "Payments go to ", h("b", "@" + data.venmo), ". ", aLink("/settings#give", { class: "text-link" }, "Change")) :
      h("p.form-error", "Add the club's Venmo handle first. ", aLink("/settings#give", { class: "text-link" }, "Settings")))),
    sec("Shop emails", mailForm, "Order emails to buyers and the team go out under this name and address. Leave it blank to use the club's usual email."),
    sec("Order alerts", alerts, "These people get an email when an online order comes in and when it's paid. Only people who can see the shop are listed."),
    sec("Confirm payments automatically", imap,
      "When someone pays, Venmo emails the club. The site reads those emails (it never changes or deletes them) and marks an order paid when the order code and the exact amount both match. Leave this blank to mark orders paid by hand."));
}
