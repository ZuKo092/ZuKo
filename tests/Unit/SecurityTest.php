<?php
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

class SecurityTest extends TestCase
{
    private static array $phpFiles = [];

    public static function setUpBeforeClass(): void
    {
        $root = realpath(__DIR__ . '/../../');
        $iterator = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($root, RecursiveDirectoryIterator::SKIP_DOTS)
        );

        foreach ($iterator as $file) {
            $path = $file->getPathname();
            if ($file->getExtension() === 'php'
                && strpos($path, '/vendor/') === false
                && strpos($path, '/tests/') === false
                && strpos($path, '/phpmailer/') === false
            ) {
                self::$phpFiles[] = $path;
            }
        }
    }

    public function testNoHardcodedSupabaseServiceRoleKey(): void
    {
        foreach (self::$phpFiles as $file) {
            $content = file_get_contents($file);
            $this->assertStringNotContainsString(
                'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
                $content,
                "Hardcoded JWT found in: $file"
            );
        }
    }

    public function testNoHardcodedStripeLiveKeys(): void
    {
        foreach (self::$phpFiles as $file) {
            $content = file_get_contents($file);
            $this->assertDoesNotMatchRegularExpression(
                '/sk_live_[a-zA-Z0-9]+/',
                $content,
                "Hardcoded Stripe live key found in: $file"
            );
        }
    }

    public function testNoHardcodedPasswords(): void
    {
        foreach (self::$phpFiles as $file) {
            $content = file_get_contents($file);
            // Check for password-like assignments that aren't using env/getenv/constants
            $this->assertDoesNotMatchRegularExpression(
                '/\$.*pass.*=\s*[\'"][a-zA-Z0-9@!#$%^&*]{6,}[\'"]/i',
                $content,
                "Possible hardcoded password in: $file"
            );
        }
    }

    public function testNoWildcardCors(): void
    {
        foreach (self::$phpFiles as $file) {
            $content = file_get_contents($file);
            $this->assertStringNotContainsString(
                "Allow-Origin: *",
                $content,
                "Wildcard CORS found in: $file"
            );
        }
    }

    public function testSecretsFilesInGitignore(): void
    {
        $gitignore = file_get_contents(__DIR__ . '/../../.gitignore');
        $this->assertStringContainsString('.env', $gitignore);
        $this->assertStringContainsString('_secrets.php', $gitignore);
    }

    public function testEnvExampleExists(): void
    {
        $this->assertFileExists(__DIR__ . '/../../.env.example');
    }

    public function testEnvExampleHasAllRequiredVars(): void
    {
        $content = file_get_contents(__DIR__ . '/../../.env.example');
        $requiredVars = [
            'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE', 'SUPABASE_ANON_KEY',
            'SMTP_HOST', 'SMTP_PASS',
            'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
            'ADMIN_SECRET_TOKEN',
        ];

        foreach ($requiredVars as $var) {
            $this->assertStringContainsString($var, $content,
                ".env.example missing required var: $var");
        }
    }
}
