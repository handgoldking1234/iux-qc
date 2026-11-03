/* ScanQC Web · 엔진
   - 내 PC 폴더(로그인 없이): 브라우저가 폴더를 직접 읽고 씀. 이미지는 어디로도 전송되지 않음
   - 팀 작업(로그인): Supabase 저장소의 작업 묶음 · 배정 · 잠금 · 기록
   - 사용 통계: 폴더·파일 이름과 처리 건수만 기록 (관리자 페이지에서 확인) */
(function () {
  'use strict';
  const CFG_DEF = { preview: 2400, auto_mode: 'balance', margin_mm: 10, skew_warn: 0.3, backup: true, prefetch: 1, on_load: 'auto', trim_px: 5, trim_unit: 'px', auto_sec: 3 };
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { } }
  };
  const natcmp = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
  const stemOf = n => n.replace(/\.[^.]+$/, '').toLowerCase();
  const MIME = { '.tif': 'image/tiff', '.tiff': 'image/tiff', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.bmp': 'image/bmp' };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  function uaShort() {
    const u = navigator.userAgent;
    const b = /Edg\//.test(u) ? 'Edge' : /Whale\//.test(u) ? 'Whale' : /Chrome\//.test(u) ? 'Chrome' : /Firefox\//.test(u) ? 'Firefox' : /Safari\//.test(u) ? 'Safari' : 'Browser';
    const o = /Windows/.test(u) ? 'Windows' : /Mac OS/.test(u) ? 'macOS' : /Android/.test(u) ? 'Android' : /Linux/.test(u) ? 'Linux' : '';
    return `${b} · ${o}`;
  }

  /* ================================================================ IndexedDB (최근 폴더 · 진행 상황) */
  const IDB = {
    db: null,
    open() {
      if (this.db) return this.db;
      this.db = new Promise((res, rej) => {
        const r = indexedDB.open('scanqc', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('folders', { keyPath: 'id' });
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      });
      return this.db;
    },
    async tx(mode, fn) {
      const db = await this.open();
      return new Promise((res, rej) => { const t = db.transaction('folders', mode), st = t.objectStore('folders'), q = fn(st); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); });
    },
    all() { return this.tx('readonly', s => s.getAll()).then(r => r || []); },
    put(v) { return this.tx('readwrite', s => s.put(v)); },
    del(id) { return this.tx('readwrite', s => s.delete(id)); }
  };

  /* ================================================================ 클라우드 (Supabase) */
  const Cloud = {
    ok: false, sb: null, user: null, profile: null, token: null, cfg: null,
    init() {
      const c = window.SCANQC_CONFIG || {};
      if (!c.supabaseUrl || !c.supabaseKey || !window.supabase) return false;
      this.cfg = c;
      this.sb = window.supabase.createClient(c.supabaseUrl, c.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'scanqc-auth' } });
      this.sb.auth.onAuthStateChange((_e, s) => { this.token = s ? s.access_token : null; this.user = s ? s.user : null; });
      this.ok = true; return true;
    },
    email(id) { id = (id || '').trim(); return id.includes('@') ? id : `${id.toLowerCase()}@scanqc.local`; },
    ko(err) {
      const m = (err && err.message) || String(err);
      if (/Invalid login/i.test(m)) return '아이디 또는 비밀번호가 맞지 않습니다';
      if (/already registered|already exists/i.test(m)) return '이미 있는 아이디입니다';
      if (/Password should be|at least 6/i.test(m)) return '비밀번호는 6자 이상이어야 합니다';
      if (/Email not confirmed/i.test(m)) return '이메일 인증이 꺼져 있어야 합니다 · 관리자에게 Supabase 설정(Confirm email 끄기)을 요청하세요';
      if (/rate limit/i.test(m)) return '잠시 후 다시 시도해 주세요';
      if (/Failed to fetch|NetworkError/i.test(m)) return '서버에 연결할 수 없습니다';
      return m;
    },
    async session() {
      if (!this.ok) return null;
      const { data } = await this.sb.auth.getSession();
      this.token = data.session ? data.session.access_token : null; this.user = data.session ? data.session.user : null;
      if (this.user) await this.loadProfile(); else this.profile = null;
      return this.user;
    },
    async loadProfile() {
      const { data } = await this.sb.from('profiles').select('*').eq('id', this.user.id).maybeSingle();
      this.profile = data || null; return this.profile;
    },
    async signIn(id, pw) {
      const { error } = await this.sb.auth.signInWithPassword({ email: this.email(id), password: pw });
      if (error) throw new Error(this.ko(error));
      await this.session(); return this.profile;
    },
    async signUp(id, name, pw) {
      const login = (id || '').trim().toLowerCase();
      if (!/^[a-z0-9._@-]{2,40}$/.test(login)) throw new Error('아이디는 영문 소문자·숫자 2자 이상으로 정해 주세요');
      const { data, error } = await this.sb.auth.signUp({ email: this.email(login), password: pw, options: { data: { login: login.split('@')[0], name: (name || '').trim() } } });
      if (error) throw new Error(this.ko(error));
      if (!data.session) throw new Error('가입은 됐지만 바로 로그인할 수 없어요 · Supabase 의 이메일 인증(Confirm email)을 꺼 주세요');
      await this.session(); return this.profile;
    },
    async signOut() { if (this.ok) await this.sb.auth.signOut(); this.user = null; this.profile = null; this.token = null; },
    get member() { return !!(this.profile && this.profile.approved); },
    get admin() { return !!(this.profile && this.profile.approved && this.profile.role === 'admin'); },
    async rpc(name, args) { const { data, error } = await this.sb.rpc(name, args); if (error) throw new Error(this.ko(error)); return data; },
    /* 창을 닫는 순간에도 전송되도록 (keepalive) */
    rpcBeacon(name, args) {
      if (!this.ok) return Promise.resolve();
      return fetch(`${this.cfg.supabaseUrl}/rest/v1/rpc/${name}`, {
        method: 'POST', keepalive: true,
        headers: { 'Content-Type': 'application/json', apikey: this.cfg.supabaseKey, Authorization: 'Bearer ' + (this.token || this.cfg.supabaseKey) },
        body: JSON.stringify(args)
      });
    },
    async all(build) { // 1000행 제한을 넘는 목록
      const out = []; for (let from = 0; ; from += 1000) {
        const { data, error } = await build().range(from, from + 999); if (error) throw new Error(this.ko(error));
        out.push(...data); if (data.length < 1000) break;
      } return out;
    },
    async projects() { const { data, error } = await this.sb.from('projects').select('id,name,note,cfg,archived,created_at').eq('archived', false).order('created_at', { ascending: false }); if (error) throw new Error(this.ko(error)); return data; }
  };

  /* ================================================================ 사용 통계 */
  const Usage = {
    sid: null, session: null, q: [], seen: new Set(), t: null,
    anon() { let a = LS.get('scanqc:anon'); if (!a) { a = uuid(); LS.set('scanqc:anon', a); } return a; },
    start(info) {
      this.flush(); this.sid = uuid(); this.seen = new Set();
      this.session = Object.assign({ id: this.sid, anon_id: this.anon(), ua: uaShort() }, info);
      this.track('open');
    },
    track(action, file, status, detail) {
      if (!this.sid || !Cloud.ok) return;
      if (action === 'view') { if (this.seen.has(file)) return; this.seen.add(file); }
      const e = { id: uuid(), action, at: new Date().toISOString() }; if (file) e.file = file; if (status) e.status = status; if (detail) e.detail = detail;
      this.q.push(e); this.keep(); clearTimeout(this.t); this.t = setTimeout(() => this.flush(), 2000);
    },
    /* 보내기 전 기록은 브라우저에 보관 → 창이 갑자기 닫혀도 다음 방문 때 마저 보냄 (기록마다 id 가 있어 두 번 세지 않음) */
    keep() { const all = LS.get('scanqc:usage_pending', []).filter(x => x.session.id !== this.sid); if (this.q.length) all.push({ session: this.session, events: this.q.slice(-500) }); LS.set('scanqc:usage_pending', all.slice(-20)); },
    flush(beacon) {
      clearTimeout(this.t);
      if (!this.q.length || !this.session || !Cloud.ok) return;
      const events = this.q.slice(0, 300), body = { p: { session: this.session, events } };
      if (beacon) { Cloud.rpcBeacon('usage_track', body).catch(() => { }); return; }
      Cloud.rpc('usage_track', body).then(() => { const ids = new Set(events.map(e => e.id)); this.q = this.q.filter(e => !ids.has(e.id)); this.keep(); }).catch(() => { });
    },
    async resend() {
      if (!Cloud.ok) return;
      const all = LS.get('scanqc:usage_pending', []); if (!all.length) return;
      LS.del('scanqc:usage_pending');
      for (const b of all) { try { await Cloud.rpc('usage_track', { p: b }); } catch (e) { } }
    }
  };

  /* ================================================================ 파일 한 장 */
  class FileRec {
    constructor(o) { Object.assign(this, { hpVer: 0, origVer: 0, hasBackup: false, qc: null, status: '' }, o); }
    has(side) { return side === 'hp' ? !!this.hpName : !!this.origName; }
    get target() { return this.hpName || this.origName; }
  }

  /* ================================================================ 내 PC 폴더 */
  class LocalSource {
    constructor(origDir, hpDir, rec) { this.kind = 'local'; this.o = origDir; this.h = hpDir; this.rec = rec; this.persistT = null; }
    get label() { return { mode: 'local', orig_folder: this.o.name, hp_folder: this.h.name }; }
    get title() { return `${this.rec.origPath || this.o.name} → ${this.rec.hpPath || this.h.name}`; }
    static async list(dir) {
      const m = new Map();
      for await (const [n, hd] of dir.entries()) {
        if (hd.kind !== 'file' || n.startsWith('.') || n.startsWith('~')) continue;
        if (!Codec.EXTS.includes(Codec.extOf(n))) continue;
        const s = stemOf(n); if (!m.has(s)) m.set(s, { name: n, h: hd });
      }
      return m;
    }
    async open() {
      if (!(await IDB.all().then(() => true, () => false))) await this.loadFromFolder();
      const [H, O] = await Promise.all([LocalSource.list(this.h), LocalSource.list(this.o)]);
      const stems = [...new Set([...H.keys(), ...O.keys()])].sort(natcmp), st = this.rec.statuses || {};
      this.files = stems.map(s => {
        const h = H.get(s), o = O.get(s), name = (h || o).name;
        return new FileRec({ name, stem: s, hpName: h ? h.name : null, origName: o ? o.name : null, hpH: h ? h.h : null, origH: o ? o.h : null, status: st[name] || '' });
      });
      this.by = new Map(this.files.map(f => [f.name, f]));
      let resume = this.files.findIndex(f => f.name === this.rec.last);
      if (resume < 0) resume = Math.max(0, this.files.findIndex(f => !f.status));
      this.rec.updated = Date.now(); this.persist();
      return resume;
    }
    file(n) { return this.by.get(n); }
    async stat(name, side) { const f = this.file(name), file = await (side === 'hp' ? f.hpH : f.origH).getFile(); return file; }
    async ver(name, side) { const file = await this.stat(name, side); return file.lastModified + '_' + file.size; }
    async read(name, side) { const file = await this.stat(name, side); return { buf: await file.arrayBuffer(), ver: file.lastModified + '_' + file.size }; }
    /* 백업 위치: 브라우저 안 저장소. 파일을 직접 열어(file://) 그게 막혀 있으면 보정본 폴더 안 .scanqc 폴더 */
    async backupDir(create) {
      try { const root = await navigator.storage.getDirectory(), b = await root.getDirectoryHandle('backup', { create: true }); return await b.getDirectoryHandle(this.rec.id, { create }); }
      catch (e) { if (e && e.name === 'NotFoundError') throw e; const d = await this.h.getDirectoryHandle('.scanqc', { create: true }); return d.getDirectoryHandle('backup', { create }); }
    }
    async hasBackup(name) {
      const f = this.file(name); if (!f || !f.hpName) return false;
      try { const d = await this.backupDir(false); await d.getFileHandle(f.hpName); return true; } catch (e) { return false; }
    }
    async backup(name) {
      const f = this.file(name), d = await this.backupDir(true), src = await f.hpH.getFile();
      const w = await (await d.getFileHandle(f.hpName, { create: true })).createWritable(); await w.write(src); await w.close();
    }
    async writeHP(name, bytes, status, log) {
      const f = this.file(name), target = f.target;
      if (Engine.cfg.backup && f.hpH && !(await this.hasBackup(name))) { try { await this.backup(name); } catch (e) { console.warn('backup', e); } }
      const hd = (f.hpH && f.hpName === target) ? f.hpH : await this.h.getFileHandle(target, { create: true });
      const w = await hd.createWritable(); await w.write(bytes); await w.close();
      f.hpH = hd; f.hpName = target;
      this.setStatus(name, status, log && log.action, log && log.detail);
    }
    async restore(name) {
      const f = this.file(name), d = await this.backupDir(false), src = await (await d.getFileHandle(f.hpName)).getFile();
      const w = await f.hpH.createWritable(); await w.write(src); await w.close();
      this.setStatus(name, '', 'restore');
    }
    setStatus(name, status, action, detail) {
      const f = this.file(name); if (!f) return; f.status = status;
      this.rec.statuses = this.rec.statuses || {}; this.rec.statuses[name] = status;
      const logs = this.rec.logs = this.rec.logs || [];
      logs.push([new Date().toISOString(), name, action || 'status', status || '', detail ? JSON.stringify(detail) : '']);
      if (logs.length > 20000) logs.splice(0, logs.length - 20000);
      this.persist();
    }
    setLast(name) { this.rec.last = name; this.persist(); }
    persist() {
      clearTimeout(this.persistT);
      this.persistT = setTimeout(() => IDB.put(this.rec).catch(() => this.saveInFolder()), 500);
    }
    /* 브라우저 저장소를 못 쓸 때(파일 직접 열기): 진행 상황을 보정본 폴더 안 .scanqc/session.json 에 */
    async saveInFolder() {
      try {
        const d = await this.h.getDirectoryHandle('.scanqc', { create: true }), w = await (await d.getFileHandle('session.json', { create: true })).createWritable();
        const { orig, hp, ...plain } = this.rec; await w.write(JSON.stringify(plain)); await w.close();
      } catch (e) { console.warn('session save', e); }
    }
    async loadFromFolder() {
      try { const d = await this.h.getDirectoryHandle('.scanqc'), t = await (await (await d.getFileHandle('session.json')).getFile()).text(), v = JSON.parse(t);
        if (!Object.keys(this.rec.statuses || {}).length) { this.rec.statuses = v.statuses || {}; this.rec.last = v.last; this.rec.logs = v.logs || []; if (v.id) this.rec.id = v.id; } } catch (e) { }
    }
    async claim() { return { ok: true }; }
    async release() { }
    setQc() { }
    draftKey() { return 'scanqc:drafts:' + this.rec.id; }
    draft(name, edits, status, beacon, ver) { const d = LS.get(this.draftKey(), {}); if (edits) d[name] = { edits, status, ver: ver || '' }; else delete d[name]; LS.set(this.draftKey(), d); }
    drafts() { const d = LS.get(this.draftKey(), {}); return Object.keys(d).filter(n => this.by.has(n)).map(n => ({ name: n, edits: d[n].edits, status: d[n].status, ver: d[n].ver })); }
    logsCsv() {
      const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
      return '﻿' + [['time', 'hp_folder', 'file', 'action', 'status', 'detail'], ...(this.rec.logs || []).map(r => [r[0], this.h.name, r[1], r[2], r[3], r[4]])].map(r => r.map(q).join(',')).join('\r\n');
    }
  }

  /* ================================================================ 팀 작업 (클라우드 묶음) */
  class CloudSource {
    constructor(project) { this.kind = 'cloud'; this.p = project; this.pid = project.id; this.hb = null; this.held = new Set(); }
    get label() { return { mode: 'cloud', project_id: this.pid, orig_folder: this.p.name, hp_folder: this.p.name }; }
    get title() { return this.p.name; }
    get st() { return Cloud.sb.storage.from('scans'); }
    path(side, n) { return `${this.pid}/${side}/${n}`; }
    async open() {
      const rows = await Cloud.all(() => Cloud.sb.from('files').select('id,stem,name,orig_name,hp_name,orig_ver,hp_ver,has_backup,status,qc,assignee,draft,draft_status,draft_by,seq').eq('project_id', this.pid).order('seq'));
      this.files = rows.map(r => new FileRec({ id: r.id, name: r.name, stem: r.stem, hpName: r.hp_name, origName: r.orig_name, hpVer: r.hp_ver, origVer: r.orig_ver,
        hasBackup: r.has_backup, status: r.status || '', qc: r.qc, assignee: r.assignee, draft: r.draft_by === (Cloud.user && Cloud.user.id) ? r.draft : null, draftStatus: r.draft_status }));
      this.by = new Map(this.files.map(f => [f.name, f]));
      const me = Cloud.user && Cloud.user.id;
      let resume = this.files.findIndex(f => !f.status && (!f.assignee || f.assignee === me));
      return Math.max(0, resume);
    }
    file(n) { return this.by.get(n); }
    async ver(name, side) { const f = this.file(name); return String(side === 'hp' ? f.hpVer : f.origVer); }
    async read(name, side) {
      const f = this.file(name), n = side === 'hp' ? f.hpName : f.origName;
      const { data, error } = await this.st.download(this.path(side, n));
      if (error) throw new Error('파일을 내려받지 못했습니다 · ' + (error.message || n));
      return { buf: await data.arrayBuffer(), ver: String(side === 'hp' ? f.hpVer : f.origVer) };
    }
    async hasBackup(name) { const f = this.file(name); return !!(f && f.hasBackup); }
    async writeHP(name, bytes, status, log) {
      const f = this.file(name), target = f.target; let backed = false;
      if (Engine.cfg.backup && f.hpName && !f.hasBackup) {
        const { error } = await this.st.copy(this.path('hp', f.hpName), this.path('backup', f.hpName));
        backed = !error || /exist|duplicate/i.test(error.message || '');
      }
      const { error } = await this.st.upload(this.path('hp', target), new Blob([bytes], { type: MIME[Codec.extOf(target)] || 'application/octet-stream' }), { upsert: true, contentType: MIME[Codec.extOf(target)], cacheControl: '0' });
      if (error) throw new Error('업로드 실패 · ' + (error.message || '') + (/row-level|security/i.test(error.message || '') ? ' (다른 사람이 작업 중이거나 잠금이 풀렸어요)' : ''));
      const r = await Cloud.rpc('file_saved', { p_id: f.id, p_status: status, p_hp_name: target, p_hp_bytes: bytes.length, p_backup: backed, p_action: (log && log.action) || 'save', p_detail: (log && log.detail) || null });
      f.hpName = target; f.hpVer = r.hp_ver; f.hasBackup = r.has_backup; f.status = status; f.draft = null;
    }
    async restore(name) {
      const f = this.file(name);
      const { data, error } = await this.st.download(this.path('backup', f.hpName)); if (error) throw new Error('백업이 없습니다');
      const up = await this.st.upload(this.path('hp', f.hpName), data, { upsert: true, cacheControl: '0' }); if (up.error) throw new Error(up.error.message);
      await Cloud.rpc('set_file_status', { p_id: f.id, p_status: '', p_action: 'restore' }); f.hpVer++; f.status = '';
    }
    setStatus(name, status, action) { const f = this.file(name); f.status = status; return Cloud.rpc('set_file_status', { p_id: f.id, p_status: status, p_action: action || 'status' }); }
    setLast() { }
    async claim(name) {
      const f = this.file(name); const r = await Cloud.rpc('claim_file', { p_id: f.id });
      if (r.ok) {
        this.held.add(name);
        if (r.hp_ver !== f.hpVer || r.orig_ver !== f.origVer) { f.hpVer = r.hp_ver; f.origVer = r.orig_ver; Engine.forget(name); }
        f.status = r.status || ''; f.hasBackup = r.has_backup;
        if (r.draft) { f.draft = r.draft; f.draftStatus = r.draft_status; }
        clearInterval(this.hb); this.hb = setInterval(() => { if (this.held.has(name)) Cloud.rpc('claim_file', { p_id: f.id }).catch(() => { }); }, 30000);
      }
      return r;
    }
    async release(name) { const f = this.file(name); if (!f || !this.held.has(name)) return; this.held.delete(name); await Cloud.rpc('release_file', { p_id: f.id }).catch(() => { }); }
    setQc(name, qc) { const f = this.file(name); if (!f || (f.qc || null) === (qc || null)) return; f.qc = qc || null; Cloud.rpc('set_qc', { p_id: f.id, p_qc: qc || '' }).catch(() => { }); }
    draftKey() { return 'scanqc:cdrafts:' + this.pid; }
    draft(name, edits, status, beacon) {
      const f = this.file(name); if (!f) return;
      const d = LS.get(this.draftKey(), {}); if (edits) d[name] = { edits, status, ver: String(f.hpVer) }; else delete d[name]; LS.set(this.draftKey(), d);
      f.draft = edits || null;
      const args = { p_id: f.id, p_edits: edits || null, p_status: status || 'edited' };
      return beacon ? Cloud.rpcBeacon('save_draft', args).catch(() => { }) : Cloud.rpc('save_draft', args).catch(() => { });
    }
    drafts() {
      const out = new Map(), ls = LS.get(this.draftKey(), {});
      for (const f of this.files) if (f.draft) out.set(f.name, { name: f.name, edits: f.draft, status: f.draftStatus || 'edited' });
      for (const n of Object.keys(ls)) if (this.by.has(n)) out.set(n, { name: n, edits: ls[n].edits, status: ls[n].status, ver: ls[n].ver });
      return [...out.values()];
    }
    close() { clearInterval(this.hb); for (const n of [...this.held]) this.release(n); }
  }

  /* ================================================================ 분석 작업 스레드 */
  let worker = null, wid = 0; const wcb = new Map();
  function analyzeAsync(g, w, h, meta, cfg) {
    try {
      if (!worker) { const src = '(' + ScanQCAnalyzeModule.toString() + ')(self);self.onmessage=e=>{const{id,g,w,h,meta,cfg}=e.data;try{self.postMessage({id,res:self.Analyze.analyze(g,w,h,meta,cfg)})}catch(err){self.postMessage({id,err:String(err&&err.message||err)})}};';
        worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));  /* 파일을 직접 열어도(file://) 동작 */ worker.onmessage = e => { const c = wcb.get(e.data.id); if (c) { wcb.delete(e.data.id); e.data.err ? c.rej(new Error(e.data.err)) : c.res(e.data.res); } }; }
      return new Promise((res, rej) => { const id = ++wid; wcb.set(id, { res, rej }); worker.postMessage({ id, g, w, h, meta, cfg }); });
    } catch (e) { return Promise.resolve(Analyze.analyze(g, w, h, meta, cfg)); }
  }

  /* ================================================================ 캔버스 도우미 */
  function mk(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
  /* 고품질 축소: 절반씩 줄인 뒤 마지막에 맞춤 */
  function shrinkTo(src, W, H) {
    let cur = src, cw = src.width, ch = src.height;
    while (cw / 2 >= W && ch / 2 >= H) {
      const nx = mk(cw / 2, ch / 2), x = nx.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(cur, 0, 0, nx.width, nx.height);
      cur = nx; cw = nx.width; ch = nx.height;
    }
    const out = mk(W, H), o = out.getContext('2d', { willReadFrequently: true }); o.imageSmoothingQuality = 'high'; o.drawImage(cur, 0, 0, out.width, out.height);
    return out;
  }
  function fit(src, max) { const s = Math.min(1, max / Math.max(src.width, src.height)); return s >= 1 ? src : shrinkTo(src, Math.max(1, Math.round(src.width * s)), Math.max(1, Math.round(src.height * s))); }
  function grayOf(cv) {
    const s = Math.min(1, 1000 / Math.max(cv.width, cv.height)), g = s < 1 ? shrinkTo(cv, Math.max(1, Math.round(cv.width * s)), Math.max(1, Math.round(cv.height * s))) : cv;
    const d = g.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, g.width, g.height).data, out = new Uint8Array(g.width * g.height);
    for (let i = 0, j = 0; i < out.length; i++, j += 4) out[i] = (d[j] * 19595 + d[j + 1] * 38470 + d[j + 2] * 7471 + 0x8000) >> 16;
    return { g: out, w: g.width, h: g.height };
  }
  function resizeCanvas(cv, z) {
    if (!z || z.mode === 'none') return cv;
    const W = cv.width, H = cv.height; let s = 1;
    if (z.mode === 'percent') s = (+z.value || 100) / 100; else if (z.mode === 'long') s = (+z.value || Math.max(W, H)) / Math.max(W, H);
    if (!(s > 0) || Math.abs(s - 1) < 1e-4) return cv;
    const w = Math.max(1, Math.round(W * s)), h = Math.max(1, Math.round(H * s));
    if (s < 1) return shrinkTo(cv, w, h);
    const o = mk(w, h), x = o.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(cv, 0, 0, w, h); return o;
  }
  /* 가장자리 줄 통계 (원본 해상도): 바깥쪽부터 40줄의 평균 밝기와 아주 어둡거나 하얀 점의 비율 */
  /* 가장자리 띠 (원본 해상도): 바깥쪽부터 최대 260줄의 밝기를 그대로 보관 → 설정(px/mm)이 바뀌어도 다시 디코딩 안 함 */
  function edgeStats(cv) {
    const W = cv.width, H = cv.height, D = Math.max(1, Math.min(260, Math.floor(Math.min(W, H) / 4))), x = cv.getContext('2d', { willReadFrequently: true });
    const strip = (d, w, h, horiz, rev) => {
      const n = horiz ? h : w, len = horiz ? w : h, a = new Uint8Array(n * len);
      for (let k = 0; k < n; k++) { const q = rev ? n - 1 - k : k;
        for (let t = 0; t < len; t++) { const i = (horiz ? q * w + t : t * w + q) * 4; a[k * len + t] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 + .5 } }
      return { D: n, len, a };
    };
    return { t: strip(x.getImageData(0, 0, W, D).data, W, D, true, false), b: strip(x.getImageData(0, H - D, W, D).data, W, D, true, true),
      l: strip(x.getImageData(0, 0, D, H).data, D, H, false, false), r: strip(x.getImageData(W - D, 0, D, H).data, D, H, false, true) };
  }
  /* 테두리(검은 띠·그림자·선·흰 빈 줄)만 골라 최대 maxPx 까지: 안쪽 종이 밝기와 다른 줄 중 가장 바깥에서 먼 것까지 자름 */
  function trimFrom(st, maxPx) {
    const o = { l: 0, t: 0, r: 0, b: 0 }; if (!st || !(maxPx > 0)) return o;
    for (const k of ['l', 't', 'r', 'b']) {
      const s = st[k]; if (!s || !s.a) continue; const { D, len, a } = s, mx = Math.min(Math.round(maxPx), D - 8); if (mx <= 0) continue;
      const mean = i => { let v = 0; for (let t = i * len, e = t + len; t < e; t++) v += a[t]; return v / len };
      const inner = []; for (let i = mx; i < Math.min(D, mx + 30); i++) inner.push(mean(i)); inner.sort((p, q) => p - q);
      const ref = inner[inner.length >> 1];
      for (let i = 0; i < mx; i++) { let dev = 0; for (let t = i * len, e = t + len; t < e; t++) if (Math.abs(a[t] - ref) > 50) dev++;
        if (Math.abs(mean(i) - ref) > 40 || dev / len > 0.25) o[k] = i + 1 }
    }
    return o;
  }
  function trimMax(cfg, meta) {
    const v = +cfg.trim_px || 0; if (cfg.trim_unit !== 'mm') return v;
    const dpi = (meta && meta.dpi && +meta.dpi[0]) || 300; return Math.round(v * dpi / 25.4);
  }
  function summary(e) {
    if (!e) return null;
    return { rot: e.rot || 0, tilt: e.tilt || 0, crop: !!e.crop, paints: (e.paints || []).length, locals: (e.locals || []).length, pre: !!e.pre,
      color: !!(e.color && Engine.colorDefault && !Engine.colorDefault(e.color)), resize: e.resize && e.resize.mode !== 'none' ? e.resize.mode : undefined };
  }

  /* ================================================================ 엔진 */
  const Engine = {
    cfg: Object.assign({}, CFG_DEF, LS.get('scanqc:cfg', {})),
    src: null, dec: new Map(), an: new Map(), jobs: new Map(), pending: 0,
    render: null, isDefault: null, colorDefault: null,   // index.html 의 보정 함수(화면과 똑같은 결과)
    LS, IDB, Cloud, Usage, LocalSource, CloudSource, FileRec,

    setCfg(b) {
      for (const k of Object.keys(CFG_DEF)) if (k in b) this.cfg[k] = b[k];
      const keep = {}; for (const k of Object.keys(CFG_DEF)) keep[k] = this.cfg[k]; LS.set('scanqc:cfg', keep);
      return this.cfg;
    },
    async open(src) {
      if (this.src && this.src.close) this.src.close();
      this.src = src; this.dec.clear(); this.an.clear(); this.jobs.clear();
      if (src.kind === 'cloud' && src.p.cfg) for (const k of ['auto_mode', 'margin_mm', 'skew_warn', 'backup']) if (k in src.p.cfg) this.cfg[k] = src.p.cfg[k];
      const resume = await src.open();
      Usage.start(Object.assign({ file_count: src.files.length }, src.label));
      return { files: src.files.map(f => ({ name: f.name, hp: f.has('hp'), orig: f.has('orig'), status: f.status, qc: f.qc || null })), resume, title: src.title };
    },
    forget(name) { for (const k of [...this.dec.keys()]) if (k.startsWith(name + '|')) this.dec.delete(k); for (const k of [...this.an.keys()]) if (k.startsWith(name + '|')) this.an.delete(k); },
    /* 한 파일 한 면(원본/보정본)을 읽어 전체 해상도 · 미리보기 · 분석용 회색조로 */
    decoded(name, side, src) {
      src = src || this.src; const cache = src === this.src ? this.dec : new Map();
      return (async () => {
        const ver = await src.ver(name, side), key = `${name}|${side}|${ver}`;
        let p = cache.get(key);
        if (!p) {
          p = (async () => {
            const r = await src.read(name, side), d = await Codec.decode(r.buf, name);
            const full = mk(d.meta.w, d.meta.h), x = full.getContext('2d', { willReadFrequently: true });
            if (d.rgba) x.putImageData(new ImageData(d.rgba, d.meta.w, d.meta.h), 0, 0);
            else { x.fillStyle = '#fff'; x.fillRect(0, 0, full.width, full.height); x.drawImage(d.bitmap, 0, 0); d.bitmap.close && d.bitmap.close(); }
            const prev = fit(full, +this.cfg.preview || 2400), gr = grayOf(prev);
            return { meta: d.meta, full, prev, gray: gr, ver, edges: edgeStats(full) };
          })();
          cache.set(key, p);
          p.catch(() => cache.delete(key));
          while (cache.size > 6) cache.delete(cache.keys().next().value);  // 오래된 것부터 메모리에서 비움
        } else { cache.delete(key); cache.set(key, p); }
        return p;
      })();
    },
    async analysis(name, side, d) {
      const c = this.cfg, key = `${name}|${side}|${d.ver}|${c.auto_mode}|${c.margin_mm}`;
      if (!this.an.has(key)) { const p = analyzeAsync(d.gray.g, d.gray.w, d.gray.h, d.meta, { auto_mode: c.auto_mode, margin_mm: c.margin_mm }); this.an.set(key, p); p.catch(() => this.an.delete(key)); }
      return this.an.get(key);
    },
    async info(name) {
      if (this.jobs.has(name)) await this.jobs.get(name).catch(() => { });
      const f = this.src.file(name); if (!f) throw new Error('목록에 없는 파일: ' + name);
      const out = { name, hp: null, orig: null };
      for (const side of ['hp', 'orig']) if (f.has(side)) {
        const d = await this.decoded(name, side), an = await this.analysis(name, side, d);
        out[side] = { meta: d.meta, pw: d.prev.width, ph: d.prev.height, an, v: d.ver, trim: trimFrom(d.edges, trimMax(this.cfg, d.meta)) };
      }
      out.qc = Analyze.qc(out.hp, out.orig, this.cfg);
      out.status = f.status; out.backup = await this.src.hasBackup(name);
      return out;
    },
    async image(name, side, full) { const d = await this.decoded(name, side); return full ? d.full : d.prev; },
    async claim(name) { this.src.setLast(name); return this.src.claim(name); },
    /* 다른 파일로 넘어갈 때: 저장이 끝난 뒤 잠금 해제 */
    leave(name) { if (!name || !this.src) return; const j = this.jobs.get(name), src = this.src; (j ? j.catch(() => { }) : Promise.resolve()).then(() => { if (this.src === src && !this.jobs.has(name)) src.release(name); }); },
    queue(name, fn) {
      const prev = this.jobs.get(name) || Promise.resolve();
      const p = prev.catch(() => { }).then(fn);
      this.jobs.set(name, p); this.pending++;
      const done = () => { this.pending--; if (this.jobs.get(name) === p) this.jobs.delete(name); };
      p.then(done, done);
      return p;
    },
    encodeCanvas(cv, ref, target) {
      const rgba = cv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, cv.width, cv.height).data;
      return Codec.encode(rgba, cv.width, cv.height, ref, target, cv);
    },
    async save(name, edits, status) {
      status = ['auto', 'edited', 'copied'].includes(status) ? status : 'edited';
      const src = this.src, f = src.file(name); if (!f) throw new Error('목록에 없는 파일: ' + name);
      const baseSide = (edits.base === 'orig' || !f.has('hp')) ? 'orig' : 'hp';
      if (!f.has(baseSide)) throw new Error('기준 이미지 파일이 없습니다');
      const pre = baseSide === 'orig' ? edits.pre : null;
      if (baseSide === 'orig' && this.isDefault(edits) && !pre) return this.copy(name, status === 'auto' ? 'auto' : 'copied');
      return this.queue(name, async () => {
        const d = await this.decoded(name, baseSide, src);
        const ref = f.has('hp') ? (await this.decoded(name, 'hp', src)).meta : d.meta;
        let cv = d.full, meta = d.meta;
        if (pre) { cv = this.render(cv, meta, pre); meta = Object.assign({}, meta, { w: cv.width, h: cv.height }); }
        cv = resizeCanvas(this.render(cv, meta, edits), edits.resize);
        const bytes = await this.encodeCanvas(cv, ref, f.target);
        await src.writeHP(name, bytes, status, { action: status === 'auto' ? 'save_auto' : 'save', detail: summary(edits) });
        if (src === this.src) this.forget(name); src.draft(name, null);
        Usage.track('save', name, status, summary(edits));
        return { status, size: [cv.width, cv.height] };
      });
    },
    async copy(name, status) {
      status = status || 'copied';
      const src = this.src, f = src.file(name); if (!f || !f.has('orig')) throw new Error('원본 파일이 없습니다');
      return this.queue(name, async () => {
        let bytes;
        if (Codec.extOf(f.target) === Codec.extOf(f.origName)) bytes = new Uint8Array((await src.read(name, 'orig')).buf);
        else { const d = await this.decoded(name, 'orig', src), ref = f.has('hp') ? (await this.decoded(name, 'hp', src)).meta : d.meta; bytes = await this.encodeCanvas(d.full, Object.assign({}, d.meta, { format: ref.format, compression: ref.compression }), f.target); }
        await src.writeHP(name, bytes, status, { action: 'copy_original' });
        if (src === this.src) this.forget(name); src.draft(name, null);
        Usage.track(status === 'auto' ? 'save' : 'copy', name, status);
        return { status };
      });
    },
    async restore(name) {
      return this.queue(name, async () => { await this.src.restore(name); this.forget(name); Usage.track('restore', name); return { status: '' }; });
    },
    async setStatus(name, status) { await this.src.setStatus(name, status, status === 'ok' ? 'confirm' : 'status'); if (status === 'ok') Usage.track('ok', name, 'ok'); this.src.draft(name, null); return { status }; },
    async analyzePre(name, pre) {
      const d = await this.decoded(name, 'orig'), k = d.prev.width / Math.max(1, d.meta.w);
      const out = this.render(d.prev, d.meta, Object.assign({}, pre, { resize: { mode: 'none' } }));
      const m2 = Object.assign({}, d.meta, { w: Math.round(out.width / k), h: Math.round(out.height / k) }), g = grayOf(out);
      return { meta: m2, an: await analyzeAsync(g.g, g.w, g.h, m2, { auto_mode: this.cfg.auto_mode, margin_mm: this.cfg.margin_mm }) };
    },
    async prefetch(names) {
      const src = this.src;
      for (const n of names || []) { if (this.src !== src) return; try { await this.info(n); } catch (e) { } await sleep(30); }
    },
    draft(name, edits, status, ver) { if (this.src) this.src.draft(name, edits, status, false, ver); },
    draftBeacon(name, edits, status, ver) { if (this.src) this.src.draft(name, edits, status, true, ver); },
    /* 창을 닫을 때 남긴 수정 → 다음에 열면 이어서 저장 */
    async flushDrafts(current, onEach) {
      const src = this.src, list = src.drafts().filter(d => d.name !== current && d.edits && typeof d.edits === 'object' && 'rot' in d.edits && d.edits.color);
      let n = 0;
      for (const d of list) {
        if (this.src !== src) return n;
        try {
          const lk = await src.claim(d.name); if (lk.ok === false) continue;
          // 그 사이 다른 사람(다른 프로그램)이 저장했으면 옛 수정으로 덮어쓰지 않음
          const f = src.file(d.name), now = src.kind === 'cloud' ? String(f.hpVer) : (f.has('hp') ? await src.ver(d.name, 'hp') : '');
          if (d.ver != null && d.ver !== now) { src.draft(d.name, null); this.leave(d.name); continue; }
          await this.save(d.name, d.edits, d.status); n++; onEach && onEach(d.name); this.leave(d.name);
        }
        catch (e) { console.warn('draft', d.name, e); }
      }
      return n;
    }
  };

  /* ================================================================ 화면 코드가 쓰던 /api 주소를 그대로 받아 처리 */
  const EngineApi = {
    async get(p) {
      const u = new URL(p, location.href), q = u.searchParams;
      switch (u.pathname.replace(/^.*\/api\//, '/api/')) {
        case '/api/config': return { cfg: Engine.cfg };
        case '/api/info': { const inf = await Engine.info(q.get('name')); if (q.get('cur')) Usage.track('view', q.get('name')); return inf; }
      }
      throw new Error('알 수 없는 요청: ' + p);
    },
    async post(p, b) {
      b = b || {};
      switch (p) {
        case '/api/save': return Engine.save(b.name, b.edits, b.status);
        case '/api/copy': return Engine.copy(b.name);
        case '/api/restore': return Engine.restore(b.name);
        case '/api/status': return Engine.setStatus(b.name, b.status);
        case '/api/prefetch': Engine.prefetch(b.names); return { ok: true };
        case '/api/settings': return { cfg: Engine.setCfg(b) };
        case '/api/analyze': return Engine.analyzePre(b.name, b.pre);
        case '/api/draft': Engine.draft(b.name, b.edits, b.status, b.ver); return { ok: true };
      }
      throw new Error('알 수 없는 요청: ' + p);
    }
  };

  window.Engine = Engine; window.EngineApi = EngineApi;
})();
