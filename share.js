// NFA Wishlist share page.
//   Friends:  ?list=<slug>                → view + one-click "Mark as purchased" (undo only from the same
//                                            browser); hover ⋯ = Open in new tab / Copy link; after visiting a
//                                            store page, coming back asks "Did you buy …?"
//   Owner:    ?list=<slug>&edit=<token>   → same cards as the extension: 🗑 with Undo, ⋯ menu,
//                                            click-to-edit name/description/price, drag to reorder,
//                                            share button + list menu. Never any claim info.
//   Legacy:   ?list=<slug>&view=me        → read-only owner view (claims hidden)
// Never uses innerHTML: names, descriptions and links come from other websites.
// Hard rules: no Amazon links/images (amazon.js), plain store links only (no affiliate tags),
// the owner never sees claim status.

const $ = (s, el = document) => el.querySelector(s);
const params = new URLSearchParams(location.search);
const slug = (params.get("list") || "").trim();
const editToken = (params.get("edit") || "").trim();
const isEdit = /^[0-9a-f]{32,128}$/i.test(editToken);
const viewOnlyOwner = params.get("view") === "me";
let items = [];          // current items (owner: with position)
let listTitle = "";

// ---------- server ----------

async function rpc(fn, args) {
  const res = await fetch(`${NFA_CONFIG.supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: NFA_CONFIG.supabaseKey, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.message) || `HTTP ${res.status}`);
  return data;
}
const ownerRpc = (fn, extra) => rpc(fn, { p_slug: slug, p_token: editToken, ...extra });

// ---------- helpers ----------

const isWebLink = (u) => { try { return /^https?:$/.test(new URL(u).protocol); } catch (e) { return false; } };
const shopLink = (it) => (it.url && isWebLink(it.url) && !nfaIsAmazon(it.url) ? it.url : "");
const imageLink = (it) => (it.image && isWebLink(it.image) && !nfaIsAmazon(it.image) ? it.image : "");
const friendsUrl = () => `${location.origin}${location.pathname}?list=${encodeURIComponent(slug)}`;

function money(price, currency) {
  if (price == null || price === "") return "";
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(price); }
  catch (e) { return `${currency || "$"} ${Number(price).toFixed(2)}`; }
}
function parseMoney(text) {
  let s = text.replace(/[^0-9.,]/g, "");
  if (!s) return undefined;
  if (s.includes(",") && s.includes(".")) s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (s.includes(",")) s = /,\d{2}$/.test(s) ? s.replace(",", ".") : s.replace(/,/g, "");
  const n = parseFloat(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : undefined;
}

// ---------- toast ----------

function toast(msg, onUndo = null) {
  const t = $("#toast");
  $(".toast-msg", t).textContent = msg;
  const undo = $(".toast-undo", t);
  undo.hidden = !onUndo;
  undo.onclick = () => { hideToast(); onUndo(); };
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(hideToast, onUndo ? 6000 : 3500);
}
function hideToast() { $("#toast").hidden = true; clearTimeout(toast.t); }
$("#toast .toast-close").onclick = hideToast;

async function copyText(text, okMsg) {
  try { await navigator.clipboard.writeText(text); toast(okMsg); return true; }
  catch (e) {
    const ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", ""); ta.style.cssText = "position:fixed;left:-9999px;top:0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy"); ta.remove();
    toast(ok ? okMsg : "Couldn't copy. Try again.");
    return ok;
  }
}
const openNewTab = (url) => window.open(url, "_blank", "noopener,noreferrer");

// ---------- ⋯ menus ----------

let menuOwner = null;
function openMenu(anchor, entries, cardNode = null) {
  const menu = $("#menu");
  if (menuOwner === anchor && !menu.hidden) return closeMenu();
  closeMenu();
  menu.textContent = "";
  entries.filter(Boolean).forEach((en) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "menu-item"; b.setAttribute("role", "menuitem");
    const icon = $("#menuIcons").content.querySelector(`[data-icon="${en.icon}"] svg`);
    if (icon) b.appendChild(icon.cloneNode(true));
    const label = document.createElement("span"); label.textContent = en.label; b.appendChild(label);
    if (en.hint) { const h = document.createElement("span"); h.className = "menu-hint"; h.textContent = en.hint; b.appendChild(h); }
    b.onclick = (e) => { e.stopPropagation(); closeMenu(); en.run(); };
    menu.appendChild(b);
  });
  menu.hidden = false;
  menuOwner = anchor;
  if (cardNode) cardNode.classList.add("menu-open");
  anchor.setAttribute("aria-expanded", "true");
  const a = anchor.getBoundingClientRect(), m = menu.getBoundingClientRect();
  let top = a.bottom + 6, left = a.right - m.width;
  if (top + m.height > window.innerHeight - 8) top = a.top - m.height - 6;
  left = Math.max(8, Math.min(left, window.innerWidth - m.width - 8));
  menu.style.top = `${Math.max(8, top)}px`;
  menu.style.left = `${left}px`;
  menu.querySelector(".menu-item").focus({ preventScroll: true });
}
function closeMenu() {
  $("#menu").hidden = true;
  document.querySelectorAll(".menu-open").forEach((n) => n.classList.remove("menu-open"));
  if (menuOwner) menuOwner.setAttribute("aria-expanded", "false");
  menuOwner = null;
}
document.addEventListener("click", (e) => { if (!e.target.closest("#menu")) closeMenu(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });
window.addEventListener("scroll", () => {
  closeMenu();
  $("#head").classList.toggle("scrolled", window.scrollY > 0);
}, { passive: true });

// ---------- load ----------

function setState(msg) { const s = $("#state"); s.textContent = msg || ""; s.hidden = !msg; }

async function load() {
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(slug)) { setState("This link is missing its list code. Ask for the link again."); return; }
  let data;
  try {
    data = isEdit ? await ownerRpc("owner_list", {}) : await rpc("get_shared_list", { p_slug: slug });
  } catch (e) { setState("Couldn't load this list. Check your connection and refresh."); return; }
  if (!data) {
    setState(isEdit
      ? "This edit link doesn't work anymore. Open your list again from the NFA Wishlist extension (⋯ → Open in new tab)."
      : "This list doesn't exist anymore, or the link is wrong.");
    return;
  }
  const owner = isEdit || viewOnlyOwner || data.is_owner === true;
  document.body.classList.add(isEdit ? "owner" : owner ? "owner-view" : "friend");
  listTitle = data.title;
  renderHeader(owner);
  items = Array.isArray(data.items) ? data.items : [];
  render(owner);
  maybeAsk();
}

function renderHeader(owner) {
  document.title = `${listTitle} · NFA Wishlist`;
  $("#title").textContent = listTitle;
  $("#explainer").textContent = isEdit
    ? "This is your private edit link. Don't share it. Use the share button to send friends their own link. What's been bought stays hidden from you."
    : owner
      ? "This is your list. What's been bought stays hidden from you, so it's still a surprise."
      : "Tap “Mark as purchased” when you get something, so nobody doubles up. The list owner never sees what's been bought.";
  $("#shareBtn").hidden = !isEdit;
  $("#listMenuBtn").hidden = !isEdit;
  $("#intro").hidden = false;
}

const byPosition = (a, b) => ((a.position ?? Infinity) - (b.position ?? Infinity)) || (Date.parse(b.saved_at || 0) - Date.parse(a.saved_at || 0));

function render(owner) {
  const grid = $("#items");
  grid.textContent = "";
  const list = isEdit ? [...items].sort(byPosition) : items;
  if (!list.length) { setState(isEdit ? "Your list is empty. Save things with the NFA Wishlist extension." : "Nothing on this list yet."); return; }
  setState("");
  const tpl = $("#itemTpl");
  // Friends: what's still available stays on top; anything already bought moves to a
  // "Purchased" section at the bottom. (Only on load: a fresh mark stays put so Undo is easy.)
  const friends = !isEdit && !owner;
  const bought = friends ? list.filter((it) => it.claimed === true) : [];
  list.filter((it) => !bought.includes(it)).forEach((it) => grid.appendChild(card(tpl, it, owner)));
  const boughtGrid = $("#bought");
  boughtGrid.textContent = "";
  bought.forEach((it) => boughtGrid.appendChild(card(tpl, it, owner)));
  boughtGrid.hidden = $("#boughtHead").hidden = !bought.length;
}

// ---------- cards ----------

function card(tpl, it, owner) {
  const node = tpl.content.firstElementChild.cloneNode(true);
  node.dataset.id = it.id;
  const link = shopLink(it);
  const amazon = it.amazon_blocked === true || nfaIsAmazon(it.url);

  // Photo, or placeholder
  const media = $(".media", node), img = $(".img", node), noimg = $(".noimg", node);
  const showPlaceholder = () => { img.hidden = true; noimg.hidden = false; };
  $(".noimg-store", node).textContent = amazon ? "" : (it.store || "");
  const src = imageLink(it);
  if (src) { img.src = src; img.alt = it.name || ""; img.onerror = showPlaceholder; } else showPlaceholder();
  if (amazon) {
    const alt = $(".alt", node), q = encodeURIComponent(it.name || "");
    alt.hidden = false;
    $(".alt-etsy", alt).href = `https://www.etsy.com/search?q=${q}`;
    $(".alt-web", alt).href = `https://www.google.com/search?tbm=shop&q=${q}+-amazon`;
  }
  $(".badge-out", node).hidden = it.in_stock !== false;

  // Photo is a real link to the store page: a plain click opens a new tab; Cmd/Ctrl-click or
  // middle-click opens it in the background (only real links can do that; scripts can't).
  if (link) {
    const a = $(".media-link", node);
    a.href = link;
    a.hidden = false;
    a.title = `Open on ${it.store || "the store's site"}`;
    a.setAttribute("aria-label", `Open ${it.name || "item"} on ${it.store || "the store's site"}`);
    const note = () => recordVisit(it, owner);
    a.addEventListener("click", note);
    a.addEventListener("auxclick", (e) => { if (e.button === 1) note(); });
  }

  // Overlay: store name, ⋯ menu, and (edit link only) 🗑
  $(".ov-store", node).textContent = amazon ? "" : (it.store || "");
  const more = $(".more", node);
  more.onclick = (e) => {
    e.stopPropagation();
    const isFirst = !node.previousElementSibling;
    openMenu(more, [
      link && { icon: "open", label: "Open in new tab", run: () => visitStore(it, link, owner) },
      link && { icon: "copy", label: "Copy link", run: () => copyText(link, "Link copied.") },
      isEdit && !isFirst && { icon: "top", label: "Move to top", run: () => moveToTop(it) },
      isEdit && { icon: "edit", label: "Edit details", run: () => $(".t-name", node).click() },
    ], node);
  };
  if (!link && !isEdit) more.remove();

  // Text
  $(".t-name", node).textContent = it.name || "Untitled item";
  $(".t-name", node).title = it.name || "";
  $(".t-desc", node).textContent = it.description || "";
  $(".t-price", node).textContent = money(it.price, it.currency);

  if (isEdit) {
    const del = $(".del", node);
    del.hidden = false;
    del.onclick = (e) => { e.stopPropagation(); removeItem(it, node); };
    node.querySelectorAll(".txt > div").forEach((el) => makeEditable(el, it, node));
    makeDraggable(node, it);
  } else if (!owner) {
    wireClaim(node, it);
  }
  return node;
}

