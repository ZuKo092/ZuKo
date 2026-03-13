// ============================================================
// PATCH: Mini-CRM Timeline per Lead
// Add to admin_pro JS file
// ============================================================

// ─── LOAD TIMELINE DATA ─────────────────────────────────────

async function loadLeadTimeline(leadId) {
  if (!STATE.sb || !leadId) return [];

  const events = [];

  // 1. Status history
  const { data: statusData } = await STATE.sb
    .from("lead_status_history")
    .select("id, old_status, new_status, changed_at, changed_by")
    .eq("lead_id", leadId)
    .order("changed_at", { ascending: false })
    .limit(50);

  if (Array.isArray(statusData)) {
    for (const s of statusData) {
      events.push({
        type: "status",
        date: s.changed_at,
        old: s.old_status || "",
        new: s.new_status || "",
        by: s.changed_by || null,
      });
    }
  }

  // 2. Offers sent
  const { data: offerData } = await STATE.sb
    .from("offers")
    .select("id, price_eur, sent_email_at, created_at")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (Array.isArray(offerData)) {
    for (const o of offerData) {
      events.push({
        type: "offer",
        date: o.sent_email_at || o.created_at,
        price: o.price_eur,
        offerId: o.id,
      });
    }
  }

  // 3. Follow-up emails
  const { data: followUpData } = await STATE.sb
    .from("follow_up_log")
    .select("id, follow_up_number, sent_at, recipient_email, subject, status")
    .eq("lead_id", leadId)
    .order("sent_at", { ascending: false })
    .limit(20);

  if (Array.isArray(followUpData)) {
    for (const f of followUpData) {
      events.push({
        type: "followup",
        date: f.sent_at,
        number: f.follow_up_number,
        email: f.recipient_email,
        subject: f.subject,
        success: f.status === "sent",
      });
    }
  }

  // Sort all events by date descending
  events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return events;
}

// ─── RENDER TIMELINE HTML ───────────────────────────────────

function renderTimelineHTML(events) {
  if (!events.length) {
    return '<div class="hint" style="padding:14px;">Keine Aktivitäten vorhanden.</div>';
  }

  const items = events.map((ev) => {
    const date = ev.date ? formatDT(ev.date) : "";

    if (ev.type === "status") {
      const arrow = ev.old ? `${escapeHtml(ev.old)} → ${escapeHtml(ev.new)}` : escapeHtml(ev.new);
      return `
        <div class="tlItem">
          <div class="tlDot tlDotStatus"></div>
          <div class="tlContent">
            <div class="tlTitle">Status geändert</div>
            <div class="tlDetail">${arrow}</div>
            <div class="tlTime">${escapeHtml(date)}</div>
          </div>
        </div>
      `;
    }

    if (ev.type === "offer") {
      const price = ev.price ? formatEuro(ev.price) : "";
      return `
        <div class="tlItem">
          <div class="tlDot tlDotOffer"></div>
          <div class="tlContent">
            <div class="tlTitle">Angebot gesendet</div>
            ${price ? `<div class="tlDetail">${escapeHtml(price)}</div>` : ""}
            <div class="tlTime">${escapeHtml(date)}</div>
          </div>
        </div>
      `;
    }

    if (ev.type === "followup") {
      const label = ev.success ? "Follow-Up gesendet" : "Follow-Up fehlgeschlagen";
      return `
        <div class="tlItem">
          <div class="tlDot ${ev.success ? "tlDotFollowup" : "tlDotError"}"></div>
          <div class="tlContent">
            <div class="tlTitle">${escapeHtml(label)} #${ev.number || "?"}</div>
            ${ev.email ? `<div class="tlDetail">${escapeHtml(ev.email)}</div>` : ""}
            <div class="tlTime">${escapeHtml(date)}</div>
          </div>
        </div>
      `;
    }

    return "";
  }).join("");

  return `<div class="tlList">${items}</div>`;
}

// ─── INJECT TIMELINE INTO DRAWER ────────────────────────────
//
// In drawerDetailHTML(), AFTER the kartons accordion, add:
//
//   ${wrapAcc("Aktivitäten", "Timeline", '<div id="leadTimeline" class="hint">Laden...</div>', true)}
//
// In renderDrawer(), AFTER the existing btnOfferEmail binding, add:
//
//   loadAndRenderTimeline(r.id);
//

async function loadAndRenderTimeline(leadId) {
  const container = document.getElementById("leadTimeline");
  if (!container) return;

  container.innerHTML = '<div class="hint">Laden...</div>';

  try {
    const events = await loadLeadTimeline(leadId);
    container.innerHTML = renderTimelineHTML(events);
  } catch (err) {
    console.error("Timeline load error:", err);
    container.innerHTML = '<div class="hint">Fehler beim Laden.</div>';
  }
}