<?php
declare(strict_types=1);

/**
 * Centralized configuration — loads all secrets from environment variables.
 *
 * On the server, set env vars via .env file, hosting panel, or shell export.
 * Never commit real values to version control.
 */

// ── Helper ──────────────────────────────────────────────────────────────
function env(string $key, string $default = ''): string {
    $v = getenv($key);
    if (is_string($v) && $v !== '') return $v;
    if (isset($_ENV[$key]) && is_string($_ENV[$key]) && $_ENV[$key] !== '') return $_ENV[$key];
    if (isset($_SERVER[$key]) && is_string($_SERVER[$key]) && $_SERVER[$key] !== '') return $_SERVER[$key];
    return $default;
}

// ── Load .env file if it exists (simple parser) ─────────────────────────
(function () {
    $envFile = __DIR__ . '/../../.env';
    if (!is_file($envFile)) $envFile = __DIR__ . '/../.env';
    if (!is_file($envFile)) return;

    $lines = file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#') continue;
        if (strpos($line, '=') === false) continue;
        [$key, $val] = explode('=', $line, 2);
        $key = trim($key);
        $val = trim($val);
        // Remove surrounding quotes
        if (strlen($val) >= 2 && ($val[0] === '"' || $val[0] === "'") && $val[0] === $val[strlen($val) - 1]) {
            $val = substr($val, 1, -1);
        }
        if (!getenv($key)) {
            putenv("$key=$val");
            $_ENV[$key] = $val;
        }
    }
})();

// ── Supabase ────────────────────────────────────────────────────────────
define('SUPABASE_URL',              env('SUPABASE_URL'));
define('SUPABASE_SERVICE_ROLE_KEY', env('SUPABASE_SERVICE_ROLE'));
define('SUPABASE_ANON_KEY',         env('SUPABASE_ANON_KEY'));

// ── SMTP ────────────────────────────────────────────────────────────────
define('SMTP_HOST',   env('SMTP_HOST', 'smtp.hostinger.com'));
define('SMTP_PORT',   (int) env('SMTP_PORT', '465'));
define('SMTP_USER',   env('SMTP_USER'));
define('SMTP_PASS',   env('SMTP_PASS'));
define('SMTP_SECURE', env('SMTP_SECURE', 'ssl'));

// ── Email defaults ──────────────────────────────────────────────────────
define('MAIL_FROM',      env('MAIL_FROM', 'info@grapify.show'));
define('MAIL_FROM_NAME', env('MAIL_FROM_NAME', 'AnfrageBox'));
define('OWNER_EMAIL',    env('OWNER_EMAIL', 'info@grapify.show'));
define('BRAND_NAME',     env('BRAND_NAME', 'Umzug Transporte 84'));

// ── Company (default for standalone form) ───────────────────────────────
define('DEFAULT_COMPANY_ID', env('COMPANY_ID'));

// ── Cloudflare Turnstile ────────────────────────────────────────────────
define('TURNSTILE_SECRET',  env('TURNSTILE_SECRET'));
define('TURNSTILE_SITEKEY', env('TURNSTILE_SITEKEY'));

// ── Stripe ──────────────────────────────────────────────────────────────
define('STRIPE_SECRET_KEY',     env('STRIPE_SECRET_KEY'));
define('STRIPE_WEBHOOK_SECRET', env('STRIPE_WEBHOOK_SECRET'));
define('STRIPE_PRICE_ID',       env('STRIPE_PRICE_ID'));

// ── Cron tokens ─────────────────────────────────────────────────────────
define('CRON_TOKEN_FOLLOWUP',   env('CRON_TOKEN_FOLLOWUP'));
define('CRON_TOKEN_PORTAL',     env('CRON_TOKEN_PORTAL'));
define('DEMO_CLEANUP_TOKEN',    env('DEMO_CLEANUP_TOKEN'));

// ── Admin tool token ────────────────────────────────────────────────────
define('ADMIN_SECRET_TOKEN',    env('ADMIN_SECRET_TOKEN'));
