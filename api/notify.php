<?php
// =====================================================================
//  チャットのメール通知（チャットを送ったあとに、送った人のブラウザから呼ばれる）
//  POST api/notify.php  本文(JSON)：{ "name": 送った人の名前, "text": メッセージ }
//  相手が未読のあいだは、最初の1通だけメールを送る
// =====================================================================
require __DIR__ . '/_lib.php';
require __DIR__ . '/_notify.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail(405, 'POSTで送ってください');
$me = auth();
$in = json_decode((string)file_get_contents('php://input'), true);
$name = mb_substr(trim(isset($in['name']) ? (string)$in['name'] : ''), 0, 40);
if ($name === '') $name = 'メンバー';
$text = mb_substr(isset($in['text']) ? (string)$in['text'] : '', 0, 2000);

$dir = DATA_DIR . '/.notify';
ensure_dir($dir);
$now = time();

// 続けて何度も呼ばれたときの歯止め（同じ人からは5秒に1回まで）
$rate = $dir . '/rate_' . hash('sha256', $me['email']);
if (is_file($rate) && filemtime($rate) > $now - 5) ok(['sent' => [], 'skipped' => 'rate']);
touch($rate);

list($members, $reads, $notifyTo) = defined('TEST_MEMBERS') ? [TEST_MEMBERS, TEST_READS, TEST_NOTIFYTO] : fs_members_and_reads($me['token']);

// 相手ごとに「最後にメールを送った時刻」を記録しておくファイル
$stateFile = $dir . '/state.json';
$fp = fopen($stateFile, 'c+');
if (!$fp) fail(500, '通知の記録を開けませんでした');
flock($fp, LOCK_EX);
$state = json_decode((string)stream_get_contents($fp), true);
if (!is_array($state)) $state = [];

list($subject, $body) = notify_mail_text($name, $text);
$sent = [];
$skipped = [];
foreach ($members as $to) {
    if ($to === '' || $to === $me['email']) continue;
    $key = hash('sha256', $to);
    $lastMail = isset($state[$key]) ? (int)$state[$key] : 0;
    $lastRead = isset($reads[$to]) ? (int)$reads[$to] : 0;
    if (!notify_should_send($lastMail, $lastRead, $now, NOTIFY_ACTIVE_SEC)) { $skipped[] = $lastRead > $now - NOTIFY_ACTIVE_SEC ? 'active' : 'unread'; continue; }
    $ok = false;
    foreach (notify_addresses($to, $notifyTo) as $addr) if (notify_send_mail($addr, $subject, $body)) { $ok = true; $sent[] = 1; }   // 追加の宛先にも同じメールを送る
    if ($ok) $state[$key] = $now; else $skipped[] = 'mail-error';
}

ftruncate($fp, 0);
rewind($fp);
fwrite($fp, json_encode($state));
fflush($fp);
flock($fp, LOCK_UN);
fclose($fp);

ok(['sent' => count($sent), 'skipped' => $skipped]);
