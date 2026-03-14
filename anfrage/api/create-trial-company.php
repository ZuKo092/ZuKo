<?php
declare(strict_types=1);

/**
 * create-trial-company.php — AnfrageBox Trial Account Creation
 * POST JSON: { company_name, email, phone, password, otp_token }
 *
 * Creates: auth user (with real password), company_settings, company_users, subscription (trialing 14 days)
 * Returns: { ok, company_id, slug, login_url }
 */

header('Content-Type: application/json; charset=utf-8');

require_once __DIR__ . '/config.php';
cors_headers();

function out(int $code, array $data): void {
  http_response_code($code);
  echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
  out(405, ['ok' => false, 'error' => 'Method not allowed']);
}

function slugify(string $s): string {
  $s = trim(mb_strtolower($s, 'UTF-8'));
  $map = ['ä' => 'ae', 'ö' => 'oe', 'ü' => 'ue', 'ß' => 'ss'];
  $s = strtr($s, $map);
  $s = preg_replace('/[^a-z0-9]+/u', '-', $s) ?? '';
  return trim($s, '-') !== '' ? trim($s, '-') : 'firma';
}

function rand_str(int $len = 8): string {
  return substr(bin2hex(random_bytes(16)), 0, $len);
}

function make_uuid(): string {
  return sprintf('%04x%04x-%04x-%04x-%04x-%04x%04x%04x',
    random_int(0, 0xffff), random_int(0, 0xffff), random_int(0, 0xffff),
    random_int(0, 0x0fff) | 0x4000, random_int(0, 0x3fff) | 0x8000,
    random_int(0, 0xffff), random_int(0, 0xffff), random_int(0, 0xffff));
}

function curl_json(string $url, string $method, array $headers, ?array $body = null): array {
  $ch = curl_init($url);
  curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
  curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
  curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
  curl_setopt($ch, CURLOPT_TIMEOUT, 20);
  if ($body !== null) {
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_UNICODE));
  }
  $res = curl_exec($ch);
  $http = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);
  return ['http' => $http, 'raw' => (string)$res, 'json' => json_decode((string)$res, true)];
}

function api_error_text(array $resp): string {
  $json = $resp['json'] ?? null;
  if (is_array($json)) {
    foreach (['msg','message','error_description','error','code'] as $k) {
      if (!empty($json[$k]) && is_string($json[$k])) return trim($json[$k]);
    }
  }
  return trim((string)($resp['raw'] ?? ''));
}

function rollback(string $baseUrl, string $serviceRole, string $companyId, string $userId): void {
  if ($companyId !== '') {
    foreach (['subscriptions','company_users','company_settings'] as $t) {
      curl_json($baseUrl . '/rest/v1/' . $t . '?company_id=eq.' . rawurlencode($companyId), 'DELETE',
        ['apikey: '.$serviceRole, 'Authorization: Bearer '.$serviceRole, 'Prefer: return=minimal']);
    }
  }
  if ($userId !== '') {
    curl_json($baseUrl . '/auth/v1/admin/users/' . rawurlencode($userId), 'DELETE',
      ['apikey: '.$serviceRole, 'Authorization: Bearer '.$serviceRole]);
  }
}

/* ── CONFIG ── */
$BASE_URL = rtrim(SUPABASE_URL, '/');
$SERVICE_ROLE = SUPABASE_SERVICE_ROLE_KEY;
$SITE_URL = 'https://anfragebox.de';
$LOGIN_PAGE = $SITE_URL . '/anfrage/login/login.html';

if ($BASE_URL === '' || $SERVICE_ROLE === '') {
  out(500, ['ok' => false, 'error' => 'Server not configured']);
}

/* ── INPUT ── */
$raw = file_get_contents('php://input');
$data = json_decode($raw ?: '', true);
if (!is_array($data)) out(400, ['ok' => false, 'error' => 'Invalid JSON']);

$companyName = trim((string)($data['company_name'] ?? ''));
$email       = trim((string)($data['email'] ?? ''));
$phone       = trim((string)($data['phone'] ?? ''));
$password    = (string)($data['password'] ?? '');
$otpToken    = trim((string)($data['otp_token'] ?? ''));

