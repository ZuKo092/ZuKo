<?php
declare(strict_types=1);

/* Supabase */
define('SUPABASE_URL', getenv('SUPABASE_URL'));
define('SUPABASE_SERVICE_ROLE', getenv('SUPABASE_SERVICE_ROLE'));
define('COMPANY_ID', getenv('COMPANY_ID'));

/* Turnstile */
define('TURNSTILE_SECRET', getenv('TURNSTILE_SECRET'));
define('TURNSTILE_SITEKEY', getenv('TURNSTILE_SITEKEY'));

/* Email (optional) */
define('ENABLE_EMAIL_OWNER', true);
define('ENABLE_EMAIL_CLIENT', true);

define('MAIL_FROM', getenv('MAIL_FROM') ?: 'info@grapify.show');
define('MAIL_FROM_NAME', getenv('MAIL_FROM_NAME') ?: 'AnfrageBox');
define('OWNER_EMAIL', getenv('OWNER_EMAIL') ?: 'info@grapify.show');
define('BRAND_NAME', getenv('BRAND_NAME') ?: 'Umzug Transporte 84');
