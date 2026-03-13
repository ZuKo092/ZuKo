<?php
declare(strict_types=1);

/**
 * notify-new-lead.php — AnfrageBox Lead Notification System
 *
 * Called internally from lead33.php after a lead is inserted.
 * Sends a clean email to all opted-in company users.
 *
 * POST body (JSON):
 *   lead_id, company_id, customer_name, customer_phone,
 *   customer_email, from_city, to_city, move_date, created_at
 *
 * Anti-spam:
 *   - Deduplication by lead_id (file lock)
 *   - Max 30 emails per company per hour
 *   - Quiet hours per user (no emails between start-end)
 *   - Only opted-in users receive emails
 */

header('Content-Type: application/json; charset=utf-8');

function nlog(string $msg): void {
  $line = '[' . date('c') . '] ' . $msg . "\n";
  @file_put_contents(__DIR__ . '/notify-new-lead.log', $line, FILE_APPEND);
}

function nrespond(int $code, array $data): void {
  http_response_code($code);
  echo json_encode($data, JSON_UNESCAPED_UNICODE);
  exit;
}

function h(string $s): string {
  return htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
}

function load_secrets(string $path): array {
  if (!is_readable($path)) return [];
  $tmp = require $path;
  return is_array($tmp) ? $tmp : [];
}

/* ── Internal auth: only callable from same server ── */
$internalToken = $_SERVER['HTTP_X_INTERNAL_TOKEN'] ?? '';
$secrets = load_secrets(__DIR__ . '/_secrets.php');
$CRON_TOKEN = (string)($secrets['CRON_TOKEN_FOLLOWUP'] ?? '');

if ($CRON_TOKEN === '' || !hash_equals($CRON_TOKEN, $internalToken)) {
  // Allow localhost calls without token (same-server call from lead33.php)
  $remoteIp = $_SERVER['REMOTE_ADDR'] ?? '';
  if (!in_array($remoteIp, ['127.0.0.1', '::1', ''], true)) {
    nrespond(401, ['ok' => false, 'error' => 'unauthorized']);
  }
}

/* ── Config ── */
$SB_URL       = 'https://uledkuegmaritmsjejlm.supabase.co';
$SB_KEY       = (string)($secrets['SUPABASE_SERVICE_ROLE'] ?? '');
$SMTP_HOST    = 'smtp.hostinger.com';
$SMTP_PORT    = 465;
$SMTP_USER    = 'info@grapify-media.de';
$SMTP_PASS    = (string)($secrets['SMTP_PASS'] ?? '');
$DEDUP_DIR    = __DIR__ . '/notify_dedup';
$RATE_DIR     = __DIR__ . '/notify_ratelimit';
$RATE_MAX     = 30; // max emails per company per hour
$RATE_WINDOW  = 3600;

if ($SB_KEY === '' || $SMTP_PASS === '') {
  nlog('ERROR: Missing secrets');
  nrespond(500, ['ok' => false, 'error' => 'not configured']);
}

/* ── Parse input ── */
$raw = file_get_contents('php://input');
$data = json_decode($raw ?: '', true);
if (!is_array($data)) $data = [];

$leadId       = trim((string)($data['lead_id'] ?? ''));
$companyId    = trim((string)($data['company_id'] ?? ''));
$custName     = trim((string)($data['customer_name'] ?? ''));
$custPhone    = trim((string)($data['customer_phone'] ?? ''));
$custEmail    = trim((string)($data['customer_email'] ?? ''));
$fromCity     = trim((string)($data['from_city'] ?? ''));
$toCity       = trim((string)($data['to_city'] ?? ''));
$moveDate     = trim((string)($data['move_date'] ?? ''));
$createdAt    = trim((string)($data['created_at'] ?? date('c')));

if ($leadId === '' || $companyId === '') {
  nrespond(400, ['ok' => false, 'error' => 'lead_id and company_id required']);
}