// ---------- owner: remove / undo / move / edit / reorder ----------

async function removeItem(it, node) {
  try {
    const row = await ownerRpc("owner_delete_item", { p_item_id: it.id });
    items = items.filter((x) => x.id !== it.id);
    node.remove();
    if (!items.length) setState("Your list is empty. Save things with the NFA Wishlist extension.");
    if (row) toast("Item removed", async () => {
      try {
        await ownerRpc("owner_restore_item", { p_item: row });
        items.push({ ...it });
        render(true);
      } catch (e) { toast("Couldn't undo. Try again."); }
    });
  } catch (e) { toast("Couldn't remove that. Try again."); }
}

async function setPosition(it, position) {
  it.position = position;
  await ownerRpc("owner_update_item", { p_item_id: it.id, p_patch: { position } });
}

async function moveToTop(it) {
  const sorted = [...items].sort(byPosition);
  if (sorted[0] === it) return;
  const top = sorted[0].position ?? 0;
  try { await setPosition(it, top - 1); render(true); window.scrollTo({ top: 0, behavior: "smooth" }); }
  catch (e) { toast("Couldn't move that. Try again."); }
}

function makeEditable(el, it, cardNode) {
  const field = el.dataset.field;
  el.tabIndex = 0;
  el.setAttribute("role", "textbox");
  el.title = "Click to edit";
  let before = "";
  const start = () => {
    if (el.isContentEditable) return;
    before = el.textContent;
    if (field === "price") el.textContent = it.price == null ? "" : String(it.price);
    el.contentEditable = "plaintext-only";
    el.classList.add("editing");
    cardNode.draggable = false;
    el.focus();
    const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  };
  const finish = async (save) => {
    if (!el.isContentEditable) return;
    el.contentEditable = "false";
    el.classList.remove("editing");
    cardNode.draggable = true;
    const text = el.textContent.replace(/\s+/g, " ").trim();
    if (!save) { el.textContent = before; return; }
    let value = text;
    if (field === "price") {
      value = text === "" ? null : parseMoney(text);
      if (value === undefined) { el.textContent = before; toast("Type a price like 24.99"); return; }
      el.textContent = money(value, it.currency);
      if (value === (it.price == null ? null : Number(it.price))) return;
    } else {
      if (field === "name" && !text) { el.textContent = before; return; }
      el.textContent = text;
      if (text === (it[field] || "")) return;
    }
    const old = it[field];
    it[field] = value;
    try {
      await ownerRpc("owner_update_item", { p_item_id: it.id, p_patch: { [field]: value } });
      if ((value === null || value === "") && old != null && old !== "") {
        toast(`${field === "price" ? "Price" : "Description"} removed`, async () => {
          it[field] = old;
          try { await ownerRpc("owner_update_item", { p_item_id: it.id, p_patch: { [field]: old } }); render(true); }
          catch (e) { toast("Couldn't undo. Try again."); }
        });
      }
    } catch (e) {
      it[field] = old;
      el.textContent = before;
      toast("Couldn't save that change.");
    }
  };
  el.addEventListener("click", start);
  el.addEventListener("keydown", (e) => {
    if (!el.isContentEditable) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); start(); } return; }
    if (e.key === "Enter") { e.preventDefault(); el.blur(); }
    else if (e.key === "Escape") { e.preventDefault(); finish(false); }
  });
  el.addEventListener("blur", () => finish(true));
}

