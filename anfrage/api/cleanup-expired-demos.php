<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

require_once __DIR__ . '/../lead_config.php';
require_once __DIR__ . '/_secrets.php';

date_default_timezone_set('Europe/Berlin');

$token = $_GET['token'] ?? ($_SERVER['argv'][1] ?? '');
$expectedToken = defined('DEMO_CLEANUP_TOKEN')
    ? DEMO_CLEANUP_TOKEN
    : (getenv('DEMO_CLEANUP_TOKEN') ?: '');

if ($expectedToken === '' || !hash_equals($expectedToken, $token)) {
    http_response_code(401);
    echo json_encode([
        'ok' => false,
        'error' => 'unauthorized'
    ]);
    exit;
}

$supabaseUrl = rtrim(
    defined('SUPABASE_URL') ? SUPABASE_URL : (getenv('SUPABASE_URL') ?: ''),
    '/'
);

$serviceKey = defined('SUPABASE_SERVICE_ROLE_KEY')
    ? SUPABASE_SERVICE_ROLE_KEY
    : (getenv('SUPABASE_SERVICE_ROLE_KEY') ?: '');

if ($supabaseUrl === '' || $serviceKey === '') {
    http_response_code(500);
    echo json_encode([
        'ok' => false,
        'error' => 'missing_supabase_config'
    ]);
    exit;
}

function sb_request(string $method, string $url, string $serviceKey, ?array $body = null): array
{
    $ch = curl_init($url);

    $headers = [
        'apikey: ' . $serviceKey,
        'Authorization: Bearer ' . $serviceKey,
        'Content-Type: application/json',
        'Accept: application/json',
        'Prefer: return=representation'
    ];

    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST  => $method,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_TIMEOUT        => 30,
    ]);

    if ($body !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_UNICODE));
    }

    $raw = curl_exec($ch);
    $http = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);

    if ($raw === false) {
        return ['ok' => false, 'status' => $http, 'error' => $err ?: 'curl_failed'];
    }

    $json = json_decode($raw, true);

    if ($http < 200 || $http >= 300) {
        return [
            'ok' => false,
            'status' => $http,
            'error' => $json ?: $raw
        ];
    }

    return [
        'ok' => true,
        'status' => $http,
        'data' => $json
    ];
}

function in_filter(array $ids): string
{
    $safe = array_map(static fn($v) => trim((string)$v), $ids);
    $safe = array_filter($safe, static fn($v) => $v !== '');
    return 'in.(' . implode(',', $safe) . ')';
}

$nowIso = gmdate('Y-m-d\TH:i:s\Z');

$expiredUrl = $supabaseUrl . '/rest/v1/company_settings'
    . '?select=company_id,slug,company_name,demo_expires_at'
    . '&is_demo=eq.true'
    . '&demo_expires_at=lte.' . rawurlencode($nowIso)
    . '&limit=500';

$expired = sb_request('GET', $expiredUrl, $serviceKey);

if (!$expired['ok']) {
    http_response_code(500);
    echo json_encode([
        'ok' => false,
        'step' => 'load_expired_companies',
        'details' => $expired
    ]);
    exit;
}

$companies = $expired['data'] ?? [];

if (!$companies) {
    echo json_encode([
        'ok' => true,
        'deleted_companies' => 0,
        'message' => 'no expired demos'
    ]);
    exit;
}

$companyIds = array_values(array_unique(array_map(
    static fn($row) => (string)($row['company_id'] ?? ''),
    $companies
)));

$companyIds = array_values(array_filter($companyIds));

if (!$companyIds) {
    echo json_encode([
        'ok' => true,
        'deleted_companies' => 0,
        'message' => 'no valid company ids'
    ]);
    exit;
}

$filter = rawurlencode(in_filter($companyIds));

$summary = [
    'expired_found' => count($companyIds),
    'deleted_leads' => 0,
    'deleted_company_users' => 0,
    'deleted_demo_instances' => 0,
    'deleted_company_settings' => 0,
    'deleted_auth_users' => 0,
];

$usersUrl = $supabaseUrl . '/rest/v1/company_users'
    . '?select=user_id,company_id'
    . '&company_id=' . $filter;

$usersRes = sb_request('GET', $usersUrl, $serviceKey);
$userIds = [];

if ($usersRes['ok'] && !empty($usersRes['data'])) {
    foreach ($usersRes['data'] as $row) {
        if (!empty($row['user_id'])) {
            $userIds[] = (string)$row['user_id'];
        }
    }
    $userIds = array_values(array_unique($userIds));
}

$steps = [
    [
        'key' => 'deleted_leads',
        'url' => $supabaseUrl . '/rest/v1/leads?company_id=' . $filter,
    ],
    [
        'key' => 'deleted_company_users',
        'url' => $supabaseUrl . '/rest/v1/company_users?company_id=' . $filter,
    ],
    [
        'key' => 'deleted_demo_instances',
        'url' => $supabaseUrl . '/rest/v1/demo_instances?company_id=' . $filter,
    ],
    [
        'key' => 'deleted_company_settings',
        'url' => $supabaseUrl . '/rest/v1/company_settings?company_id=' . $filter . '&is_demo=eq.true',
    ],
];

foreach ($steps as $step) {
    $res = sb_request('DELETE', $step['url'], $serviceKey);

    if (!$res['ok']) {
        http_response_code(500);
        echo json_encode([
            'ok' => false,
            'step' => $step['key'],
            'details' => $res,
            'summary_so_far' => $summary
        ]);
        exit;
    }

    $summary[$step['key']] = is_array($res['data']) ? count($res['data']) : 0;
}

foreach ($userIds as $userId) {
    $authDeleteUrl = $supabaseUrl . '/auth/v1/admin/users/' . rawurlencode($userId);
    $res = sb_request('DELETE', $authDeleteUrl, $serviceKey);

    if ($res['ok']) {
        $summary['deleted_auth_users']++;
    }
}

echo json_encode([
    'ok' => true,
    'message' => 'expired demos cleaned',
    'now' => $nowIso,
    'companies' => $companies,
    'summary' => $summary
], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);