/* ── Deduplication: one notification per lead, ever ── */
if (!is_dir($DEDUP_DIR)) @mkdir($DEDUP_DIR, 0755, true);
$dedupFile = $DEDUP_DIR . '/' . hash('sha256', $leadId) . '.lock';
$dedupFp = @fopen($dedupFile, 'x'); // fails if file exists
if ($dedupFp === false) {
  nlog('DEDUP: already notified for lead ' . $leadId);
  nrespond(200, ['ok' => true, 'skipped' => 'already_notified']);
}
fclose($dedupFp);

/* ── Company rate limit ── */
if (!is_dir($RATE_DIR)) @mkdir($RATE_DIR, 0755, true);
$rateFile = $RATE_DIR . '/' . hash('sha256', $companyId) . '.json';
$now = time();

$rateFp = @fopen($rateFile, 'c+');
if ($rateFp) {
  @flock($rateFp, LOCK_EX);
  $rateRaw = stream_get_contents($rateFp);
  $rateList = [];
  if (is_string($rateRaw) && $rateRaw !== '') {
    $decoded = json_decode($rateRaw, true);
    if (is_array($decoded)) $rateList = $decoded;
  }
  $cut = $now - $RATE_WINDOW;
  $rateList = array_values(array_filter($rateList, fn($t) => is_int($t) && $t >= $cut));

  if (count($rateList) >= $RATE_MAX) {
    @flock($rateFp, LOCK_UN);
    @fclose($rateFp);
    nlog('RATE LIMIT: company ' . $companyId . ' exceeded ' . $RATE_MAX . '/hr');
    nrespond(200, ['ok' => true, 'skipped' => 'rate_limited']);
  }
}

/* ── Supabase helper ── */
function sb_get(string $path): ?array {
  global $SB_URL, $SB_KEY;
  $ch = curl_init(rtrim($SB_URL, '/') . $path);
  curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 10,
    CURLOPT_HTTPHEADER => [
      'apikey: ' . $SB_KEY,
      'Authorization: Bearer ' . $SB_KEY,
      'Accept: application/json',
    ],
  ]);
  $body = curl_exec($ch);
  $http = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);
  if ($http !== 200 || $body === false) return null;
  return json_decode((string)$body, true);
}

/* ── Get notification preferences for this company ── */
$prefsPath = '/rest/v1/notification_preferences'
  . '?company_id=eq.' . rawurlencode($companyId)
  . '&notify_new_lead=eq.true'
  . '&select=user_id,notify_email,quiet_hours_start,quiet_hours_end';

$prefs = sb_get($prefsPath);

if (!is_array($prefs) || count($prefs) === 0) {
  // Fallback: get company owner email from company_settings
  $settingsPath = '/rest/v1/company_settings'
    . '?company_id=eq.' . rawurlencode($companyId)
    . '&select=email,company_name'
    . '&limit=1';
  $settings = sb_get($settingsPath);

  if (is_array($settings) && isset($settings[0]['email']) && $settings[0]['email'] !== '') {
    // Send to company email as default (no prefs configured yet)
    $prefs = [['notify_email' => $settings[0]['email'], 'quiet_hours_start' => null, 'quiet_hours_end' => null, 'user_id' => null]];
    nlog('FALLBACK: no prefs for company ' . $companyId . ', using company email ' . $settings[0]['email']);
  } else {
    nlog('SKIP: no prefs and no company email for ' . $companyId);
    nrespond(200, ['ok' => true, 'skipped' => 'no_recipients']);
  }
}

/* ── Get company name for branding ── */
$settingsPath2 = '/rest/v1/company_settings'
  . '?company_id=eq.' . rawurlencode($companyId)
  . '&select=company_name,slug'
  . '&limit=1';
$settings2 = sb_get($settingsPath2);
$companyName = 'AnfrageBox';
$companySlug = '';
if (is_array($settings2) && isset($settings2[0])) {
  $companyName = trim((string)($settings2[0]['company_name'] ?? 'AnfrageBox'));
  $companySlug = trim((string)($settings2[0]['slug'] ?? ''));
}

