// Public shop: products, a cart, checkout, and the order page where people pay with Venmo.
import { h, $, $$, api, clear, go, icon, link, hint, toast, modal, field, input, onSubmit, honeypot, me, setTitle, media, copy, CFG, empty, plural } from "./core.js";

export const money = (c) => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const label = (it) => it.name + (it.option ? ` (${it.option})` : "");

// The cart lives in this browser only, so it survives a refresh but never leaves the device until checkout.
const cart = {
  get() { try { return JSON.parse(localStorage.getItem("mahina.cart") || "[]"); } catch { return []; } },
  set(v) { try { localStorage.setItem("mahina.cart", JSON.stringify(v)); } catch {} },
};

export async function shopPage() {
  const data = await api("/api/shop");
  setTitle(data.title);
  const byId = Object.fromEntries(data.products.map((p) => [p.id, p]));
  // Drop anything that's no longer for sale since the cart was saved.
  let lines = cart.get().filter((l) => byId[l.product_id] && (!byId[l.product_id].options.length || byId[l.product_id].options.includes(l.option)));
  const save = () => { cart.set(lines); drawBar(); };
  const bar = h("div.cart-bar", { role: "region", "aria-label": "Cart" });
  const drawBar = () => {
    const n = lines.reduce((s, l) => s + l.qty, 0);
    const total = lines.reduce((s, l) => s + l.qty * byId[l.product_id].price, 0);
    bar.hidden = !n;
    clear(bar).append(h("span.cart-sum", icon("bag", 20), h("b", plural(n, "item")), h("span.num", money(total))),
      h("button.btn", { type: "button", onclick: () => checkout(lines, byId, save, data) }, "Check out"));
  };
  const add = (p, option, qty) => {
    const hit = lines.find((l) => l.product_id === p.id && l.option === option);
    if (hit) hit.qty += qty; else lines.push({ product_id: p.id, option, qty });
    save();
    bar.classList.remove("bump"); void bar.offsetWidth; bar.classList.add("bump");
  };
  drawBar();
  return h("div.wrap.shop",
    h("div.page-head", h("h1.h1", data.title), data.note ? h("p.shop-note", data.note) : null),
    data.products.length ? h("div.shop-grid", data.products.map((p) => productCard(p, add))) : empty("Nothing for sale right now."),
    bar);
}

function productCard(p, add) {
  let option = p.options.length ? null : "";  // no size picked for them, so no one gets an S by accident
  let qty = 1;
  const btn = h("button.btn.block", { type: "button" });
  const stockNote = h("span.stock-note");
  const leftFor = (o) => p.left[p.options.length ? o : ""];
  const sync = () => {
    const left = option === null ? undefined : leftFor(option);
    const out = p.sold_out || left === 0;
    btn.disabled = out || option === null;
    btn.textContent = out ? "Sold out" : option === null ? "Pick a size" : "Add to cart";
    stockNote.textContent = !out && typeof left === "number" && left <= 3 ? `Only ${left} left` : "";
    $$(".size-chips button", card).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.o === option)));
  };
  btn.onclick = () => {
    const left = leftFor(option);
    if (typeof left === "number" && qty > left) return toast(`Only ${left} left`, "error");
    add(p, option, qty);
  };
  const card = h("article.product",
    h("div.product-img", p.photo ? h("img", { src: media(p.photo.thumb), alt: "", loading: "lazy" }) : icon("bag", 48)),
    h("div.product-body",
      h("div.product-top", h("h2", p.name), h("span.price", money(p.price))),
      p.description ? h("p.product-desc", p.description) : null,
      p.options.length ? h("div.size-chips", { role: "group", "aria-label": `${p.name} size` }, p.options.map((o) =>
        h("button", { type: "button", "data-o": o, disabled: p.left[o] === 0, "aria-pressed": "false",
          onclick: () => { option = o; sync(); } }, o))) : null,
      h("div.product-buy", btn, stockNote)));
  sync();
  return card;
}

