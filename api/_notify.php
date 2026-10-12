<?php
// =====================================================================
//  チャットのメール通知：送るかどうかの判断と、メールの組み立て
// =====================================================================

// 送るかどうか
//  ・相手が NOTIFY_ACTIVE_SEC 秒以内にチャットを読んでいる → 今見ているので送らない
//  ・前回のメールのあと、相手がまだチャットを読んでいない → 2通目なので送らない
//  ・それ以外 → 送る
function notify_should_send($lastMail, $lastRead, $now, $activeSec = 300)
{
    if ($lastRead > $now - $activeSec) return false;
    if ($lastMail > $lastRead) return false;
    return true;
}

// Firestore（REST）の値を、PHPの値にする
function fs_value($v)
{
    if (isset($v['stringValue'])) return $v['stringValue'];
    if (isset($v['timestampValue'])) return strtotime($v['timestampValue']);
    if (isset($v['integerValue'])) return (int)$v['integerValue'];
    if (isset($v['arrayValue'])) return array_map('fs_value', isset($v['arrayValue']['values']) ? $v['arrayValue']['values'] : []);
    if (isset($v['mapValue'])) return array_map('fs_value', isset($v['mapValue']['fields']) ? $v['mapValue']['fields'] : []);
    return null;
}

// メンバー一覧（メール）と、各メンバーの最後にチャットを読んだ時刻（メール → UNIX時刻）
// メンバーごとのお知らせメールの宛先：ログインしているアドレス＋「追加の宛先」（重複・不正な形式は除く）
function notify_addresses($member, $notifyTo)
{
    $list = [$member];
    if (isset($notifyTo[$member]) && is_array($notifyTo[$member])) $list = array_merge($list, $notifyTo[$member]);
    $out = [];
    foreach ($list as $a) {
        $a = strtolower(trim((string)$a));
        if (filter_var($a, FILTER_VALIDATE_EMAIL) && !in_array($a, $out, true)) $out[] = $a;
    }
    return array_slice($out, 0, 5);
}

function fs_members_and_reads($token)
{
    $base = 'https://firestore.googleapis.com/v1/projects/' . FB_PROJECT_ID . '/databases/(default)/documents/studios/' . STUDIO_ID;
    list($code, $body) = http_get($base, ['Authorization: Bearer ' . $token]);
    $doc = json_decode($body, true);
    if ($code !== 200 || !$doc) fail(502, 'メンバー一覧を読めませんでした');
    $members = array_map('strtolower', isset($doc['fields']['members']) ? fs_value($doc['fields']['members']) : []);
    $notifyTo = [];   // メンバー（ログインのアドレス）→ 追加の宛先
    if (isset($doc['fields']['notifyTo'])) foreach ((array)fs_value($doc['fields']['notifyTo']) as $k => $v) $notifyTo[strtolower($k)] = is_array($v) ? $v : [];

    list($code, $body) = http_get($base . '/reads?pageSize=100', ['Authorization: Bearer ' . $token]);
    $list = json_decode($body, true);
    $reads = [];
    if ($code === 200 && !empty($list['documents'])) {
        foreach ($list['documents'] as $d) {
            $f = isset($d['fields']) ? $d['fields'] : [];
            if (empty($f['email']) || empty($f['at'])) continue;
            $email = strtolower(fs_value($f['email']));
            $reads[$email] = max(isset($reads[$email]) ? $reads[$email] : 0, (int)fs_value($f['at']));
        }
    }
    return [$members, $reads, $notifyTo];
}

function notify_mail_text($name, $text)
{
    $text = trim(preg_replace("/\r\n?/", "\n", (string)$text));
    if (mb_strlen($text) > 300) $text = mb_substr($text, 0, 300) . '…（続きはチャットで）';
    $subject = '【ふたりスタジオ】' . $name . 'さんからチャットが届きました';
    $body = $name . "さんから、ふたりスタジオにチャットが届きました。\n\n"
        . "──────────\n" . $text . "\n──────────\n\n"
        . "▼ ふたりスタジオを開く\n" . STUDIO_URL . "\n\n"
        . "※ チャットを読むまでは、続けてメッセージが届いてもメールは送られません。\n"
        . "※ このメールは送信専用です。返信は、ふたりスタジオのチャットからお願いします。\n";
    return [$subject, $body];
}

function notify_send_mail($to, $subject, $body)
{
    if (defined('MAIL_DRYRUN') && MAIL_DRYRUN) {   // 動作確認用：送らずにファイルに書く
        file_put_contents(DATA_DIR . '/.notify/dryrun.log', "TO: $to\nSUBJECT: $subject\n$body\n=====\n", FILE_APPEND | LOCK_EX);
        return true;
    }
    mb_language('Japanese');
    mb_internal_encoding('UTF-8');
    $headers = 'From: ' . mb_encode_mimeheader(MAIL_FROM_NAME) . ' <' . MAIL_FROM . '>';
    return @mb_send_mail($to, $subject, $body, $headers, '-f' . MAIL_FROM);
}
