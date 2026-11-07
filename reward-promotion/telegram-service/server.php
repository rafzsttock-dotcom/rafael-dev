<?php
/**
 * MadelineProto HTTP sidecar untuk KODO / Rewardex.
 * Kontrak HTTP SAMA seperti versi Telethon lama, jadi server.js tidak berubah:
 *   GET  /health                      -> {ok:true}
 *   GET  /status   (X-Service-Secret) -> {ok, configured, accounts, me}
 *   POST /resolve  {identifier}       -> {ok, tg_id, username, tg_name}
 *   POST /send     {tg_id, text}      -> {ok}
 *   POST /member   {tg_id, channel}   -> {ok, member}
 *
 * Multi-akun: semua file sesi di TELEGRAM_SESSION_DIR (*.madeline) dimuat.
 * - /resolve "menghangatkan" peer di SEMUA akun (import kontak / getInfo) agar akun mana pun bisa kirim.
 * - /send di-rotasi (round-robin) ke semua akun untuk menyebar beban & hindari limit.
 * - /member & /status pakai akun pertama.
 */

declare(strict_types=1);

require __DIR__ . '/vendor/autoload.php';

use danog\MadelineProto\API;
use danog\MadelineProto\Settings;
use danog\MadelineProto\Settings\AppInfo;

use Amp\ByteStream;
use Amp\Http\HttpStatus;
use Amp\Http\Server\DefaultErrorHandler;
use Amp\Http\Server\Request;
use Amp\Http\Server\RequestHandler;
use Amp\Http\Server\Response;
use Amp\Http\Server\SocketHttpServer;
use Amp\Log\ConsoleFormatter;
use Amp\Log\StreamHandler;
use Monolog\Logger;

$API_ID   = (int) (getenv('TELEGRAM_API_ID') ?: 0);
$API_HASH = trim((string) getenv('TELEGRAM_API_HASH'));
$SECRET   = trim((string) (getenv('TELEGRAM_SERVICE_SECRET') ?: 'changeme'));
$HOST     = (string) (getenv('TELEGRAM_SERVICE_HOST') ?: '0.0.0.0');
$PORT     = (int) (getenv('TELEGRAM_SERVICE_PORT') ?: 8090);
$SESS_DIR = (string) (getenv('TELEGRAM_SESSION_DIR') ?: '/data/tg');

@mkdir($SESS_DIR, 0775, true);

function build_settings(int $id, string $hash): Settings
{
    $s = new Settings;
    $s->setAppInfo((new AppInfo)->setApiId($id)->setApiHash($hash));
    return $s;
}

/** Muat semua sesi yang sudah login. */
function load_clients(string $dir, int $apiId, string $apiHash): array
{
    $clients = [];
    $me = [];
    foreach (glob("$dir/*.madeline") ?: [] as $path) {
        try {
            $MP = new API($path, build_settings($apiId, $apiHash));
            if ($MP->getAuthorization() !== API::LOGGED_IN) {
                fwrite(STDERR, "[tg] lewati (belum login): $path\n");
                continue;
            }
            $MP->start(); // untuk sesi yang sudah login, ini langsung balik tanpa prompt
            $self = $MP->getSelf();
            if (!$self) {
                continue;
            }
            $clients[] = $MP;
            $me[] = [
                'id'         => $self['id'] ?? null,
                'username'   => $self['username'] ?? '',
                'first_name' => $self['first_name'] ?? '',
                'phone'      => $self['phone'] ?? '',
            ];
            fwrite(STDERR, "[tg] akun aktif: @" . ($self['username'] ?? '') . " id=" . ($self['id'] ?? '') . "\n");
        } catch (\Throwable $e) {
            fwrite(STDERR, "[tg] gagal muat $path: " . $e->getMessage() . "\n");
        }
    }
    return [$clients, $me];
}

[$CLIENTS, $ME] = load_clients($SESS_DIR, $API_ID, $API_HASH);
fwrite(STDERR, "[tg] total akun aktif: " . count($CLIENTS) . "\n");

final class TgHandler implements RequestHandler
{
    private int $rr = 0;

    /** @param API[] $clients */
    public function __construct(
        private array $clients,
        private array $me,
        private string $secret,
    ) {}

