<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

function respond(int $code, array $data): void {
  http_response_code($code);
  echo json_encode($data, JSON_UNESCAPED_UNICODE);
  exit;
}

function log_error(string $msg): void {
  $line = '[' . date('c') . '] ' . $msg . "\n";
  @file_put_contents(__DIR__ . '/lead_errors.log', $line, FILE_APPEND);
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

function envv(string $k): string {
  $v = getenv($k);
  if (is_string($v) && $v !== '') return $v;
  if (isset($_ENV[$k]) && is_string($_ENV[$k]) && $_ENV[$k] !== '') return $_ENV[$k];
  if (isset($_SERVER[$k]) && is_string($_SERVER[$k]) && $_SERVER[$k] !== '') return $_SERVER[$k];
  return '';
}

require_once __DIR__ . '/config.php';

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
  header('Vary: Origin');
}

function post_json(): array {
  if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
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

function supabase_insert(string $baseUrl, string $table, string $serviceRole, array $row): array {
  $url = rtrim($baseUrl, '/') . '/rest/v1/' . rawurlencode($table) . '?select=id,created_at';

  $ch = curl_init($url);
  curl_setopt($ch, CURLOPT_POST, true);
  curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
  curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Content-Type: application/json',
    'apikey: ' . $serviceRole,
    'Authorization: Bearer ' . $serviceRole,
    'Prefer: return=representation'
  ]);
  curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($row, JSON_UNESCAPED_UNICODE));

  $res = curl_exec($ch);
  $http = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
  $curlErr = curl_error($ch);
  curl_close($ch);

  if ($res === false) {
    log_error('Supabase unreachable: ' . $curlErr);
    respond(502, ['ok' => false, 'error' => 'Database unreachable']);
  }

  if ($http < 200 || $http >= 300) {
    log_error('Supabase insert failed HTTP ' . $http . ': ' . substr((string)$res, 0, 3000));
    respond(500, [
      'ok' => false,
      'error' => 'Insert failed',
      'http' => $http,
      'supabase' => json_decode((string)$res, true),
      'raw' => (string)$res
    ]);
  }

  $out = json_decode((string)$res, true);
  $rowOut = (is_array($out) && isset($out[0]) && is_array($out[0])) ? $out[0] : (is_array($out) ? $out : []);
  return is_array($rowOut) ? $rowOut : [];
}

function supabase_select_one(string $baseUrl, string $path, string $serviceRole): array {
  $url = rtrim($baseUrl, '/') . $path;

  $ch = curl_init($url);
  curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
  curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'apikey: ' . $serviceRole,
    'Authorization: Bearer ' . $serviceRole,
    'Accept: application/json'
  ]);
  curl_setopt($ch, CURLOPT_TIMEOUT, 15);

  $res = curl_exec($ch);
  $http = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
  $curlErr = curl_error($ch);
  curl_close($ch);

  if ($res === false) {
    log_error('Supabase select failed: ' . $curlErr);
    respond(502, ['ok' => false, 'error' => 'Database unreachable']);
  }

  $out = json_decode((string)$res, true);

  if ($http < 200 || $http >= 300) {
    log_error('Supabase select failed HTTP ' . $http . ': ' . substr((string)$res, 0, 3000));
    respond(500, ['ok' => false, 'error' => 'Lookup failed']);
  }

  if (!is_array($out) || !isset($out[0]) || !is_array($out[0])) {
    return [];
  }

  return $out[0];
}

function generate_portal_token(): string {
  $chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  $token = '';
  for ($i = 0; $i < 32; $i++) $token .= $chars[random_int(0, strlen($chars) - 1)];
  return $token;
}

function s($v, int $max = 240): string {
  $t = trim((string)($v ?? ''));
  if ($t === '') return '-';
  if (function_exists('mb_strlen') && function_exists('mb_substr')) {
    if (mb_strlen($t, 'UTF-8') > $max) $t = mb_substr($t, 0, $max, 'UTF-8') . '...';
  } else {
    if (strlen($t) > $max) $t = substr($t, 0, $max) . '...';
  }
  return $t;
}

function yn($v): string {
  if ($v === null) return '-';
  if (is_bool($v)) return $v ? 'Ja' : 'Nein';
  $t = strtolower(trim((string)$v));
  if (in_array($t, ['1','true','yes','ja'], true)) return 'Ja';
  if (in_array($t, ['0','false','no','nein'], true)) return 'Nein';
  return trim((string)$v) !== '' ? (string)$v : '-';
}

function fmt_addr(array $a): string {
  $street = trim((string)($a['street'] ?? ''));
  $nr = trim((string)($a['number'] ?? ''));
  $zip = trim((string)($a['zip'] ?? ''));
  $city = trim((string)($a['city'] ?? ''));
  $country = trim((string)($a['country'] ?? ''));
  $line1 = trim($street . ' ' . $nr);
  $line2 = trim($zip . ' ' . $city);
  $out = trim($line1 . ($line1 && $line2 ? ', ' : '') . $line2);
  if ($country !== '') $out .= ($out ? ', ' : '') . $country;
  return $out !== '' ? $out : '-';
}

function card(string $title, string $body): string {
  return '<div style="border:1px solid #e5e7eb;border-radius:16px;background:#ffffff;padding:14px;margin:0 0 12px"><div style="font-weight:800;font-size:14px;color:#0f172a;margin:0 0 10px">' . h($title) . '</div>' . $body . '</div>';
}