// Drag to reorder (desktop). Cards move out of the way while dragging; only the moved card saves.
let dragged = null, dragStart = -1;
const indexOf = (n) => [...n.parentNode.children].indexOf(n);
function makeDraggable(node, it) {
  node.draggable = true;
  node.addEventListener("dragstart", (e) => {
    if (node.querySelector(".editing")) { e.preventDefault(); return; }
    dragged = node; dragStart = indexOf(node);
    node.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", "");
  });
  node.addEventListener("dragend", async () => {
    node.classList.remove("dragging");
    dragged = null;
    if (indexOf(node) === dragStart) return;
    const pos = (n) => { const x = n && items.find((i) => i.id === n.dataset.id); return x ? x.position : null; };
    const a = pos(node.previousElementSibling), b = pos(node.nextElementSibling);
    let p = a == null ? (b == null ? 0 : b - 1) : b == null ? a + 1 : (a + b) / 2;
    if (a != null && b != null && !(b - a > 1e-9)) {
      // Positions got too close after many moves: renumber all once.
      const ids = [...$("#items").children].map((n) => n.dataset.id);
      try { for (let k = 0; k < ids.length; k++) await setPosition(items.find((i) => i.id === ids[k]), k); }
      catch (e) { toast("Couldn't save the new order."); }
      return;
    }
    try { await setPosition(it, p); } catch (e) { toast("Couldn't save the new order."); render(true); }
  });
}
$("#items").addEventListener("dragover", (e) => {
  if (!dragged) return;
  e.preventDefault();
  const over = e.target.closest(".card");
  if (!over || over === dragged) return;
  const r = over.getBoundingClientRect();
  const ref = e.clientX < r.left + r.width / 2 ? over : over.nextElementSibling;
  if (ref !== dragged && dragged.nextElementSibling !== ref) $("#items").insertBefore(dragged, ref);
});
$("#items").addEventListener("drop", (e) => { if (dragged) e.preventDefault(); });

