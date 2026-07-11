<?php

declare(strict_types=1);

const BANNER_TOGETHER_ROOM_VERSION = 2;
const BANNER_TOGETHER_ENVELOPE_VERSION = 1;
const BANNER_TOGETHER_ROOM_TTL_SECONDS = 7 * 24 * 60 * 60;
const BANNER_TOGETHER_CLEANUP_INTERVAL_SECONDS = 5 * 60;
const BANNER_TOGETHER_MAX_ACTIVE_ROOMS = 20000;
const BANNER_TOGETHER_MAX_GLOBAL_ROOM_BYTES = 256 * 1024 * 1024;
const BANNER_TOGETHER_MAX_ROOM_FILE_BYTES = 1700 * 1024;
const BANNER_TOGETHER_SNAPSHOT_PADDING_BYTES = 64 * 1024;
const BANNER_TOGETHER_MAX_CIPHERTEXT_BYTES = (512 + 64) * 1024 + 16;
const BANNER_TOGETHER_MAX_ENCODED_VALUE_BYTES = 1024 * 1024;

final class BannerTogetherHttpException extends RuntimeException
{
    public function __construct(
        public readonly int $httpStatus,
        public readonly string $errorCode,
        string $message,
        public readonly array $responseHeaders = [],
        public readonly array $details = [],
    ) {
        parent::__construct($message);
    }
}

final class BannerTogetherRoomStore
{
    private const ROOM_ID_BYTES = 16;
    private const CAPABILITY_BYTES = 32;

    private const QUOTAS = [
        'create' => ['window' => 3600, 'perClient' => 10, 'global' => 100],
        'join' => ['window' => 3600, 'perClient' => 30, 'global' => 500],
        'read' => ['window' => 600, 'perClient' => 300, 'global' => 3000],
        'write' => ['window' => 3600, 'perClient' => 120, 'global' => 2000],
    ];

    private string $roomsDirectory;
    private string $lockPath;
    private string $quotaPath;
    private string $quotaSecretPath;
    private string $cleanupStatePath;
    private Closure $clock;

    public function __construct(private readonly string $storageDirectory, ?callable $clock = null)
    {
        if ($storageDirectory === '' || !str_starts_with($storageDirectory, DIRECTORY_SEPARATOR)) {
            throw new RuntimeException('Banner Together storage path must be absolute.');
        }

        $this->roomsDirectory = $storageDirectory . DIRECTORY_SEPARATOR . 'rooms';
        $this->lockPath = $storageDirectory . DIRECTORY_SEPARATOR . 'store.lock';
        $this->quotaPath = $storageDirectory . DIRECTORY_SEPARATOR . 'quotas.json';
        $this->quotaSecretPath = $storageDirectory . DIRECTORY_SEPARATOR . 'quota-secret';
        $this->cleanupStatePath = $storageDirectory . DIRECTORY_SEPARATOR . 'cleanup-state';
        $this->clock = $clock !== null
            ? Closure::fromCallable($clock)
            : static fn (): int => time();

        $this->ensureDirectory($storageDirectory);
        $this->ensureDirectory($this->roomsDirectory);
    }

    public static function encodeBase64Url(string $bytes): string
    {
        return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
    }

    public static function decodeCapability(string $value): string
    {
        return self::decodeFixedBase64Url($value, self::CAPABILITY_BYTES, 'Capability');
    }

    public static function validateCapabilityHash(string $value): string
    {
        self::decodeFixedBase64Url($value, self::CAPABILITY_BYTES, 'Capability hash');
        return $value;
    }

    public static function hashCapability(string $rawCapability): string
    {
        $bytes = self::decodeCapability($rawCapability);
        return self::encodeBase64Url(hash('sha256', $bytes, true));
    }

    public static function validateRoomId(string $roomId): string
    {
        self::decodeFixedBase64Url($roomId, self::ROOM_ID_BYTES, 'Room ID');
        return $roomId;
    }