/* ── Check quiet hours ── */
function isQuietHour(?string $start, ?string $end): bool {
  if ($start === null || $end === null || $start === '' || $end === '') return false;
  $nowH = (int)date('G');
  $nowM = (int)date('i');
  $nowMin = $nowH * 60 + $nowM;

  $parts = explode(':', $start);
  $startMin = ((int)($parts[0] ?? 0)) * 60 + ((int)($parts[1] ?? 0));
  $parts2 = explode(':', $end);
  $endMin = ((int)($parts2[0] ?? 0)) * 60 + ((int)($parts2[1] ?? 0));

  if ($startMin <= $endMin) {
    // Same day range: e.g. 22:00-23:00
    return $nowMin >= $startMin && $nowMin < $endMin;
  } else {
    // Overnight range: e.g. 22:00-07:00
    return $nowMin >= $startMin || $nowMin < $endMin;
  }
}

/* ── Build email ── */
$route = '';
if ($fromCity !== '' && $toCity !== '') {
  $route = $fromCity . ' → ' . $toCity;
} elseif ($fromCity !== '') {
  $route = $fromCity;
}

$moveDateFormatted = '';
if ($moveDate !== '' && $moveDate !== '-') {
  $dt = strtotime($moveDate);
  if ($dt !== false) {
    $moveDateFormatted = date('d.m.Y', $dt);
  }
}

$createdFormatted = '';
if ($createdAt !== '') {
  $dt2 = strtotime($createdAt);
  if ($dt2 !== false) {
    $createdFormatted = date('d.m.Y, H:i', $dt2) . ' Uhr';
  }
}

$adminUrl = 'https://anfragebox.de/anfrage/admin.html#leads';

$subject = 'Neue Anfrage' . ($custName !== '' ? ': ' . $custName : '') . ($route !== '' ? ' (' . $route . ')' : '');

$emailHtml = '<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:Inter,Arial,sans-serif;background:#f8f9fb;padding:32px 16px;margin:0;">
<div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">

  <div style="background:#047857;padding:20px 28px;">
    <div style="font-size:16px;font-weight:800;color:#ffffff;">' . h($companyName) . '</div>
    <div style="font-size:12px;color:rgba(255,255,255,.6);margin-top:2px;">Neue Anfrage eingegangen</div>
  </div>

  <div style="padding:28px;">

    <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;">
      <div style="width:44px;height:44px;background:#ecfdf5;border-radius:12px;display:flex;align-items:center;justify-content:center;">
        <div style="width:20px;height:20px;background:#047857;border-radius:50%;"></div>
      </div>
      <div>
        <div style="font-size:16px;font-weight:800;color:#0f172a;">' . h($custName ?: 'Neuer Lead') . '</div>
        ' . ($route !== '' ? '<div style="font-size:13px;color:#6b7280;margin-top:1px;">' . h($route) . '</div>' : '') . '
      </div>
    </div>

    <div style="background:#f8f9fb;border-radius:12px;padding:16px;margin-bottom:20px;">
      <table style="width:100%;border-collapse:collapse;">
        ' . ($custPhone !== '' ? '<tr><td style="padding:6px 0;font-size:13px;color:#6b7280;width:100px;">Telefon</td><td style="padding:6px 0;font-size:13px;font-weight:700;color:#0f172a;">' . h($custPhone) . '</td></tr>' : '') . '
        ' . ($custEmail !== '' ? '<tr><td style="padding:6px 0;font-size:13px;color:#6b7280;">E-Mail</td><td style="padding:6px 0;font-size:13px;font-weight:700;color:#0f172a;">' . h($custEmail) . '</td></tr>' : '') . '
        ' . ($moveDateFormatted !== '' ? '<tr><td style="padding:6px 0;font-size:13px;color:#6b7280;">Umzugsdatum</td><td style="padding:6px 0;font-size:13px;font-weight:700;color:#0f172a;">' . h($moveDateFormatted) . '</td></tr>' : '') . '
        ' . ($createdFormatted !== '' ? '<tr><td style="padding:6px 0;font-size:13px;color:#6b7280;">Eingegangen</td><td style="padding:6px 0;font-size:13px;font-weight:700;color:#0f172a;">' . h($createdFormatted) . '</td></tr>' : '') . '
      </table>
    </div>

    <a href="' . h($adminUrl) . '" style="display:block;text-align:center;padding:14px 28px;background:#047857;color:#ffffff;border-radius:10px;font-size:14px;font-weight:700;text-decoration:none;">
      Lead ansehen
    </a>

  </div>

  <div style="padding:16px 28px;border-top:1px solid #f3f4f6;font-size:11px;color:#9ca3af;line-height:1.5;">
    Sie erhalten diese Nachricht, weil Lead-Benachrichtigungen aktiviert sind.
    <a href="' . h($adminUrl) . '#settings" style="color:#047857;text-decoration:none;">Einstellungen ändern</a>
  </div>

