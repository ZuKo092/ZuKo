<?php
declare(strict_types=1);

/**
 * Create User Tool
 *
 * Usage (POST JSON):
 *   POST /anfrage/api/create-user.php
 *   Headers: Content-Type: application/json
 *   Body: { "token": "SECRET", "email": "test@example.com", "password": "Test1234!", "company_id": "UUID", "role": "owner" }
 *
 * All params required except role (default: owner).
 * Delete after use or change the SECRET token.
 */

require_once __DIR__ . '/config.php';

$SUPABASE_URL = SUPABASE_URL;

header('Content-Type: application/json; charset=utf-8');

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
  http_response_code(405);
  echo json_encode(['ok' => false, 'error' => 'Method not allowed. Use POST with JSON body.']);
  exit;
}

$body = json_decode(file_get_contents('php://input') ?: '', true);
if (!is_array($body)) {
  http_response_code(400);
  echo json_encode(['ok' => false, 'error' => 'Invalid JSON body.']);
  exit;
}

// Auth
$provided = trim((string)($body['token'] ?? ''));
if ($provided === '' || $provided !== ADMIN_SECRET_TOKEN) { http_response_code(403); echo json_encode(['ok' => false, 'error' => 'Forbidden. Bad token.']); exit; }

// Load service role
$SERVICE_ROLE = SUPABASE_SERVICE_ROLE_KEY;
if ($SERVICE_ROLE === '') { echo json_encode(['ok' => false, 'error' => 'SUPABASE_SERVICE_ROLE_KEY missing in config']); exit; }

// Params
$email = trim((string)($body['email'] ?? ''));
$password = (string)($body['password'] ?? '');
$companyId = trim((string)($body['company_id'] ?? ''));
$role = trim((string)($body['role'] ?? 'owner'));

if ($email === '' || $password === '' || $companyId === '') {
  http_response_code(400);
  echo json_encode(['ok' => false, 'error' => 'Missing required fields: email, password, company_id']);
  exit;
}

if (strlen($password) < 8) { http_response_code(400); echo json_encode(['ok' => false, 'error' => 'Password must be at least 8 characters.']); exit; }

// Proceed with user creation

// 1. Create auth user with password
$ch = curl_init($SUPABASE_URL . '/auth/v1/admin/users');
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
  'Content-Type: application/json',
  'apikey: ' . $SERVICE_ROLE,
  'Authorization: Bearer ' . $SERVICE_ROLE,
]);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode([
  'email' => $email,
  'password' => $password,
  'email_confirm' => true,
]));
curl_setopt($ch, CURLOPT_TIMEOUT, 15);
$res = curl_exec($ch);
$http = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

$json = json_decode((string)$res, true);

if ($http < 200 || $http >= 300 || !is_array($json) || empty($json['id'])) {
  http_response_code(500);
  echo json_encode(['ok' => false, 'error' => 'Auth user creation failed', 'http' => $http]);
  exit;
}

$userId = (string)$json['id'];

// 2. Insert into company_users
$ch2 = curl_init($SUPABASE_URL . '/rest/v1/company_users');
curl_setopt($ch2, CURLOPT_POST, true);
curl_setopt($ch2, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch2, CURLOPT_HTTPHEADER, [
  'Content-Type: application/json',
  'apikey: ' . $SERVICE_ROLE,
  'Authorization: Bearer ' . $SERVICE_ROLE,
  'Prefer: return=representation',
]);
curl_setopt($ch2, CURLOPT_POSTFIELDS, json_encode([
  'company_id' => $companyId,
  'user_id' => $userId,
  'role' => $role,
  'is_active' => true,
]));
curl_setopt($ch2, CURLOPT_TIMEOUT, 15);
$res2 = curl_exec($ch2);
$http2 = (int)curl_getinfo($ch2, CURLINFO_HTTP_CODE);
curl_close($ch2);

if ($http2 < 200 || $http2 >= 300) {
  http_response_code(500);
  echo json_encode(['ok' => false, 'error' => 'company_users insert failed. Auth user created but not linked.', 'user_id' => $userId]);
  exit;
}

echo json_encode(['ok' => true, 'user_id' => $userId, 'company_id' => $companyId, 'role' => $role]);