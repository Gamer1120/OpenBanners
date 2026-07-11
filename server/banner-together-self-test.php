<?php

declare(strict_types=1);

require_once __DIR__ . '/banner-together-store.php';

if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "Banner Together self-test is CLI-only.\n");
    exit(1);
}

function selfTestAssert(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

function expectHttpException(callable $callback, int $status, string $code): BannerTogetherHttpException
{
    try {
        $callback();
    } catch (BannerTogetherHttpException $error) {
        selfTestAssert($error->httpStatus === $status, 'Unexpected HTTP status in self-test.');
        selfTestAssert($error->errorCode === $code, 'Unexpected error code in self-test.');
        return $error;
    }

    throw new RuntimeException('Expected Banner Together operation to fail.');
}

function removeSelfTestDirectory(string $path): void
{
    if (!is_dir($path)) {
        return;
    }

    $entries = scandir($path);

    if (is_array($entries)) {
        foreach ($entries as $entry) {
            if ($entry === '.' || $entry === '..') {
                continue;
            }

            $entryPath = $path . DIRECTORY_SEPARATOR . $entry;

            if (is_dir($entryPath)) {
                removeSelfTestDirectory($entryPath);
            } else {
                @unlink($entryPath);
            }
        }
    }

    @rmdir($path);
}

$storageDirectory = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'openbanners-room-test-' . bin2hex(random_bytes(8));
$now = 1760000000;
$clock = static function () use (&$now): int {
    return $now;
};

try {
    $store = new BannerTogetherRoomStore($storageDirectory, $clock);
    $ownerCapability = BannerTogetherRoomStore::encodeBase64Url(random_bytes(32));
    $joinCapability = BannerTogetherRoomStore::encodeBase64Url(random_bytes(32));
    $guestCapability = BannerTogetherRoomStore::encodeBase64Url(random_bytes(32));
    $otherGuestCapability = BannerTogetherRoomStore::encodeBase64Url(random_bytes(32));
    $room = $store->createRoom(
        BannerTogetherRoomStore::hashCapability($ownerCapability),
        BannerTogetherRoomStore::hashCapability($joinCapability),
        'primary-room-request-key',
        'create-client'
    );

    selfTestAssert($room['version'] === 2, 'Room version was not returned.');
    selfTestAssert(
        $room['expiresAt'] === gmdate('Y-m-d\TH:i:s.000\Z', $now + BANNER_TOGETHER_ROOM_TTL_SECONDS),
        'Room expiry was not seven days.'
    );
    $retriedRoom = $store->createRoom(
        BannerTogetherRoomStore::hashCapability($ownerCapability),
        BannerTogetherRoomStore::hashCapability($joinCapability),
        'primary-room-request-key',
        'retry-create-client'
    );
    selfTestAssert($retriedRoom['roomId'] === $room['roomId'], 'Create retry made a second room.');
    expectHttpException(
        fn () => $store->createRoom(
            BannerTogetherRoomStore::hashCapability($otherGuestCapability),
            BannerTogetherRoomStore::hashCapability($joinCapability),
            'primary-room-request-key',
            'conflict-create-client'
        ),
        409,
        'idempotency_conflict'
    );

    $roomView = $store->getRoom($room['roomId'], $ownerCapability, 'owner-client');
    selfTestAssert($roomView['joined'] === false, 'New room was unexpectedly joined.');
    selfTestAssert($roomView['snapshots']['owner'] === null, 'New owner snapshot was not empty.');

    $joinResult = $store->joinRoom(
        $room['roomId'],
        $joinCapability,
        BannerTogetherRoomStore::hashCapability($guestCapability),
        'guest-client'
    );
    selfTestAssert($joinResult['claimed'] === true, 'Guest did not claim the room.');
    $repeatJoin = $store->joinRoom(
        $room['roomId'],
        $joinCapability,
        BannerTogetherRoomStore::hashCapability($guestCapability),
        'guest-client'
    );
    selfTestAssert($repeatJoin['claimed'] === false, 'Same guest join was not idempotent.');

    expectHttpException(
        fn () => $store->joinRoom(
            $room['roomId'],
            $joinCapability,
            BannerTogetherRoomStore::hashCapability($otherGuestCapability),
            'other-guest-client'
        ),
        409,
        'room_already_joined'
    );

    $envelope = [
        'version' => 1,
        'algorithm' => 'AES-256-GCM',
        'iv' => BannerTogetherRoomStore::encodeBase64Url(random_bytes(12)),
        'ciphertext' => BannerTogetherRoomStore::encodeBase64Url(
            random_bytes(BANNER_TOGETHER_SNAPSHOT_PADDING_BYTES + 16)
        ),
    ];
    $maximumEnvelope = $envelope;
    $maximumEnvelope['ciphertext'] = BannerTogetherRoomStore::encodeBase64Url(
        str_repeat("\0", BANNER_TOGETHER_MAX_CIPHERTEXT_BYTES)
    );
    BannerTogetherRoomStore::validateEnvelope($maximumEnvelope);
    $oversizedEnvelope = $envelope;
    $oversizedEnvelope['ciphertext'] = BannerTogetherRoomStore::encodeBase64Url(
        str_repeat("\0", BANNER_TOGETHER_MAX_CIPHERTEXT_BYTES + 1)
    );
    expectHttpException(
        fn () => BannerTogetherRoomStore::validateEnvelope($oversizedEnvelope),
        413,
        'envelope_too_large'
    );
    unset($maximumEnvelope, $oversizedEnvelope);
    $ownerUpdate = $store->updateSnapshot(
        $room['roomId'],
        'owner',
        $ownerCapability,
        0,
        $envelope,
        'owner-client'
    );
    selfTestAssert($ownerUpdate['sequence'] === 1, 'Owner snapshot sequence was not incremented.');

    $conflict = expectHttpException(
        fn () => $store->updateSnapshot(
            $room['roomId'],
            'owner',
            $ownerCapability,
            0,
            $envelope,
            'owner-client'
        ),
        409,
        'snapshot_conflict'
    );
    selfTestAssert(($conflict->details['currentSequence'] ?? null) === 1, 'Conflict sequence was missing.');

    $guestUpdate = $store->updateSnapshot(
        $room['roomId'],
        'guest',
        $guestCapability,
        0,
        $envelope,
        'guest-client'
    );
    selfTestAssert($guestUpdate['sequence'] === 1, 'Guest snapshot sequence was not incremented.');
    $guestView = $store->getRoom($room['roomId'], $guestCapability, 'guest-client');
    selfTestAssert($guestView['snapshots']['owner']['sequence'] === 1, 'Guest could not read owner snapshot.');
    selfTestAssert($guestView['snapshots']['guest']['sequence'] === 1, 'Guest could not read guest snapshot.');
    $storedRoom = file_get_contents($storageDirectory . '/rooms/' . $room['roomId'] . '.json');
    selfTestAssert(is_string($storedRoom), 'Stored room could not be inspected.');
    selfTestAssert(!str_contains($storedRoom, $ownerCapability), 'Raw owner capability was stored.');
    selfTestAssert(!str_contains($storedRoom, $joinCapability), 'Raw join capability was stored.');
    selfTestAssert(!str_contains($storedRoom, $guestCapability), 'Raw guest capability was stored.');
    selfTestAssert(
        !str_contains($storedRoom, 'primary-room-request-key'),
        'Raw idempotency key was stored.'
    );
    $storedQuotas = file_get_contents($storageDirectory . '/quotas.json');
    selfTestAssert(is_string($storedQuotas), 'Stored quotas could not be inspected.');
    selfTestAssert(!str_contains($storedQuotas, 'owner-client'), 'Raw client key was stored.');

    expectHttpException(
        fn () => $store->deleteRoom($room['roomId'], $guestCapability, 'guest-client'),
        401,
        'invalid_capability'
    );
    $store->deleteRoom($room['roomId'], $ownerCapability, 'owner-client');
    expectHttpException(
        fn () => $store->getRoom($room['roomId'], $ownerCapability, 'owner-client'),
        404,
        'room_not_found'
    );

    $expiringRoom = $store->createRoom(
        BannerTogetherRoomStore::hashCapability(BannerTogetherRoomStore::encodeBase64Url(random_bytes(32))),
        BannerTogetherRoomStore::hashCapability(BannerTogetherRoomStore::encodeBase64Url(random_bytes(32))),
        'expiring-room-request-key',
        'expiry-create-client'
    );
    $now += BANNER_TOGETHER_ROOM_TTL_SECONDS + 1;
    selfTestAssert($store->cleanupExpired() === 1, 'Expired room was not cleaned up.');
    selfTestAssert(
        !is_file($storageDirectory . '/rooms/' . $expiringRoom['roomId'] . '.json'),
        'Expired room file remains on disk.'
    );

    for ($index = 0; $index < 10; $index += 1) {
        $store->createRoom(
            BannerTogetherRoomStore::hashCapability(BannerTogetherRoomStore::encodeBase64Url(random_bytes(32))),
            BannerTogetherRoomStore::hashCapability(BannerTogetherRoomStore::encodeBase64Url(random_bytes(32))),
            'quota-room-request-' . $index,
            'quota-client'
        );
    }

    expectHttpException(
        fn () => $store->createRoom(
            BannerTogetherRoomStore::hashCapability(BannerTogetherRoomStore::encodeBase64Url(random_bytes(32))),
            BannerTogetherRoomStore::hashCapability(BannerTogetherRoomStore::encodeBase64Url(random_bytes(32))),
            'quota-room-request-over-limit',
            'quota-client'
        ),
        429,
        'rate_limited'
    );

    fwrite(STDOUT, "Banner Together room store self-test passed.\n");
} catch (Throwable $error) {
    fwrite(STDERR, 'Banner Together room store self-test failed: ' . $error->getMessage() . "\n");
    exit(1);
} finally {
    removeSelfTestDirectory($storageDirectory);
}
