<?php
declare(strict_types=1);

// Set test environment variables before loading config
putenv('SUPABASE_URL=https://test.supabase.co');
putenv('SUPABASE_SERVICE_ROLE=test-service-role-key');
putenv('SUPABASE_ANON_KEY=test-anon-key');
putenv('SMTP_HOST=localhost');
putenv('SMTP_PORT=25');
putenv('SMTP_USER=test@test.com');
putenv('SMTP_PASS=test');
putenv('COMPANY_ID=00000000-0000-0000-0000-000000000001');
putenv('TURNSTILE_SECRET=test-turnstile');
putenv('TURNSTILE_SITEKEY=test-sitekey');
putenv('STRIPE_SECRET_KEY=sk_test_fake');
putenv('STRIPE_WEBHOOK_SECRET=whsec_test');
putenv('STRIPE_PRICE_ID=price_test');
putenv('CRON_TOKEN_FOLLOWUP=test-cron-token');
putenv('CRON_TOKEN_PORTAL=test-cron-portal');
putenv('DEMO_CLEANUP_TOKEN=test-cleanup');
putenv('ADMIN_SECRET_TOKEN=test-admin-token');
putenv('ALLOWED_ORIGINS=https://test.example.com');

require_once __DIR__ . '/../vendor/autoload.php';
