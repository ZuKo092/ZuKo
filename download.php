<?php
/**
 * Download the entire public website as a ZIP archive.
 *
 * Usage: visit /download.php in a browser to trigger the download.
 */

$rootDir = __DIR__;

$excluded = [
    '.git',
    '.github',
    'tests',
    'vendor',
    'node_modules',
    '.env',
    '.env.example',
    'composer.json',
    'composer.lock',
    'phpunit.xml',
    'download.php',
];

function shouldExclude(string $relativePath, array $excluded): bool
{
    foreach ($excluded as $pattern) {
        if ($relativePath === $pattern || strpos($relativePath, $pattern . '/') === 0) {
            return true;
        }
    }
    return false;
}

$zip = new ZipArchive();
$tmpFile = tempnam(sys_get_temp_dir(), 'anfragebox_') . '.zip';

if ($zip->open($tmpFile, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
    http_response_code(500);
    echo 'Could not create ZIP archive.';
    exit(1);
}

$iterator = new RecursiveIteratorIterator(
    new RecursiveDirectoryIterator($rootDir, RecursiveDirectoryIterator::SKIP_DOTS),
    RecursiveIteratorIterator::LEAVES_ONLY
);

$fileCount = 0;
foreach ($iterator as $file) {
    if ($file->isFile()) {
        $filePath = $file->getRealPath();
        $relativePath = substr($filePath, strlen($rootDir) + 1);

        if (shouldExclude($relativePath, $excluded)) {
            continue;
        }

        $zip->addFile($filePath, 'anfragebox/' . $relativePath);
        $fileCount++;
    }
}

$zip->close();

if ($fileCount === 0) {
    http_response_code(500);
    echo 'No files found to archive.';
    @unlink($tmpFile);
    exit(1);
}

$downloadName = 'anfragebox-' . date('Y-m-d') . '.zip';

header('Content-Type: application/zip');
header('Content-Disposition: attachment; filename="' . $downloadName . '"');
header('Content-Length: ' . filesize($tmpFile));
header('Cache-Control: no-cache, no-store, must-revalidate');

readfile($tmpFile);
@unlink($tmpFile);
exit(0);