// ---------- owner header: share + ⋯ (Rename, Copy list, Download list) ----------

$("#shareBtn").onclick = () => copyText(friendsUrl(), "Friends & family link copied.");
$("#listMenuBtn").onclick = (e) => {
  e.stopPropagation();
  openMenu($("#listMenuBtn"), [
    { icon: "edit", label: "Rename", run: openRename },
    { icon: "copy", label: "Copy list", hint: "(text)", run: copyList },
    { icon: "download", label: "Download list", hint: "(CSV)", run: downloadList },
  ]);
};
function openRename() {
  const f = $("#renameForm");
  f.hidden = false;
  $("#renameInput").value = listTitle;
  $("#renameInput").focus(); $("#renameInput").select();
}
$("#renameCancel").onclick = () => { $("#renameForm").hidden = true; };
$("#renameForm").onsubmit = async (e) => {
  e.preventDefault();
  const t = $("#renameInput").value.replace(/\s+/g, " ").trim();
  if (!t) return;
  try {
    await ownerRpc("owner_rename_list", { p_title: t });
    listTitle = t; $("#renameForm").hidden = true; renderHeader(true);
  } catch (err) { toast("Couldn't rename. Try again."); }
};

const sortedItems = () => (isEdit ? [...items].sort(byPosition) : items);
function copyList() {
  const lines = [listTitle, ""];
  sortedItems().forEach((it, n) => {
    const price = money(it.price, it.currency);
    lines.push(`${n + 1}. ${it.name}${price ? " — " + price : ""}`);
    if (it.description) lines.push(`   ${it.description}`);
    const link = shopLink(it);
    if (link) lines.push(`   ${link}`); else if (it.amazon_blocked) lines.push("   (Amazon link removed — find it at an independent shop)");
    lines.push("");
  });
  copyText(lines.join("\n").trim() + "\n", "List copied.");
}
function downloadList() {
  const cell = (v) => { let s = v == null ? "" : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
  const rows = [["Name", "Description", "Price", "Currency", "Store", "Link"]];
  sortedItems().forEach((it) => rows.push([it.name, it.description || "", it.price ?? "", it.currency || "", it.amazon_blocked ? "" : it.store || "", shopLink(it)]));
  const csv = "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = (listTitle.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "wishlist") + "-" + new Date().toISOString().slice(0, 10) + ".csv";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast("List downloaded.");
}

// ---------- friends: one-click "Mark as purchased" ----------
// No names. Marking returns a private token that only this browser keeps (localStorage), and only that
// token can undo it. Lost tokens (cleared browser data, other phone) just mean that mark can't be undone here.

const MINE_KEY = "nfa-purchases";      // { [itemId]: token }
const VISIT_KEY = "nfa-visit";         // { slug, itemId, at } — last store page a friend opened from here
const store_ = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};
const mine = () => store_.get(MINE_KEY) || {};
const setMine = (id, token) => { const m = mine(); if (token) m[id] = token; else delete m[id]; store_.set(MINE_KEY, m); };
const cards = new Map();               // itemId → { node, it }

