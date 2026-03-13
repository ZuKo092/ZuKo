/**
 * anfragebox-pdf-unified.js
 * Single source of truth for PDF HTML generation across admin, angebot, and portal.
 *
 * Usage:
 *   const html = window.AnfrageBoxPdf.build(draft, companySettings, options);
 *
 * draft = {
 *   from: { street, no, zip, city, floor, lift },
 *   to:   { street, no, zip, city, floor, lift },
 *   customer: { name, phone, email },
 *   move_date: string,
 *   price: string,
 *   text: string,
 *   status: string,
 *   inv: { rooms:[], items:{}, qty:{}, svc:{} }
 * }
 *
 * options = {
 *   signature: { png: "data:image/png;base64,...", name: "Max M.", date: "12.03.2026 14:30" } | null,
 *   isKleinunternehmer: false
 * }
 */
(function () {
  "use strict";

  function escapeHtml(v) {
    return String(v ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function euroFmt(n) {
    return Number.isFinite(n)
      ? n.toLocaleString("de-DE", { style: "currency", currency: "EUR" })
      : "—";
  }

  function formatDateDE(v) {
    if (!v) return "";
    const s = String(v).trim();
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return `${iso[3]}.${iso[2]}.${iso[1]}`;
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d.toLocaleDateString("de-DE");
    return s;
  }

  function svcLabel(v) {
    if (v === "demontage") return "Demontage";
    if (v === "montage") return "Montage";
    if (v === "beides") return "Demontage + Montage";
    return "Nur Transport";
  }

  function build(draft, companySettings, options) {
    const s = companySettings || {};
    const opts = options || {};
    const sig = opts.signature || null;
    const isKlein = !!opts.isKleinunternehmer;

    const brand = String(s.company_name || "Firma").trim();
    const companyStreet = String(s.street || "").trim();
    const companyCity = String(s.cityline || "").trim();
    const companyCountry = String(s.country || "Deutschland").trim();
    const companyPhone = String(s.phone || "").trim();
    const companyEmail = String(s.email || "").trim();
    const companyTax = String(s.tax_number || "").trim();
    const companyVat = String(s.vat_id || "").trim();
    const companyIban = String(s.iban || "").trim();
    const companyBic = String(s.bic || "").trim();

    const today = new Date();
    const offerDate = today.toLocaleDateString("de-DE");
    const validUntilDate = new Date(today);
    validUntilDate.setDate(validUntilDate.getDate() + 14);
    const validUntil = validUntilDate.toLocaleDateString("de-DE");

    const custNameRaw = String(draft.customer?.name || "KUNDE").replace(/\s+/g, "").slice(0, 6).toUpperCase() || "KUNDE";
    const offerNo = "ANG-" + today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + String(today.getDate()).padStart(2, "0") + "-" + custNameRaw;

    const from = draft.from || {};
    const to = draft.to || {};
    const customer = draft.customer || {};

    const fromLine1 = [from.street, from.no].filter(Boolean).join(" ").trim();
    const fromLine2 = [from.zip, from.city].filter(Boolean).join(" ").trim();
    const toLine1 = [to.street, to.no].filter(Boolean).join(" ").trim();
    const toLine2 = [to.zip, to.city].filter(Boolean).join(" ").trim();

    const moveDate = formatDateDE(draft.move_date || "");
    const priceRaw = String(draft.price || "").trim().replace(",", ".");
    const priceNum = Number(priceRaw);
    const hasPrice = Number.isFinite(priceNum);

    const gross = hasPrice ? priceNum : null;
    const vatRate = 0.19;
    const net = hasPrice ? gross / (1 + vatRate) : null;
    const vat = hasPrice ? gross - net : null;

    // Service rows
    const serviceRows = [];
    let pos = 1;
    serviceRows.push({ pos: pos++, title: "Umzugsservice gemäß Objekt- und Routendaten", qty: "1", unit: hasPrice ? euroFmt(gross) : "—", total: hasPrice ? euroFmt(gross) : "—" });

    if (from.floor || to.floor || from.lift || to.lift) {
      const floorText = [from.floor ? `Beladestelle Stock ${from.floor}` : "", from.lift ? `Aufzug ${from.lift}` : "", to.floor ? `Entladestelle Stock ${to.floor}` : "", to.lift ? `Aufzug ${to.lift}` : ""].filter(Boolean).join(" \u2022 ");
      serviceRows.push({ pos: pos++, title: floorText || "Zugang / Etage / Aufzug", qty: "inkl.", unit: "inkl.", total: "inkl." });
    }

    const inv = draft.inv || { rooms: [], items: {}, qty: {}, svc: {} };
    const rooms = Array.from(new Set([...(Array.isArray(inv.rooms) ? inv.rooms : []), ...Object.keys(inv.items || {})])).filter(Boolean);

    let itemCount = 0, serviceCount = 0;
    for (const room of rooms) {
      const items = Array.isArray(inv.items?.[room]) ? inv.items[room] : [];
      for (const it of items) {
        itemCount += Math.max(1, Number(inv.qty?.[room]?.[it] ?? 1) || 1);
        if (String(inv.svc?.[room]?.[it] || "").trim()) serviceCount++;
      }
    }
    if (itemCount > 0) serviceRows.push({ pos: pos++, title: `Inventar laut Anlage (${itemCount} Positionen)`, qty: "1", unit: "inkl.", total: "inkl." });
    if (serviceCount > 0) serviceRows.push({ pos: pos++, title: "Zusatzleistungen Montage / Demontage gemäß Inventarliste", qty: String(serviceCount), unit: "inkl.", total: "inkl." });

    const serviceTableHtml = serviceRows.map(function (r) {
      return `<tr><td style="padding:11px 12px;border-bottom:1px solid #e6ebef;font-size:11px;font-weight:800;color:#0f172a;width:52px;">${escapeHtml(String(r.pos))}</td><td style="padding:11px 12px;border-bottom:1px solid #e6ebef;font-size:11px;font-weight:800;color:#0f172a;">${escapeHtml(r.title)}</td><td style="padding:11px 12px;border-bottom:1px solid #e6ebef;font-size:11px;font-weight:800;color:#0f172a;width:70px;text-align:right;">${escapeHtml(r.qty)}</td><td style="padding:11px 12px;border-bottom:1px solid #e6ebef;font-size:11px;font-weight:800;color:#0f172a;width:120px;text-align:right;">${escapeHtml(r.unit)}</td><td style="padding:11px 12px;border-bottom:1px solid #e6ebef;font-size:11px;font-weight:900;color:#0f172a;width:120px;text-align:right;">${escapeHtml(r.total)}</td></tr>`;
    }).join("");

    // Annex (inventory per room)
    const annexBlocks = [];
    for (const room of rooms) {
      const items = Array.isArray(inv.items?.[room]) ? inv.items[room].filter(Boolean) : [];
      if (!items.length) continue;
      const rowsHtml = items.map(function (it) {
        const qty = Math.max(1, Number(inv.qty?.[room]?.[it] ?? 1) || 1);
        const svcRaw = String(inv.svc?.[room]?.[it] || "").trim();
        return `<tr><td style="padding:9px 12px;border-bottom:1px solid #e8edf2;font-size:10.5px;font-weight:800;color:#0f172a;">${escapeHtml(it)}</td><td style="padding:9px 12px;border-bottom:1px solid #e8edf2;font-size:10.5px;font-weight:900;color:#0f172a;text-align:right;width:80px;">${escapeHtml(String(qty))}</td><td style="padding:9px 12px;border-bottom:1px solid #e8edf2;font-size:10.5px;font-weight:800;color:#0f172a;width:180px;">${escapeHtml(svcLabel(svcRaw))}</td></tr>`;
      }).join("");
      annexBlocks.push(`<div style="margin-top:16px;"><div style="padding:10px 12px;background:#f7faf8;border:1px solid #dfe7e2;border-bottom:none;border-radius:12px 12px 0 0;font-size:12px;font-weight:900;color:#166534;">${escapeHtml(room)}</div><table style="width:100%;border-collapse:collapse;border:1px solid #dfe7e2;border-radius:0 0 12px 12px;overflow:hidden;"><thead><tr><th style="padding:10px 12px;background:#ffffff;border-bottom:1px solid #e8edf2;text-align:left;font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;letter-spacing:.06em;">Position</th><th style="padding:10px 12px;background:#ffffff;border-bottom:1px solid #e8edf2;text-align:right;font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;letter-spacing:.06em;width:80px;">Menge</th><th style="padding:10px 12px;background:#ffffff;border-bottom:1px solid #e8edf2;text-align:left;font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;letter-spacing:.06em;width:180px;">Service</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>`);
    }

    const footerLine1 = [brand, companyStreet, companyCity, companyCountry].filter(Boolean).join(" \u2022 ");
    const footerLine2 = [companyPhone ? `Tel. ${companyPhone}` : "", companyEmail ? `E-Mail ${companyEmail}` : "", companyIban ? `IBAN ${companyIban}` : "", companyBic ? `BIC ${companyBic}` : ""].filter(Boolean).join(" \u2022 ");
    const footerLine3 = [companyTax ? `Steuernummer ${companyTax}` : "", companyVat ? `USt-IdNr. ${companyVat}` : ""].filter(Boolean).join(" \u2022 ");
    const noteText = String(draft.text || "").trim();

    // Signature block HTML
    let signatureBlockHtml = "";
    if (sig) {
      signatureBlockHtml = `
        <div style="margin-top:24px;border-top:2px solid #16a34a;padding-top:18px;">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;align-items:start;">
            <div>
              <div style="font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;letter-spacing:.08em;">Unterschrift des Kunden</div>
              <div style="margin-top:12px;border:1px solid #e4e9ee;border-radius:14px;padding:14px;background:#fafcfb;min-height:80px;">
                ${sig.png ? `<img src="${escapeHtml(sig.png)}" alt="Unterschrift" style="max-height:60px;max-width:200px;object-fit:contain;" />` : ""}
              </div>
            </div>
            <div>
              <div style="font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;letter-spacing:.08em;">Bestätigung</div>
              <div style="margin-top:12px;font-size:11px;line-height:1.8;color:#0f172a;font-weight:700;">
                <div>Name: ${escapeHtml(sig.name || "-")}</div>
                <div>Datum: ${escapeHtml(sig.date || "-")}</div>
                <div style="margin-top:6px;color:#047857;font-weight:900;">Angebot angenommen und unterschrieben.</div>
              </div>
            </div>
          </div>
        </div>`;
    }

    // Price block
    let priceBlockHtml = "";
    if (isKlein) {
      priceBlockHtml = `
        <div style="display:flex;justify-content:space-between;gap:12px;font-size:11px;font-weight:800;color:#334155;"><span>Gesamtpreis</span><span>${escapeHtml(euroFmt(gross))}</span></div>
        <div style="margin-top:14px;padding-top:12px;border-top:1px solid #dce6df;display:flex;justify-content:space-between;gap:12px;align-items:end;">
          <span style="font-size:14px;font-weight:900;color:#166534;">Endbetrag</span>
          <span style="font-size:28px;font-weight:1000;letter-spacing:-.03em;color:#065f46;">${escapeHtml(euroFmt(gross))}</span>
        </div>
        <div style="margin-top:8px;font-size:10px;line-height:1.6;color:#64748b;font-weight:700;">Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.</div>`;
    } else {
      priceBlockHtml = `
        <div style="display:flex;justify-content:space-between;gap:12px;font-size:11px;font-weight:800;color:#334155;"><span>Zwischensumme netto</span><span>${escapeHtml(euroFmt(net))}</span></div>
        <div style="display:flex;justify-content:space-between;gap:12px;font-size:11px;font-weight:800;color:#334155;margin-top:8px;"><span>zzgl. 19% MwSt.</span><span>${escapeHtml(euroFmt(vat))}</span></div>
        <div style="margin-top:14px;padding-top:12px;border-top:1px solid #dce6df;display:flex;justify-content:space-between;gap:12px;align-items:end;">
          <span style="font-size:14px;font-weight:900;color:#166534;">Gesamt brutto</span>
          <span style="font-size:28px;font-weight:1000;letter-spacing:-.03em;color:#065f46;">${escapeHtml(euroFmt(gross))}</span>
        </div>`;
    }

    // Main page
    const page1 = `
      <div class="pdf-page" style="width:210mm;min-height:297mm;margin:0 auto;background:#fff;border:1px solid #dde5e0;box-shadow:0 18px 50px rgba(15,23,42,.08);">
        <div style="padding:18mm 16mm 14mm 16mm;color:#0f172a;">
          <div style="height:4px;background:#16a34a;border-radius:999px;"></div>
          <div style="margin-top:18px;display:grid;grid-template-columns:1.2fr .9fr;gap:24px;align-items:start;">
            <div>
              <div style="display:flex;align-items:center;gap:12px;">
                ${s.logo_url ? `<img src="${escapeHtml(s.logo_url)}" alt="" style="max-height:48px;max-width:160px;object-fit:contain;" />` : ""}
                <div style="font-size:24px;font-weight:1000;letter-spacing:-.03em;color:#0b1220;">${escapeHtml(brand)}</div>
              </div>
              <div style="margin-top:10px;font-size:11.5px;line-height:1.7;color:#334155;font-weight:700;">
                ${companyStreet ? `<div>${escapeHtml(companyStreet)}</div>` : ""}
                ${companyCity ? `<div>${escapeHtml(companyCity)}</div>` : ""}
                ${companyCountry ? `<div>${escapeHtml(companyCountry)}</div>` : ""}
                ${companyPhone ? `<div>Tel.: ${escapeHtml(companyPhone)}</div>` : ""}
                ${companyEmail ? `<div>E-Mail: ${escapeHtml(companyEmail)}</div>` : ""}
              </div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:26px;font-weight:1000;letter-spacing:-.04em;color:#0b1220;margin-bottom:10px;">Angebot</div>
              <div style="border:1px solid #e4e9ee;border-radius:14px;padding:12px 14px;text-align:left;background:#fafcfb;">
                <div style="display:grid;grid-template-columns:110px 1fr;gap:6px 10px;font-size:11px;line-height:1.65;">
                  <div style="color:#64748b;font-weight:800;">Angebotsnr.</div><div style="color:#0f172a;font-weight:900;">${escapeHtml(offerNo)}</div>
                  <div style="color:#64748b;font-weight:800;">Datum</div><div style="color:#0f172a;font-weight:900;">${escapeHtml(offerDate)}</div>
                  <div style="color:#64748b;font-weight:800;">Gültig bis</div><div style="color:#0f172a;font-weight:900;">${escapeHtml(validUntil)}</div>
                  <div style="color:#64748b;font-weight:800;">Status</div><div style="color:#0f172a;font-weight:900;">${escapeHtml(draft.status || "Angebot")}</div>
                </div>
              </div>
            </div>
          </div>

          <div style="margin-top:24px;display:grid;grid-template-columns:1fr 1fr;gap:18px;">
            <div style="border:1px solid #e4e9ee;border-radius:14px;padding:14px 15px;">
              <div style="font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;letter-spacing:.08em;">Kunde</div>
              <div style="margin-top:10px;font-size:11.5px;line-height:1.7;color:#0f172a;font-weight:800;">
                <div>${escapeHtml(customer.name || "-")}</div>
                ${customer.phone ? `<div>${escapeHtml(customer.phone)}</div>` : ""}
                ${customer.email ? `<div>${escapeHtml(customer.email)}</div>` : ""}
              </div>
            </div>
            <div style="border:1px solid #e4e9ee;border-radius:14px;padding:14px 15px;">
              <div style="font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;letter-spacing:.08em;">Auftragsdaten</div>
              <div style="margin-top:10px;font-size:11.5px;line-height:1.7;color:#0f172a;font-weight:800;">
                <div>${moveDate ? `Umzugstermin: ${escapeHtml(moveDate)}` : "Umzugstermin: nach Vereinbarung"}</div>
                <div>Route: ${escapeHtml(fromLine2 || "—")} \u2192 ${escapeHtml(toLine2 || "—")}</div>
              </div>
            </div>
          </div>

          <div style="margin-top:24px;">
            <div style="font-size:18px;font-weight:1000;letter-spacing:-.02em;color:#0b1220;">Angebot für Ihren Umzug</div>
            <div style="margin-top:7px;font-size:12px;line-height:1.6;color:#475569;font-weight:700;">
              Umzugsservice von ${escapeHtml(fromLine2 || "—")} nach ${escapeHtml(toLine2 || "—")} ${moveDate ? `am ${escapeHtml(moveDate)}` : ""}.
            </div>
          </div>

          <div style="margin-top:18px;border:1px solid #e4e9ee;border-radius:14px;padding:14px 15px;background:#fcfdfd;">
            <div style="font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;letter-spacing:.08em;">Leistungsdaten</div>
            <div style="margin-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:16px;">
              <div>
                <div style="font-size:11px;font-weight:900;color:#166534;margin-bottom:6px;">Beladestelle</div>
                <div style="font-size:11px;line-height:1.7;color:#0f172a;font-weight:800;">
                  <div>${escapeHtml(fromLine1 || "-")}</div><div>${escapeHtml(fromLine2 || "-")}</div>
                  ${from.floor ? `<div>Stock: ${escapeHtml(String(from.floor))}</div>` : ""}
                  ${from.lift ? `<div>Aufzug: ${escapeHtml(String(from.lift))}</div>` : ""}
                </div>
              </div>
              <div>
                <div style="font-size:11px;font-weight:900;color:#166534;margin-bottom:6px;">Entladestelle</div>
                <div style="font-size:11px;line-height:1.7;color:#0f172a;font-weight:800;">
                  <div>${escapeHtml(toLine1 || "-")}</div><div>${escapeHtml(toLine2 || "-")}</div>
                  ${to.floor ? `<div>Stock: ${escapeHtml(String(to.floor))}</div>` : ""}
                  ${to.lift ? `<div>Aufzug: ${escapeHtml(String(to.lift))}</div>` : ""}
                </div>
              </div>
            </div>
          </div>

          <div style="margin-top:20px;">
            <table style="width:100%;border-collapse:collapse;border:1px solid #dfe6e2;border-radius:14px;overflow:hidden;">
              <thead><tr>
                <th style="padding:11px 12px;background:#f7faf8;border-bottom:1px solid #e6ebef;text-align:left;font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;letter-spacing:.07em;width:52px;">Pos.</th>
                <th style="padding:11px 12px;background:#f7faf8;border-bottom:1px solid #e6ebef;text-align:left;font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;letter-spacing:.07em;">Leistung</th>
                <th style="padding:11px 12px;background:#f7faf8;border-bottom:1px solid #e6ebef;text-align:right;font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;letter-spacing:.07em;width:70px;">Menge</th>
                <th style="padding:11px 12px;background:#f7faf8;border-bottom:1px solid #e6ebef;text-align:right;font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;letter-spacing:.07em;width:120px;">Einzelpreis</th>
                <th style="padding:11px 12px;background:#f7faf8;border-bottom:1px solid #e6ebef;text-align:right;font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;letter-spacing:.07em;width:120px;">Gesamt</th>
              </tr></thead>
              <tbody>${serviceTableHtml}</tbody>
            </table>
          </div>

          <div style="margin-top:20px;display:grid;grid-template-columns:1.1fr .9fr;gap:18px;align-items:start;">
            <div style="border:1px solid #e4e9ee;border-radius:14px;padding:14px 15px;background:#fff;">
              <div style="font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;letter-spacing:.08em;">Konditionen</div>
              <div style="margin-top:10px;font-size:11px;line-height:1.8;color:#0f172a;font-weight:700;">
                <div>\u2022 Dieses Angebot ist gültig bis ${escapeHtml(validUntil)}.</div>
                <div>\u2022 Grundlage des Angebots sind die aktuell angegebenen Leistungen.</div>
                <div>\u2022 Zusätzlicher, vorab nicht angegebener Mehraufwand kann gesondert berechnet werden.</div>
                <div>\u2022 Terminvergabe erfolgt nach Verfügbarkeit.</div>
                <div>\u2022 Änderungen nach Besichtigung bleiben vorbehalten.</div>
              </div>
            </div>
            <div style="border:2px solid #16a34a;border-radius:16px;padding:15px 16px;background:#fbfefc;">
              ${priceBlockHtml}
            </div>
          </div>

          ${noteText ? `<div style="margin-top:18px;border:1px solid #e4e9ee;border-radius:14px;padding:14px 15px;background:#fff;"><div style="font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;letter-spacing:.08em;">Hinweis</div><div style="margin-top:10px;font-size:11px;line-height:1.8;color:#0f172a;font-weight:700;white-space:pre-line;">${escapeHtml(noteText)}</div></div>` : ""}

          ${signatureBlockHtml}

          <div style="margin-top:22px;padding-top:12px;border-top:1px solid #e6ebef;font-size:9.5px;line-height:1.7;color:#64748b;font-weight:700;">
            ${footerLine1 ? `<div>${escapeHtml(footerLine1)}</div>` : ""}
            ${footerLine2 ? `<div style="margin-top:4px;">${escapeHtml(footerLine2)}</div>` : ""}
            ${footerLine3 ? `<div style="margin-top:4px;">${escapeHtml(footerLine3)}</div>` : ""}
          </div>
        </div>
      </div>`;

    // Annex page
    let page2 = "";
    if (annexBlocks.length) {
      page2 = `
      <div class="pdf-page pdf-break" style="width:210mm;min-height:297mm;margin:18px auto 0;background:#fff;border:1px solid #dde5e0;box-shadow:0 18px 50px rgba(15,23,42,.08);">
        <div style="padding:18mm 16mm 14mm 16mm;color:#0f172a;">
          <div style="height:4px;background:#16a34a;border-radius:999px;"></div>
          <div style="margin-top:18px;display:flex;justify-content:space-between;gap:20px;align-items:flex-end;">
            <div>
              <div style="font-size:24px;font-weight:1000;letter-spacing:-.03em;color:#0b1220;">Inventarliste</div>
              <div style="margin-top:6px;font-size:12px;line-height:1.6;color:#475569;font-weight:700;">Anlage zum Angebot ${escapeHtml(offerNo)}</div>
            </div>
            <div style="text-align:right;font-size:11px;line-height:1.7;color:#334155;font-weight:800;">
              <div>${escapeHtml(customer.name || "-")}</div>
              <div>${escapeHtml(fromLine2 || "—")} \u2192 ${escapeHtml(toLine2 || "—")}</div>
              ${moveDate ? `<div>${escapeHtml(moveDate)}</div>` : ""}
            </div>
          </div>
          ${annexBlocks.join("")}
          <div style="margin-top:22px;padding-top:12px;border-top:1px solid #e6ebef;font-size:9.5px;line-height:1.7;color:#64748b;font-weight:700;">
            ${footerLine1 ? `<div>${escapeHtml(footerLine1)}</div>` : ""}
            ${footerLine2 ? `<div style="margin-top:4px;">${escapeHtml(footerLine2)}</div>` : ""}
          </div>
        </div>
      </div>`;
    }

    return `<style>@media print{html,body{background:#fff !important;}*{-webkit-print-color-adjust:exact;print-color-adjust:exact;}.pdf-page{box-shadow:none !important;border:none !important;border-radius:0 !important;}.pdf-break{page-break-before:always;}}</style><div style="background:#f4f6f5;padding:24px;font-family:Inter,Arial,sans-serif;">${page1}${page2}</div>`;
  }

  // Export
  window.AnfrageBoxPdf = { build: build };
})();