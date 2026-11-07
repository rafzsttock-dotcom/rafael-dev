<?php
/**
 * Login SEKALI per akun untuk membuat sesi MadelineProto.
 * Jalankan interaktif di VPS, mis:
 *   docker compose run --rm telethon php login.php akun1
 *   docker compose run --rm telethon php login.php akun2   (multi-akun)
 *
 * Butuh TELEGRAM_API_ID & TELEGRAM_API_HASH di environment (.env).
 * Sesi disimpan di TELEGRAM_SESSION_DIR/<nama>.madeline (default /data/tg).
 */

declare(strict_types=1);

require __DIR__ . '/vendor/autoload.php';

use danog\MadelineProto\API;
use danog\MadelineProto\Settings;
use danog\MadelineProto\Settings\AppInfo;

$apiId   = (int) (getenv('TELEGRAM_API_ID') ?: 0);
$apiHash = trim((string) getenv('TELEGRAM_API_HASH'));
$dir     = (string) (getenv('TELEGRAM_SESSION_DIR') ?: '/data/tg');

if (!$apiId || $apiHash === '') {
    fwrite(STDERR, "ERROR: TELEGRAM_API_ID / TELEGRAM_API_HASH belum diisi di .env\n");
    exit(1);
}

$name = preg_replace('/[^A-Za-z0-9_-]/', '', $argv[1] ?? 'akun1') ?: 'akun1';
@mkdir($dir, 0775, true);
$path = "$dir/$name.madeline";

$settings = new Settings;
$settings->setAppInfo((new AppInfo)->setApiId($apiId)->setApiHash($apiHash));

echo "== Login akun Telegram: $name ==\n";
echo "Masukkan nomor HP akun pengirim OTP (format +62...), lalu kode dari Telegram.\n\n";

$MP = new API($path, $settings);
$MP->start(); // interaktif: minta nomor, kode, dan password 2FA bila ada

$self = $MP->getSelf();
echo "\n== Berhasil login ==\n";
echo "Nama : " . ($self['first_name'] ?? '') . "\n";
echo "User : @" . ($self['username'] ?? '-') . "\n";
echo "ID   : " . ($self['id'] ?? '-') . "\n";
echo "Sesi : $path\n";
echo "\nSelesai. Jalankan lagi dengan nama berbeda untuk menambah akun, atau 'docker compose up -d' untuk menjalankan layanan.\n";
