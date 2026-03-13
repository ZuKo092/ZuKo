<?php
declare(strict_types=1);

/**
 * Centralized structured logger.
 *
 * Outputs JSON-structured log lines to a single log file and optionally
 * to stderr (which most hosting platforms capture automatically).
 *
 * Usage:
 *   app_log('error', 'Lead insert failed', ['lead_id' => $id, 'http' => 500]);
 *   app_log('info', 'Email sent', ['to' => $email]);
 */

define('LOG_DIR', env('LOG_DIR', __DIR__ . '/../../logs'));
define('LOG_FILE', LOG_DIR . '/app.log');
define('LOG_TO_STDERR', env('LOG_TO_STDERR', 'true') === 'true');

// Ensure log directory exists
if (!is_dir(LOG_DIR)) {
    @mkdir(LOG_DIR, 0750, true);
}

/**
 * @param string $level   One of: debug, info, warning, error, critical
 * @param string $message Human-readable message
 * @param array  $context Additional structured data
 */
function app_log(string $level, string $message, array $context = []): void {
    $entry = [
        'timestamp' => date('c'),
        'level'     => $level,
        'message'   => $message,
        'file'      => basename(debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 1)[0]['file'] ?? ''),
    ];

    if (!empty($context)) {
        $entry['context'] = $context;
    }

    // Add request context for HTTP requests
    if (isset($_SERVER['REQUEST_METHOD'])) {
        $entry['request'] = [
            'method' => $_SERVER['REQUEST_METHOD'],
            'uri'    => $_SERVER['REQUEST_URI'] ?? '',
            'ip'     => $_SERVER['REMOTE_ADDR'] ?? '',
        ];
    }

    $line = json_encode($entry, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n";

    @file_put_contents(LOG_FILE, $line, FILE_APPEND | LOCK_EX);

    if (LOG_TO_STDERR) {
        @file_put_contents('php://stderr', $line);
    }
}

/**
 * Shorthand helpers
 */
function log_info(string $message, array $context = []): void {
    app_log('info', $message, $context);
}

function log_error(string $message, array $context = []): void {
    app_log('error', $message, $context);
}

function log_warning(string $message, array $context = []): void {
    app_log('warning', $message, $context);
}

/**
 * Backward-compatible clog() for cron scripts (outputs to stdout + log)
 */
function clog(string $msg): void {
    echo '[' . date('c') . '] ' . $msg . "\n";
    app_log('info', $msg, ['source' => 'cron']);
}
