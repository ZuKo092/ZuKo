<?php
declare(strict_types=1);

/**
 * Stripe Webhook Handler
 * POST /anfrage/api/billing/stripe-webhook.php
 *
 * Handles: checkout.session.completed, customer.subscription.updated,
 *          customer.subscription.deleted, invoice.payment_failed
 */

header('Content-Type: application/json; charset=utf-8');

function wlog(string $msg): void {
  @file_put_contents(__DIR__ . '/webhook.log', '[' . date('c') . '] ' . $msg . "\n", FILE_APPEND);
}

function respond(int $code, array $data): void {
  http_response_code($code);
  echo json_encode($data, JSON_UNESCAPED_UNICODE);
  exit;
}

/* ── Config ── */
require_once dirname(__DIR__) . '/config.php';

$STRIPE_WEBHOOK_SECRET = STRIPE_WEBHOOK_SECRET;
$STRIPE_SECRET_KEY     = STRIPE_SECRET_KEY;
$SERVICE_ROLE          = SUPABASE_SERVICE_ROLE_KEY;
$SUPABASE_URL          = SUPABASE_URL;

if ($STRIPE_WEBHOOK_SECRET === '' || $STRIPE_SECRET_KEY === '' || $SERVICE_ROLE === '') {
  wlog('ERROR: Missing secrets');
  respond(500, ['error' => 'Server not configured']);
}

/* ── Verify Stripe signature ── */

$payload = file_get_contents('php://input');
$sigHeader = $_SERVER['HTTP_STRIPE_SIGNATURE'] ?? '';

if ($payload === false || $sigHeader === '') {
  respond(400, ['error' => 'No payload or signature']);
}

// Manual signature verification (no Stripe PHP SDK needed)
function verifyStripeSignature(string $payload, string $sigHeader, string $secret): bool {
  $parts = [];
  foreach (explode(',', $sigHeader) as $item) {
    $kv = explode('=', $item, 2);
    if (count($kv) === 2) $parts[$kv[0]] = $kv[1];
  }

  $timestamp = $parts['t'] ?? '';
  $signature = $parts['v1'] ?? '';

  if ($timestamp === '' || $signature === '') return false;

  // Reject timestamps older than 5 minutes
  if (abs(time() - (int)$timestamp) > 300) return false;

  $signedPayload = $timestamp . '.' . $payload;
  $expected = hash_hmac('sha256', $signedPayload, $secret);

  return hash_equals($expected, $signature);
}

if (!verifyStripeSignature($payload, $sigHeader, $STRIPE_WEBHOOK_SECRET)) {
  wlog('ERROR: Invalid signature');
  respond(400, ['error' => 'Invalid signature']);
}

$event = json_decode($payload, true);
if (!is_array($event) || empty($event['type'])) {
  respond(400, ['error' => 'Invalid event']);
}

$type = $event['type'];
$obj = $event['data']['object'] ?? [];

wlog("EVENT: $type | id=" . ($obj['id'] ?? '?'));

/* ── Supabase helpers ── */

function sb_upsert(string $url, string $key, string $table, array $row, string $onConflict): bool {
  $endpoint = rtrim($url, '/') . '/rest/v1/' . rawurlencode($table);
  $ch = curl_init($endpoint);
  curl_setopt($ch, CURLOPT_POST, true);
  curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
  curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Content-Type: application/json',
    'apikey: ' . $key,
    'Authorization: Bearer ' . $key,
    'Prefer: resolution=merge-duplicates,return=minimal',
    'on_conflict: ' . $onConflict,
  ]);
  curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($row, JSON_UNESCAPED_UNICODE));
  curl_setopt($ch, CURLOPT_TIMEOUT, 15);
  $res = curl_exec($ch);
  $http = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);
  if ($http < 200 || $http >= 300) {
    wlog("sb_upsert FAIL $table HTTP $http: " . substr((string)$res, 0, 500));
    return false;
  }
  return true;
}

function sb_select_one(string $url, string $key, string $path): ?array {
  $ch = curl_init(rtrim($url, '/') . $path);
  curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
  curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'apikey: ' . $key,
    'Authorization: Bearer ' . $key,
    'Accept: application/json',
  ]);
  curl_setopt($ch, CURLOPT_TIMEOUT, 10);
  $res = curl_exec($ch);
  $http = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);
  if ($http < 200 || $http >= 300 || $res === false) return null;
  $out = json_decode((string)$res, true);
  return (is_array($out) && isset($out[0])) ? $out[0] : null;
}

/* ── Find company_id from Stripe customer metadata ── */

