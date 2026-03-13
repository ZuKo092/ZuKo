(() => {
  "use strict";

  // =========================
  // DOM + CONSTANTS
  // =========================
  const startState = { range: 30 };

  const startEls = {
    kpiTotal: document.getElementById("kpiTotal"),
    kpiNew: document.getElementById("kpiNew"),
    kpiToday: document.getElementById("kpiToday"),
    kpiVisible: document.getElementById("kpiVisible"),
    kpiHint: document.getElementById("kpiHint"),
    startTrend: document.getElementById("startTrend"),
    startTrendMeta: document.getElementById("startTrendMeta"),
    startActivityList: document.getElementById("startActivityList"),
    startRangeTabs: document.getElementById("startRangeTabs"),
  };

  const SEND_OFFER_EMAIL_URL = "/anfrage/api/send-offer-email7.php";
  const SUPABASE_URL = String(window.SUPABASE_URL || "").trim();
  const SUPABASE_ANON_KEY = String(window.SUPABASE_ANON_KEY || "").trim();
  const LOGIN_PAGE = String(window.AB_LOGIN_PAGE || "/anfrage/login/login.html");

  const STATUS_LIST = ["Neu", "In Bearbeitung", "Angebot gesendet", "Gebucht", "Abgeschlossen", "Archiviert"];
  const STORAGE = { selectedLead: "ab_admin_selected_lead" };

  const $ = (id) => document.getElementById(id);

  const UI = {
    sidebar: $("sidebar"), btnBurger: $("btnBurger"),
    navStart: $("navStart"), navLeads: $("navLeads"), navOffer: $("navOffer"), navSettings: $("navSettings"),
    viewStart: $("viewStart"), viewLeads: $("viewLeads"), viewOffer: $("viewOffer"), viewSettings: $("viewSettings"),
    pageTitle: $("pageTitle"), pageSub: $("pageSub"),
    pillConn: $("pillConn"), dotConn: $("dotConn"), connText: $("connText"),
    notice: $("notice"),
    btnRefresh: $("btnRefresh"), btnExport: $("btnExport"), btnLogout: $("btnLogout"),
    kpiTotal: $("kpiTotal"), kpiNew: $("kpiNew"), kpiToday: $("kpiToday"), kpiVisible: $("kpiVisible"), kpiHint: $("kpiHint"),
    latestLeads: $("latestLeads"), latestCount: $("latestCount"),
    qSearch: $("qSearch"), qStatus: $("qStatus"), qDate: $("qDate"), qSort: $("qSort"),
    btnReset: $("btnReset"), countHint: $("countHint"),
    leadTbody: $("leadTbody"),
    leadDrawer: $("leadDrawer"), drawerOverlay: $("drawerOverlay"), drawerBody: $("drawerBody"),
    drawerClose: $("drawerClose"),
    drawerTitle: $("drawerTitle"), drawerSub: $("drawerSub"), drawerEdit: $("drawerEdit"),
    s_company_name: $("s_company_name"), s_phone: $("s_phone"), s_email: $("s_email"),
    s_country: $("s_country"), s_street: $("s_street"), s_cityline: $("s_cityline"),
    s_tax: $("s_tax"), s_vat: $("s_vat"), s_iban: $("s_iban"), s_bic: $("s_bic"), s_footer: $("s_footer"),
    btnSaveSettings: $("btnSaveSettings"), btnResetSettings: $("btnResetSettings"), settingsHint: $("settingsHint"),
    pdfModal: $("pdfModal"), printArea: $("printArea"), btnPrint: $("btnPrint"), btnPdfClose: $("btnPdfClose"),
    contactModal: $("contactModal"), contactBody: $("contactBody"), btnContactClose: $("btnContactClose"),
    editModal: $("editModal"), editBody: $("editBody"),
    btnEditSave: $("btnEditSave"), btnEditClose: $("btnEditClose"),
    btnEditCloseBottom: $("btnEditCloseBottom"),
    startStrip: $("startStrip"), startActivityList: $("startActivityList"),
    startTrend: $("startTrend"), startTrendMeta: $("startTrendMeta"),
  };

  // =========================
  // STATE
  // =========================
  const STATE = {
    sb: null, session: null, user: null, member: null,
    companyId: null, role: null, isAdmin: false, hasAccess: false,
    realtime: null, settingsCols: null, companySettings: null, pendingLeadId: null,
    rows: [], filtered: [], selectedId: null, busy: false, view: "start",
    startLastLoadAt: 0, startCache: { rows30: [], sinceISO: "" },
  };

  const EDIT = { inv: null };

  // =========================
  // UTILITY
  // =========================
  function escapeHtml(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  }

  function debounce(fn, waitMs) {
    let t = null;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), waitMs); };
  }

  function getCompanyId() {
    if (!STATE.companyId) throw new Error("Missing STATE.companyId");
    return STATE.companyId;
  }

  function settingsStorageKey() {
    return `ab_company_settings_${STATE.companyId || "guest"}`;
  }

  function redirectToLogin() {
    const next = encodeURIComponent(window.location.pathname + window.location.search + window.location.hash);
    window.location.href = `${LOGIN_PAGE}?next=${next}&expired=1`;
  }

  function updateAppContext() {
    window.__AB_APP = window.__AB_APP || {};
    Object.assign(window.__AB_APP, {
      sb: STATE.sb, companyId: STATE.companyId, state: STATE, ui: UI,
      showNotice, getCompanySettings, openPdf, openLead, fetchLeads,
      openPdfForLead, openEditModalForSelected, saveEditModal, navigate: setActiveNav,
      getPayload, customerName, customerEmail, customerPhone, getAddr,
      normalizeStatus, escapeHtml, formatEuro, formatDT, formatDate,
    });
  }

  // =========================
  // UI HELPERS
  // =========================
  function showNotice(msg, type) {
    if (!UI.notice) return;
    UI.notice.className = "notice show " + (type === "err" ? "err" : "ok");
    UI.notice.textContent = String(msg || "");
    clearTimeout(showNotice._t);
    showNotice._t = setTimeout(() => { UI.notice.className = "notice"; UI.notice.textContent = ""; }, 2200);
  }

  function setConn(state, text) {
    if (UI.connText) UI.connText.textContent = String(text || "");
    if (!UI.pillConn || !UI.dotConn) return;
    const map = {
      connecting: { dot: "#94a3b8", ring: "rgba(148,163,184,.18)", bg: "#f8fafc", br: "#e2e8f0", fg: "#334155" },
      ok: { dot: "#16a34a", ring: "rgba(34,197,94,.12)", bg: "var(--greenSoft)", br: "#bbf7d0", fg: "#166534" },
      warn: { dot: "#f59e0b", ring: "rgba(245,158,11,.16)", bg: "#fffbeb", br: "#fde68a", fg: "#92400e" },
      err: { dot: "#dc2626", ring: "rgba(220,38,38,.16)", bg: "#fef2f2", br: "#fecaca", fg: "#991b1b" },
    };
    const c = map[state] || map.connecting;
    UI.dotConn.style.background = c.dot;
    UI.dotConn.style.boxShadow = `0 0 0 6px ${c.ring}`;
    UI.pillConn.style.background = c.bg;
    UI.pillConn.style.borderColor = c.br;
    UI.pillConn.style.color = c.fg;
  }

  function guardDemoAction(actionName = "Aktion") { return false; // demo removed



  }

  // =========================
  // DATE / FORMAT
  // =========================
  function ymd(v) { if (!v) return ""; const d = new Date(v); if (isNaN(d.getTime())) return ""; return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
  function todayKey() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
  function formatDT(v) { if (!v) return ""; const d = new Date(v); if (isNaN(d.getTime())) return String(v); return d.toLocaleString("de-DE"); }
  function formatDate(v) { if (!v) return ""; const d = new Date(v); if (isNaN(d.getTime())) return String(v); return d.toLocaleDateString("de-DE"); }
  function formatEuro(v) { const s = String(v||"").trim().replace(",","."); if (!s) return ""; const n = Number(s); if (!Number.isFinite(n)) return s; return n.toLocaleString("de-DE",{style:"currency",currency:"EUR"}); }

  function normalizeStatus(s) {
    const raw = String(s || "").trim(); const v = raw.toLowerCase();
    if (!v) return "Neu";
    if (v.includes("bearbeitung")) return "In Bearbeitung";
    if (v.includes("angebot")) return "Angebot gesendet";
    if (v.includes("gebucht")) return "Gebucht";
    if (v.includes("abgeschlossen")) return "Abgeschlossen";
    if (v.includes("archiv")) return "Archiviert";
    return STATUS_LIST.includes(raw) ? raw : "Neu";
  }

  // =========================
  // PAYLOAD HELPERS
  // =========================
  function getPayload(row) { const p = row?.payload; if (!p) return {}; if (typeof p === "object") return p; try { return JSON.parse(p); } catch { return {}; } }
  function customerName(row) { const p = getPayload(row); return String(row?.customer_name || p.customer_name || p.customer?.name || [row?.first_name,row?.last_name].filter(Boolean).join(" ").trim() || "").trim(); }
  function customerPhone(row) { const p = getPayload(row); return String(row?.customer_phone || p.customer_phone || p.customer?.phone || "").trim(); }
  function customerEmail(row) { const p = getPayload(row); return String(row?.customer_email || p.customer_email || p.customer?.email || "").trim(); }

  function getAddr(row, which) {
    const p = getPayload(row);
    const a = which === "from" ? (row?.pickup_address || p.pickup_address || p.from_address || p.from || {}) : (row?.dropoff_address || p.dropoff_address || p.to_address || p.to || {});
    return { street: a.street||a.strasse||"", no: a.number||a.nr||a.no||"", zip: a.zip||a.plz||"", city: a.city||a.ort||"", country: a.country||"" };
  }

  function addrLine(a) { const l1=[a.street,a.no].filter(Boolean).join(" ").trim(); const l2=[a.zip,a.city].filter(Boolean).join(" ").trim(); return [l1,l2,a.country].filter(Boolean).join(", "); }

  function routeText(row) {
    const f = getAddr(row,"from"), t = getAddr(row,"to");
    const from = [f.zip,f.city].filter(Boolean).join(" ").trim();
    const to = [t.zip,t.city].filter(Boolean).join(" ").trim();
    if (!from && !to) return "";
    return `${from} → ${to}`.trim();
  }

  function getSelectedRooms(row) { const p=getPayload(row); const a=row.selected_rooms||p.selected_rooms||p.rooms||[]; return Array.isArray(a)?a:[]; }
  function getRoomItems(row) { const p=getPayload(row); return row.room_items||p.room_items||p.roomItems||{}; }
  function getRoomQty(row) { const p=getPayload(row); return row.room_item_quantities||p.room_item_quantities||p.roomItemQuantities||{}; }
  function getAssembly(row) { const p=getPayload(row); return row.assembly_request||p.assembly_request||p.services||{}; }
  function getOffer(row) { const p=getPayload(row); const off=p.offer||{}; return {price:String(off.price||""),text:String(off.text||"")}; }

  function cartonsData(row) {
    const p=getPayload(row); const br=row.box_request||p.box_request||p.boxes||p.raw_payload?.boxes||null;
    if (!br||typeof br!=="object") return {small:0,medium:0,large:0,needed:false,notes:"",any:false};
    const items=br.items||br||{}; const small=Number(items.small||0)||0; const medium=Number(items.medium||0)||0; const large=Number(items.large||0)||0;
    const needed=!!br.needed; const notes=String(br.notes||br.note||"").trim(); const any=small+medium+large>0||needed||!!notes;
    return {small,medium,large,needed,notes,any};
  }

  // =========================
  // LOCAL STORAGE
  // =========================
  function readLocalSettings() { try { const r=localStorage.getItem(settingsStorageKey()); if (!r) return null; const j=JSON.parse(r); return j&&typeof j==="object"?j:null; } catch { return null; } }
  function writeLocalSettings(obj) { try { localStorage.setItem(settingsStorageKey(),JSON.stringify(obj||{})); } catch {} }
  function persistSelected(id) { try { if (!id) localStorage.removeItem(STORAGE.selectedLead); else localStorage.setItem(STORAGE.selectedLead,String(id)); } catch {} }
  function restoreSelected() { try { const v=localStorage.getItem(STORAGE.selectedLead); return v?String(v):null; } catch { return null; } }
  function getCompanySettings() { return STATE.companySettings||readLocalSettings()||{}; }

  // =========================
  // HASH ROUTING
  // =========================
  function getLeadIdFromHash() { const h=String(location.hash||"").trim(); if (!h.startsWith("#")) return null; const s=h.slice(1); if (!s.startsWith("lead=")) return null; return decodeURIComponent(s.slice(5)).trim()||null; }
  function getViewFromHash() { const h=String(location.hash||"").trim(); if (!h||h==="#") return "start"; if (h.startsWith("#lead=")) return null; const k=h.slice(1).toLowerCase(); if (["start","leads","offer","portal","calendar","rechnungen","settings"].includes(k)) return k;
 return "start"; }
  function setViewHash(view) { const v=String(view||"").trim(); if (v) history.replaceState(null,"",location.pathname+location.search+"#"+encodeURIComponent(v)); }
  function setLeadHash(id) { const v=String(id||"").trim(); if (v) history.replaceState(null,"",location.pathname+location.search+"#lead="+encodeURIComponent(v)); }

  // =========================
  // MODAL / DRAWER
  // =========================
  function openModal(el) { if (el) el.classList.add("show"); }
  function closeModal(el) { if (el) el.classList.remove("show"); }
  function openDrawer() { if (!UI.leadDrawer) return; document.body.classList.add("noScroll"); UI.leadDrawer.classList.add("show"); UI.leadDrawer.setAttribute("aria-hidden","false"); }
  function closeDrawer() { if (!UI.leadDrawer) return; document.body.classList.remove("noScroll"); UI.leadDrawer.classList.remove("show"); UI.leadDrawer.setAttribute("aria-hidden","true"); }
  function selectedRow() { return STATE.rows.find((r)=>String(r.id)===String(STATE.selectedId))||null; }

  // =========================
  // START DASHBOARD
  // =========================
  function setupStartRangeTabs() {
    if (!startEls.startRangeTabs) return;
    startEls.startRangeTabs.addEventListener("click",(e)=>{
      const btn=e.target.closest(".tab[data-range]"); if (!btn) return;
      const nextRange=Number(btn.dataset.range||30); if (!nextRange||nextRange===startState.range) return;
      startState.range=nextRange;
      startEls.startRangeTabs.querySelectorAll(".tab").forEach((tab)=>tab.classList.toggle("active",Number(tab.dataset.range)===nextRange));
      renderStartDashboard(getAllLeadsForStart());
    });
  }

  function getAllLeadsForStart() { return Array.isArray(STATE.rows)?STATE.rows:[]; }
  function getLeadCreatedAt(lead) { return lead.created_at||lead.createdAt||lead.inserted_at||lead.date_created||lead.erstellt_am||null; }
  function getLeadStatus(lead) { return String(lead.status||lead.lead_status||lead.stage||"Neu").trim(); }
  function getLeadName(lead) { return lead.name||lead.full_name||lead.kundenname||lead.customer_name||"Ohne Name"; }
  function getLeadPhone(lead) { return lead.phone||lead.telefon||lead.mobile||""; }
  function getLeadCity(lead) { return lead.to_city||lead.city||lead.ort||lead.destination_city||""; }
  function isLeadVisible(lead) { const s=getLeadStatus(lead).toLowerCase(); if (lead.deleted===true||lead.is_deleted===true||s==="archiviert") return false; return true; }
  function isSameDay(a,b) { return a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate(); }
  function formatShortDate(date) { try { return new Intl.DateTimeFormat("de-DE",{day:"2-digit",month:"2-digit"}).format(date); } catch { return ""; } }
  function formatDateTime(date) { try { return new Intl.DateTimeFormat("de-DE",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}).format(date); } catch { return ""; } }
  function getRangeDays(range) { if (range===7) return 7; if (range===90) return 90; return 30; }

  function normalizeLeadForStart(raw,index) {
    const createdRaw=getLeadCreatedAt(raw); const createdAt=createdRaw?new Date(createdRaw):null;
    return { raw, id:raw.id||raw.uuid||raw.lead_id||`lead-${index}`, name:getLeadName(raw), phone:getLeadPhone(raw), city:getLeadCity(raw), status:getLeadStatus(raw), visible:isLeadVisible(raw), createdAt, createdAtTs:createdAt?createdAt.getTime():0 };
  }

  function buildTrendSeries(leads,rangeDays) {
    const today=new Date(); today.setHours(0,0,0,0); const days=[]; const counts=new Map();
    for (let i=rangeDays-1;i>=0;i--) { const d=new Date(today); d.setDate(today.getDate()-i); const key=d.toISOString().slice(0,10); days.push({date:d,key,count:0}); counts.set(key,0); }
    for (const lead of leads) { if (!lead.createdAt) continue; const d=new Date(lead.createdAt); d.setHours(0,0,0,0); const key=d.toISOString().slice(0,10); if (counts.has(key)) counts.set(key,counts.get(key)+1); }
    for (const day of days) day.count=counts.get(day.key)||0;
    return days;
  }

  function renderTrend(series) {
    if (!startEls.startTrend) return;
    if (!series.length) { startEls.startTrend.innerHTML=`<div class="hint">Keine Daten vorhanden.</div>`; return; }
    const peak=Math.max(...series.map(d=>d.count),1);
    startEls.startTrend.innerHTML=series.map(d=>{
      const height=Math.max(10,Math.round((d.count/peak)*100)); const active=d.count>0?" active":"";
      return `<button type="button" class="trendBar${active}" title="${formatShortDate(d.date)}: ${d.count}" aria-label="${formatShortDate(d.date)}: ${d.count} Anfragen"><span class="trendBarFill" style="height:${height}%"></span></button>`;
    }).join("");
  }

  function renderTrendMeta(series) {
    if (!startEls.startTrendMeta) return;
    const total=series.reduce((s,d)=>s+d.count,0); const avg=series.length?(total/series.length):0; const peak=series.length?Math.max(...series.map(d=>d.count)):0;
    startEls.startTrendMeta.textContent=`Total: ${total}. Ø/Tag: ${avg.toFixed(1)}. Peak: ${peak}.`;
  }

  function renderRecentActivity(leads) {
    if (!startEls.startActivityList) return;
    const latest=[...leads].filter(l=>l.createdAt).sort((a,b)=>b.createdAtTs-a.createdAtTs).slice(0,8);
    if (!latest.length) { startEls.startActivityList.innerHTML=`<div class="hint">Noch keine Anfragen vorhanden.</div>`; return; }
    startEls.startActivityList.innerHTML=latest.map(lead=>`<button class="activityItem" type="button" data-lead-id="${lead.id}"><div class="activityMain"><div class="activityName">${escapeHtml(lead.name)}</div><div class="activityMeta"><span>${escapeHtml(lead.status)}</span>${lead.city?`<span>• ${escapeHtml(lead.city)}</span>`:""}</div></div><div class="activitySide">${lead.createdAt?formatDateTime(lead.createdAt):"-"}</div></button>`).join("");
    startEls.startActivityList.querySelectorAll(".activityItem").forEach(btn=>{ btn.addEventListener("click",()=>openLead(btn.dataset.leadId)); });
  }

  function renderStartDashboard(rawLeads) {
    const leads=(rawLeads||[]).map(normalizeLeadForStart);
    const series=buildTrendSeries(leads,getRangeDays(startState.range));
    renderTrendMeta(series); renderTrend(series); renderRecentActivity(leads);
  }

  function fmtDE(dt) { try { return new Intl.DateTimeFormat("de-DE",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}).format(dt); } catch { return dt.toISOString().slice(0,16).replace("T"," "); } }
  function relTime(iso) { const t=new Date(iso).getTime(); const diff=Math.max(0,Date.now()-t); const m=Math.floor(diff/60000); if (m<1) return "gerade eben"; if (m<60) return `vor ${m} Min`; const h=Math.floor(m/60); if (h<24) return `vor ${h} Std`; return `vor ${Math.floor(h/24)} Tg`; }
  function leadTitleMini(row) { const p=getPayload(row); return p.customer_name||p.customer?.name||customerName(row)||"Unbekannt"; }
  function leadRouteMini(row) { const p=getPayload(row); const a=p.pickup_address||row.pickup_address||{}; const b=p.dropoff_address||row.dropoff_address||{}; const left=[a.zip,a.city].filter(Boolean).join(" "); const right=[b.zip,b.city].filter(Boolean).join(" "); return left&&right?`${left} → ${right}`:routeText(row)||"—"; }

  function renderStartStrip(rows) {
    if (!UI.startStrip) return;
    UI.startStrip.innerHTML=rows.map(r=>`<div class="stripItem" data-id="${escapeHtml(String(r.id))}"><div class="stripTop"><div class="stripName">${escapeHtml(leadTitleMini(r))}</div><div class="stripTime">${escapeHtml(relTime(r.created_at))}</div></div><div class="stripRoute">${escapeHtml(leadRouteMini(r))}</div><div class="stripTime" style="margin-top:6px;">${escapeHtml(fmtDE(new Date(r.created_at)))}</div></div>`).join("")||`<div class="hint">Keine Anfragen.</div>`;
    UI.startStrip.querySelectorAll(".stripItem").forEach(el=>{ el.addEventListener("click",()=>openLead(String(el.dataset.id||""))); });
  }

  function renderStartActivity(rows) {
    if (!UI.startActivityList) return;
    UI.startActivityList.innerHTML=rows.map(r=>`<div class="actRow" data-id="${escapeHtml(String(r.id))}"><div class="actLeft"><div class="actTitle">${escapeHtml(leadTitleMini(r))}</div><div class="actSub">${escapeHtml(leadRouteMini(r))}</div></div><div class="actRight">${escapeHtml(relTime(r.created_at))}</div></div>`).join("")||"";
    UI.startActivityList.querySelectorAll(".actRow").forEach(el=>{ el.addEventListener("click",()=>openLead(String(el.dataset.id||""))); });
  }

  function renderStartTrend(rows,since) {
    if (!UI.startTrend) return;
    const days=30; const counts=Array.from({length:days},()=>0);
    for (const r of rows) { const t=new Date(r.created_at); const idx=Math.floor((t.setHours(0,0,0,0)-since.getTime())/86400000); if (idx>=0&&idx<days) counts[idx]++; }
    const max=Math.max(1,...counts); const total=counts.reduce((a,b)=>a+b,0); const avg=Math.round((total/days)*10)/10;
    if (UI.startTrendMeta) UI.startTrendMeta.textContent=`Total: ${total}. Ø/Tag: ${avg}. Peak: ${max}.`;
    UI.startTrend.innerHTML=counts.map(c=>{ const h=Math.max(6,Math.round((c/max)*100)); return `<div class="trendBar ${c>0?"on":""}" style="height:${h}%"></div>`; }).join("");
  }

  async function loadStartSmart(force) {
    if (!STATE.sb||!STATE.user||!STATE.hasAccess||!UI.startStrip||!UI.startTrend) return;
    const now=Date.now(); if (!force&&now-STATE.startLastLoadAt<15000) return; STATE.startLastLoadAt=now;
    try {
      const since=new Date(); since.setDate(since.getDate()-29); since.setHours(0,0,0,0);
      const {data,error}=await STATE.sb.from("leads").select("id,created_at,status,payload,pickup_address,dropoff_address").eq("company_id",getCompanyId()).gte("created_at",since.toISOString()).order("created_at",{ascending:false}).limit(800);
      if (error) { console.error("loadStartSmart error:",error); return; }
      const rows=Array.isArray(data)?data:[];
      renderStartStrip(rows.slice(0,8)); renderStartActivity(rows.slice(0,6)); renderStartTrend(rows,since);
      STATE.startCache={rows30:rows,sinceISO:since.toISOString()};
    } catch (err) { console.error("loadStartSmart error:",err); showNotice("Dashboard laden fehlgeschlagen.","err"); }
  }

  // =========================
  // EMAIL MODAL
  // =========================
  function injectEmailModal() {
    if (document.getElementById("emailModal")) return;
    const modal=document.createElement("div"); modal.className="modal"; modal.id="emailModal"; modal.setAttribute("aria-hidden","true");
    modal.innerHTML=`<div class="modalCard" style="max-width:680px;"><div class="modalHead"><h3>Angebot per E-Mail senden</h3><div class="row"><button class="btn green" id="btnEmailSend" type="button">Senden</button><button class="btn" id="btnEmailClose" type="button">Schließen</button></div></div><div style="padding:18px;"><div class="field" style="margin-top:0;"><label for="email_to">Empfänger E-Mail</label><input class="input" id="email_to" placeholder="kunde@beispiel.de"/></div><div class="field"><label for="email_name">Empfänger Name</label><input class="input" id="email_name" placeholder="Max Mustermann"/></div><div class="field"><label for="email_subject">Betreff</label><input class="input" id="email_subject" value="Ihr Umzugsangebot"/></div><div class="field"><label for="email_body">Nachricht (optional)</label><textarea class="textarea" id="email_body" rows="6" style="min-height:140px;" placeholder="Guten Tag..."></textarea></div><div class="emailStatusBar" id="emailStatusBar" style="display:none;margin-top:14px;padding:12px 14px;border-radius:14px;font-size:13px;font-weight:900;"></div></div></div>`;
    document.body.appendChild(modal);
    document.getElementById("btnEmailClose").addEventListener("click",()=>closeModal(modal));
    document.getElementById("btnEmailSend").addEventListener("click",()=>executeSendOfferEmail());
    modal.addEventListener("click",(e)=>{ if (e.target===modal) { e.preventDefault(); e.stopImmediatePropagation(); } },true);
    document.addEventListener("keydown",(e)=>{ if (e.key==="Escape"&&modal.classList.contains("show")) closeModal(modal); });
  }

  function openSendEmailModal(leadId) {
    const row=STATE.rows.find(r=>String(r.id)===String(leadId));
    if (!row) { showNotice("Lead nicht gefunden.","err"); return; }
    injectEmailModal();
    const settings=getCompanySettings(); const brandName=settings.company_name||"Firma";
    const emailTo=$("email_to"), emailName=$("email_name"), emailSubject=$("email_subject"), emailBody=$("email_body"), statusBar=$("emailStatusBar");
    if (emailTo) emailTo.value=customerEmail(row)||"";
    if (emailName) emailName.value=customerName(row)||"";
    if (emailSubject) emailSubject.value="Ihr Umzugsangebot — "+brandName;
    if (emailBody) emailBody.value="";
    if (statusBar) { statusBar.style.display="none"; statusBar.textContent=""; }
    const btnSend=$("btnEmailSend"); if (btnSend) { btnSend.disabled=false; btnSend.textContent="Senden"; }
    openModal($("emailModal"));
  }

  async function executeSendOfferEmail() {
    const row=selectedRow(); if (!row) { showNotice("Kein Lead ausgewählt.","err"); return; }
    if (guardDemoAction("Email senden")) return;
    const emailTo=$("email_to"), emailName=$("email_name"), emailSubject=$("email_subject"), emailBody=$("email_body"), btnSend=$("btnEmailSend");
    const recipientEmail=String(emailTo?.value||"").trim(), recipientName=String(emailName?.value||"").trim(), subject=String(emailSubject?.value||"").trim(), body=String(emailBody?.value||"").trim();
    if (!recipientEmail||!recipientEmail.includes("@")) { showEmailStatus("Bitte gültige E-Mail eingeben.","err"); return; }
    const offer=getOffer(row);
    if (btnSend) { btnSend.disabled=true; btnSend.textContent="Sende..."; }
    showEmailStatus("E-Mail wird gesendet...","loading");
    try {
      const token=STATE.session?.access_token||"";
      if (!token) { showEmailStatus("Nicht eingeloggt.","err"); if (btnSend) { btnSend.disabled=false; btnSend.textContent="Senden"; } return; }
      const payload={ lead_id:String(row.id), company_id:getCompanyId(), recipient_email:recipientEmail, recipient_name:recipientName, subject:subject||"Ihr Umzugsangebot", price_eur:String(offer.price||""), offer_text:String(offer.text||""), email_body:body };
      const res=await fetch(SEND_OFFER_EMAIL_URL,{ method:"POST", headers:{"Content-Type":"application/json","Authorization":"Bearer "+token}, body:JSON.stringify(payload) });
      const result=await res.json();
      if (!res.ok||!result.ok) { showEmailStatus("Fehler: "+(result.error||"Unbekannter Fehler"),"err"); if (btnSend) { btnSend.disabled=false; btnSend.textContent="Senden"; } return; }
      showEmailStatus("E-Mail erfolgreich gesendet an "+recipientEmail,"ok"); showNotice("Angebot per E-Mail gesendet.","ok");
      if (btnSend) { btnSend.disabled=true; btnSend.textContent="Gesendet ✓"; }
      const idx=STATE.rows.findIndex(x=>String(x.id)===String(row.id)); if (idx>=0) STATE.rows[idx].status="Angebot gesendet";
      applyFilters(); renderList(); renderKPIs(); renderLatest(); renderStartDashboard(STATE.rows);
      setTimeout(()=>renderDrawer(),500); setTimeout(()=>closeModal($("emailModal")),2000);
    } catch (err) { console.error("sendOfferEmail error:",err); showEmailStatus("Netzwerkfehler: "+(err.message||err),"err"); if (btnSend) { btnSend.disabled=false; btnSend.textContent="Senden"; } }
  }

  function showEmailStatus(msg,type) {
    const bar=$("emailStatusBar"); if (!bar) return; bar.style.display="block"; bar.textContent=msg;
    if (type==="ok") { bar.style.background="var(--green-soft,#ecfdf3)"; bar.style.border="1px solid #bbf7d0"; bar.style.color="#166534"; }
    else if (type==="err") { bar.style.background="#fef2f2"; bar.style.border="1px solid #fecaca"; bar.style.color="#991b1b"; }
    else { bar.style.background="#f8fafc"; bar.style.border="1px solid #e5e7eb"; bar.style.color="#334155"; }
  }

  function generatePdfHtmlForLead(row) {
    if (!row) return null; const p=getPayload(row);
    const fromRaw=p.pickup_address||p.from_address||p.from||row.pickup_address||{};
    const toRaw=p.dropoff_address||p.to_address||p.to||row.dropoff_address||{};
    const roomItems=getRoomItems(row)||{}; const selectedRooms=Array.isArray(getSelectedRooms(row))?getSelectedRooms(row):[];
    const mergedRooms=Array.from(new Set([...selectedRooms.map(String),...Object.keys(roomItems).map(String)])).filter(Boolean);
    return buildLeadPdfHtml({
      from:{street:fromRaw.street||fromRaw.strasse||"",no:fromRaw.number||fromRaw.nr||fromRaw.no||"",zip:fromRaw.zip||fromRaw.plz||"",city:fromRaw.city||fromRaw.ort||"",floor:fromRaw.floor||"",lift:fromRaw.lift||fromRaw.aufzug||""},
      to:{street:toRaw.street||toRaw.strasse||"",no:toRaw.number||toRaw.nr||toRaw.no||"",zip:toRaw.zip||toRaw.plz||"",city:toRaw.city||toRaw.ort||"",floor:toRaw.floor||"",lift:toRaw.lift||toRaw.aufzug||""},
      customer:{name:customerName(row)||"",phone:customerPhone(row)||"",email:customerEmail(row)||""},
      move_date:row.move_date||p.move_date||"", price:String(getOffer(row).price||""), text:String(getOffer(row).text||""), status:normalizeStatus(row.status),
      inv:{rooms:mergedRooms,items:roomItems,qty:getRoomQty(row)||{},svc:getAssembly(row)||{}},
    });
  }

  // =========================
  // LOGO UPLOAD
  // =========================
  async function handleLogoUpload(file) {
    if (!file) return;
    if (!STATE.sb||!STATE.companyId||!STATE.isAdmin) { showNotice("Nur Admin darf Logo hochladen.","err"); return; }
    if (guardDemoAction("Logo hochladen")) return;
    const validTypes=["image/png","image/jpeg","image/webp","image/svg+xml"];
    if (!validTypes.includes(file.type)) { showNotice("Nur PNG, JPG, WebP oder SVG erlaubt.","err"); return; }
    if (file.size>2*1024*1024) { showNotice("Logo darf max. 2 MB groß sein.","err"); return; }
    const logoHint=$("logoHint"); if (logoHint) logoHint.textContent="Hochladen...";
    try {
      const ext=file.name.split(".").pop().toLowerCase()||"png";
      const filePath=`${STATE.companyId}/logo.${ext}`;
      const {error}=await STATE.sb.storage.from("logos").upload(filePath,file,{cacheControl:"3600",upsert:true});
      if (error) { showNotice("Upload fehlgeschlagen: "+(error.message||error),"err"); if (logoHint) logoHint.textContent="Upload fehlgeschlagen."; return; }
      const {data:urlData}=STATE.sb.storage.from("logos").getPublicUrl(filePath);
      const publicUrl=urlData?.publicUrl||""; if (!publicUrl) { showNotice("URL konnte nicht erstellt werden.","err"); return; }
      const logoUrl=publicUrl+"?v="+Date.now();
      const {error:updateError}=await STATE.sb.from("company_settings").update({logo_url:logoUrl}).eq("company_id",STATE.companyId);
      if (updateError) { showNotice("Logo URL speichern fehlgeschlagen.","err"); return; }
      if (STATE.companySettings) STATE.companySettings.logo_url=logoUrl; writeLocalSettings(STATE.companySettings);
      const preview=$("logoPreview"); if (preview) { preview.src=logoUrl; preview.style.display="block"; }
      if (logoHint) logoHint.textContent="Logo gespeichert."; showNotice("Logo hochgeladen.","ok");
    } catch (err) { showNotice("Upload Fehler: "+(err.message||err),"err"); if (logoHint) logoHint.textContent="Fehler."; }
  }

  async function removeLogo() {
    if (!STATE.sb||!STATE.companyId||!STATE.isAdmin) return;
    if (guardDemoAction("Logo entfernen")) return;
    const logoHint=$("logoHint"); if (logoHint) logoHint.textContent="Entferne...";
    try {
      const {error}=await STATE.sb.from("company_settings").update({logo_url:"/img/logo1-umzug.png"}).eq("company_id",STATE.companyId);
      if (error) { showNotice("Logo entfernen fehlgeschlagen.","err"); return; }
      if (STATE.companySettings) STATE.companySettings.logo_url="/img/logo1-umzug.png"; writeLocalSettings(STATE.companySettings);
      const preview=$("logoPreview"); if (preview) preview.src="/img/logo1-umzug.png";
      if (logoHint) logoHint.textContent="Logo entfernt."; showNotice("Logo entfernt.","ok");
    } catch (err) { showNotice("Fehler: "+(err.message||err),"err"); }
  }

  function initLogoPreview() {
    const preview=$("logoPreview"); if (!preview) return;
    const settings=getCompanySettings(); preview.src=settings.logo_url||"/img/logo1-umzug.png"; preview.style.display="block";
  }

  // =========================
  // TIMELINE
  // =========================
  async function loadLeadTimeline(leadId) {
    if (!STATE.sb||!leadId) return [];
    try {
      const events=[];
      const {data:statusData}=await STATE.sb.from("lead_status_history").select("id,old_status,new_status,changed_at,changed_by").eq("lead_id",leadId).order("changed_at",{ascending:false}).limit(50);
      if (Array.isArray(statusData)) for (const s of statusData) events.push({type:"status",date:s.changed_at,old:s.old_status||"",new:s.new_status||"",by:s.changed_by||null});
      const {data:offerData}=await STATE.sb.from("offers").select("id,price_eur,sent_email_at,created_at").eq("lead_id",leadId).order("created_at",{ascending:false}).limit(20);
      if (Array.isArray(offerData)) for (const o of offerData) events.push({type:"offer",date:o.sent_email_at||o.created_at,price:o.price_eur});
      const {data:followUpData}=await STATE.sb.from("follow_up_log").select("id,follow_up_number,sent_at,recipient_email,subject,status").eq("lead_id",leadId).order("sent_at",{ascending:false}).limit(20);
      if (Array.isArray(followUpData)) for (const f of followUpData) events.push({type:"followup",date:f.sent_at,number:f.follow_up_number,email:f.recipient_email,success:f.status==="sent"});
      events.sort((a,b)=>new Date(b.date).getTime()-new Date(a.date).getTime());
      return events;
    } catch (err) { console.error("loadLeadTimeline error:",err); return []; }
  }

  function renderTimelineHTML(events) {
    if (!events.length) return '<div class="hint" style="padding:14px;">Keine Aktivitäten vorhanden.</div>';
    return `<div class="tlList">${events.map(ev=>{
      const date=ev.date?formatDT(ev.date):"";
      if (ev.type==="status") { const arrow=ev.old?`${escapeHtml(ev.old)} → ${escapeHtml(ev.new)}`:escapeHtml(ev.new); return `<div class="tlItem"><div class="tlDot tlDotStatus"></div><div class="tlContent"><div class="tlTitle">Status geändert</div><div class="tlDetail">${arrow}</div><div class="tlTime">${escapeHtml(date)}</div></div></div>`; }
     if (ev.type==="offer") { const price=ev.price?formatEuro(ev.price):""; const offerLabel=price?"Angebot gesendet":"Foto-Erinnerung gesendet"; return `<div class="tlItem"><div class="tlDot tlDotOffer"></div><div class="tlContent"><div class="tlTitle">${escapeHtml(offerLabel)}</div>${price?`<div class="tlDetail">${escapeHtml(price)}</div>`:""}<div class="tlTime">${escapeHtml(date)}</div></div></div>`; }
      if (ev.type==="followup") { const label=ev.success?"Follow-Up gesendet":"Follow-Up fehlgeschlagen"; return `<div class="tlItem"><div class="tlDot ${ev.success?"tlDotFollowup":"tlDotError"}"></div><div class="tlContent"><div class="tlTitle">${escapeHtml(label)} #${ev.number||"?"}</div>${ev.email?`<div class="tlDetail">${escapeHtml(ev.email)}</div>`:""}<div class="tlTime">${escapeHtml(date)}</div></div></div>`; }
      return "";
    }).join("")}</div>`;
  }

  async function loadAndRenderTimeline(leadId) {
    const container=$("leadTimeline"); if (!container) return;
    container.innerHTML='<div class="hint">Laden...</div>';
    try { const events=await loadLeadTimeline(leadId); container.innerHTML=renderTimelineHTML(events); }
    catch (err) { console.error("Timeline load error:",err); container.innerHTML='<div class="hint">Fehler beim Laden.</div>'; }
  }

  async function loadLeadPhotos(leadId) {
    const el=$("leadPhotos"); if (!el||!STATE.sb) return;
    el.innerHTML='<div class="hint">Laden...</div>';
    let data=null,error=null;
    try { ({data,error}=await STATE.sb.from("portal_uploads").select("id,file_name,file_url,file_type,uploaded_at").eq("lead_id",leadId).order("uploaded_at",{ascending:false})); } catch(err) { console.error("loadLeadPhotos error:",err); error=err; }
    if (error||!data?.length) {
      // No photos: show reminder buttons
      const row=selectedRow(); const p=row?getPayload(row):{};
      const email=customerEmail(row)||""; const phone=customerPhone(row)||"";
      const name=customerName(row)||"Kunde";
      let html='<div style="text-align:center;padding:12px 0;">';
      html+='<div class="hint" style="margin-bottom:10px;">Keine Fotos vom Kunden.</div>';
      html+='<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">';
const photoReminderKey="ab_photo_reminder_"+leadId; const lastPhotoReminder=localStorage.getItem(photoReminderKey); if (lastPhotoReminder) { const sentDate=new Date(Number(lastPhotoReminder)); html+=`<div class="hint" style="margin-bottom:6px;font-size:11px;">Erinnerung gesendet: ${sentDate.toLocaleString("de-DE")}</div>`; }
      if (email) html+=`<button class="btn" id="btnPhotoReminderEmail" type="button" style="height:34px;font-size:12px;">Erinnerung per Email</button>`;
       if (phone) { const digits=String(phone).replace(/[^\\d+]/g,"").replace(/^00/,"+"); const waPhone=digits.startsWith("+")?digits.replace(/[^\\d]/g,""):digits.replace(/[^\\d]/g,""); html+=`<a class="btn" href="https://api.whatsapp.com/send?phone=${encodeURIComponent(waPhone)}&text=${encodeURIComponent("Hallo "+name+", bitte laden Sie Fotos Ihrer Möbel hoch, damit wir Ihnen einen Preis berechnen können. Vielen Dank!")}" target="_blank" style="height:34px;font-size:12px;text-decoration:none;">Erinnerung per WhatsApp</a>`; }
      html+='</div></div>';
      el.innerHTML=html;
      const btnRemEmail=$("btnPhotoReminderEmail");
      if (btnRemEmail) btnRemEmail.addEventListener("click",()=>sendPhotoReminder(leadId));
      return;
    }
    const imgs=data.filter(f=>f.file_type&&f.file_type.startsWith("image/"));
    const others=data.filter(f=>!f.file_type||!f.file_type.startsWith("image/"));
    let html='';
    if (imgs.length) { html+=`<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px;">`; for (const img of imgs) { html+=`<a href="${escapeHtml(img.file_url)}" target="_blank" style="display:block;border:1px solid var(--line);border-radius:8px;overflow:hidden;aspect-ratio:1;"><img src="${escapeHtml(img.file_url)}" alt="${escapeHtml(img.file_name)}" style="width:100%;height:100%;object-fit:cover;" /></a>`; } html+=`</div>`; }
    if (others.length) { html+=`<div style="margin-top:8px;display:grid;gap:4px;">`; for (const f of others) { html+=`<a href="${escapeHtml(f.file_url)}" target="_blank" style="display:flex;align-items:center;gap:8px;padding:8px;border:1px solid var(--line);border-radius:6px;font-size:13px;font-weight:500;color:var(--brand);">${escapeHtml(f.file_name)}</a>`; } html+=`</div>`; }
    html+=`<div class="hint" style="margin-top:6px;">${data.length} Datei${data.length!==1?"en":""} vom Kunden hochgeladen.</div>`;
    el.innerHTML=html;
  }

 async function sendPhotoReminder(leadId) {
    if (!STATE.sb||!STATE.companyId) return;
    const row=selectedRow(); if (!row) return;
    const email=customerEmail(row); if (!email) { showNotice("Keine E-Mail.","err"); return; }
    const name=customerName(row)||"Kunde";
    const reminderKey="ab_photo_reminder_"+leadId;
    const lastSent=localStorage.getItem(reminderKey);
    if (lastSent) { const ago=Date.now()-Number(lastSent); const agoMin=Math.round(ago/60000); const agoText=agoMin<60?agoMin+" Min":Math.round(agoMin/60)+" Std"; if (!confirm("Erinnerung wurde bereits vor "+agoText+" gesendet. Trotzdem erneut senden?")) return; }
    const settings=getCompanySettings(); const brand=settings.company_name||"Umzugsunternehmen";
    // Get portal URL
    let portalUrl="";
    try {
      const {data:tk}=await STATE.sb.from("portal_tokens").select("token").eq("lead_id",leadId).eq("company_id",STATE.companyId).eq("is_active",true).maybeSingle();
      if (tk?.token) portalUrl=`${window.location.origin}/portal/${tk.token}`;
    } catch(err) { console.error("Portal token lookup error:",err); }
    if (!portalUrl) { try { const url=await createPortalLink(leadId); portalUrl=url||""; } catch(err) { console.error("Create portal link error:",err); } }
    // Send via send-offer-email endpoint with custom body
    const token=STATE.session?.access_token||"";
    if (!token) { showNotice("Nicht eingeloggt.","err"); return; }
    const btn=$("btnPhotoReminderEmail"); if (btn) { btn.disabled=true; btn.textContent="Sende..."; }
    try {
      const res=await fetch("/anfrage/api/send-photo-reminder.php",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+token},body:JSON.stringify({lead_id:leadId,company_id:STATE.companyId,recipient_email:email,recipient_name:name,portal_url:portalUrl||""})});
      const result=await res.json();
  if (result.ok) { showNotice("Erinnerung gesendet an "+email,"ok"); try { localStorage.setItem(reminderKey,String(Date.now())); } catch {} }
       else { showNotice("Fehler: "+(result.error||""),"err"); }
    } catch(err) { showNotice("Fehler: "+err.message,"err"); }
    if (btn) { btn.disabled=false; btn.textContent="Erinnerung per Email"; }
  }

  // =========================
  // COMPANY FLAGS
  // =========================
  async function loadCompanyFlags() {
    // Demo mode removed - all accounts have full access
  }

  // =========================
  // SETTINGS
  // =========================
  function applySettingsToForm(s) {
    const x=s||{};
    if (UI.s_company_name) UI.s_company_name.value=x.company_name||"";
    if (UI.s_phone) UI.s_phone.value=x.phone||"";
    if (UI.s_email) UI.s_email.value=x.email||"";
    if (UI.s_country) UI.s_country.value=x.country||"Deutschland";
    if (UI.s_street) UI.s_street.value=x.street||"";
    if (UI.s_cityline) UI.s_cityline.value=x.cityline||"";
    if (UI.s_tax) UI.s_tax.value=x.tax_number||"";
    if (UI.s_vat) UI.s_vat.value=x.vat_id||"";
    if (UI.s_iban) UI.s_iban.value=x.iban||"";
    if (UI.s_bic) UI.s_bic.value=x.bic||"";
    if (UI.s_footer) UI.s_footer.value=x.footer||"";
    const sKlein=$("s_kleinunternehmer"); if (sKlein) sKlein.checked=!!(x.is_kleinunternehmer||x.kleinunternehmer);
    const sPayDays=$("s_payment_days"); if (sPayDays) sPayDays.value=String(x.payment_days||14);
  }

  function collectSettingsFromForm() {
    const sKlein=$("s_kleinunternehmer"); const sPayDays=$("s_payment_days");
    return { company_id:getCompanyId(), company_name:String(UI.s_company_name?.value||"").trim(), phone:String(UI.s_phone?.value||"").trim(), email:String(UI.s_email?.value||"").trim(), country:String(UI.s_country?.value||"Deutschland").trim(), street:String(UI.s_street?.value||"").trim(), cityline:String(UI.s_cityline?.value||"").trim(), tax_number:String(UI.s_tax?.value||"").trim(), vat_id:String(UI.s_vat?.value||"").trim(), iban:String(UI.s_iban?.value||"").trim(), bic:String(UI.s_bic?.value||"").trim(), footer:String(UI.s_footer?.value||"").trim(), is_kleinunternehmer:sKlein?!!sKlein.checked:false, payment_days:sPayDays?Math.max(1,Math.min(90,parseInt(sPayDays.value||"14",10)||14)):14 };
  }

  async function loadSettings() {
    const local=readLocalSettings();
    if (local) { STATE.companySettings=local; applySettingsToForm(local); if (UI.settingsHint) UI.settingsHint.textContent="Geladen (lokal)."; }
    if (!STATE.sb||!STATE.user||!STATE.hasAccess) return;
    const {data,error}=await STATE.sb.from("company_settings").select("*").eq("company_id",getCompanyId()).maybeSingle();
    if (error) { if (UI.settingsHint) UI.settingsHint.textContent="Lokale Daten. Supabase Fehler."; return; }
    if (!data) return;
    STATE.settingsCols=new Set(Object.keys(data)); STATE.companySettings=data; writeLocalSettings(data); applySettingsToForm(data);
    if (UI.settingsHint) UI.settingsHint.textContent="Geladen (Supabase).";
  initLogoPreview();
  }

  // =========================
  // DOUBLE-CLICK GUARD
  // =========================
  const _savingLock = {};
  function acquireLock(key) { if (_savingLock[key]) return false; _savingLock[key] = true; return true; }
  function releaseLock(key) { _savingLock[key] = false; }

  async function saveSettings() {
    if (!acquireLock("saveSettings")) return;
    try {
    if (guardDemoAction("Speichern")) return;
    const raw=collectSettingsFromForm(); writeLocalSettings(raw); STATE.companySettings=raw;
    if (!STATE.sb||!STATE.user||!STATE.hasAccess) { if (UI.settingsHint) UI.settingsHint.textContent="Gespeichert (lokal)."; showNotice("Gespeichert (lokal).","ok"); return; }
    if (!STATE.isAdmin) { showNotice("Nur Admin darf Settings speichern.","err"); return; }
    const cols=STATE.settingsCols; const s={company_id:getCompanyId()};
    const put=(k,v)=>{ if (!cols||cols.has(k)) s[k]=v; };
    put("company_name",raw.company_name); put("phone",raw.phone); put("email",raw.email); put("country",raw.country); put("street",raw.street); put("cityline",raw.cityline); put("tax_number",raw.tax_number); put("vat_id",raw.vat_id); put("iban",raw.iban); put("bic",raw.bic); put("footer",raw.footer); put("is_kleinunternehmer",raw.is_kleinunternehmer); put("payment_days",raw.payment_days);
    if (UI.settingsHint) UI.settingsHint.textContent="Speichere...";
    const {data,error}=await STATE.sb.from("company_settings").upsert(s,{onConflict:"company_id"}).select("*").single();
    if (error) { showNotice("Supabase Fehler: "+(error.message||error),"err"); return; }
    STATE.companySettings=data||raw; STATE.settingsCols=data?new Set(Object.keys(data)):cols; writeLocalSettings(STATE.companySettings);
    if (UI.settingsHint) UI.settingsHint.textContent="Gespeichert (Supabase)."; showNotice("Settings gespeichert.","ok");
    } finally { releaseLock("saveSettings"); }
  }

  // =========================
  // FOLLOW-UP
  // =========================
  const FOLLOW_UP_DEFAULTS = { enabled:false, delay_days_1:2, delay_days_2:5, max_follow_ups:2, email_subject_1:"Erinnerung: Ihr Umzugsangebot", email_subject_2:"Letzte Erinnerung: Ihr Umzugsangebot", email_body_1:"", email_body_2:"" };

  async function loadFollowUpRules() {
    if (!STATE.sb||!STATE.companyId) return;
    const {data,error}=await STATE.sb.from("follow_up_rules").select("*").eq("company_id",STATE.companyId).maybeSingle();
    if (error) { console.error("loadFollowUpRules error:",error); return; }
    applyFollowUpToForm(data||FOLLOW_UP_DEFAULTS);
  }

  function applyFollowUpToForm(rules) {
    const r=rules||FOLLOW_UP_DEFAULTS; const el=(id)=>document.getElementById(id);
    if (el("fu_enabled")) el("fu_enabled").checked=!!r.enabled;
    if (el("fu_delay1")) el("fu_delay1").value=String(r.delay_days_1||2);
    if (el("fu_delay2")) el("fu_delay2").value=String(r.delay_days_2||5);
    if (el("fu_max")) el("fu_max").value=String(r.max_follow_ups||2);
    if (el("fu_subject1")) el("fu_subject1").value=r.email_subject_1||"";
    if (el("fu_subject2")) el("fu_subject2").value=r.email_subject_2||"";
    if (el("fu_body1")) el("fu_body1").value=r.email_body_1||"";
    if (el("fu_body2")) el("fu_body2").value=r.email_body_2||"";
  }

  async function saveFollowUpRules() {
    if (guardDemoAction("Follow-Up speichern")) return;
    if (!STATE.sb||!STATE.companyId||!STATE.isAdmin) { showNotice("Nur Admin darf Follow-Up konfigurieren.","err"); return; }
    const el=(id)=>document.getElementById(id);
    const rules={ company_id:STATE.companyId, enabled:!!el("fu_enabled")?.checked, delay_days_1:Math.max(1,parseInt(el("fu_delay1")?.value||"2",10)||2), delay_days_2:Math.max(1,parseInt(el("fu_delay2")?.value||"5",10)||5), max_follow_ups:Math.min(2,Math.max(1,parseInt(el("fu_max")?.value||"2",10)||2)), email_subject_1:String(el("fu_subject1")?.value||"").trim()||"Erinnerung: Ihr Umzugsangebot", email_subject_2:String(el("fu_subject2")?.value||"").trim()||"Letzte Erinnerung: Ihr Umzugsangebot", email_body_1:String(el("fu_body1")?.value||"").trim(), email_body_2:String(el("fu_body2")?.value||"").trim(), eligible_statuses:["Neu","In Bearbeitung","Angebot gesendet"], updated_at:new Date().toISOString() };
    const {error}=await STATE.sb.from("follow_up_rules").upsert(rules,{onConflict:"company_id"});
    if (error) { showNotice("Follow-Up speichern fehlgeschlagen: "+(error.message||error),"err"); return; }
    showNotice("Follow-Up Einstellungen gespeichert.","ok"); await loadFollowUpRules();
  }

  // =========================
  // ACCESS + ROLE
  // =========================
  async function loadMembership() {
    if (!STATE.sb||!STATE.user?.id) throw new Error("Missing auth user");
    const {data,error}=await STATE.sb.from("company_users").select("id,user_id,company_id,role,is_active,mfa_required").eq("user_id",STATE.user.id).eq("is_active",true).limit(1).maybeSingle();
    if (error) throw error; if (!data) throw new Error("No active membership");
    STATE.member=data; STATE.companyId=data.company_id; STATE.role=String(data.role||"staff").toLowerCase(); STATE.isAdmin=STATE.role==="admin"||STATE.role==="owner"; STATE.hasAccess=!!STATE.companyId;
    updateAppContext(); return data;
  }

  async function checkAccessAndRole() {
    try { const member=await loadMembership(); await loadCompanyFlags(); return !!member; }
    catch (err) { console.error("checkAccessAndRole failed:",err); STATE.member=null; STATE.companyId=null; STATE.role=null; STATE.isAdmin=false; STATE.hasAccess=false; updateAppContext(); return false; }
  }

  function applyRoleToUI() {
    if (UI.navSettings) UI.navSettings.style.display=STATE.isAdmin?"":"none";
    // drawerDelete now in drawer body, visibility handled in renderDrawer
  }

  function applyDemoMode() {
    // Demo mode removed
  }

  // =========================
  // REALTIME (with auto-reconnect)
  // =========================
  let _rtRetryCount = 0;
  let _rtRetryTimer = null;
  let _rtHealthTimer = null;
  const RT_MAX_RETRIES = 50;
  const RT_BASE_DELAY = 1500;
  const RT_MAX_DELAY = 30000;
  const RT_HEALTH_INTERVAL = 15000;

  function teardownRealtime() {
    clearTimeout(_rtRetryTimer); _rtRetryTimer = null;
    clearInterval(_rtHealthTimer); _rtHealthTimer = null;
    try { if (STATE.realtime && STATE.sb) STATE.sb.removeChannel(STATE.realtime); } catch {}
    STATE.realtime = null;
  }

  function _scheduleRealtimeRetry() {
    if (_rtRetryCount >= RT_MAX_RETRIES) {
      setConn("err", "Verbindung verloren");
      showNotice("Realtime getrennt. Bitte Seite neu laden.", "err");
      return;
    }
    _rtRetryCount++;
    const delay = Math.min(RT_BASE_DELAY * Math.pow(1.5, _rtRetryCount - 1), RT_MAX_DELAY);
    setConn("connecting", "Reconnect " + _rtRetryCount + "...");
    clearTimeout(_rtRetryTimer);
    _rtRetryTimer = setTimeout(() => {
      if (!STATE.sb || !STATE.user || !STATE.hasAccess) return;
      setupRealtime();
    }, delay);
  }

  function _startHealthCheck() {
    clearInterval(_rtHealthTimer);
    _rtHealthTimer = setInterval(() => {
      if (!STATE.realtime) { _scheduleRealtimeRetry(); return; }
      const st = STATE.realtime.state;
      if (st === "closed" || st === "errored") {
        console.warn("RT health: channel state =", st);
        _scheduleRealtimeRetry();
      }
    }, RT_HEALTH_INTERVAL);
  }

  function setupRealtime() {
    teardownRealtime();
    if (!STATE.sb || !STATE.user || !STATE.hasAccess) return;

    const companyId = getCompanyId();
    const ch = STATE.sb.channel("ab_leads_" + companyId);

    const sortRows = () => STATE.rows.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
    const upsertRow = (row) => { if (!row || !row.id) return; const id = String(row.id); const idx = STATE.rows.findIndex(r => String(r.id) === id); if (idx >= 0) STATE.rows[idx] = row; else STATE.rows.unshift(row); sortRows(); };
    const removeRow = (oldRow) => { const id = String(oldRow?.id || ""); if (!id) return; STATE.rows = STATE.rows.filter(r => String(r.id) !== id); if (String(STATE.selectedId) === id) { STATE.selectedId = null; persistSelected(null); closeDrawer(); } };

    ch.on("postgres_changes", { event: "INSERT", schema: "public", table: "leads", filter: `company_id=eq.${companyId}` }, (payload) => { upsertRow(payload.new); applyFilters(); renderKPIs(); renderLatest(); renderStartDashboard(STATE.rows); if (STATE.view === "leads") renderList(); showNotice("Neue Anfrage: " + (customerName(payload.new) || "Unbekannt"), "ok"); });
    ch.on("postgres_changes", { event: "UPDATE", schema: "public", table: "leads", filter: `company_id=eq.${companyId}` }, (payload) => { upsertRow(payload.new); applyFilters(); renderKPIs(); renderLatest(); if (STATE.view === "leads") renderList(); if (String(STATE.selectedId) === String(payload.new?.id)) renderDrawer(); });
    ch.on("postgres_changes", { event: "DELETE", schema: "public", table: "leads", filter: `company_id=eq.${companyId}` }, (payload) => { removeRow(payload.old); applyFilters(); renderKPIs(); renderLatest(); if (STATE.view === "leads") renderList(); showNotice("Lead gelöscht.", "ok"); });

    ch.subscribe((status) => {

      if (status === "SUBSCRIBED") {
        _rtRetryCount = 0;
        setConn("ok", "Verbunden");
      } else if (status === "CLOSED") {
        setConn("warn", "Getrennt");
        _scheduleRealtimeRetry();
      } else if (status === "CHANNEL_ERROR") {
        setConn("err", "Kanalfehler");
        _scheduleRealtimeRetry();
      } else if (status === "TIMED_OUT") {
        setConn("warn", "Timeout");
        _scheduleRealtimeRetry();
      }
    });

    STATE.realtime = ch;
    _startHealthCheck();
  }

  // --- Visibility + Online handlers ---
  let _wasHidden = false;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      _wasHidden = true;
      return;
    }
    if (_wasHidden && STATE.sb && STATE.user && STATE.hasAccess) {
      _wasHidden = false;

      setupRealtime();
      fetchLeads();
    }
  });

  window.addEventListener("online", () => {
    if (STATE.sb && STATE.user && STATE.hasAccess) {

      setConn("connecting", "Netz wieder da...");
      setupRealtime();
      fetchLeads();
    }
  });

  window.addEventListener("offline", () => {
    setConn("warn", "Offline");
  });

  // =========================
  // FILTERS + KPIs + LIST
  // =========================
  function applyFilters() {
    const q=String(UI.qSearch?.value||"").trim().toLowerCase(); const st=String(UI.qStatus?.value||"").trim(); const df=String(UI.qDate?.value||"").trim(); const sort=String(UI.qSort?.value||"newest").trim();
    let arr=STATE.rows.slice();
    if (st) arr=arr.filter(r=>normalizeStatus(r.status)===st);
    if (df) { const now=Date.now(); const maxAge=df==="today"?86400000:df==="7d"?604800000:2592000000; arr=arr.filter(r=>{ const t=new Date(r.created_at).getTime(); if (!Number.isFinite(t)) return false; if (df==="today") return ymd(r.created_at)===todayKey(); return now-t<=maxAge; }); }
    if (q) arr=arr.filter(r=>{ const p=getPayload(r); return [customerName(r),customerPhone(r),customerEmail(r),routeText(r),r.source,r.summary_text,p.summary_text,p.notes].filter(Boolean).join(" ").toLowerCase().includes(q); });
    arr.sort((a,b)=>{ if (sort==="name_asc") return String(customerName(a)||"").localeCompare(String(customerName(b)||""),"de"); const ta=new Date(a.created_at||0).getTime(),tb=new Date(b.created_at||0).getTime(); return sort==="oldest"?ta-tb:tb-ta; });
    STATE.filtered=arr; if (UI.countHint) UI.countHint.textContent=`${STATE.filtered.length} sichtbar`;
  }

  function renderKPIs() {
    const total=STATE.rows.length, neu=STATE.rows.filter(r=>normalizeStatus(r.status)==="Neu").length, today=STATE.rows.filter(r=>ymd(r.created_at)===todayKey()).length, visible=STATE.filtered.length;
    if (UI.kpiTotal) UI.kpiTotal.textContent=String(total); if (UI.kpiNew) UI.kpiNew.textContent=String(neu); if (UI.kpiToday) UI.kpiToday.textContent=String(today); if (UI.kpiVisible) UI.kpiVisible.textContent=String(visible);
    if (UI.kpiHint) UI.kpiHint.textContent=STATE.user&&STATE.hasAccess?`Verbunden. Rolle: ${STATE.role||"-"}`:"Login nötig, um Daten zu sehen.";
  }

  function renderLatest() {
    if (!UI.latestLeads) return;
    if (!STATE.user||!STATE.hasAccess) { UI.latestLeads.innerHTML=`<p class="hint">Keine Daten.</p>`; if (UI.latestCount) UI.latestCount.textContent="0"; return; }
    const latest=STATE.rows.slice(0,5); if (UI.latestCount) UI.latestCount.textContent=String(latest.length);
    if (!latest.length) { UI.latestLeads.innerHTML=`<p class="hint">Keine Daten.</p>`; return; }
    UI.latestLeads.innerHTML=latest.map(r=>{ const name=customerName(r)||"Ohne Name",rt=routeText(r),st=normalizeStatus(r.status); return `<div class="latestItem" data-id="${escapeHtml(String(r.id))}" style="border:1px solid var(--line);border-radius:16px;padding:12px;background:#fff;margin-top:10px;cursor:pointer;"><div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;"><div style="font-weight:1000;">${escapeHtml(name)}</div><span class="tag status">${escapeHtml(st)}</span></div>${rt?`<div class="hint" style="margin-top:8px;font-size:12px;">${escapeHtml(rt)}</div>`:""}<div class="hint" style="margin-top:6px;font-size:12px;">${escapeHtml(formatDT(r.created_at))}</div></div>`; }).join("");
    UI.latestLeads.querySelectorAll(".latestItem").forEach(el=>el.addEventListener("click",()=>openLead(String(el.dataset.id||""))));
  }

  function renderList() {
    const tbody=UI.leadTbody; if (!tbody) return; tbody.innerHTML=""; const cols=tbody.closest("table")?.querySelectorAll("thead th")?.length||6;
    if (!STATE.user) { tbody.innerHTML=`<tr><td colspan="${cols}" class="hint" style="padding:14px;">Login nötig.</td></tr>`; return; }
    if (!STATE.hasAccess) { tbody.innerHTML=`<tr><td colspan="${cols}" class="hint" style="padding:14px;">Kein Zugriff.</td></tr>`; return; }
    if (!STATE.filtered.length) { tbody.innerHTML=`<tr><td colspan="${cols}" class="hint" style="padding:14px;">Keine Leads.</td></tr>`; return; }
    const frag=document.createDocumentFragment();
    for (const r of STATE.filtered) {
      const tr=document.createElement("tr"); tr.className="leadRow"+(String(r.id)===String(STATE.selectedId)?" active":"");
      const p=getPayload(r),name=customerName(r)||"Ohne Name",st=normalizeStatus(r.status),created=r.created_at?formatDT(r.created_at):"-",phone=customerPhone(r),email=customerEmail(r),md=r.move_date||p.move_date||"",mdText=md?formatDate(md):"-",rt=routeText(r);
      tr.innerHTML=`<td><div class="tName">${escapeHtml(name)}</div><div class="tSub">${escapeHtml(phone||"")}${email?" • "+escapeHtml(email):""}</div></td>${cols>=6?`<td><div style="font-weight:1000;">${escapeHtml(rt||"-")}</div></td>`:""}<td>${escapeHtml(mdText)}</td><td><span class="pillMini pillStatus">${escapeHtml(st)}</span></td><td class="hint">${escapeHtml(created)}<td><div class="kContact">${st==="Neu"?'<button class="btn soft" data-act="contact" type="button">Kontakt</button><button class="btn" data-act="edit" type="button">Bearbeiten</button>':(st==="Gebucht"||st==="Abgeschlossen")?'<button class="btn soft" data-act="contact" type="button">Kontakt</button><button class="btn" data-act="pdf" type="button">PDF</button><button class="btn green" data-act="rechnung" type="button">Rechnung</button>':'<button class="btn soft" data-act="contact" type="button">Kontakt</button><button class="btn" data-act="pdf" type="button">PDF</button>'}</div></td>`;
      tr.addEventListener("click",(e)=>{ const actBtn=e.target?.closest?.("[data-act]"); const act=actBtn?String(actBtn.dataset.act||""):""; STATE.selectedId=r.id; persistSelected(r.id); renderList(); if (act==="pdf") { e.preventDefault(); e.stopPropagation(); openPdfForLead(r.id); return; } if (act==="rechnung") { e.preventDefault(); e.stopPropagation(); if (window.__AB_Rechnung&&typeof window.__AB_Rechnung.create==="function") { window.__AB_Rechnung.create(r.id).then(inv=>{ if (inv&&window.__AB_Rechnung.openPdf) window.__AB_Rechnung.openPdf(inv); }); } return; } if (act==="edit") { e.preventDefault(); e.stopPropagation(); STATE.selectedId=r.id; persistSelected(r.id); openEditModalForSelected(); return; } if (act==="contact") { e.preventDefault(); e.stopPropagation(); openContactModal(r); return; } renderDrawer(); openDrawer(); });
      frag.appendChild(tr);
    }
    tbody.appendChild(frag);
  }

  async function fetchLeads() {
    if (!STATE.sb||!STATE.user||!STATE.hasAccess||STATE.busy) return;
    STATE.busy=true; setConn("connecting","Lade...");
    const {data,error}=await STATE.sb.from("leads").select("*").eq("company_id",getCompanyId()).order("created_at",{ascending:false}).limit(700);
    STATE.busy=false;
    if (error) { setConn("err","Fehler"); showNotice("Leads laden fehlgeschlagen: "+(error.message||error),"err"); return; }
    STATE.rows=Array.isArray(data)?data:[]; applyFilters();
    const restored=restoreSelected();
    if (restored&&STATE.rows.some(x=>String(x.id)===String(restored))) STATE.selectedId=restored;
    else if (STATE.filtered.length) { STATE.selectedId=STATE.filtered[0].id; persistSelected(STATE.selectedId); }
    else { STATE.selectedId=null; persistSelected(null); }
    renderList(); renderKPIs(); renderLatest(); setConn("ok","Verbunden"); renderStartDashboard(STATE.rows); maybeOpenHashLead(); maybeOpenPendingLead();
  }

  // =========================
  // DRAWER
  // =========================
  function svcMark(v) { if (!v) return ""; if (v==="demontage") return "DM"; if (v==="montage") return "M"; if (v==="beides") return "DM+M"; return ""; }

  function wrapAcc(title,hint,inner,open) {
    if (!inner) return "";
    return `<details class="acc" ${open?"open":""}><summary><span>${escapeHtml(title)}</span><span class="accHint">${escapeHtml(hint||"")}</span></summary><div class="accBody">${inner}</div></details>`;
  }

  async function saveStatusForSelected(newStatus) {
    const r=selectedRow(); if (!r||!STATE.sb) return;
    const st=normalizeStatus(newStatus); const pOld=getPayload(r); const pNew=JSON.parse(JSON.stringify(pOld||{})); pNew.status=st;
    const {data,error}=await STATE.sb.from("leads").update({payload:pNew,status:st}).eq("id",r.id).select("*").single();
    if (error) { showNotice("Status speichern fehlgeschlagen: "+(error.message||error),"err"); return; }
    const idx=STATE.rows.findIndex(x=>String(x.id)===String(r.id)); if (idx>=0) STATE.rows[idx]=data;
    applyFilters(); renderList(); renderKPIs(); renderLatest(); renderStartDashboard(STATE.rows); showNotice("Status gespeichert.","ok");
  }

  async function saveOfferForSelected(price,text) {
    const r=selectedRow(); if (!r||!STATE.sb) return;
    const pOld=getPayload(r); const pNew=JSON.parse(JSON.stringify(pOld||{})); pNew.offer={price:String(price||"").trim(),text:String(text||"").trim()};
    const {data,error}=await STATE.sb.from("leads").update({payload:pNew}).eq("id",r.id).select("*").single();
    if (error) { showNotice("Angebot speichern fehlgeschlagen: "+(error.message||error),"err"); return; }
    const idx=STATE.rows.findIndex(x=>String(x.id)===String(r.id)); if (idx>=0) STATE.rows[idx]=data;
    showNotice("Angebot gespeichert.","ok");
  }

  async function deleteLead() {
    const r=selectedRow(); if (guardDemoAction("Löschen")) return; if (!r||!STATE.sb) return;
    if (!STATE.isAdmin) { showNotice("Nur Admin darf löschen.","err"); return; }
    if (!confirm("Lead wirklich löschen? Alle Portal-Daten werden ebenfalls gelöscht.")) return;
    // Cascade delete portal data first
    try { await deletePortalData(r.id,null); } catch(err) { console.warn("Portal cleanup:",err); }
    const {error}=await STATE.sb.from("leads").delete().eq("id",r.id);
    if (error) { showNotice("Löschen fehlgeschlagen: "+(error.message||error),"err"); return; }
    STATE.rows=STATE.rows.filter(x=>String(x.id)!==String(r.id)); applyFilters(); STATE.selectedId=STATE.filtered[0]?.id||null; persistSelected(STATE.selectedId);
    renderList(); renderKPIs(); renderLatest(); renderStartDashboard(STATE.rows); closeDrawer(); showNotice("Gelöscht.","ok");
  }

  function drawerDetailHTML(row) {
    const p=getPayload(row); const name=customerName(row)||"Ohne Name",phone=customerPhone(row),email=customerEmail(row),st=normalizeStatus(row.status),move=row.move_date||p.move_date||"";
    const fromA=getAddr(row,"from"),toA=getAddr(row,"to");
    const rooms=getSelectedRooms(row),items=getRoomItems(row),qty=getRoomQty(row),asm=getAssembly(row);
    const roomSet=new Set(); (Array.isArray(rooms)?rooms:[]).forEach(r=>r&&roomSet.add(String(r))); Object.keys(items||{}).forEach(r=>r&&roomSet.add(String(r)));
    const invRooms=[];
    for (const room of roomSet) { const list=Array.isArray(items?.[room])?items[room]:[]; if (!list.length) continue; const lines=list.map(it=>{ const q=Math.max(1,Number(qty?.[room]?.[it]||1)); const sv=String(asm?.[room]?.[it]||""); const m=svcMark(sv); return `<div class="invLine"><div class="invQty">${escapeHtml(String(q))}x</div><div class="invName">${escapeHtml(String(it))}${m?` <span class="invSvc">${escapeHtml(m)}</span>`:""}</div></div>`; }).join(""); invRooms.push(`<div class="invRoom"><div class="invRoomTitle">${escapeHtml(String(room))}</div>${lines}</div>`); }
    const invInner=invRooms.length?invRooms.join(""):`<div class="hint">Kein Inventar.</div>`;
    const cartons=cartonsData(row);
    const cartonsInner=`<div class="chipRow" style="margin-top:0;">${cartons.small?`<span class="tag">Small: ${escapeHtml(cartons.small)}</span>`:""}${cartons.medium?`<span class="tag">Medium: ${escapeHtml(cartons.medium)}</span>`:""}${cartons.large?`<span class="tag">Large: ${escapeHtml(cartons.large)}</span>`:""}${cartons.needed?`<span class="tag">Benötigt</span>`:""}${!cartons.any?`<span class="tag">Keine Auswahl</span>`:""}</div>${cartons.notes?`<div class="hint" style="margin-top:10px;font-size:13px;">${escapeHtml(cartons.notes)}</div>`:""}`;
    const offer=getOffer(row);
    const digits=normalizePhoneDigits(phone);
    const waPhone=digits?digits:"";

    // Hero (compact)
    const hero=`<div class="routeTitle">Route</div><div class="routeRow"><div class="routeBox">${escapeHtml(addrLine(fromA)||"Beladestelle fehlt")}</div><div class="routeArrow">→</div><div class="routeBox">${escapeHtml(addrLine(toA)||"Entladestelle fehlt")}</div></div>`;

    // Card 1: Status
    const statusCard=`<div class="miniCard"><div class="miniHead">Status</div><div class="miniBody"><div class="field" style="margin-top:0;"><label>Status</label><select class="select" id="k_status" style="min-width:0;width:100%;">${STATUS_LIST.map(x=>`<option ${x===st?"selected":""}>${escapeHtml(x)}</option>`).join("")}</select></div><div class="field"><label>Termin</label><input class="input" value="${escapeHtml(move?formatDate(move):"")}" disabled/></div><div class="field"><label>Erstellt</label><input class="input" value="${escapeHtml(formatDT(row.created_at))}" disabled/></div></div></div>`;

    // Card 2: Kontakt
    const kontaktCard=`<div class="miniCard"><div class="miniHead">Kontakt</div><div class="miniBody"><div class="field" style="margin-top:0;"><label>Name</label><input class="input" value="${escapeHtml(name)}" disabled/></div><div class="field"><label>Telefon</label><input class="input" value="${escapeHtml(phone||"-")}" disabled/></div><div class="field"><label>E-Mail</label><input class="input" value="${escapeHtml(email||"-")}" disabled/></div><div class="row" style="margin-top:8px;gap:6px;">${phone?`<a class="btn soft" href="tel:${escapeHtml(phone)}" style="font-size:12px;">Anrufen</a>`:""}<a class="btn soft" href="${waPhone?`https://api.whatsapp.com/send?phone=${encodeURIComponent(waPhone)}`:"#"}" target="_blank" style="font-size:12px;${waPhone?"":"opacity:.4;pointer-events:none;"}">WhatsApp</a>${email?`<a class="btn soft" href="mailto:${escapeHtml(email)}" style="font-size:12px;">E-Mail</a>`:""}</div></div></div>`;

    // Card 3: Angebot
    const angebotCard=`<div class="miniCard"><div class="miniHead">Angebot</div><div class="miniBody"><div class="field" style="margin-top:0;"><label>Preis brutto (EUR)</label><input class="input" id="offerPrice" value="${escapeHtml(offer.price)}" placeholder="z.B. 899"/></div><div class="field"><label>Text (optional)</label><textarea class="textarea" id="offerText" rows="2" style="min-height:64px;">${escapeHtml(offer.text)}</textarea></div><button class="btn green" id="btnOfferSend" type="button" style="width:100%;margin-top:8px;font-weight:800;">Angebot senden</button><div class="hint" style="margin-top:4px;">Speichert automatisch und sendet per E-Mail.</div></div></div>`;

    // Card 4: Portal
    const portalCard=`<div class="miniCard"><div class="miniHead">Kundenportal</div><div class="miniBody"><div id="portalCardStatus" class="hint" style="margin-top:0;">Laden...</div><div id="portalCardLink" style="margin-top:8px;"></div><div id="portalCardActions" style="margin-top:8px;"></div></div></div>`;

    return `<div class="leadLayout"><div class="leadMain">${hero}${wrapAcc("Inventar","Räume und Möbel",invInner,true)}${wrapAcc("Kartons","wenn gewählt",cartonsInner,false)}${wrapAcc("Kundenfotos","vom Portal",'<div id="leadPhotos" class="hint">Laden...</div>',true)}${wrapAcc("Aktivitäten","Timeline",'<div id="leadTimeline" class="hint">Laden...</div>',true)}</div><aside class="leadSide">${statusCard}${kontaktCard}${angebotCard}${portalCard}</aside></div>`;
  }

  function renderDrawer() {
    const r=selectedRow(); if (!r||!UI.drawerBody) return;
    if (UI.drawerTitle) UI.drawerTitle.textContent=customerName(r)||"Lead";
    if (UI.drawerSub) UI.drawerSub.textContent=routeText(r)||"";
    UI.drawerBody.innerHTML=drawerDetailHTML(r);
    loadAndRenderTimeline(r.id);
    loadLeadPhotos(r.id);
    loadPortalCard(r.id);
    const kStatus=$("k_status"); if (kStatus) kStatus.addEventListener("change",async()=>{ await saveStatusForSelected(kStatus.value); renderDrawer(); });
    const offerPrice=$("offerPrice"),offerText=$("offerText"),btnOfferSend=$("btnOfferSend");
    if (btnOfferSend) btnOfferSend.onclick=async()=>{
      const price=offerPrice?.value||"";
      if (!price.trim()) { showNotice("Bitte Preis eingeben.","err"); return; }
      // Photo check: block send if no customer photos uploaded
      btnOfferSend.disabled=true; btnOfferSend.textContent="Prüfe Fotos...";
      try {
        if (STATE.sb) {
          const {data:photos,error:photoErr}=await STATE.sb.from("portal_uploads").select("id").eq("lead_id",r.id).limit(1);
          if (!photoErr && (!photos || photos.length===0)) {
            btnOfferSend.disabled=false; btnOfferSend.textContent="Angebot senden";
            showNotice("Keine Kundenfotos vorhanden. Bitte zuerst Fotos vom Kunden anfordern.","err");
            return;
          }
        }
      } catch(err) { console.warn("Photo check failed, continuing:",err); }
      btnOfferSend.disabled=false; btnOfferSend.textContent="Angebot senden";
      await saveOfferForSelected(price,offerText?.value||"");
      const r2=selectedRow(); if (r2) openSendEmailModal(r2.id);
    };
  }

  async function loadPortalCard(leadId) {
    const statusEl=$("portalCardStatus"), linkEl=$("portalCardLink"), actEl=$("portalCardActions");
    if (!statusEl||!STATE.sb||!STATE.companyId) return;
    const {data:tk}=await STATE.sb.from("portal_tokens").select("token,created_at,is_active").eq("lead_id",leadId).eq("company_id",STATE.companyId).maybeSingle();
    if (!tk) { statusEl.innerHTML='<span class="hint">Kein Portal-Link vorhanden.</span>'; return; }
    const portalUrl=`${window.location.origin}/portal/${tk.token}`;
    const {data:sig}=await STATE.sb.from("portal_signatures").select("id,created_at").eq("lead_id",leadId).maybeSingle();
    const {data:uploads}=await STATE.sb.from("portal_uploads").select("id").eq("lead_id",leadId);
    const photoCount=uploads?.length||0;
    let statusText="Offen";
    let statusColor="#6b7280";
    if (sig) { statusText="Angenommen"; statusColor="#047857"; }
    else if (photoCount>0) { statusText=`${photoCount} Foto${photoCount!==1?"s":""} hochgeladen`; statusColor="#0369a1"; }
    statusEl.innerHTML=`<div style="display:flex;align-items:center;gap:6px;"><span style="width:8px;height:8px;border-radius:50%;background:${statusColor};"></span><span style="font-weight:700;color:${statusColor};">${escapeHtml(statusText)}</span></div>`;
    linkEl.innerHTML=`<div style="display:flex;align-items:center;gap:6px;"><input class="input" value="${escapeHtml(portalUrl)}" readonly style="font-size:12px;flex:1;"/><button class="btn soft" type="button" id="btnCopyPortal" style="font-size:11px;min-height:32px;">Kopieren</button></div>`;
    const btnCopy=$("btnCopyPortal"); if (btnCopy) btnCopy.onclick=()=>{ navigator.clipboard.writeText(portalUrl).then(()=>showNotice("Link kopiert.","ok")); };
    const row=selectedRow(); const phone=customerPhone(row); const email=customerEmail(row); const name=customerName(row)||"Kunde";
    const digits=normalizePhoneDigits(phone); const waPhone=digits||"";
    let btns='';
    if (!sig&&photoCount===0) {
      btns+=`<div style="font-size:11px;color:#6b7280;margin-bottom:4px;">Foto-Erinnerung senden:</div><div style="display:flex;gap:6px;">`;
      if (email) btns+=`<button class="btn soft" type="button" id="btnPortalRemEmail" style="font-size:11px;min-height:30px;">Per E-Mail</button>`;
      if (waPhone) btns+=`<a class="btn soft" href="https://api.whatsapp.com/send?phone=${encodeURIComponent(waPhone)}&text=${encodeURIComponent("Hallo "+name+", bitte laden Sie Fotos Ihrer Möbel hoch: "+portalUrl)}" target="_blank" style="font-size:11px;min-height:30px;text-decoration:none;">Per WhatsApp</a>`;
      btns+=`</div>`;
    }
    actEl.innerHTML=btns;
    const btnRemEmail=$("btnPortalRemEmail"); if (btnRemEmail) btnRemEmail.addEventListener("click",()=>sendPhotoReminder(leadId));
  }

  // =========================
  // CONTACT MODAL
  // =========================
  function normalizePhoneDigits(phone) { const s=String(phone||"").trim(); if (!s) return ""; let t=s.replace(/[^\d+]/g,""); if (t.startsWith("00")) t="+"+t.slice(2); if (t.startsWith("+")) return t.replace(/[^\d]/g,""); return t.replace(/[^\d]/g,""); }

  function openContactModal(row) {
    if (!UI.contactBody||!UI.contactModal) return;
    const name=customerName(row)||"Kunde",phone=customerPhone(row),email=customerEmail(row);
    const digits=normalizePhoneDigits(phone); const waLink=digits?`https://api.whatsapp.com/send?phone=${encodeURIComponent(digits)}`:""; const telLink=phone?`tel:${encodeURIComponent(phone)}`:""; const mailLink=email?`mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent("Ihr Umzugsangebot")}`:"";
    UI.contactBody.innerHTML=`<div class="card" style="box-shadow:none;"><div class="cardHead"><p class="h">${escapeHtml(name)}</p><p class="sub">${escapeHtml(phone||"")}${email?" • "+escapeHtml(email):""}</p></div><div class="cardBody"><div class="row">${waLink?`<a class="btn green" href="${waLink}" target="_blank" rel="noopener">WhatsApp</a>`:`<button class="btn" disabled type="button">WhatsApp</button>`}${telLink?`<a class="btn" href="${telLink}">Anrufen</a>`:`<button class="btn" disabled type="button">Anrufen</button>`}${mailLink?`<a class="btn soft" href="${mailLink}">E-Mail</a>`:`<button class="btn soft" disabled type="button">E-Mail</button>`}<button class="btn" id="btnContactPdf" type="button">PDF öffnen</button></div></div></div>`;
    const btnContactPdf=$("btnContactPdf"); if (btnContactPdf) btnContactPdf.onclick=()=>openPdfForLead(row.id);
    openModal(UI.contactModal);
  }

  // =========================
  // PDF
  // =========================
  function openPdf(html) { if (!UI.printArea||!UI.pdfModal) return; UI.printArea.innerHTML=html; openModal(UI.pdfModal); }

  function buildLeadPdfHtml(draft) {
    if (window.AnfrageBoxPdf && typeof window.AnfrageBoxPdf.build === "function") {
      return window.AnfrageBoxPdf.build(draft, getCompanySettings(), {});
    }
    // Fallback inline (should not be reached if unified script is loaded)
    const s=getCompanySettings();
    const brand=String(s.company_name||"Firma").trim(), companyStreet=String(s.street||"").trim(), companyCity=String(s.cityline||"").trim(), companyCountry=String(s.country||"Deutschland").trim(), companyPhone=String(s.phone||"").trim(), companyEmail=String(s.email||"").trim(), companyTax=String(s.tax_number||"").trim(), companyVat=String(s.vat_id||"").trim(), companyIban=String(s.iban||"").trim(), companyBic=String(s.bic||"").trim();
    const today=new Date(), offerDate=today.toLocaleDateString("de-DE"); const validUntilDate=new Date(today); validUntilDate.setDate(validUntilDate.getDate()+14); const validUntil=validUntilDate.toLocaleDateString("de-DE");
    const offerNo="ANG-"+today.getFullYear()+"-"+String(today.getMonth()+1).padStart(2,"0")+String(today.getDate()).padStart(2,"0")+"-"+String((draft.customer?.name||"KUNDE").replace(/\s+/g,"").slice(0,6).toUpperCase()||"KUNDE");
    const from=draft.from||{}, to=draft.to||{}, customer=draft.customer||{};
    const fromLine1=[from.street,from.no].filter(Boolean).join(" ").trim(), fromLine2=[from.zip,from.city].filter(Boolean).join(" ").trim();
    const toLine1=[to.street,to.no].filter(Boolean).join(" ").trim(), toLine2=[to.zip,to.city].filter(Boolean).join(" ").trim();
    const moveDate=String(draft.move_date||"").trim(), priceRaw=String(draft.price||"").trim().replace(",","."), priceNum=Number(priceRaw), hasPrice=Number.isFinite(priceNum);
    const gross=hasPrice?priceNum:null, vatRate=0.19, net=hasPrice?gross/(1+vatRate):null, vat=hasPrice?gross-net:null;
    const euro=(n)=>Number.isFinite(n)?n.toLocaleString("de-DE",{style:"currency",currency:"EUR"}):"—";
    const isKleinunternehmer=!!(getCompanySettings().is_kleinunternehmer||getCompanySettings().kleinunternehmer);
    const serviceRows=[]; let pos=1;
    serviceRows.push({pos:pos++,title:"Umzugsservice gemäß Objekt- und Routendaten",qty:"1",unit:hasPrice?euro(gross):"—",total:hasPrice?euro(gross):"—"});
    if (from.floor||to.floor||from.lift||to.lift) { const floorText=[from.floor?`Beladestelle Stock ${from.floor}`:"",from.lift?`Aufzug ${from.lift}`:"",to.floor?`Entladestelle Stock ${to.floor}`:"",to.lift?`Aufzug ${to.lift}`:""].filter(Boolean).join(" • "); serviceRows.push({pos:pos++,title:floorText||"Zugang / Etage / Aufzug",qty:"inkl.",unit:"inkl.",total:"inkl."}); }
    const inv=draft.inv||{rooms:[],items:{},qty:{},svc:{}}; const rooms=Array.from(new Set([...(Array.isArray(inv.rooms)?inv.rooms:[]),...Object.keys(inv.items||{})])).filter(Boolean);
    let itemCount=0, serviceCount=0;
    for (const room of rooms) { const items=Array.isArray(inv.items?.[room])?inv.items[room]:[]; for (const it of items) { itemCount+=Math.max(1,Number(inv.qty?.[room]?.[it]??1)||1); if (String(inv.svc?.[room]?.[it]||"").trim()) serviceCount++; } }
    if (itemCount>0) serviceRows.push({pos:pos++,title:`Inventar laut Anlage (${itemCount} Positionen)`,qty:"1",unit:"inkl.",total:"inkl."});
    if (serviceCount>0) serviceRows.push({pos:pos++,title:"Zusatzleistungen Montage / Demontage gemäß Inventarliste",qty:String(serviceCount),unit:"inkl.",total:"inkl."});
    const serviceTableHtml=serviceRows.map(r=>`<tr><td style="padding:11px 12px;border-bottom:1px solid #e6ebef;font-size:11px;font-weight:800;color:#0f172a;width:52px;">${escapeHtml(String(r.pos))}</td><td style="padding:11px 12px;border-bottom:1px solid #e6ebef;font-size:11px;font-weight:800;color:#0f172a;">${escapeHtml(r.title)}</td><td style="padding:11px 12px;border-bottom:1px solid #e6ebef;font-size:11px;font-weight:800;color:#0f172a;width:70px;text-align:right;">${escapeHtml(r.qty)}</td><td style="padding:11px 12px;border-bottom:1px solid #e6ebef;font-size:11px;font-weight:800;color:#0f172a;width:120px;text-align:right;">${escapeHtml(r.unit)}</td><td style="padding:11px 12px;border-bottom:1px solid #e6ebef;font-size:11px;font-weight:900;color:#0f172a;width:120px;text-align:right;">${escapeHtml(r.total)}</td></tr>`).join("");
    const svcLabel=(v)=>{if(v==="demontage")return"Demontage";if(v==="montage")return"Montage";if(v==="beides")return"Demontage + Montage";return"Nur Transport";};
    const annexBlocks=[];
    for (const room of rooms) { const items=Array.isArray(inv.items?.[room])?inv.items[room].filter(Boolean):[]; if (!items.length) continue; const rowsHtml=items.map(it=>{const qty=Math.max(1,Number(inv.qty?.[room]?.[it]??1)||1);const svcRaw=String(inv.svc?.[room]?.[it]||"").trim();return`<tr><td style="padding:9px 12px;border-bottom:1px solid #e8edf2;font-size:10.5px;font-weight:800;color:#0f172a;">${escapeHtml(it)}</td><td style="padding:9px 12px;border-bottom:1px solid #e8edf2;font-size:10.5px;font-weight:900;color:#0f172a;text-align:right;width:80px;">${escapeHtml(String(qty))}</td><td style="padding:9px 12px;border-bottom:1px solid #e8edf2;font-size:10.5px;font-weight:800;color:#0f172a;width:180px;">${escapeHtml(svcLabel(svcRaw))}</td></tr>`;}).join(""); annexBlocks.push(`<div style="margin-top:16px;"><div style="padding:10px 12px;background:#f7faf8;border:1px solid #dfe7e2;border-bottom:none;border-radius:12px 12px 0 0;font-size:12px;font-weight:900;color:#166534;">${escapeHtml(room)}</div><table style="width:100%;border-collapse:collapse;border:1px solid #dfe7e2;border-radius:0 0 12px 12px;overflow:hidden;"><thead><tr><th style="padding:10px 12px;background:#ffffff;border-bottom:1px solid #e8edf2;text-align:left;font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;letter-spacing:.06em;">Position</th><th style="padding:10px 12px;background:#ffffff;border-bottom:1px solid #e8edf2;text-align:right;font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;letter-spacing:.06em;width:80px;">Menge</th><th style="padding:10px 12px;background:#ffffff;border-bottom:1px solid #e8edf2;text-align:left;font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;letter-spacing:.06em;width:180px;">Service</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>`); }
    const footerLine1=[brand,companyStreet,companyCity,companyCountry].filter(Boolean).join(" • ");
    const footerLine2=[companyPhone?`Tel. ${companyPhone}`:"",companyEmail?`E-Mail ${companyEmail}`:"",companyIban?`IBAN ${companyIban}`:"",companyBic?`BIC ${companyBic}`:""].filter(Boolean).join(" • ");
    const footerLine3=[companyTax?`Steuernummer ${companyTax}`:"",companyVat?`USt-IdNr. ${companyVat}`:""].filter(Boolean).join(" • ");
    const noteText=String(draft.text||"").trim();
    return `<style>@media print{html,body{background:#fff !important;}*{-webkit-print-color-adjust:exact;print-color-adjust:exact;}.pdf-page{box-shadow:none !important;border:none !important;border-radius:0 !important;}.pdf-break{page-break-before:always;}}</style><div style="background:#f4f6f5;padding:24px;font-family:Inter,Arial,sans-serif;"><div class="pdf-page" style="width:210mm;min-height:297mm;margin:0 auto;background:#fff;border:1px solid #dde5e0;box-shadow:0 18px 50px rgba(15,23,42,.08);"><div style="padding:18mm 16mm 14mm 16mm;color:#0f172a;"><div style="height:4px;background:#16a34a;border-radius:999px;"></div><div style="margin-top:18px;display:grid;grid-template-columns:1.2fr .9fr;gap:24px;align-items:start;"><div><div style="display:flex;align-items:center;gap:12px;">${s.logo_url?`<img src="${escapeHtml(s.logo_url)}" alt="" style="max-height:48px;max-width:160px;object-fit:contain;"/>`:""}<div style="font-size:24px;font-weight:1000;letter-spacing:-.03em;color:#0b1220;">${escapeHtml(brand)}</div></div><div style="margin-top:10px;font-size:11.5px;line-height:1.7;color:#334155;font-weight:700;">${companyStreet?`<div>${escapeHtml(companyStreet)}</div>`:""}${companyCity?`<div>${escapeHtml(companyCity)}</div>`:""}${companyCountry?`<div>${escapeHtml(companyCountry)}</div>`:""}${companyPhone?`<div>Tel.: ${escapeHtml(companyPhone)}</div>`:""}${companyEmail?`<div>E-Mail: ${escapeHtml(companyEmail)}</div>`:""}</div></div><div style="text-align:right;"><div style="font-size:30px;font-weight:1000;letter-spacing:-.04em;color:#0b1220;">Angebot</div><div style="margin-top:12px;border:1px solid #e4e9ee;border-radius:14px;padding:12px 14px;display:inline-block;min-width:250px;text-align:left;background:#fafcfb;"><div style="display:grid;grid-template-columns:110px 1fr;gap:6px 10px;font-size:11px;line-height:1.65;"><div style="color:#64748b;font-weight:800;">Angebotsnr.</div><div style="color:#0f172a;font-weight:900;">${escapeHtml(offerNo)}</div><div style="color:#64748b;font-weight:800;">Datum</div><div style="color:#0f172a;font-weight:900;">${escapeHtml(offerDate)}</div><div style="color:#64748b;font-weight:800;">Gültig bis</div><div style="color:#0f172a;font-weight:900;">${escapeHtml(validUntil)}</div><div style="color:#64748b;font-weight:800;">Status</div><div style="color:#0f172a;font-weight:900;">${escapeHtml(draft.status||"Angebot")}</div></div></div></div></div><div style="margin-top:24px;display:grid;grid-template-columns:1fr 1fr;gap:18px;"><div style="border:1px solid #e4e9ee;border-radius:14px;padding:14px 15px;"><div style="font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;letter-spacing:.08em;">Kunde</div><div style="margin-top:10px;font-size:11.5px;line-height:1.7;color:#0f172a;font-weight:800;"><div>${escapeHtml(customer.name||"-")}</div>${customer.phone?`<div>${escapeHtml(customer.phone)}</div>`:""}${customer.email?`<div>${escapeHtml(customer.email)}</div>`:""}</div></div><div style="border:1px solid #e4e9ee;border-radius:14px;padding:14px 15px;"><div style="font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;letter-spacing:.08em;">Auftragsdaten</div><div style="margin-top:10px;font-size:11.5px;line-height:1.7;color:#0f172a;font-weight:800;"><div>${moveDate?`Umzugstermin: ${escapeHtml(moveDate)}`:"Umzugstermin: nach Vereinbarung"}</div><div>Route: ${escapeHtml([from.zip,from.city].filter(Boolean).join(" ")||"—")} → ${escapeHtml([to.zip,to.city].filter(Boolean).join(" ")||"—")}</div></div></div></div><div style="margin-top:24px;"><div style="font-size:18px;font-weight:1000;letter-spacing:-.02em;color:#0b1220;">Angebot für Ihren Umzug</div><div style="margin-top:7px;font-size:12px;line-height:1.6;color:#475569;font-weight:700;">Umzugsservice von ${escapeHtml([from.zip,from.city].filter(Boolean).join(" ")||"—")} nach ${escapeHtml([to.zip,to.city].filter(Boolean).join(" ")||"—")} ${moveDate?`am ${escapeHtml(moveDate)}`:""}.</div></div><div style="margin-top:18px;border:1px solid #e4e9ee;border-radius:14px;padding:14px 15px;background:#fcfdfd;"><div style="font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;letter-spacing:.08em;">Leistungsdaten</div><div style="margin-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:16px;"><div><div style="font-size:11px;font-weight:900;color:#166534;margin-bottom:6px;">Beladestelle</div><div style="font-size:11px;line-height:1.7;color:#0f172a;font-weight:800;"><div>${escapeHtml(fromLine1||"-")}</div><div>${escapeHtml(fromLine2||"-")}</div>${from.floor?`<div>Stock: ${escapeHtml(String(from.floor))}</div>`:""}${from.lift?`<div>Aufzug: ${escapeHtml(String(from.lift))}</div>`:""}</div></div><div><div style="font-size:11px;font-weight:900;color:#166534;margin-bottom:6px;">Entladestelle</div><div style="font-size:11px;line-height:1.7;color:#0f172a;font-weight:800;"><div>${escapeHtml(toLine1||"-")}</div><div>${escapeHtml(toLine2||"-")}</div>${to.floor?`<div>Stock: ${escapeHtml(String(to.floor))}</div>`:""}${to.lift?`<div>Aufzug: ${escapeHtml(String(to.lift))}</div>`:""}</div></div></div></div><div style="margin-top:20px;"><table style="width:100%;border-collapse:collapse;border:1px solid #dfe6e2;border-radius:14px;overflow:hidden;"><thead><tr><th style="padding:11px 12px;background:#f7faf8;border-bottom:1px solid #e6ebef;text-align:left;font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;letter-spacing:.07em;width:52px;">Pos.</th><th style="padding:11px 12px;background:#f7faf8;border-bottom:1px solid #e6ebef;text-align:left;font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;letter-spacing:.07em;">Leistung</th><th style="padding:11px 12px;background:#f7faf8;border-bottom:1px solid #e6ebef;text-align:right;font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;letter-spacing:.07em;width:70px;">Menge</th><th style="padding:11px 12px;background:#f7faf8;border-bottom:1px solid #e6ebef;text-align:right;font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;letter-spacing:.07em;width:120px;">Einzelpreis</th><th style="padding:11px 12px;background:#f7faf8;border-bottom:1px solid #e6ebef;text-align:right;font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;letter-spacing:.07em;width:120px;">Gesamt</th></tr></thead><tbody>${serviceTableHtml}</tbody></table></div><div style="margin-top:20px;display:grid;grid-template-columns:1.1fr .9fr;gap:18px;align-items:start;"><div style="border:1px solid #e4e9ee;border-radius:14px;padding:14px 15px;background:#fff;"><div style="font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;letter-spacing:.08em;">Konditionen</div><div style="margin-top:10px;font-size:11px;line-height:1.8;color:#0f172a;font-weight:700;"><div>• Dieses Angebot ist gültig bis ${escapeHtml(validUntil)}.</div><div>• Grundlage des Angebots sind die aktuell angegebenen Leistungen.</div><div>• Zusätzlicher, vorab nicht angegebener Mehraufwand kann gesondert berechnet werden.</div><div>• Terminvergabe erfolgt nach Verfügbarkeit.</div><div>• Änderungen nach Besichtigung bleiben vorbehalten.</div></div></div><div style="border:2px solid #16a34a;border-radius:16px;padding:15px 16px;background:#fbfefc;">${isKleinunternehmer?`<div style="display:flex;justify-content:space-between;gap:12px;font-size:11px;font-weight:800;color:#334155;"><span>Gesamtpreis</span><span>${escapeHtml(euro(gross))}</span></div><div style="margin-top:14px;padding-top:12px;border-top:1px solid #dce6df;display:flex;justify-content:space-between;gap:12px;align-items:end;"><span style="font-size:14px;font-weight:900;color:#166534;">Endbetrag</span><span style="font-size:28px;font-weight:1000;letter-spacing:-.03em;color:#065f46;">${escapeHtml(euro(gross))}</span></div><div style="margin-top:8px;font-size:10px;line-height:1.6;color:#64748b;font-weight:700;">Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.</div>`:`<div style="display:flex;justify-content:space-between;gap:12px;font-size:11px;font-weight:800;color:#334155;"><span>Zwischensumme netto</span><span>${escapeHtml(euro(net))}</span></div><div style="display:flex;justify-content:space-between;gap:12px;font-size:11px;font-weight:800;color:#334155;margin-top:8px;"><span>zzgl. 19% MwSt.</span><span>${escapeHtml(euro(vat))}</span></div><div style="margin-top:14px;padding-top:12px;border-top:1px solid #dce6df;display:flex;justify-content:space-between;gap:12px;align-items:end;"><span style="font-size:14px;font-weight:900;color:#166534;">Gesamt brutto</span><span style="font-size:28px;font-weight:1000;letter-spacing:-.03em;color:#065f46;">${escapeHtml(euro(gross))}</span></div>`}</div></div>${noteText?`<div style="margin-top:18px;border:1px solid #e4e9ee;border-radius:14px;padding:14px 15px;background:#fff;"><div style="font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;letter-spacing:.08em;">Hinweis</div><div style="margin-top:10px;font-size:11px;line-height:1.8;color:#0f172a;font-weight:700;white-space:pre-line;">${escapeHtml(noteText)}</div></div>`:""}<div style="margin-top:22px;padding-top:12px;border-top:1px solid #e6ebef;font-size:9.5px;line-height:1.7;color:#64748b;font-weight:700;">${footerLine1?`<div>${escapeHtml(footerLine1)}</div>`:""}${footerLine2?`<div style="margin-top:4px;">${escapeHtml(footerLine2)}</div>`:""}${footerLine3?`<div style="margin-top:4px;">${escapeHtml(footerLine3)}</div>`:""}</div></div></div>${annexBlocks.length?`<div class="pdf-page pdf-break" style="width:210mm;min-height:297mm;margin:18px auto 0;background:#fff;border:1px solid #dde5e0;box-shadow:0 18px 50px rgba(15,23,42,.08);"><div style="padding:18mm 16mm 14mm 16mm;color:#0f172a;"><div style="height:4px;background:#16a34a;border-radius:999px;"></div><div style="margin-top:18px;display:flex;justify-content:space-between;gap:20px;align-items:flex-end;"><div><div style="font-size:24px;font-weight:1000;letter-spacing:-.03em;color:#0b1220;">Inventarliste</div><div style="margin-top:6px;font-size:12px;line-height:1.6;color:#475569;font-weight:700;">Anlage zum Angebot ${escapeHtml(offerNo)}</div></div><div style="text-align:right;font-size:11px;line-height:1.7;color:#334155;font-weight:800;"><div>${escapeHtml(customer.name||"-")}</div><div>${escapeHtml([from.zip,from.city].filter(Boolean).join(" ")||"—")} → ${escapeHtml([to.zip,to.city].filter(Boolean).join(" ")||"—")}</div>${moveDate?`<div>${escapeHtml(moveDate)}</div>`:""}</div></div>${annexBlocks.join("")}<div style="margin-top:22px;padding-top:12px;border-top:1px solid #e6ebef;font-size:9.5px;line-height:1.7;color:#64748b;font-weight:700;">${footerLine1?`<div>${escapeHtml(footerLine1)}</div>`:""}${footerLine2?`<div style="margin-top:4px;">${escapeHtml(footerLine2)}</div>`:""}</div></div></div>`:""}</div>`;
  }

  function openPdfForLead(leadId) {
    const row=STATE.rows.find(r=>String(r.id)===String(leadId)); if (!row) return;
    const p=getPayload(row); const fromRaw=p.pickup_address||p.from_address||p.from||row.pickup_address||{}; const toRaw=p.dropoff_address||p.to_address||p.to||row.dropoff_address||{};
    const roomItems=getRoomItems(row)||{}; const selectedRooms=Array.isArray(getSelectedRooms(row))?getSelectedRooms(row):[];
    const mergedRooms=Array.from(new Set([...selectedRooms.map(String),...Object.keys(roomItems).map(String)])).filter(Boolean);
    openPdf(buildLeadPdfHtml({
      from:{street:fromRaw.street||fromRaw.strasse||"",no:fromRaw.number||fromRaw.nr||fromRaw.no||"",zip:fromRaw.zip||fromRaw.plz||"",city:fromRaw.city||fromRaw.ort||"",floor:fromRaw.floor||"",lift:fromRaw.lift||fromRaw.aufzug||""},
      to:{street:toRaw.street||toRaw.strasse||"",no:toRaw.number||toRaw.nr||toRaw.no||"",zip:toRaw.zip||toRaw.plz||"",city:toRaw.city||toRaw.ort||"",floor:toRaw.floor||"",lift:toRaw.lift||toRaw.aufzug||""},
      customer:{name:customerName(row)||"",phone:customerPhone(row)||"",email:customerEmail(row)||""},
      move_date:row.move_date||p.move_date||"", price:String(getOffer(row).price||""), text:String(getOffer(row).text||""), status:normalizeStatus(row.status),
      inv:{rooms:mergedRooms,items:roomItems,qty:getRoomQty(row)||{},svc:getAssembly(row)||{}},
    }));
  }

  // =========================
  // CSV
  // =========================
  function exportCSV() {
    const rows=STATE.filtered.length?STATE.filtered:STATE.rows; if (!rows.length) return;
    const headers=["id","created_at","status","customer_name","customer_phone","customer_email","route","move_date","source"];
    const csvCell=(v)=>`"${String(v??"").replaceAll('"','""')}"`;
    const out=[headers.join(",")];
    for (const r of rows) { const p=getPayload(r); out.push([r.id,r.created_at,normalizeStatus(r.status),customerName(r),customerPhone(r),customerEmail(r),routeText(r),r.move_date||p.move_date||"",r.source||""].map(csvCell).join(",")); }
    const blob=new Blob(["\uFEFF"+out.join("\n")],{type:"text/csv;charset=utf-8;"}); const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download="leads_"+new Date().toISOString().slice(0,10)+".csv"; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  // =========================
  // EDIT MODAL (inventory editor)
  // =========================
  function buildInvDraftFromRow(row) {
    const p=getPayload(row); const selected_rooms=row.selected_rooms||p.selected_rooms||p.rooms||[]; const room_items=row.room_items||p.room_items||p.roomItems||{}; const room_item_quantities=row.room_item_quantities||p.room_item_quantities||p.roomItemQuantities||{}; const assembly_request=row.assembly_request||p.assembly_request||p.services||{};
    const rooms=Array.isArray(selected_rooms)?selected_rooms.map(x=>String(x)).filter(Boolean):[];
    const items={},qty={},asm={}; const roomSet=new Set(); rooms.forEach(r=>roomSet.add(r)); Object.keys(room_items||{}).forEach(r=>roomSet.add(String(r)));
    for (const room of roomSet) { items[room]=Array.from(new Set((Array.isArray(room_items?.[room])?room_items[room]:[]).map(x=>String(x)).filter(Boolean))); qty[room]=room_item_quantities?.[room]&&typeof room_item_quantities[room]==="object"?{...room_item_quantities[room]}:{}; asm[room]=assembly_request?.[room]&&typeof assembly_request[room]==="object"?{...assembly_request[room]}:{}; }
    return {rooms:Array.from(roomSet),items,qty,asm};
  }

  function renderInvEditor() {
    const invEl=$("invEditor"); if (!invEl||!EDIT.inv) return;
    const inv=EDIT.inv;
    invEl.innerHTML=inv.rooms.map(room=>{
      const roomItems=Array.isArray(inv.items?.[room])?inv.items[room]:[];
      const rows=roomItems.map(it=>{ const q=Math.max(1,Number(inv.qty?.[room]?.[it]??1)||1); const sv=String(inv.asm?.[room]?.[it]||""); return `<div class="row2" style="grid-template-columns:1fr 110px 200px 54px;gap:10px;margin-top:10px;"><div class="field" style="margin-top:0;"><label>Gegenstand</label><input class="input invItemName" data-room="${escapeHtml(room)}" data-item="${escapeHtml(it)}" value="${escapeHtml(it)}"/></div><div class="field" style="margin-top:0;"><label>Menge</label><input class="input invItemQty" data-room="${escapeHtml(room)}" data-item="${escapeHtml(it)}" type="number" min="1" value="${escapeHtml(q)}"/></div><div class="field" style="margin-top:0;"><label>Service</label><select class="select invItemSvc" data-room="${escapeHtml(room)}" data-item="${escapeHtml(it)}" style="min-width:0;width:100%;"><option value="" ${sv===""?"selected":""}>Transport</option><option value="demontage" ${sv==="demontage"?"selected":""}>Demontage</option><option value="montage" ${sv==="montage"?"selected":""}>Montage</option><option value="beides" ${sv==="beides"?"selected":""}>Beides</option></select></div><div class="field" style="margin-top:0;"><label>&nbsp;</label><button class="btn danger invItemDel" data-act="item-del" data-room="${escapeHtml(room)}" data-item="${escapeHtml(it)}" type="button" style="padding:10px 12px;border-radius:12px;">×</button></div></div>`; }).join("");
      return `<details class="acc" open><summary><span>${escapeHtml(room)}</span><span class="accHint">${escapeHtml(roomItems.length)} Positionen</span></summary><div class="accBody"><div class="row" style="gap:10px;align-items:center;"><input class="input invRoomName" data-room="${escapeHtml(room)}" value="${escapeHtml(room)}" style="max-width:360px;"/><button class="btn danger invRoomDel" data-act="room-del" data-room="${escapeHtml(room)}" type="button">Raum löschen</button></div>${rows||`<div class="hint" style="margin-top:10px;">Keine Gegenstände.</div>`}<div class="row" style="margin-top:12px;gap:10px;"><input class="input invNewItem" data-room="${escapeHtml(room)}" placeholder="Neuer Gegenstand" style="max-width:420px;"/><button class="btn invAddItem" data-act="item-add" data-room="${escapeHtml(room)}" type="button">Hinzufügen</button></div></div></details>`;
    }).join("")||`<div class="hint">Kein Inventar.</div>`;
  }

  function bindInvEditor() {
    const invEl=$("invEditor"),btnAddRoom=$("btnInvAddRoom"),inpNewRoom=$("invNewRoom"); if (!invEl||!EDIT.inv) return;
    if (btnAddRoom) btnAddRoom.onclick=()=>{ const name=String(inpNewRoom?.value||"").trim(); if (!name) return; if (!EDIT.inv.rooms.includes(name)) EDIT.inv.rooms.push(name); EDIT.inv.items[name]=EDIT.inv.items[name]||[]; EDIT.inv.qty[name]=EDIT.inv.qty[name]||{}; EDIT.inv.asm[name]=EDIT.inv.asm[name]||{}; if (inpNewRoom) inpNewRoom.value=""; renderInvEditor(); };
    invEl.onclick=(e)=>{ const btn=e.target?.closest?.("[data-act]"); if (!btn) return; const act=String(btn.dataset.act||""),room=String(btn.dataset.room||""),item=String(btn.dataset.item||""); if (!room) return; if (act==="room-del") { EDIT.inv.rooms=EDIT.inv.rooms.filter(r=>r!==room); delete EDIT.inv.items[room]; delete EDIT.inv.qty[room]; delete EDIT.inv.asm[room]; renderInvEditor(); return; } if (act==="item-add") { const input=invEl.querySelector(`.invNewItem[data-room="${CSS.escape(room)}"]`); const name=String(input?.value||"").trim(); if (!name) return; EDIT.inv.items[room]=EDIT.inv.items[room]||[]; if (!EDIT.inv.items[room].includes(name)) EDIT.inv.items[room].push(name); EDIT.inv.qty[room]=EDIT.inv.qty[room]||{}; EDIT.inv.asm[room]=EDIT.inv.asm[room]||{}; if (!EDIT.inv.qty[room][name]) EDIT.inv.qty[room][name]=1; if (EDIT.inv.asm[room][name]==null) EDIT.inv.asm[room][name]=""; if (input) input.value=""; renderInvEditor(); return; } if (act==="item-del") { if (!item) return; EDIT.inv.items[room]=(EDIT.inv.items[room]||[]).filter(x=>x!==item); if (EDIT.inv.qty?.[room]) delete EDIT.inv.qty[room][item]; if (EDIT.inv.asm?.[room]) delete EDIT.inv.asm[room][item]; renderInvEditor(); return; } };
    invEl.onchange=(e)=>{ const t=e.target; if (t?.classList?.contains("invItemQty")) { const room=String(t.dataset.room||""),item=String(t.dataset.item||""); if (room&&item) { const n=Math.max(1,Math.round(Number(t.value||1)||1)); EDIT.inv.qty[room]=EDIT.inv.qty[room]||{}; EDIT.inv.qty[room][item]=n; t.value=String(n); } return; } if (t?.classList?.contains("invItemSvc")) { const room=String(t.dataset.room||""),item=String(t.dataset.item||""); if (room&&item) { EDIT.inv.asm[room]=EDIT.inv.asm[room]||{}; EDIT.inv.asm[room][item]=String(t.value||""); } return; } if (t?.classList?.contains("invRoomName")) { const oldRoom=String(t.dataset.room||""),newRoom=String(t.value||"").trim(); if (!oldRoom||!newRoom||oldRoom===newRoom) { t.value=oldRoom; return; } if (!EDIT.inv.rooms.includes(newRoom)) EDIT.inv.rooms=EDIT.inv.rooms.map(r=>r===oldRoom?newRoom:r); else EDIT.inv.rooms=EDIT.inv.rooms.filter(r=>r!==oldRoom); EDIT.inv.items[newRoom]=Array.from(new Set([...(EDIT.inv.items[newRoom]||[]),...(EDIT.inv.items[oldRoom]||[])])); EDIT.inv.qty[newRoom]={...(EDIT.inv.qty[newRoom]||{}),...(EDIT.inv.qty[oldRoom]||{})}; EDIT.inv.asm[newRoom]={...(EDIT.inv.asm[newRoom]||{}),...(EDIT.inv.asm[oldRoom]||{})}; delete EDIT.inv.items[oldRoom]; delete EDIT.inv.qty[oldRoom]; delete EDIT.inv.asm[oldRoom]; renderInvEditor(); return; } if (t?.classList?.contains("invItemName")) { const room=String(t.dataset.room||""),oldItem=String(t.dataset.item||""),newItem=String(t.value||"").trim(); if (!room||!oldItem||!newItem||oldItem===newItem) { t.value=oldItem; return; } EDIT.inv.items[room]=Array.from(new Set((EDIT.inv.items[room]||[]).map(x=>x===oldItem?newItem:x))); EDIT.inv.qty[room]=EDIT.inv.qty[room]||{}; EDIT.inv.asm[room]=EDIT.inv.asm[room]||{}; if (EDIT.inv.qty[room][newItem]==null) EDIT.inv.qty[room][newItem]=EDIT.inv.qty[room][oldItem]??1; if (EDIT.inv.asm[room][newItem]==null) EDIT.inv.asm[room][newItem]=EDIT.inv.asm[room][oldItem]??""; delete EDIT.inv.qty[room][oldItem]; delete EDIT.inv.asm[room][oldItem]; renderInvEditor(); return; } };
  }

  function openEditModalForSelected() {
    const r=selectedRow(); if (!r||!UI.editModal||!UI.editBody) return;
    const p=getPayload(r); const fromRaw=p.pickup_address||p.from_address||p.from||r.pickup_address||{}; const toRaw=p.dropoff_address||p.to_address||p.to||r.dropoff_address||{};
    const from={street:fromRaw.street||fromRaw.strasse||"",no:fromRaw.number||fromRaw.nr||fromRaw.no||"",zip:fromRaw.zip||fromRaw.plz||"",city:fromRaw.city||fromRaw.ort||"",country:fromRaw.country||"Deutschland"};
    const to={street:toRaw.street||toRaw.strasse||"",no:toRaw.number||toRaw.nr||toRaw.no||"",zip:toRaw.zip||toRaw.plz||"",city:toRaw.city||toRaw.ort||"",country:toRaw.country||"Deutschland"};
    const move=String(p.move_date||r.move_date||"").trim(); EDIT.inv=buildInvDraftFromRow(r);
    UI.editBody.innerHTML=`<div class="grid2" style="grid-template-columns:1fr 1fr;"><div class="card" style="box-shadow:none;"><div class="cardHead"><p class="h">Kunde</p><p class="sub">Basisdaten</p></div><div class="cardBody"><div class="field" style="margin-top:0;"><label>Name</label><input class="input" id="e_name" value="${escapeHtml(customerName(r))}"/></div><div class="field"><label>Telefon</label><input class="input" id="e_phone" value="${escapeHtml(customerPhone(r))}"/></div><div class="field"><label>E-Mail</label><input class="input" id="e_email" value="${escapeHtml(customerEmail(r))}"/></div><div class="field"><label>Termin (YYYY-MM-DD)</label><input class="input" id="e_move" value="${escapeHtml(move)}" placeholder="2026-06-25"/></div></div></div><div class="card" style="box-shadow:none;"><div class="cardHead"><p class="h">Route</p><p class="sub">Von / Nach</p></div><div class="cardBody"><div class="field" style="margin-top:0;"><label>Von Straße</label><input class="input" id="e_from_street" value="${escapeHtml(from.street)}"/></div><div class="row2"><div class="field"><label>Nr</label><input class="input" id="e_from_no" value="${escapeHtml(from.no)}"/></div><div class="field"><label>PLZ</label><input class="input" id="e_from_zip" value="${escapeHtml(from.zip)}"/></div></div><div class="row2"><div class="field"><label>Stadt</label><input class="input" id="e_from_city" value="${escapeHtml(from.city)}"/></div><div class="field"><label>Land</label><input class="input" id="e_from_country" value="${escapeHtml(from.country)}"/></div></div><div style="height:10px;"></div><div class="field"><label>Nach Straße</label><input class="input" id="e_to_street" value="${escapeHtml(to.street)}"/></div><div class="row2"><div class="field"><label>Nr</label><input class="input" id="e_to_no" value="${escapeHtml(to.no)}"/></div><div class="field"><label>PLZ</label><input class="input" id="e_to_zip" value="${escapeHtml(to.zip)}"/></div></div><div class="row2"><div class="field"><label>Stadt</label><input class="input" id="e_to_city" value="${escapeHtml(to.city)}"/></div><div class="field"><label>Land</label><input class="input" id="e_to_country" value="${escapeHtml(to.country)}"/></div></div></div></div></div><div class="card" style="box-shadow:none;margin-top:14px;"><div class="cardHead"><p class="h">Inventar</p><p class="sub">Räume, Menge, Service</p></div><div class="cardBody"><div id="invEditor"></div><div class="row" style="margin-top:12px;"><input class="input" id="invNewRoom" placeholder="Neuer Raum (z.B. Wohnzimmer)" style="max-width:380px;"/><button class="btn" id="btnInvAddRoom" type="button">Raum hinzufügen</button></div><div class="hint" style="margin-top:8px;">Service: Transport/Demontage/Montage/Beides.</div></div></div>`;
    renderInvEditor(); bindInvEditor(); openModal(UI.editModal);
    const sB=$("btnEditSave"),cB=$("btnEditCloseBottom"); if (sB) sB.onclick=(e)=>{ e.preventDefault(); saveEditModal(); }; if (cB) cB.onclick=()=>closeModal(UI.editModal);
  }

  function normalizeDateInput(v) { const s=String(v||"").trim(); if (!s) return ""; if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; const m1=s.match(/^(\d{4})\.(\d{2})\.(\d{2})$/); if (m1) return `${m1[1]}-${m1[2]}-${m1[3]}`; const m2=s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/); if (m2) return `${m2[3]}-${m2[2]}-${m2[1]}`; return s; }

  async function saveEditModal() {
    if (!acquireLock("saveEditModal")) return;
    try {
    if (guardDemoAction("Bearbeiten")) return; const r=selectedRow(); if (!r||!STATE.sb) return;
    const v=(id)=>String(document.getElementById(id)?.value||"").trim();
    const pOld=getPayload(r); const pNew=JSON.parse(JSON.stringify(pOld||{})); const moveDateNormalized=normalizeDateInput(v("e_move"));
    pNew.customer_name=v("e_name"); pNew.customer_phone=v("e_phone"); pNew.customer_email=v("e_email"); pNew.move_date=moveDateNormalized;
    pNew.pickup_address={street:v("e_from_street"),number:v("e_from_no"),zip:v("e_from_zip"),city:v("e_from_city"),country:v("e_from_country")};
    pNew.dropoff_address={street:v("e_to_street"),number:v("e_to_no"),zip:v("e_to_zip"),city:v("e_to_city"),country:v("e_to_country")};
    const inv=EDIT.inv||buildInvDraftFromRow(r); pNew.selected_rooms=inv.rooms.filter(Boolean); pNew.room_items=inv.items||{}; pNew.room_item_quantities=inv.qty||{}; pNew.assembly_request=inv.asm||{};
    const updateObj={payload:pNew}; const has=(k)=>Object.prototype.hasOwnProperty.call(r,k);
    if (has("customer_name")) updateObj.customer_name=pNew.customer_name||null; if (has("customer_phone")) updateObj.customer_phone=pNew.customer_phone||null; if (has("customer_email")) updateObj.customer_email=pNew.customer_email||null;
    if (has("pickup_address")) updateObj.pickup_address=pNew.pickup_address; if (has("dropoff_address")) updateObj.dropoff_address=pNew.dropoff_address;
    if (has("selected_rooms")) updateObj.selected_rooms=pNew.selected_rooms; if (has("room_items")) updateObj.room_items=pNew.room_items; if (has("room_item_quantities")) updateObj.room_item_quantities=pNew.room_item_quantities; if (has("assembly_request")) updateObj.assembly_request=pNew.assembly_request;
    if (has("move_date")) updateObj.move_date=moveDateNormalized||null;
    const {data,error}=await STATE.sb.from("leads").update(updateObj).eq("id",r.id).select("*").single();
    if (error) { showNotice("Speichern fehlgeschlagen: "+(error.message||error),"err"); return; }
    const idx=STATE.rows.findIndex(x=>String(x.id)===String(r.id)); if (idx>=0) STATE.rows[idx]=data;
    applyFilters(); renderList(); renderKPIs(); renderLatest(); renderDrawer(); renderStartDashboard(STATE.rows); closeModal(UI.editModal); showNotice("Gespeichert.","ok");
    } finally { releaseLock("saveEditModal"); }
  }

  // =========================
  // HASH LEAD OPEN
  // =========================
  function maybeOpenHashLead() { const id=getLeadIdFromHash(); if (!id) return; if (!STATE.user||!STATE.hasAccess||!STATE.rows.length) { STATE.pendingLeadId=id; return; } if (STATE.rows.some(r=>String(r.id)===String(id))) { openLead(id); return; } STATE.pendingLeadId=id; }
  function maybeOpenPendingLead() { const id=String(STATE.pendingLeadId||"").trim(); if (!id) return; STATE.pendingLeadId=null; if (STATE.rows.some(r=>String(r.id)===String(id))) openLead(id); }

  // =========================
  // NAV
  // =========================
  function setActiveNav(which,opts) {
    const o=opts||{}; const target=String(which||"start").trim()||"start";
      const map=[["start",UI.navStart,UI.viewStart,"Start","Übersicht"],["leads",UI.navLeads,UI.viewLeads,"Leads","Liste"],["portal",$("navPortal"),$("viewPortal"),"Kundenportal","Links & Status"],["calendar",$("navCalendar"),$("viewCalendar"),"Kalender","Umzüge & Termine"],["rechnungen",$("navRechnungen"),$("viewRechnungen"),"Rechnungen","Alle Rechnungen"],["offer",UI.navOffer,UI.viewOffer,"Angebot","Erstellen"],["billing",$("navBilling"),$("viewBilling"),"Abo & Zahlung","Abonnement verwalten"],["settings",UI.navSettings,UI.viewSettings,"Settings","Firmendaten"]];
    map.forEach(([key,btn,view])=>{ if (!btn||!view) return; if (key==="settings"&&!STATE.isAdmin) { btn.classList.remove("active"); view.classList.remove("active"); return; } const on=key===target; btn.classList.toggle("active",on); view.classList.toggle("active",on); });
 
    STATE.view=target; const found=map.find(x=>x[0]===target); if (UI.pageTitle) UI.pageTitle.textContent=found?.[3]||"Start"; if (UI.pageSub) UI.pageSub.textContent=found?.[4]||"";
    closeDrawer(); if (UI.sidebar) UI.sidebar.classList.remove("open");
    if (!o.fromHash&&!String(location.hash||"").startsWith("#lead=")) setViewHash(target);
    if (target==="portal") loadPortalList();
  }

  function openLead(id) {
    const leadId=String(id||"").trim(); if (!leadId) return;
    if (STATE.rows.some(r=>String(r.id)===leadId)) { STATE.selectedId=leadId; persistSelected(leadId); applyFilters(); renderList(); renderKPIs(); setActiveNav("leads"); renderDrawer(); openDrawer(); setLeadHash(leadId); return; }
    persistSelected(leadId); setActiveNav("leads");
  }

  // =========================
  // PORTAL LINK
  // =========================
  function generatePortalToken() {
    const chars="abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"; let token=""; const arr=new Uint8Array(32); crypto.getRandomValues(arr); for (let i=0;i<32;i++) token+=chars[arr[i]%chars.length]; return token;
  }

  async function createPortalLink(leadId) {
    if (!STATE.sb||!STATE.companyId||!leadId) { showNotice("Fehler: Keine Verbindung.","err"); return null; }
    const {data:existing}=await STATE.sb.from("portal_tokens").select("token").eq("lead_id",leadId).eq("company_id",STATE.companyId).eq("is_active",true).gt("expires_at",new Date().toISOString()).maybeSingle();
    if (existing?.token) return `${window.location.origin}/portal/${existing.token}`;
    const token=generatePortalToken();
    const {error}=await STATE.sb.from("portal_tokens").insert({company_id:STATE.companyId,lead_id:leadId,token:token,created_by:STATE.user?.id||null});
    if (error) { showNotice("Portal-Link Fehler: "+(error.message||error),"err"); return null; }
    return `${window.location.origin}/portal/${token}`;
  }

  async function openPortalLinkModal(leadId) {
    const btn=$("drawerPortal"); if (btn) { btn.disabled=true; btn.textContent="Generiere..."; }
    const url=await createPortalLink(leadId);
    if (btn) { btn.disabled=false; btn.textContent="Portal Link"; }
    if (!url) return;
    try { await navigator.clipboard.writeText(url); showNotice("Portal-Link kopiert!","ok"); } catch { prompt("Portal-Link (kopieren):",url); }
  }

  // ── Portal Delete ──
  async function deletePortalData(leadId,tokenId) {
    if (!STATE.sb||!STATE.companyId) throw new Error("Nicht verbunden.");
    if (guardDemoAction("Portal löschen")) return;
    // Delete in order: events, uploads, signatures, then token
    if (leadId) {
      await STATE.sb.from("portal_events").delete().eq("lead_id",leadId);
      await STATE.sb.from("portal_uploads").delete().eq("lead_id",leadId);
      await STATE.sb.from("portal_signatures").delete().eq("lead_id",leadId);
    }
    if (tokenId) {
      await STATE.sb.from("portal_tokens").delete().eq("id",tokenId);
    } else if (leadId) {
      await STATE.sb.from("portal_tokens").delete().eq("lead_id",leadId).eq("company_id",STATE.companyId);
    }
  }

  // ── Portal List (Kundenportal tab) ──
  async function loadPortalList() {
    if (!STATE.sb||!STATE.companyId||!STATE.hasAccess) return;
    const loading=$("portalListLoading"),table=$("portalTable"),empty=$("portalEmpty"),tbody=$("portalTbody");
    if (loading) loading.style.display="block"; if (table) table.style.display="none"; if (empty) empty.style.display="none";
    const {data:tokens,error}=await STATE.sb.from("portal_tokens").select("id,token,lead_id,created_at,is_active,expires_at").eq("company_id",STATE.companyId).order("created_at",{ascending:false}).limit(100);
    if (loading) loading.style.display="none";
    if (error||!tokens?.length) { if (empty) empty.style.display="block"; return; }
    const leadIds=[...new Set(tokens.map(t=>t.lead_id))];
    const {data:sigs}=await STATE.sb.from("portal_signatures").select("lead_id,signed_at,signer_name").in("lead_id",leadIds);
    const sigMap=new Map(); if (sigs) sigs.forEach(s=>sigMap.set(s.lead_id,s));
    const {data:uploads}=await STATE.sb.from("portal_uploads").select("lead_id,file_name,file_url,file_type").in("lead_id",leadIds);
    const uploadMap=new Map(); if (uploads) uploads.forEach(u=>{ if (!uploadMap.has(u.lead_id)) uploadMap.set(u.lead_id,[]); uploadMap.get(u.lead_id).push(u); });
    const {data:events}=await STATE.sb.from("portal_events").select("lead_id,event_type,created_at").in("lead_id",leadIds).order("created_at",{ascending:false}).limit(500);
    const eventMap=new Map(); if (events) events.forEach(e=>{ if (!eventMap.has(e.lead_id)) eventMap.set(e.lead_id,[]); eventMap.get(e.lead_id).push(e); });

    if (table) table.style.display="table"; if (tbody) tbody.innerHTML="";
    for (const tk of tokens) {
      const lead=STATE.rows.find(r=>String(r.id)===String(tk.lead_id));
      const name=lead?customerName(lead):"Unbekannt";
      const email=lead?customerEmail(lead):"";
      const sig=sigMap.get(tk.lead_id);
      const leadUploads=uploadMap.get(tk.lead_id)||[];
      const leadEvents=eventMap.get(tk.lead_id)||[];
      const photoCount=leadUploads.filter(u=>u.file_type&&u.file_type.startsWith("image/")).length;
      const signedPdf=leadUploads.find(u=>u.file_type==="application/pdf"&&u.file_name.includes("Angebot"));

      let status="Offen", statusColor="#6b7280";
      if (sig) { status="Gebucht"; statusColor="#047857"; }
      else if (photoCount>0) { status=photoCount+" Foto"+(photoCount!==1?"s":""); statusColor="#0369a1"; }

      const url=`${window.location.origin}/portal/${tk.token}`;
      const shortUrl=`/portal/${tk.token.slice(0,8)}...`;

      // Actions
      let actions="";
      if (signedPdf) {
        actions+=` <a class="btn green" href="${escapeHtml(signedPdf.file_url)}" target="_blank" style="height:28px;padding:0 8px;font-size:11px;text-decoration:none;">PDF</a>`;
      } else if (sig && lead) {
        // Gebucht but no uploaded PDF - allow opening PDF via admin viewer
        actions+=` <button class="btn green" style="height:28px;padding:0 8px;font-size:11px;" data-act="view-pdf" data-lead="${escapeHtml(String(tk.lead_id))}">PDF</button>`;
      }
 if (email&&!sig) { const pRemKey="ab_photo_reminder_"+tk.lead_id; const pLastSent=localStorage.getItem(pRemKey); actions+=` <button class="btn soft" style="height:28px;padding:0 8px;font-size:11px;" data-act="resend" data-lead="${escapeHtml(tk.lead_id)}" data-email="${escapeHtml(email)}" data-name="${escapeHtml(name)}" data-last-sent="${escapeHtml(pLastSent||"")}">Erneut senden</button>`; }
       actions+=` <button class="btn danger" style="height:28px;padding:0 8px;font-size:11px;" data-act="portal-delete" data-token-id="${escapeHtml(String(tk.id))}" data-lead-id="${escapeHtml(String(tk.lead_id))}" data-name="${escapeHtml(name)}">Löschen</button>`;

      // Timeline mini
      const recentEvents=leadEvents.slice(0,3);
      const tlHtml=recentEvents.length?`<div style="margin-top:4px;font-size:10px;color:#9ca3af;line-height:1.4;">${recentEvents.map(e=>`${e.event_type.replace(/_/g," ")} ${formatDT(e.created_at).split(",")[0]||""}`).join(" · ")}</div>`:"";

      const tr=document.createElement("tr");
      tr.innerHTML=`<td><div class="tName">${escapeHtml(name)}</div>${tlHtml}</td><td><a href="${escapeHtml(url)}" target="_blank" style="color:var(--brand);font-size:12px;font-weight:600;">${escapeHtml(shortUrl)}</a></td><td class="hint">${escapeHtml(formatDT(tk.created_at))}</td><td><div style="display:flex;align-items:center;gap:4px;"><span style="width:7px;height:7px;border-radius:50%;background:${statusColor};"></span><span style="font-weight:700;color:${statusColor};font-size:13px;">${escapeHtml(status)}</span></div>${sig?`<div class="hint" style="font-size:11px;">${escapeHtml(formatDT(sig.signed_at))}</div>`:""}</td><td><div style="display:flex;gap:4px;flex-wrap:wrap;">${actions}</div></td>`;
      if (tbody) tbody.appendChild(tr);
    }
// Wire action buttons
    if (tbody) {
    tbody.querySelectorAll("[data-act='view-pdf']").forEach(btn=>{
        btn.addEventListener("click",()=>{ const leadId=btn.dataset.lead||""; if (leadId) openPdfForLead(leadId); });
      });
      tbody.querySelectorAll("[data-act='resend']")
        btn.addEventListener("click",async()=>{
          const leadId=btn.dataset.lead||"";
          const email=btn.dataset.email||"";
          const name=btn.dataset.name||"Kunde";
 if (!leadId||!email) return;
          const lastSentTs=btn.dataset.lastSent||"";
          if (lastSentTs) { const ago=Date.now()-Number(lastSentTs); const agoMin=Math.round(ago/60000); const agoText=agoMin<60?agoMin+" Min":Math.round(agoMin/60)+" Std"; if (!confirm("Erinnerung wurde bereits vor "+agoText+" gesendet. Trotzdem erneut senden?")) return; }
          btn.disabled=true; btn.textContent="...";
          const token=STATE.session?.access_token||"";
          if (!token) { showNotice("Nicht eingeloggt.","err"); return; }
          try {
            const lead=STATE.rows.find(r=>String(r.id)===leadId);
            const p=lead?getPayload(lead):{};
            const offer=p.offer||{};
            const res=await fetch("/anfrage/api/send-offer-email7.php",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+token},body:JSON.stringify({lead_id:leadId,company_id:STATE.companyId,recipient_email:email,recipient_name:name,subject:"Ihr Angebot - Bitte bestätigen",price_eur:offer.price||"",offer_text:offer.text||"",email_body:""})});
            const result=await res.json();
if (result.ok) { showNotice("E-Mail erneut gesendet an "+email,"ok"); try { localStorage.setItem("ab_photo_reminder_"+leadId,String(Date.now())); } catch {} }
             else showNotice("Fehler: "+(result.error||""),"err");
          } catch(err) { showNotice("Fehler: "+err.message,"err"); }
          btn.disabled=false; btn.textContent="Erneut senden";
        });
      tbody.querySelectorAll("[data-act='portal-delete']").forEach(btn=>{
        btn.addEventListener("click",async()=>{
          const tokenId=btn.dataset.tokenId||"";
          const leadId=btn.dataset.leadId||"";
          const name=btn.dataset.name||"Portal";
          if (!tokenId) return;
          if (!confirm("Portal-Link für \""+name+"\" wirklich löschen? Alle zugehörigen Daten (Fotos, Unterschrift, Events) werden ebenfalls gelöscht.")) return;
          btn.disabled=true; btn.textContent="...";
          try { await deletePortalData(leadId,tokenId); showNotice("Portal-Link gelöscht.","ok"); loadPortalList(); }
          catch(err) { showNotice("Fehler: "+(err.message||err),"err"); btn.disabled=false; btn.textContent="Löschen"; }
        });
      });
    }
  }

  // =========================
  // AUTH / SUPABASE
  // =========================
  async function initSupabase() {
    if (!SUPABASE_URL||!SUPABASE_ANON_KEY) { setConn("err","Key fehlt"); return; }
    if (!window.supabase||typeof window.supabase.createClient!=="function") { setConn("err","Supabase JS fehlt"); return; }
    if (!window.__abSupabase) window.__abSupabase=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    const sb=window.__abSupabase; STATE.sb=sb; updateAppContext(); setConn("connecting","Session prüfen...");
    const {data,error}=await sb.auth.getSession();
    if (error) { setConn("err","Session Fehler"); return; }
    STATE.session=data?.session||null; STATE.user=data?.session?.user||null;
    if (!STATE.user) { redirectToLogin(); return; }
    const ok=await checkAccessAndRole(); applyRoleToUI(); applyDemoMode();
    if (!ok) { setConn("warn","Kein Zugriff"); return; }
    setConn("ok","Verbunden"); await loadSettings(); await fetchLeads(); setupRealtime();
    sb.auth.onAuthStateChange(async(_evt,session)=>{
      STATE.session=session||null; STATE.user=session?.user||null; teardownRealtime();
      if (!STATE.user) { STATE.member=null; STATE.companyId=null; STATE.role=null; STATE.isAdmin=false; STATE.hasAccess=false; updateAppContext(); redirectToLogin(); return; }
      setConn("connecting","Verbinden..."); const hasAccess=await checkAccessAndRole(); applyRoleToUI(); applyDemoMode();
      if (!hasAccess) { setConn("warn","Kein Zugriff"); STATE.rows=[]; STATE.filtered=[]; STATE.selectedId=null; renderList(); renderKPIs(); renderLatest(); return; }
      setConn("ok","Verbunden"); await loadSettings(); await fetchLeads(); setupRealtime();
    });
  }

  async function logout() {
    showNotice("Abmeldung...", "ok");
    if (STATE.sb) await STATE.sb.auth.signOut();
    window.location.replace("/anfrage/login/login.html");
  }

  // =========================
  // BIND (all event listeners)
  // =========================
  function bind() {
    if (UI.navStart) UI.navStart.addEventListener("click",()=>setActiveNav("start"));
    if (UI.navLeads) UI.navLeads.addEventListener("click",()=>{ setActiveNav("leads"); applyFilters(); renderList(); renderKPIs(); });
    if (UI.navOffer) UI.navOffer.addEventListener("click",()=>setActiveNav("offer"));
    const navPortal=$("navPortal"); if (navPortal) navPortal.addEventListener("click",()=>setActiveNav("portal"));
    const navCalendar=$("navCalendar"); if (navCalendar) navCalendar.addEventListener("click",()=>{ setActiveNav("calendar"); if (window.__AB_Calendar) window.__AB_Calendar.refresh(); });
    if (UI.navSettings) UI.navSettings.addEventListener("click",()=>{ if (!STATE.isAdmin) { showNotice("Nur Admin darf Settings.","err"); return; } setActiveNav("settings"); });
    if (UI.btnBurger&&UI.sidebar) UI.btnBurger.addEventListener("click",()=>UI.sidebar.classList.toggle("open"));
    if (UI.btnLogout) UI.btnLogout.addEventListener("click",logout);
    if (UI.btnRefresh) UI.btnRefresh.addEventListener("click",(e)=>{ e.preventDefault(); fetchLeads(); renderStartDashboard(STATE.rows); });
    if (UI.btnExport) UI.btnExport.addEventListener("click",(e)=>{ e.preventDefault(); exportCSV(); });

    const refilterNow=()=>{ applyFilters(); renderList(); renderKPIs(); };
    const refilterDebounced=debounce(refilterNow,120);
    if (UI.qSearch) UI.qSearch.addEventListener("input",refilterDebounced);
    if (UI.qStatus) UI.qStatus.addEventListener("change",refilterNow);
    if (UI.qDate) UI.qDate.addEventListener("change",refilterNow);
    if (UI.qSort) UI.qSort.addEventListener("change",refilterNow);
    if (UI.btnReset) UI.btnReset.addEventListener("click",(e)=>{ e.preventDefault(); if (UI.qSearch) UI.qSearch.value=""; if (UI.qStatus) UI.qStatus.value=""; if (UI.qDate) UI.qDate.value=""; if (UI.qSort) UI.qSort.value="newest"; refilterNow(); });

    if (UI.drawerOverlay) { const stop=(e)=>{ e.preventDefault(); e.stopImmediatePropagation(); }; UI.drawerOverlay.addEventListener("click",stop,true); UI.drawerOverlay.addEventListener("mousedown",stop,true); UI.drawerOverlay.addEventListener("pointerdown",stop,true); }
    if (UI.drawerClose) UI.drawerClose.addEventListener("click",closeDrawer);
        // PDF and Delete buttons moved into drawer body (contextual)

    if (UI.drawerEdit) UI.drawerEdit.addEventListener("click",openEditModalForSelected);

    if (UI.btnPdfClose) UI.btnPdfClose.addEventListener("click",()=>closeModal(UI.pdfModal));
    if (UI.btnPrint) UI.btnPrint.addEventListener("click",()=>{
      const html=String(UI.printArea?.innerHTML||"").trim(); if (!html) { showNotice("Nichts zu drucken.","err"); return; }
      const w=window.open("","_blank"); if (!w) { window.print(); return; }
      w.document.open(); w.document.write(`<!doctype html><html lang="de"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>PDF</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet"><style>html,body{margin:0;padding:0;font-family:Inter,Arial,sans-serif;}@page{margin:0;}</style></head><body>${html}</body></html>`);
      w.document.close(); w.focus(); w.print(); setTimeout(()=>{ try { w.close(); } catch {} },300);
    });

    if (UI.pdfModal) UI.pdfModal.addEventListener("click",(e)=>{ if (e.target===UI.pdfModal) { e.preventDefault(); e.stopImmediatePropagation(); } },true);
    if (UI.btnContactClose) UI.btnContactClose.addEventListener("click",()=>closeModal(UI.contactModal));
    if (UI.contactModal) UI.contactModal.addEventListener("click",(e)=>{ if (e.target===UI.contactModal) { e.preventDefault(); e.stopImmediatePropagation(); } },true);
    if (UI.btnEditClose) UI.btnEditClose.addEventListener("click",()=>closeModal(UI.editModal));
    if (UI.btnEditSave) UI.btnEditSave.addEventListener("click",(e)=>{ e.preventDefault(); saveEditModal(); });
    if (UI.btnEditCloseBottom) UI.btnEditCloseBottom.addEventListener("click",()=>closeModal(UI.editModal));
    if (UI.editModal) UI.editModal.addEventListener("click",(e)=>{ if (e.target===UI.editModal) { e.preventDefault(); e.stopImmediatePropagation(); } },true);
    if (UI.btnSaveSettings) UI.btnSaveSettings.addEventListener("click",(e)=>{ e.preventDefault(); e.stopPropagation(); saveSettings(); });
    if (UI.btnResetSettings) UI.btnResetSettings.addEventListener("click",(e)=>{ e.preventDefault(); applySettingsToForm(readLocalSettings()||STATE.companySettings||{}); showNotice("Zurückgesetzt.","ok"); });

    // Logo bindings
    const logoInput=$("logoFileInput");
    if (logoInput) logoInput.addEventListener("change",(e)=>{ const file=e.target.files?.[0]; if (file) handleLogoUpload(file); });
    const btnRemoveLogo=$("btnRemoveLogo");
    if (btnRemoveLogo) btnRemoveLogo.addEventListener("click",(e)=>{ e.preventDefault(); removeLogo(); });

   
    // Hash + keyboard
    window.addEventListener("hashchange",()=>{ const leadId=getLeadIdFromHash(); if (leadId) { maybeOpenHashLead(); return; } const v=getViewFromHash(); if (v) setActiveNav(v,{fromHash:true}); });
    document.addEventListener("keydown",(e)=>{ if (e.key==="Escape") { closeModal(UI.pdfModal); closeModal(UI.contactModal); closeModal(UI.editModal); } });
    const v0=getViewFromHash(); if (v0) setActiveNav(v0,{fromHash:true});
  }

  // =========================
  // BOOT
  // =========================
  async function boot() {
    bind(); setupStartRangeTabs(); renderStartDashboard(getAllLeadsForStart());
    await initSupabase(); renderKPIs(); renderLatest(); applyRoleToUI(); updateAppContext(); maybeOpenHashLead();
    if (STATE.view==="portal"&&STATE.hasAccess) loadPortalList();
  }

  if (document.readyState==="loading") window.addEventListener("DOMContentLoaded",boot);
  else boot();
})();