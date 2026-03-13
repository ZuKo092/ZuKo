<?php
declare(strict_types=1);

/**
 * Create Stripe Customer Portal Session
 * POST /anfrage/api/billing/create-portal-session.php
 *
 * Body: { company_id }
 * Auth: Bearer token required
 * Returns: { ok, portal_url }
 */

header('Content-Type: application/json; charset=utf-8');

function respond(int $code, array $data): void {
  http_response_code($code);
  echo json_encode($data, JSON_UNESCAPED_UNICODE);
  exit;
}

/* ── CORS ── */
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$allowed = ['https://anfragebox.de', 'https://www.anfragebox.de'];
if (in_array($origin, $allowed, true)) {
  header('Access-Control-Allow-Origin: ' . $origin);
  header('Access-Control-Allow-Methods: POST, OPTIONS');
  header('Access-Control-Allow-Headers: Content-Type, Authorization');
}
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') respond(200, ['ok' => true]);

/* ── Config ── */
require_once dirname(__DIR__) . '/config.php';

$STRIPE_SECRET_KEY = STRIPE_SECRET_KEY;
$SERVICE_ROLE      = SUPABASE_SERVICE_ROLE_KEY;
$SUPABASE_URL      = SUPABASE_URL;
$SITE_URL          = 'https://anfragebox.de';

if ($STRIPE_SECRET_KEY === '') respond(500, ['ok' => false, 'error' => 'Not configured']);

/* ── Auth ── */
$authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
$token = str_starts_with($authHeader, 'Bearer ') ? substr($authHeader, 7) : '';
if ($token === '') respond(401, ['ok' => false, 'error' => 'Auth required']);

/* ── Parse ── */
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') respond(405, ['ok' => false, 'error' => 'POST only']);
$data = json_decode(file_get_contents('php://input') ?: '', true);
$companyId = trim((string)($data['company_id'] ?? ''));
if ($companyId === '') respond(400, ['ok' => false, 'error' => 'company_id required']);

/* ── Get Stripe customer ID from subscription ── */
$ch = curl_init(rtrim($SUPABASE_URL, '/') . '/rest/v1/subscriptions?select=stripe_customer_id&company_id=eq.' . rawurlencode($companyId) . '&limit=1');
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, ['apikey: ' . $SERVICE_ROLE, 'Authorization: Bearer ' . $SERVICE_ROLE, 'Accept: application/json']);
curl_setopt($ch, CURLOPT_TIMEOUT, 10);
$res = curl_exec($ch); curl_close($ch);
$rows = json_decode((string)$res, true);
$stripeCustomerId = (is_array($rows) && isset($rows[0]['stripe_customer_id'])) ? $rows[0]['stripe_customer_id'] : '';

if ($stripeCustomerId === '') respond(404, ['ok' => false, 'error' => 'No subscription found']);

/* ── Create portal session ── */
$params = http_build_query([
  'customer' => $stripeCustomerId,
  'return_url' => $SITE_URL . '/anfrage/admin.html#billing',
]);

$ch = curl_init('https://api.stripe.com/v1/billing_portal/sessions');
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, ['Authorization: Bearer ' . $STRIPE_SECRET_KEY, 'Content-Type: application/x-www-form-urlencoded']);
curl_setopt($ch, CURLOPT_POSTFIELDS, $params);
$res = curl_exec($ch);
$http = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

$result = json_decode((string)$res, true);
if ($http < 200 || $http >= 300 || empty($result['url'])) {
  respond(500, ['ok' => false, 'error' => 'Portal session failed']);
}

respond(200, ['ok' => true, 'portal_url' => $result['url']]);