</div>
</body></html>';

$emailText = "Neue Anfrage: " . ($custName ?: 'Neuer Lead') . "\n"
  . ($route !== '' ? "Route: {$route}\n" : '')
  . ($custPhone !== '' ? "Telefon: {$custPhone}\n" : '')
  . ($custEmail !== '' ? "E-Mail: {$custEmail}\n" : '')
  . ($moveDateFormatted !== '' ? "Umzugsdatum: {$moveDateFormatted}\n" : '')
  . "\nLead ansehen: {$adminUrl}\n";

/* ── PHPMailer ── */
$pmDir = __DIR__ . '/phpmailer';
if (!is_readable($pmDir . '/PHPMailer.php')) {
  nlog('ERROR: PHPMailer missing');
  nrespond(500, ['ok' => false, 'error' => 'mailer missing']);
}
require_once $pmDir . '/Exception.php';
require_once $pmDir . '/PHPMailer.php';
require_once $pmDir . '/SMTP.php';

/* ── Send to each opted-in user ── */
$sent = 0;
$skipped = 0;

foreach ($prefs as $pref) {
  $recipientEmail = trim((string)($pref['notify_email'] ?? ''));
  if ($recipientEmail === '' || !filter_var($recipientEmail, FILTER_VALIDATE_EMAIL)) {
    $skipped++;
    continue;
  }

  // Check quiet hours
  $qStart = $pref['quiet_hours_start'] ?? null;
  $qEnd = $pref['quiet_hours_end'] ?? null;
  if (isQuietHour($qStart, $qEnd)) {
    nlog('QUIET: skipping ' . $recipientEmail . ' (quiet ' . $qStart . '-' . $qEnd . ')');
    $skipped++;
    continue;
  }

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

    $mail->setFrom($SMTP_USER, $companyName);
    $mail->addAddress($recipientEmail);
    $mail->addReplyTo('info@anfragebox.de', 'AnfrageBox');

    $mail->isHTML(true);
    $mail->Subject = $subject;
    $mail->Body    = $emailHtml;
    $mail->AltBody = $emailText;
    $mail->send();

    $sent++;
    nlog('SENT: ' . $recipientEmail . ' for lead ' . $leadId);
  } catch (\Throwable $e) {
    nlog('FAIL: ' . $recipientEmail . ' - ' . $e->getMessage());
  }
}

/* ── Update rate counter ── */
if ($rateFp && $sent > 0) {
  for ($i = 0; $i < $sent; $i++) $rateList[] = $now;
  ftruncate($rateFp, 0);
  rewind($rateFp);
  fwrite($rateFp, json_encode($rateList));
}
if ($rateFp) {
  @flock($rateFp, LOCK_UN);
  @fclose($rateFp);
}

/* ── Cleanup old dedup files (older than 7 days) ── */
if (rand(1, 50) === 1) { // 2% chance per request
  $cutoff = $now - 604800;
  foreach (glob($DEDUP_DIR . '/*.lock') as $f) {
    if (filemtime($f) < $cutoff) @unlink($f);
  }
  foreach (glob($RATE_DIR . '/*.json') as $f) {
    if (filemtime($f) < $cutoff) @unlink($f);
  }
}

nlog("DONE: lead={$leadId} company={$companyId} sent={$sent} skipped={$skipped}");
nrespond(200, ['ok' => true, 'sent' => $sent, 'skipped' => $skipped]);