function wireClaim(node, it) {
  cards.set(it.id, { node, it });
  const token = mine()[it.id];
  if (it.claimed === true) showClaimed(node, it, !!token);
  else { if (token) setMine(it.id, null); showUnclaimed(node, it); }
  $(".buy", node).onclick = () => markPurchased(it);
  $(".unbuy", node).onclick = () => unmarkPurchased(it);
}
function showUnclaimed(node, it) {
  it.claimed = false;
  node.classList.remove("claimed");
  $(".badge-out", node).hidden = it.in_stock !== false;
  $(".buy", node).hidden = false; $(".buy", node).disabled = false;
  $(".unbuy", node).hidden = true;
}
function showClaimed(node, it, isMine) {
  it.claimed = true;
  node.classList.add("claimed");
  $(".badge-out", node).hidden = true; // stock doesn't matter once it's bought
  $(".buy", node).hidden = true;
  $(".unbuy", node).hidden = !isMine; $(".unbuy", node).disabled = false;
}
async function markPurchased(it) {
  const c = cards.get(it.id); if (!c) return;
  $(".buy", c.node).disabled = true;
  try {
    const token = await rpc("mark_purchased", { p_slug: slug, p_item_id: it.id });
    if (token) {
      setMine(it.id, token);
      showClaimed(c.node, it, true);
      // The pointer is still on the button: keep "✓ I gifted this" until it moves away, then hover = Undo.
      const ub = $(".unbuy", c.node);
      ub.classList.add("fresh");
      ub.addEventListener("mouseleave", () => ub.classList.remove("fresh"), { once: true });
      toast("Marked as purchased.", () => unmarkPurchased(it));
    } else {
      showClaimed(c.node, it, false);
      toast("Someone already got this one.");
    }
  } catch (e) {
    $(".buy", c.node).disabled = false;
    toast(/owners cannot claim/i.test(e.message) ? "This is your own list." : "Couldn't save that. Try again.");
  }
}
async function unmarkPurchased(it) {
  const c = cards.get(it.id); const token = mine()[it.id];
  if (!c || !token) return;
  $(".unbuy", c.node).disabled = true;
  try {
    const ok = await rpc("unmark_purchased", { p_slug: slug, p_item_id: it.id, p_token: token });
    setMine(it.id, null);
    if (ok) { showUnclaimed(c.node, it); toast("No longer marked as purchased."); }
    else { showClaimed(c.node, it, false); toast("Couldn't undo that one."); }
  } catch (e) {
    $(".unbuy", c.node).disabled = false;
    toast("Couldn't undo. Try again.");
  }
}

