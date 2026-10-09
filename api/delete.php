<?php
// =====================================================================
//  曲の音源をまとめて削除（ログインしたメンバーだけ）
//  POST api/delete.php?song=曲ID
// =====================================================================
require __DIR__ . '/_lib.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail(405, 'POSTで送ってください');
auth();

$song = song_id(isset($_GET['song']) ? $_GET['song'] : '');
$dir = song_dir($song);
if (is_dir($dir)) {
    foreach (glob($dir . '/*') as $f) if (is_file($f)) @unlink($f);
    @rmdir($dir);
}
ok();
