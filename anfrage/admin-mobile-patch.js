/* ============================================================
   AnfrageBox Admin — Mobile Patch v3
   After admin-rechnung.js
   Features: filter collapse, mobile drawer, swipe back,
             bottom nav sync, tap-to-open cards
   ============================================================ */
(function () {
  "use strict";

  var BP = 768;
  function isMob() { return window.innerWidth < BP; }
  function esc(v) { return String(v != null ? v : "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
  function $(id) { return document.getElementById(id); }
  function app() { return window.__AB_APP || {}; }

  /* ══════════════════════════════════════
     1. FILTER — always visible on mobile (search + status only)
     ══════════════════════════════════════ */
  function initFilterCollapse() {
    // Filters are now always visible via CSS, no toggle needed
  }

  /* ══════════════════════════════════════
     2. LEAD CARDS: Rewrite for mobile
        Single td per row, clean hierarchy
     ══════════════════════════════════════ */
  function patchLeadCards() {
    var tbody = $("leadTbody");
    if (!tbody) return;

    // Intercept action button clicks on mobile (capture phase)
    tbody.addEventListener("click", function (e) {
      if (!isMob()) return;
      var actBtn = e.target.closest && e.target.closest("[data-act]");
      if (actBtn) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      }
    }, true);

    // Observe tbody for new rows and rewrite on mobile
    new MutationObserver(function () {
      if (!isMob()) return;
      rewriteCards(tbody);
    }).observe(tbody, { childList: true });

    // Initial rewrite
    if (isMob() && tbody.rows.length) rewriteCards(tbody);
  }

  function rewriteCards(tbody) {
    var a = app();
    if (!a.state || !a.state.filtered) return;
    var rows = a.state.filtered;
    var trs = tbody.querySelectorAll("tr.leadRow");

    for (var i = 0; i < trs.length; i++) {
      var tr = trs[i];
      if (tr.dataset.mobDone) continue;
      tr.dataset.mobDone = "1";

      // Find matching row data
      var row = rows[i];
      if (!row) continue;

      var gp = a.getPayload || function (r) { return r.payload || {}; };
      var cn = a.customerName || function (r) { return r.customer_name || ""; };
      var ns = a.normalizeStatus || function (s) { return s || "Neu"; };
      var fd = a.formatDate || function (v) { return v || ""; };
      var ga = a.getAddr || function () { return {}; };

      var p = gp(row);
      var name = cn(row) || "Ohne Name";
      var st = ns(row.status);
      var fromA = ga(row, "from");
      var toA = ga(row, "to");
      var fromShort = [fromA.zip, fromA.city].filter(Boolean).join(" ");
      var toShort = [toA.zip, toA.city].filter(Boolean).join(" ");
      var route = "";
      if (fromShort && toShort) route = fromShort + " > " + toShort;
      else if (fromShort || toShort) route = fromShort || toShort;

      var move = row.move_date || p.move_date || "";
      var moveText = move ? fd(move) : "";

      var stClass = statusPillClass(st);

      tr.innerHTML = '<td class="mob-card-td">' +
        '<div class="mob-card-name">' + esc(name) + '</div>' +
        (route ? '<div class="mob-card-route">' + esc(route) + '</div>' : '') +
        '<div class="mob-card-bottom">' +
          '<span class="mob-card-pill ' + stClass + '">' + esc(st) + '</span>' +
          (moveText ? '<span class="mob-card-date">' + esc(moveText) + '</span>' : '') +
        '</div>' +
      '</td>';
    }
  }

  /* ══════════════════════════════════════
     3. MOBILE DRAWER — 3 Zones
     ══════════════════════════════════════ */
  function statusPillClass(st) {
    var s = String(st || "").toLowerCase();
    if (s.includes("neu")) return "st-neu";
    if (s.includes("bearbeitung")) return "st-bearbeitung";
    if (s.includes("angebot")) return "st-angebot";
    if (s.includes("gebucht")) return "st-gebucht";
    if (s.includes("abgeschlossen")) return "st-abgeschlossen";
    if (s.includes("storno") || s.includes("cancel")) return "st-storniert";
    if (s.includes("archiv")) return "st-archiviert";
    return "st-neu";
  }

  function buildMobileDrawer(row) {
    var a = app();
    var gp = a.getPayload || function (r) { return r.payload || {}; };
    var cn = a.customerName || function (r) { return r.customer_name || ""; };
    var cp = a.customerPhone || function (r) { return r.customer_phone || ""; };
    var ce = a.customerEmail || function (r) { return r.customer_email || ""; };
    var ns = a.normalizeStatus || function (s) { return s || "Neu"; };
    var ga = a.getAddr || function () { return {}; };
    var fd = a.formatDate || function (v) { return v || ""; };

    var p = gp(row);
    var name = cn(row) || "Ohne Name";
    var phone = cp(row) || "";
    var email = ce(row) || "";
    var st = ns(row.status);
    var fromA = ga(row, "from");
    var toA = ga(row, "to");

    var fromZip = String(fromA.zip || "");
    var toZip = String(toA.zip || "");
    var routeShort = fromZip && toZip ? fromZip + " > " + toZip : "";
    if (!routeShort) {
      var fc = [fromA.zip, fromA.city].filter(Boolean).join(" ");
      var tc = [toA.zip, toA.city].filter(Boolean).join(" ");
      if (fc || tc) routeShort = (fc || "-") + " > " + (tc || "-");
    }

    var digits = String(phone).replace(/[^\d+]/g, "").replace(/^00/, "+");
    var waDigits = digits.startsWith("+") ? digits.slice(1) : digits;

    var move = row.move_date || p.move_date || "";
    var fmtMove = move ? fd(move) : "";
    var tw = p.move_time_window || "";

    var offer = p.offer || {};
    var offerPrice = offer.price || "";

    var statusList = ["Neu", "In Bearbeitung", "Angebot gesendet", "Gebucht", "Abgeschlossen", "Archiviert"];
    var statusOpts = statusList.map(function (x) {
      return "<option " + (x === st ? "selected" : "") + ">" + esc(x) + "</option>";
    }).join("");

    var h = "";

    // ── ZONE 1 ──
    h += '<div class="mob-drawer-header">';
    // Top bar: back + edit
    h += '<div class="mob-drawer-top-bar">';
    h += '<button class="mob-back-btn" id="mob_close" type="button"><svg viewBox="0 0 24 24"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>Zurück</button>';
    h += '<button class="mob-edit-btn" id="mob_edit" type="button">Bearbeiten</button>';
    h += '</div>';
    h += '<div class="mob-name">' + esc(name) + "</div>";
    h += '<div class="mob-meta">';
    h += '<span class="mob-status-pill ' + statusPillClass(st) + '">' + esc(st) + "</span>";
    if (routeShort) h += '<span class="mob-route-short">' + esc(routeShort) + "</span>";
    if (fmtMove) h += '<span class="mob-route-short">' + esc(fmtMove) + (tw ? " (" + esc(tw) + ")" : "") + "</span>";
    h += "</div>";

    h += '<div class="mob-actions-row">';
    h += phone
      ? '<a class="mob-action-btn call-btn" href="tel:' + esc(phone) + '"><svg viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.11 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>Anrufen</a>'
      : '<span class="mob-action-btn" style="opacity:.2;pointer-events:none;">Anrufen</span>';
    h += waDigits
      ? '<a class="mob-action-btn wa-btn" href="https://api.whatsapp.com/send?phone=' + encodeURIComponent(waDigits) + '" target="_blank"><svg viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>WhatsApp</a>'
      : '<span class="mob-action-btn" style="opacity:.2;pointer-events:none;">WhatsApp</span>';
    h += email
      ? '<a class="mob-action-btn email-btn" href="mailto:' + esc(email) + '"><svg viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 6L2 7"/></svg>E-Mail</a>'
      : '<span class="mob-action-btn" style="opacity:.2;pointer-events:none;">E-Mail</span>';
    h += "</div></div>";

    // ── ZONE 2 ──
    h += '<div class="mob-drawer-quick">';

    h += '<div class="mob-quick-card"><div class="mob-qc-title">Status</div>';
    h += '<div class="mob-status-change"><select class="select" id="mob_k_status">' + statusOpts + "</select>";
    h += '<button class="btn green" id="mob_saveStatus" type="button">Speichern</button></div></div>';

    h += '<div class="mob-quick-card"><div class="mob-qc-title">Angebot</div>';
    h += '<div class="mob-offer-row"><input class="input" id="mob_offerPrice" placeholder="Preis EUR" value="' + esc(offerPrice) + '" inputmode="decimal"/>';
    h += '<button class="btn green" id="mob_btnOfferSend" type="button">Senden</button></div></div>';

    h += '<div class="mob-quick-card"><div class="mob-qc-title">Kundenportal</div>';
    h += '<div class="mob-portal-status" id="mob_portalStatus"><span class="mob-ps-label" style="color:#9ca3af;">Laden...</span></div></div>';

    h += "</div>";

    // ── ZONE 3 ──
    h += '<div class="mob-drawer-details">';

    // Route
    var fl1 = [fromA.street, fromA.no].filter(Boolean).join(" ");
    var fl2 = [fromA.zip, fromA.city].filter(Boolean).join(" ");
    var tl1 = [toA.street, toA.no].filter(Boolean).join(" ");
    var tl2 = [toA.zip, toA.city].filter(Boolean).join(" ");
    h += '<details class="mob-acc"><summary>Route</summary><div class="mob-acc-body">';
    h += '<div style="font-weight:800;margin-bottom:2px;color:var(--brand-dark);">Beladestelle</div>';
    h += "<div>" + esc(fl1 || "-") + "</div><div>" + esc(fl2 || "") + "</div>";
    var pd = p.pickup_details;
    if (pd) { var pp = [pd.housingType, pd.floor ? "Etage " + pd.floor : "", pd.elevator, pd.areaM2 ? pd.areaM2 + " m2" : ""].filter(Boolean); if (pp.length) h += '<div style="font-size:11px;color:var(--text-4);margin-top:2px;">' + esc(pp.join(" / ")) + "</div>"; }
    h += '<div style="height:12px;"></div>';
    h += '<div style="font-weight:800;margin-bottom:2px;color:var(--brand-dark);">Entladestelle</div>';
    h += "<div>" + esc(tl1 || "-") + "</div><div>" + esc(tl2 || "") + "</div>";
    var dd = p.dropoff_details;
    if (dd) { var dp = [dd.housingType, dd.floor ? "Etage " + dd.floor : "", dd.elevator, dd.areaM2 ? dd.areaM2 + " m2" : ""].filter(Boolean); if (dp.length) h += '<div style="font-size:11px;color:var(--text-4);margin-top:2px;">' + esc(dp.join(" / ")) + "</div>"; }
    h += "</div></details>";

    // Inventar
    h += '<details class="mob-acc"><summary>Inventar</summary><div class="mob-acc-body" id="mob_inv">';
    var rooms = p.selected_rooms || []; var items = p.room_items || {}; var qty = p.room_item_quantities || {};
    var roomSet = new Set();
    (Array.isArray(rooms) ? rooms : []).forEach(function (r) { if (r) roomSet.add(String(r)); });
    Object.keys(items).forEach(function (r) { if (r) roomSet.add(String(r)); });
    var invH = "";
    roomSet.forEach(function (room) {
      var list = Array.isArray(items[room]) ? items[room] : [];
      if (!list.length) return;
      invH += '<div class="invRoom"><div class="invRoomTitle">' + esc(room) + "</div>";
      list.forEach(function (it) {
        var q = Math.max(1, Number((qty[room] && qty[room][it]) || 1));
        invH += '<div class="invLine"><div class="invQty">' + q + 'x</div><div class="invName">' + esc(it) + "</div></div>";
      });
      invH += "</div>";
    });
    h += invH || '<span style="color:var(--text-4);">Kein Inventar.</span>';
    h += "</div></details>";

    // Kartons
    h += '<details class="mob-acc"><summary>Kartons</summary><div class="mob-acc-body">';
    var br = p.box_request || p.boxes || null;
    if (br && typeof br === "object") {
      var bi = br.items || br; var cp2 = [];
      if (bi.small) cp2.push("Small: " + bi.small);
      if (bi.medium) cp2.push("Medium: " + bi.medium);
      if (bi.large) cp2.push("Large: " + bi.large);
      h += cp2.length ? cp2.map(function (x) { return '<span style="display:inline-block;padding:3px 10px;border-radius:8px;background:var(--bg-subtle);font-size:12px;font-weight:700;margin:2px;">' + esc(x) + "</span>"; }).join("") : '<span style="color:var(--text-4);">Keine.</span>';
      if (br.notes) h += '<div style="margin-top:6px;font-size:12px;color:var(--text-3);">' + esc(br.notes) + "</div>";
    } else { h += '<span style="color:var(--text-4);">Keine Kartons.</span>'; }
    h += "</div></details>";

    // Fotos
    h += '<details class="mob-acc"><summary>Kundenfotos</summary>';
    h += '<div class="mob-acc-body" id="mob_photos"><span style="color:var(--text-4);">Laden...</span></div></details>';

    // Timeline
    h += '<details class="mob-acc"><summary>Aktivitaten</summary>';
    h += '<div class="mob-acc-body" id="mob_timeline"><span style="color:var(--text-4);">Laden...</span></div></details>';

    // Delete
    h += '<div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--line);">';
    h += '<button class="btn" id="mob_delete" type="button" style="width:100%;color:#dc2626;border-color:#fecaca;font-weight:800;height:44px;">Lead loschen</button>';
    h += "</div></div>";

    return h;
  }

  function patchDrawer() {
    var body = $("drawerBody");
    if (!body) return;
    new MutationObserver(function () {
      if (!isMob()) return;
      if (body.querySelector(".mob-drawer-wrapper")) return;
      var a = app();
      var row = a.state && a.state.rows ? a.state.rows.find(function (r) { return String(r.id) === String(a.state.selectedId); }) : null;
      if (!row) return;

      var w = document.createElement("div");
      w.className = "mob-drawer-wrapper";
      w.innerHTML = buildMobileDrawer(row);
      body.appendChild(w);
      bindDrawerEvents();
      syncAsync();
    }).observe(body, { childList: true });
  }

  function bindDrawerEvents() {
    // Close / back
    var mc = $("mob_close");
    if (mc) mc.addEventListener("click", function () {
      var d = $("leadDrawer");
      if (d) { d.classList.remove("show"); document.body.classList.remove("noScroll"); d.setAttribute("aria-hidden", "true"); }
    });

    // Edit
    var me = $("mob_edit");
    if (me) me.addEventListener("click", function () {
      var a = app();
      if (typeof a.openEditModalForSelected === "function") a.openEditModalForSelected();
    });

    // Status
    var ms = $("mob_k_status"), msb = $("mob_saveStatus");
    if (ms && msb) msb.addEventListener("click", function () {
      var d = $("k_status");
      if (d) { d.value = ms.value; d.dispatchEvent(new Event("change")); }
    });

    var mp = $("mob_offerPrice"), mob = $("mob_btnOfferSend");
    if (mp && mob) mob.addEventListener("click", function () {
      var dp = $("offerPrice"); if (dp) dp.value = mp.value;
      var ds = $("btnOfferSend"); if (ds) ds.click();
    });

    var md = $("mob_delete");
    if (md) md.addEventListener("click", function () {
      if (!confirm("Lead wirklich loschen?")) return;
      var a = app();
      if (a.state && a.state.selectedId && a.sb) {
        a.sb.from("leads").delete().eq("id", a.state.selectedId).then(function (res) {
          if (res.error) { a.showNotice("Fehler: " + res.error.message, "err"); return; }
          a.showNotice("Geloscht.", "ok");
          if (a.fetchLeads) a.fetchLeads();
          var dr = $("leadDrawer");
          if (dr) { dr.classList.remove("show"); document.body.classList.remove("noScroll"); }
        });
      }
    });
  }

  function syncAsync() {
    mirror("portalCardStatus", "mob_portalStatus", fmtPortal);
    mirror("portalCardActions", "mob_portalStatus", fmtPortal);
    mirror("leadPhotos", "mob_photos");
    mirror("leadTimeline", "mob_timeline");
  }

  function mirror(src, tgt, fn) {
    var s = $(src), t = $(tgt);
    if (!s || !t) return;
    var go = function () { if (fn) fn(); else t.innerHTML = s.innerHTML; };
    new MutationObserver(go).observe(s, { childList: true, subtree: true, characterData: true });
    if (s.innerHTML && !s.innerHTML.includes("Laden")) go();
  }

  function fmtPortal() {
    var se = $("portalCardStatus"), ae = $("portalCardActions"), m = $("mob_portalStatus");
    if (!se || !m) return;
    var dot = se.querySelector('span[style*="border-radius:50%"]');
    var lbl = se.querySelector('span[style*="font-weight:700"]');
    var dc = dot ? dot.style.background : "#6b7280";
    var lt = lbl ? lbl.textContent : "...";
    var mh = '<span class="mob-ps-label"><span class="mob-ps-dot" style="background:' + esc(dc) + ';"></span>' + esc(lt) + "</span>";
    if (ae) {
      var pdf = ae.querySelector("a.btn.green");
      if (pdf) mh += '<a class="btn green" href="' + esc(pdf.href) + '" target="_blank" style="height:36px;padding:0 14px;font-size:11px;font-weight:800;text-decoration:none;">PDF</a>';
      else {
        var rem = ae.querySelector("#btnPortalRemEmail") || ae.querySelector('a[href*="whatsapp"]');
        if (rem) {
          mh += '<button class="btn soft" id="mob_prem" type="button" style="height:36px;padding:0 14px;font-size:11px;font-weight:800;">Erinnerung</button>';
        }
      }
    }
    m.innerHTML = mh;
    var mb = $("mob_prem");
    if (mb) mb.addEventListener("click", function () {
      var dr = $("btnPortalRemEmail"); if (dr) { dr.click(); return; }
      var wa = ae ? ae.querySelector('a[href*="whatsapp"]') : null;
      if (wa) window.open(wa.href, "_blank");
    });
  }

  /* ══════════════════════════════════════
     4. SWIPE BACK
     ══════════════════════════════════════ */
  function initSwipe() {
    var panel = document.querySelector(".drawerPanel");
    if (!panel) return;
    var sx = 0, sy = 0, on = false;
    panel.addEventListener("touchstart", function (e) {
      var t = e.touches[0];
      if (t.clientX < 25) { sx = t.clientX; sy = t.clientY; on = true; }
    }, { passive: true });
    panel.addEventListener("touchmove", function (e) {
      if (!on) return;
      var t = e.touches[0], dx = t.clientX - sx, dy = Math.abs(t.clientY - sy);
      if (dx > 80 && dy < 50) {
        on = false;
        var d = $("leadDrawer");
        if (d && d.classList.contains("show")) { d.classList.remove("show"); document.body.classList.remove("noScroll"); d.setAttribute("aria-hidden", "true"); }
      }
    }, { passive: true });
    panel.addEventListener("touchend", function () { on = false; }, { passive: true });
  }

  /* ══════════════════════════════════════
     5. BOTTOM NAV SYNC
     ══════════════════════════════════════ */
  function syncNav() {
    var items = document.querySelectorAll(".mbn-item[data-mbn]");
    if (!items.length) return;
    var lv = "";
    setInterval(function () {
      var a = app(), v = a.state ? a.state.view : "";
      if (v === lv) return;
      lv = v;
      var k = v;
      // Map views to bottom nav items: leads, calendar, offer, mehr
      if (v === "portal") k = "leads";
      if (v === "start" || v === "rechnungen" || v === "settings" || v === "billing") k = "mehr";
      items.forEach(function (b) { b.classList.toggle("active", b.dataset.mbn === k); });
    }, 200);
  }

  /* ══════════════════════════════════════
     6. iOS ZOOM FIX
     ══════════════════════════════════════ */
  function fixZoom() {
    var m = document.querySelector('meta[name="viewport"]');
    if (m && !m.content.includes("maximum-scale")) {
      m.content = m.content.replace("width=device-width", "width=device-width, maximum-scale=1");
    }
  }

  /* ══════════════════════════════════════
     INIT
     ══════════════════════════════════════ */
  function init() {
    initFilterCollapse();
    patchLeadCards();
    patchDrawer();
    initSwipe();
    syncNav();
    fixZoom();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else setTimeout(init, 150);
})();