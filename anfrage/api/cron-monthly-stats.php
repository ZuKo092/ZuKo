<?php
/**
 * cron-monthly-stats.php — AnfrageBox Monthly Statistics Email
 * 
 * Run on 1st of each month via cron:
 *   wget -q -O /dev/null "https://anfragebox.de/anfrage/api/cron-monthly-stats.php?token=YOUR_TOKEN"
 * 
 * Sends each active company a summary of last month's performance.
 */
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');


require_once __DIR__ . '/config.php';

/* ── CONFIG ── */
$SB_URL    = SUPABASE_URL;
$SB_KEY    = SUPABASE_SERVICE_ROLE_KEY;
$SMTP_HOST = SMTP_HOST;
$SMTP_PORT = SMTP_PORT;
$SMTP_USER = SMTP_USER;
$SMTP_PASS = SMTP_PASS;
$CRON_TOKEN = CRON_TOKEN_FOLLOWUP;

/* ── AUTH ── */
$token = $_GET['token'] ?? '';
if ($CRON_TOKEN === '' || !hash_equals($CRON_TOKEN, $token)) {
  http_response_code(401);
  echo json_encode(['ok' => false, 'error' => 'unauthorized']);
  exit;
}

if ($SB_KEY === '' || $SMTP_PASS === '') {
  clog('ERROR: Missing secrets');
  echo json_encode(['ok' => false, 'error' => 'config missing']);
  exit;
}

/* ── PHPMailer ── */
$pmDir = __DIR__ . '/phpmailer';
if (!is_readable($pmDir . '/PHPMailer.php')) {
  clog('ERROR: PHPMailer missing');
  echo json_encode(['ok' => false, 'error' => 'phpmailer missing']);
  exit;
}
require_once $pmDir . '/Exception.php';
require_once $pmDir . '/PHPMailer.php';
require_once $pmDir . '/SMTP.php';

/* ── DATE RANGE: last month ── */
$lastMonthStart = date('Y-m-01', strtotime('-1 month'));
$lastMonthEnd   = date('Y-m-t', strtotime('-1 month'));
$monthName      = strftime('%B %Y', strtotime('-1 month'));
// German month name fallback
$germanMonths = ['January'=>'Januar','February'=>'Februar','March'=>'März','April'=>'April','May'=>'Mai','June'=>'Juni','July'=>'Juli','August'=>'August','September'=>'September','October'=>'Oktober','November'=>'November','December'=>'Dezember'];
$monthNameDe = str_replace(array_keys($germanMonths), array_values($germanMonths), date('F Y', strtotime('-1 month')));

/* ── FETCH ALL ACTIVE COMPANIES ── */
function sb_get(string $path): ?array {
  global $SB_URL, $SB_KEY;
  $ch = curl_init(rtrim($SB_URL, '/') . $path);
  curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 15,
    CURLOPT_HTTPHEADER => ['apikey: ' . $SB_KEY, 'Authorization: Bearer ' . $SB_KEY],
  ]);
  $body = curl_exec($ch);
  $http = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);
  if ($http !== 200) return null;
  return json_decode((string)$body, true);
}

$companies = sb_get('/rest/v1/company_settings?select=company_id,company_name,email,slug&is_demo=eq.false');
if (!is_array($companies)) {
  // Also include demo companies that are still active
  $companies = sb_get('/rest/v1/company_settings?select=company_id,company_name,email,slug');
}

if (!is_array($companies) || count($companies) === 0) {
  clog('No companies found.');
  echo json_encode(['ok' => true, 'sent' => 0]);
  exit;
}

clog('Found ' . count($companies) . ' companies.');

$sent = 0;

