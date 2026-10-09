// =====================================================================
//  store.js — データの保存先を切り替える層
//   ・firebase-config.js に設定がある → Firebase（ログイン＋2人で共有）
//   ・設定がない                    → ローカルモード（このブラウザだけに保存）
// =====================================================================
const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';

export const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
};
export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export async function createStore(cfg, seed) {
  if (cfg && cfg.apiKey) return firebaseStore(cfg);
  return localStore(seed);
}

/* ---------------------------------------------------------------------
   ローカルモード：Firebase未設定のときに使う（動作確認・デモ用）
--------------------------------------------------------------------- */
function localStore(seed) {
  const K = 'futari-studio-local-data';
  let D = LS.get(K, null);
  if (!D) {
    D = { state: null, chat: seed.chat(), memos: seed.memos(), lastRead: seed.lastRead, partnerRead: seed.partnerRead };
    // 以前のデモ版（futari-studio-v1）の内容を引き継ぐ
    const old = LS.get('futari-studio-v1', null);
    if (old && old.v === 1) {
      D.state = { cand: old.cand, comments: old.comments, revs: old.revs, checks: old.checks, credit: old.credit };
      if (old.sharedMemo) D.memos.unshift({ id: newId(), title: '共有メモ（以前のデモ版から）', body: old.sharedMemo, pinned: false, updatedAt: Date.now(), updatedBy: old.sharedBy || 'あなた' });
    }
    LS.set(K, D);
  }
  const me = { uid: 'local', name: 'あなた', email: '' };
  const subs = { chat: [], memos: [], reads: [] };
  const persist = () => LS.set(K, D);
  const emit = k => {
    if (k === 'chat') subs.chat.forEach(f => f(D.chat.slice()));
    if (k === 'memos') subs.memos.forEach(f => f(sortMemos(D.memos)));
    if (k === 'reads') subs.reads.forEach(f => f({ mine: D.lastRead || 0, others: D.partnerRead || 0 }));
  };
  return {
    mode: 'local', me,
    onAuth(cb) { cb({ status: 'ready', user: me, isOwner: false, members: [] }); },
    signIn() {}, signOut() {},
    onState(cb) { cb(D.state, false); return () => {}; },
    patchState(p) { D.state = { ...(D.state || {}), ...p }; persist(); },
    onChat(cb) { subs.chat.push(cb); cb(D.chat.slice()); return () => {}; },
    async sendChat(m) { D.chat.push({ id: newId(), uid: me.uid, name: me.name, at: Date.now(), ...m }); persist(); emit('chat'); },
    onReads(cb) { subs.reads.push(cb); emit('reads'); return () => {}; },
    markRead() { const last = D.chat.length ? D.chat[D.chat.length - 1].at : 0; if (last > (D.lastRead || 0)) { D.lastRead = last; persist(); emit('reads'); } },
    onMemos(cb) { subs.memos.push(cb); cb(sortMemos(D.memos)); return () => {}; },
    async saveMemo(id, data) {
      const now = Date.now();
      if (!id) { id = newId(); D.memos.push({ id, title: '', body: '', pinned: false, ...data, updatedAt: now, updatedBy: me.name }); }
      else { const m = D.memos.find(x => x.id === id); if (m) Object.assign(m, data, { updatedAt: now, updatedBy: me.name }); }
      persist(); emit('memos'); return id;
    },
    async deleteMemo(id) { D.memos = D.memos.filter(x => x.id !== id); persist(); emit('memos'); },
    onMembers() { return () => {}; },
    async setMembers() {},
    // 曲のアップロードは本番モード（Firebase）のときだけ
    async getIdToken() { return ''; },
    onSongs(cb) { cb([]); return () => {}; },
    async saveSong() { throw new Error('ローカルモードでは曲を保存できません'); },
    async updateSong() {},
    async deleteSong() {}
  };
}