if ($companyName === '' || $email === '') {
  out(400, ['ok' => false, 'error' => 'Firmenname und E-Mail erforderlich.']);
}
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
  out(400, ['ok' => false, 'error' => 'Ungültige E-Mail-Adresse.']);
}
if (strlen($password) < 8) {
  out(400, ['ok' => false, 'error' => 'Passwort muss mindestens 8 Zeichen haben.']);
}
if ($otpToken === '') {
  out(400, ['ok' => false, 'error' => 'OTP-Token fehlt. Bitte zuerst E-Mail verifizieren.']);
}

/* ── VALIDATE OTP TOKEN ── */
$otpCheckPath = '/rest/v1/demo_otp'
  . '?id=eq.' . urlencode($otpToken)
  . '&email=eq.' . urlencode($email)
  . '&used=eq.true'
  . '&select=id'
  . '&limit=1';

$otpCheck = curl_json($BASE_URL . $otpCheckPath, 'GET', [
  'apikey: ' . $SERVICE_ROLE,
  'Authorization: Bearer ' . $SERVICE_ROLE,
]);

if ($otpCheck['http'] !== 200 || !is_array($otpCheck['json']) || count($otpCheck['json']) === 0) {
  out(403, ['ok' => false, 'error' => 'OTP-Token ungültig oder nicht verifiziert. Bitte E-Mail erneut verifizieren.']);
}

/* ── VALUES ── */
$companyId = make_uuid();
$slug = slugify($companyName) . '-' . rand_str(6);
$userId = '';
$trialEnd = gmdate('Y-m-d\TH:i:s\Z', time() + 14 * 24 * 60 * 60);

/* ── 1. CREATE AUTH USER ── */
$rAuth = curl_json($BASE_URL . '/auth/v1/admin/users', 'POST', [
  'Content-Type: application/json',
  'apikey: ' . $SERVICE_ROLE,
  'Authorization: Bearer ' . $SERVICE_ROLE,
], [
  'email' => $email,
  'password' => $password,
  'email_confirm' => true,
  'user_metadata' => [
    'company_name' => $companyName,
    'contact_name' => $companyName,
    'phone' => $phone,
  ],
]);

$authJson = $rAuth['json'];
if ($rAuth['http'] < 200 || $rAuth['http'] >= 300 || !is_array($authJson) || empty($authJson['id'])) {
  $msg = api_error_text($rAuth);
  if (stripos($msg, 'already') !== false || stripos($msg, 'exists') !== false || stripos($msg, 'duplicate') !== false) {
    out(409, ['ok' => false, 'error' => 'Diese E-Mail ist bereits registriert. Bitte melden Sie sich an.']);
  }
  out(500, ['ok' => false, 'error' => 'Konto erstellen fehlgeschlagen: ' . $msg]);
}
$userId = (string)$authJson['id'];

/* ── 2. CREATE COMPANY_SETTINGS ── */
$rComp = curl_json($BASE_URL . '/rest/v1/company_settings', 'POST', [
  'Content-Type: application/json',
  'apikey: ' . $SERVICE_ROLE,
  'Authorization: Bearer ' . $SERVICE_ROLE,
  'Prefer: return=representation',
], [
  'company_id' => $companyId,
  'slug' => $slug,
  'company_name' => $companyName,
  'phone' => $phone !== '' ? $phone : null,
  'email' => $email,
  'logo_url' => '/img/logo1-umzug.png',
  'is_demo' => false,
]);

if ($rComp['http'] < 200 || $rComp['http'] >= 300) {
  rollback($BASE_URL, $SERVICE_ROLE, $companyId, $userId);
  out(500, ['ok' => false, 'error' => 'Firma erstellen fehlgeschlagen.']);
}

/* ── 3. LINK COMPANY_USERS ── */
$rLink = curl_json($BASE_URL . '/rest/v1/company_users', 'POST', [
  'Content-Type: application/json',
  'apikey: ' . $SERVICE_ROLE,
  'Authorization: Bearer ' . $SERVICE_ROLE,
  'Prefer: return=representation',
], [
  'company_id' => $companyId,
  'user_id' => $userId,
  'role' => 'owner',
  'is_active' => true,
  'mfa_required' => false,
]);