    public static function validateEnvelope(mixed $value): array
    {
        if (!is_array($value) || !self::hasExactKeys($value, [
            'version',
            'algorithm',
            'iv',
            'ciphertext',
        ])) {
            throw new BannerTogetherHttpException(
                400,
                'invalid_envelope',
                'The encrypted snapshot envelope is invalid.'
            );
        }

        if (
            $value['version'] !== BANNER_TOGETHER_ENVELOPE_VERSION
            || $value['algorithm'] !== 'AES-256-GCM'
        ) {
            throw new BannerTogetherHttpException(
                400,
                'invalid_envelope',
                'The encrypted snapshot envelope is unsupported.'
            );
        }

        self::decodeFixedBase64Url($value['iv'], 12, 'Envelope IV');
        $ciphertext = self::decodeBase64Url($value['ciphertext'], 'Envelope ciphertext');

        if (strlen($ciphertext) > BANNER_TOGETHER_MAX_CIPHERTEXT_BYTES) {
            throw new BannerTogetherHttpException(
                413,
                'envelope_too_large',
                'The encrypted snapshot exceeds the size limit.'
            );
        }

        if (
            strlen($ciphertext) < BANNER_TOGETHER_SNAPSHOT_PADDING_BYTES + 16
            || (strlen($ciphertext) - 16) % BANNER_TOGETHER_SNAPSHOT_PADDING_BYTES !== 0
        ) {
            throw new BannerTogetherHttpException(
                400,
                'invalid_envelope',
                'The encrypted snapshot envelope has an invalid padded size.'
            );
        }

        return [
            'version' => BANNER_TOGETHER_ENVELOPE_VERSION,
            'algorithm' => 'AES-256-GCM',
            'iv' => $value['iv'],
            'ciphertext' => $value['ciphertext'],
        ];
    }

    public function createRoom(
        string $ownerCapabilityHash,
        string $joinCapabilityHash,
        string $idempotencyKey,
        string $clientKey
    ): array {
        self::validateCapabilityHash($ownerCapabilityHash);
        self::validateCapabilityHash($joinCapabilityHash);
        $idempotencyKeyHash = self::hashIdempotencyKey($idempotencyKey);

        if (hash_equals($ownerCapabilityHash, $joinCapabilityHash)) {
            throw new BannerTogetherHttpException(
                400,
                'duplicate_capabilities',
                'Owner and join capabilities must be different.'
            );
        }

        return $this->withExclusiveLock(function () use (
            $ownerCapabilityHash,
            $joinCapabilityHash,
            $idempotencyKeyHash,
            $clientKey
        ): array {
            $now = $this->now();
            $this->consumeQuotaLocked('create', $clientKey, $now);
            $this->maybeCleanupExpiredLocked($now);

            $existingRoom = $this->findRoomByIdempotencyKeyLocked(
                $idempotencyKeyHash,
                $now
            );

            if (is_array($existingRoom)) {
                if (
                    !hash_equals($existingRoom['ownerCapabilityHash'], $ownerCapabilityHash)
                    || !hash_equals($existingRoom['joinCapabilityHash'], $joinCapabilityHash)
                ) {
                    throw new BannerTogetherHttpException(
                        409,
                        'idempotency_conflict',
                        'The idempotency key was already used for a different room.'
                    );
                }

                return $this->publicRoomMetadata($existingRoom);
            }

            $roomFiles = $this->roomFiles();

            if (count($roomFiles) >= BANNER_TOGETHER_MAX_ACTIVE_ROOMS) {
                throw new BannerTogetherHttpException(
                    503,
                    'room_capacity_reached',
                    'Banner Together room capacity has been reached.',
                    ['Retry-After' => '300']
                );
            }

            for ($attempt = 0; $attempt < 5; $attempt += 1) {
                $roomId = self::encodeBase64Url(random_bytes(self::ROOM_ID_BYTES));

                if (!is_file($this->roomPath($roomId))) {
                    $room = [
                        'version' => BANNER_TOGETHER_ROOM_VERSION,
                        'roomId' => $roomId,
                        'createdAt' => $now,
                        'expiresAt' => $now + BANNER_TOGETHER_ROOM_TTL_SECONDS,
                        'idempotencyKeyHash' => $idempotencyKeyHash,
                        'ownerCapabilityHash' => $ownerCapabilityHash,
                        'joinCapabilityHash' => $joinCapabilityHash,
                        'guestCapabilityHash' => null,
                        'ownerSnapshot' => null,
                        'guestSnapshot' => null,
                    ];
                    $this->writeRoomLocked($room, null);

                    return $this->publicRoomMetadata($room);
                }
            }

            throw new RuntimeException('Could not allocate a unique Banner Together room ID.');
        });
    }

