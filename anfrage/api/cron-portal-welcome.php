<?php
declare(strict_types=1);

/**
 * Cron: Auto Portal Link + Welcome Email
 * 
 * Finds new leads without portal_tokens, creates token, sends email.
 * Run every 5 minutes via cron:
 *   wget -q -O /dev/null "https://anfragebox.de/anfrage/api/cron-portal-welcome.php?token=YOUR_TOKEN"
 */

require_once __DIR__ . '/config.php';

$SUPABASE_URL = SUPABASE_URL;
$SMTP_HOST    = SMTP_HOST;
$SMTP_PORT    = SMTP_PORT;
$SMTP_USER    = SMTP_USER;
$SMTP_SECURE  = SMTP_SECURE;
$SITE_URL     = 'https://anfragebox.de';

function clog(string $msg): void {
  $line = '[' . date('c') . '] ' . $msg;
  echo $line . "\n";
  @file_put_contents(__DIR__ . '/cron-portal-welcome.log', $line . "\n", FILE_APPEND);
}

function sb_get(string $base, string $path, string $key): ?array {
  $ch = curl_init(rtrim($base, '/') . $path);
  curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
  curl_setopt($ch, CURLOPT_HTTPHEADER, ['apikey: '.$key, 'Authorization: Bearer '.$key, 'Accept: application/json']);
  curl_setopt($ch, CURLOPT_TIMEOUT, 20);
  $res = curl_exec($ch); $http = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
  if ($res === false || $http < 200 || $http >= 300) return null;
  $out = json_decode((string)$res, true);
  return is_array($out) ? $out : null;
}

function sb_insert(string $base, string $table, string $key, array $row): ?array {
  $url = rtrim($base, '/') . '/rest/v1/' . rawurlencode($table) . '?select=id,token';
  $ch = curl_init($url);
  curl_setopt($ch, CURLOPT_POST, true);
  curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
  curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json', 'apikey: '.$key, 'Authorization: Bearer '.$key, 'Prefer: return=representation']);
  curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($row, JSON_UNESCAPED_UNICODE));
  curl_setopt($ch, CURLOPT_TIMEOUT, 15);
  $res = curl_exec($ch); $http = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
  if ($res === false || $http < 200 || $http >= 300) return null;
  $out = json_decode((string)$res, true);
  return (is_array($out) && isset($out[0])) ? $out[0] : (is_array($out) ? $out : null);
}

function generate_token(): string {
  $chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  $token = '';
  for ($i = 0; $i < 32; $i++) $token .= $chars[random_int(0, strlen($chars) - 1)];
  return $token;
}

function h($s): string { return htmlspecialchars((string)($s ?? ''), ENT_QUOTES, 'UTF-8'); }

/* ── Auth ── */
$CRON_TOKEN = CRON_TOKEN_PORTAL;

if (php_sapi_name() !== 'cli') {
  $provided = $_GET['token'] ?? $_SERVER['HTTP_X_CRON_TOKEN'] ?? '';
  if ($CRON_TOKEN === '' || $provided !== $CRON_TOKEN) { http_response_code(403); echo 'Forbidden'; exit; }
}

header('Content-Type: text/plain; charset=utf-8');
clog('=== cron-portal-welcome START ===');

/* ── Load secrets ── */
$SUPABASE_SERVICE_ROLE = SUPABASE_SERVICE_ROLE_KEY;
$SMTP_PASS = SMTP_PASS;

if (!$SUPABASE_SERVICE_ROLE || !$SMTP_PASS) { clog('ERROR: Missing secrets'); exit; }

/* ── Load PHPMailer ── */
$mailerDir = __DIR__ . '/phpmailer';
require_once $mailerDir . '/Exception.php';
require_once $mailerDir . '/PHPMailer.php';
require_once $mailerDir . '/SMTP.php';

use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception;

/* ── Find new leads without portal tokens (last 24h) ── */
$since = date('c', strtotime('-24 hours'));
$leadsUrl = '/rest/v1/leads?select=id,company_id,customer_email,customer_name,payload,created_at'
  . '&created_at=gte.' . urlencode($since)
  . '&order=created_at.desc&limit=50';

$leads = sb_get($SUPABASE_URL, $leadsUrl, $SUPABASE_SERVICE_ROLE);
if (!$leads) { clog('No new leads or error fetching.'); clog('=== DONE ==='); exit; }

clog('Found ' . count($leads) . ' leads in last 24h');