if ($rLink['http'] < 200 || $rLink['http'] >= 300) {
  rollback($BASE_URL, $SERVICE_ROLE, $companyId, $userId);
  out(500, ['ok' => false, 'error' => 'Benutzer verknüpfen fehlgeschlagen.']);
}

/* ── 4. CREATE SUBSCRIPTION (TRIALING) ── */
curl_json($BASE_URL . '/rest/v1/subscriptions', 'POST', [
  'Content-Type: application/json',
  'apikey: ' . $SERVICE_ROLE,
  'Authorization: Bearer ' . $SERVICE_ROLE,
  'Prefer: return=minimal',
], [
  'company_id' => $companyId,
  'status' => 'trialing',
  'plan_name' => 'pro',
  'amount_eur' => 9900,
  'interval' => 'month',
  'trial_start' => gmdate('Y-m-d\TH:i:s\Z'),
  'trial_end' => $trialEnd,
]);

/**
 * ONBOARDING EMAIL SNIPPET
 * ========================
 * Replace the mail() call at the end of create-trail2-company.php with this code.
 * Find the section "5. SEND WELCOME EMAIL" and replace everything from there until the RESPONSE section.
 */

/* ── 5. SEND WELCOME EMAIL (PHPMailer) ── */
$publicUrl = $SITE_URL . '/anfrage/index.html?slug=' . rawurlencode($slug);
$kontoUrl  = $SITE_URL . '/konto.html';
$embedCode = '<iframe src="' . $publicUrl . '" width="100%" height="900" frameborder="0" style="border:none;border-radius:12px;"></iframe>';

$SMTP_HOST = SMTP_HOST;
$SMTP_PORT = SMTP_PORT;
$SMTP_USER = SMTP_USER;
$SMTP_PASS = SMTP_PASS;

$pmDir = __DIR__ . '/phpmailer';
$pmOk = is_readable($pmDir.'/PHPMailer.php') && is_readable($pmDir.'/SMTP.php') && is_readable($pmDir.'/Exception.php');

