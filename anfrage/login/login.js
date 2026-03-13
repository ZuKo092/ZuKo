(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const SUPABASE_URL = String(window.SUPABASE_URL || "").trim();
  const SUPABASE_KEY = String(
    window.SUPABASE_PUBLISHABLE_KEY || window.SUPABASE_ANON_KEY || ""
  ).trim();

  const LOGIN_PAGE = String(window.AB_LOGIN_PAGE || "/anfrage/login/login.html");
  const LOGIN_REDIRECT = String(window.AB_LOGIN_REDIRECT || "/anfrage/admin.html");
  const MFA_PAGE = String(window.AB_MFA_PAGE || "/anfrage/login/login.html");
  const COMPANY_USERS_TABLE = String(window.AB_COMPANY_USERS_TABLE || "company_users");
  const MFA_ROLES = new Set(
    (window.AB_MFA_ROLES || []).map((v) => String(v).toLowerCase())
  );

  const AUTH_STORAGE_KEY = "sb-uledkuegmaritmsjejlm-auth";

  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    console.error("Supabase JS fehlt.");
    return;
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("Supabase config fehlt.");
    return;
  }

  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: AUTH_STORAGE_KEY
    }
  });
let _routing = false;

async function tryRouteSession() {
  if (_routing) return;
  _routing = true;

  try {
    const { data } = await sb.auth.getSession();
    if (data?.session?.user) {
      await routeUserAfterLogin(data.session.user);
    }
  } catch (err) {
    console.error("SESSION ROUTE ERROR:", err);
  } finally {
    _routing = false;
  }
}

sb.auth.onAuthStateChange(async (event, session) => {
  if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && session?.user) {
    await routeUserAfterLogin(session.user);
  }
});
  const ui = {
    form: $("loginForm"),
    email: $("email"),
    password: $("password"),
    message: $("loginMessage"),
    loading: $("loginLoading"),
    button: $("loginBtn"),
    togglePassword: $("togglePassword")
  };

  function setBusy(isBusy) {
    if (ui.button) {
      ui.button.disabled = isBusy;
      ui.button.textContent = isBusy ? "Prüfen..." : "Anmelden";
    }
    if (ui.loading) {
      ui.loading.classList.toggle("is-visible", isBusy);
    }
  }

  function setMessage(text = "", type = "error") {
    if (!ui.message) return;

    ui.message.className = "notice";
    ui.message.textContent = text;

    if (!text) return;

    ui.message.classList.add("is-visible");

    if (type === "success") ui.message.classList.add("is-success");
    else if (type === "info") ui.message.classList.add("is-info");
    else ui.message.classList.add("is-error");
  }

  function clearMessage() {
    setMessage("");
  }

  function stripSensitiveParams() {
    try {
      const url = new URL(window.location.href);
      let changed = false;

      if (url.searchParams.has("email")) {
        url.searchParams.delete("email");
        changed = true;
      }

      if (url.searchParams.has("password")) {
        url.searchParams.delete("password");
        changed = true;
      }

      if (url.searchParams.has("next")) {
        const rawNext = url.searchParams.get("next");
        if (rawNext) {
          const nextUrl = new URL(rawNext, window.location.origin);
          const loginUrl = new URL(LOGIN_PAGE, window.location.origin);

          if (nextUrl.pathname === loginUrl.pathname) {
            url.searchParams.delete("next");
            changed = true;
          }
        }
      }

      if (changed) {
        window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
      }
    } catch (err) {
      console.warn("Could not strip params.", err);
    }
  }

  function sanitizeNext(path) {
    try {
      const fallback = new URL(LOGIN_REDIRECT, window.location.origin);
      const loginUrl = new URL(LOGIN_PAGE, window.location.origin);
      const url = new URL(path || fallback.pathname, window.location.origin);

      if (url.origin !== window.location.origin) return fallback.pathname;
      if (url.pathname === loginUrl.pathname) return fallback.pathname;

      return `${url.pathname}${url.search}${url.hash}`;
    } catch {
      return LOGIN_REDIRECT;
    }
  }

  function roleNeedsMfa(member) {
    const role = String(member?.role || "").trim().toLowerCase();
    return Boolean(member?.mfa_required) || MFA_ROLES.has(role);
  }

  async function fetchMembership(userId) {
    const { data, error } = await sb
      .from(COMPANY_USERS_TABLE)
      .select("company_id, role, is_active, mfa_required")
      .eq("user_id", userId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data || null;
  }

  function persistCompanyContext(member) {
    try {
      localStorage.setItem(
        "ab_company_context",
        JSON.stringify({
          company_id: member.company_id || null,
          role: member.role || null,
          is_active: Boolean(member.is_active),
          mfa_required: Boolean(member.mfa_required)
        })
      );
    } catch (err) {
      console.warn("Could not persist company context.", err);
    }
  }

  async function routeUserAfterLogin(user) {
    const member = await fetchMembership(user.id);

    if (!member) {
      await sb.auth.signOut();
      throw new Error("Kein aktiver Firmenzugang gefunden.");
    }

    persistCompanyContext(member);

    const next = sanitizeNext(new URLSearchParams(window.location.search).get("next"));

    if (roleNeedsMfa(member)) {
      window.location.replace(`${MFA_PAGE}?next=${encodeURIComponent(next)}`);
      return;
    }

    window.location.replace(next);
  }

 
async function handleMagicLink() {
  try {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    const hash = window.location.hash || "";

    if (code) {
      setBusy(true);
      setMessage("Magic Link wird geprüft...", "info");

      const { error } = await sb.auth.exchangeCodeForSession(code);
      if (error) throw error;

      await tryRouteSession();
      return;
    }

    if (hash.includes("access_token=") || hash.includes("refresh_token=")) {
      setBusy(true);
      setMessage("Magic Link wird verarbeitet...", "info");

      setTimeout(async () => {
        await tryRouteSession();
        setBusy(false);
      }, 700);
      return;
    }

    await tryRouteSession();
  } catch (err) {
    console.error("MAGIC LINK ERROR:", err);
    setMessage(err?.message || "Magic Link ungültig oder abgelaufen.");
    setBusy(false);
  }
}
async function boot() {
  stripSensitiveParams();
  clearMessage();
  setBusy(false);

  try {
    const url = new URL(window.location.href);

    if (url.searchParams.get("logout") === "1") {
      await sb.auth.signOut();
      url.searchParams.delete("logout");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
      return;
    }

    await handleMagicLink();
  } catch (err) {
    console.warn("BOOT ERROR:", err);
  }
}  
})();