// NFAAuth — optional sign-in (Google, or an emailed 6-digit code) for nfawishlist.com (no library, plain fetch).
// Flow: Sign in → Supabase /authorize (Google, PKCE) → back here with ?code=… → exchange for a
// session → return to the page the person started on. The session (access + refresh token) lives in
// this browser's localStorage "nfa-session"; signing out deletes it and ends it on the server.
// Nothing here is needed to view a list or mark purchases: friends never have to sign in.

const NFAAuth = (() => {
  const BASE = NFA_CONFIG.supabaseUrl;
  const KEY = NFA_CONFIG.supabaseKey;
  const SESSION = "nfa-session";
  const PENDING = "nfa-signin"; // sessionStorage: {verifier, returnTo} while Google's page is open

  const ls = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
  };
  const ss = {
    get(k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { sessionStorage.removeItem(k); } catch (e) {} },
  };

  async function call(path, { method = "GET", token, body } = {}) {
    const headers = { apikey: KEY, "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await res.json().catch(() => null);
    if (!res.ok) { const e = new Error((data && (data.msg || data.message || data.error_description)) || `HTTP ${res.status}`); e.status = res.status; e.code = (data && data.error_code) || ""; throw e; }
    return data;
  }

  function toSession(d) {
    const u = d.user || {}, meta = u.user_metadata || {};
    return {
      accessToken: d.access_token, refreshToken: d.refresh_token,
      expiresAt: d.expires_at ? d.expires_at * 1000 : Date.now() + (d.expires_in || 3600) * 1000,
      email: u.email || meta.email || "", name: meta.full_name || meta.name || "",
      userId: u.id || "",
      google: ((u.app_metadata && u.app_metadata.providers) || []).includes("google"),
    };
  }

  const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const here = () => `${location.origin}${location.pathname}`; // must be in Supabase's allowed redirect URLs

  const NO_AUTO = "nfa-no-auto"; // localStorage: signed out on purpose here, so don't sign in automatically
  // opts.hint: email to pre-select at Google. opts.auto: started by autoSignIn, not by a click.
  async function signIn(opts = {}) {
    if (!opts.auto) ls.del(NO_AUTO);
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    // Return to the list the person was on, without any edit token in it.
    const back = new URL(location.href);
    back.searchParams.delete("edit");
    ss.set(PENDING, { verifier, returnTo: back.pathname + back.search });
    const q = new URLSearchParams({ provider: "google", redirect_to: here(), code_challenge: challenge, code_challenge_method: "s256" });
    if (opts.hint) q.set("login_hint", opts.hint); // Google picks this account without asking
    location.assign(`${BASE}/auth/v1/authorize?${q}`);
  }

  // On page load: finish a sign-in that just came back from Google. Resolves to an error message or "".
  async function finishRedirect() {
    const q = new URLSearchParams(location.search);
    const code = q.get("code"), err = q.get("error_description") || q.get("error");
    if (!code && !err) return "";
    const pending = ss.get(PENDING);
    ss.del(PENDING);
    const returnTo = (pending && pending.returnTo) || "/";
    let message = "";
    if (err) message = /cancel|denied/i.test(err) ? "" : "Sign-in didn't work. Try again.";
    else if (!pending) message = "Sign-in expired. Try again.";
    else {
      try { ls.set(SESSION, toSession(await call("/auth/v1/token?grant_type=pkce", { method: "POST", body: { auth_code: code, code_verifier: pending.verifier } }))); }
      catch (e) { message = "Sign-in didn't work. Try again."; }
    }
    history.replaceState(null, "", returnTo); // drop ?code= from the address bar and history
    return message;
  }

  // A valid access token, refreshing if needed; null when signed out.
  async function token() {
    let s = ls.get(SESSION);
    if (!s) return null;
    if (Date.now() < s.expiresAt - 60_000) return s.accessToken;
    try {
      s = toSession(await call("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: s.refreshToken } }));
      ls.set(SESSION, s);
      return s.accessToken;
    } catch (e) {
      if (e.status >= 400 && e.status < 500) ls.del(SESSION); // refresh token no longer valid
      return null;
    }
  }

  function user() {
    const s = ls.get(SESSION);
    return s ? { email: s.email, name: s.name, google: s.google !== false } : null;
  }

  // Signed in in the extension but not on this site: go through Google once, quietly.
  // Once per tab session at most (no loops), never after a sign-out on this site.
  const AUTO_TRIED = "nfa-auto-tried";
  function autoSignIn(email) {
    if (user() || ls.get(NO_AUTO) || ss.get(AUTO_TRIED)) return false;
    ss.set(AUTO_TRIED, true);
    signIn({ auto: true, hint: email });
    return true;
  }

  // ---- Sign in with email (6-digit code, Nov 24) ----
  // sendCode emails a code (makes the account if the email is new); verifyCode signs in with it.
  // The step in progress lives in sessionStorage "nfa-email" {email, sentAt} so a reload goes back to it.
  const EMAIL = "nfa-email";
  const CODE_MS = 10 * 60 * 1000;
  function codeError(e) {
    const m = /after (\d+) seconds?/i.exec((e && e.message) || "");
    if (m) return new Error(`Wait ${m[1]} seconds, then send a new code.`);
    if (e && e.status === 429) return new Error("Too many codes for now. Wait a few minutes and try again.");
    if (!e || !e.status) return new Error("Couldn't reach NFA. Check your connection and try again.");
    if (e.code === "captcha_failed" || /captcha/i.test(e.message || "")) return new Error("Couldn't confirm you're a person. Try again.");
    return new Error("Couldn't send the code. Check the email address and try again.");
  }
  // captchaToken: one-time Cloudflare Turnstile token (NFACaptcha.get()); Supabase checks it once bot checks are on.
  async function sendCode(raw, captchaToken) {
    const email = String(raw || "").trim().toLowerCase();
    const body = { email, create_user: true };
    if (captchaToken) body.gotrue_meta_security = { captcha_token: captchaToken };
    try { await call("/auth/v1/otp", { method: "POST", body }); }
    catch (e) { throw codeError(e); }
    ss.set(EMAIL, { email, sentAt: Date.now() });
    return email;
  }
  function pendingEmail() {
    const p = ss.get(EMAIL);
    return p && Date.now() - p.sentAt < CODE_MS ? p.email : "";
  }
  const cancelEmail = () => ss.del(EMAIL);
  async function verifyCode(raw) {
    const email = pendingEmail();
    if (!email) throw new Error("That code has expired. Send a new one.");
    let d;
    try { d = await call("/auth/v1/verify", { method: "POST", body: { email, token: String(raw || "").replace(/\D/g, ""), type: "email" } }); }
    catch (e) { throw new Error(e.status ? "That code didn't work. Check it, or send a new one." : "Couldn't reach NFA. Check your connection and try again."); }
    ss.del(EMAIL);
    ls.del(NO_AUTO);
    const sess = toSession(d);
    ls.set(SESSION, { ...sess, email: sess.email || email });
  }

  async function signOut() {
    const t = await token().catch(() => null);
    ls.del(SESSION);
    ls.set(NO_AUTO, true);
    if (t) await call("/auth/v1/logout?scope=local", { method: "POST", token: t }).catch(() => {});
  }

  const forget = () => ls.del(SESSION);

  // The signed-in user's id (photos go in a folder named after it). Older sessions: read it from the token.
  function userId() {
    const s = ls.get(SESSION);
    if (!s) return "";
    if (s.userId) return s.userId;
    try { return JSON.parse(atob(s.accessToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).sub || ""; } catch (e) { return ""; }
  }

  return { signIn, sendCode, verifyCode, pendingEmail, cancelEmail, autoSignIn, finishRedirect, token, user, userId, signOut, forget };
})();
