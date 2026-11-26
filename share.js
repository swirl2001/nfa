// NFA Wishlist share page.
//   Friends:  ?list=<slug>                → view + one-click "Mark as gifted" (undo only from the same
//                                            browser); hover ⋯ = Open in new tab / Copy link; after visiting a
//                                            store page, coming back asks "Did you buy …?"
//   Owner:    ?list=<slug>&edit=<token>   → same cards as the extension: 🗑 with Undo, ⋯ menu,
//                                            click-to-edit name/description/price, drag to reorder,
//                                            share button + list menu. Never any claim info.
//   Legacy:   ?list=<slug>&view=me        → read-only owner view (claims hidden)
// Never uses innerHTML: names, descriptions and links come from other websites.
//   Preview:  owner link + &preview=1      → "Preview & manage": the friends and family view, plus a Show gifted
//                                            toggle (spoiler warning first) and Edit → Undo on gifted items
//                                            (migration 012, owner_* calls with the edit token).
// Hard rules: no Amazon links/images (amazon.js), plain store links only (no affiliate tags),
// the owner sees gift marks only by choosing to (Preview & manage), and never who marked them.

if (location.hostname === "www.nfawishlist.com") location.replace("https://nfawishlist.com" + location.pathname + location.search);
const $ = (s, el = document) => el.querySelector(s);
// Read from the address bar in readParams() (again after a Google sign-in returns here).
let params, slug, editToken, isEdit, viewOnlyOwner;
let ownerSignedIn = true;  // false: this list's owner hasn't signed in with Google, so it can't be shared yet (migration 011)
let signedInOwner = false; // signed in with Google and this is their list: edit mode, token kept in memory only
let preview = false;       // owner's Preview & manage: friends and family view, isEdit off, editToken kept
let showGifted = false;    // preview: show what's been gifted (off every time the page opens)
let managing = false;      // preview: Edit on → Undo under every gifted item
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

function setState(msg, empty = false) {
  const sk = $("#skeleton"); if (sk) sk.remove(); // anything the page decides to show replaces the grey placeholders
  const s = $("#state");
  s.classList.remove("sr-only");
  s.textContent = msg || "";
  s.classList.toggle("empty", empty);
  s.hidden = !msg;
}
function showEmptyList() {
  setState(isEdit ? "Your list is empty. Save things with the NFA Wishlist extension." : "Nothing on this list yet.", true);
}

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
  // Owner's Preview & manage: render exactly what friends and family see; owner_* calls still use the token.
  if (isEdit && params.get("preview") === "1") { preview = true; isEdit = false; renderAccount(); }
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(slug)) { setState("This link is missing its list code. Ask for the link again."); return; }
  let data, ownsHere = false;
  try {
    // Friends link: also check (in parallel) whether this browser belongs to the list's owner.
    [data, ownsHere] = await Promise.all([
      isEdit || preview ? ownerRpc("owner_list", {}) : rpc("get_shared_list", { p_slug: slug }),
      isEdit || preview ? false : isMyList(slug),
    ]);
  } catch (e) { setState("Couldn't load this list. Check your connection and refresh."); return; }
  if (!data) {
    setState(isEdit || preview
      ? "This edit link doesn't work anymore. Open your list again from the NFA Wishlist extension (⋯ → Open wishlist)."
      : "This list doesn't exist anymore, or the link is wrong.");
    return;
  }
  if (isEdit || preview) rememberMyList(slug); // this browser now knows the list is yours
  if (isEdit && data.owner_signed_in === false) ownerSignedIn = false;
  const owner = isEdit || viewOnlyOwner || ownsHere || data.is_owner === true;
  document.body.classList.add(isEdit ? "owner" : owner ? "owner-view" : "friend");
  if (preview) document.body.classList.add("preview");
  listTitle = data.title;
  renderHeader(owner);
  items = Array.isArray(data.items) ? data.items : [];
  // Preview starts with gifts hidden: only the owner's own marks from this browser show as gifted.
  if (preview) {
    items = items.filter((it) => !it.hidden); // hidden items never reach friends and family
    items.forEach((it) => { it.claimed = !!mine()[it.id]; });
  }
  render(owner);
  if (preview) setupPreview();
  loadDetails(); // note + shipping address (each optional)
  resumePendingMark();
  resumeShareAfterSignIn();
  maybeAsk();
}

function showLanding() {
  setState("");
  document.body.classList.add("home");
  document.title = "NFA Wishlist · Shop small, shop local";
  $("#landing").hidden = false;
  showMyListLink();
  setupHomeFoot();
}
// Home page footer (Nov 25): invite to install, worded for the home page; no button where Chrome can't install it.
function setupHomeFoot() {
  const chrome = chromeComputer();
  $("#footMade").hidden = true;
  $("#footGrow").hidden = false;
  $("#footGrowTitle").textContent = "Ready to make your own wishlist?";
  $("#footGrowText").textContent = chrome
    ? "Save gifts from small shops with one right-click. Share one link. Free."
    : "Free for Chrome on your computer. Save gifts from small shops and share one link.";
  const b = $("#footGrowBtn");
  b.hidden = !chrome;
  b.href = "get"; b.textContent = "Add to Chrome — free";
}

// Home page, signed in: link to your own list.
async function showMyListLink() {
  const box = $("#myList");
  $("#openMine").hidden = true;
  if (!NFAAuth.user()) { box.hidden = true; return; }
  const mine = await rpc("my_list_link", {}).catch(() => null);
  box.textContent = "";
  if (mine && mine.slug) {
    // Nov 25 (Sean): in the header next to your picture, not under the first paragraph.
    const a = $("#openMine");
    a.href = `${location.pathname}?list=${encodeURIComponent(mine.slug)}`;
    a.hidden = false;
    box.hidden = true;
    return;
  }
  box.hidden = true; // no list yet: nothing extra (Sean, Nov 25); Step 2 may add "Start your list" in the header
}

// ---------- account (optional Google sign-in) ----------
// Signed out: a quiet "Sign in" text link. Signed in: a round initial that opens Email / Sign out.
function renderAccount() {
  const box = $("#account");
  box.textContent = "";
  const u = NFAAuth.user();
  if (!u || preview) { // preview: show what friends and family see (signed out), without signing you out
    const b = document.createElement("button");
    b.type = "button"; b.className = "text-link"; b.textContent = "Sign in";
    b.setAttribute("aria-haspopup", "menu");
    b.onclick = (e) => {
      if (preview) { toast("This is a preview. Friends and family see a Sign in link here."); return; }
      e.stopPropagation();
      openMenu(b, signInChoices());
    };
    box.append(b);
    return;
  }
  const b = document.createElement("button");
  b.type = "button"; b.className = "avatar-btn"; b.setAttribute("aria-haspopup", "menu");
  b.setAttribute("aria-label", `Account: ${u.email || "signed in"}`);
  b.title = u.email || "Signed in";
  if (u.google === false) { // signed in with an email code: a plain person icon, not a letter
    b.classList.add("avatar-generic");
    const NS = "http://www.w3.org/2000/svg", svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("width", "18"); svg.setAttribute("height", "18");
    svg.setAttribute("fill", "currentColor"); svg.setAttribute("aria-hidden", "true");
    const head = document.createElementNS(NS, "circle");
    head.setAttribute("cx", "12"); head.setAttribute("cy", "8.5"); head.setAttribute("r", "4");
    const body = document.createElementNS(NS, "path");
    body.setAttribute("d", "M4 20.5c.6-4 3.9-6.5 8-6.5s7.4 2.5 8 6.5z");
    svg.append(head, body);
    b.appendChild(svg);
  } else b.textContent = ((u.name || u.email || "?").trim()[0] || "?").toUpperCase();
  b.onclick = (e) => {
    e.stopPropagation();
    openMenu(b, [
      { info: u.email ? `Signed in as ${u.email}` : "Signed in" },
      { label: "Sign out", run: async () => { await NFAAuth.signOut(); location.reload(); } },
    ]);
  };
  box.append(b);
}

// ---- list title: click to rename in place (Sean, Nov 22). Return or click away saves, Escape cancels. ----
function makeTitleEditable(el, { max, getText, save }) {
  el.tabIndex = 0;
  el.setAttribute("role", "textbox");
  el.setAttribute("aria-label", "Wishlist name");
  el.title = "Click to rename";
  el.classList.add("title-editable");
  let before = "";
  const start = () => {
    if (el.isContentEditable) return;
    before = getText();
    el.textContent = before;
    el.contentEditable = "plaintext-only";
    el.classList.add("editing");
    el.focus();
    const r = document.createRange(); r.selectNodeContents(el);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  };
  const finish = (keep) => {
    if (!el.isContentEditable) return;
    el.contentEditable = "false";
    el.classList.remove("editing");
    const text = el.textContent.replace(/\s+/g, " ").trim().slice(0, max);
    if (!keep || !text || text === before) { el.textContent = before; return; }
    el.textContent = text;
    save(text, before);
  };
  el.addEventListener("click", start);
  el.addEventListener("keydown", (e) => {
    if (!el.isContentEditable) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); start(); }
      return;
    }
    if (e.isComposing) return;
    if (e.key === "Enter") { e.preventDefault(); el.blur(); }
    else if (e.key === "Escape") { e.preventDefault(); finish(false); el.focus(); }
  });
  el.addEventListener("blur", () => finish(true));
  return start;
}

