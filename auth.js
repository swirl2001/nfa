// NFAAuth — optional Google sign-in for nfawishlist.com (no library, plain fetch).
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
    if (!res.ok) { const e = new Error((data && (data.msg || data.message || data.error_description)) || `HTTP ${res.status}`); e.status = res.status; throw e; }
    return data;
  }

  function toSession(d) {
    const u = d.user || {}, meta = u.user_metadata || {};
    return {
      accessToken: d.access_token, refreshToken: d.refresh_token,
      expiresAt: d.expires_at ? d.expires_at * 1000 : Date.now() + (d.expires_in || 3600) * 1000,
      email: u.email || meta.email || "", name: meta.full_name || meta.name || "",
      userId: u.id || "",
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
    return s ? { email: s.email, name: s.name } : null;
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

  return { signIn, autoSignIn, finishRedirect, token, user, userId, signOut, forget };
})();
