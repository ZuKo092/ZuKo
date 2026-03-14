(() => {
  "use strict";

  const COMPANY_ID =
    (window.__AB_APP && window.__AB_APP.companyId) ||
    "0632a3c1-2734-4303-9341-f1b2db7f977a";

  const DRAFT_KEY = `ab_offer_draft_${COMPANY_ID}`;

  const $ = (id) => document.getElementById(id);

  const UI = {
    viewOffer: $("viewOffer"),

    fromStreet: $("o_from_street"),
    fromNo: $("o_from_no"),
    fromZip: $("o_from_zip"),
    fromCity: $("o_from_city"),
    fromFloor: $("o_from_floor"),
    fromLift: $("o_from_lift"),

    toStreet: $("o_to_street"),
    toNo: $("o_to_no"),
    toZip: $("o_to_zip"),
    toCity: $("o_to_city"),
    toFloor: $("o_to_floor"),
    toLift: $("o_to_lift"),

    customerName: $("o_name"),
    customerPhone: $("o_phone"),
    customerEmail: $("o_email"),
    moveDate: $("o_move_date"),

    price: $("o_price"),
    text: $("o_text"),
    status: $("o_status"),

    invEditor: $("o_invEditor"),
    invAddRoomBtn: $("invAddRoomBtn"),

    btnSaveDraft: $("o_saveDraft"),
    btnResetDraft: $("o_resetDraft"),
    btnPdf: $("o_pdf"),
    btnSaveLead: $("o_saveLead"),
  };

  const PRESET_ITEMS = {
    Wohnzimmer: ["Sofa", "Couch", "Sessel", "Couchtisch", "TV", "TV-Board", "Regal", "Schrank", "Esstisch", "Stühle", "Teppich", "Stehlampe"],
    Schlafzimmer: ["Bett", "Matratze", "Lattenrost", "Nachttisch", "Kleiderschrank", "Kommode", "Spiegel", "Regal"],
    Küche: ["Kühlschrank", "Gefrierschrank", "Herd", "Backofen", "Spülmaschine", "Mikrowelle", "Küchenschrank", "Esstisch", "Stühle"],
    Bad: ["Waschmaschine", "Trockner", "Spiegelschrank", "Waschbeckenunterschrank", "Regal"],
    Kinderzimmer: ["Kinderbett", "Schreibtisch", "Stuhl", "Kleiderschrank", "Kommode", "Regal", "Spielzeugkiste"],
    Büro: ["Schreibtisch", "Bürostuhl", "Regal", "Aktenschrank", "Drucker", "Monitor", "PC"],
    Flur: ["Garderobe", "Schuhschrank", "Spiegel", "Kommode", "Bank"],
    Keller: ["Regal", "Werkbank", "Kühlschrank", "Kartons", "Reifen", "Fahrrad", "Koffer"],
    Balkon: ["Balkontisch", "Balkonstühle", "Grill", "Pflanzen", "Sonnenschirm"],
    Garage: ["Regal", "Werkzeugkiste", "Werkbank", "Reifen", "Fahrrad", "Kinderwagen"],
    Garten: ["Gartentisch", "Gartenstühle", "Lounge-Set", "Rasenmäher", "Schubkarre", "Gerätebox", "Pflanzen"],
    Abstellraum: ["Regal", "Staubsauger", "Putzschrank", "Kartons"],
    Dachboden: ["Kartons", "Koffer", "Regal", "Kommode"],
    Sonstiges: ["Kartons", "Koffer", "Sportgeräte", "Musikinstrument", "Aquarium", "Safe"],
  };

  const STATE = {
    rooms: [],
    items: {},
    qty: {},
    svc: {},
    activeRoom: "",
    showAddRoom: false,
  };

  function notify(msg, type = "ok") {
    if (window.__AB_APP && typeof window.__AB_APP.showNotice === "function") {
      window.__AB_APP.showNotice(msg, type);
      return;
    }
    console[type === "err" ? "error" : "log"](msg);
  }

  function escapeHtml(v) {
    return String(v ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function safeInt(v, fallback = 1) {
    const n = Number(String(v ?? "").trim().replace(",", "."));
    return Number.isFinite(n) ? Math.max(1, Math.round(n)) : fallback;
  }

  function formatEuro(v) {
    const raw = String(v ?? "").trim().replace(",", ".");
    const n = Number(raw);
    if (!Number.isFinite(n)) return raw ? `${raw} €` : "—";
    return n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
  }

  function formatDateDE(v) {
    if (!v) return "";
    const s = String(v).trim();

    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return `${iso[3]}.${iso[2]}.${iso[1]}`;

    const dot = s.match(/^(\d{4})\.(\d{2})\.(\d{2})$/);
    if (dot) return `${dot[3]}.${dot[2]}.${dot[1]}`;

    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d.toLocaleDateString("de-DE");

    return s;
  }

  function getCompanySettings() {
    if (window.__AB_APP && typeof window.__AB_APP.getCompanySettings === "function") {
      return window.__AB_APP.getCompanySettings() || {};
    }
    try {
      const raw = localStorage.getItem(`ab_company_settings_${COMPANY_ID}`);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function openPdf(html) {
    if (window.__AB_APP && typeof window.__AB_APP.openPdf === "function") {
      window.__AB_APP.openPdf(html);
      return;
    }
    notify("PDF Modal fehlt.", "err");
  }

  function ensureRoom(roomName) {
    const room = String(roomName || "").trim();
    if (!room) return;

    if (!STATE.rooms.includes(room)) STATE.rooms.push(room);
    if (!Array.isArray(STATE.items[room])) STATE.items[room] = [];
    if (!STATE.qty[room] || typeof STATE.qty[room] !== "object") STATE.qty[room] = {};
    if (!STATE.svc[room] || typeof STATE.svc[room] !== "object") STATE.svc[room] = {};
    if (!STATE.activeRoom) STATE.activeRoom = room;
  }

  function ensureAtLeastOneRoom() {
    if (STATE.rooms.length) return;
    ensureRoom("Wohnzimmer");
    STATE.activeRoom = "Wohnzimmer";
    STATE.showAddRoom = false;
  }

  function getActiveRoom() {
    if (STATE.activeRoom && STATE.rooms.includes(STATE.activeRoom)) return STATE.activeRoom;
    STATE.activeRoom = STATE.rooms[0] || "";
    return STATE.activeRoom;
  }

  function getPresetItems(room) {
    const key = String(room || "").trim();
    return PRESET_ITEMS[key] ? PRESET_ITEMS[key].slice() : PRESET_ITEMS.Sonstiges.slice();
  }

  function addRoom(roomName) {
    const room = String(roomName || "").trim();
    if (!room) return false;
    ensureRoom(room);
    STATE.activeRoom = room;
    STATE.showAddRoom = false;
    return true;
  }

  function removeRoom(roomName) {
    const room = String(roomName || "").trim();
    if (!room || !STATE.rooms.includes(room)) return;

    STATE.rooms = STATE.rooms.filter((r) => r !== room);
    delete STATE.items[room];
    delete STATE.qty[room];
    delete STATE.svc[room];

    STATE.activeRoom = STATE.rooms[0] || "";
    if (!STATE.rooms.length) {
      ensureAtLeastOneRoom();
    }
  }

  function addItem(roomName, itemName) {
    const room = String(roomName || "").trim();
    const item = String(itemName || "").trim();
    if (!room || !item) return false;

    ensureRoom(room);

    if (!STATE.items[room].includes(item)) {
      STATE.items[room].push(item);
    }
    if (!STATE.qty[room][item]) STATE.qty[room][item] = 1;
    if (STATE.svc[room][item] == null) STATE.svc[room][item] = "";

    return true;
  }

  function removeItem(roomName, itemName) {
    const room = String(roomName || "").trim();
    const item = String(itemName || "").trim();
    if (!room || !item) return;

    STATE.items[room] = (STATE.items[room] || []).filter((x) => x !== item);
    if (STATE.qty[room]) delete STATE.qty[room][item];
    if (STATE.svc[room]) delete STATE.svc[room][item];
  }

  function renameItem(roomName, oldItemName, newItemName) {
    const room = String(roomName || "").trim();
    const oldItem = String(oldItemName || "").trim();
    const newItem = String(newItemName || "").trim();

    if (!room || !oldItem || !newItem) return false;
    if (oldItem === newItem) return true;

    const list = STATE.items[room] || [];
    const idx = list.indexOf(oldItem);
    if (idx < 0) return false;

    if (list.includes(newItem)) {
      const qOld = safeInt(STATE.qty?.[room]?.[oldItem] ?? 1, 1);
      const qNew = safeInt(STATE.qty?.[room]?.[newItem] ?? 1, 1);
      STATE.qty[room][newItem] = qOld + qNew;
      if (!STATE.svc[room][newItem]) STATE.svc[room][newItem] = STATE.svc[room][oldItem] || "";
      removeItem(room, oldItem);
      return true;
    }

    STATE.items[room][idx] = newItem;
    STATE.qty[room][newItem] = STATE.qty[room][oldItem] ?? 1;
    STATE.svc[room][newItem] = STATE.svc[room][oldItem] ?? "";
    delete STATE.qty[room][oldItem];
    delete STATE.svc[room][oldItem];

    return true;
  }

  function setQty(roomName, itemName, qty) {
    const room = String(roomName || "").trim();
    const item = String(itemName || "").trim();
    if (!room || !item) return;
    ensureRoom(room);
    STATE.qty[room][item] = safeInt(qty, 1);
  }

  function setSvc(roomName, itemName, svc) {
    const room = String(roomName || "").trim();
    const item = String(itemName || "").trim();
    if (!room || !item) return;
    ensureRoom(room);
    STATE.svc[room][item] =
      svc === "demontage" || svc === "montage" || svc === "beides" ? svc : "";
  }

  function collectDraft() {
    return {
      from: {
        street: UI.fromStreet?.value || "",
        no: UI.fromNo?.value || "",
        zip: UI.fromZip?.value || "",
        city: UI.fromCity?.value || "",
        floor: UI.fromFloor?.value || "",
        lift: UI.fromLift?.value || "",
      },
      to: {
        street: UI.toStreet?.value || "",
        no: UI.toNo?.value || "",
        zip: UI.toZip?.value || "",
        city: UI.toCity?.value || "",
        floor: UI.toFloor?.value || "",
        lift: UI.toLift?.value || "",
      },
      customer: {
        name: UI.customerName?.value || "",
        phone: UI.customerPhone?.value || "",
        email: UI.customerEmail?.value || "",
      },
      move_date: UI.moveDate?.value || "",
      price: UI.price?.value || "",
      text: UI.text?.value || "",
      status: UI.status?.value || "Angebot gesendet",
      inv: {
        rooms: [...STATE.rooms],
        items: deepClone(STATE.items),
        qty: deepClone(STATE.qty),
        svc: deepClone(STATE.svc),
      },
    };
  }

  function applyDraft(draft) {
    const d = draft || {};

    if (UI.fromStreet) UI.fromStreet.value = d.from?.street || "";
    if (UI.fromNo) UI.fromNo.value = d.from?.no || "";
    if (UI.fromZip) UI.fromZip.value = d.from?.zip || "";
    if (UI.fromCity) UI.fromCity.value = d.from?.city || "";
    if (UI.fromFloor) UI.fromFloor.value = d.from?.floor || "";
    if (UI.fromLift) UI.fromLift.value = d.from?.lift || "";

    if (UI.toStreet) UI.toStreet.value = d.to?.street || "";
    if (UI.toNo) UI.toNo.value = d.to?.no || "";
    if (UI.toZip) UI.toZip.value = d.to?.zip || "";
    if (UI.toCity) UI.toCity.value = d.to?.city || "";
    if (UI.toFloor) UI.toFloor.value = d.to?.floor || "";
    if (UI.toLift) UI.toLift.value = d.to?.lift || "";

    if (UI.customerName) UI.customerName.value = d.customer?.name || "";
    if (UI.customerPhone) UI.customerPhone.value = d.customer?.phone || "";
    if (UI.customerEmail) UI.customerEmail.value = d.customer?.email || "";
    if (UI.moveDate) UI.moveDate.value = d.move_date || "";
    if (UI.price) UI.price.value = d.price || "";
    if (UI.text) UI.text.value = d.text || "";
    if (UI.status) UI.status.value = d.status || "Angebot gesendet";

    STATE.rooms = Array.isArray(d.inv?.rooms) ? d.inv.rooms.map(String).filter(Boolean) : [];
    STATE.items = d.inv?.items && typeof d.inv.items === "object" ? d.inv.items : {};
    STATE.qty = d.inv?.qty && typeof d.inv.qty === "object" ? d.inv.qty : {};
    STATE.svc = d.inv?.svc && typeof d.inv.svc === "object" ? d.inv.svc : {};
    STATE.activeRoom = STATE.rooms[0] || "";
    STATE.showAddRoom = !STATE.rooms.length;

    ensureAtLeastOneRoom();
  }

  function loadDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) {
        ensureAtLeastOneRoom();
        return;
      }
      applyDraft(JSON.parse(raw));
    } catch {
      ensureAtLeastOneRoom();
    }
  }

  function saveDraft() {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(collectDraft()));
      notify("Draft gespeichert.", "ok");
    } catch {
      notify("Draft speichern fehlgeschlagen.", "err");
    }
  }

  function resetDraft() {
    localStorage.removeItem(DRAFT_KEY);

    if (UI.fromStreet) UI.fromStreet.value = "";
    if (UI.fromNo) UI.fromNo.value = "";
    if (UI.fromZip) UI.fromZip.value = "";
    if (UI.fromCity) UI.fromCity.value = "";
    if (UI.fromFloor) UI.fromFloor.value = "";
    if (UI.fromLift) UI.fromLift.value = "";

    if (UI.toStreet) UI.toStreet.value = "";
    if (UI.toNo) UI.toNo.value = "";
    if (UI.toZip) UI.toZip.value = "";
    if (UI.toCity) UI.toCity.value = "";
    if (UI.toFloor) UI.toFloor.value = "";
    if (UI.toLift) UI.toLift.value = "";

    if (UI.customerName) UI.customerName.value = "";
    if (UI.customerPhone) UI.customerPhone.value = "";
    if (UI.customerEmail) UI.customerEmail.value = "";
    if (UI.moveDate) UI.moveDate.value = "";
    if (UI.price) UI.price.value = "";
    if (UI.text) UI.text.value = "";
    if (UI.status) UI.status.value = "Angebot gesendet";

    STATE.rooms = [];
    STATE.items = {};
    STATE.qty = {};
    STATE.svc = {};
    STATE.activeRoom = "";
    STATE.showAddRoom = false;

    ensureAtLeastOneRoom();
    renderInventory();
    notify("Reset.", "ok");
  }

  function renderInventory() {
    if (!UI.invEditor) return;

    ensureAtLeastOneRoom();
    const activeRoom = getActiveRoom();
    const currentItems = Array.isArray(STATE.items[activeRoom]) ? STATE.items[activeRoom] : [];
    const presets = getPresetItems(activeRoom);

    const roomTabs = STATE.rooms.map((room) => {
      const count = Array.isArray(STATE.items[room]) ? STATE.items[room].length : 0;
      return `
        <button type="button" class="roomPill ${room === activeRoom ? "active" : ""}" data-act="room-tab" data-room="${escapeHtml(room)}">
          <span>${escapeHtml(room)}</span>
          <span class="roomBadge">${count}</span>
        </button>
      `;
    }).join("");

    const itemRows = currentItems.length
      ? currentItems.map((item) => {
          const qty = safeInt(STATE.qty?.[activeRoom]?.[item] ?? 1, 1);
          const svc = String(STATE.svc?.[activeRoom]?.[item] || "");

          return `
            <div class="itemRow">
              <input
                class="input"
                data-k="item-name"
                data-room="${escapeHtml(activeRoom)}"
                data-item="${escapeHtml(item)}"
                value="${escapeHtml(item)}"
              />

              <div class="itemQtyWrap">
                <button class="btn" type="button" data-act="qty-dec" data-room="${escapeHtml(activeRoom)}" data-item="${escapeHtml(item)}">−</button>
                <input
                  class="input"
                  data-k="item-qty"
                  data-room="${escapeHtml(activeRoom)}"
                  data-item="${escapeHtml(item)}"
                  value="${escapeHtml(String(qty))}"
                />
                <button class="btn" type="button" data-act="qty-inc" data-room="${escapeHtml(activeRoom)}" data-item="${escapeHtml(item)}">+</button>
              </div>

              <div class="itemServiceWrap">
                <select
                  class="select"
                  data-k="item-svc"
                  data-room="${escapeHtml(activeRoom)}"
                  data-item="${escapeHtml(item)}"
                  style="min-width:0;width:100%;"
                >
                  <option value="" ${svc === "" ? "selected" : ""}>Nur Transport</option>
                  <option value="demontage" ${svc === "demontage" ? "selected" : ""}>Demontage</option>
                  <option value="montage" ${svc === "montage" ? "selected" : ""}>Montage</option>
                  <option value="beides" ${svc === "beides" ? "selected" : ""}>Demontage + Montage</option>
                </select>
              </div>

              <button class="btn danger itemRemove" type="button" data-act="item-remove" data-room="${escapeHtml(activeRoom)}" data-item="${escapeHtml(item)}">×</button>
            </div>
          `;
        }).join("")
      : `<div class="roomSectionSub">Noch keine Möbel in diesem Raum.</div>`;

    UI.invEditor.innerHTML = `
      <div class="offerInventoryWrap">
        <div class="offerInventoryBody">
          <div class="invTopBar">
            <div class="roomTabs">
              ${roomTabs}
              <button type="button" class="roomPill" data-act="room-show-add">+ Raum</button>
            </div>
          </div>

          <div class="roomAddCard" style="${STATE.showAddRoom ? "" : "display:none;"}">
            <div class="roomAddRow">
              <input class="input" id="o_new_room" placeholder="z.B. Wohnzimmer" style="max-width:320px;" />
              <button class="btn" id="o_add_room_confirm" type="button">Raum hinzufügen</button>
            </div>
          </div>

          <div class="roomSection">
            <div class="roomSectionHead">
              <div>
                <div class="roomSectionTitle">${escapeHtml(activeRoom)}</div>
                <div class="roomSectionSub">Möbel, Menge, Service</div>
              </div>
              <div style="display:flex;gap:10px;flex-wrap:wrap;">
                <button class="btn" type="button" data-act="room-clear" data-room="${escapeHtml(activeRoom)}">Leeren</button>
                <button class="btn danger" type="button" data-act="room-remove" data-room="${escapeHtml(activeRoom)}">Raum löschen</button>
              </div>
            </div>

            <div class="roomSectionBody">
              <div class="itemAddBar">
                <input class="input" id="o_item_custom" placeholder="Möbel eingeben..." />
                <button class="btn" id="o_add_custom_item" type="button">Hinzufügen</button>

                <select class="select" id="o_item_preset" style="min-width:0;width:100%;">
                  <option value="">Standardmöbel wählen...</option>
                  ${presets.map((it) => `<option value="${escapeHtml(it)}">${escapeHtml(it)}</option>`).join("")}
                </select>

                <button class="btn" id="o_add_preset_item" type="button">+</button>
              </div>

              <div class="itemRows">${itemRows}</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function buildOfferPdfHtml(d) {
    if (window.AnfrageBoxPdf && typeof window.AnfrageBoxPdf.build === "function") {
      return window.AnfrageBoxPdf.build(d, getCompanySettings(), {});
    }
    // Fallback: minimal version if unified script not loaded
    return "<div style='padding:40px;font-family:Inter,sans-serif;'><h1>Angebot</h1><p>PDF-Modul nicht geladen. Bitte Seite neu laden.</p></div>";
  }

  function previewPdf() {
    const draft = collectDraft();
    openPdf(buildOfferPdfHtml(draft));
  }

  function buildLeadInsert(d) {
    const pickup_address = {
      street: d.from.street,
      number: d.from.no,
      zip: d.from.zip,
      city: d.from.city,
      floor: d.from.floor || "",
      lift: d.from.lift || "",
    };

    const dropoff_address = {
      street: d.to.street,
      number: d.to.no,
      zip: d.to.zip,
      city: d.to.city,
      floor: d.to.floor || "",
      lift: d.to.lift || "",
    };

    const payload = {
      source: "admin_offer",
      move_date: d.move_date || null,
      customer: d.customer,
      pickup_address,
      dropoff_address,
      selected_rooms: d.inv.rooms || [],
      room_items: d.inv.items || {},
      room_item_quantities: d.inv.qty || {},
      assembly_request: d.inv.svc || {},
      offer: { price: d.price || "", text: d.text || "" },
    };

    const summary_text = [
      d.customer?.name ? `Kunde: ${d.customer.name}` : "",
      d.move_date ? `Termin: ${d.move_date}` : "",
      (d.from.zip || d.from.city || d.to.zip || d.to.city)
        ? `Route: ${(d.from.zip || "")} ${(d.from.city || "")} -> ${(d.to.zip || "")} ${(d.to.city || "")}`
        : "",
    ]
      .filter(Boolean)
      .join(" | ");

    return {
      company_id: COMPANY_ID,
      status: d.status || "Angebot gesendet",
      move_date: d.move_date || null,
      pickup_address,
      dropoff_address,
      selected_rooms: d.inv.rooms || [],
      room_items: d.inv.items || {},
      room_item_quantities: d.inv.qty || {},
      assembly_request: d.inv.svc || {},
      payload,
      summary_text,
    };
  }

  async function saveAsLead() {
    const app = window.__AB_APP;
    const sb = app?.state?.sb || app?.sb || app?.__sb;

    if (!sb) {
      notify("Kein Supabase Client. Login nötig.", "err");
      return;
    }

    const d = collectDraft();

    if (
      !String(d.customer.name || "").trim() &&
      !String(d.customer.phone || "").trim() &&
      !String(d.customer.email || "").trim()
    ) {
      notify("Kunde fehlt.", "err");
      return;
    }

    try {
      const row = buildLeadInsert(d);
      const { data, error } = await sb.from("leads").insert(row).select("id").single();
      if (error) throw error;

      saveDraft();
      notify("Als Lead gespeichert: " + data.id, "ok");
    } catch (err) {
      notify("Speichern fehlgeschlagen: " + (err?.message || err), "err");
      console.error(err);
    }
  }

  function bindInventoryActions() {
    if (UI.invAddRoomBtn) {
      UI.invAddRoomBtn.addEventListener("click", () => {
        STATE.showAddRoom = true;
        renderInventory();
        const inp = document.getElementById("o_new_room");
        if (inp) inp.focus();
      });
    }

    if (!UI.invEditor) return;

    UI.invEditor.addEventListener("click", (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;

      const actEl = target.closest("[data-act]");
      if (actEl) {
        const act = String(actEl.dataset.act || "");
        const room = String(actEl.dataset.room || "");
        const item = String(actEl.dataset.item || "");

        if (act === "room-tab") {
          STATE.activeRoom = room;
          renderInventory();
          return;
        }

        if (act === "room-show-add") {
          STATE.showAddRoom = true;
          renderInventory();
          const inp = document.getElementById("o_new_room");
          if (inp) inp.focus();
          return;
        }

        if (act === "room-clear") {
          if (!room) return;
          STATE.items[room] = [];
          STATE.qty[room] = {};
          STATE.svc[room] = {};
          renderInventory();
          return;
        }

        if (act === "room-remove") {
          if (!room) return;
          removeRoom(room);
          renderInventory();
          return;
        }

        if (act === "item-remove") {
          if (!room || !item) return;
          removeItem(room, item);
          renderInventory();
          return;
        }

        if (act === "qty-dec") {
          const current = safeInt(STATE.qty?.[room]?.[item] ?? 1, 1);
          setQty(room, item, Math.max(1, current - 1));
          renderInventory();
          return;
        }

        if (act === "qty-inc") {
          const current = safeInt(STATE.qty?.[room]?.[item] ?? 1, 1);
          setQty(room, item, current + 1);
          renderInventory();
          return;
        }
      }

      const addRoomBtn = target.closest("#o_add_room_confirm");
      if (addRoomBtn) {
        const inp = document.getElementById("o_new_room");
        const value = String(inp?.value || "").trim();
        if (!value) return;
        addRoom(value);
        renderInventory();
        return;
      }

      const addCustomItemBtn = target.closest("#o_add_custom_item");
      if (addCustomItemBtn) {
        const room = getActiveRoom();
        const inp = document.getElementById("o_item_custom");
        const value = String(inp?.value || "").trim();
        if (!room || !value) return;
        addItem(room, value);
        if (inp) inp.value = "";
        renderInventory();
        return;
      }

      const addPresetItemBtn = target.closest("#o_add_preset_item");
      if (addPresetItemBtn) {
        const room = getActiveRoom();
        const sel = document.getElementById("o_item_preset");
        const value = String(sel?.value || "").trim();
        if (!room || !value) return;
        addItem(room, value);
        if (sel) sel.value = "";
        renderInventory();
      }
    });

    UI.invEditor.addEventListener("change", (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement) || !target.dataset) return;

      const k = String(target.dataset.k || "");
      const room = String(target.dataset.room || "");
      const item = String(target.dataset.item || "");

      if (k === "item-name") {
        const newValue = String(target.value || "").trim();
        if (!newValue) {
          target.value = item;
          return;
        }
        renameItem(room, item, newValue);
        renderInventory();
        return;
      }

      if (k === "item-qty") {
        setQty(room, item, target.value);
        return;
      }

      if (k === "item-svc") {
        setSvc(room, item, target.value);
      }
    });

    UI.invEditor.addEventListener("keydown", (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      if (e.key !== "Enter") return;

      if (target.id === "o_new_room") {
        e.preventDefault();
        const value = String(target.value || "").trim();
        if (!value) return;
        addRoom(value);
        renderInventory();
        return;
      }

      if (target.id === "o_item_custom") {
        e.preventDefault();
        const room = getActiveRoom();
        const value = String(target.value || "").trim();
        if (!room || !value) return;
        addItem(room, value);
        target.value = "";
        renderInventory();
      }
    });
  }

  function bindMainActions() {
    if (UI.btnSaveDraft) UI.btnSaveDraft.addEventListener("click", saveDraft);
    if (UI.btnResetDraft) UI.btnResetDraft.addEventListener("click", resetDraft);
    if (UI.btnPdf) UI.btnPdf.addEventListener("click", previewPdf);
    if (UI.btnSaveLead) UI.btnSaveLead.addEventListener("click", saveAsLead);
  }

  function boot() {
    if (!UI.viewOffer || !UI.invEditor) {
      console.error("viewOffer sau o_invEditor lipsesc.");
      return;
    }

    loadDraft();
    renderInventory();
    bindInventoryActions();
    bindMainActions();

    window.__AB_APP = window.__AB_APP || {};
    window.__AB_APP.buildOfferPdfHtml = buildOfferPdfHtml;


  }

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();