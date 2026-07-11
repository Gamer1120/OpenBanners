<?php

declare(strict_types=1);

require_once __DIR__ . '/banner-together-store.php';

if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "Banner Together maintenance is CLI-only.\n");
    exit(1);
}

$storageDirectory = getenv('OPENBANNERS_BANNER_TOGETHER_STORAGE');
$storageDirectory = is_string($storageDirectory) && $storageDirectory !== ''
    ? $storageDirectory
    : '/var/lib/openbanners/banner-together';

try {
    $store = new BannerTogetherRoomStore($storageDirectory);
    $removedCount = $store->cleanupExpired();
    fwrite(STDOUT, "Removed {$removedCount} expired Banner Together rooms.\n");
} catch (Throwable $error) {
    fwrite(STDERR, 'Banner Together cleanup failed: ' . $error->getMessage() . "\n");
    exit(1);
}
