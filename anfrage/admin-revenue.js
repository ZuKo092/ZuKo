/* ============================================================
   admin-revenue.js — Revenue Dashboard Module
   Hooks into existing admin flow via window.__AB_APP
   Convention: IIFE, "use strict", expose via window
   ============================================================ */
(() => {
  "use strict";

  // ── Config ──
  const REV_STATUSES = ["Gebucht", "Abgeschlossen"];
  const revState = { range: 30 };

  // ── DOM refs (created in admin.html) ──
  const revEls = {
    kpiRevenue: document.getElementById("kpiRevenue"),
    kpiUmzuege: document.getElementById("kpiUmzuege"),
    kpiConversion: document.getElementById("kpiConversion"),
    kpiAvgDeal: document.getElementById("kpiAvgDeal"),
    revTrend: document.getElementById("revTrend"),
    revTrendMeta: document.getElementById("revTrendMeta"),
    revRangeTabs: document.getElementById("revRangeTabs"),
  };

  // ── Helpers ──
  function normalizeStatus(s) {
    const raw = String(s || "").trim();
    const v = raw.toLowerCase();
    if (v.includes("gebucht")) return "Gebucht";
    if (v.includes("abgeschlossen")) return "Abgeschlossen";
    if (v.includes("bearbeitung")) return "In Bearbeitung";
    if (v.includes("angebot")) return "Angebot gesendet";
    if (v.includes("archiv")) return "Archiviert";
    return raw || "Neu";
  }

  function getPayload(row) {
    const p = row?.payload;
    if (!p) return {};
    if (typeof p === "object") return p;
    try { return JSON.parse(p); } catch { return {}; }
  }

  function getOfferPrice(row) {
    const p = getPayload(row);
    const offer = p.offer || {};
    const raw = String(offer.price || "").trim().replace(",", ".");
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function isRevenueStatus(row) {
    return REV_STATUSES.includes(normalizeStatus(row.status));
  }

  function euroShort(n) {
    if (!Number.isFinite(n) || n === 0) return "0 \u20ac";
    if (n >= 1000) {
      return n.toLocaleString("de-DE", { maximumFractionDigits: 0 }) + " \u20ac";
    }
    return n.toLocaleString("de-DE", { maximumFractionDigits: 0 }) + " \u20ac";
  }

  function getCreatedAt(row) {
    return row.created_at || row.createdAt || row.inserted_at || null;
  }

  // ── Current month boundaries ──
  function currentMonthRange() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    return { start, end };
  }

  // ── Render month KPIs ──
  function renderRevenueKPIs(rows) {
    if (!revEls.kpiRevenue) return;

    const { start, end } = currentMonthRange();
    const allRows = Array.isArray(rows) ? rows : [];

    // Month leads (all statuses, created this month)
    const monthLeads = allRows.filter(r => {
      const d = new Date(getCreatedAt(r));
      return d >= start && d <= end;
    });

    // Revenue leads: status Gebucht/Abgeschlossen, created this month, with price
    const revLeads = monthLeads.filter(r => isRevenueStatus(r) && getOfferPrice(r) > 0);

    // All Gebucht/Abgeschlossen this month (even without price)
    const umzuegeMonth = monthLeads.filter(r => isRevenueStatus(r));

    const totalRevenue = revLeads.reduce((sum, r) => sum + getOfferPrice(r), 0);
    const umzuegeCount = umzuegeMonth.length;
    const totalMonth = monthLeads.length;
    const conversionRate = totalMonth > 0 ? (umzuegeCount / totalMonth) * 100 : 0;
    const avgDeal = umzuegeCount > 0 ? totalRevenue / umzuegeCount : 0;

    revEls.kpiRevenue.textContent = euroShort(totalRevenue);
    revEls.kpiUmzuege.textContent = String(umzuegeCount);
    revEls.kpiConversion.textContent = conversionRate.toFixed(1) + "%";
    revEls.kpiAvgDeal.textContent = euroShort(avgDeal);
  }

  // ── Revenue trend (by range tabs) ──
  function buildRevenueTrendSeries(rows, rangeDays) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = [];

    for (let i = rangeDays - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      days.push({ date: d, key, revenue: 0, count: 0 });
    }

    const dayMap = new Map();
    for (const day of days) dayMap.set(day.key, day);

    for (const r of rows) {
      if (!isRevenueStatus(r)) continue;
      const price = getOfferPrice(r);
      if (price <= 0) continue;
      const created = getCreatedAt(r);
      if (!created) continue;
      const d = new Date(created);
      d.setHours(0, 0, 0, 0);
      const key = d.toISOString().slice(0, 10);
      const entry = dayMap.get(key);
      if (entry) {
        entry.revenue += price;
        entry.count += 1;
      }
    }

    return days;
  }

  function formatShortDate(date) {
    try {
      return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit" }).format(date);
    } catch { return ""; }
  }

  function renderRevenueTrend(series) {
    if (!revEls.revTrend) return;
    if (!series.length) {
      revEls.revTrend.innerHTML = '<div class="hint">Keine Daten.</div>';
      return;
    }

    const peak = Math.max(...series.map(d => d.revenue), 1);

    // Set grid columns based on range
    revEls.revTrend.style.gridTemplateColumns = `repeat(${series.length}, 1fr)`;

    revEls.revTrend.innerHTML = series.map(d => {
      const height = Math.max(6, Math.round((d.revenue / peak) * 100));
      const active = d.revenue > 0 ? " active" : "";
      const label = `${formatShortDate(d.date)}: ${euroShort(d.revenue)} (${d.count} Auftr.)`;
      return `<button type="button" class="trendBar${active}" title="${label}" aria-label="${label}"><span class="trendBarFill" style="height:${height}%"></span></button>`;
    }).join("");
  }

  function renderRevenueTrendMeta(series) {
    if (!revEls.revTrendMeta) return;
    const total = series.reduce((s, d) => s + d.revenue, 0);
    const totalCount = series.reduce((s, d) => s + d.count, 0);
    const avg = series.length ? total / series.length : 0;
    const peakRev = series.length ? Math.max(...series.map(d => d.revenue)) : 0;
    revEls.revTrendMeta.textContent =
      `Gesamt: ${euroShort(total)}. ${totalCount} Auftr\u00e4ge. \u00d8/Tag: ${euroShort(avg)}. Peak: ${euroShort(peakRev)}.`;
  }

  // ── Tab setup ──
  function setupRevRangeTabs() {
    if (!revEls.revRangeTabs) return;
    revEls.revRangeTabs.addEventListener("click", (e) => {
      const btn = e.target.closest(".tab[data-range]");
      if (!btn) return;
      const nextRange = Number(btn.dataset.range || 30);
      if (!nextRange || nextRange === revState.range) return;
      revState.range = nextRange;
      revEls.revRangeTabs.querySelectorAll(".tab").forEach(tab =>
        tab.classList.toggle("active", Number(tab.dataset.range) === nextRange)
      );
      // Re-render trend with current rows
      const app = window.__AB_APP;
      const rows = app?.state?.rows || [];
      const series = buildRevenueTrendSeries(rows, revState.range);
      renderRevenueTrend(series);
      renderRevenueTrendMeta(series);
    });
  }

  // ── Public render function ──
  function renderRevenueDashboard(rows) {
    const allRows = Array.isArray(rows) ? rows : [];
    renderRevenueKPIs(allRows);
    const series = buildRevenueTrendSeries(allRows, revState.range);
    renderRevenueTrend(series);
    renderRevenueTrendMeta(series);
  }

  // ── Hook into existing flow ──
  // The main admin JS calls renderStartDashboard(STATE.rows) at various points.
  // We monkey-patch it to also call our revenue render.
  function hookIntoApp() {
    const app = window.__AB_APP;
    if (!app) {
      // Retry until app is available
      setTimeout(hookIntoApp, 200);
      return;
    }

    // Initial render with whatever rows exist
    const rows = app.state?.rows || [];
    renderRevenueDashboard(rows);

    // Observe STATE.rows changes by patching fetchLeads callback
    // We use a MutationObserver on the startTrend element as a proxy:
    // whenever the main dashboard re-renders the trend bars, we also re-render revenue.
    const startTrend = document.getElementById("startTrend");
    if (startTrend) {
      const observer = new MutationObserver(() => {
        const currentRows = app.state?.rows || [];
        renderRevenueDashboard(currentRows);
      });
      observer.observe(startTrend, { childList: true, subtree: true });
    }

    // Also hook into explicit refreshes
    const btnRefresh = document.getElementById("btnRefresh");
    if (btnRefresh) {
      btnRefresh.addEventListener("click", () => {
        setTimeout(() => {
          const currentRows = app.state?.rows || [];
          renderRevenueDashboard(currentRows);
        }, 1500);
      });
    }
  }

  // ── Boot ──
  function boot() {
    setupRevRangeTabs();
    hookIntoApp();
  }

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  // Expose for external use
  window.__AB_Revenue = { render: renderRevenueDashboard };
})();