    public function joinRoom(
        string $roomId,
        string $joinCapability,
        string $guestCapabilityHash,
        string $clientKey
    ): array {
        self::validateRoomId($roomId);
        $joinCapabilityHash = self::hashCapability($joinCapability);
        self::validateCapabilityHash($guestCapabilityHash);

        return $this->withExclusiveLock(function () use (
            $roomId,
            $joinCapabilityHash,
            $guestCapabilityHash,
            $clientKey
        ): array {
            $now = $this->now();
            $this->consumeQuotaLocked('join', $clientKey, $now);
            $this->maybeCleanupExpiredLocked($now);
            $room = $this->loadActiveRoomLocked($roomId, $now);

            if (!hash_equals($room['joinCapabilityHash'], $joinCapabilityHash)) {
                throw new BannerTogetherHttpException(
                    401,
                    'invalid_capability',
                    'The room capability is invalid.'
                );
            }

            if ($room['guestCapabilityHash'] !== null) {
                if (hash_equals($room['guestCapabilityHash'], $guestCapabilityHash)) {
                    return ['claimed' => false] + $this->publicRoomMetadata($room);
                }

                throw new BannerTogetherHttpException(
                    409,
                    'room_already_joined',
                    'This room has already been joined.'
                );
            }

            if (
                hash_equals($room['ownerCapabilityHash'], $guestCapabilityHash)
                || hash_equals($room['joinCapabilityHash'], $guestCapabilityHash)
            ) {
                throw new BannerTogetherHttpException(
                    400,
                    'duplicate_capabilities',
                    'The guest capability must be unique.'
                );
            }

            $oldPath = $this->roomPath($roomId);
            $oldSize = filesize($oldPath);
            $room['guestCapabilityHash'] = $guestCapabilityHash;
            $this->writeRoomLocked($room, is_int($oldSize) ? $oldSize : null);

            return ['claimed' => true] + $this->publicRoomMetadata($room);
        });
    }

    public function getRoom(string $roomId, string $capability, string $clientKey): array
    {
        self::validateRoomId($roomId);
        $capabilityHash = self::hashCapability($capability);

        return $this->withExclusiveLock(function () use (
            $roomId,
            $capabilityHash,
            $clientKey
        ): array {
            $now = $this->now();
            $this->consumeQuotaLocked('read', $clientKey, $now);
            $this->maybeCleanupExpiredLocked($now);
            $room = $this->loadActiveRoomLocked($roomId, $now);
            $this->assertRoomMember($room, $capabilityHash);

            return [
                'version' => BANNER_TOGETHER_ROOM_VERSION,
                'roomId' => $room['roomId'],
                'expiresAt' => self::formatTimestamp($room['expiresAt']),
                'joined' => $room['guestCapabilityHash'] !== null,
                'snapshots' => [
                    'owner' => $this->publicSnapshot($room['ownerSnapshot']),
                    'guest' => $this->publicSnapshot($room['guestSnapshot']),
                ],
            ];
        });
    }