/* ── For each lead, check if portal token exists ── */
$sent = 0;
foreach ($leads as $lead) {
  $leadId = $lead['id'] ?? '';
  $companyId = $lead['company_id'] ?? '';
  if (!$leadId || !$companyId) continue;

  // Get customer email from lead or payload
  $payload = $lead['payload'] ?? [];
  if (is_string($payload)) { $payload = json_decode($payload, true) ?: []; }
  
  $email = $lead['customer_email'] ?? $payload['customer_email'] ?? ($payload['customer']['email'] ?? '');
  $name = $lead['customer_name'] ?? $payload['customer_name'] ?? ($payload['customer']['name'] ?? '');
  $email = trim((string)$email);
  $name = trim((string)$name);

  if (!$email || strpos($email, '@') === false) {
    clog("SKIP lead $leadId: no valid email");
    continue;
  }

  // Check if portal token already exists
  $existingUrl = '/rest/v1/portal_tokens?select=id&lead_id=eq.' . urlencode($leadId) . '&limit=1';
  $existing = sb_get($SUPABASE_URL, $existingUrl, $SUPABASE_SERVICE_ROLE);
  if ($existing && count($existing) > 0) {
    clog("SKIP lead $leadId: token exists");
    continue;
  }

  // Create portal token (90 day expiry)
  $token = generate_token();
  $expiresAt = date('c', strtotime('+90 days'));
  $inserted = sb_insert($SUPABASE_URL, 'portal_tokens', $SUPABASE_SERVICE_ROLE, [
    'company_id' => $companyId,
    'lead_id' => $leadId,
    'token' => $token,
    'expires_at' => $expiresAt,
  ]);

  if (!$inserted) {
    clog("ERROR: Could not create token for lead $leadId");
    continue;
  }

  clog("Created token for lead $leadId: $token");

  // Get company settings for brand name
  $settingsUrl = '/rest/v1/company_settings?select=company_name,email,phone,logo_url&company_id=eq.' . urlencode($companyId) . '&limit=1';
  $settings = sb_get($SUPABASE_URL, $settingsUrl, $SUPABASE_SERVICE_ROLE);
  $brandName = ($settings && isset($settings[0]['company_name'])) ? trim($settings[0]['company_name']) : 'Umzugsunternehmen';
  $companyEmail = ($settings && isset($settings[0]['email'])) ? trim($settings[0]['email']) : '';
  $companyPhone = ($settings && isset($settings[0]['phone'])) ? trim($settings[0]['phone']) : '';
  $companyLogo = ($settings && isset($settings[0]['logo_url'])) ? trim($settings[0]['logo_url']) : '';

  // Build portal URL
  $portalUrl = $SITE_URL . '/portal/' . $token;

  // Get route info from payload
  $leadFromCity = '';
  $leadToCity = '';
  $leadMoveDate = '';
  if (is_array($payload)) {
    $pAddr = $payload['pickup_address'] ?? [];
    $dAddr = $payload['dropoff_address'] ?? [];
    if (is_array($pAddr)) $leadFromCity = trim((string)($pAddr['city'] ?? ''));
    if (is_array($dAddr)) $leadToCity = trim((string)($dAddr['city'] ?? ''));
    $rawDate = $payload['move_date'] ?? '';
    if ($rawDate !== '' && strtotime($rawDate) !== false) {
      $leadMoveDate = date('d.m.Y', strtotime($rawDate));
    }
  }
  $routeDisplay = '';
  if ($leadFromCity !== '' && $leadToCity !== '') $routeDisplay = $leadFromCity . ' → ' . $leadToCity;

  // Send welcome email
  $subject = $brandName . ' — Bitte laden Sie Fotos hoch';

  $logoBlock = '';
  if ($companyLogo !== '') {
    $logoBlock = '<img src="' . h($companyLogo) . '" alt="' . h($brandName) . '" style="max-height:44px;max-width:160px;object-fit:contain;" />';
  }

  $detailRows = '';
  if ($routeDisplay !== '') {
    $detailRows .= '<tr><td style="padding:10px 14px;font-size:13px;color:#6b7280;border-bottom:1px solid #f3f4f6;width:120px;">Route</td><td style="padding:10px 14px;font-size:13px;font-weight:700;color:#0f172a;border-bottom:1px solid #f3f4f6;">' . h($routeDisplay) . '</td></tr>';
  }
  if ($leadMoveDate !== '') {
    $detailRows .= '<tr><td style="padding:10px 14px;font-size:13px;color:#6b7280;border-bottom:1px solid #f3f4f6;">Wunschtermin</td><td style="padding:10px 14px;font-size:13px;font-weight:700;color:#0f172a;border-bottom:1px solid #f3f4f6;">' . h($leadMoveDate) . '</td></tr>';
  }
  $detailRows .= '<tr><td style="padding:10px 14px;font-size:13px;color:#6b7280;">Status</td><td style="padding:10px 14px;font-size:13px;font-weight:700;color:#047857;">Warten auf Fotos</td></tr>';

  $body =
    '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>' .
    '<body style="margin:0;padding:0;background:#f0f2f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica Neue,Arial,sans-serif;">' .
    '<div style="max-width:560px;margin:0 auto;padding:32px 16px;">' .

      '<div style="background:#047857;border-radius:16px 16px 0 0;padding:28px 32px;text-align:center;">' .
        ($logoBlock !== '' ? '<div style="margin-bottom:12px;">' . $logoBlock . '</div>' : '') .
        '<div style="font-size:20px;font-weight:800;color:#ffffff;letter-spacing:-0.02em;">' . h($brandName) . '</div>' .
        ($companyPhone !== '' || $companyEmail !== '' ?
          '<div style="font-size:12px;color:rgba(255,255,255,0.7);margin-top:6px;">' .
            ($companyPhone !== '' ? h($companyPhone) : '') .
            ($companyPhone !== '' && $companyEmail !== '' ? ' · ' : '') .
            ($companyEmail !== '' ? h($companyEmail) : '') .
          '</div>' : '') .
      '</div>' .

      '<div style="background:#ffffff;padding:32px;border-left:1px solid #e5e7eb;border-right:1px solid #e5e7eb;">' .

        '<p style="font-size:15px;color:#374151;line-height:1.7;margin:0 0 20px;">' .
          'Guten Tag' . ($name !== '' ? ' ' . h($name) : '') . ',<br><br>' .
          'vielen Dank für Ihre Umzugsanfrage. Wir haben alle Angaben erhalten und werden Ihnen in Kürze ein individuelles Angebot erstellen.' .
        '</p>' .

        ($detailRows !== '' ?
          '<div style="background:#f8f9fb;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;margin:0 0 24px;">' .
            '<table style="width:100%;border-collapse:collapse;">' . $detailRows . '</table>' .
          '</div>' : '') .

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
        '</div>' .

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

      '<div style="background:#f8f9fb;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 16px 16px;padding:24px 32px;text-align:center;">' .
        '<div style="font-size:13px;font-weight:700;color:#374151;">' . h($brandName) . '</div>' .
        '<div style="font-size:12px;color:#9ca3af;margin-top:4px;line-height:1.5;">' .
          ($companyPhone !== '' ? h($companyPhone) . '<br>' : '') .
          ($companyEmail !== '' ? '<a href="mailto:' . h($companyEmail) . '" style="color:#047857;text-decoration:none;">' . h($companyEmail) . '</a>' : '') .
        '</div>' .
      '</div>' .

    '</div>' .
    '</body></html>';

  try {
    $mail = new PHPMailer(true);
    $mail->isSMTP();
    $mail->Host       = $SMTP_HOST;
    $mail->SMTPAuth   = true;
    $mail->Username   = $SMTP_USER;
    $mail->Password   = $SMTP_PASS;
    $mail->SMTPSecure = $SMTP_SECURE;
    $mail->Port       = $SMTP_PORT;
    $mail->CharSet    = 'UTF-8';

    $mail->setFrom($SMTP_USER, $brandName);
    if ($companyEmail) $mail->addReplyTo($companyEmail, $brandName);
    $mail->addAddress($email, $name);

    $mail->isHTML(true);
    $mail->Subject = $subject;
    $mail->Body    = $body;
    $mail->AltBody = strip_tags(str_replace(['<br>', '<br/>'], "\n", $body));

    $mail->send();
    $sent++;
    clog("SENT welcome email to $email for lead $leadId");

    // Log event
    sb_insert($SUPABASE_URL, 'portal_events', $SUPABASE_SERVICE_ROLE, [
      'portal_token_id' => $inserted['id'] ?? null,
      'lead_id' => $leadId,
      'event_type' => 'welcome_email_sent',
      'event_data' => json_encode(['to' => $email]),
    ]);

  } catch (Exception $e) {
    clog("ERROR sending to $email: " . $e->getMessage());
  }
}

clog("=== DONE. Sent $sent welcome emails. ===");