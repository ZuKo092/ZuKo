<?php
declare(strict_types=1);

/**
 * send-welcome-email.php — Send welcome email after signup
 * POST JSON: { company_name, email, slug }
 * Auth: Bearer token (Supabase JWT)
 */

header('Content-Type: application/json; charset=utf-8');

require_once __DIR__ . '/config.php';
cors_headers();

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
  http_response_code(405);
  echo json_encode(['ok' => false, 'error' => 'Method not allowed']);
  exit;
}

$raw = file_get_contents('php://input');
$data = json_decode($raw ?: '', true);
if (!is_array($data)) {
  http_response_code(400);
  echo json_encode(['ok' => false, 'error' => 'Invalid JSON']);
  exit;
}

$companyName = trim((string)($data['company_name'] ?? ''));
$email       = trim((string)($data['email'] ?? ''));
$slug        = trim((string)($data['slug'] ?? ''));

if ($email === '' || $companyName === '' || $slug === '') {
  http_response_code(400);
  echo json_encode(['ok' => false, 'error' => 'Missing fields']);
  exit;
}

// Verify JWT token
$authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
if (strpos($authHeader, 'Bearer ') !== 0) {
  http_response_code(401);
  echo json_encode(['ok' => false, 'error' => 'Unauthorized']);
  exit;
}

$SITE_URL   = 'https://anfragebox.de';
$publicUrl  = $SITE_URL . '/anfrage/index.html?slug=' . rawurlencode($slug);
$LOGIN_PAGE = $SITE_URL . '/anfrage/login/login.html';
$kontoUrl   = $SITE_URL . '/konto.html';
$embedCode  = '<iframe src="' . $publicUrl . '" width="100%" height="900" frameborder="0" style="border:none;border-radius:12px;"></iframe>';

$pmDir = __DIR__ . '/phpmailer';
$pmOk = is_readable($pmDir.'/PHPMailer.php') && is_readable($pmDir.'/SMTP.php') && is_readable($pmDir.'/Exception.php');

if (!$pmOk || SMTP_PASS === '') {
  http_response_code(503);
  echo json_encode(['ok' => false, 'sent' => false, 'error' => 'SMTP not configured']);
  exit;
}

require_once $pmDir . '/Exception.php';
require_once $pmDir . '/PHPMailer.php';
require_once $pmDir . '/SMTP.php';

