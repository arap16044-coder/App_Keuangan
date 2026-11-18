/* App Keuangan: logika aplikasi */
(function () {
  'use strict';

  /* ================= Utilitas ================= */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = new Intl.NumberFormat('id-ID');
  const rp = (n) => (n < 0 ? '−Rp ' : 'Rp ') + nf.format(Math.abs(Math.round(n || 0)));
  /** Motif identitas: "Rp" ringan, angka tebal. sign: '+', '−', atau '' */
  const rpHTML = (n, sign) => {
    const s = sign != null ? sign : (n < 0 ? '−' : '');
    return s + '<span class="rp">Rp</span>' + nf.format(Math.abs(Math.round(n || 0)));
  };
  const NONE = 'Belum ada';
  const rpShort = (n) => {
    const a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(a >= 1e10 ? 0 : 1).replace('.', ',') + ' M';
    if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace('.', ',') + ' jt';
    if (a >= 1e3) return Math.round(n / 1e3) + ' rb';
    return String(Math.round(n));
  };
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const dayDiff = (a, b) => Math.round((b - a) / 864e5);
  const minD = (a, b) => (a < b ? a : b);
  const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const BULAN_PANJANG = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const fmtShort = (d) => d.getDate() + ' ' + BULAN[d.getMonth()];
  const fmtLong = (d) => HARI[d.getDay()] + ', ' + d.getDate() + ' ' + BULAN[d.getMonth()] + ' ' + d.getFullYear();
  const lc = (s) => String(s || '').trim().toLowerCase();
  const PALETTE = ['#4f7cff', '#8b5cf6', '#14b8a6', '#f59e0b', '#ec4899', '#0ea5e9', '#84cc16'];
  const OTHER_COLOR = '#cbd5e1';

  const store = {
    get(k, def) { try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* penyimpanan penuh/diblokir */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* abaikan */ } }
  };

  /* ================= State ================= */
  const DEFAULT_META = {
    categoriesIncome: ['Gaji', 'Bonus', 'Freelance', 'Usaha', 'Investasi', 'Lainnya'],
    categoriesExpense: ['Listrik', 'Air (PDAM)', 'Internet & TV', 'Pulsa & Paket Data', 'BPJS', 'Asuransi', 'Cicilan', 'Kartu Kredit', 'Sewa / KPR', 'Iuran Lingkungan', 'Langganan Digital', 'Pendidikan', 'Makan & Belanja', 'Transportasi', 'Lainnya'],
    monthlyBills: ['Listrik', 'Air (PDAM)', 'Internet & TV', 'Pulsa & Paket Data', 'BPJS', 'Cicilan', 'Kartu Kredit', 'Sewa / KPR', 'Iuran Lingkungan', 'Langganan Digital'],
    columns: null, spreadsheet: '', settings: null
  };
  const defaultSettings = () => ({
    name: '',
    bills: DEFAULT_META.monthlyBills.map((name) => ({ name, due: null, fixed: null, tenor: null, start: null })),
    budgets: {},
    methods: ['Tunai', 'Transfer Bank', 'E-wallet', 'Kartu Kredit', 'Auto-debit'],
    remind: { email: true, days: [3, 1, 0], overdue: true, summary: true, telegram: false, telegramReady: false, telegramChat: '', emailTo: '', scheduled: false }
  });
  /** Pengaturan aktif (dari server; bawaan jika belum ada). */
  const ST = () => (S.meta.settings && S.meta.settings.bills ? S.meta.settings : (S.meta.settings = defaultSettings()));
  const cfg = store.get('ct_cfg', { api: '', key: '' });
  const cache = store.get('ct_cache', null);
  const S = {
    txs: cache ? cache.txs : [],
    meta: Object.assign({}, DEFAULT_META, cache ? cache.meta : {}),
    syncedAt: cache ? cache.at : null,
    loaded: !!cache,
    loading: false,
    online: null,
    view: 'home',
    period: store.get('ct_period', { mode: 'month', from: '', to: '' }),
    hist: { q: '', type: 'all', cat: '', method: '', from: '', to: '', limit: 60 },
    trendType: 'out',
    form: null
  };
  const isDemo = () => cfg.key === 'demo';

  function saveCache() {
    if (isDemo()) return;
    store.set('ct_cache', { txs: S.txs, meta: S.meta, at: S.syncedAt });
  }

  /* ================= API ================= */
  async function api(action, payload) {
    if (isDemo()) return demoApi(action, payload || {});
    if (!cfg.api || !cfg.key) throw Object.assign(new Error('Belum terhubung.'), { code: 'UNAUTHORIZED' });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    let res;
    try {
      res = await fetch(cfg.api, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // tanpa preflight CORS
        body: JSON.stringify(Object.assign({ key: cfg.key, action }, payload || {})),
        signal: ctrl.signal,
        redirect: 'follow',
        cache: 'no-store'
      });
    } catch (e) {
      // code NETWORK = permintaan tidak sampai/terputus; antrean offline akan mencoba lagi
      throw Object.assign(new Error(e.name === 'AbortError' ? 'Server terlalu lama merespons.' : 'Tidak ada koneksi internet.'), { code: 'NETWORK' });
    } finally { clearTimeout(timer); }
    let json;
    try { json = await res.json(); } catch (e) { throw new Error('Respons server tidak valid. Cek URL Apps Script & akses "Anyone".'); }
    if (!json.ok) {
      const err = new Error(json.message || 'Terjadi kesalahan di server.');
      err.code = json.error;
      throw err;
    }
    return json.data;
  }

  /* ================= Mode demo ================= */
  let demoDB = null;
  function demoSeed() {
    const t = today();
    const rows = [];
    let n = 0;
    const add = (type, d, amount, category, note) => rows.push({ id: 'd' + (++n), type, date: iso(d), amount, category, note: note || '' });
    for (let m = 5; m >= 0; m--) {
      const base = new Date(t.getFullYear(), t.getMonth() - m, 1);
      const day = (x) => new Date(base.getFullYear(), base.getMonth(), x);
      const lim = m === 0 ? t.getDate() : 28;
      const at = (x) => (x <= lim ? day(x) : null);
      const wiggle = (v) => Math.round(v * (0.9 + ((m * 7 + v) % 13) / 60) / 1000) * 1000;
      if (at(1)) add('in', at(1), 12500000, 'Gaji', 'Gaji bulanan');
      if (m % 2 === 0 && at(15)) add('in', at(15), 2750000, 'Freelance', 'Proyek desain');
      if (at(2)) add('out', at(2), 3500000, 'Sewa / KPR', 'Cicilan rumah');
      if (at(3)) add('out', at(3), wiggle(620000), 'Listrik', 'Token PLN');
      if (at(5)) add('out', at(5), 385000, 'Internet & TV', 'IndiHome');
      if (at(6) && m !== 0) add('out', at(6), wiggle(175000), 'Air (PDAM)');
      if (at(8)) add('out', at(8), 150000, 'Pulsa & Paket Data', 'Paket 50GB');
      if (at(10)) add('out', at(10), 1250000, 'Cicilan', 'Motor');
      if (at(10) && m !== 0) add('out', at(10), 384000, 'BPJS', '3 orang kelas 2');
      if (at(12)) add('out', at(12), 186000, 'Langganan Digital', 'Netflix + Spotify');
      if (at(4)) add('out', at(4), wiggle(450000), 'Makan & Belanja', 'Belanja bulanan');
      if (at(9)) add('out', at(9), wiggle(220000), 'Transportasi', 'Bensin');
      if (at(14) && m !== 1) add('out', at(14), wiggle(310000), 'Makan & Belanja');
    }
    return rows;
  }
  let demoSettings = null;
  function demoSettingsSeed() {
    const s = defaultSettings();
    const set = (name, o) => Object.assign(s.bills.find((b) => b.name === name), o);
    set('Listrik', { due: 20 }); set('Air (PDAM)', { due: 20 }); set('Internet & TV', { due: 5, fixed: 385000 });
    set('Pulsa & Paket Data', { due: 8, fixed: 150000 }); set('BPJS', { due: 10, fixed: 384000 });
    set('Cicilan', { due: 10, fixed: 1250000, tenor: 24, start: iso(new Date(today().getFullYear(), today().getMonth() - 8, 1)).slice(0, 7) });
    set('Sewa / KPR', { due: 2, fixed: 3500000 }); set('Langganan Digital', { due: 12, fixed: 186000 });
    s.budgets = { 'Makan & Belanja': 900000, 'Transportasi': 250000 };
    s.name = 'Reza';
    s.remind = Object.assign(s.remind, { emailTo: 'pe•••@gmail.com', scheduled: true });
    return s;
  }
  // Mode demo: koneksi bisa dimatikan untuk mencoba antrean offline (Setelan tidak perlu).
  window.__demoOffline = false;
  async function demoApi(action, p) {
    await new Promise((r) => setTimeout(r, 450));
    if (window.__demoOffline) throw Object.assign(new Error('Tidak ada koneksi internet.'), { code: 'NETWORK' });
    if (!demoDB) demoDB = demoSeed();
    if (!demoSettings) demoSettings = demoSettingsSeed();
    const add = (tx) => {
      const ada = tx.id && demoDB.find((x) => x.id === tx.id);
      if (ada) return ada;
      const t = Object.assign({ method: '', receipt: '' }, tx, { id: tx.id || 'd' + Date.now() + Math.random().toString(36).slice(2, 6) });
      demoDB.push(t); return t;
    };
    if (action === 'ping') return { time: new Date().toISOString() };
    if (action === 'list') return { transactions: demoDB.slice(), meta: Object.assign({}, DEFAULT_META, { settings: JSON.parse(JSON.stringify(demoSettings)), monthlyBills: demoSettings.bills.map((b) => b.name), spreadsheet: 'Data contoh', columns: { Pemasukan: { date: 'Tanggal', amount: 'Nominal', category: 'Kategori', note: 'Catatan', id: 'ID' }, Pengeluaran: { date: 'Tanggal', amount: 'Nominal', category: 'Kategori', note: 'Catatan', method: 'Metode', receipt: 'Bukti', id: 'ID' } } }) };
    if (action === 'add') return add(p.tx);
    if (action === 'addMany') return p.txs.map(add);
    if (action === 'update') { const i = demoDB.findIndex((x) => x.id === p.id); if (i < 0) throw new Error('Transaksi tidak ditemukan.'); demoDB[i] = Object.assign({ method: '', receipt: '' }, p.tx, { id: p.id }); return demoDB[i]; }
    if (action === 'delete') { demoDB = demoDB.filter((x) => x.id !== p.id); return { id: p.id, deleted: true }; }
    if (action === 'upload') return { url: 'https://drive.google.com/file/d/demo' + Date.now() + '/view', id: 'demo', name: 'bukti.jpg' };
    if (action === 'saveSettings') {
      const i = p.settings;
      ['bills', 'budgets', 'methods'].forEach((k) => { if (i[k]) demoSettings[k] = JSON.parse(JSON.stringify(i[k])); });
      if (typeof i.name === 'string') demoSettings.name = i.name.trim().slice(0, 30);
      if (i.remind) Object.assign(demoSettings.remind, i.remind);
      if (i.telegramToken && i.telegramChat) Object.assign(demoSettings.remind, { telegramReady: true, telegramChat: i.telegramChat.slice(0, 3) + '•••' + i.telegramChat.slice(-2) });
      if (i.telegramClear) Object.assign(demoSettings.remind, { telegramReady: false, telegramChat: '', telegram: false });
      return JSON.parse(JSON.stringify(demoSettings));
    }
    if (action === 'testReminder') {
      const r = demoSettings.remind; const sent = [];
      if (r.email) sent.push('email'); if (r.telegram && r.telegramReady) sent.push('telegram');
      if (!sent.length) throw new Error('Tidak ada saluran aktif. Nyalakan email atau Telegram dulu.');
      return { sent };
    }
    throw new Error('Aksi tidak dikenal');
  }

  /* ================= Toast ================= */
  function toast(msg, kind = 'ok', action) {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.setAttribute('role', kind === 'err' || kind === 'warn' ? 'alert' : 'status');
    el.innerHTML = '<span class="t-ico" aria-hidden="true">' + (kind === 'err' || kind === 'warn' ? '!' : kind === 'wait' ? '<svg><use href="#i-clock"/></svg>' : '<svg><use href="#i-check"/></svg>') + '</span><span class="t-msg">' + esc(msg) + '</span>';
    if (action) {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = action.label;
      b.onclick = () => { action.fn(); close(); };
      el.appendChild(b);
    }
    $('#toasts').appendChild(el);
    const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 260); };
    setTimeout(close, kind === 'ok' ? 2600 : 5200);
  }

  /* ================= Sinkronisasi ================= */
  function setLoading(on) {
    S.loading = on;
    $('#btnRefresh').classList.toggle('spin', on);
    $('#syncLine').classList.toggle('on', on);
  }

  /* ================= Antrean offline ================= */
  /*
   * Setiap perubahan (tambah/ubah/hapus) langsung tampil di layar dan masuk antrean di HP.
   * Antrean dikirim berurutan saat online. Transaksi baru membawa ID buatan HP, sehingga
   * pengiriman ulang setelah sinyal putus tidak membuat baris dobel di sheet.
   */
  const Q = { list: store.get('ct_queue', []), flushing: false };
  const saveQueue = () => { store.set('ct_queue', Q.list); renderPending(); };
  const newId = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const isPending = (id) => Q.list.some((op) => op.id === id || (op.op === 'addMany' && op.txs.some((t) => t.id === id)));

  function enqueue(op) { Q.list.push(Object.assign({ ts: Date.now() }, op)); saveQueue(); }

  /** Ubah transaksi yang masih di antrean "tambah" (belum sampai server). */
  function patchQueuedAdd(id, tx) {
    for (const op of Q.list) {
      if (op.op === 'add' && op.id === id) { op.tx = Object.assign({}, tx, { id }); saveQueue(); return true; }
      if (op.op === 'addMany') { const i = op.txs.findIndex((t) => t.id === id); if (i >= 0) { op.txs[i] = Object.assign({}, tx, { id }); saveQueue(); return true; } }
    }
    return false;
  }
  function dropQueuedAdd(id) {
    let hit = false;
    Q.list = Q.list.filter((op) => { if (op.op === 'add' && op.id === id) { hit = true; return false; } return true; });
    Q.list.forEach((op) => { if (op.op === 'addMany') { const n = op.txs.length; op.txs = op.txs.filter((t) => t.id !== id); if (op.txs.length !== n) hit = true; } });
    Q.list = Q.list.filter((op) => op.op !== 'addMany' || op.txs.length);
    if (hit) saveQueue();
    return hit;
  }

  function replaceTx(tx) {
    const i = S.txs.findIndex((t) => t.id === tx.id);
    if (i >= 0) S.txs[i] = tx; else S.txs.push(tx);
  }

  /** Kirim antrean. Berhenti jika masih offline; aksi yang ditolak server dibuang dengan pesan. */
  function flushQueue(opts) {
    if (Q.flushing) return Q.promise; // antrean yang baru masuk ikut terkirim di putaran yang sedang jalan
    if (!Q.list.length) return Promise.resolve();
    Q.promise = runQueue(opts || {});
    return Q.promise;
  }
  async function runQueue(opts) {
    Q.flushing = true; renderPending();
    let sent = 0;
    try {
      while (Q.list.length) {
        const op = Q.list[0];
        try {
          if (op.op === 'add') replaceTx(await api('add', { tx: op.tx }));
          else if (op.op === 'addMany') (await api('addMany', { txs: op.txs })).forEach(replaceTx);
          else if (op.op === 'update') replaceTx(await api('update', { id: op.id, origType: op.origType, tx: op.tx }));
          else if (op.op === 'delete') await api('delete', { id: op.id, type: op.type });
          Q.list.shift(); sent++; S.online = true;
        } catch (e) {
          if (e.code === 'NETWORK') { S.online = false; break; }
          if (e.code === 'UNAUTHORIZED') { showSetup('Kunci akses tidak berlaku. Tempel link setup yang baru.'); break; }
          // Ditolak server (mis. data sudah dihapus dari sheet): buang supaya antrean tidak macet.
          Q.list.shift();
          toast('Satu perubahan gagal dikirim: ' + e.message, 'err');
          S.needResync = true;
        }
        store.set('ct_queue', Q.list);
      }
    } finally {
      Q.flushing = false; saveQueue(); saveCache();
      if (sent && !Q.list.length && !opts.quiet) toast(sent === 1 ? 'Perubahan tertunda sudah terkirim' : sent + ' perubahan tertunda sudah terkirim');
      render();
    }
  }

  function renderPending() {
    const n = Q.list.reduce((s, op) => s + (op.op === 'addMany' ? op.txs.length : 1), 0);
    const box = $('#pendingBar');
    if (!box) return;
    box.hidden = !n;
    if (n) {
      $('#pendingText').textContent = n + ' perubahan belum terkirim. Akan dikirim otomatis saat online.';
      $('#pendingSend').disabled = Q.flushing;
      $('#pendingSend').textContent = Q.flushing ? 'Mengirim…' : 'Kirim sekarang';
    }
  }

  async function refresh(silent) {
    if (S.loading) return;
    setLoading(true);
    try {
      await flushQueue();
      if (Q.list.length && S.online === false) throw Object.assign(new Error('Tidak ada koneksi internet.'), { code: 'NETWORK' });
      const data = await api('list');
      S.txs = data.transactions || [];
      S.meta = Object.assign({}, DEFAULT_META, data.meta || {});
      S.needResync = false;
      S.syncedAt = new Date().toISOString();
      S.loaded = true;
      S.online = true;
      S.loadError = '';
      saveCache();
      render();
      if (!silent) toast('Data diperbarui');
    } catch (e) {
      S.online = false;
      if (!S.loaded) S.loadError = e.message;
      if (e.code === 'UNAUTHORIZED') { showSetup('Kunci akses tidak berlaku. Tempel link setup yang baru.'); }
      else if (e.code === 'NETWORK' && S.loaded) { if (!silent) toast('Sedang offline. Data yang tampil adalah data terakhir.', 'wait'); }
      else toast(e.message, 'err', { label: 'Ulangi', fn: () => refresh() });
      render();
    } finally { setLoading(false); }
  }

  /* ================= Periode ================= */
  function range(p) {
    const t = today();
    if (p.mode === 'today') return { from: t, to: t, label: 'Hari ini' };
    if (p.mode === 'week') { const f = addDays(t, -((t.getDay() + 6) % 7)); return { from: f, to: addDays(f, 6), label: 'Minggu ini' }; }
    if (p.mode === 'custom' && p.from && p.to) {
      let f = parseISO(p.from), e = parseISO(p.to);
      if (f > e) [f, e] = [e, f];
      return { from: f, to: e, label: fmtShort(f) + ' – ' + fmtShort(e) + (f.getFullYear() !== t.getFullYear() ? ' ' + f.getFullYear() : '') };
    }
    const f = new Date(t.getFullYear(), t.getMonth(), 1);
    return { from: f, to: new Date(t.getFullYear(), t.getMonth() + 1, 0), label: BULAN_PANJANG[t.getMonth()] + ' ' + t.getFullYear() };
  }
  /** Rentang yang sudah berjalan (sampai hari ini) dan rentang pembanding sebelumnya dengan panjang sama. */
  function compareRanges(p) {
    const r = range(p);
    const t = today();
    const curEnd = r.from > t ? r.to : minD(r.to, t);
    const len = dayDiff(r.from, curEnd) + 1;
    let pf, pt;
    if (p.mode === 'month') {
      pf = new Date(r.from.getFullYear(), r.from.getMonth() - 1, 1);
      const lastPrev = new Date(r.from.getFullYear(), r.from.getMonth(), 0).getDate();
      pt = new Date(pf.getFullYear(), pf.getMonth(), Math.min(curEnd.getDate(), lastPrev));
    } else if (p.mode === 'week' || p.mode === 'today') {
      const shift = p.mode === 'week' ? 7 : 1;
      pf = addDays(r.from, -shift); pt = addDays(curEnd, -shift);
    } else {
      pt = addDays(r.from, -1); pf = addDays(pt, -(len - 1));
    }
    const prevLabel = { today: 'kemarin', week: 'minggu lalu', month: 'periode sama bulan lalu' }[p.mode] || 'periode sebelumnya';
    return { cur: { from: r.from, to: curEnd }, prev: { from: pf, to: pt }, days: len, prevLabel };
  }
  const inRange = (tx, f, t) => { const d = tx.date; return d >= iso(f) && d <= iso(t); };
  const sum = (arr, type) => arr.reduce((s, x) => s + (x.type === type ? x.amount : 0), 0);

  function renderPeriodBars() {
    const p = S.period;
    const html =
      '<div class="period-chips" role="group" aria-label="Periode">' +
      [['today', 'Hari ini'], ['week', 'Minggu ini'], ['month', 'Bulan ini'], ['custom', 'Pilih tanggal']]
        .map(([v, l]) => '<button type="button" class="pchip" data-pm="' + v + '" aria-pressed="' + (p.mode === v) + '">' + l + '</button>').join('') +
      '</div>' +
      (p.mode === 'custom'
        ? '<div class="period-custom">' +
          '<div class="field-inline"><label for="pf-ID">Dari tanggal</label><input class="input" type="date" id="pf-ID" data-pf value="' + esc(p.from) + '"></div>' +
          '<div class="field-inline"><label for="pt-ID">Sampai tanggal</label><input class="input" type="date" id="pt-ID" data-pt value="' + esc(p.to) + '"></div></div>'
        : '');
    $$('[data-period]').forEach((el, i) => { el.innerHTML = html.replace(/-ID/g, '-' + i); });
  }

  /* ================= Render ================= */
  function render() {
    renderPeriodBars();
    renderHeader();
    if (S.view === 'home') renderHome();
    if (S.view === 'history') renderHistory();
    if (S.view === 'stats') renderStats();
    if (S.view === 'settings') renderSettings();
  }

  function renderHeader() {
    const t = today();
    const eyebrow = {
      home: HARI[t.getDay()] + ', ' + t.getDate() + ' ' + BULAN_PANJANG[t.getMonth()],
      history: S.txs.length + ' transaksi',
      stats: range(S.period).label,
      settings: isDemo() ? 'Mode demo' : 'App Keuangan'
    }[S.view];
    $('#topEyebrow').textContent = eyebrow;
    // Di Beranda, judul berupa sapaan sesuai jam; layar lain memakai nama layar.
    $('#topTitle').textContent = S.view === 'home' ? greeting() : $('#view-' + S.view).dataset.title;
  }

  function greeting(now) {
    const h = (now || new Date()).getHours();
    const part = h >= 4 && h < 11 ? 'pagi' : h >= 11 && h < 15 ? 'siang' : h >= 15 && h < 18 ? 'sore' : 'malam';
    const name = String((ST().name || '')).trim();
    return 'Selamat ' + part + (name ? ', ' + name : '');
  }

  /** Keadaan memuat: kerangka abu-abu + teks untuk pembaca layar. Jika gagal dan belum ada data, tampilkan keadaan gagal. */
  function skeleton(n) {
    if (S.loadError) return '<li>' + errorState() + '</li>';
    return '<li class="sr-only">Memuat data…</li>' + Array.from({ length: n }, () => '<li aria-hidden="true"><div class="skel skel-row"></div></li>').join('');
  }

  function emptyState(title, text, withBtn) {
    return '<div class="empty"><div class="empty-ico"><svg aria-hidden="true"><use href="#i-receipt"/></svg></div><b>' + esc(title) + '</b><p>' + esc(text) + '</p>' +
      (withBtn ? '<button type="button" class="btn btn-ghost" data-add>Catat transaksi pertama</button>' : '') + '</div>';
  }

  function errorState() {
    return '<div class="empty error" role="alert"><div class="empty-ico"><svg aria-hidden="true"><use href="#i-alert"/></svg></div><b>Data gagal dimuat</b><p>' + esc(S.loadError) + '</p>' +
      '<button type="button" class="btn btn-ghost" data-retry>Coba muat lagi</button></div>';
  }

  function txItem(t) {
    const cat = t.category || (t.type === 'in' ? 'Pemasukan' : 'Pengeluaran');
    const initial = esc(cat.replace(/[^A-Za-z0-9]/g, '').charAt(0).toUpperCase() || '•');
    const sub = [fmtShort(parseISO(t.date)), t.method, t.note].filter(Boolean).join(' · ');
    const pend = isPending(t.id);
    return '<li><button type="button" class="tx' + (pend ? ' pending' : '') + '" data-edit="' + esc(t.id) + '">' +
      '<span class="tx-ico ' + t.type + '" aria-hidden="true">' + initial + '</span>' +
      '<span class="tx-main"><span class="tx-cat">' + esc(cat) +
      (t.receipt ? ' <svg class="tx-clip" aria-hidden="true"><use href="#i-clip"/></svg><span class="sr-only">, ada foto bukti</span>' : '') + '</span>' +
      '<span class="tx-note">' + (pend ? '<span class="tag-wait"><svg aria-hidden="true"><use href="#i-clock"/></svg>Belum terkirim</span> ' : '') + esc(sub) + '</span></span>' +
      '<span class="tx-amt num ' + t.type + '"><span class="sr-only">' + (t.type === 'in' ? 'Pemasukan ' : 'Pengeluaran ') + '</span>' + rpHTML(t.amount, t.type === 'in' ? '+' : '−') + '</span>' +
      '</button></li>';
  }
  /** Terbaru di atas. Untuk tanggal yang sama, yang dicatat belakangan (baris lebih bawah di sheet) di atas. */
  const sorted = (arr) => arr.map((t, i) => [t, i]).sort((a, b) => (a[0].date < b[0].date ? 1 : a[0].date > b[0].date ? -1 : b[1] - a[1])).map((x) => x[0]);

  function pctChange(cur, prev) {
    if (!prev) return cur ? null : 0;
    return Math.round(((cur - prev) / prev) * 100);
  }

  function computeInsights() {
    const r = range(S.period);
    const c = compareRanges(S.period);
    const inR = S.txs.filter((t) => inRange(t, r.from, r.to));
    const byCat = {};
    inR.filter((t) => t.type === 'out').forEach((t) => { const k = t.category || 'Tanpa kategori'; byCat[k] = (byCat[k] || 0) + t.amount; });
    const top = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0];
    const totalOut = sum(inR, 'out');
    const curTx = S.txs.filter((t) => inRange(t, c.cur.from, c.cur.to));
    const prevTx = S.txs.filter((t) => inRange(t, c.prev.from, c.prev.to));
    const curOut = sum(curTx, 'out'), prevOut = sum(prevTx, 'out');
    const curIn = sum(curTx, 'in'), prevIn = sum(prevTx, 'in');
    return {
      r, c, inR, byCat, totalOut,
      top: top ? { name: top[0], amount: top[1], share: totalOut ? Math.round((top[1] / totalOut) * 100) : 0 } : null,
      avgDaily: c.days > 0 ? sum(curTx, 'out') / c.days : 0,
      outChange: pctChange(curOut, prevOut), inChange: pctChange(curIn, prevIn),
      curOut, prevOut, curIn, prevIn
    };
  }

  function changeHTML(pct, goodWhenDown) {
    if (pct === null) return '<span>baru</span>';
    if (pct === 0) return '<span>sama</span>';
    const up = pct > 0;
    const cls = (up === goodWhenDown) ? 'up' : 'down';
    return '<span class="' + cls + '">' + (up ? '▲ ' : '▼ ') + Math.abs(pct) + '%</span>';
  }

  /* ---------- Beranda ---------- */
  function renderHome() {
    const I = computeInsights();
    const inSum = sum(I.inR, 'in'), outSum = sum(I.inR, 'out');
    $('#heroLabel').textContent = 'Saldo bersih · ' + I.r.label;
    $('#heroValue').innerHTML = S.loaded ? rpHTML(inSum - outSum) : (S.loadError ? 'Gagal dimuat' : 'Memuat…');
    $('#sumIn').innerHTML = S.loaded ? rpHTML(inSum) : '&nbsp;';
    $('#sumOut').innerHTML = S.loaded ? rpHTML(outSum) : '&nbsp;';
    let cmp = '';
    if (S.loaded && (I.curOut || I.prevOut)) {
      if (I.outChange === null) cmp = 'Belum ada pengeluaran di ' + I.c.prevLabel + ' untuk dibandingkan.';
      else if (I.outChange === 0) cmp = 'Pengeluaran sama dengan ' + I.c.prevLabel + '.';
      else cmp = 'Pengeluaran ' + (I.outChange > 0 ? 'naik ' : 'turun ') + Math.abs(I.outChange) + '% dibanding ' + I.c.prevLabel + '.';
    }
    $('#heroCompare').textContent = cmp;
    if (isDemo() && !$('#demoBanner')) {
      $('#view-home').insertAdjacentHTML('afterbegin', '<p class="demo-banner" id="demoBanner">Mode demo: data contoh, tidak tersimpan ke spreadsheet.</p>');
    }

    renderBills();
    renderCalc();
    $('#homeDonut').innerHTML = donutHTML(I);
    $('#homeDonutSub').textContent = I.r.label;
    renderBudgets();
    renderPending();

    $('#insightsHome').innerHTML = S.loaded ? [
      '<div class="insight"><small>Terbesar</small><strong>' + (I.top ? esc(I.top.name) : NONE) + '</strong><span class="sub">' + (I.top ? I.top.share + '% · ' + rpShort(I.top.amount) : 'di periode ini') + '</span></div>',
      '<div class="insight"><small>Rata-rata/hari</small><strong class="num">' + rpShort(I.avgDaily) + '</strong><span class="sub">' + I.c.days + ' hari berjalan</span></div>',
      '<div class="insight"><small>vs ' + (S.period.mode === 'month' ? 'bln lalu' : S.period.mode === 'week' ? 'mgg lalu' : S.period.mode === 'today' ? 'kemarin' : 'sebelumnya') + '</small><strong>' + changeHTML(I.outChange, true) + '</strong><span class="sub">pengeluaran</span></div>'
    ].join('') : '';

    const recent = sorted(S.txs).slice(0, 5);
    $('#recentList').innerHTML = !S.loaded ? skeleton(4)
      : recent.length ? recent.map(txItem).join('')
        : '<li>' + emptyState('Belum ada transaksi', 'Catat tagihan pertamamu, langsung masuk ke spreadsheet.', true) + '</li>';
  }

  /* ---------- Tagihan rutin: jatuh tempo, tenor, bayar sekali ketuk ---------- */
  const monthKey = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1);
  const monthsBetween = (ym1, ym2) => { const [y1, m1] = ym1.split('-').map(Number); const [y2, m2] = ym2.split('-').map(Number); return (y2 - y1) * 12 + (m2 - m1); };
  const dueIn = (day, ref) => new Date(ref.getFullYear(), ref.getMonth(), Math.min(day, new Date(ref.getFullYear(), ref.getMonth() + 1, 0).getDate()));

  /** Status setiap tagihan rutin untuk bulan berjalan. */
  function billStatus() {
    const t = today();
    const mFrom = iso(new Date(t.getFullYear(), t.getMonth(), 1));
    const mTo = iso(new Date(t.getFullYear(), t.getMonth() + 1, 0));
    const outs = S.txs.filter((x) => x.type === 'out');
    return ST().bills.map((b) => {
      const mine = outs.filter((x) => lc(x.category) === lc(b.name));
      const thisMonth = mine.filter((x) => x.date >= mFrom && x.date <= mTo);
      const last = sorted(mine.filter((x) => x.date < mFrom))[0];
      let tenorNo = null, tenorDone = false;
      if (b.tenor && b.start) {
        tenorNo = monthsBetween(b.start, monthKey(t)) + 1;
        tenorDone = tenorNo > b.tenor;
      }
      const due = b.due ? dueIn(b.due, t) : null;
      return {
        cfg: b, name: b.name, done: thisMonth.length > 0 || tenorDone, tenorDone, tenorNo,
        paid: thisMonth.reduce((s, x) => s + x.amount, 0),
        when: thisMonth.length ? sorted(thisMonth)[0].date : null,
        last, due, days: due ? dayDiff(t, due) : null,
        estimate: b.fixed || (last ? last.amount : 0)
      };
    });
  }

  function dueText(it) {
    if (!it.due) return '';
    if (it.days < 0) return 'Lewat ' + -it.days + ' hari (' + fmtShort(it.due) + ')';
    if (it.days === 0) return 'Jatuh tempo hari ini';
    if (it.days === 1) return 'Jatuh tempo besok';
    return 'Jatuh tempo ' + fmtShort(it.due) + ' · ' + it.days + ' hari lagi';
  }

  function renderBills() {
    const t = today();
    $('#billsTitle').textContent = 'Tagihan ' + BULAN_PANJANG[t.getMonth()];
    $('#billsBadge').hidden = !S.loaded;
    $('#payFixed').hidden = true;
    if (!S.loaded) { $('#billList').innerHTML = skeleton(3); $('#billsSub').textContent = S.loadError ? '' : 'Memuat…'; return; }
    const items = billStatus();
    if (!items.length) {
      $('#billList').innerHTML = '<li>' + emptyState('Belum ada tagihan rutin', 'Tambahkan tagihan yang kamu bayar setiap bulan.', false) + '<button type="button" class="btn btn-ghost btn-block" data-panel="bills">Atur tagihan rutin</button></li>';
      $('#billsBadge').textContent = NONE; $('#billsSub').textContent = ''; $('#billsBar').style.width = '0'; return;
    }
    let paidCount = 0, paidTotal = 0, estLeft = 0;
    items.forEach((it) => { if (it.done) { paidCount++; paidTotal += it.paid; } else estLeft += it.estimate; });
    // Urutan: lewat jatuh tempo → paling dekat → tanpa tanggal → lunas
    const rank = (it) => (it.done ? 1e6 : it.due ? it.days : 5e5);
    items.sort((a, b) => rank(a) - rank(b));
    $('#billsBadge').textContent = paidCount + '/' + items.length + ' lunas';
    $('#billsBadge').className = 'badge' + (paidCount === items.length ? ' ok' : '');
    const pct = Math.round((paidCount / items.length) * 100);
    $('#billsBar').style.width = pct + '%';
    $('#billsProgress').setAttribute('aria-valuenow', pct);
    $('#billsSub').textContent = 'Terbayar ' + rp(paidTotal) + (estLeft ? ' · perkiraan sisa ' + rp(estLeft) : '');

    const fixedUnpaid = items.filter((it) => !it.done && it.cfg.fixed);
    if (fixedUnpaid.length >= 2) {
      $('#payFixed').hidden = false;
      $('#payFixed').innerHTML = 'Catat ' + fixedUnpaid.length + ' tagihan tetap sekaligus · ' + rpHTML(fixedUnpaid.reduce((s, it) => s + it.cfg.fixed, 0));
    }

    const unpaid = items.filter((it) => !it.done);
    const showList = S.billsOpen || !unpaid.length ? items : unpaid;
    const hiddenPaid = items.length - showList.length;
    $('#billList').innerHTML = showList.map((it) => {
      const warn = !it.done && it.due && it.days <= 3;
      const late = !it.done && it.due && it.days < 0;
      const lines = [];
      if (it.tenorDone) lines.push('Cicilan selesai (' + it.cfg.tenor + ' bulan)');
      else if (it.done) lines.push('Lunas, dibayar ' + fmtShort(parseISO(it.when)));
      else lines.push('<span class="' + (late ? 'due-late' : warn ? 'due-soon' : '') + '">' + (late ? '<b aria-hidden="true">! </b>' : '') + esc(dueText(it) || 'Belum dibayar') + '</span>');
      if (it.tenorNo && !it.tenorDone) lines.push(it.tenorNo < 1 ? 'Cicilan mulai ' + esc(it.cfg.start) : 'Cicilan ke-' + it.tenorNo + ' dari ' + it.cfg.tenor);
      if (!it.done && !it.tenorDone && it.estimate) lines.push((it.cfg.fixed ? 'Tetap ' : 'Bulan lalu ') + rp(it.estimate));
      return '<li><button type="button" class="bill' + (it.done ? ' paid' : '') + (late ? ' late' : '') + '" data-bill="' + esc(it.name) + '">' +
        '<span class="bill-check" aria-hidden="true"><svg><use href="#i-check"/></svg></span>' +
        '<span class="bill-main"><span class="bill-name">' + esc(it.name) + '</span><span class="bill-meta">' + lines.join(' · ') + '</span></span>' +
        (it.done ? (it.paid ? '<span class="bill-amt num">' + rpHTML(it.paid) + '</span>' : '') : '<span class="bill-cta">Catat</span>') +
        '</button></li>';
    }).join('') +
      (hiddenPaid ? '<li><button type="button" class="bills-toggle" data-bills-toggle>Lihat ' + hiddenPaid + ' tagihan yang sudah lunas</button></li>'
        : S.billsOpen && unpaid.length ? '<li><button type="button" class="bills-toggle" data-bills-toggle>Sembunyikan yang lunas</button></li>' : '');
  }

  /* ---------- Hitungan bulan ini: sisa aman per hari & proyeksi ---------- */
  function calcMonth() {
    const t = today();
    const mFrom = iso(new Date(t.getFullYear(), t.getMonth(), 1)), mTo = iso(new Date(t.getFullYear(), t.getMonth() + 1, 0));
    const lastDay = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
    const month = S.txs.filter((x) => x.date >= mFrom && x.date <= mTo);
    const income = sum(month, 'in'), spent = sum(month, 'out');
    const bills = billStatus();
    const billNames = bills.map((b) => lc(b.name));
    const billsLeft = bills.filter((b) => !b.done).reduce((s, b) => s + b.estimate, 0);
    const remaining = income - spent - billsLeft;
    const daysLeft = lastDay - t.getDate() + 1; // termasuk hari ini
    // Proyeksi: belanja harian di luar tagihan rutin diteruskan sampai akhir bulan.
    const variable = month.filter((x) => x.type === 'out' && !billNames.includes(lc(x.category))).reduce((s, x) => s + x.amount, 0);
    const avgVar = variable / t.getDate();
    const projOut = spent + billsLeft + avgVar * (daysLeft - 1);
    const projRemain = income - projOut;
    return { income, spent, billsLeft, remaining, daysLeft, perDay: remaining / daysLeft, avgVar, projOut, projRemain, savePct: income ? Math.round((projRemain / income) * 100) : null };
  }

  const rb = (n) => Math.round(n / 1000) * 1000; // perkiraan dibulatkan ke ribuan

  function renderCalc() {
    const t = today();
    $('#calcTitle').textContent = 'Hitungan ' + BULAN_PANJANG[t.getMonth()];
    if (!S.loaded) { $('#calcBody').innerHTML = '<ul class="tx-list">' + skeleton(3) + '</ul>'; return; }
    const c = calcMonth();
    const row = (sign, label, val, cls) => '<div class="calc-row' + (cls ? ' ' + cls : '') + '"><dt><span class="calc-op" aria-hidden="true">' + sign + '</span>' + label + '</dt><dd class="num">' + rpHTML(val) + '</dd></div>';
    const deficit = c.remaining < 0;
    $('#calcBody').innerHTML =
      '<dl class="calc">' +
      row('+', 'Pemasukan bulan ini', c.income) +
      row('−', 'Pengeluaran sejauh ini', c.spent) +
      row('−', 'Tagihan belum dibayar (perkiraan)', c.billsLeft) +
      row('=', deficit ? 'Kurang' : 'Sisa aman', Math.abs(c.remaining), 'calc-total' + (deficit ? ' calc-neg' : '')) +
      '</dl>' +
      (deficit
        ? '<p class="calc-hl neg"><b aria-hidden="true">! </b>Pengeluaran dan tagihan melebihi pemasukan bulan ini sebesar ' + rp(-c.remaining) + '.</p>'
        : '<p class="calc-hl"><span class="calc-op" aria-hidden="true">÷</span> ' + c.daysLeft + ' hari tersisa = <b class="num">' + rpHTML(Math.floor(c.perDay / 1000) * 1000) + '</b> per hari aman dipakai</p>') +
      (c.income
        ? '<p class="calc-note">Perkiraan akhir bulan jika belanja harian tetap sekitar ' + rp(rb(c.avgVar)) + ': pengeluaran ' + rp(rb(c.projOut)) + ', ' +
          (c.projRemain >= 0 ? 'sisa ' + rp(rb(c.projRemain)) + ' (' + c.savePct + '% pemasukan)' : 'kurang ' + rp(rb(-c.projRemain))) + '.</p>'
        : '<p class="calc-note">Belum ada pemasukan tercatat bulan ini, jadi hitungan memakai pemasukan Rp 0.</p>');
  }

  async function payAllFixed() {
    const list = billStatus().filter((it) => !it.done && it.cfg.fixed);
    if (!list.length) return;
    const total = list.reduce((s, it) => s + it.cfg.fixed, 0);
    const ok = await confirmBox(list.map((it) => it.name + ' ' + rp(it.cfg.fixed)).join(', ') + '. Total ' + rp(total) + ', tanggal hari ini.',
      { title: 'Catat ' + list.length + ' tagihan tetap?', yes: 'Catat semua', danger: false });
    if (!ok) return;
    const txs = list.map((it) => ({ id: newId(), type: 'out', amount: it.cfg.fixed, category: it.name, date: iso(today()), note: 'Tagihan tetap', method: lastMethodFor(it.name) || '', receipt: '' }));
    txs.forEach((tx) => S.txs.push(tx));
    enqueue({ op: 'addMany', txs });
    saveCache(); render();
    await flushQueue({ quiet: true });
    if (!isPending(txs[0].id)) toast(list.length + ' tagihan tersimpan di sheet Pengeluaran');
    else toast(list.length + ' tagihan disimpan di HP. Dikirim ke sheet saat online.', 'wait');
  }

  /* ---------- Anggaran bulanan ---------- */
  function budgetStatus(extra) {
    const t = today();
    const mFrom = iso(new Date(t.getFullYear(), t.getMonth(), 1)), mTo = iso(new Date(t.getFullYear(), t.getMonth() + 1, 0));
    const spent = {};
    S.txs.forEach((x) => { if (x.type === 'out' && x.date >= mFrom && x.date <= mTo) spent[lc(x.category)] = (spent[lc(x.category)] || 0) + x.amount; });
    if (extra) spent[lc(extra.category)] = (spent[lc(extra.category)] || 0) + extra.amount;
    return Object.entries(ST().budgets || {}).map(([name, limit]) => {
      const used = spent[lc(name)] || 0;
      return { name, limit, used, pct: Math.round((used / limit) * 100) };
    }).sort((a, b) => b.pct - a.pct);
  }

  function renderBudgets() {
    const t = today();
    $('#budgetTitle').textContent = 'Anggaran ' + BULAN_PANJANG[t.getMonth()];
    if (!S.loaded) { $('#budgetList').innerHTML = skeleton(2); return; }
    const list = budgetStatus();
    if (!list.length) {
      $('#budgetList').innerHTML = '<li class="budget-empty"><p class="muted small">Tetapkan batas belanja per kategori. Aplikasi memberi peringatan saat pemakaian mencapai 80%.</p><button type="button" class="btn btn-ghost btn-block" data-panel="budgets">Atur anggaran</button></li>';
      return;
    }
    $('#budgetList').innerHTML = list.map((b) => {
      const state = b.pct >= 100 ? 'over' : b.pct >= 80 ? 'near' : 'ok';
      const label = state === 'over' ? 'Lewat ' + rp(b.used - b.limit) : state === 'near' ? 'Hampir habis · sisa ' + rp(b.limit - b.used) : 'Sisa ' + rp(b.limit - b.used);
      return '<li class="budget ' + state + '"><div class="budget-row"><span class="budget-name">' + esc(b.name) + '</span><span class="budget-num num">' + rpShort(b.used) + ' / ' + rpShort(b.limit) + '</span></div>' +
        '<div class="budget-bar" role="progressbar" aria-label="Anggaran ' + esc(b.name) + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.min(b.pct, 100) + '" aria-valuetext="' + b.pct + '% terpakai"><span style="width:' + Math.min(b.pct, 100) + '%"></span></div>' +
        '<span class="budget-state">' + (state !== 'ok' ? '<b aria-hidden="true">! </b>' : '') + b.pct + '% · ' + label + '</span></li>';
    }).join('');
  }

  /** Peringatan setelah menyimpan pengeluaran yang membuat anggaran melewati 80% atau 100%. */
  function budgetWarning(tx, prevAmount) {
    if (tx.type !== 'out') return;
    const t = today();
    if (tx.date.slice(0, 7) !== monthKey(t)) return;
    const before = budgetStatus({ category: tx.category, amount: -tx.amount + (prevAmount || 0) }).find((b) => lc(b.name) === lc(tx.category));
    const after = budgetStatus().find((b) => lc(b.name) === lc(tx.category));
    if (!after || !before) return;
    if (after.pct >= 100 && before.pct < 100) toast('Anggaran ' + after.name + ' terlewati: ' + rp(after.used) + ' dari ' + rp(after.limit), 'warn');
    else if (after.pct >= 100) toast('Anggaran ' + after.name + ' sudah lewat ' + rp(after.used - after.limit) + ' bulan ini', 'warn');
    else if (after.pct >= 80 && before.pct < 80) toast('Anggaran ' + after.name + ' sudah ' + after.pct + '% terpakai', 'warn');
  }

  const lastMethodFor = (cat) => { const t = sorted(S.txs.filter((x) => x.type === 'out' && lc(x.category) === lc(cat) && x.method))[0]; return t ? t.method : ''; };

  /* ---------- Riwayat ---------- */
  function renderHistory() {
    const h = S.hist;
    const sel = $('#histCat');
    const cats = Array.from(new Set(S.meta.categoriesExpense.concat(S.meta.categoriesIncome, S.txs.map((t) => t.category).filter(Boolean))));
    const cur = sel.value;
    sel.innerHTML = '<option value="">Semua kategori</option>' + cats.map((c) => '<option' + (c === cur ? ' selected' : '') + '>' + esc(c) + '</option>').join('');
    const msel = $('#histMethod'), mcur = msel.value;
    const methods = Array.from(new Set(ST().methods.concat(S.txs.map((t) => t.method).filter(Boolean))));
    msel.innerHTML = '<option value="">Semua metode</option>' + methods.map((c) => '<option' + (c === mcur ? ' selected' : '') + '>' + esc(c) + '</option>').join('') + '<option value="__none"' + (mcur === '__none' ? ' selected' : '') + '>Tanpa metode</option>';
    $$('#histType button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === h.type));
    $('#histReset').hidden = !(h.q || h.type !== 'all' || h.cat || h.method || h.from || h.to);

    if (!S.loaded) { $('#histList').innerHTML = '<div class="card"><ul class="tx-list">' + skeleton(6) + '</ul></div>'; $('#histSummary').textContent = ''; return; }

    const q = lc(h.q);
    const qNum = q.replace(/[^\d]/g, '');
    let list = S.txs.filter((t) =>
      (h.type === 'all' || t.type === h.type) &&
      (!h.cat || t.category === h.cat) &&
      (!h.method || (h.method === '__none' ? !t.method : t.method === h.method)) &&
      (!h.from || t.date >= h.from) &&
      (!h.to || t.date <= h.to) &&
      (!q || lc(t.category).includes(q) || lc(t.note).includes(q) || lc(t.method).includes(q) || (qNum && String(t.amount).includes(qNum))));
    list = sorted(list);
    const tin = sum(list, 'in'), tout = sum(list, 'out');
    $('#histSummary').innerHTML = list.length ? list.length + ' transaksi · masuk <span class="down">' + esc(rp(tin)) + '</span> · keluar <span class="up">' + esc(rp(tout)) + '</span>' : '';

    if (!list.length) {
      $('#histList').innerHTML = '<div class="card">' + (S.txs.length
        ? emptyState('Tidak ada yang cocok', 'Coba kata kunci lain atau hapus filter.', false)
        : emptyState('Riwayat masih kosong', 'Transaksi yang kamu catat akan muncul di sini.', true)) + '</div>';
      return;
    }
    const shown = list.slice(0, h.limit);
    const groups = [];
    shown.forEach((t) => { const g = groups[groups.length - 1]; if (g && g.date === t.date) g.items.push(t); else groups.push({ date: t.date, items: [t] }); });
    const tIso = iso(today()), yIso = iso(addDays(today(), -1));
    $('#histList').innerHTML = groups.map((g) => {
      const net = g.items.reduce((s, x) => s + (x.type === 'in' ? x.amount : -x.amount), 0);
      const label = g.date === tIso ? 'Hari ini' : g.date === yIso ? 'Kemarin' : fmtLong(parseISO(g.date));
      return '<div class="day-group"><h2 class="day-head"><span>' + label + '</span><span class="num">' + (net >= 0 ? '+' : '') + rp(net) + '</span></h2>' +
        '<div class="card"><ul class="tx-list">' + g.items.map(txItem).join('') + '</ul></div></div>';
    }).join('') + (list.length > shown.length ? '<button type="button" class="btn btn-ghost" id="histMore" style="width:100%">Tampilkan lebih banyak (' + (list.length - shown.length) + ')</button>' : '');
  }

  /* ---------- Analisis ---------- */
  function renderStats() {
    const I = computeInsights();
    // Donut
    $('#donutWrap').innerHTML = donutHTML(I);

    // Tren
    const type = S.trendType;
    $$('#trendType button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === type));
    $('#trendTitle').textContent = 'Tren ' + (type === 'out' ? 'pengeluaran' : 'pemasukan');
    let buckets = [];
    let from = I.r.from, to = I.r.to;
    if (S.period.mode === 'today') { to = today(); from = addDays(to, -6); }
    const span = dayDiff(from, to) + 1;
    const tIso = iso(today());
    if (span <= 31) {
      for (let d = new Date(from); d <= to; d = addDays(d, 1)) {
        const k = iso(d);
        buckets.push({ key: k, label: span <= 7 ? HARI[d.getDay()].slice(0, 3) : String(d.getDate()), showLbl: span <= 7 || d.getDate() === 1 || d.getDate() % 5 === 0, today: k === tIso, v: 0, test: (t) => t.date === k });
      }
    } else {
      for (let d = new Date(from.getFullYear(), from.getMonth(), 1); d <= to; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
        const ym = d.getFullYear() + '-' + pad(d.getMonth() + 1);
        buckets.push({ key: ym, label: BULAN[d.getMonth()], showLbl: true, v: 0, test: (t) => t.date.slice(0, 7) === ym && inRange(t, from, to) });
      }
    }
    S.txs.forEach((t) => { if (t.type !== type) return; for (const b of buckets) if (b.test(t)) { b.v += t.amount; break; } });
    const chartLoading = S.loadError ? '<div style="flex:1;align-self:center">' + errorState() + '</div>' : '<div class="skel" style="width:100%;height:100%"><span class="sr-only">Memuat grafik…</span></div>';
    $('#trendBars').innerHTML = !S.loaded ? chartLoading : barsHTML(buckets.map((b) => ({ label: b.showLbl ? b.label : '', sr: b.key, vals: [b.v], today: b.today })),[type === 'out' ? '' : 'in']);

    // 6 bulan
    const end = I.r.to;
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(end.getFullYear(), end.getMonth() - i, 1);
      const ym = d.getFullYear() + '-' + pad(d.getMonth() + 1);
      const mt = S.txs.filter((t) => t.date.slice(0, 7) === ym);
      months.push({ label: BULAN[d.getMonth()], vals: [sum(mt, 'in'), sum(mt, 'out')] });
    }
    $('#pairBars').innerHTML = !S.loaded ? chartLoading : barsHTML(months, ['in', 'outc']);

    // Per metode bayar
    const byMethod = {};
    I.inR.filter((t) => t.type === 'out').forEach((t) => { const k = t.method || 'Tanpa metode'; byMethod[k] = (byMethod[k] || 0) + t.amount; });
    const mEntries = Object.entries(byMethod).sort((a, b) => b[1] - a[1]);
    $('#methodList').innerHTML = !S.loaded ? skeleton(2)
      : !mEntries.length ? '<li>' + emptyState('Belum ada pengeluaran', 'Pada periode ' + I.r.label.toLowerCase() + '.', false) + '</li>'
        : mEntries.map(([k, v]) => {
          const pct = Math.round((v / I.totalOut) * 100);
          return '<li class="meter"><div class="budget-row"><span class="budget-name">' + esc(k) + '</span><span class="budget-num num">' + rpShort(v) + ' · ' + pct + '%</span></div>' +
            '<div class="budget-bar" aria-hidden="true"><span style="width:' + pct + '%"></span></div></li>';
        }).join('') +
        (byMethod['Tanpa metode'] === I.totalOut ? '<li class="muted small">Pilih metode bayar saat mencatat agar perbandingan ini terisi.</li>' : '');

    // Insight
    const savings = I.curIn ? Math.round(((I.curIn - I.curOut) / I.curIn) * 100) : null;
    $('#insightsStats').innerHTML = !S.loaded ? '' : [
      ['Kategori terbesar', I.top ? esc(I.top.name) + ' <span class="muted">(' + I.top.share + '%)</span>' : NONE],
      ['Rata-rata pengeluaran harian', '<span class="num">' + rpHTML(I.avgDaily) + '</span>'],
      ['Pengeluaran vs ' + I.c.prevLabel, changeHTML(I.outChange, true) + ' <span class="muted num">' + rpShort(I.prevOut) + ' → ' + rpShort(I.curOut) + '</span>'],
      ['Pemasukan vs ' + I.c.prevLabel, changeHTML(I.inChange, false)],
      ['Porsi pemasukan tersisa', savings === null ? NONE : '<span class="' + (savings >= 0 ? 'down' : 'up') + '">' + savings + '%</span>']
    ].map(([k, v]) => '<div class="insight"><small>' + k + '</small><strong>' + v + '</strong></div>').join('');
  }

  /** Donut pengeluaran per kategori (dipakai di Beranda dan Analisis). Legenda memuat nama + persen, jadi warna bukan satu-satunya penanda. */
  function donutHTML(I) {
    if (!S.loaded) return S.loadError ? '<div style="flex:1">' + errorState() + '</div>'
      : '<span class="sr-only">Memuat grafik…</span><div class="skel" aria-hidden="true" style="width:140px;height:140px;border-radius:50%"></div><div style="flex:1" aria-hidden="true"><div class="skel skel-row"></div><div class="skel skel-row"></div></div>';
    const entries = Object.entries(I.byCat).sort((a, b) => b[1] - a[1]);
    if (!entries.length) return '<div style="flex:1">' + emptyState('Belum ada pengeluaran', 'Pada periode ' + I.r.label.toLowerCase() + '.', false) + '</div>';
    const top = entries.slice(0, 6);
    const rest = entries.slice(6).reduce((s, e) => s + e[1], 0);
    if (rest) top.push(['Lainnya', rest]);
    const color = (i) => (i < PALETTE.length && !(rest && i === top.length - 1) ? PALETTE[i] : OTHER_COLOR);
    const R = 54, C = 2 * Math.PI * R;
    let off = 0;
    const arcs = top.map(([, v], i) => {
      const len = (v / I.totalOut) * C;
      const gap = top.length > 1 ? Math.min(2, len / 3) : 0;
      const el = '<circle cx="70" cy="70" r="' + R + '" fill="none" stroke="' + color(i) +
        '" stroke-width="18" stroke-dasharray="' + Math.max(len - gap, 0.1) + ' ' + C + '" stroke-dashoffset="' + (-off) + '" stroke-linecap="butt"/>';
      off += len; return el;
    }).join('');
    return '<div class="donut"><svg viewBox="0 0 140 140" aria-hidden="true"><circle cx="70" cy="70" r="' + R + '" fill="none" style="stroke:var(--line)" stroke-width="18"/>' + arcs + '</svg>' +
      '<div class="donut-center"><div><small>Total</small><b class="num">' + rpShort(I.totalOut) + '</b></div></div></div>' +
      '<ul class="legend">' + top.map(([k, v], i) =>
        '<li><span class="sw" style="background:' + color(i) + '"></span><span class="nm">' + esc(k) + '</span><span class="pc">' + Math.round((v / I.totalOut) * 100) + '%</span></li>').join('') + '</ul>';
  }

  function barsHTML(cols, classes) {
    const max = Math.max(1, ...cols.flatMap((c) => c.vals));
    const allZero = cols.every((c) => c.vals.every((v) => !v));
    if (allZero) return '<div style="flex:1;align-self:center">' + emptyState('Belum ada data', 'Grafik muncul setelah ada transaksi di periode ini.', false) + '</div>';
    const names = classes.length > 1 ? ['Pemasukan', 'Pengeluaran'] : [''];
    return '<span class="bar-max num" aria-hidden="true">' + rpShort(max) + '</span>' + cols.map((c) =>
      '<div class="bar-col"><span class="sr-only">' + esc(c.sr || c.label) + ': ' + c.vals.map((v, i) => (names[i] ? names[i] + ' ' : '') + esc(rp(v))).join(', ') + '</span>' +
      '<div class="bar-stack" aria-hidden="true">' + c.vals.map((v, i) =>
        '<div class="bar ' + (v ? classes[i] || '' : 'zero') + (c.today ? ' today' : '') + '" style="height:' + Math.max((v / max) * 100, v ? 3 : 1.5) + '%" title="' + esc(rp(v)) + '"></div>').join('') +
      '</div><span class="bar-lbl" aria-hidden="true">' + esc(c.label) + '</span></div>').join('');
  }

  /* ---------- Setelan ---------- */
  function renderSettings() {
    const b = $('#connBadge');
    b.textContent = isDemo() ? 'Demo' : S.online === false ? 'Offline' : S.online ? 'Terhubung' : 'Belum dicek';
    b.className = 'badge' + (S.online ? ' ok' : S.online === false ? ' bad' : '');
    $('#setSheet').textContent = S.meta.spreadsheet || 'Belum dimuat';
    $('#setSynced').textContent = S.syncedAt ? new Date(S.syncedAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : 'Belum dimuat';
    $('#setCount').textContent = S.txs.length + ' (' + S.txs.filter((t) => t.type === 'in').length + ' masuk, ' + S.txs.filter((t) => t.type === 'out').length + ' keluar)';
    const cols = S.meta.columns;
    const names = { date: 'Tanggal', amount: 'Nominal', category: 'Kategori', note: 'Catatan', method: 'Metode', receipt: 'Bukti', id: 'ID' };
    $('#setColumns').innerHTML = cols ? Object.keys(cols).map((sh) =>
      '<div class="col-map"><b>' + esc(sh) + '</b>' + Object.keys(names).map((k) => '<span>' + names[k] + ' → ' + (cols[sh][k] ? '“' + esc(cols[sh][k]) + '”' : '<i>tidak ada</i>') + '</span>').join('') + '</div>').join('') : 'Muat data dulu.';
    renderLockCard();
    const st = ST();
    const withDue = st.bills.filter((b) => b.due).length;
    $('#sumBills').textContent = st.bills.length ? st.bills.length + ' tagihan · ' + withDue + ' punya tanggal jatuh tempo · ' + st.bills.filter((b) => b.fixed).length + ' nominal tetap' : 'Belum ada tagihan rutin';
    const nb = Object.keys(st.budgets || {}).length;
    $('#sumBudgets').textContent = nb ? nb + ' kategori dibatasi, total ' + rp(Object.values(st.budgets).reduce((s, v) => s + v, 0)) + ' per bulan' : 'Belum ada anggaran';
    $('#sumMethods').textContent = st.methods.length ? st.methods.join(', ') : 'Belum ada metode bayar';
    const r = st.remind;
    const ch = [r.email ? 'email' : '', r.telegram && r.telegramReady ? 'Telegram' : ''].filter(Boolean);
    $('#sumRemind').textContent = ch.length ? 'Lewat ' + ch.join(' + ') + ' · ' + (r.days || []).map((d) => (d ? 'H-' + d : 'hari H')).join(', ') + (r.overdue ? ', lewat 1 hari' : '') : 'Pengingat mati';
    $('#remindWarn').hidden = !!r.scheduled || isDemo() || !S.meta.settings;
    $$('#themeSeg button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === (store.get('ct_theme', 'system'))));
    if (document.activeElement !== $('#nameInput')) $('#nameInput').value = st.name || '';
  }

  async function saveName() {
    const v = $('#nameInput').value.trim().slice(0, 30);
    if (v === (ST().name || '')) { toast('Nama sudah tersimpan'); return; }
    const b = $('#nameSave'); b.disabled = true; b.classList.add('loading');
    try {
      S.meta.settings = await api('saveSettings', { settings: { name: v } });
      saveCache(); renderHeader();
      toast(v ? 'Sapaan diubah: "' + greeting() + '"' : 'Sapaan tanpa nama');
    } catch (e) {
      toast(e.code === 'NETWORK' ? 'Butuh internet untuk menyimpan nama.' : 'Gagal: ' + e.message, 'err');
    } finally { b.disabled = false; b.classList.remove('loading'); }
  }

  /* ================= Navigasi ================= */
  function go(view) {
    if (view === S.view) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    S.view = view;
    $$('.view').forEach((v) => { v.hidden = v.id !== 'view-' + view; });
    $$('.nav-btn').forEach((b) => { if (b.dataset.goto === view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    window.scrollTo(0, 0);
    render();
  }

  /* ================= Form transaksi ================= */
  const F = {
    sheet: $('#txSheet'), amount: $('#fAmount'), date: $('#fDate'), note: $('#fNote'),
    cats: $('#fCats'), save: $('#fSave'), del: $('#fDelete'), suggest: $('#fSuggest')
  };
  const digits = (s) => String(s || '').replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 13);

  /* ---------- Kalkulator di kolom nominal ----------
   * Mendukung + − × ÷ (juga * x / : dari keyboard). Titik = pemisah ribuan, koma = desimal.
   * Dihitung dengan parser sendiri (tanpa eval), × dan ÷ didahulukan.
   */
  const OPS = '+−×÷';
  function tokenize(raw) {
    const s = String(raw || '').replace(/[xX*]/g, '×').replace(/[/:]/g, '÷').replace(/[-–]/g, '−');
    const out = [];
    let num = '';
    for (const ch of s) {
      if (/\d/.test(ch)) num += ch;
      else if (ch === ',' && !num.includes(',')) num += num ? ',' : '0,';
      else if (OPS.includes(ch)) {
        if (num) { out.push(num); num = ''; }
        if (!out.length) continue; // operator di awal diabaikan
        if (OPS.includes(out[out.length - 1])) out[out.length - 1] = ch; else out.push(ch);
      }
    }
    if (num) out.push(num);
    return out;
  }
  const numOf = (t) => { const [i, d] = t.split(','); return Number((i.replace(/^0+(?=\d)/, '').slice(0, 13) || '0') + (d ? '.' + d.slice(0, 4) : '')); };
  function fmtTokens(tokens) {
    return tokens.map((t, idx) => {
      // operator terakhir tanpa spasi di belakang, supaya Backspace langsung menghapusnya
      if (OPS.includes(t)) return idx === tokens.length - 1 ? ' ' + t : ' ' + t + ' ';
      const [whole, d] = t.split(',');
      return nf.format(Number(whole.replace(/^0+(?=\d)/, '').slice(0, 13) || '0')) + (d !== undefined ? ',' + d.slice(0, 4) : '');
    }).join('');
  }
  /** Hasil: { value, expr (ada operator), complete } */
  function evalAmount(raw) {
    const tk = tokenize(raw);
    const expr = tk.some((t) => OPS.includes(t));
    if (!tk.length) return { value: 0, expr: false, complete: true };
    if (OPS.includes(tk[tk.length - 1])) return { value: NaN, expr: true, complete: false };
    // × ÷ dulu, lalu + −
    const terms = [numOf(tk[0])], ops = [];
    for (let i = 1; i < tk.length; i += 2) {
      const op = tk[i], n = numOf(tk[i + 1]);
      if (op === '×') terms[terms.length - 1] *= n;
      else if (op === '÷') terms[terms.length - 1] = n === 0 ? NaN : terms[terms.length - 1] / n;
      else { ops.push(op); terms.push(n); }
    }
    let v = terms[0];
    ops.forEach((op, i) => { v = op === '+' ? v + terms[i + 1] : v - terms[i + 1]; });
    return { value: isFinite(v) ? Math.round(v) : NaN, expr, complete: true };
  }
  const amountValue = () => evalAmount(F.amount.value).value;

  function updateCalcPreview() {
    const r = evalAmount(F.amount.value);
    const box = $('#calcPreview');
    if (!r.expr) { box.textContent = ''; box.className = 'calc-preview'; return; }
    if (!r.complete) { box.textContent = 'Lanjutkan angkanya…'; box.className = 'calc-preview'; return; }
    if (isNaN(r.value)) { box.textContent = 'Tidak bisa dibagi nol'; box.className = 'calc-preview bad'; return; }
    box.textContent = '= ' + rp(r.value) + (r.value <= 0 ? ' (harus lebih dari 0)' : '');
    box.className = 'calc-preview' + (r.value <= 0 ? ' bad' : '');
  }

  /** Ganti ekspresi dengan hasilnya (tombol = atau Enter). */
  function settleAmount() {
    const r = evalAmount(F.amount.value);
    if (r.expr && r.complete && r.value > 0) { F.amount.value = nf.format(r.value); updateCalcPreview(); updateSuggest(); return true; }
    return false;
  }

  function catsFor(type) {
    const base = type === 'in' ? S.meta.categoriesIncome : S.meta.categoriesExpense;
    // urutkan: yang paling sering dipakai 90 hari terakhir dulu
    const since = iso(addDays(today(), -90));
    const freq = {};
    S.txs.forEach((t) => { if (t.type === type && t.date >= since && t.category) freq[t.category] = (freq[t.category] || 0) + 1; });
    const list = Array.from(new Set(base.concat(Object.keys(freq))));
    return list.map((c, i) => ({ c, i, f: freq[c] || 0 })).sort((a, b) => b.f - a.f || a.i - b.i).map((x) => x.c);
  }

  function renderFormCats() {
    const f = S.form;
    const list = catsFor(f.type);
    if (f.category && !list.includes(f.category)) list.unshift(f.category);
    const LIMIT = 8;
    let visible = list;
    if (!f.showAllCats && list.length > LIMIT + 1) {
      visible = list.slice(0, LIMIT);
      if (f.category && !visible.includes(f.category)) visible[LIMIT - 1] = f.category;
    }
    const hiddenCount = list.length - visible.length;
    F.cats.innerHTML = visible.map((c) =>
      '<button type="button" class="chip" data-cat="' + esc(c) + '" aria-pressed="' + (c === f.category) + '">' + esc(c) + '</button>').join('') +
      (hiddenCount ? '<button type="button" class="chip more" id="fMoreCat" aria-expanded="false">Tampilkan ' + hiddenCount + ' lainnya</button>' : '') +
      '<button type="button" class="chip add" id="fAddCat">+ Kategori baru</button>';
    $$('#fType button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === f.type));
    updateSuggest();
  }

  function updateSuggest() {
    const f = S.form;
    const last = f.category ? sorted(S.txs.filter((t) => t.type === f.type && t.category === f.category && t.id !== f.id))[0] : null;
    if (last && amountValue() !== last.amount) {
      F.suggest.hidden = false;
      F.suggest.textContent = 'Pakai nominal terakhir: ' + rp(last.amount);
      F.suggest.dataset.v = last.amount;
    } else F.suggest.hidden = true;
  }

  function setDate(isoStr) {
    F.date.value = isoStr;
    const t = iso(today()), y = iso(addDays(today(), -1));
    $$('#fDateQuick .chip').forEach((c) => c.setAttribute('aria-pressed', (c.dataset.d === '0' && isoStr === t) || (c.dataset.d === '-1' && isoStr === y)));
  }

  function clearErrors() {
    $('#errAmount').textContent = ''; $('#errCat').textContent = '';
    $('#amountBox').classList.remove('err'); F.cats.classList.remove('err');
  }

  function openForm(opts) {
    opts = opts || {};
    const tx = opts.tx;
    S.form = tx
      ? { mode: 'edit', id: tx.id, origType: tx.type, type: tx.type, category: tx.category, method: tx.method || '', receipt: tx.receipt || '', photo: null }
      : { mode: 'add', id: null, origType: null, type: opts.type || 'out', category: opts.category || '', method: opts.category ? lastMethodFor(opts.category) : '', receipt: '', photo: null };
    $('#sheetTitle').textContent = tx ? 'Ubah transaksi' : 'Tambah transaksi';
    F.amount.value = tx ? nf.format(tx.amount) : opts.amount ? nf.format(opts.amount) : '';
    F.note.value = tx ? tx.note : '';
    setDate(tx ? tx.date : iso(today()));
    F.del.hidden = !tx;
    $('#newCatBox').hidden = true;
    clearErrors();
    renderFormCats();
    renderMethods();
    renderPhoto();
    updateCalcPreview();
    $('#photoInput').value = '';
    F.save.classList.remove('loading'); F.save.disabled = false;
    $('#fSave .btn-label').textContent = tx ? 'Simpan perubahan' : 'Simpan';
    S.opener = document.activeElement;
    F.sheet.classList.add('open'); $('#backdrop').classList.add('open');
    F.sheet.scrollTop = 0;
    setBackgroundInert(true);
    document.body.style.overflow = 'hidden';
    history.pushState({ sheet: 1 }, '');
    // Tambah: fokus langsung ke nominal (harus sinkron agar keyboard HP muncul).
    // Ubah: fokus ke judul agar keyboard tidak menutupi data yang mau dibaca.
    if (!tx) F.amount.focus({ preventScroll: true });
    else $('#sheetTitle').focus({ preventScroll: true });
  }

  /** Saat form/dialog terbuka, latar belakang tidak bisa dijangkau Tab atau pembaca layar. */
  function setBackgroundInert(on) {
    ['#topbar', '#app', '.bottombar'].forEach((s) => { const el = $(s); if (on) el.setAttribute('inert', ''); else el.removeAttribute('inert'); });
  }

  function closeForm(fromPop) {
    if (!F.sheet.classList.contains('open')) return;
    F.sheet.classList.remove('open'); $('#backdrop').classList.remove('open');
    setBackgroundInert(false);
    document.body.style.overflow = '';
    const back = S.opener && document.contains(S.opener) ? S.opener : $('#fab');
    back.focus({ preventScroll: true });
    if (!fromPop && history.state && history.state.sheet) history.back();
  }

  function validate() {
    clearErrors();
    let ok = true;
    const r = evalAmount(F.amount.value);
    if (!digits(F.amount.value)) { $('#errAmount').textContent = 'Nominal wajib diisi.'; ok = false; }
    else if (!r.complete) { $('#errAmount').textContent = 'Hitungan belum lengkap. Tambahkan angka setelah tanda operasi.'; ok = false; }
    else if (isNaN(r.value)) { $('#errAmount').textContent = 'Hitungan tidak valid (pembagian dengan nol).'; ok = false; }
    else if (r.value <= 0) { $('#errAmount').textContent = 'Nominal harus lebih dari 0.'; ok = false; }
    if (!ok) $('#amountBox').classList.add('err');
    if (!S.form.category) { $('#errCat').textContent = 'Pilih kategori.'; F.cats.classList.add('err'); ok = false; }
    if (!F.date.value) { toast('Tanggal wajib diisi.', 'err'); ok = false; }
    if (!ok && navigator.vibrate) navigator.vibrate(40);
    return ok;
  }

  async function submitForm(e) {
    e.preventDefault();
    if (F.save.disabled || !validate()) return;
    const f = S.form;
    const tx = { type: f.type, amount: amountValue(), category: f.category, date: F.date.value, note: F.note.value.trim(), method: f.method || '', receipt: f.receipt || '' };
    F.save.disabled = true; F.save.classList.add('loading');
    try {
      // Foto bukti diunggah dulu (butuh internet). Transaksinya sendiri boleh offline.
      if (f.photo) {
        try {
          const up = await api('upload', { file: { mime: 'image/jpeg', data: f.photo.split(',')[1] } });
          tx.receipt = up.url;
        } catch (err) {
          if (err.code === 'NETWORK') { $('#errPhoto').textContent = 'Foto butuh internet. Hapus fotonya untuk menyimpan sekarang, lalu lampirkan nanti lewat Ubah.'; return; }
          throw err;
        }
      }
      const prev = f.mode === 'edit' ? S.txs.find((t) => t.id === f.id) : null;
      const id = f.mode === 'add' ? newId() : f.id;
      const local = Object.assign({}, tx, { id });
      if (f.mode === 'add') {
        S.txs.push(local);
        enqueue({ op: 'add', id, tx: local });
      } else {
        replaceTx(local);
        if (!patchQueuedAdd(id, tx)) enqueue({ op: 'update', id, origType: f.origType, tx });
      }
      saveCache(); closeForm(); render(); flash(id);
      if (navigator.vibrate) navigator.vibrate(15);
      budgetWarning(local, prev && lc(prev.category) === lc(local.category) && prev.date.slice(0, 7) === local.date.slice(0, 7) ? prev.amount : 0);
      await flushQueue({ quiet: true });
      if (!isPending(id)) toast((f.mode === 'add' ? 'Tersimpan' : 'Diperbarui') + ' di sheet ' + (tx.type === 'in' ? 'Pemasukan' : 'Pengeluaran'));
      else if (S.online === false) toast('Disimpan di HP. Akan dikirim ke sheet saat online.', 'wait');
    } catch (err) {
      toast('Gagal menyimpan: ' + err.message, 'err');
      if (err.code === 'UNAUTHORIZED') showSetup('Kunci akses tidak berlaku.');
    } finally { F.save.disabled = false; F.save.classList.remove('loading'); }
  }

  /* ---------- Foto bukti ---------- */
  async function compressImage(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Foto tidak bisa dibaca. Coba foto lain.')); i.src = url; });
      const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      let q = 0.82, data = c.toDataURL('image/jpeg', q);
      while (data.length > 1400000 && q > 0.4) { q -= 0.14; data = c.toDataURL('image/jpeg', q); }
      return { data, w: c.width, h: c.height };
    } finally { URL.revokeObjectURL(url); }
  }

  function renderPhoto() {
    const f = S.form;
    $('#errPhoto').textContent = '';
    const has = !!(f.photo || f.receipt);
    $('#photoEmpty').hidden = has;
    $('#photoHas').hidden = !has;
    if (!has) return;
    const img = $('#photoImg');
    if (f.photo) { img.hidden = false; img.src = f.photo; img.width = f.photoW; img.height = f.photoH; $('#photoLink').hidden = true; $('#photoState').textContent = 'Foto baru, diunggah saat disimpan'; }
    else { img.hidden = true; img.removeAttribute('src'); $('#photoLink').hidden = false; $('#photoLink').href = f.receipt; $('#photoState').textContent = 'Tersimpan di Google Drive'; }
  }

  function renderMethods() {
    const f = S.form;
    const list = ST().methods.slice();
    if (f.method && !list.includes(f.method)) list.push(f.method);
    $('#fMethods').innerHTML = list.length ? list.map((m) => '<button type="button" class="chip" data-method="' + esc(m) + '" aria-pressed="' + (m === f.method) + '">' + esc(m) + '</button>').join('')
      : '<span class="muted small">Tambah metode bayar di Setelan.</span>';
  }

  function flash(id) {
    requestAnimationFrame(() => $$('[data-edit="' + CSS.escape(id) + '"]').forEach((el) => el.classList.add('flash')));
  }

  /* ---------- Hapus dengan konfirmasi ---------- */
  function confirmBox(text, opts) {
    const o = Object.assign({ title: 'Hapus transaksi?', yes: 'Ya, hapus', no: 'Batal', danger: true }, opts || {});
    return new Promise((resolve) => {
      const wrap = $('#confirmWrap');
      const opener = document.activeElement;
      // Lapisan yang sedang terbuka di bawah dialog (form atau panel) ikut dinonaktifkan sementara.
      const host = F.sheet.classList.contains('open') ? F.sheet : !$('#panel').hidden ? $('#panel') : null;
      $('#confirmTitle').textContent = o.title;
      $('#confirmYes').textContent = o.yes;
      $('#confirmNo').textContent = o.no;
      $('#confirmYes').className = 'btn ' + (o.danger ? 'btn-danger' : 'btn-solid');
      $('#confirmText').textContent = text;
      wrap.classList.add('open');
      if (host) host.setAttribute('inert', ''); else setBackgroundInert(true);
      $('#confirmNo').focus();
      const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
        if (e.key === 'Tab') { // fokus tetap di dalam dialog
          const a = $('#confirmNo'), b = $('#confirmYes');
          if (e.shiftKey && document.activeElement === a) { e.preventDefault(); b.focus(); }
          else if (!e.shiftKey && document.activeElement === b) { e.preventDefault(); a.focus(); }
        }
      };
      const done = (v) => {
        wrap.classList.remove('open');
        document.removeEventListener('keydown', onKey, true);
        $('#confirmYes').onclick = $('#confirmNo').onclick = wrap.onclick = null;
        if (host) host.removeAttribute('inert');
        else if ($('#lockScreen').hidden && $('#setupScreen').hidden) setBackgroundInert(false);
        if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
        resolve(v);
      };
      document.addEventListener('keydown', onKey, true);
      $('#confirmYes').onclick = () => done(true);
      $('#confirmNo').onclick = () => done(false);
      wrap.onclick = (e) => { if (e.target === wrap) done(false); };
    });
  }

  async function deleteCurrent() {
    const f = S.form;
    const tx = S.txs.find((t) => t.id === f.id);
    if (!tx) return;
    const ok = await confirmBox((tx.category || 'Transaksi') + ' ' + rp(tx.amount) + ' pada ' + fmtLong(parseISO(tx.date)) + ' akan dihapus permanen dari spreadsheet.');
    if (!ok) return;
    S.txs = S.txs.filter((t) => t.id !== tx.id);
    const neverSent = dropQueuedAdd(tx.id); // belum pernah sampai ke sheet: cukup buang dari antrean
    if (!neverSent) enqueue({ op: 'delete', id: tx.id, type: tx.type });
    saveCache(); closeForm(); render();
    if (neverSent) { toast('Transaksi dihapus'); return; }
    await flushQueue({ quiet: true });
    toast(isPending(tx.id) ? 'Dihapus di HP. Sheet ikut diperbarui saat online.' : 'Transaksi dihapus', isPending(tx.id) ? 'wait' : 'ok');
  }

  /* ================= Tema: ikuti sistem / terang / gelap ================= */
  function applyTheme() {
    const mode = store.get('ct_theme', 'system');
    if (mode === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', mode);
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#ffffff';
    $$('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', bg));
  }
  if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

  /* ================= Panel pengaturan ================= */
  const P = { type: null, dirty: false, opener: null };
  const PANEL_TITLE = { bills: 'Tagihan rutin', budgets: 'Anggaran bulanan', methods: 'Metode bayar', remind: 'Pengingat jatuh tempo' };
  const rupiahInput = (id, val, label, hint) =>
    '<div class="field-inline"><label for="' + id + '">' + label + '</label>' +
    '<div class="rp-input"><span aria-hidden="true">Rp</span><input class="input" id="' + id + '" inputmode="numeric" data-rupiah value="' + (val ? nf.format(val) : '') + '" placeholder="0"' + (hint ? ' aria-describedby="' + id + '-h"' : '') + '></div>' +
    (hint ? '<span class="field-hint" id="' + id + '-h">' + hint + '</span>' : '') + '</div>';
  const switchRow = (id, label, desc, on) =>
    '<div class="setting-row"><div class="setting-text"><span class="setting-name" id="' + id + '-l">' + label + '</span>' + (desc ? '<span class="muted small" id="' + id + '-d">' + desc + '</span>' : '') + '</div>' +
    '<button type="button" class="switch" id="' + id + '" role="switch" aria-checked="' + !!on + '" aria-labelledby="' + id + '-l"' + (desc ? ' aria-describedby="' + id + '-d"' : '') + '><span class="switch-knob" aria-hidden="true"></span></button></div>';

  function billEditor(b, i, open) {
    const summary = [b.due ? 'tgl ' + b.due : 'tanpa tanggal', b.fixed ? 'tetap ' + rp(b.fixed) : '', b.tenor ? b.tenor + ' bln cicilan' : ''].filter(Boolean).join(' · ');
    const days = '<option value="">Tidak diatur</option>' + Array.from({ length: 31 }, (_, d) => '<option value="' + (d + 1) + '"' + (b.due === d + 1 ? ' selected' : '') + '>Tanggal ' + (d + 1) + '</option>').join('');
    return '<details class="bill-edit" data-i="' + i + '"' + (open ? ' open' : '') + '><summary><span class="be-name">' + esc(b.name || 'Tagihan baru') + '</span><span class="be-sum muted small">' + esc(summary) + '</span></summary>' +
      '<div class="be-body">' +
      '<div class="field-inline"><label for="bn' + i + '">Nama tagihan</label><input class="input" id="bn' + i + '" data-f="name" list="catList" maxlength="60" value="' + esc(b.name) + '" aria-describedby="bn' + i + '-h"><span class="field-hint" id="bn' + i + '-h">Samakan dengan kategori saat mencatat, supaya status lunas terbaca.</span></div>' +
      '<div class="field-inline"><label for="bd' + i + '">Jatuh tempo setiap bulan</label><select class="input" id="bd' + i + '" data-f="due">' + days + '</select></div>' +
      rupiahInput('bf' + i, b.fixed, 'Nominal tetap (opsional)', 'Isi jika nominalnya sama setiap bulan, untuk tombol catat sekaligus.') +
      '<div class="be-pair"><div class="field-inline"><label for="bt' + i + '">Tenor cicilan (bulan)</label><input class="input" id="bt' + i + '" data-f="tenor" inputmode="numeric" maxlength="3" value="' + (b.tenor || '') + '" placeholder="Bukan cicilan"></div>' +
      '<div class="field-inline"><label for="bs' + i + '">Mulai bulan</label><input class="input" type="month" id="bs' + i + '" data-f="start" value="' + esc(b.start || '') + '"></div></div>' +
      '<button type="button" class="btn btn-danger-ghost btn-block" data-del-bill="' + i + '">Hapus tagihan ini</button>' +
      '</div></details>';
  }

  function renderPanelBody() {
    const W = P.work, body = $('#panelBody');
    if (P.type === 'bills') {
      body.innerHTML = '<p class="muted small">Atur tanggal jatuh tempo untuk pengingat, nominal tetap untuk catat sekaligus, dan tenor untuk cicilan.</p>' +
        '<datalist id="catList">' + S.meta.categoriesExpense.map((c) => '<option value="' + esc(c) + '">').join('') + '</datalist>' +
        '<div class="be-list">' + W.bills.map((b, i) => billEditor(b, i, P.openIndex === i)).join('') + '</div>' +
        (W.bills.length ? '' : emptyState('Belum ada tagihan rutin', 'Tambahkan tagihan pertamamu.', false)) +
        '<button type="button" class="btn btn-ghost btn-block" id="addBill">+ Tambah tagihan</button>';
    } else if (P.type === 'budgets') {
      const t = today(); const mFrom = iso(new Date(t.getFullYear(), t.getMonth(), 1));
      const spent = {};
      S.txs.forEach((x) => { if (x.type === 'out' && x.date >= mFrom) spent[lc(x.category)] = (spent[lc(x.category)] || 0) + x.amount; });
      const cats = Array.from(new Set(S.meta.categoriesExpense.concat(Object.keys(W.budgets))));
      body.innerHTML = '<p class="muted small">Kosongkan jika kategori tidak perlu dibatasi. Peringatan muncul saat pemakaian mencapai 80% dan 100%.</p>' +
        cats.map((c, i) => rupiahInput('bg' + i, W.budgets[c], esc(c), 'Bulan ini terpakai ' + rp(spent[lc(c)] || 0)).replace('<input ', '<input data-cat="' + esc(c) + '" ')).join('');
    } else if (P.type === 'methods') {
      body.innerHTML = '<p class="muted small">Pilihan ini muncul di form saat mencatat. Contoh: BCA, GoPay, Kartu Kredit Mandiri.</p>' +
        '<ul class="method-list">' + W.methods.map((m, i) => '<li><span>' + esc(m) + '</span><button type="button" class="btn btn-danger-ghost btn-sm-ghost" data-del-method="' + i + '" aria-label="Hapus metode ' + esc(m) + '">Hapus</button></li>').join('') + '</ul>' +
        (W.methods.length ? '' : '<p class="muted small">Belum ada metode bayar.</p>') +
        '<div class="newcat"><div class="field-inline"><label for="newMethod">Metode baru</label><input class="input" id="newMethod" maxlength="30" enterkeyhint="done"></div><button type="button" class="btn btn-sm" id="addMethod">Tambah</button></div>';
    } else if (P.type === 'remind') {
      const r = W.remind;
      const dayOpts = [[7, 'H-7'], [5, 'H-5'], [3, 'H-3'], [2, 'H-2'], [1, 'H-1'], [0, 'Hari H']];
      body.innerHTML =
        (r.scheduled || isDemo() ? '' : '<p class="notice warn" role="note"><b>Jadwal belum aktif.</b> Buka Apps Script, jalankan fungsi <code>setup</code> sekali, lalu izinkan akses email.</p>') +
        '<section class="panel-sec"><h3>Saluran</h3>' +
        switchRow('rEmail', 'Email', r.emailTo ? 'Ke ' + esc(r.emailTo) + ' (akun pemilik Apps Script)' : 'Ke email akun pemilik Apps Script', r.email) +
        switchRow('rTg', 'Telegram', r.telegramReady ? 'Terhubung ke chat ' + esc(r.telegramChat) : 'Belum dihubungkan. Isi token dan chat ID di bawah.', r.telegram && r.telegramReady) +
        '<details class="tg-help"><summary>' + (r.telegramReady ? 'Ganti atau putuskan Telegram' : 'Hubungkan Telegram') + '</summary><div class="be-body">' +
        '<ol class="small muted steps"><li>Di Telegram, buka <b>@BotFather</b>, kirim <code>/newbot</code>, ikuti langkahnya, lalu salin token.</li><li>Kirim pesan apa saja ke bot barumu.</li><li>Buka <b>@userinfobot</b> untuk melihat chat ID-mu (angka).</li></ol>' +
        '<div class="field-inline"><label for="tgToken">Token bot</label><input class="input" id="tgToken" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="123456789:AA…"></div>' +
        '<div class="field-inline"><label for="tgChat">Chat ID</label><input class="input" id="tgChat" inputmode="numeric" autocomplete="off" placeholder="987654321"></div>' +
        (r.telegramReady ? '<button type="button" class="btn btn-danger-ghost btn-block" id="tgClear">Putuskan Telegram</button>' : '') +
        '</div></details></section>' +
        '<section class="panel-sec"><h3>Kapan diingatkan</h3><fieldset class="day-checks"><legend class="sr-only">Hari pengingat sebelum jatuh tempo</legend>' +
        dayOpts.map(([d, l]) => '<label class="check"><input type="checkbox" data-day="' + d + '"' + ((r.days || []).includes(d) ? ' checked' : '') + '><span>' + l + '</span></label>').join('') + '</fieldset>' +
        switchRow('rOver', 'Ingatkan jika lewat jatuh tempo', 'Dikirim sehari setelah tanggal jatuh tempo bila belum dicatat lunas.', r.overdue) +
        '<p class="muted small">Dikirim sekitar jam 07.00 untuk tagihan yang punya tanggal jatuh tempo.</p></section>' +
        '<section class="panel-sec"><h3>Ringkasan bulanan</h3>' + switchRow('rSum', 'Kirim ringkasan setiap tanggal 1', 'Pemasukan, pengeluaran, tagihan terbayar, dan anggaran yang terlewati.', r.summary) + '</section>' +
        '<button type="button" class="btn btn-ghost btn-block" id="testRemind"><span class="btn-label">Kirim pesan tes sekarang</span></button>';
    }
  }

  function openPanel(type) {
    P.type = type; P.dirty = false; P.openIndex = -1; P.opener = document.activeElement;
    P.work = JSON.parse(JSON.stringify(ST()));
    $('#panelTitle').textContent = PANEL_TITLE[type];
    renderPanelBody();
    $('#panel').hidden = false;
    $('#panel').scrollTop = 0;
    setBackgroundInert(true);
    history.pushState({ panel: 1 }, '');
    $('#panelTitle').focus({ preventScroll: true });
  }

  async function closePanel(fromPop) {
    if ($('#panel').hidden) return;
    if (P.dirty) {
      const ok = await confirmBox('Perubahan yang belum disimpan akan hilang.', { title: 'Buang perubahan?', yes: 'Buang', no: 'Lanjut mengatur' });
      if (!ok) { if (fromPop) history.pushState({ panel: 1 }, ''); return; }
    }
    $('#panel').hidden = true;
    setBackgroundInert(false);
    if (!fromPop && history.state && history.state.panel) history.back();
    const back = P.opener && document.contains(P.opener) ? P.opener : $('.nav-btn[data-goto="settings"]');
    back.focus({ preventScroll: true });
  }

  /** Baca isian panel menjadi objek pengaturan. Mengembalikan pesan error jika tidak valid. */
  function collectPanel() {
    const W = P.work;
    if (P.type === 'bills') {
      const seen = {};
      for (const el of $$('#panelBody .bill-edit')) {
        const i = Number(el.dataset.i), b = W.bills[i];
        b.name = $('[data-f="name"]', el).value.trim();
        b.due = Number($('[data-f="due"]', el).value) || null;
        b.fixed = Number(digits($('[data-rupiah]', el).value)) || null;
        b.tenor = Number(digits($('[data-f="tenor"]', el).value)) || null;
        b.start = $('[data-f="start"]', el).value || null;
        if (!b.name) return { err: 'Nama tagihan tidak boleh kosong.', el: $('[data-f="name"]', el) };
        if (seen[lc(b.name)]) return { err: 'Tagihan "' + b.name + '" tercatat dua kali.', el: $('[data-f="name"]', el) };
        seen[lc(b.name)] = 1;
        if (b.tenor && !b.start) return { err: 'Isi bulan mulai untuk cicilan "' + b.name + '".', el: $('[data-f="start"]', el) };
        if (b.tenor > 600) return { err: 'Tenor maksimal 600 bulan.', el: $('[data-f="tenor"]', el) };
        if (!b.tenor) b.start = null;
      }
      return { data: { bills: W.bills } };
    }
    if (P.type === 'budgets') {
      const budgets = {};
      $$('#panelBody [data-rupiah]').forEach((el) => { const v = Number(digits(el.value)); if (v) budgets[el.dataset.cat] = v; });
      return { data: { budgets } };
    }
    if (P.type === 'methods') return { data: { methods: W.methods } };
    if (P.type === 'remind') {
      const on = (id) => $('#' + id).getAttribute('aria-checked') === 'true';
      const data = { remind: { email: on('rEmail'), telegram: on('rTg'), overdue: on('rOver'), summary: on('rSum'), days: $$('#panelBody [data-day]').filter((c) => c.checked).map((c) => Number(c.dataset.day)) } };
      const tok = $('#tgToken').value.trim(), chat = $('#tgChat').value.trim();
      if (tok || chat) {
        if (!/^\d{5,15}:[A-Za-z0-9_-]{30,50}$/.test(tok)) return { err: 'Token bot Telegram tidak valid. Salin lengkap dari @BotFather.', el: $('#tgToken') };
        if (!/^-?\d{4,20}$/.test(chat)) return { err: 'Chat ID harus berupa angka.', el: $('#tgChat') };
        data.telegramToken = tok; data.telegramChat = chat; data.remind.telegram = true;
      }
      if (data.remind.telegram && !W.remind.telegramReady && !tok) return { err: 'Isi token dan chat ID untuk menyalakan Telegram.', el: $('#tgToken') };
      if ((data.remind.email || data.remind.telegram) && !data.remind.days.length && !data.remind.overdue) return { err: 'Pilih minimal satu hari pengingat.', el: $('#panelBody [data-day]') };
      return { data };
    }
    return { data: {} };
  }

  async function savePanel() {
    const r = collectPanel();
    if (r.err) { toast(r.err, 'err'); if (r.el) { const d = r.el.closest('details'); if (d) d.open = true; r.el.focus(); } return null; }
    const btn = $('#panelSave');
    btn.disabled = true; btn.classList.add('loading');
    try {
      const saved = await api('saveSettings', { settings: r.data });
      S.meta.settings = saved;
      S.meta.monthlyBills = saved.bills.map((b) => b.name);
      saveCache();
      P.dirty = false;
      return saved;
    } catch (e) {
      toast(e.code === 'NETWORK' ? 'Pengaturan butuh internet untuk disimpan. Coba lagi saat online.' : 'Gagal menyimpan: ' + e.message, 'err');
      return null;
    } finally { btn.disabled = false; btn.classList.remove('loading'); }
  }

  function bindPanel() {
    $('#panelBack').addEventListener('click', () => closePanel());
    $('#panelSave').addEventListener('click', async () => {
      if (await savePanel()) { toast('Pengaturan tersimpan'); await closePanel(); render(); }
    });
    window.addEventListener('popstate', () => { if (!$('#panel').hidden) closePanel(true); });
    const panel = $('#panel');
    panel.addEventListener('input', (e) => {
      P.dirty = true;
      if (e.target.matches('[data-rupiah]')) { const d = digits(e.target.value); e.target.value = d ? nf.format(Number(d)) : ''; }
      if (e.target.matches('[data-f="tenor"]')) e.target.value = digits(e.target.value).slice(0, 3);
      if (e.target.matches('[data-f="name"]')) { const s = e.target.closest('details').querySelector('.be-name'); s.textContent = e.target.value || 'Tagihan baru'; }
    });
    panel.addEventListener('change', () => { P.dirty = true; });
    panel.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.classList.contains('switch')) { b.setAttribute('aria-checked', String(b.getAttribute('aria-checked') !== 'true')); P.dirty = true; return; }
      if (b.id === 'addBill') { collectPanelSilently(); P.work.bills.push({ name: '', due: null, fixed: null, tenor: null, start: null }); P.openIndex = P.work.bills.length - 1; P.dirty = true; renderPanelBody(); $('#bn' + P.openIndex).focus(); return; }
      if (b.dataset.delBill != null) {
        const i = Number(b.dataset.delBill); collectPanelSilently();
        const ok = await confirmBox('"' + (P.work.bills[i].name || 'Tagihan baru') + '" dihapus dari daftar tagihan rutin. Transaksi yang sudah tercatat tidak terhapus.', { title: 'Hapus tagihan rutin?', yes: 'Hapus' });
        if (!ok) return;
        P.work.bills.splice(i, 1); P.openIndex = -1; P.dirty = true; renderPanelBody(); $('#addBill').focus(); return;
      }
      if (b.id === 'addMethod') { addMethod(); return; }
      if (b.dataset.delMethod != null) { P.work.methods.splice(Number(b.dataset.delMethod), 1); P.dirty = true; renderPanelBody(); $('#newMethod').focus(); return; }
      if (b.id === 'tgClear') {
        const ok = await confirmBox('Pengingat tidak lagi dikirim ke Telegram. Token bot dihapus dari Apps Script.', { title: 'Putuskan Telegram?', yes: 'Putuskan' });
        if (!ok) return;
        try { S.meta.settings = await api('saveSettings', { settings: { telegramClear: true } }); P.work.remind = JSON.parse(JSON.stringify(S.meta.settings.remind)); saveCache(); renderPanelBody(); toast('Telegram diputuskan'); }
        catch (err) { toast('Gagal: ' + err.message, 'err'); }
        return;
      }
      if (b.id === 'testRemind') {
        if (P.dirty && !(await savePanel())) return; // simpan dulu agar tes memakai pengaturan terbaru
        P.work = JSON.parse(JSON.stringify(ST())); renderPanelBody();
        const t = $('#testRemind'); t.disabled = true; t.classList.add('loading');
        try { const res = await api('testReminder'); toast('Pesan tes terkirim lewat ' + res.sent.map((s) => (s === 'telegram' ? 'Telegram' : 'email')).join(' dan ')); }
        catch (err) { toast(err.code === 'NETWORK' ? 'Butuh internet untuk mengirim tes.' : 'Gagal: ' + err.message, 'err'); }
        finally { const t2 = $('#testRemind'); t2.disabled = false; t2.classList.remove('loading'); t2.focus(); }
      }
    });
    panel.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.id === 'newMethod') { e.preventDefault(); addMethod(); }
    });
  }
  function collectPanelSilently() { if (P.type === 'bills') collectPanel(); }
  function addMethod() {
    const el = $('#newMethod'); const v = el.value.trim().slice(0, 30);
    if (!v) { el.focus(); return; }
    if (P.work.methods.some((m) => lc(m) === lc(v))) { toast('Metode "' + v + '" sudah ada.', 'err'); return; }
    if (P.work.methods.length >= 15) { toast('Maksimal 15 metode bayar.', 'err'); return; }
    P.work.methods.push(v); P.dirty = true; renderPanelBody(); $('#newMethod').focus();
  }

  /* ================= Setup / kunci ================= */
  function parseSetup(text) {
    const s = String(text || '').trim();
    const hash = s.includes('#') ? s.slice(s.indexOf('#') + 1) : s;
    const p = new URLSearchParams(hash);
    const apiUrl = p.get('api'), key = p.get('key');
    if (!apiUrl || !key) return null;
    if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(apiUrl)) return null;
    return { api: apiUrl, key };
  }

  function showSetup(msg) {
    $('#setupScreen').hidden = false;
    setBackgroundInert(true);
    $('#setupErr').textContent = msg || '';
  }
  function hideSetup() {
    $('#setupScreen').hidden = true;
    setBackgroundInert(false);
  }

  async function connect(conf) {
    const prev = { api: cfg.api, key: cfg.key };
    cfg.api = conf.api; cfg.key = conf.key;
    const btn = $('#setupGo');
    btn.disabled = true; btn.classList.add('loading');
    try {
      await api('ping');
      store.set('ct_cfg', cfg);
      hideSetup();
      $('#setupInput').value = '';
      toast('Terhubung ke spreadsheet');
      S.loaded = false; render();
      await refresh(true);
    } catch (e) {
      cfg.api = prev.api; cfg.key = prev.key;
      $('#setupErr').textContent = e.code === 'UNAUTHORIZED' ? 'Kunci salah. Buat link baru dengan buatLinkHP().' : e.message;
    } finally { btn.disabled = false; btn.classList.remove('loading'); }
  }

  /* ================= Kunci aplikasi: PIN + sidik jari / Face ID ================= */
  /*
   * - PIN tidak disimpan. Yang disimpan hanya hash PBKDF2-SHA256 (150.000 putaran, salt acak).
   * - Sidik jari / Face ID memakai WebAuthn dengan autentikator bawaan HP. Pemindaian
   *   dilakukan oleh sistem HP; aplikasi hanya menerima tanda tangan yang diverifikasi di sini
   *   (challenge, origin, flag "user verified", dan tanda tangan ECDSA P-256).
   * - Salah PIN 5x: jeda 30 detik, berlipat tiap kesalahan. Salah 10x: HP dikeluarkan
   *   (kunci akses dihapus dari HP ini; data di spreadsheet tidak tersentuh).
   */
  const LOCK_KEY = 'ct_lock', TRY_KEY = 'ct_lock_try', MAX_TRIES = 10, PBKDF2_ITER = 150000;
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const BIO_NAME = isIOS ? 'Face ID / Touch ID' : 'sidik jari';
  const BIO_CAP = BIO_NAME.charAt(0).toUpperCase() + BIO_NAME.slice(1);
  const fmtWait = (s) => (s > 90 ? Math.ceil(s / 60) + ' menit' : s + ' detik');
  const enc = new TextEncoder();
  const L = { cfg: store.get(LOCK_KEY, null), mode: null, buf: '', first: '', done: null, locked: false, hiddenAt: 0, timer: null, busy: false };
  const lockOn = () => !!(L.cfg && L.cfg.hash);
  const saveLock = () => { if (L.cfg) store.set(LOCK_KEY, L.cfg); else store.del(LOCK_KEY); };
  const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
  const b64 = (buf) => { let s = ''; new Uint8Array(buf).forEach((c) => { s += String.fromCharCode(c); }); return btoa(s); };
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const b64url = (buf) => b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const sha256 = async (data) => new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  const sameBytes = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

  async function hashPin(pin, saltB64, iter) {
    const base = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: unb64(saltB64), iterations: iter, hash: 'SHA-256' }, base, 256);
    return b64(bits);
  }

  function wipeDevice(msg) {
    ['ct_cfg', 'ct_cache', 'ct_queue', LOCK_KEY, TRY_KEY].forEach((k) => store.del(k));
    try { if (msg) sessionStorage.setItem('ct_msg', msg); } catch (e) { /* abaikan */ }
    location.replace(location.pathname);
  }

  /* ---------- Biometrik (WebAuthn) ---------- */
  async function bioAvailable() {
    try {
      return !!(window.PublicKeyCredential && window.isSecureContext &&
        await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
    } catch (e) { return false; }
  }

  async function bioRegister() {
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge: rand(32),
        rp: { name: 'App Keuangan' },
        user: { id: rand(16), name: 'pemilik', displayName: 'Pemilik App Keuangan' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }], // ES256 (P-256)
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
        timeout: 60000,
        attestation: 'none'
      }
    });
    const pk = cred.response.getPublicKey ? cred.response.getPublicKey() : null;
    return { id: b64(cred.rawId), pk: pk ? b64(pk) : '' };
  }

  /** Ubah tanda tangan DER (ECDSA) ke format r||s 64 byte untuk WebCrypto. */
  function derToRaw(der) {
    const d = new Uint8Array(der);
    let i = 2;
    if (d[1] & 0x80) i += d[1] & 0x7f;
    const part = () => { i++; const len = d[i++]; let v = d.slice(i, i + len); i += len; while (v.length > 32 && v[0] === 0) v = v.slice(1); const out = new Uint8Array(32); out.set(v, 32 - v.length); return out; };
    const r = part(), s = part();
    const raw = new Uint8Array(64); raw.set(r, 0); raw.set(s, 32); return raw;
  }

  async function bioVerify() {
    const bio = L.cfg && L.cfg.bio;
    if (!bio) return false;
    const challenge = rand(32);
    const a = await navigator.credentials.get({
      publicKey: { challenge, allowCredentials: [{ type: 'public-key', id: unb64(bio.id), transports: ['internal'] }], userVerification: 'required', timeout: 60000 }
    });
    const cdBytes = new Uint8Array(a.response.clientDataJSON);
    const cd = JSON.parse(new TextDecoder().decode(cdBytes));
    if (cd.type !== 'webauthn.get' || cd.challenge !== b64url(challenge) || cd.origin !== location.origin) return false;
    const ad = new Uint8Array(a.response.authenticatorData);
    if (!sameBytes(ad.slice(0, 32), await sha256(enc.encode(location.hostname)))) return false;
    if (!(ad[32] & 0x04)) return false; // flag UV: pengguna benar-benar terverifikasi
    if (bio.pk) {
      const key = await crypto.subtle.importKey('spki', unb64(bio.pk), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      const data = new Uint8Array(ad.length + 32);
      data.set(ad, 0); data.set(await sha256(cdBytes), ad.length);
      return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, derToRaw(a.response.signature), data);
    }
    return true;
  }

  /* ---------- Layar PIN ---------- */
  const tries = () => store.get(TRY_KEY, { n: 0, until: 0 });
  const waitLeft = () => Math.max(0, Math.ceil((tries().until - Date.now()) / 1000));

  function targetLen() {
    if (L.mode === 'unlock' || L.mode === 'verify') return L.cfg.len;
    if (L.mode === 'confirm') return L.first.length;
    return 6; // buat PIN: otomatis lanjut di 6 angka, atau tekan Lanjut setelah 4–5 angka
  }

  function drawLock() {
    const n = targetLen();
    $('#pinDots').innerHTML = Array.from({ length: n }, (_, i) => '<span class="' + (i < L.buf.length ? 'on' : '') + '"></span>').join('');
    $('#pinCount').textContent = L.buf.length ? L.buf.length + ' dari ' + (L.mode === 'new' ? '4 sampai 6' : n) + ' angka' : '';
    $('#lockNext').hidden = L.mode !== 'new';
    $('#lockNext').disabled = L.buf.length < 4;
    const wait = waitLeft();
    $$('#keypad button').forEach((b) => { b.disabled = wait > 0 || L.busy; });
  }

  function setLockText(title, sub) {
    $('#lockTitle').textContent = title;
    $('#lockSub').textContent = sub || ' ';
  }

  function showLockScreen(mode) {
    L.mode = mode; L.buf = ''; L.first = ''; L.busy = false;
    const cancelable = mode !== 'unlock';
    $('#lockCancel').hidden = !cancelable;
    $('#lockForgot').hidden = mode !== 'unlock';
    const bio = mode === 'unlock' && L.cfg && L.cfg.bio;
    $('#kpBio').hidden = !bio; $('#kpBioSpacer').hidden = !!bio;
    $('#kpBio').setAttribute('aria-label', 'Buka dengan ' + BIO_NAME);
    $('#lockErr').textContent = '';
    if (mode === 'unlock') setLockText('Masukkan PIN', bio ? 'Atau pakai ' + BIO_NAME : '');
    if (mode === 'verify') setLockText('Masukkan PIN saat ini', 'Untuk mengonfirmasi bahwa ini kamu');
    if (mode === 'new') setLockText('Buat PIN baru', '4 sampai 6 angka');
    $('#lockScreen').hidden = false;
    setBackgroundInert(true);
    F.sheet.setAttribute('inert', ''); $('#confirmWrap').setAttribute('inert', ''); $('#panel').setAttribute('inert', '');
    drawLock();
    tickWait();
    $('#lockTitle').focus({ preventScroll: true });
  }

  function hideLockScreen() {
    $('#lockScreen').hidden = true;
    F.sheet.removeAttribute('inert'); $('#confirmWrap').removeAttribute('inert'); $('#panel').removeAttribute('inert');
    if (!F.sheet.classList.contains('open') && $('#panel').hidden && $('#setupScreen').hidden) setBackgroundInert(false);
    clearInterval(L.timer);
  }

  function tickWait() {
    clearInterval(L.timer);
    const update = () => {
      const w = waitLeft();
      if (w > 0) $('#lockErr').textContent = 'Sisa ' + (MAX_TRIES - tries().n) + ' percobaan. Coba lagi dalam ' + fmtWait(w) + '.';
      else { clearInterval(L.timer); if (/Coba lagi dalam/.test($('#lockErr').textContent)) $('#lockErr').textContent = ''; }
      drawLock();
    };
    if (waitLeft() > 0) { update(); L.timer = setInterval(update, 1000); }
  }

  function shake() {
    const d = $('#pinDots'); d.classList.remove('shake'); void d.offsetWidth; d.classList.add('shake');
    if (navigator.vibrate) navigator.vibrate([30, 40, 30]);
  }

  async function submitPin() {
    const pin = L.buf;
    if (L.mode === 'new') {
      if (pin.length < 4) { $('#lockErr').textContent = 'PIN minimal 4 angka.'; return; }
      L.first = pin; L.buf = ''; L.mode = 'confirm';
      setLockText('Ulangi PIN', 'Ketik sekali lagi untuk memastikan');
      $('#lockErr').textContent = ''; drawLock(); return;
    }
    if (L.mode === 'confirm') {
      if (pin !== L.first) {
        shake(); L.mode = 'new'; L.buf = ''; L.first = '';
        setLockText('Buat PIN baru', '4 sampai 6 angka');
        $('#lockErr').textContent = 'PIN tidak sama. Ulangi dari awal.'; drawLock(); return;
      }
      L.busy = true; drawLock();
      const salt = b64(rand(16));
      const hash = await hashPin(pin, salt, PBKDF2_ITER);
      const keepBio = L.cfg && L.cfg.bio;
      L.cfg = Object.assign({ auto: 60 }, L.cfg || {}, { salt, hash, iter: PBKDF2_ITER, len: pin.length, bio: keepBio || null });
      saveLock(); store.del(TRY_KEY);
      L.busy = false; finishPad(true); return;
    }
    // unlock / verify
    if (waitLeft() > 0) return;
    L.busy = true; drawLock();
    const ok = (await hashPin(pin, L.cfg.salt, L.cfg.iter)) === L.cfg.hash;
    L.busy = false; L.buf = '';
    if (ok) { store.del(TRY_KEY); finishPad(true); return; }
    const t = tries(); t.n += 1;
    if (t.n >= MAX_TRIES) { wipeDevice('PIN salah ' + MAX_TRIES + ' kali, jadi HP ini dikeluarkan demi keamanan. Data di spreadsheet tetap aman. Tempel link setup untuk masuk lagi.'); return; }
    if (t.n >= 5) t.until = Date.now() + 30000 * Math.pow(2, t.n - 5);
    store.set(TRY_KEY, t);
    shake();
    $('#lockErr').textContent = 'PIN salah. Sisa ' + (MAX_TRIES - t.n) + ' percobaan sebelum HP ini dikeluarkan.';
    drawLock(); tickWait();
  }

  function finishPad(result) {
    const done = L.done; L.done = null;
    if (L.mode === 'unlock' || L.mode === 'verify' || L.mode === 'confirm' || L.mode === 'new') hideLockScreen();
    if (L.mode === 'unlock') L.locked = false;
    L.mode = null; L.buf = '';
    if (done) done(result);
  }

  function pressKey(k) {
    if (!L.mode || L.busy || waitLeft() > 0) return;
    if (k === 'del') L.buf = L.buf.slice(0, -1);
    else if (L.buf.length < 6) L.buf += k;
    if (!/Coba lagi dalam/.test($('#lockErr').textContent)) $('#lockErr').textContent = '';
    drawLock();
    if (L.buf.length === targetLen()) submitPin();
  }

  /** Mengunci aplikasi. Selesai (resolve) saat pengguna berhasil membuka. */
  function lockApp() {
    if (!lockOn() || !cfg.key || L.locked) return Promise.resolve(true);
    L.locked = true;
    return new Promise((resolve) => {
      L.done = resolve;
      showLockScreen('unlock');
      // Android biasanya mengizinkan prompt sidik jari langsung; iPhone mewajibkan ketukan dulu.
      if (L.cfg.bio && !isIOS) setTimeout(() => tryBio(true), 350);
    });
  }

  async function tryBio(silent) {
    if (!L.cfg || !L.cfg.bio || L.mode !== 'unlock' || L.busy) return;
    L.busy = true; drawLock();
    let ok = false;
    try { ok = await bioVerify(); } catch (e) { ok = false; if (!silent && e.name !== 'NotAllowedError') $('#lockErr').textContent = BIO_CAP + ' tidak bisa dipakai saat ini. Masukkan PIN.'; }
    L.busy = false;
    if (ok) { store.del(TRY_KEY); finishPad(true); }
    else { if (!silent && !$('#lockErr').textContent) $('#lockErr').textContent = BIO_CAP + ' dibatalkan atau tidak cocok. Masukkan PIN.'; drawLock(); }
  }

  function askPin(mode) {
    return new Promise((resolve) => { L.done = resolve; showLockScreen(mode); });
  }

  /* ---------- Pengaturan di Setelan ---------- */
  async function renderLockCard() {
    const on = lockOn();
    $('#lockOff').hidden = on; $('#lockOn').hidden = !on;
    $('#lockBadge').textContent = on ? (L.cfg.bio ? 'Aktif: PIN + ' + BIO_NAME : 'Aktif: PIN') : 'Mati';
    $('#lockBadge').className = 'badge' + (on ? ' ok' : '');
    if (!on) return;
    $('#autoLock').value = String(L.cfg.auto != null ? L.cfg.auto : 60);
    $('#bioLabel').textContent = 'Buka dengan ' + BIO_NAME;
    const sw = $('#bioSwitch');
    sw.setAttribute('aria-checked', String(!!L.cfg.bio));
    const avail = await bioAvailable();
    sw.disabled = !avail && !L.cfg.bio;
    $('#bioDesc').textContent = avail || L.cfg.bio ? 'PIN tetap bisa dipakai kapan saja.' : 'HP atau browser ini tidak mendukung ' + BIO_NAME + ' untuk aplikasi web.';
  }

  async function enableBio(fromSetup) {
    if (!(await bioAvailable())) { toast('HP ini tidak mendukung ' + BIO_NAME + ' untuk aplikasi web.', 'err'); return false; }
    try {
      L.cfg.bio = await bioRegister();
      saveLock();
      toast(BIO_CAP + ' aktif');
      return true;
    } catch (e) {
      if (!fromSetup || e.name !== 'NotAllowedError') toast(e.name === 'NotAllowedError' ? 'Pendaftaran ' + BIO_NAME + ' dibatalkan.' : 'Gagal mengaktifkan ' + BIO_NAME + '.', 'err');
      return false;
    }
  }

  function bindLock() {
    $('#keypad').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.id === 'kpBio') { tryBio(false); return; }
      pressKey(b.dataset.k);
    });
    $('#lockNext').addEventListener('click', () => submitPin());
    $('#lockCancel').addEventListener('click', () => finishPad(false));
    $('#lockForgot').addEventListener('click', async () => {
      $('#lockScreen').setAttribute('inert', '');
      $('#confirmWrap').removeAttribute('inert');
      const ok = await confirmBox('PIN tidak bisa dipulihkan. HP ini akan dikeluarkan dan kamu perlu menempel link setup lagi (fungsi buatLinkHP di Apps Script). Data di spreadsheet tetap aman.', { title: 'Lupa PIN?', yes: 'Keluarkan HP ini' });
      $('#lockScreen').removeAttribute('inert');
      if (ok) wipeDevice('Silakan tempel link setup untuk masuk lagi, lalu buat PIN baru di Setelan.');
      else { $('#confirmWrap').setAttribute('inert', ''); $('#lockTitle').focus({ preventScroll: true }); }
    });
    // Keyboard fisik: angka, Backspace, Enter, Escape
    document.addEventListener('keydown', (e) => {
      if ($('#lockScreen').hidden || $('#confirmWrap').classList.contains('open')) return;
      if (/^[0-9]$/.test(e.key)) { e.preventDefault(); pressKey(e.key); }
      else if (e.key === 'Backspace') { e.preventDefault(); pressKey('del'); }
      else if (e.key === 'Enter' && L.mode === 'new' && L.buf.length >= 4) { e.preventDefault(); submitPin(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (L.mode !== 'unlock') finishPad(false); }
    }, true);

    $('#btnPinOn').addEventListener('click', async () => {
      const ok = await askPin('new');
      if (!ok) { $('#btnPinOn').focus(); return; }
      toast('PIN aktif');
      await renderLockCard();
      if (await bioAvailable()) {
        const yes = await confirmBox('Buka aplikasi lebih cepat tanpa mengetik PIN. PIN tetap bisa dipakai kalau ' + BIO_NAME + ' gagal.', { title: 'Pakai ' + BIO_NAME + ' juga?', yes: 'Aktifkan', no: 'Nanti saja', danger: false });
        if (yes) await enableBio(true);
      }
      await renderLockCard();
      $('#btnPinChange').focus();
    });
    $('#btnPinChange').addEventListener('click', async () => {
      if (!(await askPin('verify'))) return $('#btnPinChange').focus();
      if (await askPin('new')) toast('PIN diganti');
      renderLockCard(); $('#btnPinChange').focus();
    });
    $('#btnPinOff').addEventListener('click', async () => {
      if (!(await askPin('verify'))) return $('#btnPinOff').focus();
      L.cfg = null; saveLock(); store.del(TRY_KEY);
      toast('Kunci aplikasi dimatikan');
      await renderLockCard(); $('#btnPinOn').focus();
    });
    $('#bioSwitch').addEventListener('click', async () => {
      if (L.cfg.bio) {
        if (!(await askPin('verify'))) return $('#bioSwitch').focus();
        L.cfg.bio = null; saveLock(); toast(BIO_CAP + ' dimatikan');
      } else {
        await enableBio(false);
      }
      await renderLockCard(); $('#bioSwitch').focus();
    });
    $('#autoLock').addEventListener('change', (e) => { L.cfg.auto = Number(e.target.value); saveLock(); toast('Tersimpan'); });

    // Kunci otomatis saat aplikasi ditinggalkan
    document.addEventListener('visibilitychange', () => {
      if (!lockOn() || !cfg.key) return;
      if (document.visibilityState === 'hidden') {
        L.hiddenAt = Date.now();
        if (!L.cfg.auto && !L.mode) lockApp(); // "Langsung": layar terkunci sebelum masuk daftar aplikasi terbaru
      } else if (!L.locked && !L.mode && L.hiddenAt && Date.now() - L.hiddenAt >= (L.cfg.auto || 0) * 1000) {
        lockApp();
      }
    });
  }

  /* ================= Event ================= */
  function bind() {
    document.addEventListener('click', (e) => {
      const t = e.target.closest('button, [data-goto]');
      if (!t) return;
      if (t.dataset.goto) return go(t.dataset.goto);
      if (t.dataset.pm) {
        S.period.mode = t.dataset.pm;
        if (t.dataset.pm === 'custom' && !S.period.from) {
          const td = today();
          S.period.from = iso(new Date(td.getFullYear(), td.getMonth(), 1)); S.period.to = iso(td);
        }
        const box = t.closest('[data-period]');
        store.set('ct_period', S.period); render();
        const again = box && box.querySelector('[data-pm="' + S.period.mode + '"]'); if (again) again.focus({ preventScroll: true });
        return;
      }
      if (t.dataset.edit) { const tx = S.txs.find((x) => x.id === t.dataset.edit); if (tx) openForm({ tx }); return; }
      if (t.dataset.bill) {
        const name = t.dataset.bill;
        const mine = sorted(S.txs.filter((x) => x.type === 'out' && lc(x.category) === lc(name)));
        const t0 = today(); const mFrom = iso(new Date(t0.getFullYear(), t0.getMonth(), 1));
        const paidThis = mine.find((x) => x.date >= mFrom);
        const bc = ST().bills.find((b) => lc(b.name) === lc(name));
        if (paidThis) openForm({ tx: paidThis });
        else openForm({ type: 'out', category: name, amount: (bc && bc.fixed) || (mine[0] ? mine[0].amount : 0) });
        return;
      }
      if (t.dataset.panel) return openPanel(t.dataset.panel);
      if (t.hasAttribute('data-add')) return openForm();
      if (t.hasAttribute('data-retry')) { S.loadError = ''; render(); return refresh(); }
      if (t.hasAttribute('data-bills-toggle')) { S.billsOpen = !S.billsOpen; renderBills(); return; }
    });

    $('#fab').addEventListener('click', () => openForm());
    $('#btnRefresh').addEventListener('click', () => refresh());
    $('#btnReload').addEventListener('click', () => refresh());
    $('#btnTest').addEventListener('click', async (e) => {
      const b = e.currentTarget; b.disabled = true; b.classList.add('loading');
      const t0 = performance.now();
      try { await api('ping'); S.online = true; toast('Koneksi OK, respons ' + Math.round(performance.now() - t0) + ' ms'); }
      catch (err) { S.online = false; toast(err.message, 'err'); }
      finally { b.disabled = false; b.classList.remove('loading'); renderSettings(); }
    });
    $('#btnLogout').addEventListener('click', async () => {
      const pend = Q.list.length ? ' PERHATIAN: ' + Q.list.length + ' perubahan belum terkirim dan akan hilang.' : '';
      const ok = await confirmBox('Kunci akses, PIN, dan data sementara akan dihapus dari HP ini. Kamu perlu link setup lagi untuk masuk. Data di spreadsheet tetap aman.' + pend, { title: 'Keluar dari HP ini?', yes: 'Ya, keluar' });
      if (!ok) return;
      wipeDevice('');
    });

    // periode custom
    document.addEventListener('change', (e) => {
      if (e.target.matches('[data-pf]')) { S.period.from = e.target.value; store.set('ct_period', S.period); render(); }
      if (e.target.matches('[data-pt]')) { S.period.to = e.target.value; store.set('ct_period', S.period); render(); }
    });

    // riwayat
    let qTimer;
    $('#histSearch').addEventListener('input', (e) => { clearTimeout(qTimer); qTimer = setTimeout(() => { S.hist.q = e.target.value; S.hist.limit = 60; renderHistory(); }, 150); });
    $('#histType').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; S.hist.type = b.dataset.v; renderHistory(); });
    $('#histCat').addEventListener('change', (e) => { S.hist.cat = e.target.value; renderHistory(); });
    $('#histFrom').addEventListener('change', (e) => { S.hist.from = e.target.value; renderHistory(); });
    $('#histTo').addEventListener('change', (e) => { S.hist.to = e.target.value; renderHistory(); });
    $('#histMethod').addEventListener('change', (e) => { S.hist.method = e.target.value; renderHistory(); });
    $('#histReset').addEventListener('click', () => {
      S.hist = { q: '', type: 'all', cat: '', method: '', from: '', to: '', limit: 60 };
      $('#histSearch').value = ''; $('#histCat').value = ''; $('#histMethod').value = ''; $('#histFrom').value = ''; $('#histTo').value = '';
      renderHistory();
    });
    $('#histList').addEventListener('click', (e) => { if (e.target.id === 'histMore') { S.hist.limit += 60; renderHistory(); } });

    // analisis
    $('#trendType').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; S.trendType = b.dataset.v; renderStats(); });

    // tagihan tetap & antrean
    $('#payFixed').addEventListener('click', payAllFixed);
    $('#pendingSend').addEventListener('click', async () => {
      await flushQueue();
      if (Q.list.length) toast('Masih offline. Coba lagi saat ada sinyal.', 'wait');
      else if (S.needResync) refresh(true);
    });
    window.addEventListener('online', () => { if (cfg.key) flushQueue(); });

    // nama panggilan untuk sapaan
    $('#nameSave').addEventListener('click', saveName);
    $('#nameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveName(); } });
    // sapaan ikut berganti (pagi → siang → sore → malam) selama aplikasi terbuka
    setInterval(() => { if (S.view === 'home' && document.visibilityState === 'visible') renderHeader(); }, 60000);

    // tema
    $('#themeSeg').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      store.set('ct_theme', b.dataset.v); applyTheme(); renderSettings(); b.focus();
    });

    // metode bayar di form
    $('#fMethods').addEventListener('click', (e) => {
      const b = e.target.closest('[data-method]'); if (!b) return;
      S.form.method = S.form.method === b.dataset.method ? '' : b.dataset.method; // ketuk lagi untuk batal
      renderMethods();
      const same = $('#fMethods [data-method="' + CSS.escape(b.dataset.method) + '"]'); if (same) same.focus({ preventScroll: true });
    });

    // foto bukti
    $('#photoInput').addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      if (!/^image\//.test(file.type)) { $('#errPhoto').textContent = 'Pilih file foto (JPG atau PNG).'; return; }
      $('#photoPick').classList.add('loading');
      try {
        const r = await compressImage(file);
        S.form.photo = r.data; S.form.photoW = r.w; S.form.photoH = r.h;
        renderPhoto();
      } catch (err) { $('#errPhoto').textContent = err.message; }
      finally { $('#photoPick').classList.remove('loading'); e.target.value = ''; }
    });
    $('#photoPick').addEventListener('click', () => $('#photoInput').click());
    $('#photoReplace').addEventListener('click', () => $('#photoInput').click());
    $('#photoRemove').addEventListener('click', () => { S.form.photo = null; S.form.receipt = ''; renderPhoto(); $('#photoPick').focus(); });

    // form
    F.amount.addEventListener('input', () => {
      const tk = tokenize(F.amount.value);
      F.amount.value = fmtTokens(tk).slice(0, 60);
      if (tk.length) { $('#errAmount').textContent = ''; $('#amountBox').classList.remove('err'); }
      updateCalcPreview();
      updateSuggest();
    });
    F.amount.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === '=') { e.preventDefault(); if (!settleAmount() && e.key === 'Enter') F.amount.blur(); }
    });
    // Tombol operasi: tidak mencuri fokus, supaya keyboard angka HP tetap terbuka.
    $('#calcKeys').addEventListener('pointerdown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
    $('#calcKeys').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.op === '=') { settleAmount(); F.amount.focus({ preventScroll: true }); return; }
      if (b.dataset.op === 'C') { F.amount.value = ''; }
      else { if (!tokenize(F.amount.value).length) { F.amount.focus({ preventScroll: true }); return; } F.amount.value += b.dataset.op; }
      F.amount.dispatchEvent(new Event('input'));
      F.amount.focus({ preventScroll: true });
    });
    F.suggest.addEventListener('click', () => { F.amount.value = nf.format(Number(F.suggest.dataset.v)); updateCalcPreview(); updateSuggest(); clearErrors(); });
    $('#fType').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b || b.dataset.v === S.form.type) return;
      S.form.type = b.dataset.v; S.form.category = ''; S.form.showAllCats = false; renderFormCats();
    });
    // Keyboard HP tidak boleh menutupi kolom yang sedang diisi.
    F.sheet.addEventListener('focusin', (e) => {
      if (e.target.matches('input, textarea, select')) setTimeout(() => e.target.scrollIntoView({ block: 'center', behavior: 'smooth' }), 280);
    });
    F.cats.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.id === 'fMoreCat') {
        const n = F.cats.querySelectorAll('[data-cat]').length;
        S.form.showAllCats = true; renderFormCats();
        const next = F.cats.querySelectorAll('[data-cat]')[n]; if (next) next.focus(); // lanjut dari kategori yang baru muncul
        return;
      }
      if (b.id === 'fAddCat') { $('#newCatBox').hidden = false; $('#fNewCat').value = ''; $('#fNewCat').focus(); return; }
      S.form.category = b.dataset.cat; $('#errCat').textContent = ''; F.cats.classList.remove('err');
      if (!S.form.method && S.form.mode === 'add') { S.form.method = lastMethodFor(S.form.category); renderMethods(); } // metode terakhir untuk kategori ini
      renderFormCats();
      const same = F.cats.querySelector('[data-cat="' + CSS.escape(S.form.category) + '"]'); if (same) same.focus({ preventScroll: true });
    });
    const useNewCat = () => {
      const v = $('#fNewCat').value.trim().slice(0, 60);
      if (!v) return;
      const list = S.form.type === 'in' ? S.meta.categoriesIncome : S.meta.categoriesExpense;
      if (!list.some((c) => lc(c) === lc(v))) list.push(v);
      S.form.category = list.find((c) => lc(c) === lc(v));
      $('#newCatBox').hidden = true; renderFormCats();
    };
    $('#fNewCatOk').addEventListener('click', () => { useNewCat(); const c = F.cats.querySelector('[aria-pressed="true"]'); if (c) c.focus(); });
    $('#fNewCat').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); useNewCat(); } });
    $('#fDateQuick').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setDate(iso(addDays(today(), Number(b.dataset.d)))); });
    F.date.addEventListener('change', () => setDate(F.date.value));
    F.note.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); F.note.blur(); } });
    F.sheet.addEventListener('submit', submitForm);
    F.del.addEventListener('click', deleteCurrent);
    $('#sheetClose').addEventListener('click', () => closeForm());
    $('#backdrop').addEventListener('click', () => closeForm());
    window.addEventListener('popstate', () => closeForm(true));
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || $('#confirmWrap').classList.contains('open')) return;
      if (!$('#panel').hidden) closePanel(); else closeForm();
    });

    // setup
    $('#setupGo').addEventListener('click', () => {
      const conf = parseSetup($('#setupInput').value);
      if (!conf) { $('#setupErr').textContent = 'Link tidak valid. Pastikan menyalin seluruh link dari buatLinkHP().'; return; }
      connect(conf);
    });
    $('#setupDemo').addEventListener('click', () => {
      cfg.api = ''; cfg.key = 'demo'; store.set('ct_cfg', cfg);
      hideSetup(); S.loaded = false; S.loadError = ''; render(); refresh(true);
      $('#fab').focus({ preventScroll: true });
    });

    // segarkan saat aplikasi dibuka lagi
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && cfg.key && S.syncedAt && Date.now() - new Date(S.syncedAt) > 60000) refresh(true);
    });
  }

  /* ================= Mulai ================= */
  function init() {
    applyTheme();
    bind();
    bindLock();
    bindPanel();
    let msg = '';
    try { msg = sessionStorage.getItem('ct_msg') || ''; sessionStorage.removeItem('ct_msg'); } catch (e) { /* abaikan */ }
    // link setup lewat #api=…&key=…
    const fromHash = location.hash.length > 1 ? parseSetup(location.hash) : null;
    if (fromHash) {
      history.replaceState(null, '', location.pathname + location.search); // hapus kunci dari address bar
      showSetup();
      connect(fromHash);
    } else if (!cfg.key) {
      showSetup(msg);
    }
    if (cfg.key && lockOn()) lockApp(); // kunci sebelum data tampil
    render();
    if (cfg.key) refresh(true);

    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('sw.js').catch(() => { /* PWA opsional */ });
    }
  }
  init();
})();
