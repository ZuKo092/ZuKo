<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

function deny_json(int $code, string $error): void {
  http_response_code($code);
  echo json_encode([
    'ok' => false,
    'error' => $error
  ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}

function require_not_demo_staff(?string $role, string $action = 'action'): void {
  if (($role ?? '') === 'demo_staff') {
    deny_json(403, 'Demo access denied for ' . $action);
  }
}

function require_role_in(?string $role, array $allowed, string $action = 'action'): void {
  if (!in_array((string)$role, $allowed, true)) {
    deny_json(403, 'Forbidden for ' . $action);
  }
}