function kv_table(array $rows): string {
  $html = '<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse">';
  foreach ($rows as $label => $value) {
    $html .= '<tr><td style="width:160px;vertical-align:top;padding:8px 10px;border-top:1px solid #eef2f7;color:#64748b;font-size:13px">' . h((string)$label) . '</td><td style="vertical-align:top;padding:8px 10px;border-top:1px solid #eef2f7;color:#0f172a;font-size:13px;font-weight:600">' . h((string)$value) . '</td></tr>';
  }
  $html .= '</table>';
  return $html;
}

function list_block(array $lines): string {
  if (!$lines) return '<div style="color:#0f172a;font-size:13px">-</div>';
  $html = '<ul style="margin:0;padding-left:18px;color:#0f172a;font-size:13px;line-height:1.5">';
  foreach ($lines as $x) $html .= '<li>' . h((string)$x) . '</li>';
  $html .= '</ul>';
  return $html;
}

/* CONFIG */
$ALLOWED_ORIGINS = ['https://anfragebox.de', 'https://www.anfragebox.de'];
$RATE_LIMIT_DIR = __DIR__ . '/ratelimit';
$RATE_MAX = 10;
$RATE_WINDOW = 600;

$SUPABASE_URL = SUPABASE_URL;
$LEADS_TABLE  = 'leads';

$OWNER_EMAIL = OWNER_EMAIL;
$FROM_EMAIL  = MAIL_FROM;

$SMTP_HOST   = SMTP_HOST;
$SMTP_PORT   = SMTP_PORT;
$SMTP_USER   = SMTP_USER;
$SMTP_SECURE = SMTP_SECURE;

$ATTACH_PAYLOAD_JSON_TO_ADMIN = true;

/* START */
check_origin($ALLOWED_ORIGINS);
rate_limit($RATE_LIMIT_DIR, $RATE_MAX, $RATE_WINDOW);

$SERVICE_ROLE = SUPABASE_SERVICE_ROLE_KEY;
$SMTP_PASS    = SMTP_PASS;

if (trim($SUPABASE_URL) === '' || trim($LEADS_TABLE) === '') {
  log_error('CONFIG missing: SUPABASE_URL or LEADS_TABLE');
  respond(500, ['ok' => false, 'error' => 'Server not configured']);
}
if ($SERVICE_ROLE === '' || strlen($SERVICE_ROLE) < 40) {
  log_error('SUPABASE_SERVICE_ROLE missing');
  respond(500, ['ok' => false, 'error' => 'Server not configured']);
}

$data = post_json();
$payloadFull = [];
if (isset($data['payload']) && is_array($data['payload'])) $payloadFull = $data['payload'];
else $payloadFull = $data;

$p = is_array($payloadFull) ? $payloadFull : [];

$hp = (string)($data['hp'] ?? ($p['hp'] ?? ''));
if (trim($hp) !== '') respond(200, ['ok' => true, 'ignored' => true]);

$customer_name  = trim((string)($data['customer_name'] ?? ($p['customer_name'] ?? '')));
$customer_email = trim((string)($data['customer_email'] ?? ($p['customer_email'] ?? '')));
$customer_phone = trim((string)($data['customer_phone'] ?? ($p['customer_phone'] ?? '')));

if ($customer_name === '' || $customer_phone === '' || $customer_email === '') {
  respond(400, ['ok' => false, 'error' => 'Missing required fields']);
}
if (!filter_var($customer_email, FILTER_VALIDATE_EMAIL)) {
  respond(400, ['ok' => false, 'error' => 'Invalid email']);
}

$incomingSlug = trim((string)($data['slug'] ?? ($p['slug'] ?? '')));
if ($incomingSlug === '') {
  respond(400, ['ok' => false, 'error' => 'slug missing']);
}

/* ── Resolve company via demo_instances ── */
$demoPath =
  '/rest/v1/demo_instances'
  . '?select=' . rawurlencode('company_id,public_slug,status,expires_at')
  . '&public_slug=eq.' . rawurlencode($incomingSlug)
  . '&status=eq.active'
  . '&limit=1';

$demoRow = supabase_select_one($SUPABASE_URL, $demoPath, $SERVICE_ROLE);

if (!$demoRow) {
  respond(404, ['ok' => false, 'error' => 'Demo not found']);
}

$resolvedCompanyId = trim((string)($demoRow['company_id'] ?? ''));
if ($resolvedCompanyId === '') {
  respond(500, ['ok' => false, 'error' => 'Demo has no company_id']);
}

$expiresAt = trim((string)($demoRow['expires_at'] ?? ''));
if ($expiresAt !== '' && strtotime($expiresAt) !== false && strtotime($expiresAt) < time()) {
  respond(410, ['ok' => false, 'error' => 'Demo expired']);
}

$incomingCompanyId = trim((string)($data['company_id'] ?? ($p['company_id'] ?? '')));
if ($incomingCompanyId !== '' && $incomingCompanyId !== $resolvedCompanyId) {
  respond(400, ['ok' => false, 'error' => 'company_id does not match slug']);
}

$companyId = $resolvedCompanyId;
$sourceValue = 'Website';

