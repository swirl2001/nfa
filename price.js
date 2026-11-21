// price.js — read what someone typed in a price box, and show a price. Shared by the extension
// (popup/panel) and the website (site/price.js is a copy; keep them the same).
//
//   nfaParsePrice("24", "EUR")      → { price: 24,   currency: "EUR", label: null }   bare number keeps the item's currency
//   nfaParsePrice("24", null)       → { price: 24,   currency: "USD", label: null }   …or $ when it has none
//   nfaParsePrice("€24,50")         → { price: 24.5, currency: "EUR", label: null }
//   nfaParsePrice("30 GBP")         → { price: 30,   currency: "GBP", label: null }
//   nfaParsePrice("priceless")      → { price: null, currency: <unchanged>, label: "priceless" }
//   nfaParsePrice("")               → { price: null, currency: <unchanged>, label: null }  (cleared)
// Anything that isn't a plain amount is kept as text (≤40 characters) and shown instead of a number.

const NFA_CURRENCY_SYMBOLS = {
  "$": "USD", "US$": "USD", "CA$": "CAD", "C$": "CAD", "A$": "AUD", "AU$": "AUD", "NZ$": "NZD",
  "HK$": "HKD", "MX$": "MXN", "R$": "BRL", "€": "EUR", "£": "GBP", "¥": "JPY", "JP¥": "JPY",
  "CN¥": "CNY", "₹": "INR", "₩": "KRW", "₪": "ILS", "₺": "TRY", "₫": "VND", "₱": "PHP", "₦": "NGN", "CHF": "CHF",
};
const NFA_DOLLARS = ["USD", "CAD", "AUD", "NZD", "HKD", "MXN", "SGD"];

function nfaAmount(s) {
  if (!s) return undefined;
  if (s.includes(",") && s.includes(".")) s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (s.includes(",")) s = /,\d{1,2}$/.test(s) ? s.replace(",", ".") : s.replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return undefined;
  const n = parseFloat(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : undefined;
}

function nfaCurrencyFor(token, current) {
  const t = token.trim();
  if (!t) return current || "USD";
  if (t === "$") return NFA_DOLLARS.includes(current) ? current : "USD";
  const sym = NFA_CURRENCY_SYMBOLS[t] || NFA_CURRENCY_SYMBOLS[t.toUpperCase()];
  if (sym) return sym;
  if (/^[A-Za-z]{3}$/.test(t)) {
    const code = t.toUpperCase();
    // Only real currencies (the browser accepts any 3 letters, so check its list when it has one).
    try { if (Intl.supportedValuesOf && !Intl.supportedValuesOf("currency").includes(code)) return null; } catch (e) {}
    try { new Intl.NumberFormat("en", { style: "currency", currency: code }); return code; } catch (e) { return null; }
  }
  return null;
}

function nfaParsePrice(text, current) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return { price: null, currency: current || null, label: null };
  // [symbol or code] amount [symbol or code], e.g. "$24", "€ 24,50", "24 EUR", "24€", "CA$30"
  const m = t.match(/^([^\d\s.,]{0,4})\s?(\d[\d.,]*)\s?([^\d\s.,]{0,4})$/);
  if (m && !(m[1] && m[3])) {
    const amount = nfaAmount(m[2]);
    const currency = nfaCurrencyFor(m[1] || m[3], current);
    if (amount !== undefined && currency) return { price: amount, currency, label: null };
  }
  return { price: null, currency: current || null, label: t.slice(0, 40) };
}

// What a card shows: the text if there is one, else the formatted amount, else nothing.
function nfaPriceText(price, currency, label) {
  if (label) return label;
  if (price == null || price === "") return "";
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(price); }
  catch (e) { return `${currency || "$"} ${Number(price).toFixed(2)}`; }
}