    public function updateSnapshot(
        string $roomId,
        string $role,
        string $capability,
        int $expectedSequence,
        array $envelope,
        string $clientKey
    ): array {
        self::validateRoomId($roomId);

        if (!in_array($role, ['owner', 'guest'], true)) {
            throw new BannerTogetherHttpException(404, 'not_found', 'Route not found.');
        }

        if ($expectedSequence < 0 || $expectedSequence > 2147483646) {
            throw new BannerTogetherHttpException(
                400,
                'invalid_sequence',
                'The expected snapshot sequence is invalid.'
            );
        }

        $capabilityHash = self::hashCapability($capability);

        return $this->withExclusiveLock(function () use (
            $roomId,
            $role,
            $capabilityHash,
            $expectedSequence,
            $envelope,
            $clientKey
        ): array {
            $now = $this->now();
            $this->consumeQuotaLocked('write', $clientKey, $now);
            $this->maybeCleanupExpiredLocked($now);
            $room = $this->loadActiveRoomLocked($roomId, $now);
            $expectedCapabilityHash = $role === 'owner'
                ? $room['ownerCapabilityHash']
                : $room['guestCapabilityHash'];

            if (
                !is_string($expectedCapabilityHash)
                || !hash_equals($expectedCapabilityHash, $capabilityHash)
            ) {
                throw new BannerTogetherHttpException(
                    401,
                    'invalid_capability',
                    'The room capability is invalid.'
                );
            }

            $snapshotKey = $role . 'Snapshot';
            $currentSequence = is_array($room[$snapshotKey])
                ? $room[$snapshotKey]['sequence']
                : 0;

            if ($currentSequence !== $expectedSequence) {
                throw new BannerTogetherHttpException(
                    409,
                    'snapshot_conflict',
                    'The snapshot changed before this update was stored.',
                    [],
                    ['currentSequence' => $currentSequence]
                );
            }

            $normalizedEnvelope = self::validateEnvelope($envelope);

            $oldPath = $this->roomPath($roomId);
            $oldSize = filesize($oldPath);
            $room[$snapshotKey] = [
                'sequence' => $currentSequence + 1,
                'updatedAt' => $now,
                'envelope' => $normalizedEnvelope,
            ];
            $this->writeRoomLocked($room, is_int($oldSize) ? $oldSize : null);

            return [
                'version' => BANNER_TOGETHER_ROOM_VERSION,
                'role' => $role,
                'sequence' => $currentSequence + 1,
                'updatedAt' => self::formatTimestamp($now),
            ];
        });
    }

    public function deleteRoom(string $roomId, string $ownerCapability, string $clientKey): void
    {
        self::validateRoomId($roomId);
        $ownerCapabilityHash = self::hashCapability($ownerCapability);

        $this->withExclusiveLock(function () use (
            $roomId,
            $ownerCapabilityHash,
            $clientKey
        ): void {
            $now = $this->now();
            $this->consumeQuotaLocked('write', $clientKey, $now);
            $this->maybeCleanupExpiredLocked($now);
            $room = $this->loadActiveRoomLocked($roomId, $now);

            if (!hash_equals($room['ownerCapabilityHash'], $ownerCapabilityHash)) {
                throw new BannerTogetherHttpException(
                    401,
                    'invalid_capability',
                    'The room capability is invalid.'
                );
            }

            if (!unlink($this->roomPath($roomId))) {
                throw new RuntimeException('Could not revoke the Banner Together room.');
            }
        });
    }

    public function cleanupExpired(): int
    {
        return $this->withExclusiveLock(
            fn (): int => $this->cleanupExpiredLocked($this->now())
        );
    }

    private function ensureDirectory(string $directory): void
    {
        if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) {
            throw new RuntimeException('Could not create Banner Together storage.');
        }

