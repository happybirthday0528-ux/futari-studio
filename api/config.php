<?php
// =====================================================================
//  ふたりスタジオ API の設定
// =====================================================================
const FB_PROJECT_ID = 'futari-studio';               // Firebase のプロジェクトID
const STUDIO_ID = 'main';                            // Firestore の studios/{STUDIO_ID}
const DATA_DIR = __DIR__ . '/../data';               // 音源の保存先（.htaccess で直接のアクセスを禁止）
const MAX_FILE_BYTES = 1024 * 1024 * 1024;           // 1ファイル 1GB まで
const FILE_EXT = ['wav', 'wave', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'aif', 'aiff', 'mid', 'midi'];

// チャットのメール通知
const STUDIO_URL = 'http://rough-yame-05280.holy.jp/studio/';   // メールに載せるリンク
const MAIL_FROM = 'noreply@rough-yame-05280.holy.jp';           // 送信元（送信専用）
const MAIL_FROM_NAME = 'ふたりスタジオ';
const NOTIFY_ACTIVE_SEC = 300;                                    // 相手が5分以内にチャットを読んでいたら「今見ている」としてメールしない

// 動作確認用の設定（GitHubには入れません）
if (is_file(__DIR__ . '/config.local.php')) require __DIR__ . '/config.local.php';
