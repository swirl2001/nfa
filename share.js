// NFA Wishlist share page: ?list=<slug>   (owner's own spoiler-free view: &view=me)
// Reads the list through the get_shared_list RPC and marks gifts through claim_item.
// Never uses innerHTML: every name, description and link comes from other websites.
// Hard rules: no Amazon links or images (amazon.js), plain store links only (no affiliate
// tags), and the owner never sees claim status (server omits it for a signed-in owner;
// &view=me hides it here too).

const $ = (s, el = document) => el.querySelector(s);
const params = new URLSearchParams(location.search);
const slug = (params.get("list") || "").trim();
const ownerView = params.get("view") === "me";

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

const isWebLink = (u) => { try { return /^https?:$/.test(new URL(u).protocol); } catch (e) { return false; } };
const shopLink = (it) => (it.url && isWebLink(it.url) && !nfaIsAmazon(it.url) ? it.url : "");
const imageLink = (it) => (it.image && isWebLink(it.image) && !nfaIsAmazon(it.image) ? it.image : "");

function money(price, currency) {
  if (price == null || price === "") return "";
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(price); }
  catch (e) { return `${currency || "$"} ${Number(price).toFixed(2)}`; }
}

function toast(msg) {
  const t = $("#toast");
  $(".toast-msg", t).textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.hidden = true; }, 4000);
}
$("#toast .toast-close").onclick = () => { $("#toast").hidden = true; };

function setState(msg) {
  const s = $("#state");
  s.textContent = msg || "";
  s.hidden = !msg;
}

async function load() {
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(slug)) {
    setState("This link is missing its list code. Ask for the link again.");
    return;
  }
  let data;
  try {
    data = await rpc("get_shared_list", { p_slug: slug });
  } catch (e) {
    setState("Couldn't load this list. Check your connection and refresh.");
    return;
  }
  if (!data) {
    setState("This list doesn't exist anymore, or the link is wrong.");
    return;
  }

  const owner = ownerView || data.is_owner === true;
  document.title = `${data.title} · NFA Wishlist`;
  $("#title").textContent = data.title;
  $("#explainer").textContent = owner
    ? "This is your list. What's been bought stays hidden from you, so it's still a surprise."
    : "Tap “I bought this” when you get something, so nobody doubles up. The list owner never sees what's been bought or by whom.";
  $("#intro").hidden = false;

  const items = Array.isArray(data.items) ? data.items : [];
  if (!items.length) { setState("Nothing on this list yet."); return; }
  setState("");

  const grid = $("#items");
  grid.textContent = "";
  const tpl = $("#itemTpl");
  items.forEach((it) => grid.appendChild(card(tpl, it, owner)));
}

function card(tpl, it, owner) {
  const node = tpl.content.firstElementChild.cloneNode(true);
  const link = shopLink(it);
  const amazon = it.amazon_blocked === true || nfaIsAmazon(it.url);

  // Photo (links to the shop when there is a link)
  const media = $(".media", node);
  const img = $(".img", node);
  const noimg = $(".noimg", node);
  const showPlaceholder = () => { img.hidden = true; noimg.hidden = false; };
  $(".noimg-store", node).textContent = amazon ? "" : (it.store || "");
  const src = imageLink(it);
  if (src) { img.src = src; img.alt = it.name || ""; img.onerror = showPlaceholder; } else showPlaceholder();
  if (link) {
    const a = document.createElement("a");
    a.className = media.className;
    a.href = link;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.setAttribute("aria-label", `Open ${it.name || "item"} in the shop`);
    while (media.firstChild) a.appendChild(media.firstChild);
    media.replaceWith(a);
  }
  if (amazon) {
    const alt = $(".alt", node);
    const q = encodeURIComponent(it.name || "");
    alt.hidden = false;
    $(".alt-etsy", alt).href = `https://www.etsy.com/search?q=${q}`;
    $(".alt-web", alt).href = `https://www.google.com/search?tbm=shop&q=${q}+-amazon`;
  }
  $(".badge-out", node).hidden = it.in_stock !== false;

  // Text
  $(".t-name", node).textContent = it.name || "Untitled item";
  $(".t-name", node).title = it.name || "";
  $(".t-desc", node).textContent = it.description || "";
  $(".t-price", node).textContent = money(it.price, it.currency);
  $(".t-store", node).textContent = amazon ? "" : (it.store || "");

  // Shop button
  const shop = $(".shop", node);
  if (link) shop.href = link; else shop.remove();

  // Claims (friends only)
  const buy = $(".buy", node);
  if (owner) {
    buy.remove();
  } else if (it.claimed === true) {
    markClaimed(node);
  } else {
    wireClaim(node, it);
  }
  return node;
}

function markClaimed(node) {
  node.classList.add("claimed");
  $(".badge-claimed", node).hidden = false;
  const buy = $(".buy", node);
  if (buy) buy.remove();
  $(".claim", node).hidden = true;
}

function wireClaim(node, it) {
  const buy = $(".buy", node);
  const form = $(".claim", node);
  const input = $(".claim-name", node);
  buy.onclick = () => {
    form.hidden = false;
    buy.hidden = true;
    try { input.value = localStorage.getItem("nfa-name") || ""; } catch (e) {}
    input.focus();
  };
  $(".claim-cancel", node).onclick = () => { form.hidden = true; buy.hidden = false; };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const name = input.value.replace(/\s+/g, " ").trim();
    if (!name) { input.focus(); return; }
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const ok = await rpc("claim_item", { p_slug: slug, p_item_id: it.id, p_name: name.slice(0, 60) });
      try { localStorage.setItem("nfa-name", name); } catch (err) {}
      markClaimed(node);
      toast(ok ? "Thanks! It's marked as bought." : "Someone already got this one.");
    } catch (err) {
      toast(/owners cannot claim/i.test(err.message) ? "This is your own list." : "Couldn't save that. Try again.");
      submit.disabled = false;
    }
  };
}

load();
