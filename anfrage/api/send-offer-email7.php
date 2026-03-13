<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

require_once __DIR__ . '/config.php';

/* ── helpers ─────────────────────────────────────────────── */

function respond(int $code, array $data): void {
  http_response_code($code);
  echo json_encode($data, JSON_UNESCAPED_UNICODE);
  exit;
}

function log_error(string $msg): void {
  $line = '[' . date('c') . '] ' . $msg . "\n";
  @file_put_contents(__DIR__ . '/offer_email_errors.log', $line, FILE_APPEND);
}

register_shutdown_function(function () {
  $e = error_get_last();
  if ($e && in_array($e['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
    log_error('FATAL: ' . $e['message'] . ' in ' . $e['file'] . ':' . $e['line']);
    if (!headers_sent()) header('Content-Type: application/json; charset=utf-8');
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Server error'], JSON_UNESCAPED_UNICODE);
    exit;
  }
});

function h($s): string {
  if ($s === null) return '';
  if (is_array($s) || is_object($s)) $s = json_encode($s, JSON_UNESCAPED_UNICODE);
  if (is_bool($s)) $s = $s ? '1' : '0';
  return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8');
}

function get_ip(): string {
  $ip = $_SERVER['REMOTE_ADDR'] ?? '';
  return is_string($ip) ? $ip : '';
}

function rate_limit(string $dir, int $max, int $windowSec): void {
  if (!is_dir($dir)) @mkdir($dir, 0755, true);
  $ip = get_ip();
  if ($ip === '') return;

  $key = hash('sha256', $ip);
  $file = $dir . '/' . $key . '.json';
  $now = time();

  $fp = @fopen($file, 'c+');
  if (!$fp) return;
  @flock($fp, LOCK_EX);

  $raw = stream_get_contents($fp);
  $list = [];
  if (is_string($raw) && $raw !== '') {
    $decoded = json_decode($raw, true);
    if (is_array($decoded)) $list = $decoded;
  }

  $cut = $now - $windowSec;
  $list = array_values(array_filter($list, fn($t) => is_int($t) && $t >= $cut));

  if (count($list) >= $max) {
    @flock($fp, LOCK_UN);
    @fclose($fp);
    respond(429, ['ok' => false, 'error' => 'Too many requests']);
  }

  $list[] = $now;
  ftruncate($fp, 0);
  rewind($fp);
  fwrite($fp, json_encode($list));
  @flock($fp, LOCK_UN);
  @fclose($fp);
}

function check_origin(array $allowed): void {
  $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
  if (!is_string($origin) || $origin === '') return;
  if (!in_array($origin, $allowed, true)) {
    respond(403, ['ok' => false, 'error' => 'Forbidden origin']);
  }
  header('Access-Control-Allow-Origin: ' . $origin);
  header('Access-Control-Allow-Methods: POST, OPTIONS');
  header('Access-Control-Allow-Headers: Content-Type, Authorization');
  header('Vary: Origin');
}

function post_json(): array {
  if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization');
    respond(200, ['ok' => true]);
  }

  if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    respond(405, ['ok' => false, 'error' => 'Method not allowed']);
  }

  $ct = (string)($_SERVER['CONTENT_TYPE'] ?? '');
  if (stripos($ct, 'application/json') === false) {
    respond(415, ['ok' => false, 'error' => 'Invalid content-type']);
  }

  $raw = file_get_contents('php://input');
  $data = json_decode($raw, true);
  return is_array($data) ? $data : [];
}

function verify_supabase_token(string $baseUrl, string $token): ?array {
  if ($token === '') return null;

  $url = rtrim($baseUrl, '/') . '/auth/v1/user';
  $ch = curl_init($url);
  curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
  curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'apikey: ' . SUPABASE_ANON_KEY,
    'Authorization: Bearer ' . $token,
  ]);
  curl_setopt($ch, CURLOPT_TIMEOUT, 10);

  $res = curl_exec($ch);
  $http = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);

  if ($http !== 200 || $res === false) return null;

  $user = json_decode((string)$res, true);
  if (!is_array($user) || empty($user['id'])) return null;

  return $user;
}