// Remember which store page a friend opened, so coming back can ask "Did you buy …?"
function recordVisit(it, owner) {
  if (!owner && !isEdit && !it.claimed) store_.set(VISIT_KEY, { slug, itemId: it.id, at: Date.now() });
}
function visitStore(it, link, owner) {
  recordVisit(it, owner);
  openNewTab(link);
}
const ASK_MIN_MS = 4000;                 // ignore quick tab flips
const ASK_MAX_MS = 3 * 24 * 3600 * 1000; // forget after 3 days
function maybeAsk() {
  if (isEdit || document.body.classList.contains("owner-view") || !$("#ask").hidden) return;
  const v = store_.get(VISIT_KEY);
  if (!v || v.slug !== slug) return;
  const age = Date.now() - v.at;
  if (age > ASK_MAX_MS) { store_.del(VISIT_KEY); return; }
  if (age < ASK_MIN_MS) return;
  const c = cards.get(v.itemId);
  if (!c || c.it.claimed) { store_.del(VISIT_KEY); return; }
  store_.del(VISIT_KEY);                  // ask once
  $("#askText").textContent = `Did you buy ${c.it.name || "this"}?`;
  const img = $("#askImg"), src = imageLink(c.it);
  if (src) { img.src = src; img.hidden = false; img.onerror = () => { img.hidden = true; }; } else img.hidden = true;
  $("#ask").hidden = false;
  $("#askYes").onclick = () => { $("#ask").hidden = true; markPurchased(c.it); };
  $("#askNo").onclick = () => { $("#ask").hidden = true; };
  $("#askYes").focus({ preventScroll: true });
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") maybeAsk(); });
window.addEventListener("focus", maybeAsk);

load();
