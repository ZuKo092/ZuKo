<?php
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

class ConfigTest extends TestCase
{
    public function testEnvFunctionReadsEnvironmentVariable(): void
    {
        putenv('TEST_CONFIG_VAR=hello123');
        $this->assertEquals('hello123', env('TEST_CONFIG_VAR'));
        putenv('TEST_CONFIG_VAR');
    }

    public function testEnvFunctionReturnsDefaultWhenMissing(): void
    {
        $this->assertEquals('fallback', env('NONEXISTENT_VAR_XYZ', 'fallback'));
    }

    public function testEnvFunctionReturnsEmptyStringByDefault(): void
    {
        $this->assertEquals('', env('NONEXISTENT_VAR_XYZ'));
    }

    public function testRequiredConstantsDefined(): void
    {
        $requiredConstants = [
            'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY',
            'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_SECURE',
            'MAIL_FROM', 'MAIL_FROM_NAME', 'OWNER_EMAIL', 'BRAND_NAME',
            'DEFAULT_COMPANY_ID',
            'TURNSTILE_SECRET', 'TURNSTILE_SITEKEY',
            'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_ID',
            'CRON_TOKEN_FOLLOWUP', 'CRON_TOKEN_PORTAL', 'DEMO_CLEANUP_TOKEN',
            'ADMIN_SECRET_TOKEN',
            'ALLOWED_ORIGINS',
        ];

        foreach ($requiredConstants as $const) {
            $this->assertTrue(defined($const), "Constant $const should be defined");
        }
    }

    public function testSmtpPortIsInteger(): void
    {
        $this->assertIsInt(SMTP_PORT);
    }

    public function testAllowedOriginsIsArray(): void
    {
        $this->assertIsArray(ALLOWED_ORIGINS);
    }

    public function testCorsHeadersFunctionExists(): void
    {
        $this->assertTrue(function_exists('cors_headers'));
    }

    public function testNoHardcodedSecretsInConfig(): void
    {
        $configContent = file_get_contents(__DIR__ . '/../../anfrage/api/config.php');

        $this->assertStringNotContainsString('sk_live_', $configContent,
            'Config should not contain Stripe live keys');
        $this->assertStringNotContainsString('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', $configContent,
            'Config should not contain hardcoded JWTs');
    }
}