function checkout(lines, byId, save, data) {
  const known = me.get();
  const list = h("div.cart-lines");
  const total = h("b.num");
  const drawLines = () => {
    clear(list).append(lines.map((l, i) => {
      const p = byId[l.product_id];
      const left = p.left[p.options.length ? l.option : ""];
      return h("div.cart-line",
        h("span.cart-name", label({ name: p.name, option: l.option })),
        h("div.stepper.small",
          h("button", { type: "button", "aria-label": "One fewer", onclick: () => { if (l.qty > 1) l.qty--; else lines.splice(i, 1); save(); lines.length ? drawLines() : m.close(); } }, icon(l.qty > 1 ? "minus" : "trash", 16)),
          h("output", l.qty),
          h("button", { type: "button", "aria-label": "One more", disabled: typeof left === "number" && l.qty >= left, onclick: () => { l.qty++; save(); drawLines(); } }, icon("plus", 16))),
        h("span.num.cart-price", money(p.price * l.qty)));
    }));
    total.textContent = money(lines.reduce((s, l) => s + l.qty * byId[l.product_id].price, 0));
  };
  drawLines();
  const form = h("form.popup-form",
    list,
    h("div.cart-total", h("span", "Total"), total),
    field("Name", input("name", { autocomplete: "name", value: known.name || "", required: true })),
    field("Email", input("email", { type: "email", autocomplete: "email", value: known.email || "", required: true })),
    h("div.email-prefs", h("label.check", h("input", { type: "checkbox", name: "news", checked: false }), "Email me about future events and club news")),
    honeypot(),
    h("p.form-error"),
    data.venmo ? h("button.btn.block", { type: "submit" }, "Place order") : h("p.muted", "Online orders open soon."));
  onSubmit(form, async (v) => {
    const o = await api("/api/shop/orders", { method: "POST", body: { ...v, items: lines } });
    me.set({ name: v.name, email: v.email });
    lines.splice(0); save();
    m.close();
    go(`/shop/order/${o.code}`);
  });
  const m = modal(h("div.popup", h("h2", "Your order"), form), { label: "Your order" });
}

const STATUS = { pending: ["Waiting for payment", "pending"], paid: ["Paid", "paid"], cancelled: ["Cancelled", "cancelled"] };

export async function orderPage({ code }) {
  let o = await api(`/api/shop/orders/${encodeURIComponent(code)}`);
  setTitle(`Order ${o.code}`);
  const box = h("div.order");
  let timer = null;
  const stop = () => { clearInterval(timer); timer = null; };
  const draw = () => {
    const [st, cls] = o.picked_up ? ["Picked up", "paid"] : STATUS[o.status] || [o.status, ""];
    const qr = CFG.demo ? (window.MAHINA_DEMO.qr?.() || "") : `/api/shop/orders/${o.code}/qr.svg`;
    clear(box).append(
      h("div.order-head", h("h1.h1", o.code), h("span.order-status", { class: cls }, o.status === "paid" ? icon("check", 18) : null, st)),
      o.status === "pending" && o.venmo ? h("section.order-pay.venmo",
        h("div.order-amount", h("span", "Pay"), h("b.num", money(o.total))),
        h("div.qr.order-qr", h("img", { src: qr, alt: `Venmo QR code to pay ${money(o.total)} for order ${o.code}`, width: 188, height: 188 })),
        h("div.order-actions", h("a.btn", { href: o.venmo.link, target: "_blank", rel: "noopener" }, "Pay with Venmo")),
        h("dl.order-facts",
          h("dt", "To"), h("dd", "@" + o.venmo.handle),
          h("dt", "Note", hint("Keep this note on the payment. It's how we match your payment to your order.")),
          h("dd", `${window.SITE.club_name} order `, h("span.nowrap", o.code,
            h("button.icon-btn.copy-code", { type: "button", "aria-label": "Copy order code", title: "Copy order code", onclick: () => copy(o.code) }, icon("copy", 16)))))) : null,
      h("section.order-items",
        h("ul", o.items.map((it) => h("li", h("span", `${it.qty} × ${label(it)}`), h("span.num", money(it.qty * it.price))))),
        h("div.cart-total", h("span", "Total"), h("b.num", money(o.total)))),
      o.pickup && o.status !== "cancelled" ? h("p.shop-note", o.pickup) : null,
      h("div.row", link("/shop", { class: "btn ghost" }, icon("left", 18), "Back to shop")));
  };
  draw();
  // Watch for the payment to come through while the page is open.
  if (o.status === "pending") {
    let n = 0;
    timer = setInterval(async () => {
      if (!box.isConnected || ++n > 180) return stop();
      if (document.hidden) return;
      try {
        const next = await api(`/api/shop/orders/${o.code}`);
        if (next.status !== o.status) { o = next; draw(); if (o.status === "paid") toast("Payment received. Mahalo!"); }
        if (o.status !== "pending") stop();
      } catch {}
    }, 5000);
  }
  return h("div.wrap.narrow", box);
}
