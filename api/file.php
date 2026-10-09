<?php
// =====================================================================
//  音源の取得（ログインしたメンバーだけ）
//  GET api/file.php?song=曲ID&key=ファイル名
// =====================================================================
require __DIR__ . '/_lib.php';

auth();
@set_time_limit(0);

$song = song_id(isset($_GET['song']) ? $_GET['song'] : '');
$key = file_key(isset($_GET['key']) ? $_GET['key'] : '');
$path = song_dir($song) . '/' . $key;
if (!is_file($path)) fail(404, 'ファイルが見つかりません');

$types = ['wav' => 'audio/wav', 'wave' => 'audio/wav', 'mp3' => 'audio/mpeg', 'm4a' => 'audio/mp4', 'aac' => 'audio/aac', 'flac' => 'audio/flac',
    'ogg' => 'audio/ogg', 'aif' => 'audio/aiff', 'aiff' => 'audio/aiff', 'mid' => 'audio/midi', 'midi' => 'audio/midi'];
$ext = strtolower(pathinfo($key, PATHINFO_EXTENSION));
$size = filesize($path);
$start = 0;
$end = $size - 1;

header_remove('Cache-Control');
header('Cache-Control: private, no-cache');
header('Content-Type: ' . (isset($types[$ext]) ? $types[$ext] : 'application/octet-stream'));
header('Accept-Ranges: bytes');
if (isset($_SERVER['HTTP_RANGE']) && preg_match('/^bytes=([0-9]*)-([0-9]*)$/', $_SERVER['HTTP_RANGE'], $m) && ($m[1] !== '' || $m[2] !== '')) {
    if ($m[1] === '') { $start = max(0, $size - (int)$m[2]); }
    else { $start = (int)$m[1]; if ($m[2] !== '') $end = min($end, (int)$m[2]); }
    if ($start > $end || $start >= $size) { header('Content-Range: bytes */' . $size); fail(416, '範囲が正しくありません'); }
    http_response_code(206);
    header('Content-Range: bytes ' . $start . '-' . $end . '/' . $size);
}
header('Content-Length: ' . ($end - $start + 1));

$fp = fopen($path, 'rb');
fseek($fp, $start);
$left = $end - $start + 1;
while ($left > 0 && !feof($fp) && !connection_aborted()) {
    $buf = fread($fp, (int)min(1048576, $left));
    echo $buf;
    $left -= strlen($buf);
    flush();
}
fclose($fp);
