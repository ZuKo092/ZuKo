<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

require_once __DIR__ . '/config.php';

function supabase_get(string $path): array
{
    $url = rtrim(SUPABASE_URL, '/') . $path;

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => [
            'apikey: ' . SUPABASE_SERVICE_ROLE_KEY,
            'Authorization: Bearer ' . SUPABASE_SERVICE_ROLE_KEY,
            'Accept: application/json',
        ],
        CURLOPT_TIMEOUT => 15,
    ]);

    $response = curl_exec($ch);
    $curlError = curl_error($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($response === false) {
        throw new RuntimeException('cURL failed: ' . $curlError);
    }

    $json = json_decode($response, true);

    if (!is_array($json)) {
        throw new RuntimeException('Invalid JSON from Supabase: ' . $response);
    }

    return [$status, $json];
}

try {
    $slug = trim((string) ($_GET['slug'] ?? ''));

    if ($slug === '') {
        http_response_code(400);
        echo json_encode([
            'ok' => false,
            'error' => 'Missing slug',
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }

    $demoSelect = implode(',', [
        'company_id',
        'public_slug',
        'status',
        'expires_at',
    ]);

    $demoPath =
        '/rest/v1/demo_instances'
        . '?select=' . rawurlencode($demoSelect)
        . '&public_slug=eq.' . rawurlencode($slug)
        . '&status=eq.active'
        . '&limit=1';

    [$demoStatus, $demoRows] = supabase_get($demoPath);

    if ($demoStatus >= 400) {
        http_response_code($demoStatus);
        echo json_encode([
            'ok' => false,
            'error' => 'Demo lookup failed',
            'details' => $demoRows,
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }

    if (count($demoRows) === 0) {
        http_response_code(404);
        echo json_encode([
            'ok' => false,
            'error' => 'Demo not found',
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }

    $demo = $demoRows[0];
    $companyId = (string) ($demo['company_id'] ?? '');

    if ($companyId === '') {
        http_response_code(500);
        echo json_encode([
            'ok' => false,
            'error' => 'Demo has no company_id',
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }

    $expiresAt = (string) ($demo['expires_at'] ?? '');
    if ($expiresAt !== '' && strtotime($expiresAt) !== false && strtotime($expiresAt) < time()) {
        http_response_code(410);
        echo json_encode([
            'ok' => false,
            'error' => 'Demo expired',
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }

    $companySelect = implode(',', [
        'company_id',
        'company_name',
        'phone',
        'email',
        'logo_url',
        'accent_color',
    ]);

    $companyPath =
        '/rest/v1/company_settings'
        . '?select=' . rawurlencode($companySelect)
        . '&company_id=eq.' . rawurlencode($companyId)
        . '&limit=1';

    [$companyStatus, $companyRows] = supabase_get($companyPath);

    if ($companyStatus >= 400) {
        http_response_code($companyStatus);
        echo json_encode([
            'ok' => false,
            'error' => 'Company lookup failed',
            'details' => $companyRows,
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }

    if (count($companyRows) === 0) {
        http_response_code(404);
        echo json_encode([
            'ok' => false,
            'error' => 'Company settings not found',
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }

    $company = $companyRows[0];
    $company['slug'] = $slug;

    echo json_encode([
        'ok' => true,
        'company' => $company,
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode([
        'ok' => false,
        'error' => 'Server error',
        'details' => $e->getMessage(),
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}