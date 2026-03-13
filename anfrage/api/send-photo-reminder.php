<?php
declare(strict_types=1);

/**
 * send-photo-reminder.php — Professional Photo Upload Reminder
 *
 * POST body (JSON, authenticated via Bearer token):
 *   lead_id, company_id, recipient_email, recipient_name, portal_url
 */

header('Content-Type: application/json; charset=utf-8');

require_once __DIR__ . '/config.php';

function respond(int $code, array $data): void {
  http_response_code($code);
  echo json_encode($data, JSON_UNESCAPED_UNICODE);
  exit;
}


function h($s): string {
  if ($s === null) return '';
  return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8');
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
  $raw = file_get_contents('php://input');
  $data = json_decode($raw, true);
  return is_array($data) ? $data : [];
}

function verify_supabase_token(string $baseUrl, string $anonKey, string $token): ?array {
  if ($token === '') return null;
  $ch = curl_init(rtrim($baseUrl, '/') . '/auth/v1/user');
  curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
  curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'apikey: ' . $anonKey,
    'Authorization: Bearer ' . $token,
  ]);
  curl_setopt($ch, CURLOPT_TIMEOUT, 10);
  $res = curl_exec($ch);
  $http = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);
  if ($http !== 200 || $res === false) return null;
  $user = json_decode((string)$res, true);
  return (is_array($user) && !empty($user['id'])) ? $user : null;
}

function sb_get(string $base, string $path, string $key): ?array {
  $ch = curl_init(rtrim($base, '/') . $path);
  curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
  curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'apikey: ' . $key, 'Authorization: Bearer ' . $key, 'Accept: application/json'
  ]);
  curl_setopt($ch, CURLOPT_TIMEOUT, 10);
  $res = curl_exec($ch);
  $http = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);
  if ($http < 200 || $http >= 300 || $res === false) return null;
  $out = json_decode((string)$res, true);
  return (is_array($out) && isset($out[0])) ? $out[0] : null;
}

/* ── Config ── */
$ALLOWED_ORIGINS = ['https://anfragebox.de', 'https://www.anfragebox.de'];
$SUPABASE_URL = SUPABASE_URL;
$ANON_KEY = SUPABASE_ANON_KEY;
$SMTP_HOST = SMTP_HOST;
$SMTP_PORT = SMTP_PORT;
$SMTP_USER = SMTP_USER;

check_origin($ALLOWED_ORIGINS);

$SERVICE_ROLE = SUPABASE_SERVICE_ROLE_KEY;
$SMTP_PASS = SMTP_PASS;

if ($SERVICE_ROLE === '' || $SMTP_PASS === '') {
  respond(500, ['ok' => false, 'error' => 'Server not configured']);
}

$data = post_json();

/* ── Auth ── */
$authHeader = (string)($_SERVER['HTTP_AUTHORIZATION'] ?? '');
$token = '';
if (stripos($authHeader, 'Bearer ') === 0) $token = trim(substr($authHeader, 7));
if ($token === '') respond(401, ['ok' => false, 'error' => 'Not authenticated']);

$user = verify_supabase_token($SUPABASE_URL, $ANON_KEY, $token);
if (!$user) respond(401, ['ok' => false, 'error' => 'Invalid token']);

/* ── Input ── */
$leadId         = trim((string)($data['lead_id'] ?? ''));
$companyId      = trim((string)($data['company_id'] ?? ''));
$recipientEmail = trim((string)($data['recipient_email'] ?? ''));
$recipientName  = trim((string)($data['recipient_name'] ?? ''));
$portalUrl      = trim((string)($data['portal_url'] ?? ''));

if ($leadId === '' || $companyId === '' || $recipientEmail === '') {
  respond(400, ['ok' => false, 'error' => 'Missing required fields']);
}

/* ── Verify user belongs to company ── */
$memberPath = '/rest/v1/company_users?select=id&user_id=eq.' . rawurlencode($user['id'])
  . '&company_id=eq.' . rawurlencode($companyId) . '&is_active=eq.true&limit=1';