    private function json(int $code, array $data): Response
    {
        return new Response(
            $code,
            ['Content-Type' => 'application/json; charset=utf-8'],
            json_encode($data, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
        );
    }

    private function primary(): ?API
    {
        return $this->clients[0] ?? null;
    }

    private function next(): ?API
    {
        if (!$this->clients) {
            return null;
        }
        $c = $this->clients[$this->rr % count($this->clients)];
        $this->rr++;
        return $c;
    }

    public function handleRequest(Request $request): Response
    {
        $path = $request->getUri()->getPath();

        if ($path === '/health') {
            return $this->json(HttpStatus::OK, ['ok' => true]);
        }

        // Semua endpoint lain wajib secret.
        $hdr = $request->getHeader('X-Service-Secret') ?? '';
        if ($this->secret === '' || !hash_equals($this->secret, $hdr)) {
            return $this->json(HttpStatus::UNAUTHORIZED, ['ok' => false, 'error' => 'unauthorized']);
        }

        if ($path === '/status') {
            $ok = count($this->clients) > 0;
            return $this->json(HttpStatus::OK, [
                'ok'         => $ok,
                'configured' => $ok,
                'accounts'   => count($this->clients),
                'me'         => $this->me[0] ?? null,
            ]);
        }

        $raw = $request->getBody()->buffer();
        $data = $raw !== '' ? json_decode($raw, true) : [];
        if (!is_array($data)) {
            $data = [];
        }

        try {
            return match ($path) {
                '/resolve' => $this->resolve((string) ($data['identifier'] ?? '')),
                '/send'    => $this->send((int) ($data['tg_id'] ?? 0), (string) ($data['text'] ?? '')),
                '/member'  => $this->member((int) ($data['tg_id'] ?? 0), (string) ($data['channel'] ?? '')),
                default    => $this->json(HttpStatus::NOT_FOUND, ['error' => 'not found']),
            };
        } catch (\Throwable $e) {
            return $this->json(HttpStatus::INTERNAL_SERVER_ERROR, ['ok' => false, 'error' => $e->getMessage()]);
        }
    }

    /** Resolve @username / nomor HP / id -> user, lalu hangatkan di semua akun. */
    private function resolve(string $identifier): Response
    {
        $identifier = trim($identifier);
        if ($identifier === '') {
            return $this->json(HttpStatus::BAD_REQUEST, ['ok' => false, 'error' => 'identifier kosong']);
        }
        if (!$this->clients) {
            return $this->json(HttpStatus::SERVICE_UNAVAILABLE, ['ok' => false, 'error' => 'Tidak ada akun Telegram aktif']);
        }

        $isPhone = (bool) preg_match('/^\+?\d{8,15}$/', preg_replace('/\s/', '', $identifier));
        $resolved = null; // user array

        foreach ($this->clients as $MP) {
            try {
                if ($isPhone) {
                    $phone = $identifier[0] === '+' ? $identifier : '+' . preg_replace('/\D/', '', $identifier);
                    $u = $this->importByPhone($MP, $phone);
                } else {
                    $u = $this->infoUser($MP, $identifier);
                }
                if ($u && ($resolved === null)) {
                    $resolved = $u; // ambil hasil pertama yang sukses, tapi tetap hangatkan akun lain
                }
            } catch (\Throwable $e) {
                // abaikan, coba akun berikutnya
            }
        }

        if ($resolved === null) {
            $msg = $isPhone
                ? 'Nomor tidak terdaftar di Telegram, atau privasi user menolak dicari lewat nomor.'
                : 'Akun Telegram tidak ditemukan. Cek @username / nomor kamu.';
            return $this->json(HttpStatus::BAD_REQUEST, ['ok' => false, 'error' => $msg]);
        }

        $uid   = (string) ($resolved['id'] ?? '');
        $uname = (string) ($resolved['username'] ?? '');
        $fname = (string) ($resolved['first_name'] ?? '');
        return $this->json(HttpStatus::OK, [
            'ok'       => true,
            'tg_id'    => $uid,
            'username' => $uname,
            'tg_name'  => $uname !== '' ? $uname : ($fname !== '' ? $fname : $uid),
        ]);
    }

    /** Import nomor sebagai kontak di 1 akun, balik user array atau null. */
    private function importByPhone(API $MP, string $phone): ?array
    {
        // Kalau sudah kontak, getInfo lebih cepat.
        try {
            $u = $this->infoUser($MP, $phone);
            if ($u) {
                return $u;
            }
        } catch (\Throwable $e) {
            // lanjut import
        }
        $res = $MP->contacts->importContacts(contacts: [[
            '_'          => 'inputPhoneContact',
            'client_id'  => 0,
            'phone'      => $phone,
            'first_name' => 'kodo',
            'last_name'  => 'user',
        ]]);
        $users = $res['users'] ?? [];
        if (!$users) {
            return null;
        }
        $u = $users[0];
        return [
            'id'         => $u['id'] ?? null,
            'username'   => $u['username'] ?? '',
            'first_name' => $u['first_name'] ?? '',
        ];
    }

    /** getInfo untuk @username / id / peer -> user array atau null. */
    private function infoUser(API $MP, string $peer): ?array
    {
        $info = $MP->getInfo($peer);
        $uid = $info['bot_api_id'] ?? ($info['User']['id'] ?? null);
        if (!$uid) {
            return null;
        }
        $user = $info['User'] ?? [];
        return [
            'id'         => $uid,
            'username'   => $user['username'] ?? '',
            'first_name' => $user['first_name'] ?? '',
        ];
    }

    private function send(int $tgId, string $text): Response
    {
        if (!$tgId || $text === '') {
            return $this->json(HttpStatus::BAD_REQUEST, ['ok' => false, 'error' => 'tg_id dan text wajib']);
        }
        $errors = [];
        // Coba setiap akun mulai dari giliran round-robin; berhenti di yang pertama sukses.
        $n = count($this->clients);
        for ($i = 0; $i < $n; $i++) {
            $MP = $this->next();
            if (!$MP) {
                break;
            }
            try {
                $MP->messages->sendMessage(peer: $tgId, message: $text);
                return $this->json(HttpStatus::OK, ['ok' => true]);
            } catch (\Throwable $e) {
                $errors[] = $e->getMessage();
            }
        }
        return $this->json(HttpStatus::BAD_GATEWAY, [
            'ok'    => false,
            'error' => 'Gagal kirim via semua akun: ' . (implode(' | ', $errors) ?: 'tidak ada akun'),
        ]);
    }

    private function member(int $tgId, string $channel): Response
    {
        $channel = trim($channel);
        if ($channel === '') {
            return $this->json(HttpStatus::OK, ['ok' => true, 'member' => true]); // tidak ada channel wajib
        }
        if (!$tgId) {
            return $this->json(HttpStatus::BAD_REQUEST, ['ok' => false, 'error' => 'tg_id wajib']);
        }
        $MP = $this->primary();
        if (!$MP) {
            return $this->json(HttpStatus::SERVICE_UNAVAILABLE, ['ok' => false, 'member' => false, 'error' => 'Tidak ada akun aktif']);
        }
        if (preg_match('#t\.me/([A-Za-z0-9_]+)#', $channel, $m)) {
            $channel = $m[1];
        }
        try {
            $MP->channels->getParticipant(channel: $channel, participant: $tgId);
            return $this->json(HttpStatus::OK, ['ok' => true, 'member' => true]);
        } catch (\Throwable $e) {
            // USER_NOT_PARTICIPANT dsb -> bukan member
            return $this->json(HttpStatus::OK, ['ok' => true, 'member' => false]);
        }
    }
}

// ---- Jalankan HTTP server (amphp v3) ----
$logHandler = new StreamHandler(ByteStream\getStderr());
$logHandler->setFormatter(new ConsoleFormatter());
$logger = new Logger('tg');
$logger->pushHandler($logHandler);

$server = SocketHttpServer::createForDirectAccess($logger);
$server->expose("$HOST:$PORT");
$server->start(new TgHandler($CLIENTS, $ME, $SECRET), new DefaultErrorHandler());

fwrite(STDERR, "[tg] MadelineProto sidecar listening on $HOST:$PORT\n");

Amp\trapSignal([SIGINT, SIGTERM]);
$server->stop();