foreach ($companies as $company) {
  $companyId   = (string)($company['company_id'] ?? '');
  $companyName = (string)($company['company_name'] ?? 'Firma');
  $email       = (string)($company['email'] ?? '');
  $slug        = (string)($company['slug'] ?? '');

  if ($companyId === '' || $email === '') continue;

  // Fetch leads for this company in last month
  $leads = sb_get('/rest/v1/leads?company_id=eq.' . urlencode($companyId)
    . '&created_at=gte.' . urlencode($lastMonthStart . 'T00:00:00Z')
    . '&created_at=lte.' . urlencode($lastMonthEnd . 'T23:59:59Z')
    . '&select=id,status,payload');

  if (!is_array($leads)) $leads = [];

  $totalLeads = count($leads);
  $statusCounts = [];
  $totalRevenue = 0;

  foreach ($leads as $lead) {
    $status = (string)($lead['status'] ?? 'Neu');
    $statusCounts[$status] = ($statusCounts[$status] ?? 0) + 1;

    // Try to get revenue from booked/completed leads
    if (in_array($status, ['Gebucht', 'Abgeschlossen'])) {
      $payload = $lead['payload'] ?? [];
      if (is_string($payload)) $payload = json_decode($payload, true) ?: [];
      $price = (float)($payload['price'] ?? $payload['preis'] ?? 0);
      $totalRevenue += $price;
    }
  }

  $neu = $statusCounts['Neu'] ?? 0;
  $bearbeitung = $statusCounts['In Bearbeitung'] ?? 0;
  $angebot = $statusCounts['Angebot gesendet'] ?? 0;
  $gebucht = $statusCounts['Gebucht'] ?? 0;
  $abgeschlossen = $statusCounts['Abgeschlossen'] ?? 0;
  $conversionPct = $totalLeads > 0 ? round(($gebucht + $abgeschlossen) / $totalLeads * 100) : 0;
  $revenueFormatted = number_format($totalRevenue, 0, ',', '.') . ' €';

  // Build email
  $subject = "AnfrageBox Report: {$monthNameDe} — {$totalLeads} Anfragen";

  $html = '<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;background:#f9f9f7;padding:40px 20px;margin:0;">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e5e5e0;">
  <div style="background:#0D7C5F;padding:28px 36px;">
    <div style="font-size:20px;font-weight:800;color:#fff;">AnfrageBox</div>
    <div style="font-size:13px;color:rgba(255,255,255,.6);margin-top:4px;">Monatlicher Report</div>
  </div>
  <div style="padding:36px;">
    <h1 style="font-size:22px;font-weight:800;color:#1a1a18;margin:0 0 8px;">' . htmlspecialchars($monthNameDe) . '</h1>
    <p style="font-size:14px;color:#7a776e;margin:0 0 28px;">Zusammenfassung für ' . htmlspecialchars($companyName) . '</p>

    <!-- KPIs -->
    <div style="display:flex;gap:12px;margin-bottom:24px;">
      <div style="flex:1;background:#F8F6F2;border-radius:12px;padding:16px;text-align:center;">
        <div style="font-size:28px;font-weight:800;color:#1a1a18;">' . $totalLeads . '</div>
        <div style="font-size:11px;font-weight:700;color:#7a776e;text-transform:uppercase;letter-spacing:.05em;">Anfragen</div>
      </div>
      <div style="flex:1;background:#E8F5EF;border-radius:12px;padding:16px;text-align:center;">
        <div style="font-size:28px;font-weight:800;color:#0D7C5F;">' . ($gebucht + $abgeschlossen) . '</div>
        <div style="font-size:11px;font-weight:700;color:#7a776e;text-transform:uppercase;letter-spacing:.05em;">Gebucht</div>
      </div>
      <div style="flex:1;background:#F8F6F2;border-radius:12px;padding:16px;text-align:center;">
        <div style="font-size:28px;font-weight:800;color:#1a1a18;">' . $conversionPct . '%</div>
        <div style="font-size:11px;font-weight:700;color:#7a776e;text-transform:uppercase;letter-spacing:.05em;">Konversion</div>
      </div>
    </div>

    <!-- Revenue -->
    ' . ($totalRevenue > 0 ? '<div style="background:#E8F5EF;border:1px solid #C2E5D5;border-radius:12px;padding:20px;text-align:center;margin-bottom:24px;">
      <div style="font-size:12px;font-weight:700;color:#7a776e;text-transform:uppercase;margin-bottom:4px;">Umsatz (Gebucht + Abgeschlossen)</div>
      <div style="font-size:32px;font-weight:800;color:#0D7C5F;">' . $revenueFormatted . '</div>
    </div>' : '') . '

    <!-- Status Breakdown -->
    <div style="margin-bottom:24px;">
      <div style="font-size:14px;font-weight:700;color:#1a1a18;margin-bottom:12px;">Status-Übersicht</div>
      <div style="font-size:13px;color:#4a4a42;line-height:2;">
        Neu: <strong>' . $neu . '</strong><br>
        In Bearbeitung: <strong>' . $bearbeitung . '</strong><br>
        Angebot gesendet: <strong>' . $angebot . '</strong><br>
        Gebucht: <strong>' . $gebucht . '</strong><br>
        Abgeschlossen: <strong>' . $abgeschlossen . '</strong>
      </div>
    </div>

    <a href="https://anfragebox.de/anfrage/admin.html" style="display:inline-block;padding:14px 28px;background:#0D7C5F;color:#fff;border-radius:10px;font-size:15px;font-weight:700;text-decoration:none;">Admin Panel öffnen →</a>

    <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e5e0;font-size:12px;color:#b0ada5;">
      Dieser Report wird automatisch am 1. jedes Monats gesendet.<br>
      AnfrageBox — anfragebox.de
    </div>
  </div>
</div>
</body></html>';

  $text = "AnfrageBox Report: {$monthNameDe}\n"
    . "Firma: {$companyName}\n\n"
    . "Anfragen: {$totalLeads}\n"
    . "Gebucht: " . ($gebucht + $abgeschlossen) . "\n"
    . "Konversion: {$conversionPct}%\n"
    . ($totalRevenue > 0 ? "Umsatz: {$revenueFormatted}\n" : "")
    . "\nAdmin: https://anfragebox.de/anfrage/admin.html\n";

  try {
    $mail = new \PHPMailer\PHPMailer\PHPMailer(true);
    $mail->isSMTP();
    $mail->Host       = $SMTP_HOST;
    $mail->SMTPAuth   = true;
    $mail->Username   = $SMTP_USER;
    $mail->Password   = $SMTP_PASS;
    $mail->Port       = $SMTP_PORT;
    $mail->CharSet    = 'UTF-8';
    $mail->SMTPSecure = \PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_SMTPS;

    $mail->setFrom($SMTP_USER, 'AnfrageBox');
    $mail->addAddress($email, $companyName);
    $mail->addReplyTo('info@anfragebox.de', 'AnfrageBox');

    $mail->isHTML(true);
    $mail->Subject = $subject;
    $mail->Body    = $html;
    $mail->AltBody = $text;
    $mail->send();

    $sent++;
    clog("OK: sent to {$email} ({$companyName}) - {$totalLeads} leads");
  } catch (\Throwable $e) {
    clog("FAIL: {$email} - " . $e->getMessage());
  }
}

clog("Done. Sent: {$sent}/" . count($companies));
echo json_encode(['ok' => true, 'sent' => $sent, 'total_companies' => count($companies)]);