/**
 * admin-empty-states.js — AnfrageBox Empty State Enhancement
 * Add this as <script src="/anfrage/admin-empty-states.js" defer></script> in admin.html
 * 
 * Shows helpful CTAs when dashboard/sections are empty (no leads yet).
 */
(() => {
  "use strict";

  function waitForApp(cb, maxTries = 50) {
    let tries = 0;
    const interval = setInterval(() => {
      tries++;
      if (window.__AB_APP || tries >= maxTries) {
        clearInterval(interval);
        cb();
      }
    }, 200);
  }

  function getEl(id) { return document.getElementById(id); }

  function createEmptyState(icon, title, desc, btnText, btnAction) {
    const div = document.createElement("div");
    div.className = "ab-empty-state";
    div.style.cssText = "text-align:center;padding:48px 24px;";
    div.innerHTML = `
      <div style="font-size:48px;margin-bottom:16px;opacity:.4;">${icon}</div>
      <div style="font-size:18px;font-weight:800;color:#111;margin-bottom:8px;">${title}</div>
      <div style="font-size:14px;color:#6b7280;line-height:1.6;max-width:400px;margin:0 auto 24px;">${desc}</div>
      ${btnText ? `<button class="btn green ab-empty-btn" type="button" style="height:44px;padding:0 28px;font-size:14px;font-weight:700;">${btnText}</button>` : ''}
    `;
    if (btnText && btnAction) {
      setTimeout(() => {
        const btn = div.querySelector(".ab-empty-btn");
        if (btn) btn.addEventListener("click", btnAction);
      }, 0);
    }
    return div;
  }

  waitForApp(() => {
    // Patch the Start view: when KPIs are all 0, show empty state
    const kpiTotal = getEl("kpiTotal");
    const startActivity = getEl("startActivityList");

    function checkStartEmpty() {
      if (!kpiTotal || !startActivity) return;
      const total = parseInt(kpiTotal.textContent || "0", 10);
      if (total === 0 && !startActivity.querySelector(".ab-empty-state")) {
        startActivity.innerHTML = "";
        const slug = window.__AB_APP?.state?.companySettings?.slug || "";
        const formUrl = slug ? `https://anfragebox.de/anfrage/index.html?slug=${slug}` : "";
        const kontoUrl = "https://anfragebox.de/konto.html";

        startActivity.appendChild(createEmptyState(
          "📭",
          "Noch keine Anfragen",
          "Betten Sie das Formular auf Ihrer Website ein. Sobald ein Kunde eine Anfrage stellt, erscheint sie hier.",
          "Embed-Code kopieren",
          () => {
            if (formUrl) {
              const code = `<iframe src="${formUrl}" width="100%" height="900" frameborder="0" style="border:none;border-radius:12px;"></iframe>`;
              navigator.clipboard.writeText(code).then(() => {
                const btn = startActivity.querySelector(".ab-empty-btn");
                if (btn) { btn.textContent = "Kopiert!"; setTimeout(() => { btn.textContent = "Embed-Code kopieren"; }, 2000); }
              }).catch(() => {
                window.open(kontoUrl, "_blank");
              });
            } else {
              window.open(kontoUrl, "_blank");
            }
          }
        ));
      }
    }

    // Observe KPI changes
    if (kpiTotal) {
      const observer = new MutationObserver(checkStartEmpty);
      observer.observe(kpiTotal, { childList: true, characterData: true, subtree: true });
      // Also check after initial load
      setTimeout(checkStartEmpty, 2000);
      setTimeout(checkStartEmpty, 5000);
    }

    // Patch Leads view empty state
    const leadTbody = getEl("leadTbody");
    if (leadTbody) {
      const observer2 = new MutationObserver(() => {
        const rows = leadTbody.querySelectorAll("tr");
        if (rows.length <= 1) {
          const firstCell = rows[0]?.querySelector("td");
          if (firstCell && firstCell.textContent.includes("Login nötig")) {
            // Will be updated by auth - do nothing
          } else if (rows.length === 0 || (firstCell && firstCell.textContent.trim() === "")) {
            leadTbody.innerHTML = `<tr><td colspan="5" style="padding:32px;text-align:center;">
              <div style="font-size:32px;margin-bottom:12px;opacity:.4;">📋</div>
              <div style="font-size:15px;font-weight:700;color:#111;margin-bottom:6px;">Keine Leads gefunden</div>
              <div style="font-size:13px;color:#6b7280;">Sobald ein Kunde Ihr Formular ausfüllt, erscheinen die Anfragen hier.</div>
            </td></tr>`;
          }
        }
      });
      observer2.observe(leadTbody, { childList: true, subtree: true });
    }
  });
})();