$member = sb_get($SUPABASE_URL, $memberPath, $SERVICE_ROLE);
if (!$member) respond(403, ['ok' => false, 'error' => 'No access']);

/* ── Load company branding ── */
$settingsPath = '/rest/v1/company_settings?select=company_name,phone,email,logo_url'
  . '&company_id=eq.' . rawurlencode($companyId) . '&limit=1';
$settings = sb_get($SUPABASE_URL, $settingsPath, $SERVICE_ROLE);

$brandName  = trim((string)($settings['company_name'] ?? 'Umzugsunternehmen'));
$brandPhone = trim((string)($settings['phone'] ?? ''));
$brandEmail = trim((string)($settings['email'] ?? ''));
$brandLogo  = trim((string)($settings['logo_url'] ?? ''));

/* ── Load lead info for route/date ── */
$leadPath = '/rest/v1/leads?select=pickup_address,dropoff_address,move_date,payload'
  . '&id=eq.' . rawurlencode($leadId) . '&company_id=eq.' . rawurlencode($companyId) . '&limit=1';
$lead = sb_get($SUPABASE_URL, $leadPath, $SERVICE_ROLE);

$fromCity = '';
$toCity = '';
$moveDate = '';
if ($lead) {
  $pa = $lead['pickup_address'] ?? [];
  $da = $lead['dropoff_address'] ?? [];
  if (is_string($pa)) $pa = json_decode($pa, true) ?: [];
  if (is_string($da)) $da = json_decode($da, true) ?: [];
  $fromCity = trim((string)($pa['city'] ?? $pa['ort'] ?? ''));
  $toCity = trim((string)($da['city'] ?? $da['ort'] ?? ''));
  $rawDate = $lead['move_date'] ?? '';
  if ($rawDate !== '' && strtotime($rawDate) !== false) {
    $moveDate = date('d.m.Y', strtotime($rawDate));
  }
}
$routeDisplay = ($fromCity !== '' && $toCity !== '') ? $fromCity . ' → ' . $toCity : '';

/* ── Build professional email ── */
$subject = $brandName . ' — Bitte laden Sie Fotos hoch';

$logoBlock = '';
if ($brandLogo !== '') {
  $logoBlock = '<img src="' . h($brandLogo) . '" alt="' . h($brandName) . '" style="max-height:44px;max-width:160px;object-fit:contain;" />';
}

$detailRows = '';
if ($routeDisplay !== '') {
  $detailRows .= '<tr><td style="padding:10px 14px;font-size:13px;color:#6b7280;border-bottom:1px solid #f3f4f6;width:120px;">Route</td><td style="padding:10px 14px;font-size:13px;font-weight:700;color:#0f172a;border-bottom:1px solid #f3f4f6;">' . h($routeDisplay) . '</td></tr>';
}
if ($moveDate !== '') {
  $detailRows .= '<tr><td style="padding:10px 14px;font-size:13px;color:#6b7280;border-bottom:1px solid #f3f4f6;">Wunschtermin</td><td style="padding:10px 14px;font-size:13px;font-weight:700;color:#0f172a;border-bottom:1px solid #f3f4f6;">' . h($moveDate) . '</td></tr>';
}
$detailRows .= '<tr><td style="padding:10px 14px;font-size:13px;color:#6b7280;">Status</td><td style="padding:10px 14px;font-size:13px;font-weight:700;color:#b45309;">Warten auf Fotos</td></tr>';

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

