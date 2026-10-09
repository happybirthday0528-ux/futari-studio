<?php
// =====================================================================
//  音源のアップロード（4MBずつ分けて送り、サーバーで1つのファイルにつなげる）
//  POST api/upload.php?song=曲ID&key=ファイル名&offset=何バイト目から
// =====================================================================
require __DIR__ . '/_lib.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail(405, 'POSTで送ってください');
auth();
@set_time_limit(300);

$song = song_id(isset($_GET['song']) ? $_GET['song'] : '');
$key = file_key(isset($_GET['key']) ? $_GET['key'] : '');
$offset = isset($_GET['offset']) && ctype_digit((string)$_GET['offset']) ? (int)$_GET['offset'] : -1;

$dir = song_dir($song);
ensure_dir($dir);
$path = $dir . '/' . $key;
clearstatcache();
$current = is_file($path) ? filesize($path) : 0;

// 途中から再開する場合は、サーバーにある大きさと一致しているときだけ続きを受け付ける
if ($offset !== 0 && $offset !== $current) fail(409, '送信位置がずれています', ['size' => $current]);

$in = fopen('php://input', 'rb');
$out = fopen($path, $offset === 0 ? 'wb' : 'ab');
if (!$in || !$out) fail(500, 'ファイルを保存できませんでした');
stream_copy_to_stream($in, $out);
fclose($in);
fclose($out);

clearstatcache();
$size = filesize($path);
if ($size > MAX_FILE_BYTES) { @unlink($path); fail(413, 'ファイルが大きすぎます（1GBまで）'); }
ok(['size' => $size]);
