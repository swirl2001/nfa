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

if (location.hostname === "www.nfawishlist.com") location.replace("https://nfawishlist.com" + location.pathname + location.search);
const $ = (s, el = document) => el.querySelector(s);
// Read from the address bar in readParams() (again after a Google sign-in returns here).
let params, slug, editToken, isEdit, viewOnlyOwner;
let signedInOwner = false; // signed in with Google and this is their list: edit mode, token kept in memory only
function readParams() {
  params = new URLSearchParams(location.search);
  slug = (params.get("list") || "").trim();
  editToken = (params.get("edit") || "").trim();
  isEdit = /^[0-9a-f]{32,128}$/i.test(editToken);
  viewOnlyOwner = params.get("view") === "me";
}
readParams();
let items = [];          // current items (owner: with position)
let listTitle = "";

// ---------- server ----------

async function rpc(fn, args, anon = false) {
  const headers = { apikey: NFA_CONFIG.supabaseKey, "Content-Type": "application/json" };
  const tok = anon ? null : await NFAAuth.token(); // signed in with Google: the server knows who's asking
  if (tok) headers.Authorization = `Bearer ${tok}`;
  const res = await fetch(`${NFA_CONFIG.supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: "POST", headers, body: JSON.stringify(args),
  });
  // A sign-in the server no longer accepts must never block the list: forget it and ask again as a guest.
  if (res.status === 401 && tok) { NFAAuth.forget(); renderAccount(); return rpc(fn, args, true); }
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

// opts.sticky: stays until closed (no timer). opts.url: shown under the message, selectable, with a copy button.
function toast(msg, onUndo = null, opts = {}) {
  const t = $("#toast");
  $(".toast-msg", t).textContent = msg;
  const undo = $(".toast-undo", t);
  undo.hidden = !onUndo;
  undo.onclick = () => { hideToast(); onUndo(); };
  t.hidden = false;
  const url = $(".toast-url", t), cp = $(".toast-copy", t);
  url.textContent = (opts.url || "").replace(/^https?:\/\//, ""); // shorter to read; the copy button copies the full link
  url.hidden = cp.hidden = !opts.url;
  cp.onclick = async () => { const ok = await copyQuiet(opts.url); $(".toast-msg", t).textContent = ok ? "Link copied." : "Couldn't copy. Select the link and copy it."; };
  t.classList.toggle("has-url", !!opts.url);
  toast.sticky = !!opts.sticky;
  toast.ms = onUndo ? 6000 : 3500;
  clearTimeout(toast.t);
  if (!toast.sticky) toast.t = setTimeout(hideToast, toast.ms);
}
// Keep the message (and its Undo) up while the pointer or keyboard focus is on it.
{
  const t = $("#toast");
  const hold = () => clearTimeout(toast.t);
  const resume = () => { if (!toast.sticky && !t.hidden && !t.matches(":hover") && !t.contains(document.activeElement)) { clearTimeout(toast.t); toast.t = setTimeout(hideToast, toast.ms || 3500); } };
  t.addEventListener("mouseenter", hold); t.addEventListener("focusin", hold);
  t.addEventListener("mouseleave", resume); t.addEventListener("focusout", () => setTimeout(resume, 0));
}
// Screen-reader-only announcement (things that appear without moving focus).
function announce(msg) { const r = $("#sr"); r.textContent = ""; setTimeout(() => { r.textContent = msg; }, 50); }
const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
function hideToast() { $("#toast").hidden = true; toast.sticky = false; clearTimeout(toast.t); }
$("#toast .toast-close").onclick = hideToast;

// Copy without a message; true if it worked.
async function copyQuiet(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) {
    const ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", ""); ta.style.cssText = "position:fixed;left:-9999px;top:0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy"); ta.remove();
    return ok;
  }
}
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
    if (en.info) { const d = document.createElement("div"); d.className = "menu-info"; d.textContent = en.info; menu.appendChild(d); return; }
    const b = document.createElement("button");
    b.type = "button"; b.className = "menu-item"; b.setAttribute("role", "menuitem");
    const icon = $("#menuIcons").content.querySelector(`[data-icon="${en.icon}"] svg`);
    if (icon) b.appendChild(icon.cloneNode(true));
    const label = document.createElement("span"); label.textContent = en.label; b.appendChild(label);
    if (en.hint) { const h = document.createElement("span"); h.className = "menu-hint"; h.textContent = en.hint; b.appendChild(h); }
    b.tabIndex = -1;
    b.onclick = (e) => { e.stopPropagation(); closeMenu(true); en.run(); };
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
// returnFocus: put keyboard focus back on the ⋯ button that opened the menu.
function closeMenu(returnFocus = false) {
  $("#menu").hidden = true;
  document.querySelectorAll(".menu-open").forEach((n) => n.classList.remove("menu-open"));
  const owner = menuOwner;
  if (owner) owner.setAttribute("aria-expanded", "false");
  menuOwner = null;
  if (returnFocus && owner && owner.isConnected) owner.focus({ preventScroll: true });
}
document.addEventListener("click", (e) => { if (!e.target.closest("#menu")) closeMenu(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#menu").hidden) { e.preventDefault(); closeMenu(true); } });
$("#menu").addEventListener("keydown", (e) => {
  const list = [...$("#menu").querySelectorAll(".menu-item")];
  const i = list.indexOf(document.activeElement);
  const go = (k) => { e.preventDefault(); list[(k + list.length) % list.length].focus(); };
  if (e.key === "ArrowDown") go(i + 1);
  else if (e.key === "ArrowUp") go(i - 1);
  else if (e.key === "Home") go(0);
  else if (e.key === "End") go(list.length - 1);
  else if (e.key === "Tab") { e.preventDefault(); closeMenu(true); }
});
window.addEventListener("scroll", () => {
  closeMenu();
  $("#head").classList.toggle("scrolled", window.scrollY > 0);
}, { passive: true });

// ---------- load ----------

function setState(msg) { const s = $("#state"); s.textContent = msg || ""; s.hidden = !msg; }

async function load() {
  const authMsg = await NFAAuth.finishRedirect(); // back from Google's sign-in page?
  readParams();
  renderAccount();
  if (authMsg) toast(authMsg);
  maybeAutoSignIn(); // in parallel: only acts if the NFA extension here is signed in and this site isn't
  if (!slug) { showLanding(); return; } // nfawishlist.com with no list code → home page
  // Signed in and it's your list: edit it here (same as the private edit link, but the token
  // stays in memory, so the address bar keeps showing the friends link).
  if (!isEdit && NFAAuth.user() && /^[A-Za-z0-9_-]{6,64}$/.test(slug)) {
    const mine = await rpc("my_edit_link", { p_slug: slug }).catch(() => null);
    if (mine && mine.token) { editToken = mine.token; isEdit = true; signedInOwner = true; }
  }
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(slug)) { setState("This link is missing its list code. Ask for the link again."); return; }
  let data, ownsHere = false;
  try {
    // Friends link: also check (in parallel) whether this browser belongs to the list's owner.
    [data, ownsHere] = await Promise.all([
      isEdit ? ownerRpc("owner_list", {}) : rpc("get_shared_list", { p_slug: slug }),
      isEdit ? false : isMyList(slug),
    ]);
  } catch (e) { setState("Couldn't load this list. Check your connection and refresh."); return; }
  if (!data) {
    setState(isEdit
      ? "This edit link doesn't work anymore. Open your list again from the NFA Wishlist extension (⋯ → Open in new tab)."
      : "This list doesn't exist anymore, or the link is wrong.");
    return;
  }
  if (isEdit) rememberMyList(slug); // this browser now knows the list is yours
  const owner = isEdit || viewOnlyOwner || ownsHere || data.is_owner === true;
  document.body.classList.add(isEdit ? "owner" : owner ? "owner-view" : "friend");
  listTitle = data.title;
  renderHeader(owner);
  items = Array.isArray(data.items) ? data.items : [];
  render(owner);
  loadDetails(); // note + shipping address (each optional)
  maybeAsk();
}

function showLanding() {
  setState("");
  document.body.classList.add("home");
  document.title = "NFA Wishlist · Shop small, shop local";
  $("#landing").hidden = false;
  showMyListLink();
}

// Home page, signed in: link to your own list.
async function showMyListLink() {
  const box = $("#myList");
  if (!NFAAuth.user()) { box.hidden = true; return; }
  const mine = await rpc("my_list_link", {}).catch(() => null);
  box.textContent = "";
  if (mine && mine.slug) {
    const a = document.createElement("a");
    a.className = "text-link";
    a.href = `${location.pathname}?list=${encodeURIComponent(mine.slug)}`;
    a.textContent = "Open your list";
    box.append(a);
  } else {
    box.textContent = "No list yet. Save something with the NFA Wishlist extension, then choose Sign in with Google in its ⋯ menu.";
  }
  box.hidden = false;
}

// ---------- account (optional Google sign-in) ----------
// Signed out: a quiet "Sign in" text link. Signed in: a round initial that opens Email / Sign out.
function renderAccount() {
  const box = $("#account");
  box.textContent = "";
  const u = NFAAuth.user();
  if (!u) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "text-link"; b.textContent = "Sign in";
    b.onclick = () => NFAAuth.signIn();
    box.append(b);
    return;
  }
  const b = document.createElement("button");
  b.type = "button"; b.className = "avatar-btn"; b.setAttribute("aria-haspopup", "menu");
  b.setAttribute("aria-label", `Account: ${u.email || "signed in"}`);
  b.title = u.email || "Signed in";
  b.textContent = ((u.name || u.email || "?").trim()[0] || "?").toUpperCase();
  b.onclick = (e) => {
    e.stopPropagation();
    openMenu(b, [
      { info: u.email ? `Signed in as ${u.email}` : "Signed in with Google" },
      { label: "Sign out", run: async () => { await NFAAuth.signOut(); location.reload(); } },
    ]);
  };
  box.append(b);
}

function renderHeader(owner) {
  document.title = `${listTitle} · NFA Wishlist`;
  $("#title").textContent = listTitle;
  $("#explainer").textContent = signedInOwner
    ? "This is your list. Edit it here, and use the share button to copy the link for friends. What's been bought stays hidden from you."
    : isEdit
    ? "This is your private edit link. Don't share it. Use the share button to send friends their own link. What's been bought stays hidden from you."
    : owner
      ? "Don't spoil the surprise! This is your list, so what friends buy stays hidden from you."
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
  // Owner (edit link): things they marked "I own this" move down the same way. Never friends' marks.
  const friends = !isEdit && !owner;
  const bought = isEdit ? list.filter((it) => it.owned === true)
    : friends ? list.filter((it) => it.claimed === true) : [];
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
  const label = it.name || "this item";
  const more = $(".more", node);
  more.setAttribute("aria-label", `More options for ${label}`);
  $(".del", node).setAttribute("aria-label", `Remove ${label}`);
  $(".buy", node).setAttribute("aria-label", `Mark ${label} as purchased`);
  $(".unbuy", node).setAttribute("aria-label", `I gifted ${label}. Click to undo.`);
  more.onclick = (e) => {
    e.stopPropagation();
    const inTop = node.parentElement === $("#items");
    const isFirst = !node.previousElementSibling, isLast = !node.nextElementSibling;
    openMenu(more, [
      isEdit && { icon: "edit", label: "Edit details", run: () => $(".t-name", node).click() },
      link && { icon: "open", label: "Open in new tab", run: () => visitStore(it, link, owner) },
      link && { icon: "copy", label: "Copy link", run: () => copyText(link, "Link copied.") },
      isEdit && inTop && !isFirst && { icon: "top", label: "Move to top", run: () => moveToTop(it) },
      isEdit && inTop && !isFirst && { icon: "up", label: "Move up", run: () => moveBy(it, node, -1) },
      isEdit && inTop && !isLast && { icon: "down", label: "Move down", run: () => moveBy(it, node, 1) },
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
    wireOwned(node, it);
  } else if (!owner) {
    wireClaim(node, it);
  }
  return node;
}

// ---------- owner: "Mark as purchased" → "✓ I own this" (their own flag, separate from friends' marks) ----------

function wireOwned(node, it) {
  const buy = $(".buy", node), unbuy = $(".unbuy", node);
  $(".unbuy-on", node).textContent = "✓ I own this";
  unbuy.setAttribute("aria-label", `I own ${it.name || "this item"}. Click to undo.`);
  // Owner's own page: items they own stay in full colour (greyed-out is only for friends,
  // where it means "not available"). They still move to the bottom section on the next load.
  const show = () => {
    buy.hidden = it.owned === true;
    unbuy.hidden = it.owned !== true;
  };
  show();
  async function setOwned(value) {
    buy.disabled = unbuy.disabled = true;
    try {
      if (!(await ownerRpc("owner_set_owned", { p_item_id: it.id, p_owned: value }))) throw new Error("not saved");
      it.owned = value;
      show();
      if (value) {
        toast("Marked as yours. Friends will see it's taken.", () => setOwned(false));
      } else {
        toast("No longer marked as yours.");
      }
    } catch (e) {
      toast("Couldn't save that. Try again.");
    } finally {
      buy.disabled = unbuy.disabled = false;
    }
  }
  buy.onclick = (e) => { e.stopPropagation(); setOwned(true); };
  unbuy.onclick = (e) => { e.stopPropagation(); setOwned(false); };
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
  try {
    await setPosition(it, top - 1); render(true);
    window.scrollTo({ top: 0, behavior: reduceMotion() ? "auto" : "smooth" });
    refocus(it); announce(`${it.name || "Item"} moved to the top.`);
  } catch (e) { toast("Couldn't move that. Try again."); }
}

// Keyboard/no-drag reorder: one step up (-1) or down (+1) within the main grid.
async function moveBy(it, node, dir) {
  const cards = [...$("#items").children];
  const i = cards.indexOf(node), j = i + dir;
  if (i < 0 || j < 0 || j >= cards.length) return;
  const pos = (n) => { const x = n && items.find((y) => y.id === n.dataset.id); return x ? x.position : null; };
  // New spot: between the neighbour we jump over and the one after it.
  const a = pos(cards[j]), b = pos(cards[j + dir]);
  const p = b == null ? a + dir : (a + b) / 2;
  try {
    if (a == null || (b != null && Math.abs(b - a) < 1e-9)) { // missing/too-close positions: renumber in the new order
      cards.splice(j, 0, cards.splice(i, 1)[0]);
      for (let k = 0; k < cards.length; k++) await setPosition(items.find((y) => y.id === cards[k].dataset.id), k);
    } else {
      await setPosition(it, p);
    }
    render(true); refocus(it);
    announce(`${it.name || "Item"} moved ${dir < 0 ? "up" : "down"}.`);
  } catch (e) { toast("Couldn't move that. Try again."); }
}
// After a re-render, put focus back on the moved card's ⋯ button.
function refocus(it) {
  const btn = document.querySelector(`.card[data-id="${CSS.escape(it.id)}"] .more`);
  if (btn) btn.focus({ preventScroll: false });
}

function makeEditable(el, it, cardNode) {
  const field = el.dataset.field;
  el.tabIndex = 0;
  el.setAttribute("role", "textbox");
  el.setAttribute("aria-label", { name: "Item name", description: `Description for ${it.name || "item"}`, price: `Price for ${it.name || "item"}` }[field] || field);
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

// Share: copy the friends link and keep it on screen (until closed) to copy again or select by hand.
$("#shareBtn").onclick = async () => {
  const url = friendsUrl();
  const ok = await copyQuiet(url);
  toast(ok ? "Friends & family link copied." : "Here's your friends & family link.", null, { sticky: true, url });
};
$("#listMenuBtn").onclick = (e) => {
  e.stopPropagation();
  openMenu($("#listMenuBtn"), [
    { icon: "edit", label: "Rename", run: openRename },
    { icon: "note", label: "Add note / address", run: openDetails },
    { icon: "plus", label: "Add item", run: openNewItem },
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
  // After answering, keyboard focus goes back to that item (not the top of the page).
  const back = (sel) => { const el = $(sel, c.node) || $(".media-link", c.node); if (el && !el.hidden) el.focus({ preventScroll: false }); };
  $("#askYes").onclick = async () => { $("#ask").hidden = true; await markPurchased(c.it); back(".unbuy"); };
  $("#askNo").onclick = () => { $("#ask").hidden = true; back(".buy"); };
  $("#askYes").focus({ preventScroll: true });
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") maybeAsk(); });
window.addEventListener("focus", maybeAsk);

// ---------- "is this my own list?" (surprise protection for the friends link) ----------
// The website has no sign-in, so it can't ask the server. Two courtesy checks instead:
//   1. this browser has opened the list's private edit link before (localStorage), or
//   2. the NFA extension in this Chrome says the list is yours (externally_connectable message).
// If either says yes, the friends link shows the owner view: no purchases, no buttons.
const OWNED_KEY = "nfa-owned";          // [slug, …] lists whose edit link was opened in this browser
function rememberMyList(s) {
  const owned = store_.get(OWNED_KEY) || [];
  if (!owned.includes(s)) store_.set(OWNED_KEY, [...owned, s].slice(-20));
}
async function isMyList(s) {
  if ((store_.get(OWNED_KEY) || []).includes(s)) return true;
  const ids = (NFA_CONFIG.extensionIds || []);
  const rt = window.chrome && chrome.runtime && chrome.runtime.sendMessage ? chrome.runtime : null;
  if (!rt || !ids.length) return false;
  const ask = (id) => new Promise((resolve) => {
    setTimeout(() => resolve(false), 1000); // extension missing or asleep: don't hold up the page
    try {
      rt.sendMessage(id, { type: "nfa-owns", slug: s }, (r) => { void chrome.runtime.lastError; resolve(!!(r && r.owns === true)); });
    } catch (e) { resolve(false); }
  });
  const mine = (await Promise.all(ids.map(ask))).some(Boolean);
  if (mine) rememberMyList(s);
  return mine;
}

// The NFA extension in this Chrome is signed in with Google but this site isn't: sign the site in too.
async function maybeAutoSignIn() {
  if (NFAAuth.user()) return;
  const ids = NFA_CONFIG.extensionIds || [];
  const rt = window.chrome && chrome.runtime && chrome.runtime.sendMessage ? chrome.runtime : null;
  if (!rt || !ids.length) return;
  for (const id of ids) {
    const a = await new Promise((resolve) => {
      setTimeout(() => resolve(null), 1000);
      try { rt.sendMessage(id, { type: "nfa-account" }, (r) => { void chrome.runtime.lastError; resolve(r || null); }); }
      catch (e) { resolve(null); }
    });
    if (a && a.signedIn) { NFAAuth.autoSignIn(typeof a.email === "string" ? a.email : ""); return; }
  }
}

load();


// ---------- note + shipping address (migration 007) ----------
// Both optional. The server decides what each viewer may see (list_details); the owner reads and
// saves everything with the edit token (owner_details / owner_set_details). Plain text only.
let details = null; // owner: {note, note_visibility, address, address_visibility}; friends: {note, address, address_locked}
const SHIP_OPEN = "nfa-open-ship"; // sessionStorage: reopen the address after signing in to see it
const PIN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>';
const LOCK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
function setIcon(el, svgText) { // our own constant SVG, parsed as SVG (no page data involved)
  el.textContent = "";
  el.appendChild(new DOMParser().parseFromString(svgText, "image/svg+xml").documentElement);
}

async function loadDetails() {
  try { details = isEdit ? await ownerRpc("owner_details", {}) : await rpc("list_details", { p_slug: slug }); }
  catch (e) { details = null; } // not set up on the server yet: simply no note or address
  renderDetails();
}

// What shows under the title. The owner sees what friends could see (not "Don't show it" ones).
function renderDetails() {
  const d = details || {};
  const editing = !$("#detailsForm").hidden;
  const ownerData = "note_visibility" in d;
  const note = (d.note || "").trim();
  const noteShown = note && !(ownerData && d.note_visibility === "hidden");
  const addr = (d.address || "").trim();
  const addrShown = addr && !(ownerData && d.address_visibility === "hidden");
  const locked = !addrShown && d.address_locked === true;

  $("#noteText").textContent = noteShown ? note : "";
  $("#noteText").hidden = editing || !noteShown;

  const ship = $("#ship");
  ship.hidden = editing || !(addrShown || locked);
  if (!ship.hidden) {
    setIcon($("#shipIcon"), locked ? LOCK : PIN);
    $("#shipCopy").hidden = !addrShown;
    $("#shipCopy").onclick = () => copyText(addr, "Address copied.");
    const body = $("#shipBody");
    body.textContent = "";
    if (addrShown) {
      const a = document.createElement("address");
      a.textContent = addr;
      body.appendChild(a);
    } else {
      const p = document.createElement("p");
      p.className = "ship-muted";
      p.textContent = "This address is shared with anyone who signs in.";
      const b = document.createElement("button");
      b.type = "button"; b.className = "text-link"; b.textContent = "Sign in with Google to see it";
      b.onclick = () => { try { sessionStorage.setItem(SHIP_OPEN, "1"); } catch (e) {} NFAAuth.signIn(); };
      body.append(p, b);
    }
    let reopen = false;
    try { reopen = sessionStorage.getItem(SHIP_OPEN) === "1" && addrShown; if (reopen) sessionStorage.removeItem(SHIP_OPEN); } catch (e) {}
    setShipOpen(reopen || isShipOpen()); // closed by default; stays as the viewer left it
  }
  $("#details").hidden = $("#noteText").hidden && ship.hidden && !editing;
}
const isShipOpen = () => $("#shipToggle").getAttribute("aria-expanded") === "true";
function setShipOpen(open) {
  $("#shipBody").hidden = !open;
  ["#shipToggle", "#shipChev"].forEach((s) => $(s).setAttribute("aria-expanded", String(open)));
  $("#shipChev").classList.toggle("open", open);
  $("#shipChev").setAttribute("aria-label", open ? "Hide shipping address" : "Show shipping address");
}
$("#shipToggle").onclick = () => setShipOpen(!isShipOpen());
$("#shipChev").onclick = () => setShipOpen(!isShipOpen());

// Owner: ⋯ → Add note / address
const radio = (name, value) => { const r = document.querySelector(`input[name="${name}"][value="${value}"]`); if (r) r.checked = true; };
const radioValue = (name) => (document.querySelector(`input[name="${name}"]:checked`) || {}).value;
function setAddrOpen(open) {
  $("#addrPanel").hidden = !open;
  $("#addrToggle").setAttribute("aria-expanded", String(open));
  $("#addrToggle").classList.toggle("open", open);
}
function openDetails() {
  const d = details || {};
  $("#noteInput").value = d.note || "";
  radio("noteVis", d.note_visibility || "public");
  $("#addrInput").value = d.address || "";
  radio("addrVis", d.address_visibility || "signed_in");
  const lbl = $("#addrToggleLabel");
  lbl.textContent = "";
  if (d.address) lbl.append("Shipping address");
  else { lbl.append("Add shipping address "); const o = document.createElement("span"); o.className = "opt"; o.textContent = "(optional)"; lbl.append(o); }
  setAddrOpen(false); // closed until the owner opens it
  $("#detailsForm").hidden = false;
  renderDetails();
  $("#noteInput").focus();
}
function closeDetails() {
  $("#detailsForm").hidden = true;
  renderDetails();
  $("#listMenuBtn").focus();
}
$("#addrToggle").onclick = () => { setAddrOpen($("#addrPanel").hidden); if (!$("#addrPanel").hidden) $("#addrInput").focus(); };
$("#detailsCancel").onclick = closeDetails;
let savingDetails = false;
$("#detailsForm").onsubmit = async (e) => {
  e.preventDefault();
  if (savingDetails) return;
  savingDetails = true;
  const next = {
    note: $("#noteInput").value.trim().slice(0, 500), note_visibility: radioValue("noteVis") || "public",
    address: $("#addrInput").value.trim().slice(0, 400), address_visibility: radioValue("addrVis") || "signed_in",
  };
  try {
    const ok = await ownerRpc("owner_set_details", {
      p_note: next.note, p_note_visibility: next.note_visibility,
      p_address: next.address, p_address_visibility: next.address_visibility,
    });
    if (!ok) throw new Error("not saved");
    details = { ...next, note: next.note || null, address: next.address || null };
    closeDetails();
    toast("Saved.");
  } catch (e) {
    toast("Couldn't save. Check your connection and try again.");
  } finally {
    savingDetails = false;
  }
};


// ---------- owner: ⋯ → Add item (your own item, not saved from a shop) ----------
// A blank card at the top of the list: photo (upload; needs Google sign-in), name, link (optional),
// description, price. Saved with owner_restore_item (inserts an item with our own id). Photos are
// resized to ≤1600px JPEG in the browser and uploaded to Storage bucket item-photos/<user id>/ (migration 008).
const PHOTO_BUCKET = "item-photos";
let newItemPhoto = null; // Blob ready to upload

function openNewItem() {
  const existing = $("#newItem");
  if (existing) { $("#niName").focus(); return; }
  const node = buildNewItemCard();
  $("#items").prepend(node);
  setState("");
  node.scrollIntoView({ block: "nearest", behavior: reduceMotion() ? "auto" : "smooth" });
  $("#niName").focus();
}

function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k in n && typeof v !== "string") n[k] = v;
    else n.setAttribute(k, v);
  }
  kids.forEach((c) => c && n.append(c));
  return n;
}

function buildNewItemCard() {
  newItemPhoto = null;
  const signedIn = !!NFAAuth.user();
  const card = el("article", { class: "card new-card", id: "newItem", "aria-label": "New item" });

  // Photo
  const media = el("div", { class: "media new-media" });
  const preview = el("img", { class: "img", alt: "", hidden: true });
  const file = el("input", { type: "file", id: "niPhoto", accept: "image/jpeg,image/png,image/webp", class: "sr-only" });
  const pick = el("label", { class: "new-photo", for: "niPhoto" },
    el("span", { class: "new-photo-icon", "aria-hidden": "true", text: "+" }),
    el("span", { class: "new-photo-label", text: "Add photo" }));
  if (signedIn) {
    file.onchange = async () => {
      const f = file.files && file.files[0];
      if (!f) return;
      try {
        const { blob, dataUrl } = await shrinkPhoto(f);
        newItemPhoto = blob;
        preview.src = dataUrl; preview.hidden = false; preview.alt = "Photo for the new item";
        pick.classList.add("has-photo");
        $(".new-photo-label", pick).textContent = "Change photo";
      } catch (e) {
        toast("Couldn't use that photo. Try a JPG or PNG.");
      }
    };
    media.append(preview, file, pick);
  } else {
    const b = el("button", { type: "button", class: "text-link", text: "Sign in to add a photo" });
    b.onclick = () => NFAAuth.signIn();
    media.append(el("div", { class: "new-photo new-photo-off" }, b));
  }

  // Fields
  const field = (id, label, input) => el("div", { class: "new-field" }, el("label", { for: id, text: label }), input);
  const name = el("input", { id: "niName", type: "text", maxlength: "200", autocomplete: "off" });
  const link = el("input", { id: "niLink", type: "url", maxlength: "2000", placeholder: "https://", autocomplete: "off" });
  const desc = el("textarea", { id: "niDesc", rows: "2", maxlength: "1000" });
  const price = el("input", { id: "niPrice", type: "text", inputmode: "decimal", maxlength: "20", placeholder: "$0.00", autocomplete: "off" });
  const err = el("p", { class: "new-error", id: "niError", role: "alert", hidden: true });
  const save = el("button", { type: "submit", class: "text-link", text: "Add to list" });
  const cancel = el("button", { type: "button", class: "text-link", text: "Cancel" });
  cancel.onclick = closeNewItem;

  const form = el("form", { class: "new-form", novalidate: true },
    field("niName", "Name", name),
    field("niLink", "Link (optional)", link),
    field("niDesc", "Description (optional)", desc),
    field("niPrice", "Price (optional)", price),
    err,
    el("div", { class: "new-actions" }, save, cancel));
  form.onsubmit = (e) => { e.preventDefault(); saveNewItem(save); };
  card.append(media, form);
  return card;
}

function closeNewItem() {
  const n = $("#newItem");
  if (n) n.remove();
  newItemPhoto = null;
  if (!items.length) setState("Your list is empty. Save things with the NFA Wishlist extension.");
  $("#listMenuBtn").focus();
}

function newItemError(msg, focusId) {
  const e = $("#niError");
  e.textContent = msg; e.hidden = !msg;
  if (focusId) $("#" + focusId).focus();
}

// Resize to ≤1600px on the long side, JPEG ~85%. Returns the upload blob + a data: preview (CSP allows data: images).
async function shrinkPhoto(file) {
  if (file.size > 25 * 1024 * 1024) throw new Error("too big");
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h); // transparent PNGs get a white background
  ctx.drawImage(bmp, 0, 0, w, h);
  const blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("encode"))), "image/jpeg", 0.85));
  return { blob, dataUrl: c.toDataURL("image/jpeg", 0.7) };
}

async function uploadPhoto(blob) {
  const tok = await NFAAuth.token(), uid = NFAAuth.userId();
  if (!tok || !uid) throw new Error("Sign in to add a photo.");
  const path = `${uid}/${crypto.randomUUID()}.jpg`;
  const res = await fetch(`${NFA_CONFIG.supabaseUrl}/storage/v1/object/${PHOTO_BUCKET}/${path}`, {
    method: "POST",
    headers: { apikey: NFA_CONFIG.supabaseKey, Authorization: `Bearer ${tok}`, "Content-Type": "image/jpeg", "x-upsert": "false", "cache-control": "31536000" },
    body: blob,
  });
  if (!res.ok) throw new Error(`upload ${res.status}`);
  return `${NFA_CONFIG.supabaseUrl}/storage/v1/object/public/${PHOTO_BUCKET}/${path}`;
}

let savingNew = false;
async function saveNewItem(btn) {
  if (savingNew) return;
  newItemError("");
  const name = $("#niName").value.replace(/\s+/g, " ").trim().slice(0, 200);
  let url = $("#niLink").value.trim();
  const description = $("#niDesc").value.replace(/\s+/g, " ").trim().slice(0, 1000);
  const priceText = $("#niPrice").value.trim();
  if (!name) return newItemError("Add a name for this item.", "niName");
  if (url) {
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    if (!isWebLink(url)) return newItemError("That link doesn't look right. Check it, or leave it empty.", "niLink");
    if (nfaIsAmazon(url)) return newItemError("NFA doesn't link to Amazon. Add a link to another shop, or leave it empty.", "niLink");
  }
  let price = null;
  if (priceText) {
    const p = parseMoney(priceText);
    if (p === undefined) return newItemError("Enter a price like 24 or 24.50, or leave it empty.", "niPrice");
    price = p;
  }
  savingNew = true;
  btn.disabled = true; btn.textContent = newItemPhoto ? "Uploading photo…" : "Adding…";
  try {
    const image = newItemPhoto ? await uploadPhoto(newItemPhoto) : null;
    const top = Math.min(0, ...items.map((i) => (typeof i.position === "number" ? i.position : Number(i.position) || 0)));
    const store = url ? new URL(url).hostname.replace(/^www\./, "") : null;
    const item = {
      id: crypto.randomUUID(), name, description: description || null, url: url || null, store,
      image, price, saved_price: price, currency: price == null ? null : "USD",
      position: top - 1, saved_at: new Date().toISOString(), amazon_blocked: false, owned: false,
    };
    const ok = await ownerRpc("owner_restore_item", { p_item: item });
    if (!ok) throw new Error("not saved");
    $("#newItem").remove();
    newItemPhoto = null;
    items.push(item);
    render(true);
    refocus(item);
    toast("Added to your list.");
  } catch (e) {
    btn.disabled = false; btn.textContent = "Add to list";
    newItemError(/upload/.test(e.message)
      ? "Couldn't upload the photo. Try again, or add the item without a photo."
      : "Couldn't add the item. Check your connection and try again.");
  } finally {
    savingNew = false;
  }
}
