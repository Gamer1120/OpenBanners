<?php

declare(strict_types=1);

const BOARD_SIZE = 25;
const FREE_INDEX = 12;
const DEFAULT_STATE_PATH = '/var/lib/openbanners/train-bingo-state.json';

function sendJson(array $data, int $statusCode = 200): never
{
    http_response_code($statusCode);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_SLASHES);
    exit;
}

function createInitialSquares(): array
{
    $squares = array_fill(0, BOARD_SIZE, 'empty');
    $squares[FREE_INDEX] = 'free';

    return $squares;
}

function createInitialState(int $version = 1): array
{
    return [
        'version' => $version,
        'updatedAt' => gmdate('c'),
        'squares' => createInitialSquares(),
    ];
}

function normalizeSquares(mixed $value): array
{
    if (!is_array($value) || count($value) !== BOARD_SIZE) {
        return createInitialSquares();
    }

    $validStates = ['empty' => true, 'green' => true, 'red' => true];

    return array_map(
        static function (mixed $state, int $index) use ($validStates): string {
            if ($index === FREE_INDEX) {
                return 'free';
            }

            return is_string($state) && isset($validStates[$state]) ? $state : 'empty';
        },
        $value,
        array_keys($value)
    );
}

function normalizeState(mixed $value): array
{
    if (!is_array($value)) {
        return createInitialState();
    }

    $version = isset($value['version']) && is_int($value['version'])
        ? $value['version']
        : 1;
    $updatedAt = isset($value['updatedAt']) && is_string($value['updatedAt'])
        ? $value['updatedAt']
        : gmdate('c');

    return [
        'version' => $version,
        'updatedAt' => $updatedAt,
        'squares' => normalizeSquares($value['squares'] ?? null),
    ];
}

function statePath(): string
{
    $path = getenv('OPENBANNERS_BINGO_STATE_PATH');

    return is_string($path) && $path !== '' ? $path : DEFAULT_STATE_PATH;
}

function openStateFile()
{
    $path = statePath();
    $directory = dirname($path);

    if (!is_dir($directory) && !@mkdir($directory, 0775, true) && !is_dir($directory)) {
        sendJson(['error' => 'Kan opslagmap voor treinbingo niet maken.'], 500);
    }

    $handle = @fopen($path, 'c+');

    if ($handle === false) {
        sendJson(['error' => 'Kan treinbingo niet openen voor opslag.'], 500);
    }

    return $handle;
}

function readState($handle): array
{
    rewind($handle);
    $json = stream_get_contents($handle);

    if (!is_string($json) || trim($json) === '') {
        return createInitialState();
    }

    $decoded = json_decode($json, true);

    return normalizeState($decoded);
}

function writeState($handle, array $state): void
{
    rewind($handle);
    ftruncate($handle, 0);
    fwrite($handle, json_encode($state, JSON_UNESCAPED_SLASHES));
    fflush($handle);
}

function playerFromPassword(mixed $password): ?string
{
    if ($password === '1') {
        return 'green';
    }

    if ($password === '2') {
        return 'red';
    }

    return null;
}

function readJsonBody(): array
{
    $body = file_get_contents('php://input');

    if (!is_string($body) || trim($body) === '') {
        return [];
    }

    $decoded = json_decode($body, true);

    return is_array($decoded) ? $decoded : [];
}

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$handle = openStateFile();

if (!flock($handle, LOCK_EX)) {
    sendJson(['error' => 'Kan treinbingo niet vergrendelen.'], 500);
}

$state = readState($handle);

if ($method === 'GET') {
    writeState($handle, $state);
    flock($handle, LOCK_UN);
    fclose($handle);
    sendJson($state);
}

if ($method !== 'POST') {
    flock($handle, LOCK_UN);
    fclose($handle);
    sendJson(['error' => 'Methode niet toegestaan.'], 405);
}

$body = readJsonBody();
$player = playerFromPassword($body['password'] ?? null);

if ($player === null) {
    flock($handle, LOCK_UN);
    fclose($handle);
    sendJson(['error' => 'Ongeldig wachtwoord.'], 403);
}

$expectedVersion = $body['version'] ?? null;

if (!is_int($expectedVersion)) {
    flock($handle, LOCK_UN);
    fclose($handle);
    sendJson([
        'error' => 'Bordversie ontbreekt.',
        'state' => $state,
    ], 400);
}

if ($expectedVersion !== $state['version']) {
    flock($handle, LOCK_UN);
    fclose($handle);
    sendJson([
        'error' => 'Het bord is ondertussen aangepast.',
        'state' => $state,
    ], 409);
}

$action = $body['action'] ?? null;

if ($action === 'reset') {
    $nextState = createInitialState($state['version'] + 1);
    writeState($handle, $nextState);
    flock($handle, LOCK_UN);
    fclose($handle);
    sendJson($nextState);
}

if ($action !== 'toggle') {
    flock($handle, LOCK_UN);
    fclose($handle);
    sendJson(['error' => 'Onbekende actie.'], 400);
}

$index = $body['index'] ?? null;

if (!is_int($index) || $index < 0 || $index >= BOARD_SIZE) {
    flock($handle, LOCK_UN);
    fclose($handle);
    sendJson(['error' => 'Ongeldig vakje.'], 400);
}

if ($index === FREE_INDEX) {
    flock($handle, LOCK_UN);
    fclose($handle);
    sendJson(['error' => 'Het vrije vakje kan niet worden aangepast.'], 403);
}

$currentSquare = $state['squares'][$index];

if ($currentSquare !== 'empty' && $currentSquare !== $player) {
    flock($handle, LOCK_UN);
    fclose($handle);
    sendJson(['error' => 'Dit vakje is van de andere speler.'], 403);
}

$state['squares'][$index] = $currentSquare === 'empty' ? $player : 'empty';
$state['version'] += 1;
$state['updatedAt'] = gmdate('c');

writeState($handle, $state);
flock($handle, LOCK_UN);
fclose($handle);
sendJson($state);
