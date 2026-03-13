/* ============================================================
   admin-billing.js — Billing Module for AnfrageBox Admin
   Loads subscription status, manages Stripe portal redirect
   ============================================================ */
(() => {
  "use strict";

  function app() { return window.__AB_APP || {}; }
  function sb() { return app().sb || window.__abSupabase; }
  function state() { return app().state || {}; }
  function companyId() { return state().companyId; }
  function showNotice(m, t) { if (typeof app().showNotice === "function") app().showNotice(m, t); }

  const $ = (id) => document.getElementById(id);
  const PORTAL_SESSION_URL = "/anfrage/api/billing/create-portal-session.php";

  const STATUS_MAP = {
    trialing: { label: "Testphase", color: "#047857" },
    active: { label: "Aktiv", color: "#047857" },
    past_due: { label: "Zahlung ausstehend", color: "#dc2626" },
    canceled: { label: "Gekündigt", color: "#6b7280" },
    unpaid: { label: "Unbezahlt", color: "#dc2626" },
    incomplete: { label: "Unvollständig", color: "#f59e0b" },
  };

  function formatDate(d) {
    if (!d) return "-";
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return "-";
    return dt.toLocaleDateString("de-DE");
  }

  function daysUntil(d) {
    if (!d) return null;
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return null;
    return Math.ceil((dt.getTime() - Date.now()) / 86400000);
  }

  async function loadBilling() {
    const s = sb();
    if (!s || !companyId()) return;

    const hint = $("billingStatusHint");
    if (hint) hint.textContent = "Laden...";

    try {
      const { data, error } = await s.from("subscriptions")
        .select("*")
        .eq("company_id", companyId())
        .maybeSingle();

      if (error) { if (hint) hint.textContent = "Fehler beim Laden."; return; }

      if (!data) {
        // No subscription found
        if ($("billingPlan")) $("billingPlan").textContent = "Kein Plan";
        if ($("billingStatus")) { $("billingStatus").textContent = "Nicht aktiv"; $("billingStatus").style.color = "#6b7280"; }
        if ($("billingPrice")) $("billingPrice").textContent = "-";
        if ($("billingNext")) $("billingNext").textContent = "-";
        if (hint) hint.textContent = "Kein aktives Abonnement.";
        if ($("btnManageBilling")) $("btnManageBilling").textContent = "Jetzt abonnieren";
        return;
      }

      const st = STATUS_MAP[data.status] || { label: data.status, color: "#6b7280" };

      if ($("billingPlan")) $("billingPlan").textContent = (data.plan_name || "Pro").charAt(0).toUpperCase() + (data.plan_name || "pro").slice(1);
      if ($("billingStatus")) { $("billingStatus").textContent = st.label; $("billingStatus").style.color = st.color; }
      if ($("billingPrice")) $("billingPrice").textContent = (data.amount_eur / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" }) + " / Monat";
      if ($("billingNext")) $("billingNext").textContent = formatDate(data.current_period_end);
      if (hint) hint.textContent = "Stand: " + formatDate(data.updated_at || data.created_at);

      // Trial info
      const trialInfo = $("billingTrialInfo");
      if (trialInfo && data.status === "trialing" && data.trial_end) {
        const days = daysUntil(data.trial_end);
        if (days !== null && days > 0) {
          trialInfo.textContent = "Testphase endet in " + days + " Tagen (" + formatDate(data.trial_end) + "). Sie werden erst danach belastet.";
          trialInfo.style.display = "";
        } else if (days !== null && days <= 0) {
          trialInfo.textContent = "Testphase abgelaufen.";
          trialInfo.style.display = "";
          trialInfo.style.background = "#fef2f2";
          trialInfo.style.borderColor = "#fecaca";
          trialInfo.style.color = "#991b1b";
        }
      }

      // Canceled info
      if (data.status === "canceled" && data.cancel_at) {
        if (trialInfo) {
          trialInfo.textContent = "Zugang bis " + formatDate(data.cancel_at) + ". Danach wird das Konto pausiert.";
          trialInfo.style.display = "";
          trialInfo.style.background = "#fffbeb";
          trialInfo.style.borderColor = "#fde68a";
          trialInfo.style.color = "#92400e";
        }
      }

    } catch (err) {
      if (hint) hint.textContent = "Fehler: " + (err.message || err);
    }

    // Embed code
    loadEmbedCode();
  }

  async function loadEmbedCode() {
    const s = sb();
    if (!s || !companyId()) return;
    try {
      const { data } = await s.from("company_settings").select("slug").eq("company_id", companyId()).maybeSingle();
      const slug = data?.slug || "";
      const url = "https://anfragebox.de/anfrage/index.html?slug=" + encodeURIComponent(slug);
      const code = '<iframe src="' + url + '" width="100%" height="800" frameborder="0" style="border:none;border-radius:16px;"></iframe>';
      if ($("embedCodeAdmin")) $("embedCodeAdmin").textContent = code;
    } catch (err) { /* silent */ }
  }

  async function openStripePortal() {
    const s = sb();
    if (!s || !companyId()) { showNotice("Nicht verbunden.", "err"); return; }

    const token = state().session?.access_token || "";
    if (!token) { showNotice("Nicht eingeloggt.", "err"); return; }

    const btn = $("btnManageBilling");
    if (btn) { btn.disabled = true; btn.textContent = "Laden..."; }

    try {
      const res = await fetch(PORTAL_SESSION_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
        body: JSON.stringify({ company_id: companyId() }),
      });
      const result = await res.json();

      if (result.ok && result.portal_url) {
        window.open(result.portal_url, "_blank");
      } else if (result.error === "No subscription found") {
        // No Stripe customer yet, redirect to checkout
        window.location.href = "/anfrage/signup.html";
      } else {
        showNotice("Fehler: " + (result.error || ""), "err");
      }
    } catch (err) {
      showNotice("Netzwerkfehler: " + (err.message || err), "err");
    }

    if (btn) { btn.disabled = false; btn.textContent = "Zahlungsmethode verwalten"; }
  }

  function hookNav() {
    const navBtn = $("navBilling");
    if (!navBtn) return;
    navBtn.addEventListener("click", () => {
      if (typeof app().navigate === "function") app().navigate("billing");
      document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
      const view = $("viewBilling");
      if (view) view.classList.add("active");
      document.querySelectorAll(".nav button").forEach(b => b.classList.remove("active"));
      navBtn.classList.add("active");
      const pt = $("pageTitle");
      const ps = $("pageSub");
      if (pt) pt.textContent = "Abo & Zahlung";
      if (ps) ps.textContent = "Abonnement verwalten";
      loadBilling();
    });
  }

  function hookButtons() {
    const btnManage = $("btnManageBilling");
    if (btnManage) btnManage.addEventListener("click", openStripePortal);

    const btnRefresh = $("btnRefreshBilling");
    if (btnRefresh) btnRefresh.addEventListener("click", loadBilling);

    const btnCopy = $("btnCopyEmbedAdmin");
    if (btnCopy) btnCopy.addEventListener("click", () => {
      const code = $("embedCodeAdmin")?.textContent || "";
      navigator.clipboard.writeText(code).then(() => {
        btnCopy.textContent = "Kopiert!";
        setTimeout(() => { btnCopy.textContent = "Kopieren"; }, 2000);
      });
    });
  }

  function boot() {
    hookNav();
    hookButtons();
    // Auto-load if hash is #billing
    if (window.location.hash === "#billing") {
      const navBtn = $("navBilling");
      if (navBtn) navBtn.click();
    }
    // Also load billing data when Settings tab is opened (billing is now inside Settings)
    const navSettings = $("navSettings");
    if (navSettings) {
      navSettings.addEventListener("click", () => { setTimeout(loadBilling, 200); });
    }
  }

  if (document.readyState === "loading") window.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.__AB_Billing = { load: loadBilling, openPortal: openStripePortal };
})();