log_error('LEAD MAP | slug=' . $incomingSlug . ' | incoming_company_id=' . $incomingCompanyId . ' | resolved_company_id=' . $resolvedCompanyId);

/* ── Load company branding from company_settings ── */
$brandSettings = supabase_select_one($SUPABASE_URL,
  '/rest/v1/company_settings?select=company_name,phone,email,street,cityline,country,logo_url'
  . '&company_id=eq.' . rawurlencode($companyId) . '&limit=1',
  $SERVICE_ROLE
);
$BRAND_NAME    = trim((string)($brandSettings['company_name'] ?? 'Umzugsunternehmen'));
$BRAND_PHONE   = trim((string)($brandSettings['phone'] ?? ''));
$BRAND_EMAIL   = trim((string)($brandSettings['email'] ?? ''));
$BRAND_LOGO    = trim((string)($brandSettings['logo_url'] ?? ''));
$BRAND_WEBSITE = 'https://anfragebox.de';

/* ── Build insert row ── */
$insertRow = [
  'company_id' => $companyId,
  'source' => $sourceValue,
  'status' => 'Neu',

  'customer_name'  => $customer_name,
  'customer_phone' => $customer_phone,
  'customer_email' => $customer_email,
  'phone'          => $customer_phone,
  'email'          => $customer_email,

  'move_date' => !empty($p['move_date']) ? $p['move_date'] : date('Y-m-d', strtotime('+7 days')),
  'alt_date'  => $p['move_date_alt'] ?? null,
  'date_mode' => !empty($p['move_date_type']) ? (string)$p['move_date_type'] : 'fixed',

  'notes'        => $p['notes'] ?? null,
  'summary_text' => $p['summary_text'] ?? null,

  'from_street'  => $p['pickup_address']['street'] ?? null,
  'from_no'      => $p['pickup_address']['number'] ?? null,
  'from_zip'     => $p['pickup_address']['zip'] ?? null,
  'from_city'    => $p['pickup_address']['city'] ?? null,
  'from_country' => $p['pickup_address']['country'] ?? null,

  'to_street'    => $p['dropoff_address']['street'] ?? null,
  'to_no'        => $p['dropoff_address']['number'] ?? null,
  'to_zip'       => $p['dropoff_address']['zip'] ?? null,
  'to_city'      => $p['dropoff_address']['city'] ?? null,
  'to_country'   => $p['dropoff_address']['country'] ?? null,

  'pickup_address'       => $p['pickup_address'] ?? null,
  'pickup_details'       => $p['pickup_details'] ?? null,
  'dropoff_address'      => $p['dropoff_address'] ?? null,
  'dropoff_details'      => $p['dropoff_details'] ?? null,
  'selected_rooms'       => $p['selected_rooms'] ?? null,
  'room_items'           => $p['room_items'] ?? null,
  'room_item_quantities' => $p['room_item_quantities'] ?? null,
  'box_request'          => $p['box_request'] ?? null,
  'assembly_request'     => $p['assembly_request'] ?? null,

  'payload' => $payloadFull ?: null
];

log_error('INSERT_ROW=' . json_encode($insertRow, JSON_UNESCAPED_UNICODE));

$row = supabase_insert($SUPABASE_URL, $LEADS_TABLE, $SERVICE_ROLE, $insertRow);

$leadId = (string)($row['id'] ?? '');
$createdAt = (string)($row['created_at'] ?? '');

/* ── Generate portal token ── */
$portalUrl = '';
if ($leadId !== '' && $customer_email !== '') {
  $portalToken = generate_portal_token();
  $ptUrl = rtrim($SUPABASE_URL, '/') . '/rest/v1/portal_tokens?select=id';
  $ptCh = curl_init($ptUrl);
  curl_setopt($ptCh, CURLOPT_POST, true);
  curl_setopt($ptCh, CURLOPT_RETURNTRANSFER, true);
  curl_setopt($ptCh, CURLOPT_HTTPHEADER, [
    'Content-Type: application/json',
    'apikey: ' . $SERVICE_ROLE,
    'Authorization: Bearer ' . $SERVICE_ROLE,
    'Prefer: return=representation'
  ]);
  curl_setopt($ptCh, CURLOPT_POSTFIELDS, json_encode([
    'company_id' => $companyId,
    'lead_id' => $leadId,
    'token' => $portalToken,
  ], JSON_UNESCAPED_UNICODE));
  curl_setopt($ptCh, CURLOPT_TIMEOUT, 10);
  $ptRes = curl_exec($ptCh);
  $ptHttp = (int)curl_getinfo($ptCh, CURLINFO_HTTP_CODE);
  curl_close($ptCh);

  if ($ptHttp >= 200 && $ptHttp < 300) {
    $portalUrl = 'https://anfragebox.de/portal/' . $portalToken;
    log_error('Portal token created for lead ' . $leadId . ': ' . $portalToken);
  } else {
    log_error('Portal token insert failed for lead ' . $leadId . ' HTTP ' . $ptHttp . ': ' . substr((string)$ptRes, 0, 500));
  }
}

/* ── Prepare email content ── */
$pickupAddr = is_array($p['pickup_address'] ?? null) ? $p['pickup_address'] : [];
$dropoffAddr = is_array($p['dropoff_address'] ?? null) ? $p['dropoff_address'] : [];
$pickupDet = is_array($p['pickup_details'] ?? null) ? $p['pickup_details'] : [];
$dropoffDet = is_array($p['dropoff_details'] ?? null) ? $p['dropoff_details'] : [];