function supabase_select_one(string $baseUrl, string $path, string $serviceRole): ?array {
  $url = rtrim($baseUrl, '/') . $path;

  $ch = curl_init($url);
  curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
  curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'apikey: ' . $serviceRole,
    'Authorization: Bearer ' . $serviceRole,
    'Accept: application/json',
  ]);
  curl_setopt($ch, CURLOPT_TIMEOUT, 15);

  $res = curl_exec($ch);
  $http = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);

  if ($res === false || $http < 200 || $http >= 300) return null;

  $out = json_decode((string)$res, true);
  if (!is_array($out) || !isset($out[0]) || !is_array($out[0])) return null;

  return $out[0];
}

function supabase_insert(string $baseUrl, string $table, string $serviceRole, array $row): ?array {
  $url = rtrim($baseUrl, '/') . '/rest/v1/' . rawurlencode($table) . '?select=*';

  $ch = curl_init($url);
  curl_setopt($ch, CURLOPT_POST, true);
  curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
  curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Content-Type: application/json',
    'apikey: ' . $serviceRole,
    'Authorization: Bearer ' . $serviceRole,
    'Prefer: return=representation',
  ]);
  curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($row, JSON_UNESCAPED_UNICODE));

  $res = curl_exec($ch);
  $http = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);

  if ($res === false || $http < 200 || $http >= 300) {
    log_error('Supabase insert offers failed HTTP ' . $http . ': ' . substr((string)$res, 0, 2000));
    return null;
  }

  $out = json_decode((string)$res, true);
  return (is_array($out) && isset($out[0])) ? $out[0] : (is_array($out) ? $out : null);
}

function supabase_update(string $baseUrl, string $table, string $serviceRole, string $id, array $fields): bool {
  $url = rtrim($baseUrl, '/') . '/rest/v1/' . rawurlencode($table) . '?id=eq.' . rawurlencode($id);

  $ch = curl_init($url);
  curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'PATCH');
  curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
  curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Content-Type: application/json',
    'apikey: ' . $serviceRole,
    'Authorization: Bearer ' . $serviceRole,
    'Prefer: return=minimal',
  ]);
  curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($fields, JSON_UNESCAPED_UNICODE));

  $res = curl_exec($ch);
  $http = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);

  return $http >= 200 && $http < 300;
}

/* ── config ──────────────────────────────────────────────── */

$ALLOWED_ORIGINS = ['https://anfragebox.de', 'https://www.anfragebox.de'];
$RATE_LIMIT_DIR  = __DIR__ . '/ratelimit_offer';
$RATE_MAX        = 20;
$RATE_WINDOW     = 600;

$SUPABASE_URL = SUPABASE_URL;

$SMTP_HOST   = SMTP_HOST;
$SMTP_PORT   = SMTP_PORT;
$SMTP_USER   = SMTP_USER;
$SMTP_SECURE = SMTP_SECURE;

/* ── start ───────────────────────────────────────────────── */

check_origin($ALLOWED_ORIGINS);
rate_limit($RATE_LIMIT_DIR, $RATE_MAX, $RATE_WINDOW);

$SERVICE_ROLE = SUPABASE_SERVICE_ROLE_KEY;
$SMTP_PASS    = SMTP_PASS;

if ($SERVICE_ROLE === '' || strlen($SERVICE_ROLE) < 40) {
  log_error('SERVICE_ROLE missing');
  respond(500, ['ok' => false, 'error' => 'Server not configured']);
}
if ($SMTP_PASS === '') {
  log_error('SMTP_PASS missing');
  respond(500, ['ok' => false, 'error' => 'Email not configured']);
}

$data = post_json();

/* ── auth: verify JWT from Authorization header ────────── */

$authHeader = (string)($_SERVER['HTTP_AUTHORIZATION'] ?? '');
$token = '';
if (stripos($authHeader, 'Bearer ') === 0) {
  $token = trim(substr($authHeader, 7));
}

if ($token === '') {
  respond(401, ['ok' => false, 'error' => 'Not authenticated']);
}

$user = verify_supabase_token($SUPABASE_URL, $token);
if (!$user) {
  respond(401, ['ok' => false, 'error' => 'Invalid token']);
}

$userId = (string)$user['id'];

/* ── validate input ──────────────────────────────────────── */

$leadId        = trim((string)($data['lead_id'] ?? ''));
$companyId     = trim((string)($data['company_id'] ?? ''));
$recipientEmail = trim((string)($data['recipient_email'] ?? ''));
$recipientName  = trim((string)($data['recipient_name'] ?? ''));
$subject        = trim((string)($data['subject'] ?? ''));
$priceEur       = trim((string)($data['price_eur'] ?? ''));
$offerText      = trim((string)($data['offer_text'] ?? ''));
$emailBody      = trim((string)($data['email_body'] ?? ''));

