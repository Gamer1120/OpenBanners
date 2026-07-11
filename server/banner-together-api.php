<?php

declare(strict_types=1);

require_once __DIR__ . '/banner-together-store.php';

const BANNER_TOGETHER_API_PREFIX = '/_openbanners/banner-together/v2/rooms';
const BANNER_TOGETHER_MAX_REQUEST_BYTES = 1000 * 1024;

header('Cache-Control: no-store, private, max-age=0');
header('Pragma: no-cache');
header('Referrer-Policy: no-referrer');
header('X-Content-Type-Options: nosniff');

function sendJson(array $value, int $statusCode = 200, array $headers = []): never
{
    http_response_code($statusCode);
    header('Content-Type: application/json; charset=utf-8');

    foreach ($headers as $name => $headerValue) {
        header($name . ': ' . $headerValue);
    }

    echo json_encode($value, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    exit;
}

function sendNoContent(int $statusCode = 204, array $headers = []): never
{
    http_response_code($statusCode);
    header_remove('Content-Type');

    foreach ($headers as $name => $headerValue) {
        header($name . ': ' . $headerValue);
    }

    exit;
}

function requestHeader(string $serverKey): ?string
{
    $value = $_SERVER[$serverKey] ?? null;
    return is_string($value) && $value !== '' ? $value : null;
}

function assertSameOriginRequest(): void
{
    $origin = requestHeader('HTTP_ORIGIN');
    $fetchSite = requestHeader('HTTP_SEC_FETCH_SITE');
    $allowedOrigins = [
        'https://openbanners.org',
        'https://www.openbanners.org',
        'https://test.openbanners.org',
    ];

    if ($fetchSite === 'cross-site' || ($origin !== null && !in_array($origin, $allowedOrigins, true))) {
        throw new BannerTogetherHttpException(
            403,
            'cross_origin_request',
            'Cross-origin Banner Together requests are not allowed.'
        );
    }
}

function requestClientKey(): string
{
    $forwardedAddress = requestHeader('HTTP_X_REAL_IP');
    $remoteAddress = requestHeader('REMOTE_ADDR');

    if (
        $forwardedAddress !== null
        && filter_var($forwardedAddress, FILTER_VALIDATE_IP) !== false
    ) {
        return $forwardedAddress;
    }

    if ($remoteAddress !== null && filter_var($remoteAddress, FILTER_VALIDATE_IP) !== false) {
        return $remoteAddress;
    }

    return 'unknown-client';
}

function requestBearerCapability(): string
{
    $authorization = requestHeader('HTTP_AUTHORIZATION');

    if (
        $authorization === null
        || preg_match('/^Bearer ([A-Za-z0-9_-]{43})$/D', $authorization, $matches) !== 1
    ) {
        throw new BannerTogetherHttpException(
            401,
            'invalid_capability',
            'A valid room capability is required.',
            ['WWW-Authenticate' => 'Bearer realm="Banner Together"']
        );
    }

    BannerTogetherRoomStore::decodeCapability($matches[1]);
    return $matches[1];
}

function requestIdempotencyKey(): string
{
    $value = requestHeader('HTTP_IDEMPOTENCY_KEY');

    if (
        $value === null
        || strlen($value) < 16
        || strlen($value) > 128
        || preg_match('/^[A-Za-z0-9_-]+$/D', $value) !== 1
    ) {
        throw new BannerTogetherHttpException(
            400,
            'invalid_idempotency_key',
            'A valid Idempotency-Key header is required.'
        );
    }

    return $value;
}

function readJsonRequest(array $expectedKeys): array
{
    $contentType = requestHeader('CONTENT_TYPE');

    if (
        $contentType === null
        || preg_match('/^application\/json(?:\s*;\s*charset=utf-8)?$/iD', $contentType) !== 1
    ) {
        throw new BannerTogetherHttpException(
            415,
            'unsupported_media_type',
            'Banner Together requests must use application/json.'
        );
    }

    $declaredLength = requestHeader('CONTENT_LENGTH');

    if (
        $declaredLength !== null
        && ctype_digit($declaredLength)
        && (int) $declaredLength > BANNER_TOGETHER_MAX_REQUEST_BYTES
    ) {
        throw new BannerTogetherHttpException(
            413,
            'request_too_large',
            'The Banner Together request exceeds the size limit.'
        );
    }

    $stream = fopen('php://input', 'rb');

    if ($stream === false) {
        throw new RuntimeException('Could not read the Banner Together request.');
    }

    $body = '';

    try {
        while (!feof($stream)) {
            $chunk = fread($stream, 8192);

            if ($chunk === false) {
                throw new RuntimeException('Could not read the Banner Together request.');
            }

            $body .= $chunk;

            if (strlen($body) > BANNER_TOGETHER_MAX_REQUEST_BYTES) {
                throw new BannerTogetherHttpException(
                    413,
                    'request_too_large',
                    'The Banner Together request exceeds the size limit.'
                );
            }
        }
    } finally {
        fclose($stream);
    }

    if ($body === '') {
        throw new BannerTogetherHttpException(400, 'invalid_json', 'A JSON body is required.');
    }

    try {
        $value = json_decode($body, true, 16, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        throw new BannerTogetherHttpException(400, 'invalid_json', 'The JSON body is invalid.');
    }

    if (!is_array($value) || array_is_list($value)) {
        throw new BannerTogetherHttpException(400, 'invalid_request', 'The request body is invalid.');
    }

    $actualKeys = array_keys($value);
    sort($actualKeys);
    sort($expectedKeys);

    if ($actualKeys !== $expectedKeys || ($value['version'] ?? null) !== BANNER_TOGETHER_ROOM_VERSION) {
        throw new BannerTogetherHttpException(400, 'invalid_request', 'The request body is invalid.');
    }

    return $value;
}

function requireStringField(array $body, string $field): string
{
    $value = $body[$field] ?? null;

    if (!is_string($value)) {
        throw new BannerTogetherHttpException(400, 'invalid_request', 'The request body is invalid.');
    }

    return $value;
}

function rejectRequestBody(): void
{
    $contentLength = requestHeader('CONTENT_LENGTH');

    if ($contentLength !== null && $contentLength !== '0') {
        throw new BannerTogetherHttpException(
            400,
            'unexpected_request_body',
            'This Banner Together request must not include a body.'
        );
    }
}

function rejectQueryString(): void
{
    $queryString = $_SERVER['QUERY_STRING'] ?? '';

    if (is_string($queryString) && $queryString !== '') {
        throw new BannerTogetherHttpException(
            400,
            'unexpected_query_string',
            'Banner Together capabilities must not be sent in the URL.'
        );
    }
}

function methodNotAllowed(array $allowedMethods): never
{
    throw new BannerTogetherHttpException(
        405,
        'method_not_allowed',
        'The request method is not allowed for this route.',
        ['Allow' => implode(', ', $allowedMethods)]
    );
}

function bannerTogetherStorageDirectory(): string
{
    $configuredMarkerPath = getenv('OPENBANNERS_BANNER_TOGETHER_MARKER_PATH');
    $markerPath = is_string($configuredMarkerPath) && $configuredMarkerPath !== ''
        ? $configuredMarkerPath
        : '/run/openbanners-banner-together-storage';
    $configuredPath = @file_get_contents($markerPath);

    if (!is_string($configuredPath) || trim($configuredPath) === '') {
        throw new BannerTogetherHttpException(
            503,
            'service_unavailable',
            'Banner Together rooms are not available yet.',
            ['Retry-After' => '300']
        );
    }

    return trim($configuredPath);
}

function dispatchBannerTogetherRequest(): never
{
    assertSameOriginRequest();
    rejectQueryString();

    $method = $_SERVER['REQUEST_METHOD'] ?? '';
    $requestUri = $_SERVER['ORIGINAL_REQUEST_URI'] ?? $_SERVER['REQUEST_URI'] ?? '';
    $path = is_string($requestUri) ? parse_url($requestUri, PHP_URL_PATH) : null;

    if (!is_string($path)) {
        throw new BannerTogetherHttpException(400, 'invalid_request_uri', 'The request URI is invalid.');
    }

    $store = new BannerTogetherRoomStore(bannerTogetherStorageDirectory());
    $clientKey = requestClientKey();

    if ($path === BANNER_TOGETHER_API_PREFIX) {
        if ($method !== 'POST') {
            methodNotAllowed(['POST']);
        }

        $body = readJsonRequest([
            'version',
            'ownerCapabilityHash',
            'joinCapabilityHash',
        ]);
        $room = $store->createRoom(
            requireStringField($body, 'ownerCapabilityHash'),
            requireStringField($body, 'joinCapabilityHash'),
            requestIdempotencyKey(),
            $clientKey
        );
        sendJson($room, 201, ['Location' => BANNER_TOGETHER_API_PREFIX . '/' . $room['roomId']]);
    }

    $quotedPrefix = preg_quote(BANNER_TOGETHER_API_PREFIX, '~');

    if (preg_match('~^' . $quotedPrefix . '/([A-Za-z0-9_-]{22})/join$~D', $path, $matches) === 1) {
        if ($method !== 'POST') {
            methodNotAllowed(['POST']);
        }

        $body = readJsonRequest(['version', 'guestCapabilityHash']);
        $store->joinRoom(
            $matches[1],
            requestBearerCapability(),
            requireStringField($body, 'guestCapabilityHash'),
            $clientKey
        );
        sendNoContent();
    }

    if (
        preg_match(
            '~^' . $quotedPrefix . '/([A-Za-z0-9_-]{22})/snapshots/(owner|guest)$~D',
            $path,
            $matches
        ) === 1
    ) {
        if ($method !== 'PUT') {
            methodNotAllowed(['PUT']);
        }

        $body = readJsonRequest(['version', 'expectedSequence', 'envelope']);
        $expectedSequence = $body['expectedSequence'] ?? null;
        $envelope = $body['envelope'] ?? null;

        if (!is_int($expectedSequence) || !is_array($envelope)) {
            throw new BannerTogetherHttpException(400, 'invalid_request', 'The request body is invalid.');
        }

        $result = $store->updateSnapshot(
            $matches[1],
            $matches[2],
            requestBearerCapability(),
            $expectedSequence,
            $envelope,
            $clientKey
        );
        sendJson($result);
    }

    if (preg_match('~^' . $quotedPrefix . '/([A-Za-z0-9_-]{22})$~D', $path, $matches) === 1) {
        if ($method === 'GET') {
            rejectRequestBody();
            sendJson($store->getRoom($matches[1], requestBearerCapability(), $clientKey));
        }

        if ($method === 'DELETE') {
            rejectRequestBody();
            $store->deleteRoom($matches[1], requestBearerCapability(), $clientKey);
            sendNoContent();
        }

        methodNotAllowed(['GET', 'DELETE']);
    }

    throw new BannerTogetherHttpException(404, 'not_found', 'Route not found.');
}

try {
    dispatchBannerTogetherRequest();
} catch (BannerTogetherHttpException $error) {
    $headers = $error->responseHeaders;

    if ($error->httpStatus === 401 && !array_key_exists('WWW-Authenticate', $headers)) {
        $headers['WWW-Authenticate'] = 'Bearer realm="Banner Together"';
    }

    sendJson(
        [
            'error' => [
                'code' => $error->errorCode,
                'message' => $error->getMessage(),
            ] + $error->details,
        ],
        $error->httpStatus,
        $headers
    );
} catch (Throwable $error) {
    error_log('Banner Together API failure: ' . $error->getMessage());
    sendJson(
        ['error' => ['code' => 'internal_error', 'message' => 'Banner Together is temporarily unavailable.']],
        500
    );
}
