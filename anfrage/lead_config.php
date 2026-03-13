<?php
declare(strict_types=1);

/**
 * Legacy config — now delegates to the centralized config.php.
 * Kept for backward compatibility with any files that still require this.
 */

require_once __DIR__ . '/api/config.php';

// Re-export constants that legacy code expects under different names
if (!defined('COMPANY_ID'))             define('COMPANY_ID', DEFAULT_COMPANY_ID);
if (!defined('OWNER_EMAIL_OVERRIDE'))   define('OWNER_EMAIL_OVERRIDE', '');