function renderHeader(owner) {
  document.title = `${listTitle} · NFA Wishlist`;
  if (!$("#title").isContentEditable) $("#title").textContent = listTitle;
  wireTitleEdit();
  $("#explainer").textContent = preview // owner's Preview & manage: exactly what friends and family read
    ? "Tap “Mark as gifted” when you get something, so nobody doubles up. The list owner won't see it unless they choose to peek."
    : signedInOwner
    ? "This is your list. Edit it here, and use the share button to copy the link for friends and family. What's been gifted stays hidden unless you peek (⋯ → Preview & manage)."
    : isEdit
    ? "This is your private edit link. Don't share it. Use the share button to send friends and family their own link. What's been gifted stays hidden unless you peek (⋯ → Preview & manage)."
    : owner
      ? "Don't spoil the surprise! This is your list, so what friends and family buy stays hidden from you."
      : "Tap “Mark as gifted” when you get something, so nobody doubles up. The list owner won't see it unless they choose to peek.";
  $("#shareBtn").hidden = !isEdit;
  $("#listMenuBtn").hidden = !isEdit;
  $("#shareGate").hidden = !(isEdit && !ownerSignedIn);
  $("#ownerGate").hidden = !(owner && !isEdit); // signed-out owner on the friends link
  $("#explainer").hidden = !$("#ownerGate").hidden; // the card says it; don't repeat
  setupGrow(!owner && !isEdit);
  $("#intro").hidden = false;
}

const byPosition = (a, b) => ((a.position ?? Infinity) - (b.position ?? Infinity)) || (Date.parse(b.saved_at || 0) - Date.parse(a.saved_at || 0));

