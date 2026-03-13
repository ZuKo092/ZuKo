/* ============================================================
   admin-notifications.js — Notification Settings for AnfrageBox
   IIFE. Hooks into window.__AB_APP.
   Adds "Benachrichtigungen" card to Settings view.
   ============================================================ */
(() => {
  "use strict";

  function app() { return window.__AB_APP || {}; }
  function sb() { return app().sb || window.__abSupabase; }
  function state() { return app().state || {}; }
  function companyId() { return state().companyId; }
  function userId() { return state().user?.id || null; }
  function showNotice(m, t) { if (typeof app().showNotice === "function") app().showNotice(m, t); }

  const TABLE = "notification_preferences";

  /* ── State ── */
  let prefs = null; // current user's prefs row or null
  let initialized = false;

  /* ── Inject UI into Settings view ── */
  function injectCard() {
    const settingsView = document.getElementById("settingsTabNotif") || document.getElementById("viewSettings");
    if (!settingsView) return;

    // Find the placeholder or append
    const placeholder = document.getElementById("notifTabPlaceholder");
    const insertTarget = placeholder || settingsView;

    const card = document.createElement("div");
    card.className = "card";
    card.id = "notifSettingsCard";
    card.style.marginBottom = "16px";
    card.innerHTML = `
      <div class="cardHead">
        <div>
          <p class="h">Benachrichtigungen</p>
          <p class="sub" id="notifSettingsHint">Laden...</p>
        </div>
      </div>
      <div class="cardBody">
        <div style="display:flex;flex-direction:column;gap:16px;">

          <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 16px;background:var(--bg-subtle);border-radius:var(--r-md);border:1px solid var(--line);">
            <div style="flex:1;min-width:0;">
              <div style="font-size:14px;font-weight:700;color:var(--text);">Neue Anfragen</div>
              <div style="font-size:12px;color:var(--text-3);margin-top:2px;">E-Mail bei jeder neuen Anfrage</div>
            </div>
            <label style="position:relative;display:inline-block;width:48px;height:28px;flex-shrink:0;cursor:pointer;">
              <input type="checkbox" id="notifToggleNewLead" style="opacity:0;width:0;height:0;">
              <span id="notifToggleTrack" style="position:absolute;inset:0;background:#d1d5db;border-radius:14px;transition:.2s;"></span>
              <span id="notifToggleThumb" style="position:absolute;top:2px;left:2px;width:24px;height:24px;background:#fff;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,.15);transition:.2s;"></span>
            </label>
          </div>

          <div id="notifEmailField" class="field" style="margin-top:0;display:none;">
            <label style="font-size:12px;font-weight:700;color:var(--text-3);">E-Mail für Benachrichtigungen</label>
            <input class="input" id="notifEmail" type="email" placeholder="ihre@email.de" style="margin-top:4px;" />
            <div style="font-size:11px;color:var(--text-4);margin-top:4px;">An diese Adresse werden Lead-Benachrichtigungen gesendet.</div>
          </div>

          <div id="notifQuietSection" style="display:none;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
              <input type="checkbox" id="notifQuietEnabled" style="width:16px;height:16px;accent-color:var(--brand);cursor:pointer;">
              <label for="notifQuietEnabled" style="font-size:13px;font-weight:600;color:var(--text-2);cursor:pointer;">Ruhezeiten aktivieren</label>
            </div>
            <div id="notifQuietFields" class="row2" style="display:none;">
              <div class="field" style="margin-top:0;">
                <label style="font-size:12px;font-weight:700;color:var(--text-3);">Von</label>
                <input class="input" id="notifQuietStart" type="time" value="22:00" style="margin-top:4px;" />
              </div>
              <div class="field" style="margin-top:0;">
                <label style="font-size:12px;font-weight:700;color:var(--text-3);">Bis</label>
                <input class="input" id="notifQuietEnd" type="time" value="07:00" style="margin-top:4px;" />
              </div>
            </div>
            <div style="font-size:11px;color:var(--text-4);margin-top:4px;">Keine E-Mails während dieser Zeit.</div>
          </div>

          <div style="display:flex;gap:8px;">
            <button class="btn green" id="notifSave" type="button" style="height:36px;padding:0 20px;font-size:13px;font-weight:800;">Speichern</button>
            <div id="notifSaveHint" style="font-size:12px;color:var(--text-4);display:flex;align-items:center;"></div>
          </div>

        </div>
      </div>
    `;

    // Insert the notification card
    if (insertTarget === placeholder) {
      insertTarget.replaceWith(card);
    } else {
      insertTarget.appendChild(card);
    }

    wireEvents();
  }

  /* ── Toggle switch visual ── */
  function updateToggleVisual(checked) {
    const track = document.getElementById("notifToggleTrack");
    const thumb = document.getElementById("notifToggleThumb");
    if (!track || !thumb) return;
    if (checked) {
      track.style.background = "var(--brand)";
      thumb.style.left = "22px";
    } else {
      track.style.background = "#d1d5db";
      thumb.style.left = "2px";
    }
  }

  /* ── Wire UI events ── */
  function wireEvents() {
    const toggle = document.getElementById("notifToggleNewLead");
    const emailField = document.getElementById("notifEmailField");
    const quietSection = document.getElementById("notifQuietSection");
    const quietEnabled = document.getElementById("notifQuietEnabled");
    const quietFields = document.getElementById("notifQuietFields");
    const saveBtn = document.getElementById("notifSave");

    if (toggle) {
      toggle.addEventListener("change", () => {
        const on = toggle.checked;
        updateToggleVisual(on);
        if (emailField) emailField.style.display = on ? "" : "none";
        if (quietSection) quietSection.style.display = on ? "" : "none";
      });
    }

    if (quietEnabled) {
      quietEnabled.addEventListener("change", () => {
        if (quietFields) quietFields.style.display = quietEnabled.checked ? "grid" : "none";
      });
    }

    if (saveBtn) saveBtn.addEventListener("click", savePrefs);
  }

  /* ── Load preferences ── */
  async function loadPrefs() {
    const s = sb();
    const uid = userId();
    const cid = companyId();
    if (!s || !uid || !cid) return;

    const hint = document.getElementById("notifSettingsHint");
    if (hint) hint.textContent = "Laden...";

    try {
      const { data, error } = await s
        .from(TABLE)
        .select("*")
        .eq("user_id", uid)
        .eq("company_id", cid)
        .maybeSingle();

      if (error) {
        // Table might not exist yet
        if (hint) hint.textContent = "Tabelle wird erstellt...";
        console.warn("notification_preferences load error:", error.message);
        applyDefaults();
        return;
      }

      prefs = data;
      applyToUI(data);
      if (hint) hint.textContent = data ? "Gespeichert" : "Standard-Einstellungen";
    } catch (err) {
      if (hint) hint.textContent = "Fehler beim Laden";
      console.error("loadPrefs:", err);
      applyDefaults();
    }
  }

  /* ── Apply loaded prefs to UI ── */
  function applyToUI(data) {
    const toggle = document.getElementById("notifToggleNewLead");
    const emailInput = document.getElementById("notifEmail");
    const emailField = document.getElementById("notifEmailField");
    const quietSection = document.getElementById("notifQuietSection");
    const quietEnabled = document.getElementById("notifQuietEnabled");
    const quietFields = document.getElementById("notifQuietFields");
    const quietStart = document.getElementById("notifQuietStart");
    const quietEnd = document.getElementById("notifQuietEnd");

    const isOn = data ? !!data.notify_new_lead : true; // default on

    if (toggle) {
      toggle.checked = isOn;
      updateToggleVisual(isOn);
    }

    if (emailInput) {
      emailInput.value = data?.notify_email || state().user?.email || "";
    }

    if (emailField) emailField.style.display = isOn ? "" : "none";
    if (quietSection) quietSection.style.display = isOn ? "" : "none";

    const hasQuiet = data?.quiet_hours_start && data?.quiet_hours_end;
    if (quietEnabled) quietEnabled.checked = !!hasQuiet;
    if (quietFields) quietFields.style.display = hasQuiet ? "grid" : "none";
    if (quietStart) quietStart.value = data?.quiet_hours_start || "22:00";
    if (quietEnd) quietEnd.value = data?.quiet_hours_end || "07:00";
  }

  function applyDefaults() {
    applyToUI(null);
  }

  /* ── Save preferences ── */
  async function savePrefs() {
    const s = sb();
    const uid = userId();
    const cid = companyId();
    if (!s || !uid || !cid) { showNotice("Nicht verbunden.", "err"); return; }

    const saveBtn = document.getElementById("notifSave");
    const saveHint = document.getElementById("notifSaveHint");
    const hint = document.getElementById("notifSettingsHint");

    const toggle = document.getElementById("notifToggleNewLead");
    const emailInput = document.getElementById("notifEmail");
    const quietEnabled = document.getElementById("notifQuietEnabled");
    const quietStart = document.getElementById("notifQuietStart");
    const quietEnd = document.getElementById("notifQuietEnd");

    const isOn = toggle?.checked ?? true;
    const email = (emailInput?.value || "").trim();

    if (isOn && (!email || !email.includes("@"))) {
      showNotice("Bitte gültige E-Mail eingeben.", "err");
      return;
    }

    const row = {
      user_id: uid,
      company_id: cid,
      notify_new_lead: isOn,
      notify_email: email || (state().user?.email || ""),
      quiet_hours_start: isOn && quietEnabled?.checked ? (quietStart?.value || null) : null,
      quiet_hours_end: isOn && quietEnabled?.checked ? (quietEnd?.value || null) : null,
    };

    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "..."; }

    try {
      let result;
      if (prefs?.id) {
        // Update existing
        const { data, error } = await s
          .from(TABLE)
          .update({
            notify_new_lead: row.notify_new_lead,
            notify_email: row.notify_email,
            quiet_hours_start: row.quiet_hours_start,
            quiet_hours_end: row.quiet_hours_end,
          })
          .eq("id", prefs.id)
          .select("*")
          .single();
        if (error) throw error;
        result = data;
      } else {
        // Insert new
        const { data, error } = await s
          .from(TABLE)
          .upsert(row, { onConflict: "user_id,company_id" })
          .select("*")
          .single();
        if (error) throw error;
        result = data;
      }

      prefs = result;
      showNotice("Benachrichtigungen gespeichert.", "ok");
      if (hint) hint.textContent = "Gespeichert";
      if (saveHint) { saveHint.textContent = "Gespeichert"; setTimeout(() => { saveHint.textContent = ""; }, 2000); }
    } catch (err) {
      console.error("savePrefs:", err);
      showNotice("Fehler: " + (err.message || err), "err");
      if (hint) hint.textContent = "Fehler beim Speichern";
    }

    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "Speichern"; }
  }

  /* ── Boot ── */
  function boot() {
    if (initialized) return;
    initialized = true;
    injectCard();

    // Load prefs when settings view becomes visible
    const navSettings = document.getElementById("navSettings");
    if (navSettings) {
      navSettings.addEventListener("click", () => {
        setTimeout(loadPrefs, 200);
      });
    }

    // Also load if settings is already active (e.g. hash navigation)
    const settingsView = document.getElementById("viewSettings");
    if (settingsView?.classList.contains("active")) {
      setTimeout(loadPrefs, 500);
    }

    // Load when app is ready
    const waitForApp = () => {
      if (userId() && companyId()) {
        // Preload silently
      } else {
        setTimeout(waitForApp, 1000);
      }
    };
    waitForApp();
  }

  if (document.readyState === "loading") window.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.__AB_Notifications = { load: loadPrefs, save: savePrefs };
})();