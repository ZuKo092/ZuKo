<?php
/**
 * send-otp1.php — AnfrageBox OTP Send
 * POST JSON: { "email": "user@example.com" }
 *
 * OK:  { "ok": true }
 * ERR: { "ok": false, "error": "..." }
 */
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST')    { http_response_code(405); echo json_encode(['ok'=>false,'error'=>'Method not allowed']); exit; }

require_once __DIR__ . '/config.php';

/* ── CONFIG ── */
$SB_URL    = SUPABASE_URL;
$SB_KEY    = SUPABASE_SERVICE_ROLE_KEY;

$SMTP_HOST = SMTP_HOST;
$SMTP_PORT = SMTP_PORT;
$SMTP_USER = SMTP_USER;
$SMTP_PASS = SMTP_PASS;

$FROM_EMAIL = MAIL_FROM;
$FROM_NAME  = MAIL_FROM_NAME;
$OTP_EXPIRY_MINUTES = 10;

/* ── INPUT ── */
$body  = json_decode(file_get_contents('php://input') ?: '', true);
$email = trim((string)($body['email'] ?? ''));

if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    http_response_code(400);
    echo json_encode(['ok'=>false,'error'=>'Bitte gültige E-Mail-Adresse eingeben.']);
    exit;
}

/* ── RATE LIMIT: max 3 OTPs per email in last 10 min ── */
$tenMinAgo = date('c', time() - 600);
$countPath = '/rest/v1/demo_otp'
    . '?email=eq.' . urlencode($email)
    . '&created_at=gte.' . urlencode($tenMinAgo)
    . '&select=id';

$cch = curl_init(rtrim($SB_URL, '/') . $countPath);
curl_setopt_array($cch, [
    CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 10,
    CURLOPT_HTTPHEADER => ['apikey: ' . $SB_KEY, 'Authorization: Bearer ' . $SB_KEY],
]);
$countBody = curl_exec($cch);
$countHttp = (int)curl_getinfo($cch, CURLINFO_HTTP_CODE);
curl_close($cch);

if ($countHttp === 200) {
    $countRows = json_decode((string)$countBody, true);
    if (is_array($countRows) && count($countRows) >= 3) {
        http_response_code(429);
        echo json_encode(['ok'=>false,'error'=>'Zu viele Versuche. Bitte warten Sie 10 Minuten.']);
        exit;
    }
}

/* ── GENERATE CODE ── */
$code = str_pad((string)random_int(0, 999999), 6, '0', STR_PAD_LEFT);
$expiresAt = date('c', time() + ($OTP_EXPIRY_MINUTES * 60));

/* ── STORE IN SUPABASE ── */
$insertData = json_encode([
    'email'      => $email,
    'code'       => $code,
    'used'       => false,
    'expires_at' => $expiresAt,
]);

$ich = curl_init(rtrim($SB_URL, '/') . '/rest/v1/demo_otp');
curl_setopt_array($ich, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST           => true,
    CURLOPT_TIMEOUT        => 10,
    CURLOPT_HTTPHEADER     => [
        'Content-Type: application/json',
        'apikey: ' . $SB_KEY,
        'Authorization: Bearer ' . $SB_KEY,
        'Prefer: return=minimal',
    ],
    CURLOPT_POSTFIELDS => $insertData,
]);
$insertResult = curl_exec($ich);
$insertHttp   = (int)curl_getinfo($ich, CURLINFO_HTTP_CODE);
curl_close($ich);

if ($insertHttp < 200 || $insertHttp >= 300) {
    error_log('[send-otp] Supabase insert failed HTTP=' . $insertHttp . ' body=' . $insertResult);
    http_response_code(500);
    echo json_encode(['ok'=>false,'error'=>'Interner Fehler. Bitte erneut versuchen.']);
    exit;
}

/* ── SEND EMAIL VIA PHPMAILER ── */
$pmDir = __DIR__ . '/phpmailer';
$pmOk  = is_readable($pmDir . '/PHPMailer.php')
      && is_readable($pmDir . '/SMTP.php')
      && is_readable($pmDir . '/Exception.php');

if (!$pmOk) {
    error_log('[send-otp] PHPMailer missing in ' . $pmDir);
    http_response_code(500);
    echo json_encode(['ok'=>false,'error'=>'Email-Bibliothek fehlt.']);
    exit;
}

if ($SMTP_PASS === '') {
    error_log('[send-otp] SMTP_PASS missing in config');
    http_response_code(500);
    echo json_encode(['ok'=>false,'error'=>'Email-Konfiguration unvollständig.']);
    exit;
}

require_once $pmDir . '/Exception.php';
require_once $pmDir . '/PHPMailer.php';
require_once $pmDir . '/SMTP.php';

$subject = 'Ihr AnfrageBox Code: ' . $code;

$htmlBody = '<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;background:#f9f9f7;padding:40px 20px;">
<div style="max-width:420px;margin:0 auto;background:#fff;border-radius:12px;padding:36px;border:1px solid #e5e5e0;">
  <div style="font-size:20px;font-weight:700;color:#1a1a18;margin-bottom:8px;">AnfrageBox</div>
  <div style="font-size:14px;color:#7a776e;margin-bottom:28px;">Ihr Bestätigungscode</div>
  <div style="background:#f0faf5;border:2px solid #c2e5d5;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px;">
    <div style="font-size:36px;font-weight:800;letter-spacing:8px;color:#0d7c5f;font-family:monospace;">' . htmlspecialchars($code) . '</div>
  </div>
  <div style="font-size:13px;color:#7a776e;line-height:1.6;">
    Geben Sie diesen Code auf der AnfrageBox-Website ein.<br>
    Der Code ist <strong>' . $OTP_EXPIRY_MINUTES . ' Minuten</strong> gültig.
  </div>
  <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e5e0;font-size:11px;color:#b0ada5;">
    Falls Sie diesen Code nicht angefordert haben, ignorieren Sie diese E-Mail.
  </div>
</div></body></html>';

$textBody = "Ihr AnfrageBox Code: $code\n\nGeben Sie diesen Code auf der Website ein.\nGültig für $OTP_EXPIRY_MINUTES Minuten.\n\nFalls Sie diesen Code nicht angefordert haben, ignorieren Sie diese E-Mail.";

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

    $mail->setFrom($FROM_EMAIL, $FROM_NAME);
    $mail->addAddress($email);

    $mail->isHTML(true);
    $mail->Subject = $subject;
    $mail->Body    = $htmlBody;
    $mail->AltBody = $textBody;

    $mail->send();
} catch (\Exception $e) {
    error_log('[send-otp] PHPMailer error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['ok'=>false,'error'=>'E-Mail konnte nicht gesendet werden. Bitte erneut versuchen.']);
    exit;
}

/* ── OK ── */
echo json_encode(['ok' => true]);