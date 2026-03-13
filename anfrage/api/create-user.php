<?php
declare(strict_types=1);

/**
 * Create User Tool
 * 
 * Usage (browser):
 *   https://anfragebox.de/anfrage/api/create-user.php?token=SECRET&email=test@example.com&password=Test1234!&company_id=UUID&role=owner
 *
 * All params required except role (default: owner).
 * Delete after use or change the SECRET token.
 */

require_once __DIR__ . '/config.php';

$SUPABASE_URL = SUPABASE_URL;

header('Content-Type: text/plain; charset=utf-8');

// Auth
$provided = $_GET['token'] ?? '';
if ($provided !== ADMIN_SECRET_TOKEN) { http_response_code(403); echo "Forbidden. Bad token."; exit; }

// Load service role
$SERVICE_ROLE = SUPABASE_SERVICE_ROLE_KEY;
if ($SERVICE_ROLE === '') { echo "ERROR: SUPABASE_SERVICE_ROLE_KEY missing in config"; exit; }

// Params
$email = trim($_GET['email'] ?? '');
$password = trim($_GET['password'] ?? '');
$companyId = trim($_GET['company_id'] ?? '');
$role = trim($_GET['role'] ?? 'owner');

if ($email === '' || $password === '' || $companyId === '') {
  echo "Usage: ?token=SECRET&email=EMAIL&password=PASS&company_id=UUID&role=owner\n\n";
  echo "Missing: " . implode(', ', array_filter([
    $email === '' ? 'email' : null,
    $password === '' ? 'password' : null,
    $companyId === '' ? 'company_id' : null,
  ]));
  exit;
}

if (strlen($password) < 6) { echo "ERROR: Password must be at least 6 characters."; exit; }

echo "=== CREATE USER ===\n";
echo "Email: $email\n";
echo "Company: $companyId\n";
echo "Role: $role\n\n";

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
  echo "ERROR: Auth user creation failed.\n";
  echo "HTTP: $http\n";
  echo "Response: $res\n";
  exit;
}

$userId = (string)$json['id'];
echo "Auth user created: $userId\n";

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
  echo "WARNING: company_users insert failed.\n";
  echo "HTTP: $http2\n";
  echo "Response: $res2\n";
  echo "\nAuth user was created but not linked. Fix manually.\n";
  exit;
}

echo "Linked to company: $companyId (role: $role)\n\n";
echo "=== DONE ===\n";
echo "Login: $email / $password\n";
echo "Admin: https://anfragebox.de/anfrage/admin.html\n";