if ($leadId === '') respond(400, ['ok' => false, 'error' => 'lead_id required']);
if ($companyId === '') respond(400, ['ok' => false, 'error' => 'company_id required']);
if ($recipientEmail === '' || !filter_var($recipientEmail, FILTER_VALIDATE_EMAIL)) {
  respond(400, ['ok' => false, 'error' => 'Valid recipient_email required']);
}

if ($subject === '') $subject = 'Ihr Umzugsangebot';

/* ── verify user belongs to company ──────────────────────── */

$memberPath =
  '/rest/v1/company_users'
  . '?select=id,role'
  . '&user_id=eq.' . rawurlencode($userId)
  . '&company_id=eq.' . rawurlencode($companyId)
  . '&is_active=eq.true'
  . '&limit=1';

$member = supabase_select_one($SUPABASE_URL, $memberPath, $SERVICE_ROLE);
if (!$member) {
  respond(403, ['ok' => false, 'error' => 'No access to this company']);
}

/* ── verify lead belongs to company ──────────────────────── */

$leadPath =
  '/rest/v1/leads'
  . '?select=id,company_id,customer_name,customer_email,status'
  . '&id=eq.' . rawurlencode($leadId)
  . '&company_id=eq.' . rawurlencode($companyId)
  . '&limit=1';

$lead = supabase_select_one($SUPABASE_URL, $leadPath, $SERVICE_ROLE);
if (!$lead) {
  respond(404, ['ok' => false, 'error' => 'Lead not found']);
}

/* ── load company settings for branding ──────────────────── */

$settingsPath =
  '/rest/v1/company_settings'
  . '?select=company_name,phone,email,street,cityline,country'
  . '&company_id=eq.' . rawurlencode($companyId)
  . '&limit=1';

$settings = supabase_select_one($SUPABASE_URL, $settingsPath, $SERVICE_ROLE);
$brandName  = trim((string)($settings['company_name'] ?? 'AnfrageBox'));
$brandEmail = trim((string)($settings['email'] ?? $SMTP_USER));
$brandPhone = trim((string)($settings['phone'] ?? ''));

/* ── build email HTML ────────────────────────────────────── */

// Lookup portal token for this lead
$portalUrl = '';
$ptPath = '/rest/v1/portal_tokens'
  . '?select=token'
  . '&lead_id=eq.' . rawurlencode($leadId)
  . '&company_id=eq.' . rawurlencode($companyId)
  . '&is_active=eq.true'
  . '&limit=1';
$ptRow = supabase_select_one($SUPABASE_URL, $ptPath, $SERVICE_ROLE);
if ($ptRow && !empty($ptRow['token'])) {
  $siteHost = $_SERVER['HTTP_HOST'] ?? 'anfragebox.de';
  $portalUrl = 'https://' . $siteHost . '/portal/' . $ptRow['token'];
}

$portalBlock = '';
if ($portalUrl !== '') {
  $portalBlock =
    '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px;margin:16px 0;text-align:center">' .
      '<div style="font-size:15px;font-weight:700;color:#065f46;margin:0 0 8px">Angebot online ansehen und annehmen</div>' .
      '<div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 16px">' .
        'Klicken Sie auf den Button, um Ihr Angebot einzusehen, zu akzeptieren und digital zu unterschreiben.' .
      '</div>' .
      '<a href="' . h($portalUrl) . '" style="display:inline-block;padding:14px 32px;background:#047857;color:#ffffff;border-radius:8px;font-size:15px;font-weight:700;text-decoration:none">' .
        'Angebot ansehen und unterschreiben' .
      '</a>' .
    '</div>';
}

$defaultBody =
  '<p>Guten Tag ' . h($recipientName ?: 'Kunde') . ',</p>' .
  '<p>anbei erhalten Sie unser Angebot für Ihren Umzug.</p>' .
  ($priceEur !== '' ? '<p style="font-size:18px;font-weight:700;color:#047857">Gesamtpreis: ' . h(number_format((float)$priceEur, 2, ',', '.')) . ' EUR (brutto)</p>' : '') .
  $portalBlock .
  '<p>Bei Fragen stehen wir Ihnen gerne zur Verfügung.</p>' .
  '<p>Mit freundlichen Grüßen<br>' . h($brandName) . '</p>' .
  ($brandPhone !== '' ? '<p>Tel.: ' . h($brandPhone) . '</p>' : '') .
  ($brandEmail !== '' ? '<p>E-Mail: ' . h($brandEmail) . '</p>' : '');

