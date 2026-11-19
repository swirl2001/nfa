// NFA = Not F***ing Amazon. Amazon and Amazon-owned stores never get a link,
// an image request, or any traffic from NFA Wishlist.
const NFA_AMAZON_HOSTS = [
  /(^|\.)amazon\.[a-z.]+$/,          // amazon.com, amazon.co.uk, smile.amazon.com ...
  /(^|\.)amzn\.(to|com|eu|asia)$/,   // short links
  /(^|\.)a\.co$/,                    // a.co short links
  /(^|\.)media-amazon\.com$/,        // product image CDN
  /(^|\.)ssl-images-amazon\.com$/,
  /(^|\.)images-amazon\.com$/,
  /(^|\.)primevideo\.com$/,
  /(^|\.)audible\.[a-z.]+$/,
  /(^|\.)zappos\.com$/,
  /(^|\.)woot\.com$/,
  /(^|\.)shopbop\.com$/,
  /(^|\.)abebooks\.[a-z.]+$/,
  /(^|\.)wholefoodsmarket\.com$/,
];

function nfaIsAmazon(url) {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return NFA_AMAZON_HOSTS.some((re) => re.test(host));
  } catch (e) {
    return false;
  }
}

// Remove every Amazon link and image from an item, and flag it for alternatives.
function nfaStripAmazon(item) {
  const fromAmazon = nfaIsAmazon(item.url) || item.amazonBlocked === true;
  const out = { ...item };
  if (fromAmazon) {
    out.url = "";
    out.store = "Amazon (link removed)";
    out.amazonBlocked = true;
    out.needsAlternative = true;
  }
  if (nfaIsAmazon(out.image)) out.image = "";
  return out;
}