$welcomeHtml = '<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;background:#f9f9f7;padding:40px 20px;margin:0;">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e5e5e0;">
  <div style="background:#0D7C5F;padding:32px 36px;">
    <div style="font-size:22px;font-weight:800;color:#fff;">AnfrageBox</div>
    <div style="font-size:13px;color:rgba(255,255,255,.6);margin-top:4px;">Willkommen an Bord</div>
  </div>
  <div style="padding:36px;">
    <h1 style="font-size:24px;font-weight:800;color:#1a1a18;margin:0 0 16px;">Ihr Konto ist bereit!</h1>
    <p style="font-size:15px;color:#4a4a42;line-height:1.7;margin:0 0 24px;">
      Hallo ' . htmlspecialchars($companyName) . ',<br><br>
      Ihr 14-t&auml;giger kostenloser Testzugang ist aktiv. Hier sind Ihre n&auml;chsten Schritte:
    </p>
    <div style="display:flex;gap:14px;margin-bottom:20px;">
      <div style="width:32px;height:32px;background:#E8F5EF;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;color:#0D7C5F;flex-shrink:0;">1</div>
      <div>
        <div style="font-size:15px;font-weight:700;color:#1a1a18;margin-bottom:4px;">Formular auf Ihrer Website einbetten</div>
        <div style="font-size:13px;color:#7a776e;line-height:1.5;">Kopieren Sie den Code unten und f&uuml;gen Sie ihn in Ihre Website ein.</div>
      </div>
    </div>
    <div style="display:flex;gap:14px;margin-bottom:20px;">
      <div style="width:32px;height:32px;background:#E8F5EF;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;color:#0D7C5F;flex-shrink:0;">2</div>
      <div>
        <div style="font-size:15px;font-weight:700;color:#1a1a18;margin-bottom:4px;">Erste Anfrage testen</div>
        <div style="font-size:13px;color:#7a776e;line-height:1.5;">&Ouml;ffnen Sie Ihr Formular und stellen Sie eine Testanfrage.</div>
      </div>
    </div>
    <div style="display:flex;gap:14px;margin-bottom:28px;">
      <div style="width:32px;height:32px;background:#E8F5EF;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;color:#0D7C5F;flex-shrink:0;">3</div>
      <div>
        <div style="font-size:15px;font-weight:700;color:#1a1a18;margin-bottom:4px;">Angebot erstellen und senden</div>
        <div style="font-size:13px;color:#7a776e;line-height:1.5;">Im Admin-Panel klicken Sie auf einen Lead und erstellen ein Angebot.</div>
      </div>
    </div>
    <div style="background:#F8F6F2;border:1px solid #DDD8CF;border-radius:12px;padding:16px;margin-bottom:24px;">
      <div style="font-size:12px;font-weight:700;color:#7a776e;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">Ihr Embed-Code</div>
      <div style="font-family:monospace;font-size:11px;color:#4a4a42;word-break:break-all;line-height:1.5;">' . htmlspecialchars($embedCode) . '</div>
    </div>
    <div style="margin-bottom:24px;">
      <a href="' . htmlspecialchars($LOGIN_PAGE) . '" style="display:inline-block;padding:14px 28px;background:#0D7C5F;color:#fff;border-radius:10px;font-size:15px;font-weight:700;text-decoration:none;">Admin Panel &ouml;ffnen &rarr;</a>
    </div>
    <div style="border-top:1px solid #e5e5e0;padding-top:20px;margin-top:8px;">
      <div style="font-size:13px;color:#7a776e;line-height:1.6;">
        <strong>Wichtige Links:</strong><br>
        Formular: <a href="' . htmlspecialchars($publicUrl) . '" style="color:#0D7C5F;">' . htmlspecialchars($publicUrl) . '</a><br>
        Mein Konto: <a href="' . htmlspecialchars($kontoUrl) . '" style="color:#0D7C5F;">' . htmlspecialchars($kontoUrl) . '</a><br>
        Admin: <a href="' . htmlspecialchars($LOGIN_PAGE) . '" style="color:#0D7C5F;">' . htmlspecialchars($LOGIN_PAGE) . '</a>
      </div>
    </div>
    <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e5e0;font-size:12px;color:#b0ada5;line-height:1.5;">
      Testphase: 14 Tage kostenlos. Danach 99 &euro;/Monat. Jederzeit k&uuml;ndbar.<br>
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
  . "14 Tage kostenlos. Danach 99 EUR/Monat. Jederzeit kündbar.\n";

try {
  $mail = new \PHPMailer\PHPMailer\PHPMailer(true);
  $mail->isSMTP();
  $mail->Host       = SMTP_HOST;
  $mail->SMTPAuth   = true;
  $mail->Username   = SMTP_USER;
  $mail->Password   = SMTP_PASS;
  $mail->Port       = SMTP_PORT;
  $mail->CharSet    = 'UTF-8';
  $mail->SMTPSecure = \PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_SMTPS;

  $mail->setFrom(SMTP_USER, 'AnfrageBox');
  $mail->addAddress($email, $companyName);
  $mail->addReplyTo('info@anfragebox.de', 'AnfrageBox');

  $mail->isHTML(true);
  $mail->Subject = 'Willkommen bei AnfrageBox — So starten Sie in 3 Schritten';
  $mail->Body    = $welcomeHtml;
  $mail->AltBody = $welcomeText;
  $mail->send();

  echo json_encode(['ok' => true, 'sent' => true]);
} catch (\Throwable $e) {
  log_error('Welcome email failed: ' . $e->getMessage());
  http_response_code(500);
  echo json_encode(['ok' => false, 'sent' => false, 'error' => 'Mail send failed']);
}