$boxReq = is_array($p['box_request'] ?? null) ? $p['box_request'] : [];
$boxItems = is_array($boxReq['items'] ?? null) ? $boxReq['items'] : [];

$assemblyReq = is_array($p['assembly_request'] ?? null) ? $p['assembly_request'] : [];
$selectedRooms = is_array($p['selected_rooms'] ?? null) ? $p['selected_rooms'] : [];
$roomItems = is_array($p['room_items'] ?? null) ? $p['room_items'] : [];
$roomQty = is_array($p['room_item_quantities'] ?? null) ? $p['room_item_quantities'] : [];

$moveType = s($p['move_date_type'] ?? '-');
$moveDate = s($p['move_date'] ?? '-');
$moveAlt  = s($p['move_date_alt'] ?? '-');
$winFrom  = s($p['move_window_from'] ?? '-');
$winTo    = s($p['move_window_to'] ?? '-');
$timeWin  = s($p['move_time_window'] ?? '-');
$dateNote = s($p['desired_date_note'] ?? '-');
$summaryText = s($p['summary_text'] ?? '-');

$notesText = trim((string)($p['notes'] ?? ''));
if ($notesText === '') $notesText = '-';

/* EMAIL CONTENT — Admin Notification (Professional) */

$fromAddr = fmt_addr($pickupAddr);
$toAddr = fmt_addr($dropoffAddr);
$fromShort = trim(($pickupAddr['zip'] ?? '') . ' ' . ($pickupAddr['city'] ?? ''));
$toShort = trim(($dropoffAddr['zip'] ?? '') . ' ' . ($dropoffAddr['city'] ?? ''));
$routeShort = ($fromShort && $toShort) ? $fromShort . ' → ' . $toShort : '';

$moveDateFmt = '-';
if (!empty($p['move_date']) && strtotime($p['move_date']) !== false) {
  $moveDateFmt = date('d.m.Y', strtotime($p['move_date']));
}

$createdFmt = '-';
if ($createdAt && strtotime($createdAt) !== false) {
  $createdFmt = date('d.m.Y, H:i', strtotime($createdAt)) . ' Uhr';
}

/* Build furniture summary */
$furnitureSummary = [];
if (is_array($roomItems) && $roomItems) {
  foreach ($roomItems as $room => $items) {
    if (!is_array($items) || !$items) continue;
    $parts = [];
    foreach ($items as $it) {
      $q = '1';
      if (isset($roomQty[$room]) && is_array($roomQty[$room]) && array_key_exists((string)$it, $roomQty[$room])) {
        $q = (string)$roomQty[$room][(string)$it];
      }
      $parts[] = h((string)$it) . ' ×' . h($q);
    }
    $furnitureSummary[] = '<div style="margin-bottom:10px;"><div style="font-size:12px;font-weight:800;color:#047857;text-transform:uppercase;letter-spacing:0.03em;margin-bottom:4px;">' . h((string)$room) . '</div><div style="font-size:13px;color:#374151;line-height:1.6;">' . implode(', ', $parts) . '</div></div>';
  }
}

/* Build assembly summary */
$assemblySummary = [];
if (is_array($assemblyReq) && $assemblyReq) {
  foreach ($assemblyReq as $room => $map) {
    if (!is_array($map) || !$map) continue;
    foreach ($map as $item => $val) {
      $assemblySummary[] = h((string)$item) . ': ' . h((string)$val);
    }
  }
}

/* Build box summary */
$boxSummary = '';
if (is_array($boxItems) && $boxItems) {
  $bParts = [];
  foreach ($boxItems as $k => $v) {
    $vv = (int)$v;
    if ($vv > 0) $bParts[] = h((string)$k) . ': ' . $vv;
  }
  if ($bParts) $boxSummary = implode(', ', $bParts);
}

$adminUrl = 'https://anfragebox.de/anfrage/admin.html#leads';

