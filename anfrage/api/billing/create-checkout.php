<?php
declare(strict_types=1);

/**
 * Create Stripe Checkout Session
 * POST /anfrage/api/billing/create-checkout.php
 *
 * Body: { company_id, company_name, email }
 * Returns: { ok, checkout_url }
 */

header('Content-Type: application/json; charset=utf-8');

function respond(int $code, array $data): void {
  http_response_code($code);
  echo json_encode($data, JSON_UNESCAPED_UNICODE);
  exit;
}

function blog(string $msg): void {
  @file_put_contents(__DIR__ . '/billing.log', '[' . date('c') . '] ' . $msg . "\n", FILE_APPEND);
}

/* ── CORS ── */
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$allowed = ['https://anfragebox.de', 'https://www.anfragebox.de'];
if (in_array($origin, $allowed, true)) {
  header('Access-Control-Allow-Origin: ' . $origin);
  header('Access-Control-Allow-Methods: POST, OPTIONS');
  header('Access-Control-Allow-Headers: Content-Type, Authorization');
  header('Vary: Origin');
}
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
  respond(200, ['ok' => true]);
}

/* ── Config ── */
require_once dirname(__DIR__) . '/config.php';

$STRIPE_SECRET_KEY = STRIPE_SECRET_KEY;
$STRIPE_PRICE_ID   = STRIPE_PRICE_ID;
$SERVICE_ROLE      = SUPABASE_SERVICE_ROLE_KEY;
$SUPABASE_URL      = SUPABASE_URL;
$SITE_URL          = 'https://anfragebox.de';

if ($STRIPE_SECRET_KEY === '' || $STRIPE_PRICE_ID === '') {
  respond(500, ['ok' => false, 'error' => 'Stripe not configured']);
}

/* ── Auth: verify Supabase token ── */
$authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
$token = str_starts_with($authHeader, 'Bearer ') ? substr($authHeader, 7) : '';

if ($token !== '') {
  // Verify token with Supabase
  $ANON_KEY = SUPABASE_ANON_KEY;
  $ch = curl_init(rtrim($SUPABASE_URL, '/') . '/auth/v1/user');
  curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
  curl_setopt($ch, CURLOPT_HTTPHEADER, ['apikey: ' . $ANON_KEY, 'Authorization: Bearer ' . $token]);
  curl_setopt($ch, CURLOPT_TIMEOUT, 10);
  $res = curl_exec($ch);
  $http = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);
  if ($http !== 200) {
    respond(401, ['ok' => false, 'error' => 'Invalid token']);
  }
}

/* ── Parse body ── */
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
  respond(405, ['ok' => false, 'error' => 'POST only']);
}

$raw = file_get_contents('php://input');
$data = json_decode($raw ?: '', true);
if (!is_array($data)) respond(400, ['ok' => false, 'error' => 'Invalid JSON']);

$companyId   = trim((string)($data['company_id'] ?? ''));
$companyName = trim((string)($data['company_name'] ?? ''));
$email       = trim((string)($data['email'] ?? ''));

if ($companyId === '' || $email === '') {
  respond(400, ['ok' => false, 'error' => 'company_id and email required']);
}

/* ── Create Stripe Checkout Session ── */

$params = http_build_query([
  'mode' => 'subscription',
  'payment_method_types[0]' => 'card',
  'payment_method_types[1]' => 'sepa_debit',
  'line_items[0][price]' => $STRIPE_PRICE_ID,
  'line_items[0][quantity]' => 1,
  'subscription_data[trial_period_days]' => 14,
  'subscription_data[metadata][company_id]' => $companyId,
  'customer_email' => $email,
  'metadata[company_id]' => $companyId,
  'metadata[company_name]' => $companyName,
  'success_url' => $SITE_URL . '/anfrage/onboarding.html?session_id={CHECKOUT_SESSION_ID}&status=success',
  'cancel_url' => $SITE_URL . '/anfrage/onboarding.html?status=canceled',
  'allow_promotion_codes' => 'true',
  'billing_address_collection' => 'required',
  'tax_id_collection[enabled]' => 'true',
  'locale' => 'de',
]);

$ch = curl_init('https://api.stripe.com/v1/checkout/sessions');
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
  'Authorization: Bearer ' . $STRIPE_SECRET_KEY,
  'Content-Type: application/x-www-form-urlencoded',
]);
curl_setopt($ch, CURLOPT_POSTFIELDS, $params);
curl_setopt($ch, CURLOPT_TIMEOUT, 15);

$res = curl_exec($ch);
$http = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

$result = json_decode((string)$res, true);

if ($http < 200 || $http >= 300 || !is_array($result) || empty($result['url'])) {
  blog("Checkout FAIL HTTP $http: " . substr((string)$res, 0, 500));
  respond(500, ['ok' => false, 'error' => 'Stripe checkout creation failed', 'details' => $result['error']['message'] ?? '']);
}

blog("Checkout OK: company=$companyId url=" . $result['url']);

respond(200, [
  'ok' => true,
  'checkout_url' => $result['url'],
  'session_id' => $result['id'] ?? '',
]);