// NFACaptcha.get(): a one-time bot-check token from turnstile.html (Cloudflare Turnstile) in a small frame.
// Usually invisible. If Cloudflare wants a click, a small card with the check appears above everything until done.
// Resolves null when the check is off (no turnstileSiteKey) so callers just carry on. Nov 25.
const NFACaptcha = (() => {
  let card = null, frame = null, loaded = null, n = 0;
  const pending = new Map();
  function ensureFrame() {
    if (frame) return loaded;
    card = document.createElement("div");
    card.className = "captcha-card"; card.setAttribute("role", "dialog"); card.setAttribute("aria-label", "Quick check");
    const p = document.createElement("p"); p.className = "captcha-text"; p.textContent = "Quick check: confirm you're a person.";
    frame = document.createElement("iframe");
    frame.src = "turnstile"; frame.title = "Quick check that you're a person"; frame.className = "captcha-frame";
    loaded = new Promise((res) => { frame.addEventListener("load", () => res(), { once: true }); });
    card.append(p, frame);
    document.body.append(card);
    return loaded;
  }
  const show = (on) => { if (card) card.classList.toggle("show", on); };
  window.addEventListener("message", (e) => {
    if (!frame || e.source !== frame.contentWindow || e.origin !== location.origin || !e.data) return;
    const d = e.data;
    if (d.type === "nfa-captcha-interactive") { show(true); pending.forEach((p) => p.wait()); }
    if (d.type === "nfa-captcha-done") show(false);
    const p = pending.get(d.id);
    if (!p) return;
    if (d.type === "nfa-captcha-token") p.done(d.token);
    if (d.type === "nfa-captcha-error") p.done(null, new Error("Couldn't confirm you're a person. Try again."));
  });
  async function get() {
    if (!NFA_CONFIG.turnstileSiteKey) return null;
    await ensureFrame();
    const id = String(++n);
    return new Promise((resolve, reject) => {
      let t;
      const fail = (msg) => () => p.done(null, new Error(msg));
      const p = {
        wait: () => { clearTimeout(t); t = setTimeout(fail("The check timed out. Try again."), 180000); },
        done: (token, err) => { clearTimeout(t); pending.delete(id); show(false); if (err) reject(err); else resolve(token); },
      };
      pending.set(id, p);
      t = setTimeout(fail("Couldn't confirm you're a person. Check your connection and try again."), 30000);
      frame.contentWindow.postMessage({ type: "nfa-captcha-get", id }, location.origin);
    });
  }
  return { get };
})();
