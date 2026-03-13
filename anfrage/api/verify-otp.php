<?php
/**
 * verify-otp.php — AnfrageBox Demo OTP Verification
 * POST JSON: { "email": "user@example.com", "code": "123456" }
 *
 * OK (nou):      { "ok": true, "token": "<uuid>", "existing": false }
 * OK (existent): { "ok": true, "token": "<uuid>", "existing": true,
 *                  "company_name": "...", "expires_at": "...",
 *                  "public_url": "...", "admin_magic_link": "..." }
 * ERR:           { "ok": false, "error": "..." }
 */
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

require_once __DIR__ . '/config.php';
cors_headers();

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST')    { http_response_code(405); echo json_encode(['ok'=>false,'error'=>'Method not allowed']); exit; }

/* ── CONFIG ──────────────────────────────────────────────────────── */
$SB_URL  = SUPABASE_URL;
$SB_KEY  = SUPABASE_SERVICE_ROLE_KEY;
$ADMIN_REDIRECT  = 'https://anfragebox.de/anfrage/admin.html';
$PUBLIC_FORM_BASE = 'https://anfragebox.de/anfrage/index.html';

/* ── INPUT ───────────────────────────────────────────────────────── */
$body  = json_decode(file_get_contents('php://input') ?: '', true);
$email = trim((string)($body['email'] ?? ''));
$code  = preg_replace('/\D/', '', (string)($body['code'] ?? ''));

if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    http_response_code(400);
    echo json_encode(['ok'=>false,'error'=>'Ungültige E-Mail-Adresse.']);
    exit;
}
if (strlen($code) !== 6) {
    http_response_code(400);
    echo json_encode(['ok'=>false,'error'=>'Ungültiges Code-Format.']);
    exit;
}

/* ── OTP SUCHEN ──────────────────────────────────────────────────── */
$now  = date('c');
$path = '/rest/v1/demo_otp'
    . '?email=eq.'       . urlencode($email)
    . '&code=eq.'        . urlencode($code)
    . '&used=eq.false'
    . '&expires_at=gte.' . urlencode($now)
    . '&order=created_at.desc'
    . '&limit=1'
    . '&select=id';

$ch = curl_init(rtrim($SB_URL,'/') . $path);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 10,
    CURLOPT_HTTPHEADER => ['apikey: '.$SB_KEY, 'Authorization: Bearer '.$SB_KEY],
]);
$rawBody = curl_exec($ch);
$http    = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($http !== 200) {
    error_log('[verify-otp] Supabase lookup HTTP=' . $http);
    http_response_code(500);
    echo json_encode(['ok'=>false,'error'=>'Interner Fehler. Bitte erneut versuchen.']);
    exit;
}

$rows = json_decode((string)$rawBody, true);
if (!is_array($rows) || count($rows) === 0) {
    http_response_code(400);
    echo json_encode(['ok'=>false,'error'=>'Ungültiger oder abgelaufener Code. Bitte erneut versuchen.']);
    exit;
}

$otpId = (string)($rows[0]['id'] ?? '');

/* ── OTP MARKIEREN ALS VERWENDET ────────────────────────────────── */
$pch = curl_init(rtrim($SB_URL,'/') . '/rest/v1/demo_otp?id=eq.' . urlencode($otpId));
curl_setopt_array($pch, [
    CURLOPT_RETURNTRANSFER => true, CURLOPT_CUSTOMREQUEST => 'PATCH', CURLOPT_TIMEOUT => 10,
    CURLOPT_HTTPHEADER => ['Content-Type: application/json','apikey: '.$SB_KEY,'Authorization: Bearer '.$SB_KEY,'Prefer: return=minimal'],
    CURLOPT_POSTFIELDS => json_encode(['used' => true]),
]);
curl_exec($pch);
curl_close($pch);

/* ── CLEANUP OTP VECHI ───────────────────────────────────────────── */
$dch = curl_init(rtrim($SB_URL,'/') . '/rest/v1/demo_otp?email=eq.' . urlencode($email) . '&used=eq.true');
curl_setopt_array($dch, [
    CURLOPT_RETURNTRANSFER => true, CURLOPT_CUSTOMREQUEST => 'DELETE', CURLOPT_TIMEOUT => 8,
    CURLOPT_HTTPHEADER => ['apikey: '.$SB_KEY,'Authorization: Bearer '.$SB_KEY],
]);
curl_exec($dch);
curl_close($dch);

/* ── VERIFICĂ DACĂ EMAILUL ARE DEMO ACTIV ────────────────────────── */
$demoPath = '/rest/v1/company_settings'
    . '?email=eq.'      . urlencode($email)
    . '&is_demo=eq.true'
    . '&demo_expires_at=gte.' . urlencode($now)
    . '&order=demo_expires_at.desc'
    . '&limit=1'
    . '&select=company_id,company_name,slug,demo_expires_at';

$dch2 = curl_init(rtrim($SB_URL,'/') . $demoPath);
curl_setopt_array($dch2, [
    CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 10,
    CURLOPT_HTTPHEADER => ['apikey: '.$SB_KEY,'Authorization: Bearer '.$SB_KEY],
]);
$demoBody = curl_exec($dch2);
$demoHttp = (int)curl_getinfo($dch2, CURLINFO_HTTP_CODE);
curl_close($dch2);

$existingDemo = null;
if ($demoHttp === 200) {
    $demoRows = json_decode((string)$demoBody, true);
    if (is_array($demoRows) && count($demoRows) > 0) {
        $existingDemo = $demoRows[0];
    }
}

/* ── DACĂ EXISTĂ DEMO ACTIV: generează magic link nou ───────────── */
if ($existingDemo !== null) {
    $companyId  = (string)($existingDemo['company_id'] ?? '');
    $companyName = (string)($existingDemo['company_name'] ?? '');
    $slug        = (string)($existingDemo['slug'] ?? '');
    $expiresAt   = (string)($existingDemo['demo_expires_at'] ?? '');

    // Generează magic link proaspăt
    $magicRes = sb_post_raw($SB_URL, $SB_KEY, '/auth/v1/admin/generate_link', [
        'type'        => 'magiclink',
        'email'       => $email,
        'redirect_to' => $ADMIN_REDIRECT,
    ]);

    $magicJson = json_decode($magicRes['body'], true);
    $magicLink = $magicJson['properties']['action_link']
              ?? $magicJson['action_link']
              ?? null;

    $publicUrl = $PUBLIC_FORM_BASE . '?slug=' . rawurlencode($slug);

    echo json_encode([
        'ok'               => true,
        'token'            => $otpId,
        'existing'         => true,
        'company_id'       => $companyId,
        'company_name'     => $companyName,
        'expires_at'       => $expiresAt,
        'public_url'       => $publicUrl,
        'admin_magic_link' => $magicLink,
    ]);
    exit;
}

/* ── EMAIL NOU: returnează doar token ───────────────────────────── */
echo json_encode(['ok' => true, 'token' => $otpId, 'existing' => false]);
exit;

/* ── HELPER ─────────────────────────────────────────────────────── */
function sb_post_raw(string $base, string $key, string $path, array $data): array {
    $ch = curl_init(rtrim($base,'/') . $path);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_POST => true, CURLOPT_TIMEOUT => 12,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json','apikey: '.$key,'Authorization: Bearer '.$key],
        CURLOPT_POSTFIELDS => json_encode($data),
    ]);
    $b = curl_exec($ch); $s = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
    return ['http' => $s, 'body' => (string)$b];
}