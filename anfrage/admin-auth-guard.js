(() => {
  "use strict";
  const SUPABASE_URL = String(window.SUPABASE_URL || "").trim();
  const SUPABASE_KEY = String(
    window.SUPABASE_PUBLISHABLE_KEY || window.SUPABASE_ANON_KEY || ""
  ).trim();
  const LOGIN_REDIRECT = String(window.AB_LOGIN_REDIRECT || "/anfrage/admin.html");
  const html = document.documentElement;

  function markReady() {
    html.classList.remove("ab-auth-pending");
    html.classList.add("ab-auth-ready");
    const overlay = document.getElementById("ab-login-overlay");
    if (overlay) overlay.remove();
  }

  function showLoginForm(message) {
    let overlay = document.getElementById("ab-login-overlay");
    if (overlay) overlay.remove();

    overlay = document.createElement("div");
    overlay.id = "ab-login-overlay";
    overlay.style.cssText = "position:fixed;inset:0;z-index:99999;background:#f4f6f5;display:flex;align-items:center;justify-content:center;font-family:Inter,system-ui,sans-serif;";
    overlay.innerHTML = `
      <div style="width:100%;max-width:380px;padding:24px;">
        <div style="text-align:center;margin-bottom:24px;">
          <div style="font-size:22px;font-weight:800;color:#111;">AnfrageBox</div>
          <div style="font-size:13px;color:#6b7280;margin-top:4px;">Admin Login</div>
        </div>
        <div id="ab-login-error" style="display:none;background:#fef2f2;border:1px solid #fecaca;color:#991b1b;border-radius:8px;padding:10px;font-size:13px;font-weight:600;margin-bottom:12px;text-align:center;"></div>
        <div style="margin-bottom:12px;">
          <label style="display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:4px;">E-Mail</label>
          <input id="ab-login-email" type="email" placeholder="email@example.com" style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:15px;outline:none;box-sizing:border-box;" />
        </div>
        <div style="margin-bottom:16px;">
          <label style="display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:4px;">Passwort</label>
          <input id="ab-login-password" type="password" placeholder="Passwort" style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:15px;outline:none;box-sizing:border-box;" />
        </div>
        <button id="ab-login-btn" type="button" style="width:100%;padding:12px;background:#047857;color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer;">Anmelden</button>
        <div style="text-align:center;margin-top:12px;font-size:12px;color:#9ca3af;">${message || ""}</div>
      </div>
    `;
    document.body.appendChild(overlay);

    const emailInput = document.getElementById("ab-login-email");
    const passInput = document.getElementById("ab-login-password");
    const btn = document.getElementById("ab-login-btn");
    const errorEl = document.getElementById("ab-login-error");

    async function doLogin() {
      const email = (emailInput.value || "").trim();
      const pass = (passInput.value || "").trim();
      if (!email || !pass) {
        errorEl.textContent = "Bitte E-Mail und Passwort eingeben.";
        errorEl.style.display = "block";
        return;
      }
      btn.disabled = true;
      btn.textContent = "Laden...";
      errorEl.style.display = "none";

      try {
        const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
        if (error) {
          errorEl.textContent = error.message || "Login fehlgeschlagen.";
          errorEl.style.display = "block";
          btn.disabled = false;
          btn.textContent = "Anmelden";
          return;
        }
        if (data?.session) {
          markReady();
          window.location.reload();
        } else {
          errorEl.textContent = "Keine Session erhalten.";
          errorEl.style.display = "block";
          btn.disabled = false;
          btn.textContent = "Anmelden";
        }
      } catch (err) {
        errorEl.textContent = "Fehler: " + (err.message || "Unbekannt");
        errorEl.style.display = "block";
        btn.disabled = false;
        btn.textContent = "Anmelden";
      }
    }

    btn.addEventListener("click", doLogin);
    passInput.addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });
    emailInput.addEventListener("keydown", (e) => { if (e.key === "Enter") passInput.focus(); });
    emailInput.focus();
  }

  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    showLoginForm("Supabase JS nicht geladen.");
    return;
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    showLoginForm("Supabase Konfiguration fehlt.");
    return;
  }

  if (!window.__abSupabase) {
    window.__abSupabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });
  }
  const sb = window.__abSupabase;

  async function boot() {
    try {
      const { data: sessionData, error: sessionError } = await sb.auth.getSession();
      if (sessionError) {
        showLoginForm("Sitzung abgelaufen. Bitte erneut anmelden.");
        return;
      }

      const session = sessionData?.session;
      const user = session?.user;

      if (!user) {
        showLoginForm("");
        return;
      }

      // Fetch actual role from company_users
      let companyCtx = { company_id: null, role: "unknown", is_active: false, mfa_required: false };
      try {
        const { data: members, error: memErr } = await sb
          .from("company_users")
          .select("company_id, role, is_active, mfa_required")
          .eq("user_id", user.id)
          .eq("is_active", true)
          .limit(1)
          .maybeSingle();

        if (!memErr && members) {
          companyCtx = {
            company_id: members.company_id || null,
            role: members.role || "staff",
            is_active: members.is_active ?? true,
            mfa_required: members.mfa_required ?? false,
          };
        }
      } catch {}

      try {
        localStorage.setItem("ab_company_context", JSON.stringify(companyCtx));
      } catch {}

      markReady();
      return;
    } catch (err) {
      console.error("ADMIN AUTH GUARD ERROR:", err);
      showLoginForm("Fehler beim Laden. Bitte erneut anmelden.");
    }
  }

  boot();
})();