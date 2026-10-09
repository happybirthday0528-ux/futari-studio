// =====================================================================
//  Firebase の設定
//  ・null のまま     → ローカルモード（このブラウザだけに保存。動作確認用）
//  ・設定を入れる    → 本番モード（Googleログイン＋2人でデータを共有）
//
//  Firebaseコンソール → プロジェクトの設定 → マイアプリ（ウェブ）に表示される
//  firebaseConfig の中身を、下の null の代わりに貼り付けます。
//  ※ この値は公開されても問題ない情報です（アクセスの制限はセキュリティルールで行います）
// =====================================================================
window.FUTARI_FIREBASE = {
  apiKey: "AIzaSyBnT4ImaVYXzErZAC49E26Q8Pk2fUYfRJc",
  authDomain: "futari-studio.firebaseapp.com",
  projectId: "futari-studio",
  storageBucket: "futari-studio.firebasestorage.app",
  messagingSenderId: "199433404034",
  appId: "1:199433404034:web:b177959ddf88de1260be9b"
};

/* 貼り付け例：
window.FUTARI_FIREBASE = {
  apiKey: "AIza....",
  authDomain: "xxxx.firebaseapp.com",
  projectId: "xxxx",
  storageBucket: "xxxx.appspot.com",
  messagingSenderId: "0000000000",
  appId: "1:0000000000:web:xxxxxxxx"
};
*/
