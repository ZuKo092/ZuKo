/* ============================================================
   AnfrageBox Admin — Rechnungen Module v1
   Exposes window.__AB_Rechnung = { create, openPdf, loadList }
   Depends on: admin-rechnung17.js (window.__AB_APP)
   Table: invoices (id, company_id, lead_id, invoice_number,
          customer_name, customer_email, customer_phone,
          route_from, route_to, move_date, amount_gross,
          amount_net, amount_vat, vat_rate, is_kleinunternehmer,
          status, line_items, notes, payment_days, created_at,
          updated_at, paid_at)
   ============================================================ */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const STATUS_LIST = ["Entwurf", "Gesendet", "Bezahlt", "Storniert"];

  function esc(v) {
    return String(v ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function fmtDate(v) {
    if (!v) return "-";
    const d = new Date(v);
    return isNaN(d) ? String(v) : d.toLocaleDateString("de-DE");
  }

  function fmtEuro(v) {
    const n = Number(String(v || "").replace(",", "."));
    return Number.isFinite(n)
      ? n.toLocaleString("de-DE", { style: "currency", currency: "EUR" })
      : "-";
  }

  function getApp() {
    return window.__AB_APP || {};
  }

  function getSb() {
    const app = getApp();
    return app.sb || null;
  }

  function getCompanyId() {
    const app = getApp();
    return app.companyId || app.state?.companyId || null;
  }

  function getSettings() {
    const app = getApp();
    return (
      (typeof app.getCompanySettings === "function"
        ? app.getCompanySettings()
        : null) ||
      app.state?.companySettings ||
      {}
    );
  }

  function notice(msg, type) {
    const app = getApp();
    if (typeof app.showNotice === "function") app.showNotice(msg, type);
  }

  // =========================
  // INVOICE NUMBER GENERATION
  // =========================
  async function getNextInvoiceNumber() {
    const sb = getSb();
    const cid = getCompanyId();
    if (!sb || !cid) return null;

    const year = new Date().getFullYear();
    const prefix = "RE-" + year + "-";

    const { data, error } = await sb
      .from("invoices")
      .select("invoice_number")
      .eq("company_id", cid)
      .like("invoice_number", prefix + "%")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("getNextInvoiceNumber error:", error);
    }

    let seq = 1;
    if (data?.invoice_number) {
      const parts = data.invoice_number.split("-");
      const last = parseInt(parts[parts.length - 1], 10);
      if (Number.isFinite(last)) seq = last + 1;
    }

    return prefix + String(seq).padStart(4, "0");
  }

  // =========================
  // CREATE INVOICE
  // =========================
  async function createInvoice(leadId) {
    const sb = getSb();
    const cid = getCompanyId();
    if (!sb || !cid || !leadId) {
      notice("Keine Verbindung oder Lead-ID fehlt.", "err");
      return null;
    }

    const app = getApp();
    const rows = app.state?.rows || [];
    const row = rows.find((r) => String(r.id) === String(leadId));
    if (!row) {
      notice("Lead nicht gefunden.", "err");
      return null;
    }

    // Check if invoice already exists
    const { data: existing } = await sb
      .from("invoices")
      .select("id,invoice_number")
      .eq("company_id", cid)
      .eq("lead_id", leadId)
      .neq("status", "Storniert")
      .maybeSingle();

    if (existing) {
      notice(
        "Rechnung " + existing.invoice_number + " existiert bereits.",
        "err"
      );
      return existing;
    }

    const p =
      typeof app.getPayload === "function" ? app.getPayload(row) : row.payload || {};
    const name =
      typeof app.customerName === "function"
        ? app.customerName(row)
        : row.customer_name || "";
    const email =
      typeof app.customerEmail === "function"
        ? app.customerEmail(row)
        : row.customer_email || "";
    const phone =
      typeof app.customerPhone === "function"
        ? app.customerPhone(row)
        : row.customer_phone || "";

    const fromA =
      typeof app.getAddr === "function" ? app.getAddr(row, "from") : {};
    const toA =
      typeof app.getAddr === "function" ? app.getAddr(row, "to") : {};
    const routeFrom = [fromA.zip, fromA.city].filter(Boolean).join(" ");
    const routeTo = [toA.zip, toA.city].filter(Boolean).join(" ");

    const offer = p.offer || {};
    const priceRaw = String(offer.price || "").trim().replace(",", ".");
    const priceNum = Number(priceRaw);
    const hasPrice = Number.isFinite(priceNum) && priceNum > 0;

    if (!hasPrice) {
      notice("Kein Preis im Angebot hinterlegt. Bitte zuerst Angebot erstellen.", "err");
      return null;
    }

    const s = getSettings();
    const isKlein = !!(s.is_kleinunternehmer || s.kleinunternehmer);
    const vatRate = isKlein ? 0 : 0.19;
    const gross = priceNum;
    const net = isKlein ? gross : gross / (1 + vatRate);
    const vat = gross - net;
    const paymentDays = parseInt(s.payment_days || "14", 10) || 14;

    const invoiceNumber = await getNextInvoiceNumber();
    if (!invoiceNumber) {
      notice("Rechnungsnummer konnte nicht generiert werden.", "err");
      return null;
    }

    const moveDate = row.move_date || p.move_date || "";

    // Build line items
    const lineItems = [];
    lineItems.push({
      pos: 1,
      title: "Umzugsservice " + routeFrom + " nach " + routeTo,
      qty: 1,
      unit_price: gross,
      total: gross,
    });

    const invoice = {
      company_id: cid,
      lead_id: leadId,
      invoice_number: invoiceNumber,
      customer_name: name,
      customer_email: email,
      customer_phone: phone,
      route_from: routeFrom,
      route_to: routeTo,
      move_date: moveDate || null,
      amount_gross: Math.round(gross * 100) / 100,
      amount_net: Math.round(net * 100) / 100,
      amount_vat: Math.round(vat * 100) / 100,
      vat_rate: vatRate,
      is_kleinunternehmer: isKlein,
      status: "Entwurf",
      line_items: lineItems,
      notes: String(offer.text || "").trim(),
      payment_days: paymentDays,
      created_at: new Date().toISOString(),
    };

    const { data, error } = await sb
      .from("invoices")
      .insert(invoice)
      .select("*")
      .single();

    if (error) {
      notice("Rechnung erstellen fehlgeschlagen: " + (error.message || error), "err");
      return null;
    }

    notice("Rechnung " + invoiceNumber + " erstellt.", "ok");
    return data;
  }

  // =========================
  // INVOICE PDF
  // =========================
  function openInvoicePdf(inv) {
    if (!inv) return;

    const s = getSettings();
    const brand = s.company_name || "Firma";
    const street = s.street || "";
    const cityline = s.cityline || "";
    const country = s.country || "Deutschland";
    const companyPhone = s.phone || "";
    const companyEmail = s.email || "";
    const companyTax = s.tax_number || "";
    const companyVat = s.vat_id || "";
    const companyIban = s.iban || "";
    const companyBic = s.bic || "";
    const logoUrl = s.logo_url || "";

    const invoiceDate = fmtDate(inv.created_at);
    const dueDate = (() => {
      const d = new Date(inv.created_at);
      d.setDate(d.getDate() + (inv.payment_days || 14));
      return fmtDate(d);
    })();

    const isKlein = inv.is_kleinunternehmer;
    const gross = inv.amount_gross;
    const net = inv.amount_net;
    const vat = inv.amount_vat;
    const euro = (n) =>
      Number.isFinite(n)
        ? n.toLocaleString("de-DE", { style: "currency", currency: "EUR" })
        : "-";

    const lineItems = Array.isArray(inv.line_items) ? inv.line_items : [];
    const lineRows = lineItems
      .map(
        (li) =>
          `<tr>
        <td style="padding:11px 12px;border-bottom:1px solid #e6ebef;font-size:11px;font-weight:800;width:52px;">${esc(String(li.pos))}</td>
        <td style="padding:11px 12px;border-bottom:1px solid #e6ebef;font-size:11px;font-weight:800;">${esc(li.title)}</td>
        <td style="padding:11px 12px;border-bottom:1px solid #e6ebef;font-size:11px;font-weight:800;width:70px;text-align:right;">${esc(String(li.qty))}</td>
        <td style="padding:11px 12px;border-bottom:1px solid #e6ebef;font-size:11px;font-weight:900;width:120px;text-align:right;">${esc(euro(li.total))}</td>
      </tr>`
      )
      .join("");

    const footerLine1 = [brand, street, cityline, country]
      .filter(Boolean)
      .join(" . ");
    const footerLine2 = [
      companyPhone ? "Tel. " + companyPhone : "",
      companyEmail ? "E-Mail " + companyEmail : "",
      companyIban ? "IBAN " + companyIban : "",
      companyBic ? "BIC " + companyBic : "",
    ]
      .filter(Boolean)
      .join(" . ");
    const footerLine3 = [
      companyTax ? "Steuernummer " + companyTax : "",
      companyVat ? "USt-IdNr. " + companyVat : "",
    ]
      .filter(Boolean)
      .join(" . ");

    const statusBadge =
      inv.status === "Bezahlt"
        ? '<span style="background:#d1fae5;color:#065f46;padding:4px 12px;border-radius:100px;font-size:11px;font-weight:900;">BEZAHLT</span>'
        : inv.status === "Storniert"
        ? '<span style="background:#fee2e2;color:#991b1b;padding:4px 12px;border-radius:100px;font-size:11px;font-weight:900;">STORNIERT</span>'
        : "";

    const html = `<style>@media print{html,body{background:#fff !important;}*{-webkit-print-color-adjust:exact;print-color-adjust:exact;}.pdf-page{box-shadow:none !important;border:none !important;}}</style>
    <div style="background:#f4f6f5;padding:24px;font-family:Inter,Arial,sans-serif;">
      <div class="pdf-page" style="width:210mm;min-height:297mm;margin:0 auto;background:#fff;border:1px solid #dde5e0;box-shadow:0 18px 50px rgba(15,23,42,.08);">
        <div style="padding:18mm 16mm 14mm 16mm;color:#0f172a;">
          <div style="height:4px;background:#0f172a;border-radius:999px;"></div>
          <div style="margin-top:18px;display:grid;grid-template-columns:1.2fr .9fr;gap:24px;align-items:start;">
            <div>
              <div style="display:flex;align-items:center;gap:12px;">
                ${logoUrl ? '<img src="' + esc(logoUrl) + '" alt="" style="max-height:48px;max-width:160px;object-fit:contain;"/>' : ""}
                <div style="font-size:24px;font-weight:1000;letter-spacing:-.03em;">${esc(brand)}</div>
              </div>
              <div style="margin-top:10px;font-size:11.5px;line-height:1.7;color:#334155;font-weight:700;">
                ${street ? "<div>" + esc(street) + "</div>" : ""}
                ${cityline ? "<div>" + esc(cityline) + "</div>" : ""}
                ${country ? "<div>" + esc(country) + "</div>" : ""}
                ${companyPhone ? "<div>Tel.: " + esc(companyPhone) + "</div>" : ""}
                ${companyEmail ? "<div>E-Mail: " + esc(companyEmail) + "</div>" : ""}
              </div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:30px;font-weight:1000;letter-spacing:-.04em;">Rechnung</div>
              ${statusBadge ? '<div style="margin-top:8px;">' + statusBadge + "</div>" : ""}
              <div style="margin-top:12px;border:1px solid #e4e9ee;border-radius:14px;padding:12px 14px;display:inline-block;min-width:250px;text-align:left;background:#fafcfb;">
                <div style="display:grid;grid-template-columns:120px 1fr;gap:6px 10px;font-size:11px;line-height:1.65;">
                  <div style="color:#64748b;font-weight:800;">Rechnungsnr.</div><div style="font-weight:900;">${esc(inv.invoice_number)}</div>
                  <div style="color:#64748b;font-weight:800;">Datum</div><div style="font-weight:900;">${esc(invoiceDate)}</div>
                  <div style="color:#64748b;font-weight:800;">Zahlungsziel</div><div style="font-weight:900;">${esc(dueDate)} (${inv.payment_days || 14} Tage)</div>
                  <div style="color:#64748b;font-weight:800;">Status</div><div style="font-weight:900;">${esc(inv.status)}</div>
                </div>
              </div>
            </div>
          </div>

          <div style="margin-top:24px;display:grid;grid-template-columns:1fr 1fr;gap:18px;">
            <div style="border:1px solid #e4e9ee;border-radius:14px;padding:14px 15px;">
              <div style="font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;letter-spacing:.08em;">Rechnungsempfänger</div>
              <div style="margin-top:10px;font-size:11.5px;line-height:1.7;font-weight:800;">
                <div>${esc(inv.customer_name || "-")}</div>
                ${inv.customer_phone ? "<div>" + esc(inv.customer_phone) + "</div>" : ""}
                ${inv.customer_email ? "<div>" + esc(inv.customer_email) + "</div>" : ""}
              </div>
            </div>
            <div style="border:1px solid #e4e9ee;border-radius:14px;padding:14px 15px;">
              <div style="font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;letter-spacing:.08em;">Leistung</div>
              <div style="margin-top:10px;font-size:11.5px;line-height:1.7;font-weight:800;">
                <div>Umzug: ${esc(inv.route_from || "-")} nach ${esc(inv.route_to || "-")}</div>
                ${inv.move_date ? "<div>Datum: " + esc(fmtDate(inv.move_date)) + "</div>" : ""}
              </div>
            </div>
          </div>

          <div style="margin-top:24px;">
            <table style="width:100%;border-collapse:collapse;border:1px solid #dfe6e2;border-radius:14px;overflow:hidden;">
              <thead>
                <tr>
                  <th style="padding:11px 12px;background:#f7faf8;border-bottom:1px solid #e6ebef;text-align:left;font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;letter-spacing:.07em;width:52px;">Pos.</th>
                  <th style="padding:11px 12px;background:#f7faf8;border-bottom:1px solid #e6ebef;text-align:left;font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;letter-spacing:.07em;">Leistung</th>
                  <th style="padding:11px 12px;background:#f7faf8;border-bottom:1px solid #e6ebef;text-align:right;font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;letter-spacing:.07em;width:70px;">Menge</th>
                  <th style="padding:11px 12px;background:#f7faf8;border-bottom:1px solid #e6ebef;text-align:right;font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;letter-spacing:.07em;width:120px;">Gesamt</th>
                </tr>
              </thead>
              <tbody>${lineRows}</tbody>
            </table>
          </div>

          <div style="margin-top:20px;display:flex;justify-content:flex-end;">
            <div style="border:2px solid #0f172a;border-radius:16px;padding:15px 20px;min-width:300px;">
              ${
                isKlein
                  ? `<div style="display:flex;justify-content:space-between;gap:12px;font-size:11px;font-weight:800;color:#334155;"><span>Gesamtpreis</span><span>${esc(euro(gross))}</span></div>
                     <div style="margin-top:14px;padding-top:12px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;gap:12px;align-items:end;">
                       <span style="font-size:14px;font-weight:900;">Rechnungsbetrag</span>
                       <span style="font-size:28px;font-weight:1000;letter-spacing:-.03em;">${esc(euro(gross))}</span>
                     </div>
                     <div style="margin-top:8px;font-size:10px;line-height:1.6;color:#64748b;font-weight:700;">Gem. § 19 UStG wird keine Umsatzsteuer berechnet.</div>`
                  : `<div style="display:flex;justify-content:space-between;gap:12px;font-size:11px;font-weight:800;color:#334155;"><span>Netto</span><span>${esc(euro(net))}</span></div>
                     <div style="display:flex;justify-content:space-between;gap:12px;font-size:11px;font-weight:800;color:#334155;margin-top:8px;"><span>zzgl. 19% MwSt.</span><span>${esc(euro(vat))}</span></div>
                     <div style="margin-top:14px;padding-top:12px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;gap:12px;align-items:end;">
                       <span style="font-size:14px;font-weight:900;">Rechnungsbetrag</span>
                       <span style="font-size:28px;font-weight:1000;letter-spacing:-.03em;">${esc(euro(gross))}</span>
                     </div>`
              }
            </div>
          </div>

          ${inv.notes ? `<div style="margin-top:18px;border:1px solid #e4e9ee;border-radius:14px;padding:14px 15px;"><div style="font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;letter-spacing:.08em;">Hinweis</div><div style="margin-top:10px;font-size:11px;line-height:1.8;font-weight:700;white-space:pre-line;">${esc(inv.notes)}</div></div>` : ""}

          <div style="margin-top:18px;border:1px solid #e4e9ee;border-radius:14px;padding:14px 15px;">
            <div style="font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;letter-spacing:.08em;">Zahlungsinformationen</div>
            <div style="margin-top:10px;font-size:11px;line-height:1.8;font-weight:700;">
              <div>Bitte überweisen Sie den Betrag von ${esc(euro(gross))} bis zum ${esc(dueDate)} auf folgendes Konto:</div>
              ${companyIban ? "<div>IBAN: " + esc(companyIban) + "</div>" : ""}
              ${companyBic ? "<div>BIC: " + esc(companyBic) + "</div>" : ""}
              <div>Verwendungszweck: ${esc(inv.invoice_number)}</div>
            </div>
          </div>

          <div style="margin-top:22px;padding-top:12px;border-top:1px solid #e6ebef;font-size:9.5px;line-height:1.7;color:#64748b;font-weight:700;">
            ${footerLine1 ? "<div>" + esc(footerLine1) + "</div>" : ""}
            ${footerLine2 ? '<div style="margin-top:4px;">' + esc(footerLine2) + "</div>" : ""}
            ${footerLine3 ? '<div style="margin-top:4px;">' + esc(footerLine3) + "</div>" : ""}
          </div>
        </div>
      </div>
    </div>`;

    // Use existing PDF modal
    const printArea = $("printArea");
    const pdfModal = $("pdfModal");
    if (printArea && pdfModal) {
      printArea.innerHTML = html;
      pdfModal.classList.add("show");
    } else {
      // Fallback: open in new window
      const w = window.open("", "_blank");
      if (!w) return;
      w.document.open();
      w.document.write(
        '<!doctype html><html><head><meta charset="utf-8"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet"><style>body{margin:0;font-family:Inter,Arial,sans-serif;}@page{margin:0;}</style></head><body>' +
          html +
          "<script>window.print()</" +
          "script></body></html>"
      );
      w.document.close();
    }
  }

  // =========================
  // LIST (Rechnungen tab)
  // =========================
  async function loadRechnungList() {
    const sb = getSb();
    const cid = getCompanyId();
    const loading = $("rechnungListLoading");
    const table = $("rechnungTable");
    const empty = $("rechnungEmpty");
    const tbody = $("rechnungTbody");

    if (loading) loading.style.display = "block";
    if (table) table.style.display = "none";
    if (empty) empty.style.display = "none";

    if (!sb || !cid) {
      if (loading) loading.style.display = "none";
      if (empty) empty.style.display = "block";
      return;
    }

    const { data, error } = await sb
      .from("invoices")
      .select("*")
      .eq("company_id", cid)
      .order("created_at", { ascending: false })
      .limit(200);

    if (loading) loading.style.display = "none";

    if (error || !data?.length) {
      if (empty) empty.style.display = "block";
      return;
    }

    if (table) table.style.display = "table";
    if (tbody) tbody.innerHTML = "";

    for (const inv of data) {
      const tr = document.createElement("tr");
      const statusClass =
        inv.status === "Bezahlt"
          ? "color:#065f46;background:#d1fae5;"
          : inv.status === "Storniert"
          ? "color:#991b1b;background:#fee2e2;"
          : inv.status === "Gesendet"
          ? "color:#1e40af;background:#dbeafe;"
          : "color:#92400e;background:#fef3c7;";

      tr.innerHTML = `
        <td style="font-weight:900;font-size:13px;">${esc(inv.invoice_number)}</td>
        <td>
          <div style="font-weight:800;">${esc(inv.customer_name || "-")}</div>
          <div style="font-size:11px;color:#6b7280;">${esc(inv.route_from || "")} ${inv.route_from && inv.route_to ? ">" : ""} ${esc(inv.route_to || "")}</div>
        </td>
        <td style="font-size:12px;">${esc(fmtDate(inv.created_at))}</td>
        <td style="font-weight:900;">${esc(fmtEuro(inv.amount_gross))}</td>
        <td><span style="display:inline-block;padding:2px 10px;border-radius:100px;font-size:11px;font-weight:800;${statusClass}">${esc(inv.status)}</span></td>
        <td>
          <div style="display:flex;gap:4px;flex-wrap:wrap;">
            <button class="btn" data-inv-pdf="${esc(inv.id)}" type="button" style="height:28px;padding:0 10px;font-size:11px;">PDF</button>
            ${inv.status === "Entwurf" ? '<button class="btn green" data-inv-send="' + esc(inv.id) + '" type="button" style="height:28px;padding:0 10px;font-size:11px;font-weight:800;">Gesendet</button>' : ""}
            ${inv.status === "Gesendet" ? '<button class="btn green" data-inv-paid="' + esc(inv.id) + '" type="button" style="height:28px;padding:0 10px;font-size:11px;font-weight:800;">Bezahlt</button>' : ""}
            ${inv.status !== "Storniert" && inv.status !== "Bezahlt" ? '<button class="btn" data-inv-cancel="' + esc(inv.id) + '" type="button" style="height:28px;padding:0 10px;font-size:11px;color:#dc2626;">Storno</button>' : ""}
          </div>
        </td>`;

      if (tbody) tbody.appendChild(tr);
    }

    if (!tbody) return;

    // Bind actions
    tbody.querySelectorAll("[data-inv-pdf]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const invId = btn.dataset.invPdf;
        const inv = data.find((x) => String(x.id) === invId);
        if (inv) openInvoicePdf(inv);
      });
    });

    tbody.querySelectorAll("[data-inv-send]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await updateInvoiceStatus(btn.dataset.invSend, "Gesendet");
        loadRechnungList();
      });
    });

    tbody.querySelectorAll("[data-inv-paid]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await updateInvoiceStatus(btn.dataset.invPaid, "Bezahlt");
        loadRechnungList();
      });
    });

    tbody.querySelectorAll("[data-inv-cancel]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Rechnung wirklich stornieren?")) return;
        await updateInvoiceStatus(btn.dataset.invCancel, "Storniert");
        loadRechnungList();
      });
    });
  }

  async function updateInvoiceStatus(invId, newStatus) {
    const sb = getSb();
    if (!sb || !invId) return;

    const update = { status: newStatus, updated_at: new Date().toISOString() };
    if (newStatus === "Bezahlt") update.paid_at = new Date().toISOString();

    const { error } = await sb
      .from("invoices")
      .update(update)
      .eq("id", invId);

    if (error) {
      notice("Status ändern fehlgeschlagen: " + (error.message || error), "err");
      return;
    }
    notice("Rechnung " + newStatus + ".", "ok");
  }

  // =========================
  // PICKER MODAL
  // =========================
  function openPickerModal() {
    const modal = $("rechnungPickerModal");
    if (!modal) return;
    modal.classList.add("show");
    loadPickerList();

    const search = $("rechnungPickerSearch");
    if (search) {
      search.value = "";
      search.oninput = () => loadPickerList(search.value.trim().toLowerCase());
    }
  }

  async function loadPickerList(q) {
    const loading = $("rechnungPickerLoading");
    const empty = $("rechnungPickerEmpty");
    const list = $("rechnungPickerList");

    if (loading) loading.style.display = "block";
    if (empty) empty.style.display = "none";
    if (list) list.innerHTML = "";

    const app = getApp();
    const sb = getSb();
    const cid = getCompanyId();
    const rows = (app.state?.rows || []).filter((r) => {
      const s = String(r.status || "").toLowerCase();
      return s.includes("gebucht") || s.includes("abgeschlossen");
    });

    // Get existing invoices to exclude
    let invoicedLeadIds = new Set();
    if (sb && cid) {
      const { data: invs } = await sb
        .from("invoices")
        .select("lead_id")
        .eq("company_id", cid)
        .neq("status", "Storniert");
      if (invs) invs.forEach((x) => invoicedLeadIds.add(x.lead_id));
    }

    let eligible = rows.filter((r) => !invoicedLeadIds.has(r.id));

    if (q) {
      eligible = eligible.filter((r) => {
        const name =
          typeof app.customerName === "function"
            ? app.customerName(r)
            : r.customer_name || "";
        const phone =
          typeof app.customerPhone === "function"
            ? app.customerPhone(r)
            : r.customer_phone || "";
        const route =
          typeof app.getAddr === "function"
            ? (() => {
                const f = app.getAddr(r, "from");
                const t = app.getAddr(r, "to");
                return [f.zip, f.city, t.zip, t.city].join(" ");
              })()
            : "";
        return [name, phone, route].join(" ").toLowerCase().includes(q);
      });
    }

    if (loading) loading.style.display = "none";

    if (!eligible.length) {
      if (empty) empty.style.display = "block";
      return;
    }

    if (!list) return;

    for (const r of eligible) {
      const name =
        typeof app.customerName === "function"
          ? app.customerName(r)
          : r.customer_name || "Ohne Name";
      const p =
        typeof app.getPayload === "function"
          ? app.getPayload(r)
          : r.payload || {};
      const offer = p.offer || {};
      const price = offer.price ? fmtEuro(offer.price) : "-";

      const item = document.createElement("div");
      item.style.cssText =
        "padding:12px;border:1px solid var(--line,#e5e7eb);border-radius:12px;margin-bottom:8px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;";
      item.innerHTML = `<div><div style="font-weight:800;">${esc(name)}</div><div style="font-size:12px;color:#6b7280;">${esc(fmtDate(r.created_at))} . ${price}</div></div><button class="btn green" type="button" style="height:32px;padding:0 14px;font-size:12px;font-weight:800;">Rechnung erstellen</button>`;

      const btn = item.querySelector("button");
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        btn.disabled = true;
        btn.textContent = "...";
        const inv = await createInvoice(r.id);
        if (inv) {
          const modal = $("rechnungPickerModal");
          if (modal) modal.classList.remove("show");
          openInvoicePdf(inv);
          loadRechnungList();
        }
        btn.disabled = false;
        btn.textContent = "Rechnung erstellen";
      });

      list.appendChild(item);
    }
  }

  // =========================
  // BINDINGS
  // =========================
  function bind() {
    // "+ Rechnung erstellen" button
    const btnNew = $("btnNewRechnung");
    if (btnNew) btnNew.addEventListener("click", () => openPickerModal());

    // Picker close
    const btnPickerClose = $("btnRechnungPickerClose");
    if (btnPickerClose) {
      btnPickerClose.addEventListener("click", () => {
        const modal = $("rechnungPickerModal");
        if (modal) modal.classList.remove("show");
      });
    }

    // Picker backdrop close
    const pickerModal = $("rechnungPickerModal");
    if (pickerModal) {
      pickerModal.addEventListener("click", (e) => {
        if (e.target === pickerModal) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      }, true);
    }

    // Escape key
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        const modal = $("rechnungPickerModal");
        if (modal && modal.classList.contains("show")) {
          modal.classList.remove("show");
        }
      }
    });

    // Nav: bind navRechnungen click
    const navBtn = $("navRechnungen");
    if (navBtn) {
      navBtn.addEventListener("click", () => {
        const app = getApp();
        if (typeof app.navigate === "function") {
          app.navigate("rechnungen");
        }
        loadRechnungList();
      });
    }

    // Drawer "Rechnung" button visibility
    observeDrawer();
  }

  // =========================
  // DRAWER RECHNUNG BUTTON
  // =========================
  function observeDrawer() {
    const drawerBody = $("drawerBody");
    const drawerRechnung = $("drawerRechnung");
    if (!drawerBody || !drawerRechnung) return;

    const check = () => {
      const app = getApp();
      const row = app.state?.rows?.find(
        (r) => String(r.id) === String(app.state?.selectedId)
      );
      if (!row) {
        drawerRechnung.style.display = "none";
        return;
      }
      const st = String(row.status || "").toLowerCase();
      const show = st.includes("gebucht") || st.includes("abgeschlossen");
      drawerRechnung.style.display = show ? "" : "none";
    };

    // Check on mutation
    const obs = new MutationObserver(check);
    obs.observe(drawerBody, { childList: true });

    // Bind click
    drawerRechnung.addEventListener("click", async () => {
      const app = getApp();
      const leadId = app.state?.selectedId;
      if (!leadId) return;
      drawerRechnung.disabled = true;
      drawerRechnung.textContent = "...";
      const inv = await createInvoice(leadId);
      drawerRechnung.disabled = false;
      drawerRechnung.textContent = "Rechnung";
      if (inv) openInvoicePdf(inv);
    });
  }

  // =========================
  // SETTINGS FIX: wire kleinunternehmer + payment_days
  // =========================
  function patchSettings() {
    // Extend applySettingsToForm
    const origApply = window.__AB_APP?._origApplySettings;
    // We use a MutationObserver on settings view to fill the fields when loaded
    const settingsView = $("viewSettings");
    if (!settingsView) return;

    const fillExtras = () => {
      const s = getSettings();
      const klein = $("s_kleinunternehmer");
      const days = $("s_payment_days");
      if (klein)
        klein.checked = !!(s.is_kleinunternehmer || s.kleinunternehmer);
      if (days) days.value = String(s.payment_days || 14);
    };

    // Fill on settings view becoming visible
    const obs = new MutationObserver(() => {
      if (settingsView.classList.contains("active")) fillExtras();
    });
    obs.observe(settingsView, {
      attributes: true,
      attributeFilter: ["class"],
    });

    // Also fill now
    setTimeout(fillExtras, 500);

    // Intercept save: hook into btnSaveSettings
    const btnSave = $("btnSaveSettings");
    if (btnSave) {
      btnSave.addEventListener(
        "click",
        () => {
          // After the main save runs, also save these fields
          setTimeout(async () => {
            const sb = getSb();
            const cid = getCompanyId();
            if (!sb || !cid) return;

            const klein = $("s_kleinunternehmer");
            const days = $("s_payment_days");
            const update = {};
            if (klein) update.is_kleinunternehmer = !!klein.checked;
            if (days)
              update.payment_days = Math.max(
                1,
                Math.min(90, parseInt(days.value || "14", 10) || 14)
              );
            update.updated_at = new Date().toISOString();

            try {
              await sb
                .from("company_settings")
                .update(update)
                .eq("company_id", cid);
              // Update local cache
              const app = getApp();
              if (app.state?.companySettings) {
                Object.assign(app.state.companySettings, update);
              }
            } catch (err) {
              console.warn("Rechnung settings save:", err);
            }
          }, 300);
        },
        true
      );
    }
  }

  // =========================
  // BOOT
  // =========================
  function init() {
    bind();
    patchSettings();

    // Auto-load list when navigating to rechnungen
    // Use a polling approach since setActiveNav doesn't fire custom events
    let lastView = "";
    setInterval(() => {
      const app = getApp();
      const view = app.state?.view || "";
      if (view === "rechnungen" && lastView !== "rechnungen") {
        loadRechnungList();
      }
      lastView = view;
    }, 300);
  }

  // Expose API
  window.__AB_Rechnung = {
    create: createInvoice,
    openPdf: openInvoicePdf,
    loadList: loadRechnungList,
    loadPortalList: () => {
      const app = getApp();
      if (typeof app.loadPortalList === "function") app.loadPortalList();
    },
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    setTimeout(init, 200);
  }
})();