$adminHtml =
  '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>' .
  '<body style="margin:0;padding:0;background:#f0f2f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica Neue,Arial,sans-serif;">' .
  '<div style="max-width:600px;margin:0 auto;padding:32px 16px;">' .

    /* Header */
    '<div style="background:#0f172a;border-radius:16px 16px 0 0;padding:24px 32px;">' .
      '<div style="display:flex;justify-content:space-between;align-items:center;">' .
        '<div style="font-size:18px;font-weight:800;color:#ffffff;">' . h($BRAND_NAME) . '</div>' .
        '<div style="background:#047857;color:#fff;font-size:11px;font-weight:700;padding:5px 12px;border-radius:6px;">NEUE ANFRAGE</div>' .
      '</div>' .
    '</div>' .

    /* Hero */
    '<div style="background:#ffffff;padding:28px 32px;border-left:1px solid #e5e7eb;border-right:1px solid #e5e7eb;">' .

      '<div style="display:flex;align-items:center;gap:14px;margin-bottom:20px;">' .
        '<div style="width:48px;height:48px;background:#ecfdf5;border-radius:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">' .
          '<div style="font-size:22px;">📋</div>' .
        '</div>' .
        '<div>' .
          '<div style="font-size:20px;font-weight:800;color:#0f172a;">' . h($customer_name ?: 'Neuer Lead') . '</div>' .
          '<div style="font-size:13px;color:#6b7280;margin-top:2px;">' . h($createdFmt) . '</div>' .
        '</div>' .
      '</div>' .

      /* Quick info bar */
      '<div style="display:flex;gap:8px;margin-bottom:24px;flex-wrap:wrap;">' .
        ($customer_phone !== '' ? '<a href="tel:' . h($customer_phone) . '" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;font-size:13px;font-weight:600;color:#0369a1;text-decoration:none;">📞 ' . h($customer_phone) . '</a>' : '') .
        ($customer_email !== '' ? '<a href="mailto:' . h($customer_email) . '" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;font-size:13px;font-weight:600;color:#0369a1;text-decoration:none;">✉️ ' . h($customer_email) . '</a>' : '') .
      '</div>' .

      /* Route card */
      '<div style="background:#f8f9fb;border:1px solid #e5e7eb;border-radius:12px;padding:20px;margin-bottom:16px;">' .
        '<div style="font-size:11px;font-weight:800;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:12px;">ROUTE</div>' .
        '<div style="display:flex;gap:12px;align-items:stretch;">' .
          '<div style="flex:1;background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:12px;">' .
            '<div style="font-size:10px;font-weight:700;color:#047857;text-transform:uppercase;margin-bottom:4px;">VON</div>' .
            '<div style="font-size:13px;font-weight:700;color:#0f172a;line-height:1.4;">' . h($fromAddr) . '</div>' .
            (($pickupDet['floor'] ?? '-') !== '-' ? '<div style="font-size:12px;color:#6b7280;margin-top:4px;">Stock: ' . h(s($pickupDet['floor'])) . ' · Aufzug: ' . h(yn($pickupDet['elevator'] ?? null)) . '</div>' : '') .
          '</div>' .
          '<div style="display:flex;align-items:center;font-size:18px;color:#9ca3af;flex-shrink:0;">→</div>' .
          '<div style="flex:1;background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:12px;">' .
            '<div style="font-size:10px;font-weight:700;color:#dc2626;text-transform:uppercase;margin-bottom:4px;">NACH</div>' .
            '<div style="font-size:13px;font-weight:700;color:#0f172a;line-height:1.4;">' . h($toAddr) . '</div>' .
            (($dropoffDet['floor'] ?? '-') !== '-' ? '<div style="font-size:12px;color:#6b7280;margin-top:4px;">Stock: ' . h(s($dropoffDet['floor'])) . ' · Aufzug: ' . h(yn($dropoffDet['elevator'] ?? null)) . '</div>' : '') .
          '</div>' .
        '</div>' .
      '</div>' .

      /* Details grid */
      '<div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap;">' .
        '<div style="flex:1;min-width:120px;background:#f8f9fb;border:1px solid #e5e7eb;border-radius:10px;padding:14px;text-align:center;">' .
          '<div style="font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;">TERMIN</div>' .
          '<div style="font-size:16px;font-weight:800;color:#0f172a;margin-top:4px;">' . h($moveDateFmt) . '</div>' .
        '</div>' .
        '<div style="flex:1;min-width:120px;background:#f8f9fb;border:1px solid #e5e7eb;border-radius:10px;padding:14px;text-align:center;">' .
          '<div style="font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;">RÄUME</div>' .
          '<div style="font-size:16px;font-weight:800;color:#0f172a;margin-top:4px;">' . (count($selectedRooms) ?: '-') . '</div>' .
        '</div>' .
        ($boxSummary !== '' ?
        '<div style="flex:1;min-width:120px;background:#f8f9fb;border:1px solid #e5e7eb;border-radius:10px;padding:14px;text-align:center;">' .
          '<div style="font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;">KARTONS</div>' .
          '<div style="font-size:13px;font-weight:700;color:#0f172a;margin-top:4px;">' . $boxSummary . '</div>' .
        '</div>' : '') .
      '</div>' .

      /* Furniture */
      (count($furnitureSummary) > 0 ?
        '<div style="background:#f8f9fb;border:1px solid #e5e7eb;border-radius:12px;padding:20px;margin-bottom:16px;">' .
          '<div style="font-size:11px;font-weight:800;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:12px;">MÖBEL PRO RAUM</div>' .
          implode('', $furnitureSummary) .
        '</div>' : '') .

      /* Assembly */
      (count($assemblySummary) > 0 ?
        '<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:16px;margin-bottom:16px;">' .
          '<div style="font-size:11px;font-weight:800;color:#92400e;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">MONTAGE / DEMONTAGE</div>' .
          '<div style="font-size:13px;color:#78716c;line-height:1.6;">' . implode('<br>', $assemblySummary) . '</div>' .
        '</div>' : '') .

      /* Notes */
      ($notesText !== '-' && $notesText !== '' ?
        '<div style="background:#f8f9fb;border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin-bottom:16px;">' .
          '<div style="font-size:11px;font-weight:800;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">HINWEISE VOM KUNDEN</div>' .
          '<div style="font-size:13px;color:#374151;line-height:1.6;white-space:pre-wrap;">' . h($notesText) . '</div>' .
        '</div>' : '') .

      /* Portal link */
      ($portalUrl !== '' ?
        '<div style="background:#ecfdf5;border:1px solid #bbf7d0;border-radius:12px;padding:16px;margin-bottom:16px;">' .
          '<div style="font-size:11px;font-weight:800;color:#047857;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">KUNDENPORTAL</div>' .
          '<div style="font-size:13px;color:#065f46;">Kunde wurde gebeten, Fotos hochzuladen.</div>' .
          '<a href="' . h($portalUrl) . '" style="display:inline-block;margin-top:8px;font-size:13px;font-weight:700;color:#047857;text-decoration:none;">' . h($portalUrl) . '</a>' .
        '</div>' : '') .

      /* CTA */
      '<a href="' . h($adminUrl) . '" style="display:block;text-align:center;padding:16px 28px;background:#047857;color:#ffffff;border-radius:12px;font-size:15px;font-weight:700;text-decoration:none;margin-top:8px;">' .
        'Im Admin-Panel öffnen →' .
      '</a>' .

    '</div>' .

    /* Footer */
    '<div style="background:#f8f9fb;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 16px 16px;padding:20px 32px;text-align:center;">' .
      '<div style="font-size:12px;color:#9ca3af;">AnfrageBox · ' . h($BRAND_NAME) . ' · Quelle: ' . h($sourceValue) . '</div>' .
    '</div>' .

  '</div>' .
  '</body></html>';