/* ---------------------------------------------------------------------
   Firebaseモード：Googleログイン＋Firestoreで2人のデータを共有
   データの場所： studios/{studioId}/
     （本体）  name, owner, members[]   … メンバー管理
     state/app                          … 候補・コメント・修正指示・チェック・クレジット
     chat/{id}                          … チャット
     memos/{id}                         … 共有メモ
     reads/{uid}                        … 既読位置
--------------------------------------------------------------------- */
async function firebaseStore(cfg) {
  const [{ initializeApp }, A, F] = await Promise.all([
    import(FB + 'firebase-app.js'), import(FB + 'firebase-auth.js'), import(FB + 'firebase-firestore.js')
  ]);
  const app = initializeApp(cfg);
  const auth = A.getAuth(app);
  const db = F.getFirestore(app);
  const SID = cfg.studioId || 'main';
  const root = F.doc(db, 'studios', SID);
  const col = n => F.collection(db, 'studios', SID, n);
  const ms = v => (v && v.toMillis) ? v.toMillis() : (typeof v === 'number' ? v : Date.now());
  let unsubs = [];
  const keep = u => { unsubs.push(u); return u; };

  const store = {
    mode: 'firebase', me: null,

    onAuth(cb) {
      A.onAuthStateChanged(auth, async u => {
        unsubs.forEach(f => { try { f(); } catch (e) {} }); unsubs = [];
        if (!u) { store.me = null; cb({ status: 'signedOut' }); return; }
        const me = { uid: u.uid, name: u.displayName || u.email, email: (u.email || '').toLowerCase(), photo: u.photoURL };
        store.me = me;
        cb({ status: 'loading', user: me });
        try {
          let snap = await F.getDoc(root);
          if (!snap.exists()) {
            // 最初の1回だけ：オーナーとしてスタジオを作成（セキュリティルールでオーナー以外は拒否されます）
            await F.setDoc(root, { name: 'ふたりスタジオ', owner: me.email, members: [me.email], createdAt: F.serverTimestamp() });
            snap = await F.getDoc(root);
          }
          const d = snap.data() || {};
          if (!(d.members || []).includes(me.email)) { cb({ status: 'notMember', user: me }); return; }
          cb({ status: 'ready', user: me, isOwner: d.owner === me.email, members: d.members || [] });
        } catch (e) {
          cb({ status: e && e.code === 'permission-denied' ? 'notMember' : 'error', user: me, error: e });
        }
      });
    },
    async signIn() { await A.signInWithPopup(auth, new A.GoogleAuthProvider()); },
    async signOut() { await A.signOut(auth); },

    onState(cb) {
      return keep(F.onSnapshot(F.doc(db, 'studios', SID, 'state', 'app'),
        s => cb(s.exists() ? s.data() : null, s.metadata.hasPendingWrites)));
    },
    patchState(p) {
      return F.setDoc(F.doc(db, 'studios', SID, 'state', 'app'),
        { ...p, updatedAt: F.serverTimestamp(), updatedBy: store.me.name }, { merge: true });
    },

    onChat(cb) {
      const q = F.query(col('chat'), F.orderBy('at', 'desc'), F.limit(300));
      return keep(F.onSnapshot(q, s => {
        const list = s.docs.map(d => { const v = d.data({ serverTimestamps: 'estimate' }); return { id: d.id, ...v, at: ms(v.at) }; });
        cb(list.reverse());
      }));
    },
    async sendChat(m) {
      await F.addDoc(col('chat'), { uid: store.me.uid, name: store.me.name, x: m.x, ref: m.ref || null, at: F.serverTimestamp() });
    },
    onReads(cb) {
      return keep(F.onSnapshot(col('reads'), s => {
        let mine = 0, others = 0;
        s.docs.forEach(d => { const t = ms(d.data({ serverTimestamps: 'estimate' }).at); if (d.id === store.me.uid) mine = t; else others = Math.max(others, t); });
        cb({ mine, others });
      }));
    },
    markRead() {
      return F.setDoc(F.doc(db, 'studios', SID, 'reads', store.me.uid), { at: F.serverTimestamp(), name: store.me.name });
    },

    onMemos(cb) {
      return keep(F.onSnapshot(col('memos'), s => {
        cb(sortMemos(s.docs.map(d => { const v = d.data({ serverTimestamps: 'estimate' }); return { id: d.id, ...v, updatedAt: ms(v.updatedAt) }; })));
      }));
    },
    async saveMemo(id, data) {
      const meta = { updatedAt: F.serverTimestamp(), updatedBy: store.me.name };
      if (!id) {
        const ref = F.doc(col('memos'));
        await F.setDoc(ref, { title: '', body: '', pinned: false, ...data, ...meta, createdAt: F.serverTimestamp() });
        return ref.id;
      }
      await F.updateDoc(F.doc(db, 'studios', SID, 'memos', id), { ...data, ...meta });
      return id;
    },
    async deleteMemo(id) { await F.deleteDoc(F.doc(db, 'studios', SID, 'memos', id)); },

    onMembers(cb) { return keep(F.onSnapshot(root, s => cb(s.data() || {}))); },
    async setMembers(list) { await F.updateDoc(root, { members: list }); },

    // 曲（アップロードした音源の情報・ミックスの状態・バランス案）
    async getIdToken() { return auth.currentUser ? auth.currentUser.getIdToken() : ''; },
    onSongs(cb) {
      const q = F.query(col('songs'), F.orderBy('createdAt', 'desc'));
      return keep(F.onSnapshot(q, s => cb(s.docs.map(d => {
        const v = d.data({ serverTimestamps: 'estimate' });
        return { id: d.id, ...v, createdAt: ms(v.createdAt), updatedAt: ms(v.updatedAt), _local: d.metadata.hasPendingWrites };
      }))));
    },
    async saveSong(id, data) {
      await F.setDoc(F.doc(db, 'studios', SID, 'songs', id), {
        ...data, createdAt: F.serverTimestamp(), updatedAt: F.serverTimestamp(),
        createdBy: store.me.uid, createdByName: store.me.name, updatedBy: store.me.name
      });
    },
    async updateSong(id, p) {
      await F.updateDoc(F.doc(db, 'studios', SID, 'songs', id), { ...p, updatedAt: F.serverTimestamp(), updatedBy: store.me.name });
    },
    async deleteSong(id) { await F.deleteDoc(F.doc(db, 'studios', SID, 'songs', id)); }
  };
  return store;
}

function sortMemos(list) {
  return list.slice().sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.updatedAt || 0) - (a.updatedAt || 0));
}