function render(owner) {
  const grid = $("#items");
  grid.textContent = "";
  const list = isEdit ? [...items].sort(byPosition) : items;
  if (!list.length) { showEmptyList(); return; }
  setState("");
  const tpl = $("#itemTpl");
  // Friends: what's still available stays on top; anything already bought moves to a
  // "Gifted" section at the bottom (owner's own page: "Received"). (Only on load: a fresh mark stays put so Undo is easy.)
  // Owner (edit link): things they marked "I own this" move down the same way. Never friends' marks.
  const friends = !isEdit && !owner;
  // Owner: items hidden from the share link get their own "Hidden" section, above "Received".
  const hiddenOnes = isEdit ? list.filter((it) => it.hidden === true) : [];
  const bought = isEdit ? list.filter((it) => it.owned === true && !hiddenOnes.includes(it))
    : friends ? list.filter((it) => it.claimed === true) : [];
  list.filter((it) => !bought.includes(it) && !hiddenOnes.includes(it)).forEach((it) => grid.appendChild(card(tpl, it, owner)));
  const hiddenGrid = $("#hiddenGrid");
  hiddenGrid.textContent = "";
  hiddenOnes.forEach((it) => hiddenGrid.appendChild(card(tpl, it, owner)));
  hiddenGrid.hidden = $("#hiddenRow").hidden = !hiddenOnes.length;
  const boughtGrid = $("#bought");
  boughtGrid.textContent = "";
  bought.forEach((it) => boughtGrid.appendChild(card(tpl, it, owner)));
  $("#boughtHead").textContent = isEdit ? "Received" : "Gifted";
  boughtGrid.hidden = $("#boughtRow").hidden = !bought.length;
  $("#manageBtn").hidden = !(preview && showGifted);
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
  // Grey box (pulsing) until the photo arrives, then it fades in.
  if (src) { media.classList.add("loading"); img.onload = () => { fitPhoto(img); media.classList.remove("loading"); }; img.addEventListener("error", () => media.classList.remove("loading")); img.src = src; img.alt = it.name || ""; img.onerror = showPlaceholder; } else showPlaceholder();
  if (amazon) {
    const alt = $(".alt", node), q = encodeURIComponent(it.name || "");
    alt.hidden = false;
    $(".alt-etsy", alt).href = `https://www.etsy.com/search?q=${q}`;
    $(".alt-web", alt).href = `https://www.google.com/search?tbm=shop&q=${q}+-amazon`;
    node.classList.add("amazon"); // grey on hover, name crossed out and locked, no ⋯ menu
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
  const more = $(".more", node), moreTouch = $(".more-touch", node);
  more.setAttribute("aria-label", `More options for ${label}`);
  moreTouch.setAttribute("aria-label", `More options for ${label}`);
  $(".del", node).setAttribute("aria-label", `Remove ${label}`);
  // Friends and family: "Mark as gifted" (Sean, Nov 21).
  // Owner's own page says "received" (Sean, Nov 21); friends and family say "gifted".
  $(".buy", node).textContent = isEdit ? "Mark as received" : "Mark as gifted";
  $(".buy", node).setAttribute("aria-label", isEdit ? `Mark ${label} as received` : `Mark ${label} as gifted`);
  $(".unbuy", node).setAttribute("aria-label", `I gifted ${label}. Click to undo.`);
  const openCardMenu = (e) => {
    e.stopPropagation();
    const btn = e.currentTarget;
    const inTop = node.parentElement === $("#items");
    const isFirst = !node.previousElementSibling, isLast = !node.nextElementSibling;
    const hideEntry = isEdit && { icon: it.hidden ? "show" : "hide", label: it.hidden ? "Show" : "Hide", run: () => setHidden(it, node, !it.hidden) };
    const deleteEntry = isEdit && { icon: "trash", label: "Delete", run: () => removeItem(it, node) };
    if (amazon) { openMenu(btn, [hideEntry, deleteEntry], node); return; } // Amazon: nothing to open, copy or edit
    openMenu(btn, [
      isEdit && { icon: "edit", label: "Edit details", run: () => $(".t-name", node).click() },
      link && { icon: "open", label: "Open in new tab", run: () => visitStore(it, link, owner) },
      link && { icon: "copy", label: "Copy link", run: () => copyText(link, "Link copied.") },
      isEdit && inTop && !isFirst && { icon: "top", label: "Move to top", run: () => moveToTop(it) },
      isEdit && inTop && !isFirst && { icon: "up", label: "Move up", run: () => moveBy(it, node, -1) },
      isEdit && inTop && !isLast && { icon: "down", label: "Move down", run: () => moveBy(it, node, 1) },
      hideEntry,
      deleteEntry,
    ], node);
  };
  more.onclick = openCardMenu;
  moreTouch.onclick = openCardMenu;
  if (!isEdit && (!link || amazon)) { more.remove(); moreTouch.remove(); } // friends: Amazon items have nothing to open or copy

  // Text
  $(".t-name", node).textContent = it.name || "Untitled item";
  $(".t-name", node).title = it.name || "";
  $(".t-desc", node).textContent = it.description || "";
  $(".t-price", node).textContent = nfaPriceText(it.price, it.currency, it.price_label);

  if (isEdit) {
    const del = $(".del", node);
    del.hidden = false;
    del.onclick = (e) => { e.stopPropagation(); removeItem(it, node); };
    if (amazon) node.querySelectorAll(".txt > div").forEach((el) => el.removeAttribute("data-placeholder")); // crossed out, can't be edited
    else node.querySelectorAll(".txt > div").forEach((el) => makeEditable(el, it, node));
    makeDraggable(node, it);
    wireOwned(node, it);
    showHidden(node, it);
    $(".hid", node).onclick = (e) => { e.stopPropagation(); e.preventDefault(); setHidden(it, node, false); };
  } else if (!owner) {
    wireClaim(node, it);
  }
  return node;
}

// ---------- owner: "Mark as received" → "✓ Received" (their own flag, separate from friends' marks) ----------

function wireOwned(node, it) {
  const buy = $(".buy", node), unbuy = $(".unbuy", node);
  $(".unbuy-on", node).textContent = "✓ Received";
  unbuy.setAttribute("aria-label", `${it.name || "This item"} is marked as received. Click to undo.`);
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
        toast("Marked as received. Friends and family will see it's taken.", () => setOwned(false));
      } else {
        toast("No longer marked as received.");
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

// ---------- owner: hide from the share link (migration 013) ----------
// The card stays where it is (full colour) until the next load, which moves it to "Hidden".

function showHidden(node, it) {
  $(".hid", node).hidden = it.hidden !== true;
  node.classList.toggle("is-hidden", it.hidden === true);
  $(".hid", node).setAttribute("aria-label", `${it.name || "This item"} is hidden from your share link. Show it.`);
}
async function setHidden(it, node, hidden) {
  try {
    if (!(await ownerRpc("owner_set_hidden", { p_item_id: it.id, p_hidden: hidden }))) throw new Error("not saved");
    it.hidden = hidden;
    showHidden(node, it);
    toast(hidden ? "Hidden from your share link." : "Showing on your share link again.", () => setHidden(it, node, !hidden));
  } catch (e) {
    toast("Couldn't save that. Try again.");
  }
}

// ---------- owner: remove / undo / move / edit / reorder ----------

async function removeItem(it, node) {
  try {
    const row = await ownerRpc("owner_delete_item", { p_item_id: it.id });
    items = items.filter((x) => x.id !== it.id);
    node.remove();
    if (!items.length) showEmptyList();
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
    if (field === "price") el.textContent = nfaPriceText(it.price, it.currency, it.price_label);
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
      // A number (with or without a currency) or any text, like "priceless". Bare number: this item's currency, else $.
      const p = nfaParsePrice(text, it.currency);
      el.textContent = nfaPriceText(p.price, p.currency, p.label);
      const same = p.price === (it.price == null ? null : Number(it.price)) && (p.currency || null) === (it.currency || null) && (p.label || null) === (it.price_label || null);
      if (same) return;
      const old = { price: it.price ?? null, currency: it.currency ?? null, price_label: it.price_label ?? null };
      Object.assign(it, { price: p.price, currency: p.currency, price_label: p.label });
      const patch = { price: p.price, currency: p.currency, price_label: p.label };
      try {
        await ownerRpc("owner_update_item", { p_item_id: it.id, p_patch: patch });
        if (!text && (old.price != null || old.price_label)) {
          toast("Price removed", async () => {
            Object.assign(it, old);
            try { await ownerRpc("owner_update_item", { p_item_id: it.id, p_patch: old }); render(true); }
            catch (e) { toast("Couldn't undo. Try again."); }
          });
        }
      } catch (e) {
        Object.assign(it, old);
        el.textContent = before;
        toast("Couldn't save that change.");
      }
      return;
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

// ---------- owner on the friends link, signed out (Nov 24) ----------
$("#ownerGateSignIn").onclick = () => NFAAuth.signIn(); // back here signed in → my_edit_link → owner page
$("#ownerGateFriend").onclick = () => { forgetMyList(slug); location.reload(); };

// ---------- sign in to share (owner page, owner not signed in yet) ----------
// Spotlight (Sean, Nov 22): everything else goes 75% dark so only the sign-in card stands out.
// Click the dark area or press Escape to go back.
function spotlight(card, scrim, focusEl) {
  const off = () => {
    card.classList.remove("spot"); scrim.classList.remove("on");
    setTimeout(() => { if (!scrim.classList.contains("on")) scrim.hidden = true; }, 200);
    document.removeEventListener("keydown", onKey, true);
  };
  const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); off(); } };
  scrim.hidden = false;
  void scrim.offsetWidth;
  scrim.classList.add("on");
  card.classList.add("spot");
  scrim.onclick = off;
  document.addEventListener("keydown", onKey, true);
  if (focusEl) focusEl.focus({ preventScroll: false });
  card.scrollIntoView({ block: "nearest", behavior: "smooth" });
  return off;
}
let gateSpotOff = null;
function pulseGate() { gateSpotOff = spotlight($("#shareGate"), $("#gateScrim"), $("#gateSignIn")); }
const SHARE_AFTER = "nfa-share-after-signin"; // sessionStorage: slug to share once the reload shows it signed in
// The owner page usually comes from the extension, so sign in there: Google gets linked to the same
// list and share link. (Signing in on the website alone would be a different, empty account.)
$("#gateSignIn").onclick = async () => {
  const fromShare = $("#shareGate").classList.contains("spot");
  if (gateSpotOff) { gateSpotOff(); gateSpotOff = null; }
  const ids = NFA_CONFIG.extensionIds || [];
  const rt = window.chrome && chrome.runtime && chrome.runtime.sendMessage ? chrome.runtime : null;
  const btn = $("#gateSignIn");
  if (!rt || !ids.length) { toast("Open the NFA Wishlist extension and sign in there."); return; }
  btn.disabled = true;
  toast("Finish signing in in the Google window.");
  let res = null;
  for (const id of ids) {
    res = await new Promise((resolve) => {
      try { rt.sendMessage(id, { type: "nfa-sign-in", slug }, (r) => { void chrome.runtime.lastError; resolve(r || null); }); }
      catch (e) { resolve(null); }
    });
    if (res && res.status !== "not-mine") break;
  }
  btn.disabled = false;
  if (res && res.status === "signed-in") {
    if (fromShare) {
      try { sessionStorage.setItem(SHARE_AFTER, slug); } catch (e) {}
    }
    location.reload();
  } else if (res && res.status === "merge") {
    toast("Almost done: open the NFA Wishlist extension to finish signing in.");
  } else if (res && res.status === "error") {
    toast(/cancel/i.test(res.message || "") ? "Sign-in cancelled." : "Sign-in didn't work. Try again.");
  } else {
    toast("Open the NFA Wishlist extension and sign in there.");
  }
};
// Owner page: "Sign in with email" also signs in in the extension (the email is added to the same
// list and share link), through the same dialog.
$("#gateEmail").onclick = () => {
  const fromShare = $("#shareGate").classList.contains("spot");
  if (gateSpotOff) { gateSpotOff(); gateSpotOff = null; }
  openEmail({ via: "ext", after: (status) => {
    if (status === "merge") { toast("Almost done: open the NFA Wishlist extension to finish signing in."); return; }
    if (fromShare) { try { sessionStorage.setItem(SHARE_AFTER, slug); } catch (e) {} }
    location.reload();
  } });
};
// After a Share-initiated sign-in, copy the friends and family link.
async function resumeShareAfterSignIn() {
  let s = null;
  try { s = sessionStorage.getItem(SHARE_AFTER); sessionStorage.removeItem(SHARE_AFTER); } catch (e) {}
  if (!s || s !== slug || !isEdit || !ownerSignedIn) return;
  const url = friendsUrl();
  const ok = await copyQuiet(url);
  toast(ok ? "Link copied." : "Here's your link.", null, { sticky: true, url });
}

// ---------- owner header: share + ⋯ (Rename wishlist, Copy, Download; Nov 25 wording) ----------

// Share: copy the friends link and keep it on screen (until closed) to copy again or select by hand.
$("#shareBtn").onclick = async () => {
  if (isEdit && !ownerSignedIn) { pulseGate(); return; }
  const url = friendsUrl();
  const ok = await copyQuiet(url);
  toast(ok ? "Link copied." : "Here's your link.", null, { sticky: true, url });
};
$("#listMenuBtn").onclick = (e) => {
  e.stopPropagation();
  openMenu($("#listMenuBtn"), [
    { icon: "edit", label: "Rename wishlist", run: openRename },
    { icon: "note", label: "Add note / address", run: openDetails },
    { icon: "plus", label: "Add item", run: openNewItem },
    { icon: "copy", label: "Copy", hint: "(text)", run: copyList },
    { icon: "download", label: "Download", hint: "(CSV)", run: downloadList },
    { icon: "eye", label: "Preview & manage", run: () => location.assign(previewUrl(true)) },
  ]);
};
let startRename = () => {};
function openRename() { startRename(); }
// Owner pages only: the title renames in place.
function wireTitleEdit() {
  if (!isEdit || $("#title").classList.contains("title-editable")) return;
  startRename = makeTitleEditable($("#title"), {
    max: 100,
    getText: () => listTitle,
    save: async (t, before) => {
      listTitle = t; document.title = `${listTitle} · NFA Wishlist`;
      try { await ownerRpc("owner_rename_list", { p_title: t }); }
      catch (err) { listTitle = before; renderHeader(true); toast("Couldn't rename. Try again."); }
    },
  });
}

const sortedItems = () => (isEdit ? [...items].sort(byPosition) : items);
function copyList() {
  const lines = [listTitle, ""];
  sortedItems().forEach((it, n) => {
    const price = nfaPriceText(it.price, it.currency, it.price_label);
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
  sortedItems().forEach((it) => rows.push([it.name, it.description || "", it.price_label || (it.price ?? ""), it.price_label ? "" : it.currency || "", it.amazon_blocked ? "" : it.store || "", shopLink(it)]));
  const csv = "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = (listTitle.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "wishlist") + "-" + new Date().toISOString().slice(0, 10) + ".csv";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast("List downloaded.");
}

// ---------- friends: one-click "Mark as gifted" ----------
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
// Random code for this browser, sent with each mark so the server can apply the 3-marks-per-list limit
// for people who aren't signed in (migration 010). Only a salted hash is stored on the server.
const BROWSER_KEY = "nfa-browser";
function browserId() {
  let id = store_.get(BROWSER_KEY);
  if (typeof id !== "string" || id.length < 16) {
    id = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()).replace(/-/g, "");
    store_.set(BROWSER_KEY, id);
  }
  return id;
}
const PENDING_MARK = "nfa-pending-mark"; // sessionStorage: {slug, itemId} to mark after signing in from the limit card
const setMine = (id, token) => { const m = mine(); if (token) m[id] = token; else delete m[id]; store_.set(MINE_KEY, m); };
const cards = new Map();               // itemId → { node, it }

function wireClaim(node, it) {
  cards.set(it.id, { node, it });
  const token = mine()[it.id];
  if (it.claimed === true) showClaimed(node, it, !!token);
  else { if (token) setMine(it.id, null); showUnclaimed(node, it); }
  $(".buy", node).onclick = () => markPurchased(it);
  $(".unbuy", node).onclick = () => unmarkPurchased(it);
  $(".clear", node).onclick = () => clearGift(it);
  $(".clear", node).setAttribute("aria-label", `Undo: make ${it.name || "this item"} available to gift again`);
}
function showUnclaimed(node, it) {
  it.claimed = false;
  node.classList.remove("claimed");
  $(".badge-out", node).hidden = it.in_stock !== false;
  $(".buy", node).hidden = false; $(".buy", node).disabled = false;
  $(".unbuy", node).hidden = true;
  $(".clear", node).hidden = true;
}
function showClaimed(node, it, isMine) {
  it.claimed = true;
  node.classList.add("claimed");
  $(".badge-out", node).hidden = true; // stock doesn't matter once it's bought
  $(".buy", node).hidden = true;
  $(".unbuy", node).hidden = !isMine || managing; $(".unbuy", node).disabled = false;
  $(".clear", node).hidden = !managing; $(".clear", node).disabled = false; // owner's preview, Edit on
}
// ---------- friends and family → their own wishlist (Nov 25, Step 1; Figma "Friends → users") ----------
// Header "Make a wishlist", a card after "Mark as gifted" (once per visit) and the footer.
// Chrome-type browsers on a computer go to the Chrome Web Store (nfawishlist.com/get); phones and
// Safari/Firefox go to the home page for now (Step 2 will let them start a list on the web).
const GROW_SEEN = "nfa-grow-seen"; // sessionStorage: card shown this visit
function chromeComputer() {
  const ua = navigator.userAgent, uad = navigator.userAgentData;
  const mobile = uad ? uad.mobile : /Mobi|Android|iPhone|iPad|iPod/i.test(ua);
  return !mobile && /Chrome\//.test(ua); // Chrome, Edge, Brave, Arc… (iPhone Chrome says CriOS)
}
function growTarget() {
  return chromeComputer()
    ? { href: "get", label: "Add to Chrome — free", card: "Want a wishlist like this for yourself? Save gifts from small shops with one right-click. It's free.", foot: "Save gifts from small shops with one right-click. Share one link. Free." }
    : { href: "./", label: "Make my own wishlist", card: "Want a wishlist like this for yourself? Save gifts from small shops and share one link. It's free.", foot: "Save gifts from small shops. Share one link. Free." };
}
function setupGrow(friendView) {
  const g = growTarget();
  $("#makeOwn").hidden = !friendView;
  $("#footGrow").hidden = !friendView;
  $("#footMade").hidden = friendView;
  if (!friendView) { $("#grow").hidden = true; return; }
  $("#makeOwn").href = $("#footGrowBtn").href = $("#growYes").href = g.href;
  $("#footGrowBtn").textContent = $("#growYes").textContent = g.label;
  $("#footGrowText").textContent = g.foot;
  $("#footGrowTitle").textContent = "Want a wishlist like this for yourself?";
  $("#footGrowBtn").hidden = false;
  $("#growText").textContent = g.card;
  // The owner's preview shows the same links, but they don't leave the page.
  for (const id of ["#makeOwn", "#footGrowBtn", "#growYes"]) {
    $(id).onclick = (e) => {
      if (preview) { e.preventDefault(); toast("This is a preview. Friends and family go to the Chrome Web Store or the home page here."); return; }
      if (id === "#growYes") hideGrow();
    };
  }
}
function hideGrow() { $("#grow").hidden = true; }
$("#growNo").onclick = hideGrow;
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#grow").hidden) hideGrow(); });
function maybeShowGrow() {
  if (preview || isEdit) return;
  try { if (sessionStorage.getItem(GROW_SEEN)) return; sessionStorage.setItem(GROW_SEEN, "1"); } catch (e) { return; }
  // Wait for the "Marked as gifted" message to go, and never on top of another bottom card.
  let tries = 0;
  const show = () => {
    const busy = !$("#toast").hidden || !$("#ask").hidden || !$("#limit").hidden;
    if (busy) { if (++tries < 40) setTimeout(show, 400); return; }
    $("#grow").hidden = false;
    announce("You're so generous! Want a wishlist like this for yourself?");
  };
  setTimeout(show, 400);
}

async function markPurchased(it) {
  const c = cards.get(it.id); if (!c) return;
  if (!(await previewOk())) return;
  $(".buy", c.node).disabled = true;
  try {
    if (preview) { // the owner, marking from their preview: no limit, own undo token like a friend's
      const t = await ownerRpc("owner_mark_gifted", { p_item_id: it.id });
      if (t) { setMine(it.id, t); showClaimed(c.node, it, true); toast("Marked as gifted.", () => unmarkPurchased(it)); }
      else { showClaimed(c.node, it, false); toast(showGifted ? "Someone already got this one." : "Marked as gifted."); }
      return;
    }
    let token;
    try { token = await rpc("mark_purchased", { p_slug: slug, p_item_id: it.id, p_browser: browserId() }); }
    catch (e) {
      // Migration 010 not run yet: the server only knows the 2-argument version.
      if (!/could not find the function|PGRST202/i.test(e.message)) throw e;
      token = await rpc("mark_purchased", { p_slug: slug, p_item_id: it.id });
    }
    if (token === "limit") {         // 3 marks already from this browser: offer sign-in
      $(".buy", c.node).disabled = false;
      showLimit(it);
      return;
    }
    if (token) {
      setMine(it.id, token);
      showClaimed(c.node, it, true);
      toast("Marked as gifted.", () => unmarkPurchased(it));
      maybeShowGrow();
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
  if (!(await previewOk())) return;
  $(".unbuy", c.node).disabled = true;
  try {
    const ok = await rpc("unmark_purchased", { p_slug: slug, p_item_id: it.id, p_token: token });
    setMine(it.id, null);
    if (ok) { showUnclaimed(c.node, it); toast("No longer marked as gifted."); }
    else { showClaimed(c.node, it, false); toast("Couldn't undo that one."); }
  } catch (e) {
    $(".unbuy", c.node).disabled = false;
    toast("Couldn't undo. Try again.");
  }
}

// ---------- owner: Preview & manage (migration 012) ----------
// The owner chose to peek: Show gifted asks first, then shows the real Gifted section. Edit puts
// Undo under every gifted item (clears all marks on it + the owner's "received"); the card stays put.

function previewUrl(on) {
  const u = new URL(location.href);
  if (on) u.searchParams.set("preview", "1"); else u.searchParams.delete("preview");
  return u.toString();
}
function setupPreview() {
  $("#previewBar").hidden = false;
  $("#previewBack").href = $("#previewBack2").href = previewUrl(false);
  updatePreviewBar();
}
function updatePreviewBar() {
  $("#showGifted").setAttribute("aria-checked", String(showGifted));
  $("#previewText").textContent = showGifted
    ? "This is how friends and family see your list, gifts included."
    : "This is how friends and family see your list. Gifts stay hidden until you turn on Show gifted.";
}
async function clearGift(it) {
  const c = cards.get(it.id); if (!c) return;
  const ok = await confirmBox({
    title: "Make this available again?",
    text: `${it.name || "This item"} will show as available to gift. If someone already bought it, you might receive it twice.`,
    yes: "Make available",
  });
  if (!ok) return;
  const btn = $(".clear", c.node);
  btn.disabled = true;
  try {
    if (!(await ownerRpc("owner_clear_gifted", { p_item_id: it.id }))) throw new Error("not saved");
    setMine(it.id, null);
    showUnclaimed(c.node, it); // full colour, "Mark as gifted" again; stays in place until reload
    toast("Available to gift again.");
    $(".buy", c.node).focus();
  } catch (e) {
    btn.disabled = false;
    toast("Couldn't change that. Try again.");
  }
}
function setManaging(on) {
  managing = on;
  const b = $("#manageBtn");
  b.textContent = on ? "Done" : "Edit";
  b.setAttribute("aria-pressed", String(on));
  for (const { node, it } of cards.values()) if (it.claimed && node.isConnected) showClaimed(node, it, !!mine()[it.id]);
}
$("#manageBtn").onclick = async () => {
  if (managing) { setManaging(false); return; }
  const ok = await confirmBox({
    title: "Edit gifted items?",
    text: "These are items friends and family marked as gifted. If you undo a gift, it will be available to gift again.",
    yes: "OK",
  });
  if (!ok) return;
  previewWarned = true; // they've just been told changes here are real
  setManaging(true);
};
async function setShowGifted(on) {
  const sw = $("#showGifted");
  sw.disabled = true;
  try {
    if (on) {
      const ids = await ownerRpc("owner_gifted", {});
      if (!Array.isArray(ids)) throw new Error("no data");
      const gifted = new Set(ids);
      items.forEach((it) => { it.claimed = gifted.has(it.id); });
    } else {
      items.forEach((it) => { it.claimed = !!mine()[it.id]; });
    }
    showGifted = on;
    setManaging(false);
    updatePreviewBar();
    render(false);
    announce(on ? "Showing what's been gifted." : "Gifted items hidden.");
  } catch (e) {
    toast("Couldn't load what's been gifted. Try again.");
  } finally {
    sw.disabled = false;
  }
}
// One confirm box for the preview (#peek): resolves true for the main button; Cancel, Escape or a
// click outside → false. Focus goes back to whatever opened it.
let confirmDone = null;
function confirmBox({ title, text, yes }) {
  if (confirmDone) confirmDone(false);
  const back = document.activeElement;
  $("#peekTitle").textContent = title;
  $("#peekText").textContent = text;
  $("#peekYes").textContent = yes;
  const scrim = $("#peekScrim");
  scrim.hidden = false;
  requestAnimationFrame(() => scrim.classList.add("on"));
  $("#peek").hidden = false;
  $("#peekNo").focus();
  document.addEventListener("keydown", peekKeys);
  return new Promise((resolve) => {
    confirmDone = (ok) => {
      confirmDone = null;
      scrim.classList.remove("on");
      scrim.hidden = true;
      $("#peek").hidden = true;
      document.removeEventListener("keydown", peekKeys);
      if (back && back.isConnected) back.focus();
      resolve(ok);
    };
  });
}
function peekKeys(e) {
  if (e.key === "Escape") { e.preventDefault(); confirmDone && confirmDone(false); return; }
  if (e.key !== "Tab") return;
  const a = $("#peekNo"), b = $("#peekYes");
  if (e.shiftKey && document.activeElement === a) { e.preventDefault(); b.focus(); }
  else if (!e.shiftKey && document.activeElement === b) { e.preventDefault(); a.focus(); }
}
$("#peekNo").onclick = () => confirmDone && confirmDone(false);
$("#peekScrim").onclick = () => confirmDone && confirmDone(false);
$("#peekYes").onclick = () => confirmDone && confirmDone(true);

// Spoiler warning before showing what was gifted.
$("#showGifted").onclick = async () => {
  if (showGifted) { setShowGifted(false); return; }
  const ok = await confirmBox({
    title: "Show what was gifted?",
    text: "This might spoil your surprise. You'll see which items friends and family marked as gifted.",
    yes: "Show gifted",
  });
  if (ok) setShowGifted(true);
};
// First change in a preview visit: remind them it's live for friends and family (once per visit).
let previewWarned = false;
async function previewOk() {
  if (!preview || previewWarned) return true;
  const ok = await confirmBox({
    title: "This is a preview",
    text: "Anything you change here is visible to friends and family.",
    yes: "OK",
  });
  if (ok) previewWarned = true;
  return ok;
}

// Remember which store page a friend opened, so coming back can ask "Did you buy …?"
function recordVisit(it, owner) {
  if (!owner && !isEdit && !preview && !it.claimed) store_.set(VISIT_KEY, { slug, itemId: it.id, at: Date.now() });
}
function visitStore(it, link, owner) {
  recordVisit(it, owner);
  openNewTab(link);
}
const ASK_MIN_MS = 4000;                 // ignore quick tab flips
const ASK_MAX_MS = 3 * 24 * 3600 * 1000; // forget after 3 days
// ---------- gift-mark limit card ----------
function showLimit(it) {
  const c = cards.get(it.id); if (!c) return;
  $("#ask").hidden = true;
  const img = $("#limitImg"), src = imageLink(it);
  if (src) { img.src = src; img.hidden = false; img.onerror = () => { img.hidden = true; }; } else img.hidden = true;
  $("#limit").hidden = false;
  const close = () => {
    $("#limit").hidden = true;
    document.removeEventListener("keydown", onKey);
    const b = $(".buy", c.node); if (b && !b.hidden) b.focus({ preventScroll: false });
  };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  $("#limitNo").onclick = close;
  $("#limitYes").onclick = () => {
    try { sessionStorage.setItem(PENDING_MARK, JSON.stringify({ slug, itemId: it.id })); } catch (e) {}
    NFAAuth.signIn();
  };
  $("#limitEmail").onclick = () => openEmail({ after: () => {
    try { sessionStorage.setItem(PENDING_MARK, JSON.stringify({ slug, itemId: it.id })); } catch (e) {}
    location.reload();
  } });
  $("#limitYes").focus({ preventScroll: true });
}
// Back from signing in on the limit card: mark the item they were trying to mark.
function resumePendingMark() {
  let p = null;
  try { p = JSON.parse(sessionStorage.getItem(PENDING_MARK) || "null"); sessionStorage.removeItem(PENDING_MARK); } catch (e) {}
  if (!p || p.slug !== slug || !NFAAuth.user() || isEdit || preview || document.body.classList.contains("owner-view")) return;
  const c = cards.get(p.itemId);
  if (c && !c.it.claimed) markPurchased(c.it);
}

function maybeAsk() {
  if (isEdit || preview || document.body.classList.contains("owner-view") || !$("#ask").hidden || !$("#limit").hidden) return;
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
const NOT_MINE_KEY = "nfa-not-mine"; // [slug, …] lists this browser should treat as friends and family
function rememberMyList(s) {
  const owned = store_.get(OWNED_KEY) || [];
  if (!owned.includes(s)) store_.set(OWNED_KEY, [...owned, s].slice(-20));
  store_.set(NOT_MINE_KEY, (store_.get(NOT_MINE_KEY) || []).filter((x) => x !== s)); // opened as owner again
}
// "Not your list? View as friends and family" (e.g. a shared family computer): forget this browser's claim.
function forgetMyList(s) {
  store_.set(OWNED_KEY, (store_.get(OWNED_KEY) || []).filter((x) => x !== s));
  const nm = store_.get(NOT_MINE_KEY) || [];
  if (!nm.includes(s)) store_.set(NOT_MINE_KEY, [...nm, s].slice(-20));
}
async function isMyList(s) {
  if ((store_.get(NOT_MINE_KEY) || []).includes(s)) return false;
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
    if (a && a.signedIn && a.google !== false) { NFAAuth.autoSignIn(typeof a.email === "string" ? a.email : ""); return; }
    // Signed in there with an email code: can't be repeated silently, so the email dialog comes prefilled (Nov 24).
    if (a && a.signedIn && a.google === false && typeof a.email === "string" && a.email.length <= 254) { extEmail = a.email; return; }
  }
}
var extEmail = ""; // the NFA extension's email-code account, if any

// Loading: grey placeholder title + cards until the list arrives (list links only, never the home page).
// "Loading the list…" stays for screen readers; setState() removes all of it.
function showSkeleton() {
  const sk = document.createElement("div");
  sk.id = "skeleton";
  sk.className = "skeleton";
  sk.setAttribute("aria-hidden", "true");
  const bar = (cls) => { const d = document.createElement("div"); d.className = `sk ${cls}`; return d; };
  sk.append(bar("sk-title"), bar("sk-line"));
  const grid = document.createElement("div");
  grid.className = "grid";
  for (let n = 0; n < 8; n++) {
    const c = document.createElement("div");
    c.className = "sk-card";
    c.append(bar("sk-media"), bar("sk-name"), bar("sk-desc"), bar("sk-price"));
    grid.appendChild(c);
  }
  sk.appendChild(grid);
  $("#state").classList.add("sr-only");
  $("#state").after(sk);
}
if (slug) showSkeleton();
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
  // Preview: ask as a signed-out guest, so the note and address show exactly as friends and family see them.
  try { details = isEdit ? await ownerRpc("owner_details", {}) : await rpc("list_details", { p_slug: slug }, preview); }
  catch (e) { details = null; } // not set up on the server yet: simply no note or address
  renderDetails();
  // Owner's first visit to this list with nothing filled in: open the note / address form (Sean, Nov 22).
  const d = details || {};
  if (isEdit && details && !d.note && !d.address && !d.recipient_name) {
    let seen = false;
    try { seen = localStorage.getItem(firstVisitKey()) === "1"; localStorage.setItem(firstVisitKey(), "1"); } catch (e) { seen = true; }
    if (!seen) openDetails({ focus: false });
  }
}

// ---------- owner: note in place (Sean, Nov 22) ----------
// An existing note is editable right under the intro: click to edit, Return saves, Shift+Return adds a
// line, Escape cancels, ✕ removes it (with Undo). No note: nothing shows (the form opens on first visit).
const firstVisitKey = () => `nfa-details-opened:${slug}`;
async function saveNote(text) {
  const d = details || {};
  const ok = await ownerRpc("owner_set_details", {
    p_note: text, p_note_visibility: d.note_visibility || "public",
    p_recipient_name: d.recipient_name || "", p_address: d.address || "",
    p_delivery_notes: d.delivery_notes || "", p_address_visibility: d.address_visibility || "signed_in",
  });
  if (!ok) throw new Error("not saved");
  details = { ...d, note: text || null, note_visibility: d.note_visibility || "public" };
}
let noteWired = false;
function wireNoteEdit() {
  if (noteWired) return;
  noteWired = true;
  const el = $("#noteText");
  el.classList.add("note-editable");
  el.tabIndex = 0;
  el.setAttribute("role", "textbox");
  el.setAttribute("aria-label", "Note for friends and family");
  el.title = "Click to edit";
  let before = "";
  const start = () => {
    if (el.isContentEditable) return;
    before = (details && details.note) || "";
    el.contentEditable = "plaintext-only";
    el.classList.add("editing");
    el.focus();
    const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  };
  const finish = async (keep) => {
    if (!el.isContentEditable) return;
    el.contentEditable = "false";
    el.classList.remove("editing");
    const text = el.innerText.replace(/\n{3,}/g, "\n\n").trim().slice(0, 500);
    if (!keep || text === before) { el.textContent = before; return; }
    el.textContent = text;
    try { await saveNote(text); toast(text ? "Note saved." : "Note removed.", text ? null : () => restoreNote(before)); }
    catch (e) { el.textContent = before; toast("Couldn't save the note. Try again."); }
    renderDetails();
  };
  el.addEventListener("click", start);
  el.addEventListener("keydown", (e) => {
    if (!el.isContentEditable) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); start(); } return; }
    if (e.isComposing) return;
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); el.blur(); }
    else if (e.key === "Escape") { e.preventDefault(); finish(false); el.focus(); }
  });
  el.addEventListener("blur", () => finish(true));
  $("#noteRemove").onclick = async () => {
    const had = (details && details.note) || "";
    if (!had) return;
    try { await saveNote(""); renderDetails(); toast("Note removed.", () => restoreNote(had)); }
    catch (e) { toast("Couldn't remove the note. Try again."); }
  };
}
async function restoreNote(text) {
  try { await saveNote(text); renderDetails(); } catch (e) { toast("Couldn't restore the note."); }
}

