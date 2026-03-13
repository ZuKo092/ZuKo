// /anfrage/admin-mobile.js
(() => {
  const SUPABASE_URL = window.SUPABASE_URL;
  const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY;

  const UI = {
    toast: document.getElementById("toast"),

    auth: document.getElementById("auth"),
    app: document.getElementById("app"),
    email: document.getElementById("email"),
    pass: document.getElementById("pass"),
    btnLogin: document.getElementById("btnLogin"),
    authErr: document.getElementById("authErr"),

    btnLogout: document.getElementById("btnLogout"),
    btnLogoutTop: document.getElementById("btnLogoutTop"),

    tabs: Array.from(document.querySelectorAll(".tab")),
    views: {
      start: document.getElementById("viewStart"),
      leads: document.getElementById("viewLeads"),
      offer: document.getElementById("viewOffer"),
      settings: document.getElementById("viewSettings"),
    },

    connPill: document.getElementById("connPill"),
    kpiLeads: document.getElementById("kpiLeads"),
    heroLeadCount: document.getElementById("heroLeadCount"),
    kpiCompany: document.getElementById("kpiCompany"),

    q: document.getElementById("q"),
    btnRefresh: document.getElementById("btnRefresh"),
    leadList: document.getElementById("leadList"),
    emptyLeads: document.getElementById("emptyLeads"),
    btnSearchFocus: document.getElementById("btnSearchFocus"),

    offerLeadBadge: document.getElementById("offerLeadBadge"),
    offerPrice: document.getElementById("offerPrice"),
    offerText: document.getElementById("offerText"),
    btnOfferSave: document.getElementById("btnOfferSave"),
    btnOfferPdf: document.getElementById("btnOfferPdf"),
    btnOfferHelp: document.getElementById("btnOfferHelp"),

    s_name: document.getElementById("s_name"),
    s_addr: document.getElementById("s_addr"),
    s_phone: document.getElementById("s_phone"),
    s_email: document.getElementById("s_email"),
    s_iban: document.getElementById("s_iban"),
    btnSetSave: document.getElementById("btnSetSave"),
    btnSetReload: document.getElementById("btnSetReload"),
    btnReloadSettings: document.getElementById("btnReloadSettings"),

    detail: document.getElementById("detail"),
    detailBody: document.getElementById("detailBody"),
    btnBack: document.getElementById("btnBack"),
    btnDetailPdf: document.getElementById("btnDetailPdf"),
    btnDetailEdit: document.getElementById("btnDetailEdit"),
    btnDetailMore: document.getElementById("btnDetailMore"),

    moreSheet: document.getElementById("moreSheet"),
    btnCloseSheet: document.getElementById("btnCloseSheet"),
    btnCall: document.getElementById("btnCall"),
    btnMail: document.getElementById("btnMail"),
    btnWa: document.getElementById("btnWa"),
    btnDelete: document.getElementById("btnDelete"),

    menuSheet: document.getElementById("menuSheet"),
    btnCloseMenu: document.getElementById("btnCloseMenu"),
  };

  const STATE = {
    sb: null,
    user: null,
    companyId: null,
    leads: [],
    selected: null,
    companySettings: null,
  };

  function toast(msg) {
    if (!UI.toast) return;
    UI.toast.textContent = String(msg || "");
    UI.toast.style.display = "block";
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      UI.toast.style.display = "none";
    }, 2200);
  }

  function esc(v) {
    return String(v ?? "").replace(/[&<>"']/g, (m) =>
      m === "&" ? "&amp;" : m === "<" ? "&lt;" : m === ">" ? "&gt;" : m === '"' ? "&quot;" : "&#39;"
    );
  }

  function safeJson(s) {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  }

  function pickFirst(...vals) {
    for (const v of vals) if (typeof v === "string" && v.trim()) return v.trim();
    return "";
  }

  function fmtDateTime(s) {
    if (!s) return "";
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return String(s);
    return d.toLocaleString("de-DE", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function fmtDateOnly(s) {
    if (!s) return "";
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return String(s);
    return d.toLocaleDateString("de-DE", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }

  function phoneDigits(s) {
    return String(s ?? "").replace(/[^\d+]/g, "");
  }

  function getPayload(row) {
    const p = row?.payload;
    return p && typeof p === "object" ? p : {};
  }

  function addrLine(a) {
    if (!a || typeof a !== "object") return "";
    const street = pickFirst(a.street, "");
    const number = pickFirst(a.number, "");
    const zip = pickFirst(a.zip, a.postal, a.postcode, "");
    const city = pickFirst(a.city, "");
    const country = pickFirst(a.country, "");
    const first = [street, number].filter(Boolean).join(" ").trim();
    const second = [zip, city].filter(Boolean).join(" ").trim();
    return [first, second, country].filter(Boolean).join(", ");
  }

  function getCustomerName(row) {
    const p = getPayload(row);
    return pickFirst(p.customer_name, row?.customer_name, p.name) || "Unbekannt";
  }

  function getCustomerPhone(row) {
    const p = getPayload(row);
    return pickFirst(p.customer_phone, row?.customer_phone, p.phone, p.tel, p.mobile, p.telefon);
  }

  function getCustomerEmail(row) {
    const p = getPayload(row);
    return pickFirst(p.customer_email, row?.customer_email, p.email, p.mail);
  }

  function getPickupLine(row) {
    const p = getPayload(row);
    return addrLine(p.pickup_address);
  }

  function getDropoffLine(row) {
    const p = getPayload(row);
    return addrLine(p.dropoff_address);
  }

  function getMoveLabel(row) {
    const p = getPayload(row);

    const type = pickFirst(p.move_date_type, "");
    const exact = pickFirst(p.move_date, "");
    const alt = pickFirst(p.move_date_alt, "");
    const wf = pickFirst(p.move_window_from, "");
    const wt = pickFirst(p.move_window_to, "");
    const tw = pickFirst(p.move_time_window, "");
    const note = pickFirst(p.desired_date_note, "");

    if (type === "exact_date" || (exact && !wf)) {
      const a = exact ? fmtDateOnly(exact) : "";
      const b = alt ? fmtDateOnly(alt) : "";
      const base = [a, b].filter(Boolean).join(" / ");
      return base ? (tw ? base + " (" + tw + ")" : base) : "";
    }

    if (type === "time_window" || wf || wt || note) {
      const base =
        note || [wf ? fmtDateOnly(wf) : "", wt ? fmtDateOnly(wt) : ""].filter(Boolean).join(" bis ");
      return base ? (tw ? base + " (" + tw + ")" : base) : "";
    }

    if (row?.move_date) return fmtDateOnly(row.move_date);
    return "";
  }

  function statusClass(s) {
    const x = String(s || "neu").toLowerCase();
    if (x.includes("storno") || x.includes("cancel")) return "bad";
    if (x.includes("gebucht") || x.includes("fertig") || x.includes("done")) return "ok";
    if (x.includes("neu") || x.includes("new")) return "ok";
    return "";
  }

  function setConn(ok) {
    if (!UI.connPill) return;
    UI.connPill.className = "pill " + (ok ? "ok" : "bad");
    UI.connPill.textContent = ok ? "OK" : "Fehler";
  }

  function showAuth(errText) {
    if (UI.app) UI.app.style.display = "none";
    if (UI.auth) UI.auth.style.display = "flex";
    if (!UI.authErr) return;

    if (errText) {
      UI.authErr.style.display = "block";
      UI.authErr.textContent = errText;
    } else {
      UI.authErr.style.display = "none";
      UI.authErr.textContent = "";
    }
  }

  function showApp() {
    if (UI.auth) UI.auth.style.display = "none";
    if (UI.app) UI.app.style.display = "flex";
  }

  function setView(name) {
    Object.keys(UI.views).forEach((k) => {
      if (UI.views[k]) UI.views[k].style.display = k === name ? "block" : "none";
    });
    UI.tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  }

  function openMenu() {
    if (UI.menuSheet) UI.menuSheet.style.display = "flex";
  }

  function closeMenu() {
    if (UI.menuSheet) UI.menuSheet.style.display = "none";
  }

  function openDetail(row) {
    STATE.selected = row;
    localStorage.setItem("ab_admin_selected_lead", row?.id || "");
    renderDetail();
    if (UI.detail) UI.detail.style.display = "flex";
  }

  function closeDetail() {
    if (UI.moreSheet) UI.moreSheet.style.display = "none";
    if (UI.detail) UI.detail.style.display = "none";
  }

  function openSheet() {
    if (UI.moreSheet) UI.moreSheet.style.display = "flex";
  }

  function closeSheet() {
    if (UI.moreSheet) UI.moreSheet.style.display = "none";
  }

  function getOfferLocal(leadId) {
    if (!leadId) return {};
    return safeJson(localStorage.getItem("offer_" + leadId)) || {};
  }

  function setOfferLocal(leadId, obj) {
    if (!leadId) return;
    localStorage.setItem("offer_" + leadId, JSON.stringify(obj || {}));
  }

  async function login() {
    const email = (UI.email?.value || "").trim();
    const password = UI.pass?.value || "";

    if (!email || !password) return showAuth("E-Mail und Passwort fehlen.");

    UI.btnLogin.disabled = true;
    if (UI.authErr) UI.authErr.style.display = "none";

    const { data, error } = await STATE.sb.auth.signInWithPassword({ email, password });

    UI.btnLogin.disabled = false;

    if (error) return showAuth(error.message);
    if (!data?.session) return showAuth("Keine Session.");

    await afterLogin();
  }

  async function logout() {
    await STATE.sb.auth.signOut();
    STATE.user = null;
    STATE.companyId = null;
    STATE.leads = [];
    STATE.selected = null;
    showAuth();
  }

  async function checkAccess() {
    const { data, error } = await STATE.sb
      .from("company_users")
      .select("company_id")
      .eq("user_id", STATE.user.id)
      .maybeSingle();

    if (error) throw error;
    if (!data?.company_id) throw new Error("Kein Zugriff.");

    STATE.companyId = data.company_id;
    if (UI.kpiCompany) UI.kpiCompany.textContent = STATE.companyId;
  }

  async function loadCompanySettings() {
    if (!STATE.companyId) return;

    const { data, error } = await STATE.sb
      .from("company_settings")
      .select("*")
      .eq("company_id", STATE.companyId)
      .maybeSingle();

    if (error) throw error;

    STATE.companySettings = data || null;
    localStorage.setItem("ab_company_settings_" + STATE.companyId, JSON.stringify(data || {}));

    if (UI.s_name) UI.s_name.value = data?.company_name || data?.name || "";
    if (UI.s_addr) UI.s_addr.value = data?.address || "";
    if (UI.s_phone) UI.s_phone.value = data?.phone || "";
    if (UI.s_email) UI.s_email.value = data?.email || "";
    if (UI.s_iban) UI.s_iban.value = data?.iban || "";
  }

  async function saveCompanySettings() {
    if (!STATE.companyId) return;

    const payload = {
      company_id: STATE.companyId,
      company_name: (UI.s_name?.value || "").trim(),
      address: (UI.s_addr?.value || "").trim(),
      phone: (UI.s_phone?.value || "").trim(),
      email: (UI.s_email?.value || "").trim(),
      iban: (UI.s_iban?.value || "").trim(),
      updated_at: new Date().toISOString(),
    };

    const { error } = await STATE.sb
      .from("company_settings")
      .upsert(payload, { onConflict: "company_id" });

    if (error) return toast("Fehler: " + error.message);

    await loadCompanySettings();
    toast("Gespeichert.");
  }

  async function fetchLeads() {
    setConn(true);

    const { data, error } = await STATE.sb
      .from("leads")
      .select("id,created_at,status,move_date,payload")
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      setConn(false);
      throw error;
    }

    STATE.leads = Array.isArray(data) ? data : [];
    if (UI.kpiLeads) UI.kpiLeads.textContent = String(STATE.leads.length);
    if (UI.heroLeadCount) UI.heroLeadCount.textContent = String(STATE.leads.length);

    renderLeads();

    const remembered = localStorage.getItem("ab_admin_selected_lead");
    if (remembered && !STATE.selected) {
      const r = STATE.leads.find((x) => x.id === remembered);
      if (r) STATE.selected = r;
    }

    if (UI.offerLeadBadge) {
      UI.offerLeadBadge.textContent = STATE.selected ? STATE.selected.id.slice(0, 6) : "-";
    }
  }

  function matchesQuery(row, q) {
    if (!q) return true;
    const p = getPayload(row);
    const hay = [
      getCustomerName(row),
      getCustomerPhone(row),
      getCustomerEmail(row),
      getPickupLine(row),
      getDropoffLine(row),
      getMoveLabel(row),
      String(row.status || p.status || ""),
      String(p.notes || ""),
      String(p.summary_text || ""),
    ]
      .join(" ")
      .toLowerCase();

    return hay.includes(q);
  }

  function renderLeads() {
    if (!UI.leadList || !UI.emptyLeads) return;

    const q = (UI.q?.value || "").trim().toLowerCase();
    const rows = STATE.leads.filter((r) => matchesQuery(r, q));

    UI.leadList.innerHTML = "";
    UI.emptyLeads.style.display = rows.length ? "none" : "block";

    for (const row of rows) {
      const p = getPayload(row);
      const name = getCustomerName(row);
      const created = fmtDateTime(row.created_at);
      const move = getMoveLabel(row);
      const from = getPickupLine(row);
      const to = getDropoffLine(row);
      const st = row.status || p.status || "neu";
      const incomplete = (!from || !to || !name) ? true : false;

      const el = document.createElement("div");
      el.className = "leadCard";
      el.innerHTML = `
        <div class="leadTop">
          <div>
            <div class="leadName">${esc(name)}</div>
            <div class="leadSub">Erstellt: ${esc(created)}${move ? " . Umzug: " + esc(move) : ""}</div>
          </div>
          <div class="pill ${incomplete ? "warn" : statusClass(st)}">${esc(incomplete ? "Unvollständig" : st)}</div>
        </div>
        <div class="leadMeta">
          ${from ? `<div class="pill">${esc(from)}</div>` : ""}
          ${to ? `<div class="pill">${esc(to)}</div>` : ""}
        </div>
      `;
      el.addEventListener("click", () => openDetail(row));
      UI.leadList.appendChild(el);
    }
  }

  async function saveStatus(newStatus) {
    if (!STATE.selected) return;

    const row = STATE.selected;
    const p = getPayload(row);
    const newPayload = { ...p, status: newStatus };

    const { error } = await STATE.sb
      .from("leads")
      .update({ status: newStatus, payload: newPayload })
      .eq("id", row.id);

    if (error) return toast("Fehler: " + error.message);

    row.status = newStatus;
    row.payload = newPayload;

    const i = STATE.leads.findIndex((x) => x.id === row.id);
    if (i >= 0) {
      STATE.leads[i].status = newStatus;
      STATE.leads[i].payload = newPayload;
    }

    renderLeads();
    renderDetail();
    toast("Status gespeichert.");
  }

  function renderStatusOptions(current) {
    const cur = String(current || "").toLowerCase();
    const items = ["neu", "in bearbeitung", "angebot gesendet", "gebucht", "storniert"];
    return items
      .map((v) => {
        const sel = cur === v.toLowerCase() ? "selected" : "";
        return `<option ${sel} value="${esc(v)}">${esc(v)}</option>`;
      })
      .join("");
  }

  function renderDetail() {
    const row = STATE.selected;
    if (!row || !UI.detailBody) return;

    const p = getPayload(row);

    const name = getCustomerName(row);
    const phone = getCustomerPhone(row);
    const email = getCustomerEmail(row);

    const from = getPickupLine(row);
    const to = getDropoffLine(row);

    const move = getMoveLabel(row);
    const created = fmtDateTime(row.created_at);
    const st = row.status || p.status || "neu";

    const offer = getOfferLocal(row.id);
    if (UI.offerLeadBadge) UI.offerLeadBadge.textContent = row.id.slice(0, 6);
    if (UI.offerPrice) UI.offerPrice.value = offer.price || "";
    if (UI.offerText) UI.offerText.value = offer.text || "";

    const pickupDetails = p.pickup_details || {};
    const dropoffDetails = p.dropoff_details || {};

    const invRooms = Array.isArray(p.selected_rooms) ? p.selected_rooms : [];
    const invItems = p.room_items && typeof p.room_items === "object" ? p.room_items : {};
    const invQty = p.room_item_quantities && typeof p.room_item_quantities === "object" ? p.room_item_quantities : {};
    const assembly = p.assembly_request && typeof p.assembly_request === "object" ? p.assembly_request : {};

    const boxes = p.box_request && typeof p.box_request === "object" ? p.box_request : null;

    UI.detailBody.innerHTML = `
      <div class="card">
        <div class="cardH">${esc(name)}</div>
        <div class="row"><div class="muted">Lead ID</div><div class="pill">${esc(row.id)}</div></div>
        <div class="row" style="margin-top:10px;"><div class="muted">Erstellt</div><div class="pill">${esc(created)}</div></div>
      </div>

      <div class="sp12"></div>

      <div class="card">
        <div class="cardH">Kunde</div>
        <div class="row">
          <div class="muted">Status</div>
          <select id="d_status" class="inp" style="height:48px; padding:0 14px;">
            ${renderStatusOptions(st)}
          </select>
        </div>
        <button id="d_saveStatus" class="btn primary" style="width:100%; margin-top:12px;">Status speichern</button>
        <div class="line">Telefon: ${esc(phone || "-")}</div>
        <div class="line">E-Mail: ${esc(email || "-")}</div>
      </div>

      <div class="sp12"></div>

      <div class="card">
        <div class="cardH">Umzug</div>
        <div class="line">Datum: ${esc(move || "-")}</div>
        <div class="line">Räume: ${esc(invRooms.join(", ") || "-")}</div>
        <div class="line">Zeitfenster: ${esc(p.move_time_window || "-")}</div>
        ${p.desired_date_note ? `<div class="line">Note: ${esc(p.desired_date_note)}</div>` : ``}
      </div>

      <div class="sp12"></div>

      <div class="card">
        <div class="cardH">Route</div>
        <div class="line">Beladestelle: ${esc(from || "-")}</div>
        <details style="margin-top:10px;">
          <summary>Details Beladestelle</summary>
          <div class="line">Wohnart: ${esc(pickFirst(pickupDetails.housingType, "-") || "-")}</div>
          <div class="line">Etage: ${esc(pickFirst(pickupDetails.floor, "-") || "-")}</div>
          <div class="line">Aufzug: ${esc(pickFirst(pickupDetails.elevator, "-") || "-")}</div>
          <div class="line">m²: ${esc(pickFirst(pickupDetails.areaM2, "-") || "-")}</div>
          <div class="line">Parken: ${esc(pickFirst(pickupDetails.parkingType, "-") || "-")}</div>
          <div class="line">Notiz: ${esc(pickFirst(pickupDetails.notes, "-") || "-")}</div>
        </details>

        <div class="line" style="margin-top:10px;">Entladestelle: ${esc(to || "-")}</div>
        <details style="margin-top:10px;">
          <summary>Details Entladestelle</summary>
          <div class="line">Wohnart: ${esc(pickFirst(dropoffDetails.housingType, "-") || "-")}</div>
          <div class="line">Etage: ${esc(pickFirst(dropoffDetails.floor, "-") || "-")}</div>
          <div class="line">Aufzug: ${esc(pickFirst(dropoffDetails.elevator, "-") || "-")}</div>
          <div class="line">m²: ${esc(pickFirst(dropoffDetails.areaM2, "-") || "-")}</div>
          <div class="line">Parken: ${esc(pickFirst(dropoffDetails.parkingType, "-") || "-")}</div>
          <div class="line">Notiz: ${esc(pickFirst(dropoffDetails.notes, "-") || "-")}</div>
        </details>
      </div>

      <div class="sp12"></div>

      <div class="card">
        <div class="cardH">Inventar</div>

        <details>
          <summary>Möbel und Mengen</summary>
          ${
            invRooms.length
              ? invRooms
                  .map((r) => {
                    const items = Array.isArray(invItems[r]) ? invItems[r] : [];
                    if (!items.length) return `<div class="line">${esc(r)}: -</div>`;
                    return `
                      <div class="line" style="font-weight:950;">${esc(r)}</div>
                      ${items
                        .map((it) => {
                          const q = invQty?.[r]?.[it];
                          return `<div class="line">${esc(it)} . x${esc(q ?? 0)}</div>`;
                        })
                        .join("")}
                    `;
                  })
                  .join("")
              : `<div class="line">-</div>`
          }
        </details>

        <details style="margin-top:10px;">
          <summary>Montage / Service</summary>
          ${
            Object.keys(assembly).length
              ? Object.keys(assembly)
                  .map((room) => {
                    const svc = assembly[room] || {};
                    const keys = Object.keys(svc);
                    if (!keys.length) return `<div class="line">${esc(room)}: -</div>`;
                    return `
                      <div class="line" style="font-weight:950;">${esc(room)}</div>
                      ${keys.map((k) => `<div class="line">${esc(k)} . ${esc(svc[k])}</div>`).join("")}
                    `;
                  })
                  .join("")
              : `<div class="line">-</div>`
          }
        </details>
      </div>

      <div class="sp12"></div>

      <div class="card">
        <div class="cardH">Kartons</div>
        ${
          boxes
            ? `
              <div class="line">Benötigt: ${esc(boxes.needed ?? "-")}</div>
              <div class="line">Lieferdatum: ${esc(boxes.deliveryDate ? fmtDateOnly(boxes.deliveryDate) : "-")}</div>
              <details style="margin-top:10px;">
                <summary>Box Items</summary>
                ${
                  boxes.items && typeof boxes.items === "object" && Object.keys(boxes.items).length
                    ? Object.keys(boxes.items)
                        .map((k) => `<div class="line">${esc(k)} . ${esc(boxes.items[k])}</div>`)
                        .join("")
                    : `<div class="line">-</div>`
                }
              </details>
              <div class="line">Notiz: ${esc(boxes.notes ?? "-")}</div>
            `
            : `<div class="line">-</div>`
        }
      </div>

      ${
        p.summary_text
          ? `
        <div class="sp12"></div>
        <div class="card">
          <div class="cardH">Summary</div>
          <div class="line">${esc(String(p.summary_text)).replace(/\n/g, "<br>")}</div>
        </div>
      `
          : ""
      }

      ${
        p.notes
          ? `
        <div class="sp12"></div>
        <div class="card">
          <div class="cardH">Notizen</div>
          <div class="line">${esc(String(p.notes)).replace(/\n/g, "<br>")}</div>
        </div>
      `
          : ""
      }
    `;

    const sel = UI.detailBody.querySelector("#d_status");
    const btn = UI.detailBody.querySelector("#d_saveStatus");
    if (btn && sel) btn.onclick = () => saveStatus(sel.value);

    if (UI.btnDetailPdf) UI.btnDetailPdf.onclick = () => openPdf(row);
    if (UI.btnDetailEdit) UI.btnDetailEdit.onclick = () => toast("Edit kommt als nächster Schritt.");

    // Bind more actions (sheet uses STATE.selected)
    if (UI.btnCall)
      UI.btnCall.onclick = () => {
        const ph = getCustomerPhone(STATE.selected);
        if (!ph) return toast("Kein Telefon.");
        location.href = "tel:" + phoneDigits(ph);
      };

    if (UI.btnMail)
      UI.btnMail.onclick = () => {
        const em = getCustomerEmail(STATE.selected);
        if (!em) return toast("Keine E-Mail.");
        location.href = "mailto:" + encodeURIComponent(em);
      };

    if (UI.btnWa)
      UI.btnWa.onclick = () => {
        const ph = getCustomerPhone(STATE.selected);
        if (!ph) return toast("Kein Telefon.");
        const p = phoneDigits(ph).replace(/^\+/, "");
        window.open("https://wa.me/" + p, "_blank");
      };

    if (UI.btnDelete)
      UI.btnDelete.onclick = async () => {
        if (!STATE.selected) return;
        if (!confirm("Lead löschen?")) return;

        const { error } = await STATE.sb.from("leads").delete().eq("id", STATE.selected.id);
        if (error) return toast("Fehler: " + error.message);

        STATE.leads = STATE.leads.filter((x) => x.id !== STATE.selected.id);
        STATE.selected = null;

        if (UI.offerLeadBadge) UI.offerLeadBadge.textContent = "-";
        if (UI.kpiLeads) UI.kpiLeads.textContent = String(STATE.leads.length);
        if (UI.heroLeadCount) UI.heroLeadCount.textContent = String(STATE.leads.length);

        closeSheet();
        closeDetail();
        renderLeads();
        toast("Gelöscht.");
      };
  }

  function openPdf(row) {
    const cs = STATE.companySettings || {};
    const p = getPayload(row);

    const name = getCustomerName(row);
    const phone = getCustomerPhone(row);
    const email = getCustomerEmail(row);

    const from = getPickupLine(row);
    const to = getDropoffLine(row);

    const created = fmtDateTime(row.created_at);
    const move = getMoveLabel(row);

    const offer = getOfferLocal(row.id);
    const price = offer.price || "";
    const text = offer.text || "";

    const html = `
<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Angebot</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
  body{ font-family:Inter,Arial,sans-serif; margin:28px; color:#0f172a }
  .h{ font-size:18px; font-weight:950 }
  .m{ color:#64748b; font-weight:800; margin-top:4px }
  .box{ border:1px solid #e7eaf0; border-radius:14px; padding:14px; margin-top:12px }
  .row{ display:flex; justify-content:space-between; gap:12px; margin-top:8px }
  .hr{ height:1px; background:#e7eaf0; margin:16px 0 }
</style></head><body>
  <div class="h">${esc(cs.company_name || cs.name || "Firma")}</div>
  <div class="m">${esc(cs.address || "")}</div>
  <div class="m">${esc(cs.phone || "")}${cs.email ? " . " + esc(cs.email) : ""}</div>

  <div class="hr"></div>

  <div class="box">
    <div class="h">Kunde</div>
    <div class="row"><div>Name</div><div>${esc(name)}</div></div>
    <div class="row"><div>Telefon</div><div>${esc(phone || "-")}</div></div>
    <div class="row"><div>E-Mail</div><div>${esc(email || "-")}</div></div>
    <div class="row"><div>Erstellt</div><div>${esc(created)}</div></div>
  </div>

  <div class="box">
    <div class="h">Umzug</div>
    <div class="row"><div>Datum</div><div>${esc(move || "-")}</div></div>
  </div>

  <div class="box">
    <div class="h">Route</div>
    <div class="row"><div>Beladestelle</div><div>${esc(from || "-")}</div></div>
    <div class="row"><div>Entladestelle</div><div>${esc(to || "-")}</div></div>
  </div>

  <div class="box">
    <div class="h">Angebot</div>
    <div class="row"><div>Preis (Brutto)</div><div>${esc(price || "-")}</div></div>
    <div style="margin-top:10px">${esc(text || "").replace(/\n/g, "<br>")}</div>
    ${cs.iban ? `<div class="m" style="margin-top:12px">IBAN: ${esc(cs.iban)}</div>` : ""}
  </div>

  <script>window.print()</script>
</body></html>
    `;

    const w = window.open("", "_blank");
    if (!w) return toast("Popups blockiert.");
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  function bindUI() {
    if (UI.btnLogin) UI.btnLogin.onclick = () => login().catch((e) => showAuth(e?.message || "Login Fehler."));
    if (UI.btnLogout) UI.btnLogout.onclick = () => logout();
    if (UI.btnLogoutTop) UI.btnLogoutTop.onclick = () => logout();

    UI.tabs.forEach((t) => (t.onclick = () => setView(t.dataset.tab)));

    if (UI.btnRefresh) UI.btnRefresh.onclick = () => fetchLeads().catch((e) => toast("Fehler: " + (e?.message || e)));
    if (UI.q) UI.q.oninput = () => renderLeads();
    if (UI.btnSearchFocus) UI.btnSearchFocus.onclick = () => UI.q?.focus();

    if (UI.btnSetSave) UI.btnSetSave.onclick = () => saveCompanySettings().catch((e) => toast("Fehler: " + (e?.message || e)));
    if (UI.btnSetReload) UI.btnSetReload.onclick = () => loadCompanySettings().then(() => toast("Geladen.")).catch((e) => toast("Fehler: " + (e?.message || e)));
    if (UI.btnReloadSettings) UI.btnReloadSettings.onclick = () => loadCompanySettings().then(() => toast("Geladen.")).catch((e) => toast("Fehler: " + (e?.message || e)));

    if (UI.btnBack) UI.btnBack.onclick = () => closeDetail();
    if (UI.btnDetailMore) UI.btnDetailMore.onclick = () => openSheet();
    if (UI.btnCloseSheet) UI.btnCloseSheet.onclick = () => closeSheet();
    if (UI.moreSheet) UI.moreSheet.onclick = (e) => {
      if (e.target === UI.moreSheet) closeSheet();
    };

    if (UI.btnCloseMenu) UI.btnCloseMenu.onclick = () => closeMenu();
    if (UI.menuSheet) UI.menuSheet.onclick = (e) => {
      if (e.target === UI.menuSheet) closeMenu();
    };

    document.querySelectorAll("[data-open-menu]").forEach((b) => (b.onclick = () => openMenu()));
    document.querySelectorAll("[data-nav]").forEach((b) => (b.onclick = () => {
      setView(b.dataset.nav);
      closeMenu();
    }));

    if (UI.btnOfferHelp) UI.btnOfferHelp.onclick = () => toast("Öffne zuerst einen Lead. Danach Angebot speichern.");
    if (UI.btnOfferSave) UI.btnOfferSave.onclick = () => {
      if (!STATE.selected) return toast("Öffne zuerst einen Lead.");
      setOfferLocal(STATE.selected.id, {
        price: (UI.offerPrice?.value || "").trim(),
        text: (UI.offerText?.value || "").trim(),
        ts: new Date().toISOString(),
      });
      toast("Gespeichert (lokal).");
    };
    if (UI.btnOfferPdf) UI.btnOfferPdf.onclick = () => {
      if (!STATE.selected) return toast("Öffne zuerst einen Lead.");
      openPdf(STATE.selected);
    };
  }

  async function afterLogin() {
    const { data, error } = await STATE.sb.auth.getUser();
    if (error) throw error;
    STATE.user = data.user;
    if (!STATE.user) throw new Error("Kein User.");

    await checkAccess();
    await loadCompanySettings();
    await fetchLeads();

    showApp();
    setView("start");
    toast("OK");
  }

  async function init() {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || String(SUPABASE_ANON_KEY).includes("PASTE_")) {
      showAuth("Setze window.SUPABASE_ANON_KEY oben.");
      return;
    }

    if (!window.supabase || !window.supabase.createClient) {
      showAuth("supabase.js fehlt. Lade /anfrage/vendor/supabase.js hoch.");
      return;
    }

    STATE.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, storageKey: "ab_admin_mobile_uledkuegmaritmsjejlm" },
    });

    bindUI();

    const { data } = await STATE.sb.auth.getSession();
    if (!data?.session) {
      showAuth();
      return;
    }

    try {
      await afterLogin();
    } catch (e) {
      showAuth(e?.message || "Login Fehler.");
    }
  }

  init().catch((e) => showAuth(e?.message || "Init Fehler."));
})();