$bodyHtml = $emailBody !== '' ? nl2br(h($emailBody)) : $defaultBody;

$emailHtml =
  '<div style="font-family:Inter,Arial,sans-serif;color:#0f172a;line-height:1.65;max-width:640px;margin:0 auto">' .
    '<div style="padding:18px 0 12px">' .
      '<div style="font-size:20px;font-weight:900;letter-spacing:-.02em">' . h($brandName) . '</div>' .
      '<div style="margin-top:4px;font-size:12px;color:#64748b">' .
        ($brandPhone !== '' ? 'Tel.: ' . h($brandPhone) . ' | ' : '') .
        'E-Mail: ' . h($brandEmail) .
      '</div>' .
      '<div style="margin-top:12px;height:3px;background:#16a34a;border-radius:999px"></div>' .
    '</div>' .
    '<div style="padding:14px 0">' . $bodyHtml . '</div>' .
    '<div style="padding:14px 0;font-size:12px;color:#94a3b8;border-top:1px solid #e5e7eb">' .
      'Diese E-Mail wurde über AnfrageBox versendet.' .
    '</div>' .
  '</div>';

$emailText =
  $brandName . "\n\n" .
  strip_tags(str_replace(['<br>', '<br/>', '<br />', '</p>'], "\n", $bodyHtml)) . "\n";

/* ── send email via PHPMailer ────────────────────────────── */

$pmDir = __DIR__ . '/phpmailer';
$pmOk =
  is_readable($pmDir . '/PHPMailer.php') &&
  is_readable($pmDir . '/SMTP.php') &&
  is_readable($pmDir . '/Exception.php');

if (!$pmOk) {
  log_error('PHPMailer missing in ' . $pmDir);
  respond(500, ['ok' => false, 'error' => 'Email library missing']);
}

require_once $pmDir . '/Exception.php';
require_once $pmDir . '/PHPMailer.php';
require_once $pmDir . '/SMTP.php';

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

  $mail->setFrom($SMTP_USER, $brandName);
  $mail->addAddress($recipientEmail, $recipientName);
  if ($brandEmail !== '' && $brandEmail !== $SMTP_USER) {
    $mail->addReplyTo($brandEmail, $brandName);
  }

  $mail->isHTML(true);
  $mail->Subject = $subject;
  $mail->Body    = $emailHtml;
  $mail->AltBody = $emailText;

  // No PDF attachment — offer is accessible only via Kundenportal

  $mail->send();

} catch (\Throwable $e) {
  log_error('PHPMailer send failed for lead ' . $leadId . ': ' . $e->getMessage());
  respond(500, ['ok' => false, 'error' => 'Email send failed: ' . $e->getMessage()]);
}

/* ── save to offers table ────────────────────────────────── */

$offerRow = [
  'lead_id'       => $leadId,
  'price_eur'     => $priceEur !== '' ? (float)$priceEur : null,
  'offer_text'    => $offerText !== '' ? $offerText : null,
  'sent_email_at' => date('c'),
];

$offerResult = supabase_insert($SUPABASE_URL, 'offers', $SERVICE_ROLE, $offerRow);

/* ── update lead status to "Angebot gesendet" ────────────── */

supabase_update($SUPABASE_URL, 'leads', $SERVICE_ROLE, $leadId, [
  'status' => 'Angebot gesendet',
]);

/* ── log to lead_status_history ──────────────────────────── */

$oldStatus = trim((string)($lead['status'] ?? 'Neu'));
if ($oldStatus !== 'Angebot gesendet') {
  supabase_insert($SUPABASE_URL, 'lead_status_history', $SERVICE_ROLE, [
    'lead_id'    => $leadId,
    'old_status' => $oldStatus,
    'new_status' => 'Angebot gesendet',
    'changed_by' => $userId,
  ]);
}

log_error('OFFER EMAIL SENT | lead=' . $leadId . ' | to=' . $recipientEmail . ' | company=' . $companyId);

respond(200, [
  'ok'             => true,
  'lead_id'        => $leadId,
  'recipient'      => $recipientEmail,
  'offer_id'       => (string)($offerResult['id'] ?? ''),
  'sent_at'        => date('c'),
  'status_updated' => true,
]);