        if (!is_writable($directory)) {
            throw new RuntimeException('Banner Together storage is not writable.');
        }
    }

    private function now(): int
    {
        $now = ($this->clock)();

        if (!is_int($now) || $now < 0) {
            throw new RuntimeException('Banner Together clock returned an invalid time.');
        }

        return $now;
    }

    private function withExclusiveLock(callable $callback): mixed
    {
        $handle = fopen($this->lockPath, 'c+');

        if ($handle === false) {
            throw new RuntimeException('Could not open the Banner Together storage lock.');
        }

        @chmod($this->lockPath, 0600);

        try {
            if (!flock($handle, LOCK_EX)) {
                throw new RuntimeException('Could not lock Banner Together storage.');
            }

            return $callback();
        } finally {
            flock($handle, LOCK_UN);
            fclose($handle);
        }
    }

    private function cleanupExpiredLocked(int $now): int
    {
        $removedCount = 0;

        foreach ($this->roomFiles() as $path) {
            $remove = false;

            try {
                $serialized = file_get_contents($path);

                if (
                    $serialized === false
                    || strlen($serialized) > BANNER_TOGETHER_MAX_ROOM_FILE_BYTES
                ) {
                    $remove = true;
                } else {
                    $room = json_decode($serialized, true, 16, JSON_THROW_ON_ERROR);
                    $remove = !is_array($room)
                        || !is_int($room['expiresAt'] ?? null)
                        || $room['expiresAt'] <= $now;
                }
            } catch (JsonException) {
                $remove = true;
            }

            if ($remove && @unlink($path)) {
                $removedCount += 1;
            }
        }

        $this->writeSerializedAtomically($this->cleanupStatePath, (string) $now);

        return $removedCount;
    }

    private function maybeCleanupExpiredLocked(int $now): void
    {
        $lastCleanupAt = 0;

        if (is_file($this->cleanupStatePath)) {
            $storedValue = file_get_contents($this->cleanupStatePath);

            if (is_string($storedValue) && ctype_digit($storedValue)) {
                $lastCleanupAt = (int) $storedValue;
            }
        }

        if (
            $lastCleanupAt <= $now
            && $now - $lastCleanupAt < BANNER_TOGETHER_CLEANUP_INTERVAL_SECONDS
        ) {
            return;
        }

        $this->cleanupExpiredLocked($now);
    }

    private function consumeQuotaLocked(string $action, string $clientKey, int $now): void
    {
        $quota = self::QUOTAS[$action] ?? null;

        if (!is_array($quota)) {
            throw new RuntimeException('Unknown Banner Together quota action.');
        }

        $state = $this->loadQuotaStateLocked();

        foreach ($state['buckets'] as $storedAction => $storedBucket) {
            $storedQuota = self::QUOTAS[$storedAction] ?? null;
            $storedWindowStart = is_array($storedBucket)
                ? ($storedBucket['windowStart'] ?? null)
                : null;

            if (
                !is_array($storedQuota)
                || !is_int($storedWindowStart)
                || $storedWindowStart + $storedQuota['window'] <= $now
            ) {
                unset($state['buckets'][$storedAction]);
            }
        }

        $windowStart = intdiv($now, $quota['window']) * $quota['window'];
        $bucket = $state['buckets'][$action] ?? null;

        if (!is_array($bucket) || ($bucket['windowStart'] ?? null) !== $windowStart) {
            $bucket = [
                'windowStart' => $windowStart,
                'globalCount' => 0,
                'clientCounts' => [],
            ];
        }

        $normalizedClientKey = hash_hmac(
            'sha256',
            $action . "\0" . $windowStart . "\0" . $clientKey,
            $this->loadQuotaSecretLocked()
        );
        $clientCount = (int) ($bucket['clientCounts'][$normalizedClientKey] ?? 0);
        $globalCount = (int) ($bucket['globalCount'] ?? 0);
        $retryAfter = max(1, ($windowStart + $quota['window']) - $now);

        if ($clientCount >= $quota['perClient'] || $globalCount >= $quota['global']) {
            throw new BannerTogetherHttpException(
                429,
                'rate_limited',
                'Too many Banner Together requests. Try again later.',
                ['Retry-After' => (string) $retryAfter]
            );
        }

        $bucket['clientCounts'][$normalizedClientKey] = $clientCount + 1;
        $bucket['globalCount'] = $globalCount + 1;
        $state['buckets'][$action] = $bucket;
        $this->writeJsonAtomically($this->quotaPath, $state);
    }

    private function loadQuotaStateLocked(): array
    {
        if (!is_file($this->quotaPath)) {
            return ['version' => 1, 'buckets' => []];
        }

        try {
            $serialized = file_get_contents($this->quotaPath);
            $state = is_string($serialized)
                ? json_decode($serialized, true, 16, JSON_THROW_ON_ERROR)
                : null;

            if (
                !is_array($state)
                || ($state['version'] ?? null) !== 1
                || !is_array($state['buckets'] ?? null)
            ) {
                throw new RuntimeException('Banner Together quota state is corrupt.');
            }

            return $state;
        } catch (JsonException $error) {
            throw new RuntimeException('Banner Together quota state is corrupt.', 0, $error);
        }
    }

    private function loadQuotaSecretLocked(): string
    {
        if (is_file($this->quotaSecretPath)) {
            $secret = file_get_contents($this->quotaSecretPath);

            if (is_string($secret) && strlen($secret) === 32) {
                return $secret;
            }

            throw new RuntimeException('Banner Together quota secret is corrupt.');
        }

        $secret = random_bytes(32);
        $this->writeSerializedAtomically($this->quotaSecretPath, $secret);
        return $secret;
    }

    private function loadActiveRoomLocked(string $roomId, int $now): array
    {
        $path = $this->roomPath($roomId);

        if (!is_file($path)) {
            throw new BannerTogetherHttpException(404, 'room_not_found', 'Room not found.');
        }

        $serialized = file_get_contents($path);

        if (
            $serialized === false
            || strlen($serialized) > BANNER_TOGETHER_MAX_ROOM_FILE_BYTES
        ) {
            throw new RuntimeException('Banner Together room data is corrupt.');
        }

        try {
            $room = json_decode($serialized, true, 16, JSON_THROW_ON_ERROR);
        } catch (JsonException $error) {
            throw new RuntimeException('Banner Together room data is corrupt.', 0, $error);
        }

        $room = $this->validateStoredRoom($room, $roomId);

        if ($room['expiresAt'] <= $now) {
            @unlink($path);
            throw new BannerTogetherHttpException(404, 'room_not_found', 'Room not found.');
        }

        return $room;
    }

    private function validateStoredRoom(mixed $room, string $roomId): array
    {
        $expectedKeys = [
            'version',
            'roomId',
            'createdAt',
            'expiresAt',
            'idempotencyKeyHash',
            'ownerCapabilityHash',
            'joinCapabilityHash',
            'guestCapabilityHash',
            'ownerSnapshot',
            'guestSnapshot',
        ];

        if (!is_array($room) || !self::hasExactKeys($room, $expectedKeys)) {
            throw new RuntimeException('Banner Together room data is corrupt.');
        }

        try {
            if (
                $room['version'] !== BANNER_TOGETHER_ROOM_VERSION
                || self::validateRoomId($room['roomId']) !== $roomId
                || !is_int($room['createdAt'])
                || !is_int($room['expiresAt'])
                || $room['createdAt'] > $room['expiresAt']
            ) {
                throw new RuntimeException('Banner Together room data is corrupt.');
            }

            self::validateCapabilityHash($room['ownerCapabilityHash']);
            self::validateCapabilityHash($room['joinCapabilityHash']);
            self::validateCapabilityHash($room['idempotencyKeyHash']);

            if ($room['guestCapabilityHash'] !== null) {
                self::validateCapabilityHash($room['guestCapabilityHash']);
            }

            $this->validateStoredSnapshot($room['ownerSnapshot']);
            $this->validateStoredSnapshot($room['guestSnapshot']);
        } catch (BannerTogetherHttpException $error) {
            throw new RuntimeException('Banner Together room data is corrupt.', 0, $error);
        }

        return $room;
    }

    private function validateStoredSnapshot(mixed $snapshot): void
    {
        if ($snapshot === null) {
            return;
        }

        if (
            !is_array($snapshot)
            || !self::hasExactKeys($snapshot, ['sequence', 'updatedAt', 'envelope'])
            || !is_int($snapshot['sequence'])
            || $snapshot['sequence'] < 1
            || !is_int($snapshot['updatedAt'])
        ) {
            throw new RuntimeException('Banner Together snapshot data is corrupt.');
        }

        self::validateEnvelope($snapshot['envelope']);
    }

    private function assertRoomMember(array $room, string $capabilityHash): void
    {
        if (hash_equals($room['ownerCapabilityHash'], $capabilityHash)) {
            return;
        }

        if (
            is_string($room['guestCapabilityHash'])
            && hash_equals($room['guestCapabilityHash'], $capabilityHash)
        ) {
            return;
        }

        throw new BannerTogetherHttpException(
            401,
            'invalid_capability',
            'The room capability is invalid.'
        );
    }

    private function findRoomByIdempotencyKeyLocked(string $keyHash, int $now): ?array
    {
        foreach ($this->roomFiles() as $path) {
            $serialized = file_get_contents($path);

            if (
                !is_string($serialized)
                || strlen($serialized) > BANNER_TOGETHER_MAX_ROOM_FILE_BYTES
            ) {
                continue;
            }

            try {
                $room = json_decode($serialized, true, 16, JSON_THROW_ON_ERROR);
            } catch (JsonException) {
                continue;
            }

            $storedHash = is_array($room) ? ($room['idempotencyKeyHash'] ?? null) : null;

            if (!is_string($storedHash) || !hash_equals($storedHash, $keyHash)) {
                continue;
            }

            $storedRoomId = $room['roomId'] ?? null;
            $pathRoomId = pathinfo($path, PATHINFO_FILENAME);

            if (!is_string($storedRoomId) || !is_string($pathRoomId)) {
                throw new RuntimeException('Banner Together room data is corrupt.');
            }

            $room = $this->validateStoredRoom($room, $pathRoomId);

            if ($room['expiresAt'] <= $now) {
                @unlink($path);
                return null;
            }

            return $room;
        }

        return null;
    }

    private function writeRoomLocked(array $room, ?int $previousRoomSize): void
    {
        $serialized = $this->encodeJson($room);

        if (strlen($serialized) > BANNER_TOGETHER_MAX_ROOM_FILE_BYTES) {
            throw new BannerTogetherHttpException(
                413,
                'room_too_large',
                'The encrypted room data exceeds the size limit.'
            );
        }

        $currentBytes = 0;

        foreach ($this->roomFiles() as $path) {
            $size = filesize($path);

            if (is_int($size)) {
                $currentBytes += $size;
            }
        }

        $projectedBytes = $currentBytes - ($previousRoomSize ?? 0) + strlen($serialized);

        if ($projectedBytes > BANNER_TOGETHER_MAX_GLOBAL_ROOM_BYTES) {
            throw new BannerTogetherHttpException(
                503,
                'storage_capacity_reached',
                'Banner Together storage capacity has been reached.',
                ['Retry-After' => '300']
            );
        }

        $this->writeSerializedAtomically($this->roomPath($room['roomId']), $serialized);
    }

    private function writeJsonAtomically(string $path, array $value): void
    {
        $this->writeSerializedAtomically($path, $this->encodeJson($value));
    }

    private function writeSerializedAtomically(string $path, string $serialized): void
    {
        $temporaryPath = tempnam(dirname($path), '.openbanners-room-');

        if ($temporaryPath === false) {
            throw new RuntimeException('Could not create a Banner Together temporary file.');
        }

        @chmod($temporaryPath, 0600);

        try {
            $handle = fopen($temporaryPath, 'wb');

            if ($handle === false) {
                throw new RuntimeException('Could not open a Banner Together temporary file.');
            }

            try {
                $offset = 0;
                $length = strlen($serialized);

                while ($offset < $length) {
                    $written = fwrite($handle, substr($serialized, $offset));

                    if ($written === false || $written === 0) {
                        throw new RuntimeException('Could not write Banner Together data.');
                    }

                    $offset += $written;
                }

                if (!fflush($handle)) {
                    throw new RuntimeException('Could not flush Banner Together data.');
                }

                if (function_exists('fsync') && !fsync($handle)) {
                    throw new RuntimeException('Could not sync Banner Together data.');
                }
            } finally {
                fclose($handle);
            }

            if (!rename($temporaryPath, $path)) {
                throw new RuntimeException('Could not commit Banner Together data.');
            }
        } finally {
            if (is_file($temporaryPath)) {
                @unlink($temporaryPath);
            }
        }
    }

    private function roomFiles(): array
    {
        $files = glob($this->roomsDirectory . DIRECTORY_SEPARATOR . '*.json');
        return is_array($files) ? $files : [];
    }

    private function roomPath(string $roomId): string
    {
        return $this->roomsDirectory . DIRECTORY_SEPARATOR . $roomId . '.json';
    }

    private function publicRoomMetadata(array $room): array
    {
        return [
            'version' => BANNER_TOGETHER_ROOM_VERSION,
            'roomId' => $room['roomId'],
            'expiresAt' => self::formatTimestamp($room['expiresAt']),
        ];
    }

    private function publicSnapshot(mixed $snapshot): ?array
    {
        if (!is_array($snapshot)) {
            return null;
        }

        return [
            'sequence' => $snapshot['sequence'],
            'updatedAt' => self::formatTimestamp($snapshot['updatedAt']),
            'envelope' => $snapshot['envelope'],
        ];
    }

    private function encodeJson(array $value): string
    {
        return json_encode($value, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }

    private static function formatTimestamp(int $timestamp): string
    {
        return gmdate('Y-m-d\TH:i:s.000\Z', $timestamp);
    }

    private static function hashIdempotencyKey(string $value): string
    {
        if (
            strlen($value) < 16
            || strlen($value) > 128
            || preg_match('/^[A-Za-z0-9_-]+$/D', $value) !== 1
        ) {
            throw new BannerTogetherHttpException(
                400,
                'invalid_idempotency_key',
                'The room idempotency key is invalid.'
            );
        }

        return self::encodeBase64Url(hash('sha256', $value, true));
    }

    private static function decodeFixedBase64Url(
        mixed $value,
        int $expectedBytes,
        string $label
    ): string {
        $decoded = self::decodeBase64Url($value, $label);

        if (strlen($decoded) !== $expectedBytes) {
            throw new BannerTogetherHttpException(
                400,
                'invalid_identifier',
                $label . ' has an invalid length.'
            );
        }

        return $decoded;
    }

    private static function decodeBase64Url(mixed $value, string $label): string
    {
        if (
            !is_string($value)
            || $value === ''
            || strlen($value) > BANNER_TOGETHER_MAX_ENCODED_VALUE_BYTES
            || preg_match('/^[A-Za-z0-9_-]+$/D', $value) !== 1
            || strlen($value) % 4 === 1
        ) {
            throw new BannerTogetherHttpException(
                400,
                'invalid_identifier',
                $label . ' is not valid base64url data.'
            );
        }

        $paddingLength = (4 - (strlen($value) % 4)) % 4;
        $decoded = base64_decode(
            strtr($value, '-_', '+/') . str_repeat('=', $paddingLength),
            true
        );

        if ($decoded === false || self::encodeBase64Url($decoded) !== $value) {
            throw new BannerTogetherHttpException(
                400,
                'invalid_identifier',
                $label . ' is not canonical base64url data.'
            );
        }

        return $decoded;
    }

    private static function hasExactKeys(array $value, array $expectedKeys): bool
    {
        $actualKeys = array_keys($value);
        sort($actualKeys);
        sort($expectedKeys);
        return $actualKeys === $expectedKeys;
    }
}
