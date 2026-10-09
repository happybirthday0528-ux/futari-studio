<?php
// =====================================================================
//  ふたりスタジオ API の共通処理（ログインの確認・入力のチェック）
// =====================================================================
require __DIR__ . '/config.php';

header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

function fail($code, $msg, $extra = [])
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'error' => $msg] + $extra, JSON_UNESCAPED_UNICODE);
    exit;
}

function ok($data = [])
{
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => true] + $data, JSON_UNESCAPED_UNICODE);
    exit;
}

function ensure_dir($dir)
{
    if (!is_dir($dir) && !@mkdir($dir, 0705, true)) fail(500, '保存フォルダを作れませんでした');
}

function b64url_decode($s)
{
    return base64_decode(strtr($s, '-_', '+/') . str_repeat('=', (4 - strlen($s) % 4) % 4));
}

// 外部へのGET（curl が無ければ file_get_contents）。戻り値：[ステータス, 本文, ヘッダー]
function http_get($url, $headers = [])
{
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => $headers, CURLOPT_TIMEOUT => 15, CURLOPT_HEADER => true]);
        $res = curl_exec($ch);
        if ($res === false) { curl_close($ch); return [0, '', '']; }
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $hs = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
        curl_close($ch);
        return [$code, substr($res, $hs), substr($res, 0, $hs)];
    }
    $ctx = stream_context_create(['http' => ['header' => implode("\r\n", $headers), 'ignore_errors' => true, 'timeout' => 15]]);
    $body = @file_get_contents($url, false, $ctx);
    $hdr = isset($http_response_header) ? implode("\n", $http_response_header) : '';
    $code = preg_match('#HTTP/\S+ ([0-9]{3})#', $hdr, $m) ? (int)$m[1] : 0;
    return [$code, (string)$body, $hdr];
}

// Googleの公開証明書（Firebaseのログイン情報の署名を確かめるため）。期限までキャッシュ
function google_certs()
{
    $cache = DATA_DIR . '/.cache/certs.json';
    if (is_file($cache)) {
        $c = json_decode((string)file_get_contents($cache), true);
        if ($c && $c['exp'] > time()) return $c['certs'];
    }
    list($code, $body, $hdr) = http_get('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com');
    $certs = json_decode($body, true);
    if ($code !== 200 || !is_array($certs)) fail(503, 'ログイン確認用の証明書を取得できませんでした');
    $maxAge = preg_match('/max-age=([0-9]+)/i', $hdr, $m) ? (int)$m[1] : 3600;
    ensure_dir(dirname($cache));
    file_put_contents($cache, json_encode(['exp' => time() + $maxAge, 'certs' => $certs]), LOCK_EX);
    return $certs;
}

// ログインの確認：Firebaseのログイン情報（IDトークン）を検証し、スタジオのメンバーかを確かめる
function auth()
{
    if (defined('AUTH_BYPASS') && AUTH_BYPASS) return ['uid' => 'test', 'email' => 'test@example.com'];   // 動作確認用

    $t = isset($_SERVER['HTTP_X_STUDIO_TOKEN']) ? $_SERVER['HTTP_X_STUDIO_TOKEN'] : '';
    $p = explode('.', $t);
    if (count($p) !== 3) fail(401, 'ログインが必要です');
    $h = json_decode(b64url_decode($p[0]), true);
    $c = json_decode(b64url_decode($p[1]), true);
    if (!$h || !$c || (isset($h['alg']) ? $h['alg'] : '') !== 'RS256') fail(401, 'ログイン情報が正しくありません');

    $certs = google_certs();
    $kid = isset($h['kid']) ? $h['kid'] : '';
    if (empty($certs[$kid])) fail(401, 'ログイン情報が古くなっています。ページを再読み込みしてください');
    if (openssl_verify($p[0] . '.' . $p[1], b64url_decode($p[2]), $certs[$kid], OPENSSL_ALGO_SHA256) !== 1) fail(401, 'ログイン情報を確認できませんでした');

    $now = time();
    if ((isset($c['aud']) ? $c['aud'] : '') !== FB_PROJECT_ID || (isset($c['iss']) ? $c['iss'] : '') !== 'https://securetoken.google.com/' . FB_PROJECT_ID) fail(401, 'このスタジオのログインではありません');
    if ((isset($c['exp']) ? $c['exp'] : 0) < $now || (isset($c['iat']) ? $c['iat'] : 0) > $now + 300 || empty($c['sub'])) fail(401, 'ログインの有効期限が切れました。ページを再読み込みしてください');
    if (empty($c['email_verified'])) fail(403, 'メールアドレスが確認されていないアカウントです');

    // メンバーかどうかは Firestore のセキュリティルールに任せる（メンバーでなければ読めない）。結果は10分キャッシュ
    $mark = DATA_DIR . '/.cache/auth_' . hash('sha256', $t);
    if (!(is_file($mark) && filemtime($mark) > $now - 600)) {
        $url = 'https://firestore.googleapis.com/v1/projects/' . FB_PROJECT_ID . '/databases/(default)/documents/studios/' . STUDIO_ID;
        list($code) = http_get($url, ['Authorization: Bearer ' . $t]);
        if ($code !== 200) fail(403, 'ふたりスタジオのメンバーではありません');
        ensure_dir(dirname($mark));
        touch($mark);
        if (mt_rand(1, 50) === 1) foreach (glob(DATA_DIR . '/.cache/auth_*') as $f) if (filemtime($f) < $now - 3600) @unlink($f);
    }
    return ['uid' => $c['sub'], 'email' => isset($c['email']) ? $c['email'] : ''];
}

// 入力のチェック（フォルダ名・ファイル名は英数字だけに限定）
function song_id($v)
{
    if (!is_string($v) || !preg_match('/^[a-z0-9]{6,40}$/', $v)) fail(400, '曲のIDが正しくありません');
    return $v;
}

function file_key($v)
{
    if (!is_string($v) || !preg_match('/^[A-Za-z0-9_-]{1,64}\.([A-Za-z0-9]{2,5})$/', $v, $m) || !in_array(strtolower($m[1]), FILE_EXT, true)) fail(400, 'ファイル名が正しくありません');
    return $v;
}

function song_dir($song)
{
    return DATA_DIR . '/songs/' . $song;
}