function findCompanyId(string $url, string $key, array $obj): string {
  // 1. Check subscription metadata
  $companyId = $obj['metadata']['company_id'] ?? '';
  if ($companyId !== '') return $companyId;

  // 2. Check customer metadata via existing subscription record
  $stripeCustomerId = $obj['customer'] ?? '';
  if ($stripeCustomerId !== '') {
    $row = sb_select_one($url, $key, '/rest/v1/subscriptions?select=company_id&stripe_customer_id=eq.' . rawurlencode($stripeCustomerId) . '&limit=1');
    if ($row && !empty($row['company_id'])) return (string)$row['company_id'];
  }

  return '';
}

/* ── Handle events ── */

switch ($type) {

  case 'checkout.session.completed':
    $companyId = $obj['metadata']['company_id'] ?? '';
    $stripeCustomerId = $obj['customer'] ?? '';
    $subscriptionId = $obj['subscription'] ?? '';

    if ($companyId === '' || $subscriptionId === '') {
      wlog("SKIP checkout: missing company_id or subscription_id");
      break;
    }

    // Fetch subscription details from Stripe
    $ch = curl_init("https://api.stripe.com/v1/subscriptions/$subscriptionId");
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, ["Authorization: Bearer $STRIPE_SECRET_KEY"]);
    $subRes = json_decode((string)curl_exec($ch), true);
    curl_close($ch);

    $status = $subRes['status'] ?? 'active';
    $trialStart = isset($subRes['trial_start']) ? date('c', $subRes['trial_start']) : null;
    $trialEnd = isset($subRes['trial_end']) ? date('c', $subRes['trial_end']) : null;
    $periodStart = isset($subRes['current_period_start']) ? date('c', $subRes['current_period_start']) : null;
    $periodEnd = isset($subRes['current_period_end']) ? date('c', $subRes['current_period_end']) : null;
    $priceId = $subRes['items']['data'][0]['price']['id'] ?? '';

    $row = [
      'company_id' => $companyId,
      'stripe_customer_id' => $stripeCustomerId,
      'stripe_subscription_id' => $subscriptionId,
      'stripe_price_id' => $priceId,
      'status' => $status,
      'plan_name' => 'pro',
      'amount_eur' => 9900,
      'interval' => 'month',
      'trial_start' => $trialStart,
      'trial_end' => $trialEnd,
      'current_period_start' => $periodStart,
      'current_period_end' => $periodEnd,
      'updated_at' => date('c'),
    ];

    sb_upsert($SUPABASE_URL, $SERVICE_ROLE, 'subscriptions', $row, 'company_id');
    wlog("OK checkout: company=$companyId status=$status");
    break;

  case 'customer.subscription.updated':
  case 'customer.subscription.deleted':
    $subscriptionId = $obj['id'] ?? '';
    $companyId = findCompanyId($SUPABASE_URL, $SERVICE_ROLE, $obj);

    if ($companyId === '' || $subscriptionId === '') {
      wlog("SKIP $type: no company_id found");
      break;
    }

    $status = $obj['status'] ?? 'canceled';
    $trialEnd = isset($obj['trial_end']) ? date('c', $obj['trial_end']) : null;
    $periodStart = isset($obj['current_period_start']) ? date('c', $obj['current_period_start']) : null;
    $periodEnd = isset($obj['current_period_end']) ? date('c', $obj['current_period_end']) : null;
    $cancelAt = isset($obj['cancel_at']) ? date('c', $obj['cancel_at']) : null;
    $canceledAt = isset($obj['canceled_at']) ? date('c', $obj['canceled_at']) : null;

    $row = [
      'company_id' => $companyId,
      'stripe_subscription_id' => $subscriptionId,
      'status' => $status,
      'trial_end' => $trialEnd,
      'current_period_start' => $periodStart,
      'current_period_end' => $periodEnd,
      'cancel_at' => $cancelAt,
      'canceled_at' => $canceledAt,
      'updated_at' => date('c'),
    ];

    sb_upsert($SUPABASE_URL, $SERVICE_ROLE, 'subscriptions', $row, 'company_id');
    wlog("OK $type: company=$companyId status=$status");
    break;

  case 'invoice.payment_failed':
    $stripeCustomerId = $obj['customer'] ?? '';
    $subRow = sb_select_one($SUPABASE_URL, $SERVICE_ROLE, '/rest/v1/subscriptions?select=company_id&stripe_customer_id=eq.' . rawurlencode($stripeCustomerId) . '&limit=1');
    if ($subRow) {
      sb_upsert($SUPABASE_URL, $SERVICE_ROLE, 'subscriptions', [
        'company_id' => $subRow['company_id'],
        'status' => 'past_due',
        'updated_at' => date('c'),
      ], 'company_id');
      wlog("OK payment_failed: company=" . $subRow['company_id']);
    }
    break;

  default:
    wlog("IGNORED: $type");
    break;
}

respond(200, ['received' => true]);