$adminText = "NEUE ANFRAGE\n\nKunde: {$customer_name}\nTelefon: {$customer_phone}\nE-Mail: {$customer_email}\n\n"
  . "Route: {$fromAddr} → {$toAddr}\nTermin: {$moveDateFmt}\n"
  . ($portalUrl !== '' ? "Portal: {$portalUrl}\n" : '')
  . "\nAdmin: {$adminUrl}\n";

log_error('FINAL INSERT company_id=' . ($insertRow['company_id'] ?? 'NULL'));

/* EMAILS */
$emailAdminSent = false;
$emailClientSent = false;

$pmDir = __DIR__ . '/phpmailer';
$pmOk = is_readable($pmDir . '/PHPMailer.php') && is_readable($pmDir . '/SMTP.php') && is_readable($pmDir . '/Exception.php');

if ($pmOk && $SMTP_PASS !== '') {
  require_once $pmDir . '/Exception.php';
  require_once $pmDir . '/PHPMailer.php';
  require_once $pmDir . '/SMTP.php';

  $makeMailer = function () use ($SMTP_HOST, $SMTP_PORT, $SMTP_USER, $SMTP_PASS, $SMTP_SECURE) {
    $mail = new \PHPMailer\PHPMailer\PHPMailer(true);
    $mail->isSMTP();
    $mail->Host = $SMTP_HOST;
    $mail->SMTPAuth = true;
    $mail->Username = $SMTP_USER;
    $mail->Password = $SMTP_PASS;
    $mail->Port = (int)$SMTP_PORT;
    $mail->CharSet = 'UTF-8';
    if ($SMTP_SECURE === 'ssl') $mail->SMTPSecure = \PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_SMTPS;
    if ($SMTP_SECURE === 'tls') $mail->SMTPSecure = \PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_STARTTLS;
    return $mail;
  };

  /* Admin email */
  try {
    $m = $makeMailer();
    $m->setFrom($FROM_EMAIL, $BRAND_NAME);
    $m->addAddress($OWNER_EMAIL);
    $m->addReplyTo($customer_email, $customer_name);
    $m->isHTML(true);
    $m->Subject = 'Neue Anfrage: ' . ($customer_name ?: 'Unbekannt') . ($routeShort !== '' ? ' (' . $routeShort . ')' : '');
    $m->Body = $adminHtml;
    $m->AltBody = $adminText;
    $m->send();
    $emailAdminSent = true;
  } catch (\Throwable $e) {
    log_error('PHPMailer admin failed lead ' . ($leadId ?: '-') . ': ' . $e->getMessage());
  }

  /* Client email (with portal link) — Professional Design */
  $clientSubject = $BRAND_NAME . ' — Ihre Umzugsanfrage ist eingegangen';
  $clientName = trim($customer_name) !== '' ? $customer_name : '';

  $fromCity = trim((string)($pickupAddr['city'] ?? ''));
  $toCity = trim((string)($dropoffAddr['city'] ?? ''));
  $routeDisplay = '';
  if ($fromCity !== '' && $toCity !== '') $routeDisplay = $fromCity . ' → ' . $toCity;

  $moveDateDisplay = '';
  $rawMoveDate = $insertRow['move_date'] ?? '';
  if ($rawMoveDate !== '' && strtotime($rawMoveDate) !== false) {
    $moveDateDisplay = date('d.m.Y', strtotime($rawMoveDate));
  }

  $logoBlock = '';
  if ($BRAND_LOGO !== '') {
    $logoBlock = '<img src="' . h($BRAND_LOGO) . '" alt="' . h($BRAND_NAME) . '" style="max-height:44px;max-width:160px;object-fit:contain;" />';
  }

  $portalBlock = '';
  if ($portalUrl !== '') {
    $portalBlock =
      '<div style="background:#ffffff;border:2px solid #047857;border-radius:16px;padding:28px;margin:24px 0;text-align:center;">' .
        '<div style="width:56px;height:56px;background:#ecfdf5;border-radius:14px;margin:0 auto 16px;display:flex;align-items:center;justify-content:center;">' .
          '<div style="font-size:28px;line-height:1;">📸</div>' .
        '</div>' .
        '<div style="font-size:18px;font-weight:800;color:#0f172a;margin:0 0 8px;">Fotos hochladen</div>' .
        '<div style="font-size:14px;color:#4b5563;line-height:1.6;margin:0 0 20px;max-width:380px;margin-left:auto;margin-right:auto;">' .
          'Fotografieren Sie jeden Raum und größere Möbelstücke. So können wir Ihnen einen genauen Preis berechnen.' .
        '</div>' .
        '<a href="' . h($portalUrl) . '" style="display:inline-block;padding:16px 40px;background:#047857;color:#ffffff;border-radius:12px;font-size:16px;font-weight:700;text-decoration:none;letter-spacing:-0.01em;">' .
          'Fotos jetzt hochladen →' .
        '</a>' .
        '<div style="margin-top:14px;font-size:12px;color:#9ca3af;">Sicher. Keine Registrierung nötig.</div>' .
      '</div>';
  }

  $detailRows = '';
  if ($routeDisplay !== '') {
    $detailRows .= '<tr><td style="padding:10px 14px;font-size:13px;color:#6b7280;border-bottom:1px solid #f3f4f6;width:120px;">Route</td><td style="padding:10px 14px;font-size:13px;font-weight:700;color:#0f172a;border-bottom:1px solid #f3f4f6;">' . h($routeDisplay) . '</td></tr>';
  }
  if ($moveDateDisplay !== '') {
    $detailRows .= '<tr><td style="padding:10px 14px;font-size:13px;color:#6b7280;border-bottom:1px solid #f3f4f6;">Wunschtermin</td><td style="padding:10px 14px;font-size:13px;font-weight:700;color:#0f172a;border-bottom:1px solid #f3f4f6;">' . h($moveDateDisplay) . '</td></tr>';
  }
  $detailRows .= '<tr><td style="padding:10px 14px;font-size:13px;color:#6b7280;">Status</td><td style="padding:10px 14px;font-size:13px;font-weight:700;color:#047857;">Anfrage eingegangen</td></tr>';

  $clientHtml =
    '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>' .
    '<body style="margin:0;padding:0;background:#f0f2f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica Neue,Arial,sans-serif;">' .
    '<div style="max-width:560px;margin:0 auto;padding:32px 16px;">' .

      /* Header */
      '<div style="background:#047857;border-radius:16px 16px 0 0;padding:28px 32px;text-align:center;">' .
        ($logoBlock !== '' ? '<div style="margin-bottom:12px;">' . $logoBlock . '</div>' : '') .
        '<div style="font-size:20px;font-weight:800;color:#ffffff;letter-spacing:-0.02em;">' . h($BRAND_NAME) . '</div>' .
        ($BRAND_PHONE !== '' || $BRAND_EMAIL !== '' ?
          '<div style="font-size:12px;color:rgba(255,255,255,0.7);margin-top:6px;">' .
            ($BRAND_PHONE !== '' ? h($BRAND_PHONE) : '') .
            ($BRAND_PHONE !== '' && $BRAND_EMAIL !== '' ? ' · ' : '') .
            ($BRAND_EMAIL !== '' ? h($BRAND_EMAIL) : '') .
          '</div>' : '') .
      '</div>' .

      /* Body */
      '<div style="background:#ffffff;padding:32px;border-left:1px solid #e5e7eb;border-right:1px solid #e5e7eb;">' .

        '<div style="font-size:22px;font-weight:800;color:#0f172a;letter-spacing:-0.02em;margin:0 0 6px;">Anfrage eingegangen ✓</div>' .
        '<div style="font-size:14px;color:#6b7280;margin:0 0 24px;">Wir melden uns innerhalb von 24 Stunden.</div>' .

        '<p style="font-size:15px;color:#374151;line-height:1.7;margin:0 0 20px;">' .
          'Guten Tag' . ($clientName !== '' ? ' ' . h($clientName) : '') . ',<br><br>' .
          'vielen Dank für Ihre Umzugsanfrage. Wir haben alle Angaben erhalten und werden Ihnen in Kürze ein individuelles Angebot erstellen.' .
        '</p>' .

        /* Detail card */
        ($detailRows !== '' ?
          '<div style="background:#f8f9fb;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;margin:0 0 24px;">' .
            '<table style="width:100%;border-collapse:collapse;">' . $detailRows . '</table>' .
          '</div>' : '') .

        /* Photo upload CTA */
        $portalBlock .

        /* Next steps */
        '<div style="margin:24px 0 0;">' .
          '<div style="font-size:14px;font-weight:700;color:#0f172a;margin:0 0 12px;">So geht es weiter:</div>' .
          '<div style="display:flex;gap:12px;margin-bottom:10px;align-items:flex-start;">' .
            '<div style="width:24px;height:24px;background:#ecfdf5;border-radius:8px;text-align:center;font-size:12px;font-weight:800;color:#047857;line-height:24px;flex-shrink:0;">1</div>' .
            '<div style="font-size:13px;color:#4b5563;line-height:1.5;">Laden Sie Fotos Ihrer Räume und Möbel hoch</div>' .
          '</div>' .
          '<div style="display:flex;gap:12px;margin-bottom:10px;align-items:flex-start;">' .
            '<div style="width:24px;height:24px;background:#ecfdf5;border-radius:8px;text-align:center;font-size:12px;font-weight:800;color:#047857;line-height:24px;flex-shrink:0;">2</div>' .
            '<div style="font-size:13px;color:#4b5563;line-height:1.5;">Wir erstellen Ihr persönliches Angebot</div>' .
          '</div>' .
          '<div style="display:flex;gap:12px;align-items:flex-start;">' .
            '<div style="width:24px;height:24px;background:#ecfdf5;border-radius:8px;text-align:center;font-size:12px;font-weight:800;color:#047857;line-height:24px;flex-shrink:0;">3</div>' .
            '<div style="font-size:13px;color:#4b5563;line-height:1.5;">Sie erhalten das Angebot per E-Mail und können es online annehmen</div>' .
          '</div>' .
        '</div>' .

      '</div>' .

      /* Footer */
      '<div style="background:#f8f9fb;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 16px 16px;padding:24px 32px;text-align:center;">' .
        '<div style="font-size:13px;font-weight:700;color:#374151;">' . h($BRAND_NAME) . '</div>' .
        '<div style="font-size:12px;color:#9ca3af;margin-top:4px;line-height:1.5;">' .
          ($BRAND_PHONE !== '' ? h($BRAND_PHONE) . '<br>' : '') .
          ($BRAND_EMAIL !== '' ? '<a href="mailto:' . h($BRAND_EMAIL) . '" style="color:#047857;text-decoration:none;">' . h($BRAND_EMAIL) . '</a>' : '') .
        '</div>' .
      '</div>' .

    '</div>' .
    '</body></html>';

  $clientText =
    "Guten Tag {$clientName},\n\nvielen Dank für Ihre Umzugsanfrage bei {$BRAND_NAME}.\n" .
    ($routeDisplay !== '' ? "Route: {$routeDisplay}\n" : '') .
    ($moveDateDisplay !== '' ? "Wunschtermin: {$moveDateDisplay}\n" : '') .
    "\nWir haben alle Angaben erhalten und melden uns innerhalb von 24 Stunden.\n" .
    ($portalUrl !== '' ? "\nBitte laden Sie Fotos hoch: {$portalUrl}\n" : '') .
    "\nSo geht es weiter:\n1. Laden Sie Fotos Ihrer Räume und Möbel hoch\n2. Wir erstellen Ihr persönliches Angebot\n3. Sie erhalten das Angebot per E-Mail\n" .
    "\nMit freundlichen Grüßen\n{$BRAND_NAME}\n" .
    ($BRAND_PHONE !== '' ? "Tel.: {$BRAND_PHONE}\n" : '') .
    ($BRAND_EMAIL !== '' ? "E-Mail: {$BRAND_EMAIL}\n" : '');

  try {
    $m2 = $makeMailer();
    $m2->setFrom($FROM_EMAIL, $BRAND_NAME);
    $m2->addAddress($customer_email, $customer_name);
    $m2->addReplyTo($BRAND_EMAIL, $BRAND_NAME);
    $m2->isHTML(true);
    $m2->Subject = $clientSubject;
    $m2->Body = $clientHtml;
    $m2->AltBody = $clientText;
    $m2->send();
    $emailClientSent = true;
  } catch (\Throwable $e) {
    log_error('PHPMailer client failed lead ' . ($leadId ?: '-') . ': ' . $e->getMessage());
  }
} else {
  if (!$pmOk) log_error('PHPMailer missing in ' . $pmDir);
  if ($SMTP_PASS === '') log_error('SMTP_PASS missing. Emails disabled.');
}