$emailHtml =
  '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>' .
  '<body style="margin:0;padding:0;background:#f0f2f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica Neue,Arial,sans-serif;">' .
  '<div style="max-width:560px;margin:0 auto;padding:32px 16px;">' .

    '<div style="background:#047857;border-radius:16px 16px 0 0;padding:28px 32px;text-align:center;">' .
      ($logoBlock !== '' ? '<div style="margin-bottom:12px;">' . $logoBlock . '</div>' : '') .
      '<div style="font-size:20px;font-weight:800;color:#ffffff;letter-spacing:-0.02em;">' . h($brandName) . '</div>' .
      ($brandPhone !== '' || $brandEmail !== '' ?
        '<div style="font-size:12px;color:rgba(255,255,255,0.7);margin-top:6px;">' .
          ($brandPhone !== '' ? h($brandPhone) : '') .
          ($brandPhone !== '' && $brandEmail !== '' ? ' · ' : '') .
          ($brandEmail !== '' ? h($brandEmail) : '') .
        '</div>' : '') .
    '</div>' .

    '<div style="background:#ffffff;padding:32px;border-left:1px solid #e5e7eb;border-right:1px solid #e5e7eb;">' .

      '<div style="font-size:20px;font-weight:800;color:#0f172a;letter-spacing:-0.02em;margin:0 0 6px;">Wir brauchen noch Fotos</div>' .
      '<div style="font-size:14px;color:#6b7280;margin:0 0 24px;">Damit wir Ihr Angebot fertigstellen können.</div>' .

      '<p style="font-size:15px;color:#374151;line-height:1.7;margin:0 0 20px;">' .
        'Guten Tag' . ($recipientName !== '' ? ' ' . h($recipientName) : '') . ',<br><br>' .
        'wir haben Ihre Umzugsanfrage erhalten, aber es fehlen noch Fotos Ihrer Räume und Möbel. Diese benötigen wir, um Ihnen einen genauen Preis berechnen zu können.' .
      '</p>' .

      ($detailRows !== '' ?
        '<div style="background:#f8f9fb;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;margin:0 0 24px;">' .
          '<table style="width:100%;border-collapse:collapse;">' . $detailRows . '</table>' .
        '</div>' : '') .

      $portalBlock .

      '<div style="margin:24px 0 0;background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:16px;">' .
        '<div style="font-size:13px;font-weight:700;color:#92400e;margin:0 0 6px;">Was soll ich fotografieren?</div>' .
        '<div style="font-size:13px;color:#78716c;line-height:1.6;">' .
          'Jeden Raum einmal komplett. Große Möbelstücke einzeln (Schrank, Sofa, Bett, Waschmaschine). Besonders sperrige oder schwere Gegenstände.' .
        '</div>' .
      '</div>' .

    '</div>' .

    '<div style="background:#f8f9fb;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 16px 16px;padding:24px 32px;text-align:center;">' .
      '<div style="font-size:13px;font-weight:700;color:#374151;">' . h($brandName) . '</div>' .
      '<div style="font-size:12px;color:#9ca3af;margin-top:4px;line-height:1.5;">' .
        ($brandPhone !== '' ? h($brandPhone) . '<br>' : '') .
        ($brandEmail !== '' ? '<a href="mailto:' . h($brandEmail) . '" style="color:#047857;text-decoration:none;">' . h($brandEmail) . '</a>' : '') .
      '</div>' .
    '</div>' .

  '</div>' .
  '</body></html>';

$emailText = "Guten Tag " . ($recipientName ?: 'Kunde') . ",\n\n"
  . "wir haben Ihre Umzugsanfrage erhalten, aber es fehlen noch Fotos.\n"
  . ($routeDisplay !== '' ? "Route: {$routeDisplay}\n" : '')
  . ($moveDate !== '' ? "Wunschtermin: {$moveDate}\n" : '')
  . ($portalUrl !== '' ? "\nFotos hochladen: {$portalUrl}\n" : '')
  . "\nMit freundlichen Grüßen\n{$brandName}\n"
  . ($brandPhone !== '' ? "Tel.: {$brandPhone}\n" : '')
  . ($brandEmail !== '' ? "E-Mail: {$brandEmail}\n" : '');

/* ── Send ── */
$pmDir = __DIR__ . '/phpmailer';
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
  $mail->send();

} catch (\Throwable $e) {
  log_error('Photo reminder send failed: ' . $e->getMessage());
  respond(500, ['ok' => false, 'error' => 'Email send failed']);
}

log_error('PHOTO REMINDER SENT | lead=' . $leadId . ' | to=' . $recipientEmail);
respond(200, ['ok' => true, 'sent_at' => date('c')]);