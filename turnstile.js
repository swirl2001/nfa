// Bot check page (Cloudflare Turnstile), shown in a small frame by nfawishlist.com and the NFA extension.
// The parent posts {type: "nfa-captcha-get", id}; this page answers {type: "nfa-captcha-token", id, token}.
// If Cloudflare wants a click, it says {type: "nfa-captcha-interactive"} so the parent can show the frame.
// Only our own site and extension builds may ask (NFA_CONFIG.extensionIds).
(() => {
  const allowed = new Set(["https://nfawishlist.com", "https://www.nfawishlist.com", location.origin,
    ...((NFA_CONFIG.extensionIds || []).map((id) => `chrome-extension://${id}`))]);
  let widget = null, ready = false, waiting = [], parentOrigin = null;
  const post = (msg) => { if (parentOrigin) window.parent.postMessage(msg, parentOrigin); };

  function run() {
    if (!ready || !waiting.length) return;
    const opts = {
      sitekey: NFA_CONFIG.turnstileSiteKey,
      appearance: "interaction-only", // invisible unless Cloudflare needs a click
      callback: (token) => { const w = waiting; waiting = []; w.forEach((id) => post({ type: "nfa-captcha-token", id, token })); },
      "error-callback": () => { const w = waiting; waiting = []; w.forEach((id) => post({ type: "nfa-captcha-error", id })); return true; },
      "expired-callback": () => { if (widget !== null) turnstile.reset(widget); },
      "before-interactive-callback": () => post({ type: "nfa-captcha-interactive" }),
      "after-interactive-callback": () => post({ type: "nfa-captcha-done" }),
    };
    if (widget === null) widget = turnstile.render("#widget", opts);
    else turnstile.reset(widget); // tokens are single-use: a fresh one for each request
  }
  window.nfaTurnstileReady = () => { ready = true; run(); };
  window.addEventListener("message", (e) => {
    if (!allowed.has(e.origin) || !e.data || e.data.type !== "nfa-captcha-get") return;
    parentOrigin = e.origin;
    waiting.push(String(e.data.id || ""));
    run();
  });
})();