// What shows under the title. The owner sees what friends could see (not "Don't show it" ones).
function renderDetails() {
  const d = details || {};
  const editing = !$("#detailsForm").hidden;
  const ownerData = "note_visibility" in d;
  const note = (d.note || "").trim();
  const noteShown = note && !(ownerData && d.note_visibility === "hidden");
  const recipient = (d.recipient_name || "").trim(), street = (d.address || "").trim();
  const dnotes = (d.delivery_notes || "").trim();
  const addr = [recipient, street].filter(Boolean).join("\n");
  const addrShown = addr && !(ownerData && d.address_visibility === "hidden");
  const copyAll = [addr, dnotes && `Delivery notes: ${dnotes}`].filter(Boolean).join("\n");
  const locked = !addrShown && d.address_locked === true;

  // Owner: the note is editable right here; empty shows the prompt (unless they hid it). Friends: just the note.
  const ownerNote = isEdit && ownerData;
  if (!$("#noteText").isContentEditable) $("#noteText").textContent = ownerNote ? note : (noteShown ? note : "");
  $("#noteRow").hidden = editing || (ownerNote ? !note : !noteShown);
  $("#noteRemove").hidden = !ownerNote || !note;
  $("#noteRemove").setAttribute("aria-label", "Remove note"); $("#noteRemove").title = "Remove note";
  if (ownerNote) wireNoteEdit();

  const ship = $("#ship");
  ship.hidden = editing || !(addrShown || locked);
  if (!ship.hidden) {
    setIcon($("#shipIcon"), locked ? LOCK : PIN);
    $("#shipCopy").hidden = !addrShown;
    $("#shipCopy").onclick = () => copyText(copyAll, "Address copied.");
    const body = $("#shipBody");
    body.textContent = "";
    if (addrShown) {
      const a = document.createElement("address");
      a.textContent = addr;
      body.appendChild(a);
      if (dnotes) { const p = document.createElement("p"); p.className = "ship-line ship-muted"; p.textContent = `Delivery notes: ${dnotes}`; body.appendChild(p); }
    } else {
      const p = document.createElement("p");
      p.className = "ship-muted";
      p.textContent = "This address is shared with anyone who signs in.";
      const b = document.createElement("button");
      b.type = "button"; b.className = "text-link"; b.textContent = "Sign in with Google to see it";
      b.onclick = () => { if (preview) { toast("This is a preview. Friends and family sign in here to see your address."); return; } try { sessionStorage.setItem(SHIP_OPEN, "1"); } catch (e) {} NFAAuth.signIn(); };
      const m = document.createElement("button");
      m.type = "button"; m.className = "text-link"; m.textContent = "Sign in with email";
      m.onclick = () => {
        if (preview) { toast("This is a preview. Friends and family sign in here to see your address."); return; }
        openEmail({ after: () => { try { sessionStorage.setItem(SHIP_OPEN, "1"); } catch (e) {} location.reload(); } });
      };
      const row = document.createElement("div");
      row.className = "ship-signin";
      row.append(b, m);
      body.append(p, row);
    }
    let reopen = false;
    try { reopen = sessionStorage.getItem(SHIP_OPEN) === "1" && addrShown; if (reopen) sessionStorage.removeItem(SHIP_OPEN); } catch (e) {}
    setShipOpen(reopen || isShipOpen()); // closed by default; stays as the viewer left it
  }
  $("#details").hidden = $("#noteRow").hidden && ship.hidden && !editing;
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
function openDetails({ focus = true } = {}) {
  const d = details || {};
  $("#noteInput").value = d.note || "";
  radio("noteVis", d.note_visibility || "public");
  $("#recipientInput").value = d.recipient_name || "";
  $("#addrInput").value = d.address || "";
  $("#deliveryInput").value = d.delivery_notes || "";
  const lbl = $("#addrToggleLabel");
  lbl.textContent = "";
  if (d.address || d.recipient_name) lbl.append("Shipping address");
  else { lbl.append("Add shipping address "); const o = document.createElement("span"); o.className = "opt"; o.textContent = "(optional)"; lbl.append(o); }
  setAddrOpen(false); // closed until the owner opens it
  $("#detailsForm").hidden = false;
  renderDetails();
  if (focus) $("#noteInput").focus();
}
function closeDetails() {
  $("#detailsForm").hidden = true;
  renderDetails();
  $("#listMenuBtn").focus();
}
$("#addrToggle").onclick = () => { setAddrOpen($("#addrPanel").hidden); if (!$("#addrPanel").hidden) $("#recipientInput").focus(); };
$("#detailsCancel").onclick = closeDetails;
// Keyboard: Return saves (Shift+Return = new line in the note). The address box keeps Return for new
// lines; ⌘/Ctrl+Return saves from anywhere. Escape cancels. (Single-line boxes submit on Return natively.)
$("#detailsForm").addEventListener("keydown", (e) => {
  if (e.isComposing) return; // typing with an input method (e.g. Japanese): Return confirms the text
  if (e.key === "Escape") { e.preventDefault(); closeDetails(); return; }
  if (e.key !== "Enter") return;
  const inAddress = e.target.id === "addrInput";
  if (e.metaKey || e.ctrlKey || (e.target.id === "noteInput" && !e.shiftKey) || (!inAddress && e.target.tagName === "TEXTAREA" && !e.shiftKey)) {
    e.preventDefault();
    $("#detailsForm").requestSubmit();
  }
});
let savingDetails = false;
$("#detailsForm").onsubmit = async (e) => {
  e.preventDefault();
  if (savingDetails) return;
  savingDetails = true;
  const next = {
    note: $("#noteInput").value.trim().slice(0, 500), note_visibility: radioValue("noteVis") || "public",
    recipient_name: $("#recipientInput").value.replace(/\s+/g, " ").trim().slice(0, 100),
    address: $("#addrInput").value.trim().slice(0, 400),
    delivery_notes: $("#deliveryInput").value.replace(/\s+/g, " ").trim().slice(0, 300),
    address_visibility: "signed_in", // always: anyone who signs in (Sean, Nov 22; "Private lists coming soon!")
  };
  try {
    const ok = await ownerRpc("owner_set_details", {
      p_note: next.note, p_note_visibility: next.note_visibility,
      p_recipient_name: next.recipient_name, p_address: next.address,
      p_delivery_notes: next.delivery_notes, p_address_visibility: next.address_visibility,
    });
    if (!ok) throw new Error("not saved");
    details = { ...next, note: next.note || null, address: next.address || null, recipient_name: next.recipient_name || null,
      delivery_notes: next.delivery_notes || null };
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

// Nov 25 (Figma "Add item"): a dialog, not a card in the grid. Phones: a sheet from the bottom, nearly full
// height; computers: centered. The photo box (4:5) takes whatever height the fields leave; Cancel / Add to list
// stay at the bottom. Escape or Cancel closes; a click outside closes only while the form is still empty.
let newItemBack = null;
function openNewItem() {
  if ($("#newItem")) { $("#niName").focus(); return; }
  newItemBack = document.activeElement;
  const scrim = el("div", { class: "scrim scrim-top", id: "newItemScrim", "aria-hidden": "true" });
  scrim.onclick = () => { if (!newItemDirty()) closeNewItem(); };
  const dlg = buildNewItemCard();
  document.body.append(scrim, dlg);
  lockPageScroll();
  if (window.visualViewport) { visualViewport.addEventListener("resize", fitSheetToKeyboard); visualViewport.addEventListener("scroll", fitSheetToKeyboard); }
  requestAnimationFrame(() => scrim.classList.add("on"));
  document.addEventListener("keydown", newItemKeys, true);
  $("#niName").focus();
}
function newItemDirty() {
  return !!(newItemPhoto || ["niName", "niLink", "niDesc", "niPrice"].some((id) => $("#" + id) && $("#" + id).value.trim()));
}
function newItemKeys(e) {
  if (!$("#newItem")) return;
  if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); closeNewItem(); return; }
  if (e.key !== "Tab") return;
  const f = [...$("#newItem").querySelectorAll("input, textarea, select, button, label.new-photo")].filter((x) => !x.disabled && x.offsetParent && !x.classList.contains("sr-only"));
  if (!f.length) return;
  if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
  else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
}
function teardownNewItem() {
  const n = $("#newItem"), sc = $("#newItemScrim");
  if (n) n.remove();
  if (sc) sc.remove();
  newItemPhoto = null;
  if (window.visualViewport) { visualViewport.removeEventListener("resize", fitSheetToKeyboard); visualViewport.removeEventListener("scroll", fitSheetToKeyboard); }
  unlockPageScroll();
  document.removeEventListener("keydown", newItemKeys, true);
}
// Phones: while the on-screen keyboard is open, fit the sheet into the visible area above it (the photo shrinks
// first, the form scrolls), so Cancel / Add to list sit just above the keyboard (Nov 25).
function fitSheetToKeyboard() {
  const d = $("#newItem"), vv = window.visualViewport;
  if (!d || !vv) return;
  const keyboard = matchMedia("(max-width: 560px)").matches && vv.height < window.innerHeight - 80;
  if (keyboard) {
    d.style.top = `${Math.round(vv.offsetTop + 8)}px`;
    d.style.bottom = "auto";
    d.style.height = `${Math.round(vv.height - 8)}px`;
  } else {
    d.style.top = d.style.bottom = d.style.height = "";
  }
}
// iPhone Safari ignores overflow:hidden for touch scrolling, so pin the page (position: fixed, offset by the
// current scroll) while a dialog is open, and put the scroll back where it was afterwards (Nov 25).
let lockedScrollY = null;
function lockPageScroll() {
  if (lockedScrollY !== null) return;
  lockedScrollY = window.scrollY;
  document.body.style.top = `-${lockedScrollY}px`;
  document.documentElement.classList.add("modal-open");
}
function unlockPageScroll() {
  if (lockedScrollY === null) return;
  const y = lockedScrollY; lockedScrollY = null;
  document.documentElement.classList.remove("modal-open");
  document.body.style.top = "";
  window.scrollTo(0, y);
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
  const card = el("section", { class: "dialog add-dialog", id: "newItem", role: "dialog", "aria-modal": "true", "aria-labelledby": "niTitle" });

  // Photo
  const media = el("div", { class: "new-media" });
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
    const b = el("button", { type: "button", class: "text-link", text: "Sign in to add a photo", "aria-haspopup": "menu" });
    b.onclick = (e) => { e.stopPropagation(); openMenu(b, signInChoices()); };
    media.append(el("div", { class: "new-photo new-photo-off" }, b));
  }

  // Fields
  const field = (id, label, input) => el("div", { class: "new-field" }, el("label", { for: id, text: label }), input);
  const name = el("input", { id: "niName", type: "text", maxlength: "200", autocomplete: "off" });
  const link = el("input", { id: "niLink", type: "url", maxlength: "2000", placeholder: "https://", autocomplete: "off" });
  const desc = el("textarea", { id: "niDesc", rows: "2", maxlength: "1000" });
  const price = el("input", { id: "niPrice", type: "text", maxlength: "40", placeholder: "e.g. 24", autocomplete: "off" });
  const cur = el("select", { id: "niCurrency", "aria-label": "Currency" });
  ["USD", "EUR", "GBP", "CAD", "AUD", "JPY", "MXN", "NZD", "CHF", "SEK", "INR"].forEach((c) => {
    let sym = c;
    try { sym = new Intl.NumberFormat("en", { style: "currency", currency: c, currencyDisplay: "narrowSymbol" }).formatToParts(0).find((x) => x.type === "currency").value; } catch (e) {}
    cur.append(el("option", { value: c, text: sym === c ? c : `${sym} ${c}` }));
  });
  const err = el("p", { class: "new-error", id: "niError", role: "alert", hidden: true });
  const save = el("button", { type: "submit", class: "btn-save", text: "Add to list" });
  const cancel = el("button", { type: "button", class: "text-link", text: "Cancel" });
  cancel.onclick = closeNewItem;

  const form = el("form", { class: "new-form", novalidate: true },
    el("span", { class: "sheet-grabber", "aria-hidden": "true" }),
    el("h2", { class: "add-title", id: "niTitle", text: "Add an item" }),
    el("div", { class: "new-photo-wrap" }, media),
    field("niName", "Name", name),
    field("niLink", "Link (optional)", link),
    field("niDesc", "Description (optional)", desc),
    el("div", { class: "new-field" }, el("label", { for: "niPrice", text: "Price (optional)" }), el("div", { class: "new-price" }, cur, price)),
    err,
    el("div", { class: "form-actions" }, cancel, save));
  form.onsubmit = (e) => { e.preventDefault(); saveNewItem(save); };
  // Pinned Cancel / Add to list: a shadow + line on top only while more of the form is hidden under it (Nov 25).
  const markHidden = () => form.lastElementChild.classList.toggle("covering", form.scrollTop + form.clientHeight < form.scrollHeight - 2);
  form.addEventListener("scroll", markHidden, { passive: true });
  if (window.ResizeObserver) new ResizeObserver(markHidden).observe(form);
  // Return saves from any box (Shift+Return = new line in the description); Escape cancels.
  form.addEventListener("keydown", (e) => {
    if (e.isComposing) return;
    if (e.key === "Enter" && e.target.tagName === "TEXTAREA" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
  });
  card.append(form);
  return card;
}

function closeNewItem() {
  teardownNewItem();
  const back = newItemBack && newItemBack.isConnected && newItemBack.offsetParent ? newItemBack : $("#listMenuBtn");
  if (back) back.focus();
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
  // Typed symbol/code wins ("€30"); a bare number uses the picker; anything else is kept as text ("priceless").
  const pp = nfaParsePrice(priceText, $("#niCurrency").value);
  savingNew = true;
  btn.disabled = true; btn.textContent = newItemPhoto ? "Uploading photo…" : "Adding…";
  try {
    const image = newItemPhoto ? await uploadPhoto(newItemPhoto) : null;
    const top = Math.min(0, ...items.map((i) => (typeof i.position === "number" ? i.position : Number(i.position) || 0)));
    const store = url ? new URL(url).hostname.replace(/^www\./, "") : null;
    const item = {
      id: crypto.randomUUID(), name, description: description || null, url: url || null, store,
      image, price: pp.price, saved_price: pp.price, currency: pp.price == null ? null : pp.currency, price_label: pp.label,
      position: top - 1, saved_at: new Date().toISOString(), amazon_blocked: false, owned: false,
    };
    const ok = await ownerRpc("owner_restore_item", { p_item: item });
    if (!ok) throw new Error("not saved");
    teardownNewItem();
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

// The photo box takes the photo's own shape, capped between 2:3 (tall) and 16:10 (wide), so photos
// fill it without bars; only extreme shapes get trimmed a little. Cards in a row may differ in height.
function fitPhoto(img) {
  const r = img.naturalWidth / img.naturalHeight;
  const box = img.closest(".media");
  if (!box || !r || !Number.isFinite(r)) return;
  box.style.aspectRatio = String(Math.min(1.6, Math.max(2 / 3, r)));
}

// ---------- Sign in with email (6-digit code, Nov 24; Figma "Other ways to sign in") ----------
// A dialog: email → code (paste works, signs in by itself at 6 digits). Cancel, Escape or a click
// outside closes it; reopening within 10 minutes goes back to the code step.
// via "site": this website signs in (NFAAuth). via "ext": the owner page asks the extension to do it,
// so the email joins the extension's list and share link (like "Sign in with Google" on the gate).
function signInChoices() {
  return [
    { label: "Sign in with Google", run: () => NFAAuth.signIn() },
    { label: "Sign in with email", run: () => openEmail() },
  ];
}
const EXT_EMAIL = "nfa-ext-email"; // sessionStorage {email, sentAt} while the extension's code is out
async function askExtension(msg) {
  const ids = NFA_CONFIG.extensionIds || [];
  const rt = window.chrome && chrome.runtime && chrome.runtime.sendMessage ? chrome.runtime : null;
  if (!rt || !ids.length) return null;
  let res = null;
  for (const id of ids) {
    res = await new Promise((resolve) => {
      try { rt.sendMessage(id, msg, (r) => { void chrome.runtime.lastError; resolve(r || null); }); }
      catch (e) { resolve(null); }
    });
    if (res && res.status !== "not-mine") break;
  }
  return res;
}
const emailVia = {
  site: {
    pending: () => NFAAuth.pendingEmail(),
    send: async (email) => NFAAuth.sendCode(email, await NFACaptcha.get()),
    verify: async (code) => { await NFAAuth.verifyCode(code); return "signed-in"; },
    cancel: () => NFAAuth.cancelEmail(),
  },
  ext: {
    pending() {
      try { const p = JSON.parse(sessionStorage.getItem(EXT_EMAIL) || "null"); return p && Date.now() - p.sentAt < 600000 ? p.email : ""; } catch (e) { return ""; }
    },
    async send(email) {
      // The extension can't run the bot check itself when its panel is closed, so the website passes one along.
      let r = await askExtension({ type: "nfa-email-send", slug, email, captcha: await NFACaptcha.get() });
      // A brand-new extension list first makes its account (that uses the token): one more try with a fresh one.
      if (r && r.status === "error" && /person/.test(r.message || "")) r = await askExtension({ type: "nfa-email-send", slug, email, captcha: await NFACaptcha.get() });
      if (!r || r.status === "not-mine") throw new Error("Open the NFA Wishlist extension and sign in there.");
      if (r.status === "error") throw new Error(r.message || "Couldn't send the code. Try again.");
      email = email.trim().toLowerCase();
      try { sessionStorage.setItem(EXT_EMAIL, JSON.stringify({ email, sentAt: Date.now() })); } catch (e) {}
      return email;
    },
    async verify(code) {
      const r = await askExtension({ type: "nfa-email-verify", slug, code });
      if (!r || r.status === "not-mine") throw new Error("Open the NFA Wishlist extension and sign in there.");
      if (r.status === "error") throw new Error(r.message || "That code didn't work. Check it, or send a new one.");
      try { sessionStorage.removeItem(EXT_EMAIL); } catch (e) {}
      return r.status;
    },
    cancel() { try { sessionStorage.removeItem(EXT_EMAIL); } catch (e) {} },
  },
};
let emailCtx = null, emailBusy = false, emailAddr = "";
function openEmail({ via = "site", after = () => location.reload() } = {}) {
  closeMenu();
  emailCtx = { api: emailVia[via], after, back: document.activeElement };
  const scrim = $("#emailScrim");
  scrim.hidden = false;
  requestAnimationFrame(() => scrim.classList.add("on"));
  $("#emailDialog").hidden = false;
  document.addEventListener("keydown", emailKeys, true);
  const pending = emailCtx.api.pending();
  if (pending) codeStep(pending);
  else if (via === "site" && extEmail) emailStep(extEmail, true);
  else emailStep("");
}
function closeEmail() {
  if (!emailCtx) return;
  const back = emailCtx.back;
  emailCtx = null;
  $("#emailDialog").hidden = true;
  $("#emailScrim").classList.remove("on");
  $("#emailScrim").hidden = true;
  document.removeEventListener("keydown", emailKeys, true);
  if (back && back.isConnected && back.offsetParent) back.focus();
}
function emailKeys(e) {
  if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); closeEmail(); return; }
  if (e.key !== "Tab") return;
  const f = [...$("#emailDialog").querySelectorAll("input, button")].filter((x) => !x.disabled && x.offsetParent);
  if (!f.length) return;
  if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
  else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
}
function emailError(msg, field) {
  $("#emailError").textContent = msg || "";
  $("#emailError").hidden = !msg;
  ["#emailInput", "#codeInput"].forEach((id) => $(id).removeAttribute("aria-invalid"));
  if (msg && field) $(field).setAttribute("aria-invalid", "true");
}
function emailStep(value, fromExt = false) {
  $("#emailTitle").textContent = "Sign in with email";
  $("#emailText").textContent = fromExt
    ? `You're signed in on the NFA extension as ${value}. We'll email you a 6-digit code to sign in here too.`
    : "We'll email you a 6-digit code. No password needed.";
  $("#emailStep").hidden = false; $("#codeStep").hidden = true; $("#codeLinks").hidden = true;
  $("#emailSubmit").textContent = "Email me a code";
  emailError("");
  $("#emailInput").value = value || "";
  (fromExt ? $("#emailSubmit") : $("#emailInput")).focus(); // prefilled: Return sends the code
}
function codeStep(email) {
  emailAddr = email;
  $("#emailTitle").textContent = "Check your email";
  $("#emailText").textContent = `We sent a 6-digit code to ${email}. It works for 10 minutes. Not there? Check your spam folder.`;
  $("#emailStep").hidden = true; $("#codeStep").hidden = false; $("#codeLinks").hidden = false;
  $("#emailSubmit").textContent = "Sign in";
  emailError("");
  $("#codeInput").value = "";
  $("#codeInput").focus();
}
function emailBusyOn(on) {
  emailBusy = on;
  $("#emailDialog").querySelectorAll("button, input").forEach((b) => { if (b.id !== "emailCancel") b.disabled = on; });
}
async function sendEmailCode(email) {
  if (!emailCtx) return false;
  emailBusyOn(true);
  try {
    const sent = await emailCtx.api.send(email);
    emailBusyOn(false);
    codeStep(sent || email);
    return true;
  } catch (e) {
    emailBusyOn(false);
    emailError(e.message || "Couldn't send the code. Try again.", $("#codeStep").hidden ? "#emailInput" : null);
    return false;
  }
}
async function checkEmailCode(code) {
  if (!emailCtx) return;
  emailBusyOn(true);
  let status;
  try {
    status = await emailCtx.api.verify(code);
  } catch (e) {
    emailBusyOn(false);
    emailError(e.message || "That code didn't work. Check it, or send a new one.", "#codeInput");
    $("#codeInput").focus(); $("#codeInput").select();
    return;
  }
  emailBusyOn(false);
  const after = emailCtx.after;
  closeEmail();
  after(status);
}
$("#emailForm").onsubmit = (e) => {
  e.preventDefault();
  if (emailBusy) return;
  if (!$("#emailStep").hidden) {
    const v = $("#emailInput").value.trim();
    if (v.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { emailError("Check the email address and try again.", "#emailInput"); $("#emailInput").focus(); return; }
    sendEmailCode(v);
  } else {
    const c = $("#codeInput").value.replace(/\D/g, "");
    if (c.length !== 6) { emailError("Type the 6-digit code from the email.", "#codeInput"); $("#codeInput").focus(); return; }
    checkEmailCode(c);
  }
};
$("#codeInput").oninput = () => {
  const el = $("#codeInput"), d = el.value.replace(/\D/g, "").slice(0, 6);
  if (el.value !== d) el.value = d;
  if (el.getAttribute("aria-invalid")) emailError("");
  if (d.length === 6 && !emailBusy) checkEmailCode(d);
};
$("#resendCode").onclick = async () => { if (!emailBusy && await sendEmailCode(emailAddr)) toast("New code sent."); };
$("#otherEmail").onclick = () => { if (emailCtx) emailCtx.api.cancel(); emailStep(emailAddr); };
$("#emailCancel").onclick = closeEmail;
$("#emailScrim").onclick = closeEmail;