if ($pmOk && $SMTP_PASS !== '') {
  require_once $pmDir . '/Exception.php';
  require_once $pmDir . '/PHPMailer.php';
  require_once $pmDir . '/SMTP.php';

  $welcomeHtml = '<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;background:#f9f9f7;padding:40px 20px;margin:0;">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e5e5e0;">

  <!-- Header -->
  <div style="background:#0D7C5F;padding:32px 36px;">
    <div style="font-size:22px;font-weight:800;color:#fff;">AnfrageBox</div>
    <div style="font-size:13px;color:rgba(255,255,255,.6);margin-top:4px;">Willkommen an Bord</div>
  </div>

  <div style="padding:36px;">
    <h1 style="font-size:24px;font-weight:800;color:#1a1a18;margin:0 0 16px;">Ihr Konto ist bereit!</h1>
    <p style="font-size:15px;color:#4a4a42;line-height:1.7;margin:0 0 24px;">
      Hallo ' . htmlspecialchars($companyName) . ',<br><br>
      Ihr 14-tägiger kostenloser Testzugang ist aktiv. Hier sind Ihre nächsten Schritte:
    </p>

    <!-- Step 1 -->
    <div style="display:flex;gap:14px;margin-bottom:20px;">
      <div style="width:32px;height:32px;background:#E8F5EF;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;color:#0D7C5F;flex-shrink:0;">1</div>
      <div>
        <div style="font-size:15px;font-weight:700;color:#1a1a18;margin-bottom:4px;">Formular auf Ihrer Website einbetten</div>
        <div style="font-size:13px;color:#7a776e;line-height:1.5;">Kopieren Sie den Code unten und fügen Sie ihn in Ihre Website ein. Ihr Kunde sieht das Formular und kann direkt eine Anfrage stellen.</div>
      </div>
    </div>

    <!-- Step 2 -->
    <div style="display:flex;gap:14px;margin-bottom:20px;">
      <div style="width:32px;height:32px;background:#E8F5EF;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;color:#0D7C5F;flex-shrink:0;">2</div>
      <div>
        <div style="font-size:15px;font-weight:700;color:#1a1a18;margin-bottom:4px;">Erste Anfrage testen</div>
        <div style="font-size:13px;color:#7a776e;line-height:1.5;">Öffnen Sie Ihr Formular und stellen Sie eine Testanfrage. Sie sehen sofort, wie alles im Admin-Panel erscheint.</div>
      </div>
    </div>

    <!-- Step 3 -->
    <div style="display:flex;gap:14px;margin-bottom:28px;">
      <div style="width:32px;height:32px;background:#E8F5EF;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;color:#0D7C5F;flex-shrink:0;">3</div>
      <div>
        <div style="font-size:15px;font-weight:700;color:#1a1a18;margin-bottom:4px;">Angebot erstellen und senden</div>
        <div style="font-size:13px;color:#7a776e;line-height:1.5;">Im Admin-Panel klicken Sie auf einen Lead und erstellen ein Angebot. PDF wird automatisch generiert. Per E-Mail oder WhatsApp versenden.</div>
      </div>
    </div>

    <!-- Embed Code Box -->
    <div style="background:#F8F6F2;border:1px solid #DDD8CF;border-radius:12px;padding:16px;margin-bottom:24px;">
      <div style="font-size:12px;font-weight:700;color:#7a776e;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">Ihr Embed-Code</div>
      <div style="font-family:monospace;font-size:11px;color:#4a4a42;word-break:break-all;line-height:1.5;">' . htmlspecialchars($embedCode) . '</div>
    </div>

    <!-- CTA Buttons -->
    <div style="margin-bottom:24px;">
      <a href="' . htmlspecialchars($LOGIN_PAGE) . '" style="display:inline-block;padding:14px 28px;background:#0D7C5F;color:#fff;border-radius:10px;font-size:15px;font-weight:700;text-decoration:none;margin-right:8px;">Admin Panel öffnen →</a>
    </div>

    <!-- Links -->
    <div style="border-top:1px solid #e5e5e0;padding-top:20px;margin-top:8px;">
      <div style="font-size:13px;color:#7a776e;line-height:1.6;">
        <strong>Wichtige Links:</strong><br>
        Formular: <a href="' . htmlspecialchars($publicUrl) . '" style="color:#0D7C5F;">' . htmlspecialchars($publicUrl) . '</a><br>
        Mein Konto: <a href="' . htmlspecialchars($kontoUrl) . '" style="color:#0D7C5F;">' . htmlspecialchars($kontoUrl) . '</a><br>
        Admin: <a href="' . htmlspecialchars($LOGIN_PAGE) . '" style="color:#0D7C5F;">' . htmlspecialchars($LOGIN_PAGE) . '</a>
      </div>
    </div>

    <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e5e0;font-size:12px;color:#b0ada5;line-height:1.5;">
      Testphase: 14 Tage kostenlos. Danach 99 €/Monat. Jederzeit kündbar.<br>
      Fragen? Antworten Sie einfach auf diese E-Mail.
    </div>
  </div>
</div>
</body></html>';

  $welcomeText = "Willkommen bei AnfrageBox!\n\n"
    . "Ihr Konto für {$companyName} ist bereit.\n\n"
    . "Schritt 1: Formular einbetten\n{$embedCode}\n\n"
    . "Schritt 2: Testanfrage stellen\nÖffnen Sie: {$publicUrl}\n\n"
    . "Schritt 3: Angebot erstellen im Admin Panel\n{$LOGIN_PAGE}\n\n"
    . "Mein Konto: {$kontoUrl}\n\n"
    . "14 Tage kostenlos. Danach 99 EUR/Monat. Jederzeit kündbar.\n"
    . "Fragen? Antworten Sie auf diese E-Mail.\n";

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
    $mail->Subject = 'Willkommen bei AnfrageBox — So starten Sie in 3 Schritten';
    $mail->Body    = $welcomeHtml;
    $mail->AltBody = $welcomeText;
    $mail->send();
  } catch (\Throwable $e) {
    // Log but don't fail the signup
    log_error('Welcome email failed: ' . $e->getMessage());
  }
}

/* ── RESPONSE ── */
out(200, [
  'ok' => true,
  'company_id' => $companyId,
  'slug' => $slug,
  'public_url' => $publicUrl,
  'login_url' => $LOGIN_PAGE,
  'trial_end' => $trialEnd,
]);