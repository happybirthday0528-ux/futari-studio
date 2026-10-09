# ふたりスタジオ

原曲 → SUNO → DAWでの仕上げ → YouTube投稿 までを、2人で進めるための共同制作環境です。

## 現在の状態
- `index.html` … 画面のたたき台（デモ）。1ファイルで動きます
- データはブラウザ内（localStorage）にだけ保存されます。2人での共有は、Firebaseと連携する本番版で対応予定です

## 公開URL
http://rough-yame-05280.holy.jp/studio/

## 更新の流れ
1. このリポジトリの `main` ブランチに変更を反映する
2. PowerShellで `deploy` を実行する（サーバー上で `cd ~/web/studio/ && git pull` が実行されます）
