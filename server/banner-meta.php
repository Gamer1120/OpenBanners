<?php

declare(strict_types=1);

const SITE_ORIGIN = 'https://openbanners.org';
const DEFAULT_TITLE = 'OpenBanners';
const DEFAULT_DESCRIPTION = 'An open-source front-end for banners';
const DEFAULT_IMAGE = SITE_ORIGIN . '/logo512.png';
const BANNERGRESS_IMAGE_ORIGIN = 'https://api.bannergress.com';
const INDEX_HTML_PATH = __DIR__ . '/../dist/index.html';
const CACHE_TTL_SECONDS = 900;

function sendHtml(string $html, int $statusCode = 200): never
{
    http_response_code($statusCode);
    header('Content-Type: text/html; charset=utf-8');
    echo $html;
    exit;
}

function loadIndexHtml(): string
{
    $html = @file_get_contents(INDEX_HTML_PATH);

    if ($html === false || $html === '') {
        sendHtml('OpenBanners shell not found.', 500);
    }

    return $html;
}

function escapeHtml(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function normalizeText(mixed $value): string
{
    return is_string($value) ? trim($value) : '';
}

function buildDescription(array $banner): string
{
    $missionCount = isset($banner['numberOfMissions']) ? (int) $banner['numberOfMissions'] : null;
    $lengthMeters = isset($banner['lengthMeters']) ? (float) $banner['lengthMeters'] : null;
    $formattedDistance = is_numeric($lengthMeters)
        ? round(($lengthMeters / 1000) * 10) / 10 . ' km'
        : '';
    $formattedMissions = is_numeric($missionCount)
        ? $missionCount . ' ' . ($missionCount === 1 ? 'Mission' : 'Missions')
        : '';
    $formattedAddress = normalizeText($banner['formattedAddress'] ?? null);

    $description = implode(', ', array_values(array_filter([
        $formattedMissions,
        $formattedDistance,
        $formattedAddress,
    ])));

    return $description !== '' ? $description : DEFAULT_DESCRIPTION;
}

function toAbsoluteImageUrl(mixed $value): string
{
    $value = normalizeText($value);

    if ($value === '') {
        return DEFAULT_IMAGE;
    }

    if (preg_match('~^https?://~i', $value) === 1) {
        return $value;
    }

    return BANNERGRESS_IMAGE_ORIGIN . '/' . ltrim($value, '/');
}

function bannerIdFromRequest(): ?string
{
    $requestUri = $_SERVER['ORIGINAL_REQUEST_URI'] ?? $_SERVER['REQUEST_URI'] ?? '';
    $path = parse_url($requestUri, PHP_URL_PATH);

    if (!is_string($path)) {
        return null;
    }

    if (preg_match('~^/banner/([^/?#]+)$~', $path, $matches) !== 1) {
        return null;
    }

    $bannerId = rawurldecode($matches[1]);

    return $bannerId !== '' ? $bannerId : null;
}

function cacheDirectory(): string
{
    $directory = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'openbanners-banner-meta-cache';

    if (!is_dir($directory)) {
        @mkdir($directory, 0775, true);
    }

    return $directory;
}

function cachePath(string $bannerId): string
{
    return cacheDirectory() . DIRECTORY_SEPARATOR . hash('sha256', $bannerId) . '.json';
}

function loadCachedBanner(string $bannerId, bool $allowStale = false): ?array
{
    $path = cachePath($bannerId);

    if (!is_file($path)) {
        return null;
    }

    $modifiedAt = @filemtime($path);

    if (!$allowStale && (!is_int($modifiedAt) || (time() - $modifiedAt) > CACHE_TTL_SECONDS)) {
        return null;
    }

    $json = @file_get_contents($path);

    if ($json === false || $json === '') {
        return null;
    }

    $data = json_decode($json, true);

    return is_array($data) ? $data : null;
}

function storeCachedBanner(string $bannerId, array $banner): void
{
    @file_put_contents(cachePath($bannerId), json_encode($banner, JSON_UNESCAPED_SLASHES));
}

function fetchBanner(string $bannerId): ?array
{
    $freshCache = loadCachedBanner($bannerId);

    if (is_array($freshCache)) {
        return $freshCache;
    }

    $url = 'https://api.bannergress.com/bnrs/' . rawurlencode($bannerId);
    $ch = curl_init($url);

    if ($ch === false) {
        return loadCachedBanner($bannerId, true);
    }

    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => 8,
        CURLOPT_USERAGENT => 'OpenBannersMeta/1.0',
        CURLOPT_HTTPHEADER => ['Accept: application/json'],
    ]);

    $body = curl_exec($ch);
    $statusCode = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);

    if (!is_string($body) || $body === '' || $statusCode !== 200) {
        return loadCachedBanner($bannerId, true);
    }

    $banner = json_decode($body, true);

    if (!is_array($banner) || normalizeText($banner['id'] ?? null) === '') {
        return loadCachedBanner($bannerId, true);
    }

    storeCachedBanner($bannerId, $banner);

    return $banner;
}

