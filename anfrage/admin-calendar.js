(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const DAYS_DE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
  const MONTHS_DE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

  let calState = { year: 0, month: 0, weekStart: null, view: "month", events: [], editId: null };

  function getApp() { return window.__AB_APP || {}; }
  function getSb() { return getApp().sb || getApp().state?.sb || null; }
  function getCompanyId() { return getApp().companyId || getApp().state?.companyId || null; }
  function getRows() { return getApp().state?.rows || []; }
  function showNotice(m, t) { if (getApp().showNotice) getApp().showNotice(m, t); }
  function esc(v) { return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

  function ymd(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function parseDate(s) { if (!s) return null; const d = new Date(s); return isNaN(d.getTime()) ? null : d; }

  function getPayload(row) { const p = row?.payload; if (!p) return {}; if (typeof p === "object") return p; try { return JSON.parse(p); } catch { return {}; } }
  function customerName(row) { const p = getPayload(row); return String(row?.customer_name || p.customer_name || p.customer?.name || "").trim() || "Ohne Name"; }
  function customerPhone(row) { const p = getPayload(row); return String(row?.customer_phone || p.customer_phone || p.customer?.phone || "").trim(); }

  function getBookedLeadsAsEvents() {
    const rows = getRows();
    const events = [];
    for (const r of rows) {
      const st = String(r.status || "").toLowerCase();
      if (!st.includes("gebucht") && !st.includes("angebot gesendet") && !st.includes("bearbeitung")) continue;
      const p = getPayload(r);
      const md = r.move_date || p.move_date || "";
      if (!md) continue;
      const d = parseDate(md);
      if (!d) continue;
      const name = customerName(r);
      const phone = customerPhone(r);
      const isBooked = st.includes("gebucht");
      events.push({
        id: "lead_" + r.id,
        lead_id: r.id,
        title: name,
        date: ymd(d),
        time_start: "",
        time_end: "",
        notes: phone ? "Tel: " + phone : "",
        color: isBooked ? "#047857" : "#0369a1",
        isLead: true,
        status: r.status
      });
    }
    return events;
  }

  async function loadCalendarEvents(yearMonth) {
    const sb = getSb(); const cid = getCompanyId();
    if (!sb || !cid) return [];
    const startDate = yearMonth + "-01";
    const endD = new Date(parseInt(yearMonth.split("-")[0]), parseInt(yearMonth.split("-")[1]), 0);
    const endDate = ymd(endD);
    try {
      const { data, error } = await sb.from("calendar_events").select("*").eq("company_id", cid).gte("event_date", startDate).lte("event_date", endDate).order("event_date");
      if (error) { console.error("Cal load error:", error); return []; }
      return (data || []).map(e => ({
        id: e.id,
        title: e.title || "",
        date: String(e.event_date || "").slice(0, 10),
        time_start: e.time_start || "",
        time_end: e.time_end || "",
        notes: e.notes || "",
        color: e.color || "#047857",
        lead_id: e.lead_id || null,
        isLead: false
      }));
    } catch (err) { console.error("Cal load error:", err); return []; }
  }

  async function saveCalendarEvent(evt) {
    const sb = getSb(); const cid = getCompanyId();
    if (!sb || !cid) { showNotice("Nicht verbunden.", "err"); return false; }
    const row = {
      company_id: cid,
      title: String(evt.title || "").trim(),
      event_date: evt.date,
      time_start: evt.time_start || "",
      time_end: evt.time_end || "",
      notes: evt.notes || "",
      color: evt.color || "#047857",
      lead_id: evt.lead_id || null,
      updated_at: new Date().toISOString()
    };
    if (!row.title) { showNotice("Titel fehlt.", "err"); return false; }
    if (!row.event_date) { showNotice("Datum fehlt.", "err"); return false; }
    try {
      if (evt.id && !String(evt.id).startsWith("lead_")) {
        const { error } = await sb.from("calendar_events").update(row).eq("id", evt.id);
        if (error) { showNotice("Fehler: " + (error.message || error), "err"); return false; }
      } else {
        const { error } = await sb.from("calendar_events").insert(row);
        if (error) { showNotice("Fehler: " + (error.message || error), "err"); return false; }
      }
    } catch (err) { showNotice("Fehler: " + (err.message || err), "err"); return false; }
    showNotice("Termin gespeichert.", "ok");
    return true;
  }

  async function deleteCalendarEvent(id) {
    const sb = getSb();
    if (!sb || !id || String(id).startsWith("lead_")) return false;
    if (!confirm("Termin wirklich löschen?")) return false;
    try {
      const { error } = await sb.from("calendar_events").delete().eq("id", id);
      if (error) { showNotice("Fehler: " + (error.message || error), "err"); return false; }
    } catch (err) { showNotice("Fehler: " + (err.message || err), "err"); return false; }
    showNotice("Termin gelöscht.", "ok");
    return true;
  }

  // ── Render Month ──
  function renderMonth() {
    const grid = $("calGrid"); if (!grid) return;
    const y = calState.year, m = calState.month;
    const first = new Date(y, m, 1);
    const lastDay = new Date(y, m + 1, 0).getDate();
    let startDow = first.getDay(); if (startDow === 0) startDow = 7; startDow--;

    const today = ymd(new Date());
    const events = calState.events;
    const eventsByDate = {};
    for (const ev of events) {
      if (!eventsByDate[ev.date]) eventsByDate[ev.date] = [];
      eventsByDate[ev.date].push(ev);
    }

    let html = '<div style="display:grid;grid-template-columns:repeat(7,1fr);border-bottom:1px solid var(--line,#e5e7eb);">';
    for (const d of DAYS_DE) html += `<div style="padding:10px 8px;text-align:center;font-size:11px;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--line,#e5e7eb);">${d}</div>`;
    html += '</div>';

    html += '<div style="display:grid;grid-template-columns:repeat(7,1fr);">';
    for (let i = 0; i < startDow; i++) html += '<div style="min-height:100px;border-right:1px solid #f1f5f9;border-bottom:1px solid #f1f5f9;background:#fafbfc;"></div>';

    for (let day = 1; day <= lastDay; day++) {
      const dateStr = y + "-" + String(m + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0");
      const isToday = dateStr === today;
      const dayEvents = eventsByDate[dateStr] || [];

      html += `<div style="min-height:100px;border-right:1px solid #f1f5f9;border-bottom:1px solid #f1f5f9;padding:4px;cursor:pointer;${isToday ? "background:#f0fdf4;" : ""}" data-date="${dateStr}" class="calDayCell">`;
      html += `<div style="font-size:12px;font-weight:${isToday ? "900" : "700"};color:${isToday ? "#047857" : "#374151"};padding:2px 6px;${isToday ? "background:#dcfce7;border-radius:999px;display:inline-block;" : ""}">${day}</div>`;

      for (const ev of dayEvents.slice(0, 4)) {
        const time = ev.time_start ? ev.time_start + " " : "";
        html += `<div style="margin-top:2px;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700;color:#fff;background:${esc(ev.color)};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;" data-event-id="${esc(String(ev.id))}" class="calEventPill">${esc(time + ev.title)}</div>`;
      }
      if (dayEvents.length > 4) html += `<div style="font-size:10px;color:#64748b;padding:2px 6px;">+${dayEvents.length - 4} mehr</div>`;

      html += '</div>';
    }

    const totalCells = startDow + lastDay;
    const remaining = (7 - (totalCells % 7)) % 7;
    for (let i = 0; i < remaining; i++) html += '<div style="min-height:100px;border-right:1px solid #f1f5f9;border-bottom:1px solid #f1f5f9;background:#fafbfc;"></div>';
    html += '</div>';

    grid.innerHTML = html;

    // Wire clicks
    grid.querySelectorAll(".calDayCell").forEach(cell => {
      cell.addEventListener("click", (e) => {
        if (e.target.closest(".calEventPill")) return;
        const date = cell.dataset.date || "";
        if (date) openEventModal(null, date);
      });
    });
    grid.querySelectorAll(".calEventPill").forEach(pill => {
      pill.addEventListener("click", (e) => {
        e.stopPropagation();
        const evId = pill.dataset.eventId || "";
        const ev = calState.events.find(x => String(x.id) === evId);
        if (ev) openEventModal(ev, ev.date);
      });
    });
  }

  // ── Render Week ──
  function renderWeek() {
    const grid = $("calGrid"); if (!grid) return;
    const ws = calState.weekStart;
    const today = ymd(new Date());
    const events = calState.events;
    const eventsByDate = {};
    for (const ev of events) {
      if (!eventsByDate[ev.date]) eventsByDate[ev.date] = [];
      eventsByDate[ev.date].push(ev);
    }

    let html = '<div style="display:grid;grid-template-columns:repeat(7,1fr);">';
    for (let i = 0; i < 7; i++) {
      const d = new Date(ws); d.setDate(ws.getDate() + i);
      const dateStr = ymd(d);
      const isToday = dateStr === today;
      const dayEvents = eventsByDate[dateStr] || [];
      const dayLabel = DAYS_DE[i] + " " + d.getDate() + "." + (d.getMonth() + 1) + ".";

      html += `<div style="min-height:400px;border-right:1px solid #f1f5f9;padding:0;cursor:pointer;" data-date="${dateStr}" class="calDayCell">`;
      html += `<div style="padding:10px 8px;text-align:center;font-size:12px;font-weight:800;border-bottom:1px solid var(--line,#e5e7eb);${isToday ? "background:#f0fdf4;color:#047857;" : "color:#374151;"}">${dayLabel}</div>`;
      html += '<div style="padding:4px;">';

      for (const ev of dayEvents) {
        const time = ev.time_start ? ev.time_start + (ev.time_end ? " - " + ev.time_end : "") + " " : "";
        html += `<div style="margin-bottom:4px;padding:6px 8px;border-radius:6px;font-size:11px;font-weight:700;color:#fff;background:${esc(ev.color)};cursor:pointer;line-height:1.4;" data-event-id="${esc(String(ev.id))}" class="calEventPill">`;
        if (time) html += `<div style="font-size:10px;opacity:.85;">${esc(time)}</div>`;
        html += `<div>${esc(ev.title)}</div>`;
        if (ev.notes) html += `<div style="font-size:9px;opacity:.75;margin-top:2px;">${esc(ev.notes)}</div>`;
        if (ev.isLead && ev.status) html += `<div style="font-size:9px;opacity:.75;margin-top:1px;">${esc(ev.status)}</div>`;
        html += '</div>';
      }

      html += '</div></div>';
    }
    html += '</div>';

    grid.innerHTML = html;

    grid.querySelectorAll(".calDayCell").forEach(cell => {
      cell.addEventListener("click", (e) => {
        if (e.target.closest(".calEventPill")) return;
        const date = cell.dataset.date || "";
        if (date) openEventModal(null, date);
      });
    });
    grid.querySelectorAll(".calEventPill").forEach(pill => {
      pill.addEventListener("click", (e) => {
        e.stopPropagation();
        const evId = pill.dataset.eventId || "";
        const ev = calState.events.find(x => String(x.id) === evId);
        if (ev) {
          if (ev.isLead && ev.lead_id) {
            // Open lead in admin
            if (getApp().openLead) getApp().openLead(ev.lead_id);
            if (getApp().navigate) getApp().navigate("leads");
          } else {
            openEventModal(ev, ev.date);
          }
        }
      });
    });
  }

  // ── Event Modal ──
  function openEventModal(ev, date) {
    const modal = $("calEventModal"); if (!modal) return;
    const isEdit = ev && !ev.isLead;
    const isLead = ev && ev.isLead;

    $("calEventModalTitle").textContent = isLead ? "Umzug (aus Lead)" : (isEdit ? "Termin bearbeiten" : "Neuer Termin");
    $("calEvTitle").value = ev ? ev.title : "";
    $("calEvDate").value = ev ? ev.date : (date || "");
    $("calEvTimeStart").value = ev ? ev.time_start : "";
    $("calEvTimeEnd").value = ev ? ev.time_end : "";
    $("calEvNotes").value = ev ? ev.notes : "";
    $("calEvColor").value = ev ? ev.color : "#047857";

    calState.editId = ev ? ev.id : null;

    const btnSave = $("btnCalEventSave");
    const btnDel = $("btnCalEventDelete");
    if (isLead) {
      btnSave.style.display = "none";
      btnDel.style.display = "none";
      $("calEvTitle").disabled = true;
      $("calEvDate").disabled = true;
    } else {
      btnSave.style.display = "";
      btnDel.style.display = isEdit ? "" : "none";
      $("calEvTitle").disabled = false;
      $("calEvDate").disabled = false;
    }

    modal.classList.add("show");
  }

  function closeEventModal() {
    const modal = $("calEventModal"); if (modal) modal.classList.remove("show");
    calState.editId = null;
  }

  // ── Navigation ──
  function setTitle() {
    const el = $("calTitle"); if (!el) return;
    if (calState.view === "month") {
      el.textContent = MONTHS_DE[calState.month] + " " + calState.year;
    } else {
      const ws = calState.weekStart;
      const we = new Date(ws); we.setDate(ws.getDate() + 6);
      el.textContent = ws.getDate() + "." + (ws.getMonth() + 1) + ". - " + we.getDate() + "." + (we.getMonth() + 1) + "." + we.getFullYear();
    }
  }

  function getMonday(d) {
    const dt = new Date(d);
    const day = dt.getDay();
    const diff = dt.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(dt.setDate(diff));
  }

  async function loadAndRender() {
    const ym = calState.year + "-" + String(calState.month + 1).padStart(2, "0");
    let dbEvents = [];
    try { dbEvents = await loadCalendarEvents(ym); } catch (e) { console.error("Cal DB load:", e); showNotice("Kalender laden fehlgeschlagen.","err"); }
    const leadEvents = getBookedLeadsAsEvents();

    // For week view, also load adjacent months if needed
    if (calState.view === "week" && calState.weekStart) {
      const wsMonth = calState.weekStart.getMonth();
      const weMonth = new Date(calState.weekStart.getTime() + 6 * 86400000).getMonth();
      if (wsMonth !== calState.month || weMonth !== calState.month) {
        // Load adjacent month too
        const adjMonth = wsMonth !== calState.month ? wsMonth : weMonth;
        const adjYear = calState.weekStart.getFullYear();
        const ym2 = adjYear + "-" + String(adjMonth + 1).padStart(2, "0");
        try {
          const extra = await loadCalendarEvents(ym2);
          dbEvents = [...dbEvents, ...extra];
        } catch (e) { console.error("Cal adj load:", e); }
      }
    }

    calState.events = [...leadEvents, ...dbEvents];
    setTitle();
    if (calState.view === "month") renderMonth();
    else renderWeek();
    updateViewButtons();
  }

  function updateViewButtons() {
    const bm = $("calViewMonth"); const bw = $("calViewWeek");
    if (bm) bm.style.fontWeight = calState.view === "month" ? "900" : "500";
    if (bw) bw.style.fontWeight = calState.view === "week" ? "900" : "500";
  }

  function goPrev() {
    if (calState.view === "month") {
      calState.month--;
      if (calState.month < 0) { calState.month = 11; calState.year--; }
    } else {
      calState.weekStart.setDate(calState.weekStart.getDate() - 7);
      calState.year = calState.weekStart.getFullYear();
      calState.month = calState.weekStart.getMonth();
    }
    loadAndRender();
  }

  function goNext() {
    if (calState.view === "month") {
      calState.month++;
      if (calState.month > 11) { calState.month = 0; calState.year++; }
    } else {
      calState.weekStart.setDate(calState.weekStart.getDate() + 7);
      calState.year = calState.weekStart.getFullYear();
      calState.month = calState.weekStart.getMonth();
    }
    loadAndRender();
  }

  function goToday() {
    const now = new Date();
    calState.year = now.getFullYear();
    calState.month = now.getMonth();
    calState.weekStart = getMonday(now);
    loadAndRender();
  }

  function setViewMonth() { calState.view = "month"; loadAndRender(); }
  function setViewWeek() { calState.view = "week"; calState.weekStart = getMonday(new Date(calState.year, calState.month, 1)); loadAndRender(); }

  // ── Bind ──
  function bind() {
    if ($("calPrev")) $("calPrev").addEventListener("click", goPrev);
    if ($("calNext")) $("calNext").addEventListener("click", goNext);
    if ($("calToday")) $("calToday").addEventListener("click", goToday);
    if ($("calViewMonth")) $("calViewMonth").addEventListener("click", setViewMonth);
    if ($("calViewWeek")) $("calViewWeek").addEventListener("click", setViewWeek);
    if ($("calAddEvent")) $("calAddEvent").addEventListener("click", () => openEventModal(null, ymd(new Date())));
    if ($("btnCalEventClose")) $("btnCalEventClose").addEventListener("click", closeEventModal);
    if ($("calEventModal")) $("calEventModal").addEventListener("click", (e) => { if (e.target === $("calEventModal")) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("calEventModal")?.classList.contains("show")) closeEventModal(); });

    if ($("btnCalEventSave")) $("btnCalEventSave").addEventListener("click", async () => {
      const evt = {
        id: calState.editId && !String(calState.editId).startsWith("lead_") ? calState.editId : null,
        title: $("calEvTitle")?.value || "",
        date: $("calEvDate")?.value || "",
        time_start: $("calEvTimeStart")?.value || "",
        time_end: $("calEvTimeEnd")?.value || "",
        notes: $("calEvNotes")?.value || "",
        color: $("calEvColor")?.value || "#047857"
      };
      try {
        const ok = await saveCalendarEvent(evt);
        if (ok) { closeEventModal(); loadAndRender(); }
      } catch (err) { showNotice("Fehler: " + (err.message || err), "err"); }
    });

    if ($("btnCalEventDelete")) $("btnCalEventDelete").addEventListener("click", async () => {
      if (!calState.editId || String(calState.editId).startsWith("lead_")) return;
      try {
        const ok = await deleteCalendarEvent(calState.editId);
        if (ok) { closeEventModal(); loadAndRender(); }
      } catch (err) { showNotice("Fehler: " + (err.message || err), "err"); }
    });
  }

  // ── Public init ──
  function initCalendar() {
    const now = new Date();
    calState.year = now.getFullYear();
    calState.month = now.getMonth();
    calState.weekStart = getMonday(now);
    calState.view = "month";
    bind();
    loadAndRender();
  }

  // Export
  window.__AB_Calendar = { init: initCalendar, refresh: loadAndRender };

  // Auto-init when DOM ready
  if (document.readyState === "loading") window.addEventListener("DOMContentLoaded", () => setTimeout(initCalendar, 500));
  else setTimeout(initCalendar, 500);
})();