/* ── Trigger lead notification (async, non-blocking) ── */
$notifyPayload = json_encode([
  'lead_id'        => $leadId,
  'company_id'     => $companyId,
  'customer_name'  => $customer_name,
  'customer_phone' => $customer_phone,
  'customer_email' => $customer_email,
  'from_city'      => trim((string)($pickupAddr['city'] ?? '')),
  'to_city'        => trim((string)($dropoffAddr['city'] ?? '')),
  'move_date'      => $insertRow['move_date'] ?? '',
  'created_at'     => $createdAt,
], JSON_UNESCAPED_UNICODE);

$notifyUrl = 'http://127.0.0.1' . '/anfrage/api/notify-new-lead.php';
$notifyCh = curl_init($notifyUrl);
curl_setopt_array($notifyCh, [
  CURLOPT_POST => true,
  CURLOPT_POSTFIELDS => $notifyPayload,
  CURLOPT_HTTPHEADER => [
    'Content-Type: application/json',
    'X-Internal-Token: ' . CRON_TOKEN_FOLLOWUP,
  ],
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_TIMEOUT => 5,
  CURLOPT_CONNECTTIMEOUT => 2,
]);
$notifyRes = curl_exec($notifyCh);
$notifyOk = curl_getinfo($notifyCh, CURLINFO_HTTP_CODE) === 200;
curl_close($notifyCh);
if (!$notifyOk) {
  log_error('NOTIFY FAILED for lead ' . $leadId . ': ' . substr((string)$notifyRes, 0, 500));
}

respond(200, [
  'ok' => true,
  'id' => $leadId ?: null,
  'created_at' => $createdAt ?: null,
  'company_id' => $companyId,
  'source' => $sourceValue,
  'email_admin_sent' => $emailAdminSent,
  'email_client_sent' => $emailClientSent,
  'portal_url' => $portalUrl ?: null
]);