function injectMetadata(string $html, array $metadata): string
{
    $replacements = [
        '~<title>[\\s\\S]*?</title>~i' => '<title>' . escapeHtml($metadata['title']) . '</title>',
        '~<meta\\s+name="description"\\s+content="[\\s\\S]*?"\\s*/>~i' => '<meta name="description" content="' . escapeHtml($metadata['description']) . '" />',
        '~<meta\\s+property="og:type"\\s+content="[\\s\\S]*?"\\s*/>~i' => '<meta property="og:type" content="article" />',
        '~<meta\\s+property="og:title"\\s+content="[\\s\\S]*?"\\s*/>~i' => '<meta property="og:title" content="' . escapeHtml($metadata['title']) . '" />',
        '~<meta\\s+property="og:description"\\s+content="[\\s\\S]*?"\\s*/>~i' => '<meta property="og:description" content="' . escapeHtml($metadata['description']) . '" />',
        '~<meta\\s+property="og:url"\\s+content="[\\s\\S]*?"\\s*/>~i' => '<meta property="og:url" content="' . escapeHtml($metadata['url']) . '" />',
        '~<meta\\s+property="og:image"\\s+content="[\\s\\S]*?"\\s*/>~i' => '<meta property="og:image" content="' . escapeHtml($metadata['image']) . '" />',
        '~<meta\\s+name="twitter:title"\\s+content="[\\s\\S]*?"\\s*/>~i' => '<meta name="twitter:title" content="' . escapeHtml($metadata['title']) . '" />',
        '~<meta\\s+name="twitter:description"\\s+content="[\\s\\S]*?"\\s*/>~i' => '<meta name="twitter:description" content="' . escapeHtml($metadata['description']) . '" />',
        '~<meta\\s+name="twitter:image"\\s+content="[\\s\\S]*?"\\s*/>~i' => '<meta name="twitter:image" content="' . escapeHtml($metadata['image']) . '" />',
        '~<link\\s+rel="canonical"\\s+href="[\\s\\S]*?"\\s*/>~i' => '<link rel="canonical" href="' . escapeHtml($metadata['url']) . '" />',
    ];

    foreach ($replacements as $pattern => $replacement) {
        $html = (string) preg_replace($pattern, $replacement, $html, 1);
    }

    return $html;
}

$html = loadIndexHtml();
$bannerId = bannerIdFromRequest();

if ($bannerId === null) {
    sendHtml($html);
}

$banner = fetchBanner($bannerId);

if (!is_array($banner)) {
    sendHtml($html);
}

$title = normalizeText($banner['title'] ?? null);
$title = $title !== '' ? $title : DEFAULT_TITLE;
$description = buildDescription($banner);
$canonicalBannerId = normalizeText($banner['id'] ?? null);
$canonicalBannerId = $canonicalBannerId !== '' ? $canonicalBannerId : $bannerId;
$url = SITE_ORIGIN . '/banner/' . rawurlencode($canonicalBannerId);
$image = toAbsoluteImageUrl($banner['picture'] ?? null);

sendHtml(injectMetadata($html, [
    'title' => $title,
    'description' => $description,
    'url' => $url,
    'image' => $image,
]));
