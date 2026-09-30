/* =============================================================
 *  ระบบติดตามงบประมาณค่าใช้สอย — Frontend
 *  โฮสต์บน GitHub Pages · บันทึกข้อมูลลงฐานข้อมูล (Google Sheets) ผ่าน Apps Script
 *  ถ้าไม่ได้ตั้ง API_URL ใน config.js จะทำงานในโหมดสาธิต (localStorage)
 * ============================================================= */
(function () {
'use strict';

const CFG = Object.assign({ API_URL: '' }, window.APP_CONFIG || {});
const CONFIG_URL = String(CFG.API_URL || '').trim();   // URL จาก config.js (มีผลเหนือค่าที่บันทึกในเบราว์เซอร์)
let API_URL = '';                                       // กำหนดตอนเริ่มระบบ (ดู boot)
const API_URL_RE = /^https:\/\/script\.google\.com\/(a\/macros\/[^/]+|macros)\/s\/[\w-]+\/exec\/?$/;

/* ================= ค่าคงที่ ================= */
const TABLES = {
  fiscalYears: ['id', 'year', 'name', 'startDate', 'endDate', 'totalBudget', 'status', 'note', 'createdAt', 'updatedAt'],
  categories: ['id', 'fiscalYearId', 'code', 'plan', 'name', 'color', 'note', 'createdAt', 'updatedAt'],
  items: ['id', 'fiscalYearId', 'categoryId', 'code', 'name', 'budget', 'responsibleId', 'note', 'createdAt', 'updatedAt'],
  expenses: ['id', 'fiscalYearId', 'itemId', 'date', 'docNo', 'description', 'amount', 'payee', 'status', 'attachment', 'note', 'createdBy', 'createdAt', 'updatedAt'],
  responsibles: ['id', 'name', 'position', 'department', 'phone', 'email', 'note', 'createdAt', 'updatedAt'],
  users: ['id', 'username', 'passwordHash', 'displayName', 'role', 'responsibleId', 'active', 'lastLogin', 'createdAt', 'updatedAt']
};
const DATA_TABLES = ['fiscalYears', 'categories', 'items', 'expenses', 'responsibles'];
const DEFAULT_SETTINGS = {
  systemName: 'ระบบติดตามงบประมาณค่าใช้สอย',
  orgName: '',
  orgSub: '',
  logoUrl: '',
  reporterName: '',
  reporterPosition: '',
  warnPercent: '80',
  footerNote: ''
};
const ROLE_RANK = { viewer: 1, editor: 2, admin: 3 };
const ROLES = [['admin', 'ผู้ดูแลระบบ (จัดการได้ทั้งหมด)'], ['editor', 'เจ้าหน้าที่ (บันทึก/แก้ไขข้อมูล)'], ['viewer', 'ผู้บริหาร / ผู้ดูรายงาน (ดูอย่างเดียว)']];
const ROLE_SHORT = { admin: ['ผู้ดูแลระบบ', '#1D4ED8'], editor: ['เจ้าหน้าที่', '#0288D1'], viewer: ['ผู้ดูรายงาน', '#8E24AA'] };
const FY_STATUS = { active: ['ใช้งาน', '#16A34A'], planning: ['วางแผน', '#0288D1'], closed: ['ปิดปีงบ', '#78909C'] };
const EXP_STATUS = { 'เบิกจ่ายแล้ว': '#16A34A', 'รอเบิกจ่าย': '#F57C00', 'ยกเลิก': '#9E9E9E' };
const PALETTE = ['#1D4ED8', '#0EA5E9', '#6366F1', '#14B8A6', '#8B5CF6', '#F59E0B', '#EF4444', '#10B981', '#64748B', '#EC4899'];
const TH_MON = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const TH_MON_FULL = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const FY_MON = ['ต.ค.', 'พ.ย.', 'ธ.ค.', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.'];
const FY_MON_FULL = ['ตุลาคม', 'พฤศจิกายน', 'ธันวาคม', 'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน'];
const TABLE_LABEL = { fiscalYears: 'ปีงบประมาณ', categories: 'หมวด/แผนงาน', items: 'รายการงบประมาณ', expenses: 'รายการเบิกจ่าย', responsibles: 'ผู้รับผิดชอบ', users: 'ผู้ใช้งาน', settings: 'ตั้งค่าระบบ' };
const NO_PLAN = 'ไม่ระบุแผนงาน';

const MENU = [
  { id: 'dashboard', label: 'แดชบอร์ด', icon: 'space_dashboard', sub: 'ภาพรวมการใช้จ่ายงบประมาณ' },
  { id: 'compare', label: 'เปรียบเทียบปีงบ', icon: 'compare_arrows', sub: 'เปรียบเทียบการใช้จ่ายระหว่างปีงบประมาณ' },
  { id: 'years', label: 'ปีงบประมาณ', icon: 'calendar_month', sub: 'กำหนดปีงบประมาณและวงเงินที่ได้รับ' },
  { id: 'categories', label: 'หมวด / แผนงาน', icon: 'category', sub: 'จัดกลุ่มงบประมาณตามหมวดและแผนงาน' },
  { id: 'items', label: 'รายการงบประมาณ', icon: 'receipt_long', sub: 'รายการที่จัดสรรงบประมาณในแต่ละหมวด' },
  { id: 'expenses', label: 'รายการเบิกจ่าย', icon: 'payments', sub: 'บันทึกและติดตามการเบิกจ่าย' },
  { id: 'responsibles', label: 'ผู้รับผิดชอบ', icon: 'groups', sub: 'ผู้รับผิดชอบรายการงบประมาณ' },
  { id: 'report', label: 'รายงานสรุป', icon: 'summarize', sub: 'สรุปผลการใช้จ่ายงบประมาณ พร้อมพิมพ์' },
  { id: 'users', label: 'ผู้ใช้งานระบบ', icon: 'manage_accounts', sub: 'บัญชีผู้ใช้และสิทธิ์การเข้าถึง', role: 'admin' },
  { id: 'settings', label: 'ตั้งค่าระบบ', icon: 'settings', sub: 'ข้อมูลหน่วยงานและเครื่องมือจัดการข้อมูล', role: 'admin' },
  { id: 'logs', label: 'บันทึกกิจกรรม', icon: 'history', sub: 'ประวัติการใช้งานระบบ', role: 'admin' }
];

/* ================= ตัวช่วยทั่วไป ================= */
const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => { if (typeof v === 'number') return isFinite(v) ? v : 0; const n = Number(String(v == null ? '' : v).replace(/[,\s฿]/g, '')); return isFinite(n) ? n : 0; };
const money = (v, d) => num(v).toLocaleString('th-TH', { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d });
const moneyC = (v) => (num(v) < 0 ? `<span class="text-rose-600 font-semibold">${money(v)}</span>` : money(v));
const pct = (a, b) => (num(b) > 0 ? (num(a) / num(b)) * 100 : 0);
const sum = (arr, k) => arr.reduce((s, x) => s + num(typeof k === 'function' ? k(x) : x[k]), 0);
const clone = (o) => (o === undefined ? o : JSON.parse(JSON.stringify(o)));
const isTrue = (v) => v === true || ['TRUE', '1', 'YES'].indexOf(String(v).toUpperCase()) >= 0;
const short = (v) => { v = num(v); const a = Math.abs(v); if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 0 : 1) + ' ล.'; if (a >= 1e3) return Math.round(v / 1e3) + 'K'; return String(Math.round(v)); };
const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => isoDate(new Date());
const nowStr = () => { const d = new Date(); return `${isoDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
function parseDate(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(s);
  return isNaN(d) ? null : d;
}
function thDate(s, full) { const d = parseDate(s); return d ? `${d.getDate()} ${(full ? TH_MON_FULL : TH_MON)[d.getMonth()]} ${d.getFullYear() + 543}` : '-'; }
function thDateTime(s) { const m = String(s || '').match(/(\d{2}):(\d{2})/); return thDate(s) + (m ? ` ${m[1]}:${m[2]} น.` : ''); }
const currentFY = () => { const d = new Date(); return d.getFullYear() + 543 + (d.getMonth() >= 9 ? 1 : 0); };
const fyRange = (y) => { const ce = num(y) - 543; return { startDate: `${ce - 1}-10-01`, endDate: `${ce}-09-30` }; };
const fiscalMonthIndex = (s) => { const d = parseDate(s); return d ? (d.getMonth() + 3) % 12 : -1; };
const uid = () => {
  if (window.crypto && crypto.getRandomValues) { const a = new Uint8Array(6); crypto.getRandomValues(a); return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(''); }
  return (Date.now().toString(16) + Math.random().toString(16).slice(2)).slice(-12);
};
const byCode = (a, b) => String(a.code || '').localeCompare(String(b.code || ''), 'th', { numeric: true }) || String(a.name || '').localeCompare(String(b.name || ''), 'th');
function stripHtml(h) { const d = document.createElement('div'); d.innerHTML = h; return d.textContent.replace(/\s+/g, ' ').trim(); }
const badge = (text, color) => `<span class="badge" style="background:${color}1f;color:${color}">${esc(text)}</span>`;
const fyBadge = (s) => badge((FY_STATUS[s] || ['-'])[0], (FY_STATUS[s] || [0, '#78909C'])[1]);
const expBadge = (s) => badge(s || '-', EXP_STATUS[s] || '#78909C');
const roleBadge = (r) => badge((ROLE_SHORT[r] || [r])[0], (ROLE_SHORT[r] || [0, '#78909C'])[1]);
const warnPct = () => num(S.settings.warnPercent) || 80;
function prog(p) {
  const w = Math.min(100, Math.max(0, p));
  const c = p > 100 ? '#D32F2F' : p >= warnPct() ? '#F59E0B' : '#2563EB';
  return `<div class="prog"><i style="width:${w}%;background:${c}"></i></div>`;
}
const progCell = (p) => `<div class="flex items-center gap-2 min-w-[130px]"><div class="flex-1">${prog(p)}</div><span class="text-xs font-semibold w-12 text-right ${p > 100 ? 'text-rose-600' : 'text-slate-600'}">${p.toFixed(1)}%</span></div>`;
const mcol = (label, key, opt) => Object.assign({ label, right: true, sum: key, html: (r) => money(r[key]), csv: (r) => num(r[key]) }, opt || {});

/* ---------- ที่เก็บข้อมูลในเบราว์เซอร์ (ปลอดภัยเมื่อ localStorage ใช้ไม่ได้) ---------- */
const mem = {};
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); if (v != null) return JSON.parse(v); } catch (e) { /* ignore */ } return k in mem ? mem[k] : d; },
  set(k, v) { mem[k] = v; try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  del(k) { delete mem[k]; try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
};

/* ================= สถานะของแอป ================= */
const S = {
  token: null, user: null, settings: Object.assign({}, DEFAULT_SETTINGS),
  data: { fiscalYears: [], categories: [], items: [], expenses: [], responsibles: [], users: [] },
  fy: null, view: 'dashboard', ui: {}, charts: [], logs: []
};
const can = (role) => !!S.user && (ROLE_RANK[S.user.role] || 0) >= ROLE_RANK[role];
const byId = (t, id) => (id ? S.data[t].find((r) => String(r.id) === String(id)) : undefined);
const fyObj = () => byId('fiscalYears', S.fy);
const sortedYears = () => S.data.fiscalYears.slice().sort((a, b) => num(b.year) - num(a.year));
const plansOf = (fyId) => Array.from(new Set(S.data.categories.filter((c) => c.fiscalYearId === fyId).map((c) => c.plan || NO_PLAN))).sort((a, b) => a.localeCompare(b, 'th'));

/* ================= แจ้งเตือน ================= */
function toast(msg, icon) { if (window.Swal) Swal.fire({ toast: true, position: 'top-end', icon: icon || 'success', title: msg, showConfirmButton: false, timer: 2200, timerProgressBar: true }); }
const errMsg = (e) => { const m = (e && e.message) || String(e); return m === 'SESSION_EXPIRED' ? 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' : m; };
function alertErr(e) {
  if (e && e.message === 'SESSION_EXPIRED') return;
  const m = errMsg(e);
  if (window.Swal) Swal.fire({ icon: 'error', title: 'ทำรายการไม่สำเร็จ', text: m, confirmButtonColor: '#1D4ED8', confirmButtonText: 'ตกลง' }); else alert(m);
}
function info(m, title) { if (window.Swal) Swal.fire({ icon: 'info', title: title || 'แจ้งเตือน', html: m, confirmButtonColor: '#1D4ED8', confirmButtonText: 'ตกลง' }); else alert(stripHtml(m)); }
async function confirmBox(title, html, opt) {
  opt = opt || {};
  if (!window.Swal) return confirm(title + '\n' + stripHtml(html || ''));
  const r = await Swal.fire({ icon: opt.icon || 'warning', title, html, showCancelButton: true, confirmButtonText: opt.ok || 'ยืนยัน', cancelButtonText: 'ยกเลิก', confirmButtonColor: opt.danger ? '#EF5350' : '#1D4ED8', reverseButtons: true, focusCancel: !!opt.danger });
  return r.isConfirmed;
}

/* ================= หน้าต่าง "กำลังบันทึก / กำลังโหลด" ================= */
// ข้อความไหลตามบริบทของงาน — เปลี่ยนทีละขั้นแบบนุ่มนวล ข้อความสุดท้ายค้างไว้จนงานเสร็จ
const BUSY_FLOW = {
  save: (l) => [`กำลังบันทึก${l || 'ข้อมูล'}`, 'กำลังส่งข้อมูลไปยังฐานข้อมูล', 'กำลังตรวจสอบความถูกต้อง', 'อีกสักครู่ ใกล้เสร็จแล้ว'],
  delete: (l) => [`กำลังลบ${l || 'ข้อมูล'}`, 'กำลังอัปเดตฐานข้อมูล', 'กำลังคำนวณยอดคงเหลือใหม่'],
  load: () => ['กำลังโหลดข้อมูล', 'กำลังดึงข้อมูลจากฐานข้อมูล', 'กำลังคำนวณงบประมาณ', 'กำลังจัดเตรียมหน้าจอ'],
  login: () => ['กำลังตรวจสอบบัญชีผู้ใช้', 'กำลังเข้าสู่ระบบ', 'กำลังโหลดข้อมูลของคุณ', 'กำลังจัดเตรียมแดชบอร์ด'],
  logout: () => ['กำลังออกจากระบบ'],
  upload: () => ['กำลังอัปโหลดไฟล์', 'กำลังจัดเก็บไฟล์อย่างปลอดภัย', 'กำลังสร้างลิงก์ไฟล์'],
  import: (l) => [`กำลังนำเข้า${l || 'ข้อมูล'}`, 'กำลังบันทึกลงฐานข้อมูล', 'กำลังจัดเรียงข้อมูล', 'กำลังโหลดข้อมูลล่าสุด'],
  reset: () => ['กำลังล้างข้อมูล', 'กำลังอัปเดตฐานข้อมูล'],
  logs: () => ['กำลังโหลดบันทึกกิจกรรม', 'กำลังเรียงลำดับตามเวลา'],
  connect: () => ['กำลังทดสอบการเชื่อมต่อ', 'กำลังตรวจสอบฐานข้อมูล'],
  password: () => ['กำลังเปลี่ยนรหัสผ่าน', 'กำลังเข้ารหัสและบันทึก']
};
const BUSY_DONE = { save: 'บันทึกเรียบร้อย', delete: 'ลบข้อมูลเรียบร้อย', upload: 'อัปโหลดไฟล์เรียบร้อย', import: 'นำเข้าข้อมูลเรียบร้อย', reset: 'ล้างข้อมูลเรียบร้อย', connect: 'เชื่อมต่อสำเร็จ', password: 'เปลี่ยนรหัสผ่านเรียบร้อย' };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function greeting() {
  const h = new Date().getHours();
  return h >= 5 && h < 12 ? 'สวัสดีตอนเช้า' : h >= 12 && h < 17 ? 'สวัสดีตอนบ่าย' : h >= 17 && h < 21 ? 'สวัสดีตอนเย็น' : 'สวัสดี';
}
function smoothText(el, text) {
  if (!el || el.textContent === text) return;
  clearTimeout(el._st);
  el.classList.add('out');
  el._st = setTimeout(() => { el.textContent = text; el.classList.remove('out'); }, 200);
}
const Busy = {
  depth: 0, timers: [], shownAt: 0,
  open(kind, label) {
    const el = $('#busy');
    if (!el) return;
    const flow = (BUSY_FLOW[kind] || BUSY_FLOW.load)(label);
    this.clear();
    el.classList.remove('done');
    $('#busyText').classList.remove('out');
    $('#busyText').textContent = flow[0] + '...';
    $('#busySub').textContent = '';
    el.classList.add('show');
    this.shownAt = Date.now();
    flow.slice(1).forEach((m, i) => this.timers.push(setTimeout(() => smoothText($('#busyText'), m + '...'), 1300 * (i + 1))));
    this.timers.push(setTimeout(() => smoothText($('#busySub'), 'การเชื่อมต่อช้ากว่าปกติเล็กน้อย กรุณารอสักครู่'), 7000));
  },
  clear() { this.timers.forEach(clearTimeout); this.timers = []; },
  async finish(doneText) {
    this.clear();
    const el = $('#busy');
    if (!el) return;
    const left = 420 - (Date.now() - this.shownAt);           // แสดงอย่างน้อยครู่หนึ่ง เพื่อไม่ให้กะพริบ
    if (left > 0) await wait(left);
    if (doneText) {
      smoothText($('#busySub'), '');
      smoothText($('#busyText'), doneText);
      el.classList.add('done');
      await wait(750);
    }
    this.close();
  },
  close() { this.clear(); const el = $('#busy'); if (el) { el.classList.remove('show'); setTimeout(() => el.classList.remove('done'), 300); } },
  // ครอบงานทั้งชุด (เช่น ลบแล้วโหลดใหม่) ให้เป็นหน้าต่างเดียวที่ข้อความไหลต่อเนื่อง
  async run(kind, label, fn, doneText) {
    if (this.depth > 0 || S.booting) { this.depth++; try { return await fn(); } finally { this.depth--; } }
    this.depth = 1;
    this.open(kind, label);
    try {
      const r = await fn();
      await this.finish(doneText === undefined ? BUSY_DONE[kind] : doneText);
      return r;
    } catch (e) { this.close(); throw e; } finally { this.depth = 0; }
  }
};
const ACTION_BUSY = { save: 'save', saveUser: 'save', saveSettings: 'save', bulk: 'import', remove: 'delete', reset: 'reset', upload: 'upload', bootstrap: 'load', logs: 'logs', login: 'login', logout: 'logout', changePassword: 'password', ping: 'connect' };
function busyLabel(action, p) {
  if (action === 'saveUser') return 'ข้อมูลผู้ใช้งาน';
  if (action === 'saveSettings') return 'การตั้งค่าระบบ';
  return (p && TABLE_LABEL[p.table]) || '';
}

/* ================= การเชื่อมต่อ API ================= */
let pending = 0;
function setLoading(on) { const el = $('#topLoad'); if (el) el.hidden = !on; }
async function remote(action, payload, url) {
  const target = url || API_URL;
  if (!target) throw new Error('ยังไม่ได้ตั้งค่าการเชื่อมต่อฐานข้อมูล (URL ของ Google Apps Script)');
  const body = JSON.stringify(Object.assign({ action, token: S.token }, payload));
  let res;
  try { res = await fetch(target, { method: 'POST', body, redirect: 'follow' }); } // ไม่ใส่ header เพื่อไม่ให้เกิด CORS preflight
  catch (e) { throw new Error('เชื่อมต่อ Google Apps Script ไม่ได้ — ตรวจสอบ URL ของเว็บแอปและการเชื่อมต่ออินเทอร์เน็ต'); }
  const txt = await res.text();
  let j;
  try { j = JSON.parse(txt); } catch (e) { throw new Error('เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง — ตรวจสอบว่า Deploy เว็บแอปแบบ "ผู้ที่มีสิทธิ์เข้าถึง: ทุกคน" และใช้ URL ที่ลงท้ายด้วย /exec'); }
  if (!j.ok) throw new Error(j.error || 'เกิดข้อผิดพลาด');
  return j.data;
}
async function api(action, payload, opts) {
  payload = payload || {}; opts = opts || {};
  const kind = opts.busy === false ? null : (opts.busy || ACTION_BUSY[action]);
  pending++; setLoading(true);
  try {
    if (!kind) return await remote(action, payload);
    return await Busy.run(kind, opts.label != null ? opts.label : busyLabel(action, payload), () => remote(action, payload), opts.done);
  } catch (err) {
    if (err && err.message === 'SESSION_EXPIRED') handleExpired();
    throw err;
  } finally { pending--; if (!pending) setLoading(false); }
}
function handleExpired() {
  if (!S.user) return;
  S.user = null; S.token = null; store.del('bt_session');
  closeModal(); showLogin();
  toast('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่', 'warning');
}

/* ================= ตัวช่วยข้อมูล ================= */
function pickFields(table, rec) {
  const o = {};
  TABLES[table].forEach((k) => { if (['createdAt', 'updatedAt', 'createdBy', 'passwordHash'].indexOf(k) < 0 && rec[k] !== undefined) o[k] = rec[k]; });
  return o;
}

/* ================= การคำนวณ ================= */
function computeFY(fyId, o) {
  o = o || {};
  const fy = byId('fiscalYears', fyId) || {};
  let cats = S.data.categories.filter((c) => c.fiscalYearId === fyId);
  if (o.plan) cats = cats.filter((c) => (c.plan || NO_PLAN) === o.plan);
  const catIds = new Set(cats.map((c) => c.id));
  let items = S.data.items.filter((i) => i.fiscalYearId === fyId && catIds.has(i.categoryId));
  if (o.resp) items = items.filter((i) => i.responsibleId === o.resp);
  const itemIds = new Set(items.map((i) => i.id));
  const exps = S.data.expenses.filter((e) => e.fiscalYearId === fyId && e.status !== 'ยกเลิก' && itemIds.has(e.itemId) && (!o.asOf || String(e.date) <= o.asOf));
  const usedBy = {}, pendBy = {}, monthly = Array(12).fill(0);
  let paid = 0, pendingAmt = 0;
  exps.forEach((e) => {
    const a = num(e.amount);
    usedBy[e.itemId] = (usedBy[e.itemId] || 0) + a;
    if (e.status === 'รอเบิกจ่าย') { pendBy[e.itemId] = (pendBy[e.itemId] || 0) + a; pendingAmt += a; } else paid += a;
    const m = fiscalMonthIndex(e.date);
    if (m >= 0) monthly[m] += a;
  });
  const catMap = {}; cats.forEach((c) => { catMap[c.id] = c; });
  const respMap = {}; S.data.responsibles.forEach((r) => { respMap[r.id] = r; });
  const itemRows = items.map((i) => {
    const b = num(i.budget), u = usedBy[i.id] || 0;
    return Object.assign({}, i, { budgetN: b, used: u, pending: pendBy[i.id] || 0, remain: b - u, p: pct(u, b), cat: catMap[i.categoryId], resp: respMap[i.responsibleId] });
  }).sort((a, b) => byCode(a.cat || {}, b.cat || {}) || byCode(a, b));
  const catRows = cats.map((c) => {
    const its = itemRows.filter((i) => i.categoryId === c.id);
    const b = sum(its, 'budgetN'), u = sum(its, 'used');
    return Object.assign({}, c, { items: its, budgetN: b, used: u, pending: sum(its, 'pending'), remain: b - u, p: pct(u, b) });
  }).sort(byCode);
  const allocated = sum(itemRows, 'budgetN'), used = paid + pendingAmt;
  const total = (o.plan || o.resp) ? allocated : (num(fy.totalBudget) || allocated);
  return { fy, cats: catRows, items: itemRows, exps, allocated, used, paid, pending: pendingAmt, total, remain: total - used, p: pct(used, total), monthly };
}
function fyElapsed(fy) {
  const a = parseDate(fy.startDate), b = parseDate(fy.endDate), t = parseDate(today());
  if (!a || !b || b <= a) return 0;
  return Math.max(0, Math.min(100, ((t - a) / (b - a)) * 100));
}

/* ================= Modal ================= */
let modalTimer = null;
function openModal(html, size) {
  clearTimeout(modalTimer);
  const b = $('#modalBox'), m = $('#modal');
  b.className = `bg-white rounded-2xl shadow-pop w-full ${size || 'max-w-2xl'} flex flex-col overflow-hidden`;
  b.style.maxHeight = '92vh';
  b.innerHTML = html;
  if (m.classList.contains('show')) { b.classList.add('form-swap'); }   // เปลี่ยนเนื้อหาในหน้าต่างเดิมแบบนุ่มนวล
  m.classList.add('show');
  document.body.style.overflow = 'hidden';
}
function closeModal() {
  const m = $('#modal');
  m.classList.remove('show');
  document.body.style.overflow = '';
  clearTimeout(modalTimer);
  modalTimer = setTimeout(() => { if (!m.classList.contains('show')) $('#modalBox').innerHTML = ''; }, 300);
}
const modalHead = (icon, titleHtml, subHtml) => `<div class="px-5 md:px-6 py-4 border-b border-slate-100 flex items-center gap-3 shrink-0">
  <div class="w-10 h-10 rounded-xl bg-brand-50 text-brand-500 grid place-items-center shrink-0"><span class="mi">${icon}</span></div>
  <div class="min-w-0"><div class="font-bold text-lg text-slate-800 truncate">${titleHtml}</div>${subHtml ? `<div class="text-xs text-slate-500 truncate">${subHtml}</div>` : ''}</div>
  <button type="button" class="icon-btn ml-auto shrink-0" data-close title="ปิด"><span class="mi">close</span></button></div>`;

/* ================= ฟอร์ม ================= */
function fieldHtml(f, v, isNew) {
  const id = 'f_' + f.key;
  v = v == null ? '' : v;
  const req = (typeof f.required === 'function' ? f.required(isNew) : f.required) ? '<span class="text-rose-500">*</span>' : '';
  const wrap = (inner) => `<div class="${f.full ? 'sm:col-span-2' : ''}"><label for="${id}" class="block text-[13px] font-semibold text-slate-600 mb-1.5">${esc(f.label)} ${req}</label>${inner}${f.help ? `<div class="text-xs text-slate-400 mt-1">${f.help}</div>` : ''}</div>`;
  const optHtml = (o) => `<option value="${esc(o[0])}" ${String(v) === String(o[0]) ? 'selected' : ''}>${esc(o[1])}</option>`;
  switch (f.type) {
    case 'html': return `<div class="sm:col-span-2" id="${id}">${f.html || ''}</div>`;
    case 'textarea': return wrap(`<textarea id="${id}" name="${f.key}" rows="${f.rows || 2}" class="inp">${esc(v)}</textarea>`);
    case 'select': {
      const opts = f.options();
      return wrap(`<select id="${id}" name="${f.key}" class="inp">${f.noEmpty ? '' : `<option value="">${esc(f.placeholder || '— เลือก —')}</option>`}${opts.map((o) => (o.group ? `<optgroup label="${esc(o.group)}">${o.items.map(optHtml).join('')}</optgroup>` : optHtml(o))).join('')}</select>`);
    }
    case 'money': return wrap(`<div class="relative"><input id="${id}" name="${f.key}" type="text" inputmode="decimal" autocomplete="off" class="inp text-right font-semibold" style="padding-right:48px" value="${v === '' ? '' : money(v)}" data-money><span class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">บาท</span></div>`);
    case 'checkbox': return `<div class="${f.full ? 'sm:col-span-2' : ''} flex items-end"><label class="flex items-center gap-2.5 cursor-pointer select-none py-2"><input type="checkbox" name="${f.key}" ${isTrue(v) ? 'checked' : ''} class="w-5 h-5" style="accent-color:#1D4ED8"><span class="font-semibold text-slate-700 text-sm">${esc(f.label)}</span></label></div>`;
    case 'color': {
      const cur = String(v || PALETTE[0]);
      const list = PALETTE.some((c) => c.toLowerCase() === cur.toLowerCase()) ? PALETTE : [cur].concat(PALETTE);
      return wrap(`<div class="flex flex-wrap gap-2.5">${list.map((c) => `<label class="cursor-pointer"><input type="radio" name="${f.key}" value="${esc(c)}" class="peer sr-only" ${c.toLowerCase() === cur.toLowerCase() ? 'checked' : ''}><span class="block w-8 h-8 rounded-full ring-2 ring-transparent ring-offset-2 peer-checked:ring-slate-700 transition" style="background:${esc(c)}"></span></label>`).join('')}</div>`);
    }
    case 'file': return wrap(`<div class="flex gap-2"><input id="${id}" name="${f.key}" class="inp" value="${esc(v)}" placeholder="วางลิงก์ หรือกดปุ่มเพื่ออัปโหลดไฟล์">${v ? `<a href="${esc(v)}" target="_blank" rel="noopener" class="btn btn-ghost" title="เปิดไฟล์"><span class="mi text-[20px]">open_in_new</span></a>` : ''}<label class="btn btn-soft" title="อัปโหลดไฟล์"><span class="mi text-[20px]">upload</span><input type="file" class="hidden" data-upload="${f.key}" accept="${esc(f.accept || 'image/*,application/pdf')}"></label></div>`);
    case 'datalist': return wrap(`<input id="${id}" name="${f.key}" class="inp" list="${id}_dl" value="${esc(v)}" autocomplete="off" placeholder="${esc(f.placeholder || '')}"><datalist id="${id}_dl">${f.options().map((o) => `<option value="${esc(o)}">`).join('')}</datalist>`);
    case 'password': return wrap(`<input id="${id}" name="${f.key}" type="password" class="inp" autocomplete="new-password" placeholder="${esc(f.placeholder || '')}">`);
    default: return wrap(`<input id="${id}" name="${f.key}" type="${f.type || 'text'}" class="inp" value="${esc(v)}" placeholder="${esc(f.placeholder || '')}" ${f.type === 'number' ? 'step="any"' : ''}>`);
  }
}
function collect(form, fields) {
  const out = {};
  fields.forEach((f) => {
    if (f.type === 'html') return;
    if (f.type === 'color') { const c = form.querySelector(`input[name="${f.key}"]:checked`); out[f.key] = c ? c.value : ''; return; }
    const el = form.elements[f.key];
    if (!el) return;
    if (f.type === 'checkbox') out[f.key] = el.checked ? 'TRUE' : 'FALSE';
    else if (f.type === 'money' || f.type === 'number') out[f.key] = String(el.value).trim() === '' ? '' : num(el.value);
    else if (f.type === 'password') out[f.key] = el.value;
    else out[f.key] = String(el.value).trim();
  });
  return out;
}
function upsertLocal(table, rec) {
  if (!rec || !S.data[table]) return;
  const arr = S.data[table], i = arr.findIndex((x) => String(x.id) === String(rec.id));
  if (i >= 0) arr[i] = rec; else arr.push(rec);
}
function openForm(cfg, rec, preset) {
  const isNew = !rec;
  const data = Object.assign({}, isNew ? (cfg.defaults ? cfg.defaults() : {}) : rec, preset || {});
  const fields = typeof cfg.fields === 'function' ? cfg.fields(data, isNew) : cfg.fields;
  openModal(`<form id="frm" novalidate class="flex flex-col min-h-0 h-full">
    ${modalHead(cfg.icon || 'edit_note', (isNew ? 'เพิ่ม' : 'แก้ไข') + esc(cfg.entity || 'ข้อมูล'), cfg.formSub ? cfg.formSub(data) : '')}
    <div class="p-5 md:p-6 overflow-auto grid sm:grid-cols-2 gap-4">${fields.map((f) => fieldHtml(f, data[f.key], isNew)).join('')}</div>
    <div class="px-5 md:px-6 py-4 border-t border-slate-100 flex justify-end gap-2 bg-slate-50 shrink-0">
      <button type="button" class="btn btn-ghost" data-close>ยกเลิก</button>
      <button type="submit" class="btn btn-primary" id="frmSave"><span class="mi text-[20px]">save</span>บันทึก</button>
    </div></form>`, cfg.wide ? 'max-w-3xl' : 'max-w-2xl');
  const form = $('#frm');
  if (cfg.onForm) cfg.onForm(form, data, isNew);
  const first = form.querySelector('input:not([type=hidden]):not([type=radio]):not([type=checkbox]):not([type=file]),select,textarea');
  if (first) setTimeout(() => first.focus(), 60);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const vals = collect(form, fields);
    const miss = fields.find((f) => (typeof f.required === 'function' ? f.required(isNew) : f.required) && (vals[f.key] === '' || vals[f.key] == null));
    if (miss) { const el = form.elements[miss.key]; if (el && el.focus) el.focus(); return info(`กรุณากรอก <b>${esc(miss.label)}</b>`, 'ข้อมูลไม่ครบ'); }
    const record = Object.assign({}, isNew ? data : { id: rec.id }, vals);
    if (cfg.beforeSave) { const ok = await cfg.beforeSave(record, rec, isNew); if (ok === false) return; }
    const btn = $('#frmSave');
    btn.disabled = true; btn.innerHTML = '<span class="mi text-[20px] animate-spin">progress_activity</span>กำลังบันทึก...';
    try {
      const saved = cfg.saveFn ? await cfg.saveFn(record, isNew) : await api('save', { table: cfg.table, record });
      upsertLocal(cfg.table, saved);
      closeModal();
      if (cfg.afterSave) cfg.afterSave(saved, isNew);
      rerender();
    } catch (err) {
      alertErr(err);
      if ($('#frmSave')) { btn.disabled = false; btn.innerHTML = '<span class="mi text-[20px]">save</span>บันทึก'; }
    }
  };
}

/* ================= ตารางข้อมูลแบบใช้ซ้ำ (CRUD) ================= */
function crud(cfg) {
  const ui = S.ui[cfg.id] || (S.ui[cfg.id] = { q: '', f: {} });
  const ro = !!cfg.readOnly;
  const canAdd = !ro && (cfg.canAdd ? cfg.canAdd() : can('editor'));
  const canEdit = (r) => !ro && (cfg.canEdit ? cfg.canEdit(r) : can('editor'));
  const canDel = (r) => !ro && (cfg.canDelete ? cfg.canDelete(r) : can('editor'));
  const acts = cfg.actions || [];
  const showActs = !ro || acts.length > 0;
  const allCols = cfg.columns;
  cfg = Object.assign({}, cfg, { columns: allCols.filter((c) => !c.csvOnly) });
  const hasSum = cfg.columns.some((c) => c.sum);
  const filters = cfg.filters || [];
  $('#view').innerHTML = `${cfg.top ? cfg.top() : ''}
  <div class="bg-white rounded-2xl shadow-soft animate-slide-up overflow-hidden">
    <div class="p-3 md:p-4 flex flex-wrap gap-2 items-center border-b border-slate-100">
      <div class="relative flex-1 min-w-[180px]">
        <span class="mi absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[20px]">search</span>
        <input id="crudQ" class="inp" style="padding-left:40px" placeholder="${esc(cfg.searchPh || 'ค้นหา...')}" value="${esc(ui.q)}">
      </div>
      ${filters.map((f) => `<select class="inp" style="width:auto;max-width:230px" data-filter="${f.key}"><option value="">${esc(f.label)}</option>${f.options().map((o) => `<option value="${esc(o[0])}" ${String(ui.f[f.key] || '') === String(o[0]) ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select>`).join('')}
      <button class="btn btn-soft" id="crudCsv" title="ส่งออกเป็น CSV (เปิดด้วย Excel ได้)"><span class="mi text-[20px]">download</span><span class="hidden sm:inline">CSV</span></button>
      ${canAdd ? `<button class="btn btn-primary" id="crudAdd"><span class="mi text-[20px]">add</span>${esc(cfg.addLabel || 'เพิ่มข้อมูล')}</button>` : ''}
    </div>
    <div id="crudSummary"></div>
    <div class="overflow-auto" style="max-height:calc(100vh - 280px);min-height:220px">
      <table class="tbl w-full"><thead><tr>${cfg.columns.map((c) => `<th class="px-3 py-3 ${c.right ? 'text-right' : c.center ? 'text-center' : 'text-left'}">${esc(c.label)}</th>`).join('')}${showActs ? '<th class="px-3 py-3 text-center" style="width:1%">จัดการ</th>' : ''}</tr></thead>
      <tbody id="crudBody"></tbody>${hasSum ? '<tfoot id="crudFoot"></tfoot>' : ''}</table>
    </div>
    <div class="px-4 py-2.5 text-xs text-slate-500 border-t border-slate-100" id="crudCount"></div>
  </div>`;
  let current = [];
  const tdCls = (c) => `px-3 py-2.5 ${c.right ? 'text-right whitespace-nowrap' : c.center ? 'text-center' : ''} ${c.cls || ''}`;
  const draw = () => {
    let rows = cfg.rows();
    filters.forEach((f) => { const v = ui.f[f.key]; if (v) rows = rows.filter((r) => f.test(r, v)); });
    const q = String(ui.q || '').trim().toLowerCase();
    if (q) rows = rows.filter((r) => String(cfg.search ? cfg.search(r) : Object.values(r).join(' ')).toLowerCase().indexOf(q) >= 0);
    current = rows;
    const colN = cfg.columns.length + (showActs ? 1 : 0);
    $('#crudBody').innerHTML = rows.length ? rows.map((r) => `<tr data-id="${esc(r.id)}">${cfg.columns.map((c) => `<td class="${tdCls(c)}">${c.html(r)}</td>`).join('')}${showActs ? `<td class="px-2 py-1.5 whitespace-nowrap text-center">${acts.filter((a) => !a.show || a.show(r)).map((a) => `<button class="icon-btn" data-act="${a.id}" title="${esc(a.title)}"><span class="mi text-[20px]">${a.icon}</span></button>`).join('')}${canEdit(r) ? '<button class="icon-btn" data-act="edit" title="แก้ไข"><span class="mi text-[20px]">edit</span></button>' : ''}${canDel(r) ? '<button class="icon-btn danger" data-act="del" title="ลบ"><span class="mi text-[20px]">delete</span></button>' : ''}</td>` : ''}</tr>`).join('')
      : `<tr><td colspan="${colN}" class="py-14 text-center text-slate-400"><span class="mi block mx-auto mb-2" style="font-size:48px">inbox</span>${q || Object.values(ui.f).some(Boolean) ? 'ไม่พบข้อมูลที่ตรงกับเงื่อนไข' : esc(cfg.emptyText || 'ยังไม่มีข้อมูล')}</td></tr>`;
    if (hasSum) $('#crudFoot').innerHTML = `<tr>${cfg.columns.map((c, i) => `<td class="${tdCls(c)}">${c.sum ? money(sum(rows, c.sum)) : i === 0 ? 'รวม' : ''}</td>`).join('')}${showActs ? '<td></td>' : ''}</tr>`;
    $('#crudCount').textContent = `แสดง ${rows.length.toLocaleString('th-TH')} รายการ`;
    if (cfg.summary) $('#crudSummary').innerHTML = cfg.summary(rows);
  };
  let t;
  $('#crudQ').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { ui.q = e.target.value; draw(); }, 180); });
  $$('[data-filter]').forEach((sel) => sel.addEventListener('change', () => { ui.f[sel.dataset.filter] = sel.value; draw(); }));
  if ($('#crudAdd')) $('#crudAdd').onclick = () => openForm(cfg);
  $('#crudCsv').onclick = () => exportCsv(cfg.csvName || cfg.entity || cfg.id, allCols.map((c) => c.label), current.map((r) => allCols.map((c) => (c.csv ? c.csv(r) : stripHtml(c.html(r))))));
  $('#crudBody').onclick = (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const r = current.find((x) => String(x.id) === b.closest('tr').dataset.id);
    if (!r) return;
    if (b.dataset.act === 'edit') return openForm(cfg, r);
    if (b.dataset.act === 'del') return delRecord(cfg, r);
    const a = acts.find((x) => x.id === b.dataset.act);
    if (a) a.run(r);
  };
  draw();
}
async function delRecord(cfg, r) {
  const label = cfg.describe ? cfg.describe(r) : (r.name || r.description || r.username || r.id);
  const extra = cfg.deleteWarn ? cfg.deleteWarn(r) : '';
  if (!(await confirmBox('ยืนยันการลบข้อมูล?', `<b>${esc(label)}</b>${extra ? `<div class="mt-2 text-sm text-rose-600">${extra}</div>` : ''}<div class="text-sm text-slate-500 mt-2">การลบไม่สามารถย้อนกลับได้</div>`, { danger: true, ok: 'ลบข้อมูล' }))) return;
  try {
    await Busy.run('delete', cfg.entity || '', async () => { await api('remove', { table: cfg.table, id: r.id }); await loadAll(); });
    rerender();
  } catch (e) { alertErr(e); }
}
function download(name, content, type) {
  const b = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
}
function exportCsv(name, headers, rows) {
  const q = (v) => { const s = String(v == null ? '' : v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  download(`${name}_${today()}.csv`, '\ufeff' + [headers].concat(rows).map((r) => r.map(q).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
}

/* ================= ส่วนประกอบหน้าจอ ================= */
function kpi(label, value, sub, icon, color, extra) {
  return `<div class="card-hover bg-white rounded-2xl shadow-soft p-4 md:p-5 relative overflow-hidden animate-slide-up">
    <div class="absolute -right-8 -top-8 w-28 h-28 rounded-full" style="background:${color};opacity:.09"></div>
    <div class="flex items-start gap-3 relative">
      <div class="w-11 h-11 rounded-xl grid place-items-center text-white shrink-0 shadow" style="background:${color}"><span class="mi fill">${icon}</span></div>
      <div class="min-w-0 flex-1">
        <div class="text-[13px] text-slate-500 font-medium">${label}</div>
        <div class="text-lg md:text-2xl font-bold text-slate-800 truncate leading-tight mt-0.5">${value}</div>
        <div class="text-xs text-slate-400 mt-1">${sub || ''}</div>${extra || ''}
      </div></div></div>`;
}
const emptyState = (icon, title, text, btn) => `<div class="bg-white rounded-2xl shadow-soft p-10 text-center animate-slide-up">
  <div class="w-16 h-16 mx-auto rounded-2xl bg-brand-50 text-brand-500 grid place-items-center mb-4"><span class="mi" style="font-size:36px">${icon}</span></div>
  <div class="text-lg font-bold text-slate-700">${title}</div><div class="text-slate-500 mt-1">${text}</div>${btn || ''}</div>`;
function needFY() {
  if (fyObj()) return false;
  const step = (n, t, d) => `<li class="flex gap-3 text-left"><span class="w-7 h-7 rounded-full bg-brand-500 text-white grid place-items-center text-sm font-bold shrink-0">${n}</span><span><b class="text-slate-700">${t}</b><span class="block text-sm text-slate-500">${d}</span></span></li>`;
  const btn = can('editor') ? '<div class="mt-6"><button class="btn btn-primary" data-go="years"><span class="mi">add</span>เพิ่มปีงบประมาณแรก</button></div>' : '<div class="mt-5 text-sm text-slate-500">กรุณาติดต่อเจ้าหน้าที่หรือผู้ดูแลระบบเพื่อเพิ่มข้อมูล</div>';
  $('#view').innerHTML = `<div class="bg-white rounded-2xl shadow-soft p-8 md:p-10 animate-slide-up max-w-2xl mx-auto">
    <div class="text-center"><div class="w-16 h-16 mx-auto rounded-2xl bg-brand-50 text-brand-500 grid place-items-center mb-4"><span class="mi" style="font-size:36px">rocket_launch</span></div>
    <div class="text-xl font-bold text-slate-800">เริ่มต้นใช้งานระบบ</div><div class="text-slate-500 mt-1">ยังไม่มีปีงบประมาณ กรอกข้อมูลตามลำดับนี้</div></div>
    <ol class="mt-6 space-y-4 max-w-md mx-auto">
      ${step(1, 'ปีงบประมาณ', 'เพิ่มปี พ.ศ. และวงเงินงบประมาณที่ได้รับ')}
      ${step(2, 'หมวด / แผนงาน', 'จัดกลุ่มงบ เช่น ค่าวัสดุ ค่าสาธารณูปโภค')}
      ${step(3, 'รายการงบประมาณ', 'จัดสรรงบลงแต่ละรายการ พร้อมผู้รับผิดชอบ')}
      ${step(4, 'รายการเบิกจ่าย', 'บันทึกทุกครั้งที่มีการเบิกจ่าย ระบบคำนวณยอดคงเหลือให้อัตโนมัติ')}
    </ol><div class="text-center">${btn}</div></div>`;
  return true;
}
const logoHtml = (cls) => (S.settings.logoUrl
  ? `<img src="${esc(S.settings.logoUrl)}" alt="โลโก้" class="w-full h-full object-contain p-1" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'mi fill text-brand-500',textContent:'account_balance'}))">`
  : `<span class="mi fill text-brand-500 ${cls || ''}" style="font-size:28px">account_balance</span>`);
function mkChart(id, config) {
  const c = document.getElementById(id);
  if (!c || !window.Chart) return null;
  const ch = new Chart(c, config);
  S.charts.push(ch);
  return ch;
}
function killCharts() { S.charts.forEach((c) => { try { c.destroy(); } catch (e) { /* ignore */ } }); S.charts = []; }
const moneyTip = { callbacks: { label: (c) => `${c.dataset.label || c.label}: ${money(c.raw)} บาท` } };

/* ================= หน้าต่าง ๆ ================= */
const VIEWS = {};

/* ---------- 1) แดชบอร์ด ---------- */
VIEWS.dashboard = () => {
  if (needFY()) return;
  const st = computeFY(S.fy), fy = st.fy, warn = warnPct();
  setTimeout(() => smoothText($('#pageSub'), `ภาพรวมการใช้จ่ายงบประมาณ · ปีงบประมาณ ${fy.year}`), 230);
  const near = st.items.filter((i) => i.budgetN > 0 && i.p >= warn).sort((a, b) => b.p - a.p).slice(0, 8);
  const recent = S.data.expenses.filter((e) => e.fiscalYearId === S.fy).sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 8);
  const el = fyElapsed(fy);
  const unalloc = st.total - st.allocated;
  $('#view').innerHTML = `
  <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 md:gap-4">
    ${kpi(`งบประมาณปี ${esc(fy.year)}`, `${money(st.total)} <span class="text-sm font-medium text-slate-400">บาท</span>`, `จัดสรรลงรายการแล้ว ${money(st.allocated)} บาท`, 'account_balance_wallet', '#1D4ED8')}
    ${kpi('ใช้จ่ายแล้ว', `${money(st.used)} <span class="text-sm font-medium text-slate-400">บาท</span>`, `เบิกจ่ายแล้ว ${money(st.paid)} · รอเบิก ${money(st.pending)}`, 'payments', '#0EA5E9')}
    ${kpi('คงเหลือ', `${moneyC(st.remain)} <span class="text-sm font-medium text-slate-400">บาท</span>`, unalloc > 0 ? `ยังไม่จัดสรรลงรายการ ${money(unalloc)} บาท` : `คงเหลือ ${(100 - st.p).toFixed(1)}% ของงบประมาณ`, 'savings', st.remain < 0 ? '#EF5350' : '#0288D1')}
    ${kpi('อัตราการใช้จ่าย', `${st.p.toFixed(2)}%`, `ผ่านไปแล้ว ${el.toFixed(0)}% ของปีงบประมาณ`, 'donut_large', '#6366F1', `<div class="mt-2">${prog(st.p)}</div>`)}
  </div>
  ${!st.items.length ? `<div class="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 flex flex-wrap items-center gap-3 text-amber-900"><span class="mi">info</span><span class="flex-1 min-w-[200px]">ปีงบประมาณนี้ยังไม่มีรายการงบประมาณ เริ่มจากกำหนดหมวด/แผนงาน แล้วเพิ่มรายการงบประมาณ</span>${can('editor') ? '<button class="btn btn-warn" data-go="categories">ไปที่หมวด / แผนงาน</button>' : ''}</div>` : ''}
  <div class="grid lg:grid-cols-3 gap-4 mt-4">
    <div class="panel lg:col-span-2 animate-slide-up"><div class="panel-title"><span class="mi">bar_chart</span>การใช้จ่ายรายเดือน (ต.ค. – ก.ย.)</div><div class="chartbox" style="height:290px"><canvas id="chMonth"></canvas></div></div>
    <div class="panel animate-slide-up"><div class="panel-title"><span class="mi">donut_small</span>${st.used ? 'สัดส่วนการใช้จ่ายตามหมวด' : 'สัดส่วนงบประมาณตามหมวด'}</div><div class="chartbox" style="height:290px"><canvas id="chCat"></canvas></div></div>
  </div>
  <div class="grid lg:grid-cols-3 gap-4 mt-4">
    <div class="panel lg:col-span-2 animate-slide-up"><div class="panel-title"><span class="mi">stacked_bar_chart</span>ความก้าวหน้าการใช้จ่ายรายหมวด<span class="ml-auto text-xs font-normal text-slate-400">คลิกเพื่อดูรายการ</span></div>
      <div class="space-y-3">${st.cats.length ? st.cats.map((c) => `<button class="w-full text-left block rounded-xl p-2 -m-2 hover:bg-brand-50/60" data-cat="${esc(c.id)}">
        <div class="flex items-center gap-2 text-sm"><span class="w-3 h-3 rounded-full shrink-0" style="background:${esc(c.color || '#1D4ED8')}"></span><span class="font-semibold text-slate-700 truncate">${esc(c.name)}</span><span class="text-xs text-slate-400 truncate hidden sm:inline">${esc(c.plan || '')}</span>
        <span class="ml-auto text-xs text-slate-500 whitespace-nowrap">${money(c.used, 0)} / ${money(c.budgetN, 0)} บาท</span><span class="text-xs font-bold w-14 text-right ${c.p > 100 ? 'text-rose-600' : 'text-brand-600'}">${c.p.toFixed(1)}%</span></div>
        <div class="mt-1.5">${prog(c.p)}</div></button>`).join('') : '<div class="text-center text-slate-400 py-8">ยังไม่มีหมวด/แผนงาน</div>'}</div></div>
    <div class="panel animate-slide-up"><div class="panel-title"><span class="mi">warning</span>รายการที่ใช้งบเกิน ${warn}%</div>
      <div class="space-y-2.5">${near.length ? near.map((i) => `<button class="w-full text-left rounded-xl border border-slate-100 p-3 hover:border-brand-200 hover:bg-brand-50/40" data-ledger="${esc(i.id)}">
        <div class="flex items-start gap-2"><div class="min-w-0 flex-1"><div class="font-semibold text-sm text-slate-700 truncate">${esc(i.name)}</div><div class="text-xs text-slate-400 truncate">${esc(i.cat ? i.cat.name : '')}</div></div>
        <span class="text-sm font-bold ${i.p > 100 ? 'text-rose-600' : 'text-amber-600'}">${i.p.toFixed(0)}%</span></div>
        <div class="mt-2">${prog(i.p)}</div><div class="text-xs text-slate-500 mt-1">คงเหลือ ${moneyC(i.remain)} บาท</div></button>`).join('')
        : `<div class="text-center py-8"><span class="mi text-emerald-500" style="font-size:40px">verified</span><div class="text-sm text-slate-500 mt-1">ยังไม่มีรายการที่ใช้งบเกิน ${warn}%</div></div>`}</div></div>
  </div>
  <div class="panel mt-4 animate-slide-up"><div class="panel-title"><span class="mi">receipt</span>รายการเบิกจ่ายล่าสุด<button class="ml-auto text-sm font-semibold text-brand-500 hover:underline" data-go="expenses">ดูทั้งหมด</button></div>
    <div class="overflow-x-auto"><table class="w-full text-sm"><tbody>${recent.length ? recent.map((e) => { const it = byId('items', e.itemId); return `<tr class="border-b border-slate-100 last:border-0">
      <td class="py-2.5 pr-3 whitespace-nowrap text-slate-500">${thDate(e.date)}</td>
      <td class="py-2.5 pr-3"><div class="font-semibold text-slate-700">${esc(e.description)}</div><div class="text-xs text-slate-400">${esc(it ? it.name : '-')}${e.docNo ? ' · ' + esc(e.docNo) : ''}</div></td>
      <td class="py-2.5 pr-3">${expBadge(e.status)}</td><td class="py-2.5 text-right font-bold whitespace-nowrap text-slate-700">${money(e.amount)}</td></tr>`; }).join('')
      : '<tr><td class="py-8 text-center text-slate-400">ยังไม่มีรายการเบิกจ่ายในปีงบประมาณนี้</td></tr>'}</tbody></table></div></div>`;

  const cum = []; st.monthly.reduce((s, v, i) => (cum[i] = s + v), 0);
  mkChart('chMonth', {
    type: 'bar',
    data: { labels: FY_MON, datasets: [
      { type: 'bar', label: 'ใช้จ่ายรายเดือน', data: st.monthly, backgroundColor: 'rgba(59,130,246,.8)', hoverBackgroundColor: '#1D4ED8', borderRadius: 8, yAxisID: 'y', order: 2 },
      { type: 'line', label: 'ยอดสะสม', data: cum, borderColor: '#1E3A8A', backgroundColor: '#1E3A8A', tension: 0.35, pointRadius: 3, borderWidth: 2.5, yAxisID: 'y1', order: 1 }
    ] },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom' }, tooltip: moneyTip },
      scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { callback: short } }, y1: { position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, ticks: { callback: short } } } }
  });
  const useBudget = !st.used;
  const src = st.cats.filter((c) => (useBudget ? c.budgetN : c.used) > 0);
  mkChart('chCat', {
    type: 'doughnut',
    data: { labels: src.map((c) => c.name), datasets: [{ data: src.map((c) => (useBudget ? c.budgetN : c.used)), backgroundColor: src.map((c, i) => c.color || PALETTE[i % PALETTE.length]), borderColor: '#fff', borderWidth: 2 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } }, tooltip: moneyTip } }
  });
  $('#view').onclick = (e) => {
    const c = e.target.closest('[data-cat]');
    if (c) { S.ui.items = { q: '', f: { cat: c.dataset.cat } }; go('items'); return; }
    const l = e.target.closest('[data-ledger]');
    if (l) openLedger(l.dataset.ledger);
  };
};

/* ---------- 2) เปรียบเทียบปีงบ ---------- */
VIEWS.compare = () => {
  if (needFY()) return;
  const ys = sortedYears();
  const ui = S.ui.compare || (S.ui.compare = {});
  if (!byId('fiscalYears', ui.a)) ui.a = S.fy;
  if (!byId('fiscalYears', ui.b) || ui.b === ui.a) {
    const ya = num(byId('fiscalYears', ui.a).year);
    const prev = ys.find((y) => num(y.year) < ya) || ys.find((y) => y.id !== ui.a);
    ui.b = prev ? prev.id : ui.a;
  }
  const A = computeFY(ui.a), B = computeFY(ui.b), yA = A.fy.year, yB = B.fy.year;
  const opts = (sel) => ys.map((y) => `<option value="${esc(y.id)}" ${y.id === sel ? 'selected' : ''}>ปีงบประมาณ ${esc(y.year)}</option>`).join('');
  const cmp = (label, a, b, fmt, icon, color) => {
    const d = b ? ((a - b) / Math.abs(b)) * 100 : 0, up = a >= b;
    return `<div class="card-hover bg-white rounded-2xl shadow-soft p-5 animate-slide-up"><div class="flex items-center gap-3 mb-3"><div class="w-10 h-10 rounded-xl grid place-items-center text-white" style="background:${color}"><span class="mi fill">${icon}</span></div><div class="font-semibold text-slate-600">${label}</div>
      ${b ? `<span class="ml-auto badge" style="background:${up ? '#0EA5E9' : '#EF5350'}1f;color:${up ? '#0EA5E9' : '#EF5350'}"><span class="mi text-[16px]">${up ? 'trending_up' : 'trending_down'}</span>${Math.abs(d).toFixed(1)}%</span>` : ''}</div>
      <div class="grid grid-cols-2 gap-3"><div><div class="text-xs text-slate-400">ปี ${esc(yA)}</div><div class="text-lg font-bold text-brand-600">${fmt(a)}</div></div><div><div class="text-xs text-slate-400">ปี ${esc(yB)}</div><div class="text-lg font-bold text-slate-500">${fmt(b)}</div></div></div></div>`;
  };
  const names = Array.from(new Set(A.cats.concat(B.cats).map((c) => c.name)));
  const g = (st, n, k) => sum(st.cats.filter((c) => c.name === n), k);
  const colorOf = (n) => { const c = A.cats.concat(B.cats).find((x) => x.name === n); return c && c.color; };
  $('#view').innerHTML = `
  <div class="panel mb-4 flex flex-wrap items-center gap-3 animate-slide-up">
    <span class="mi text-brand-500">compare_arrows</span><span class="font-semibold text-slate-600">เปรียบเทียบ</span>
    <select id="cmpA" class="inp" style="width:auto">${opts(ui.a)}</select><span class="text-slate-400">กับ</span>
    <select id="cmpB" class="inp" style="width:auto">${opts(ui.b)}</select>
    ${ys.length < 2 ? '<span class="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-1.5">มีปีงบประมาณเพียงปีเดียว — เพิ่มปีงบประมาณเพื่อเปรียบเทียบ</span>' : ''}
  </div>
  <div class="grid md:grid-cols-3 gap-4">
    ${cmp('งบประมาณ', A.total, B.total, (v) => money(v, 0), 'account_balance_wallet', '#1D4ED8')}
    ${cmp('ใช้จ่าย', A.used, B.used, (v) => money(v, 0), 'payments', '#0EA5E9')}
    ${cmp('อัตราการใช้จ่าย', A.p, B.p, (v) => v.toFixed(2) + '%', 'donut_large', '#6366F1')}
  </div>
  <div class="grid lg:grid-cols-2 gap-4 mt-4">
    <div class="panel animate-slide-up"><div class="panel-title"><span class="mi">bar_chart</span>การใช้จ่ายรายหมวด</div><div class="chartbox" style="height:320px"><canvas id="chCmpCat"></canvas></div></div>
    <div class="panel animate-slide-up"><div class="panel-title"><span class="mi">show_chart</span>ยอดใช้จ่ายสะสมรายเดือน</div><div class="chartbox" style="height:320px"><canvas id="chCmpCum"></canvas></div></div>
  </div>
  <div class="panel mt-4 animate-slide-up"><div class="panel-title"><span class="mi">timeline</span>แนวโน้มทุกปีงบประมาณ</div><div class="chartbox" style="height:260px"><canvas id="chTrend"></canvas></div></div>
  <div class="panel mt-4 animate-slide-up !p-0 overflow-hidden"><div class="panel-title px-5 pt-5"><span class="mi">table_chart</span>ตารางเปรียบเทียบรายหมวด</div>
    <div class="overflow-x-auto"><table class="tbl w-full"><thead><tr><th class="px-3 py-2.5 text-left">หมวด</th><th class="px-3 py-2.5 text-right">งบปี ${esc(yA)}</th><th class="px-3 py-2.5 text-right">ใช้จ่ายปี ${esc(yA)}</th><th class="px-3 py-2.5 text-right">งบปี ${esc(yB)}</th><th class="px-3 py-2.5 text-right">ใช้จ่ายปี ${esc(yB)}</th><th class="px-3 py-2.5 text-right">ผลต่างการใช้จ่าย</th><th class="px-3 py-2.5 text-right">เปลี่ยนแปลง</th></tr></thead>
    <tbody>${names.map((n) => { const ua = g(A, n, 'used'), ub = g(B, n, 'used'), d = ua - ub; return `<tr><td class="px-3 py-2.5"><span class="inline-block w-2.5 h-2.5 rounded-full mr-2" style="background:${esc(colorOf(n) || '#1D4ED8')}"></span>${esc(n)}</td><td class="px-3 py-2.5 text-right">${money(g(A, n, 'budgetN'))}</td><td class="px-3 py-2.5 text-right font-semibold">${money(ua)}</td><td class="px-3 py-2.5 text-right">${money(g(B, n, 'budgetN'))}</td><td class="px-3 py-2.5 text-right">${money(ub)}</td><td class="px-3 py-2.5 text-right ${d > 0 ? 'text-rose-600' : 'text-emerald-600'}">${d > 0 ? '+' : ''}${money(d)}</td><td class="px-3 py-2.5 text-right">${ub ? ((d / ub) * 100).toFixed(1) + '%' : '-'}</td></tr>`; }).join('') || '<tr><td colspan="7" class="py-8 text-center text-slate-400">ไม่มีข้อมูล</td></tr>'}</tbody>
    <tfoot><tr><td class="px-3 py-2.5">รวม</td><td class="px-3 py-2.5 text-right">${money(A.allocated)}</td><td class="px-3 py-2.5 text-right">${money(A.used)}</td><td class="px-3 py-2.5 text-right">${money(B.allocated)}</td><td class="px-3 py-2.5 text-right">${money(B.used)}</td><td class="px-3 py-2.5 text-right">${money(A.used - B.used)}</td><td class="px-3 py-2.5 text-right">${B.used ? (((A.used - B.used) / B.used) * 100).toFixed(1) + '%' : '-'}</td></tr></tfoot></table></div></div>`;
  $('#cmpA').onchange = (e) => { ui.a = e.target.value; VIEWS.compare(); };
  $('#cmpB').onchange = (e) => { ui.b = e.target.value; VIEWS.compare(); };
  killCharts();
  mkChart('chCmpCat', { type: 'bar', data: { labels: names, datasets: [
    { label: `ปี ${yA}`, data: names.map((n) => g(A, n, 'used')), backgroundColor: '#1D4ED8', borderRadius: 6 },
    { label: `ปี ${yB}`, data: names.map((n) => g(B, n, 'used')), backgroundColor: '#93C5FD', borderRadius: 6 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' }, tooltip: moneyTip }, scales: { x: { grid: { display: false }, ticks: { font: { size: 11 } } }, y: { beginAtZero: true, ticks: { callback: short } } } } });
  const cumOf = (m) => { const c = []; m.reduce((s, v, i) => (c[i] = s + v), 0); return c; };
  mkChart('chCmpCum', { type: 'line', data: { labels: FY_MON, datasets: [
    { label: `ปี ${yA}`, data: cumOf(A.monthly), borderColor: '#1D4ED8', backgroundColor: 'rgba(29,78,216,.12)', fill: true, tension: 0.3, borderWidth: 2.5 },
    { label: `ปี ${yB}`, data: cumOf(B.monthly), borderColor: '#60A5FA', backgroundColor: 'rgba(147,197,253,.15)', fill: true, tension: 0.3, borderWidth: 2.5, borderDash: [6, 4] }] },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom' }, tooltip: moneyTip }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { callback: short } } } } });
  const asc = ys.slice().reverse().map((y) => computeFY(y.id));
  mkChart('chTrend', { type: 'bar', data: { labels: asc.map((s) => 'ปี ' + s.fy.year), datasets: [
    { label: 'งบประมาณ', data: asc.map((s) => s.total), backgroundColor: 'rgba(59,130,246,.35)', borderColor: '#3B82F6', borderWidth: 1.5, borderRadius: 6 },
    { label: 'ใช้จ่าย', data: asc.map((s) => s.used), backgroundColor: '#1D4ED8', borderRadius: 6 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' }, tooltip: moneyTip }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { callback: short } } } } });
};

/* ---------- 3) ปีงบประมาณ ---------- */
function cfgYears() {
  return {
    id: 'years', table: 'fiscalYears', entity: 'ปีงบประมาณ', icon: 'calendar_month', addLabel: 'เพิ่มปีงบประมาณ',
    canDelete: () => can('admin'),
    rows: () => sortedYears().map((y) => { const st = computeFY(y.id); return Object.assign({}, y, { allocated: st.allocated, used: st.used, remain: st.remain, p: st.p, nCat: st.cats.length, nItem: st.items.length }); }),
    search: (r) => `${r.year} ${r.name} ${r.note}`,
    columns: [
      { label: 'ปีงบประมาณ', html: (r) => `<div class="flex items-center gap-2"><span class="font-bold text-brand-600 text-base">${esc(r.year)}</span>${r.id === S.fy ? '<span class="badge" style="background:#DBEAFE;color:#1E40AF"><span class="mi text-[14px]">my_location</span>กำลังติดตาม</span>' : ''}</div><div class="text-xs text-slate-500">${esc(r.name)}</div>`, csv: (r) => r.year },
      { label: 'ช่วงเวลา', html: (r) => `<span class="whitespace-nowrap">${thDate(r.startDate)} – ${thDate(r.endDate)}</span>` },
      mcol('วงเงินที่ได้รับ', 'totalBudget'),
      mcol('จัดสรรลงรายการ', 'allocated'),
      mcol('ใช้จ่ายแล้ว', 'used'),
      mcol('คงเหลือ', 'remain', { html: (r) => moneyC(r.remain) }),
      { label: 'ร้อยละ', html: (r) => progCell(r.p), csv: (r) => r.p.toFixed(2) },
      { label: 'สถานะ', html: (r) => fyBadge(r.status), csv: (r) => (FY_STATUS[r.status] || [''])[0], center: true }
    ],
    actions: [
      { id: 'track', icon: 'my_location', title: 'ตั้งเป็นปีที่กำลังติดตาม', show: (r) => r.id !== S.fy, run: (r) => { setFy(r.id); toast(`กำลังติดตามปีงบประมาณ ${r.year}`); } },
      { id: 'copy', icon: 'content_copy', title: 'คัดลอกหมวด/รายการจากปีอื่นมาใส่ปีนี้', show: () => can('editor'), run: (r) => copyStructure(r) }
    ],
    fields: [
      { key: 'year', label: 'ปีงบประมาณ (พ.ศ.)', type: 'number', required: true, placeholder: 'เช่น 2570' },
      { key: 'status', label: 'สถานะ', type: 'select', noEmpty: true, options: () => Object.keys(FY_STATUS).map((k) => [k, FY_STATUS[k][0]]) },
      { key: 'name', label: 'ชื่อ/คำอธิบาย', full: true },
      { key: 'startDate', label: 'วันเริ่มต้น', type: 'date' },
      { key: 'endDate', label: 'วันสิ้นสุด', type: 'date' },
      { key: 'totalBudget', label: 'วงเงินงบประมาณที่ได้รับ', type: 'money', full: true, help: 'เว้นว่างได้ ระบบจะใช้ยอดรวมของรายการงบประมาณแทน' },
      { key: 'note', label: 'หมายเหตุ', type: 'textarea', full: true }
    ],
    defaults: () => { const y = S.data.fiscalYears.length ? Math.max.apply(null, S.data.fiscalYears.map((f) => num(f.year))) + 1 : currentFY(); return Object.assign({ year: y, name: `ปีงบประมาณ พ.ศ. ${y}`, status: S.data.fiscalYears.length ? 'planning' : 'active', totalBudget: '' }, fyRange(y)); },
    onForm: (form, data, isNew) => {
      if (!isNew) return;
      form.elements.year.addEventListener('input', () => {
        const y = num(form.elements.year.value);
        if (y < 2400 || y > 2800) return;
        const rg = fyRange(y);
        form.elements.startDate.value = rg.startDate; form.elements.endDate.value = rg.endDate;
        form.elements.name.value = `ปีงบประมาณ พ.ศ. ${y}`;
      });
    },
    beforeSave: (rec) => {
      const y = num(rec.year);
      if (y < 2400 || y > 2800) { info('กรุณากรอกปีงบประมาณเป็นปี พ.ศ. เช่น 2570', 'ข้อมูลไม่ถูกต้อง'); return false; }
      if (S.data.fiscalYears.some((f) => num(f.year) === y && f.id !== rec.id)) { info(`มีปีงบประมาณ ${y} อยู่แล้ว`, 'ข้อมูลซ้ำ'); return false; }
      return true;
    },
    afterSave: (saved, isNew) => { if (isNew && !fyObj()) setFy(saved.id, true); },
    describe: (r) => 'ปีงบประมาณ ' + r.year,
    deleteWarn: () => 'หมวด/แผนงาน รายการงบประมาณ และรายการเบิกจ่ายทั้งหมดของปีนี้จะถูกลบด้วย',
    emptyText: 'ยังไม่มีปีงบประมาณ กดปุ่ม "เพิ่มปีงบประมาณ" เพื่อเริ่มต้น'
  };
}
VIEWS.years = () => crud(cfgYears());

async function copyStructure(target) {
  const others = sortedYears().filter((y) => y.id !== target.id);
  if (!others.length) return info('ยังไม่มีปีงบประมาณอื่นให้คัดลอก');
  openModal(`<form id="cpForm" class="flex flex-col">${modalHead('content_copy', `คัดลอกโครงสร้างมาที่ปี ${esc(target.year)}`, 'คัดลอกหมวด/แผนงาน และรายการงบประมาณจากปีอื่น')}
    <div class="p-6 space-y-4">
      <div><label class="block text-[13px] font-semibold text-slate-600 mb-1.5">คัดลอกจากปีงบประมาณ</label><select name="src" class="inp">${others.map((y) => `<option value="${esc(y.id)}">ปีงบประมาณ ${esc(y.year)} (${computeFY(y.id).items.length} รายการ)</option>`).join('')}</select></div>
      <label class="flex items-center gap-2.5"><input type="checkbox" name="budget" checked class="w-5 h-5" style="accent-color:#1D4ED8"><span class="text-sm">คัดลอกจำนวนงบประมาณของแต่ละรายการด้วย</span></label>
      <label class="flex items-center gap-2.5"><input type="checkbox" name="resp" checked class="w-5 h-5" style="accent-color:#1D4ED8"><span class="text-sm">คัดลอกผู้รับผิดชอบด้วย</span></label>
      ${computeFY(target.id).cats.length ? '<div class="text-sm rounded-xl bg-amber-50 text-amber-800 px-4 py-3">ปีนี้มีหมวดอยู่แล้ว ข้อมูลที่คัดลอกจะถูกเพิ่มต่อท้าย</div>' : ''}
    </div>
    <div class="px-6 py-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-2"><button type="button" class="btn btn-ghost" data-close>ยกเลิก</button><button class="btn btn-primary" type="submit"><span class="mi">content_copy</span>คัดลอก</button></div></form>`, 'max-w-lg');
  $('#cpForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target, src = f.elements.src.value, withB = f.elements.budget.checked, withR = f.elements.resp.checked;
    const idMap = {};
    const categories = S.data.categories.filter((c) => c.fiscalYearId === src).map((c) => { const id = uid(); idMap[c.id] = id; return Object.assign(pickFields('categories', c), { id, fiscalYearId: target.id }); });
    const items = S.data.items.filter((i) => i.fiscalYearId === src && idMap[i.categoryId]).map((i) => Object.assign(pickFields('items', i), { id: uid(), fiscalYearId: target.id, categoryId: idMap[i.categoryId], budget: withB ? num(i.budget) : 0, responsibleId: withR ? i.responsibleId : '' }));
    if (!categories.length) return info('ปีที่เลือกยังไม่มีหมวด/แผนงาน');
    try {
      await Busy.run('import', 'หมวดและรายการงบประมาณ', async () => { await api('bulk', { tables: { categories, items } }); await loadAll(); }, `คัดลอก ${categories.length} หมวด ${items.length} รายการเรียบร้อย`);
      closeModal(); rerender();
    } catch (err) { alertErr(err); }
  };
}

/* ---------- 4) หมวด / แผนงาน ---------- */
function cfgCategories() {
  return {
    id: 'categories', table: 'categories', entity: 'หมวด/แผนงาน', icon: 'category', addLabel: 'เพิ่มหมวด',
    rows: () => computeFY(S.fy).cats,
    search: (r) => `${r.code} ${r.name} ${r.plan} ${r.note}`,
    filters: [{ key: 'plan', label: 'ทุกแผนงาน', options: () => plansOf(S.fy).map((p) => [p, p]), test: (r, v) => (r.plan || NO_PLAN) === v }],
    columns: [
      { label: 'รหัส', html: (r) => esc(r.code || '-'), cls: 'whitespace-nowrap text-slate-500' },
      { label: 'แผนงาน', html: (r) => esc(r.plan || '-') },
      { label: 'หมวด', html: (r) => `<div class="flex items-center gap-2 font-semibold text-slate-700"><span class="w-3 h-3 rounded-full shrink-0" style="background:${esc(r.color || '#1D4ED8')}"></span>${esc(r.name)}</div>`, csv: (r) => r.name },
      { label: 'จำนวนรายการ', html: (r) => r.items.length, center: true },
      mcol('งบประมาณ', 'budgetN'),
      mcol('ใช้จ่ายแล้ว', 'used'),
      mcol('คงเหลือ', 'remain', { html: (r) => moneyC(r.remain) }),
      { label: 'ร้อยละ', html: (r) => progCell(r.p), csv: (r) => r.p.toFixed(2) }
    ],
    actions: [{ id: 'items', icon: 'list_alt', title: 'ดูรายการงบประมาณในหมวดนี้', run: (r) => { S.ui.items = { q: '', f: { cat: r.id } }; go('items'); } }],
    fields: [
      { key: 'code', label: 'รหัส/ลำดับ', placeholder: 'เช่น 1.1' },
      { key: 'plan', label: 'แผนงาน', type: 'datalist', options: () => plansOf(S.fy).filter((p) => p !== NO_PLAN), placeholder: 'พิมพ์หรือเลือกแผนงาน' },
      { key: 'name', label: 'ชื่อหมวด', required: true, full: true, placeholder: 'เช่น ค่าวัสดุสำนักงาน' },
      { key: 'color', label: 'สีประจำหมวด (ใช้ในกราฟ)', type: 'color', full: true },
      { key: 'note', label: 'หมายเหตุ', type: 'textarea', full: true }
    ],
    defaults: () => { const n = S.data.categories.filter((c) => c.fiscalYearId === S.fy).length; return { fiscalYearId: S.fy, color: PALETTE[n % PALETTE.length], plan: S.ui.categories && S.ui.categories.f.plan && S.ui.categories.f.plan !== NO_PLAN ? S.ui.categories.f.plan : '' }; },
    formSub: () => `ปีงบประมาณ ${esc(fyObj().year)}`,
    describe: (r) => r.name,
    emptyText: 'ยังไม่มีหมวด/แผนงานในปีงบประมาณนี้'
  };
}
VIEWS.categories = () => { if (!needFY()) crud(cfgCategories()); };

/* ---------- 5) รายการงบประมาณ ---------- */
function cfgItems() {
  return {
    id: 'items', table: 'items', entity: 'รายการงบประมาณ', icon: 'receipt_long', addLabel: 'เพิ่มรายการ', wide: true,
    rows: () => computeFY(S.fy).items,
    search: (r) => `${r.code} ${r.name} ${r.cat ? r.cat.name : ''} ${r.resp ? r.resp.name : ''} ${r.note}`,
    filters: [
      { key: 'cat', label: 'ทุกหมวด', options: () => computeFY(S.fy).cats.map((c) => [c.id, c.name]), test: (r, v) => r.categoryId === v },
      { key: 'resp', label: 'ผู้รับผิดชอบทั้งหมด', options: () => S.data.responsibles.map((p) => [p.id, p.name]), test: (r, v) => r.responsibleId === v }
    ],
    top: () => { const st = computeFY(S.fy); return `<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
      ${kpi('จำนวนรายการ', st.items.length.toLocaleString('th-TH'), `${st.cats.length} หมวด`, 'list_alt', '#1D4ED8')}
      ${kpi('งบประมาณจัดสรร', money(st.allocated), num(st.fy.totalBudget) ? `จากวงเงิน ${money(st.fy.totalBudget)} บาท` : 'บาท', 'account_balance_wallet', '#0288D1')}
      ${kpi('ใช้จ่ายแล้ว', money(st.used), `${st.p.toFixed(1)}% ของงบประมาณ`, 'payments', '#0EA5E9')}
      ${kpi('ใช้งบเกิน ' + warnPct() + '%', st.items.filter((i) => i.budgetN > 0 && i.p >= warnPct()).length + ' รายการ', 'ควรติดตามใกล้ชิด', 'warning', '#F57C00')}</div>`; },
    columns: [
      { label: 'รหัส', html: (r) => esc(r.code || '-'), cls: 'whitespace-nowrap text-slate-500' },
      { label: 'รายการ', html: (r) => `<button class="text-left font-semibold text-slate-700 hover:text-brand-500 hover:underline" data-act="ledger">${esc(r.name)}</button><div class="text-xs text-slate-400 flex items-center gap-1.5"><span class="w-2 h-2 rounded-full" style="background:${esc(r.cat ? r.cat.color : '#999')}"></span>${esc(r.cat ? r.cat.name : '-')}</div>`, csv: (r) => r.name },
      { label: 'หมวด', html: (r) => esc(r.cat ? r.cat.name : '-'), csvOnly: true, csv: (r) => (r.cat ? r.cat.name : '') },
      { label: 'ผู้รับผิดชอบ', html: (r) => esc(r.resp ? r.resp.name : '-'), cls: 'whitespace-nowrap' },
      mcol('งบประมาณ', 'budgetN'),
      mcol('ใช้จ่ายแล้ว', 'used'),
      mcol('คงเหลือ', 'remain', { html: (r) => moneyC(r.remain) }),
      { label: 'ร้อยละ', html: (r) => progCell(r.p), csv: (r) => r.p.toFixed(2) }
    ],
    actions: [
      { id: 'ledger', icon: 'menu_book', title: 'ดูประวัติการเบิกจ่าย', run: (r) => openLedger(r.id) },
      { id: 'pay', icon: 'add_card', title: 'บันทึกการเบิกจ่าย', show: () => can('editor'), run: (r) => openForm(cfgExpenses(), null, { itemId: r.id, fiscalYearId: r.fiscalYearId }) }
    ],
    fields: [
      { key: 'categoryId', label: 'หมวด', type: 'select', required: true, options: () => computeFY(S.fy).cats.map((c) => [c.id, `${c.code ? c.code + ' ' : ''}${c.name}${c.plan ? ' (' + c.plan + ')' : ''}`]) },
      { key: 'code', label: 'รหัสรายการ', placeholder: 'เช่น 1.1.1' },
      { key: 'name', label: 'ชื่อรายการงบประมาณ', required: true, full: true },
      { key: 'budget', label: 'งบประมาณที่จัดสรร', type: 'money', required: true },
      { key: 'responsibleId', label: 'ผู้รับผิดชอบ', type: 'select', placeholder: '— ไม่ระบุ —', options: () => S.data.responsibles.slice().sort((a, b) => a.name.localeCompare(b.name, 'th')).map((p) => [p.id, p.name + (p.position ? ` (${p.position})` : '')]) },
      { key: 'note', label: 'หมายเหตุ', type: 'textarea', full: true }
    ],
    defaults: () => ({ fiscalYearId: S.fy, categoryId: (S.ui.items && S.ui.items.f.cat) || '', budget: '' }),
    formSub: () => `ปีงบประมาณ ${esc(fyObj().year)}`,
    beforeSave: async (rec, old) => {
      if (!computeFY(S.fy).cats.length) { info('กรุณาเพิ่มหมวด/แผนงานก่อนเพิ่มรายการงบประมาณ'); return false; }
      const fy = byId('fiscalYears', rec.fiscalYearId || (old && old.fiscalYearId));
      const tb = num(fy && fy.totalBudget);
      if (!tb) return true;
      const total = sum(S.data.items.filter((i) => i.fiscalYearId === fy.id && i.id !== rec.id), 'budget') + num(rec.budget);
      if (total > tb) return confirmBox('ยอดจัดสรรเกินวงเงิน', `ยอดจัดสรรรวมจะเป็น <b>${money(total)}</b> บาท<br>เกินวงเงินปีงบประมาณ ${esc(fy.year)} (<b>${money(tb)}</b> บาท)<br>ต้องการบันทึกต่อหรือไม่?`);
      return true;
    },
    describe: (r) => r.name,
    emptyText: 'ยังไม่มีรายการงบประมาณ'
  };
}
VIEWS.items = () => { if (!needFY()) crud(cfgItems()); };

function openLedger(itemId) {
  const base = byId('items', itemId);
  if (!base) return;
  const it = computeFY(base.fiscalYearId).items.find((i) => i.id === itemId) || Object.assign({}, base, { budgetN: num(base.budget), used: 0, remain: num(base.budget), p: 0 });
  const exps = S.data.expenses.filter((e) => e.itemId === itemId).sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.createdAt).localeCompare(String(b.createdAt)));
  let bal = it.budgetN;
  const rows = exps.map((e, i) => {
    const off = e.status === 'ยกเลิก';
    if (!off) bal -= num(e.amount);
    return `<tr class="${off ? 'opacity-50' : ''}"><td class="px-3 py-2 text-center text-slate-400">${i + 1}</td><td class="px-3 py-2 whitespace-nowrap">${thDate(e.date)}</td><td class="px-3 py-2 whitespace-nowrap">${esc(e.docNo || '-')}</td><td class="px-3 py-2">${esc(e.description)}${e.attachment ? ` <a href="${esc(e.attachment)}" target="_blank" rel="noopener" class="text-brand-500" title="ไฟล์แนบ"><span class="mi text-[18px]">attach_file</span></a>` : ''}<div class="text-xs text-slate-400">${esc(e.payee || '')}</div></td><td class="px-3 py-2">${expBadge(e.status)}</td><td class="px-3 py-2 text-right whitespace-nowrap ${off ? 'line-through' : 'font-semibold'}">${money(e.amount)}</td><td class="px-3 py-2 text-right whitespace-nowrap">${moneyC(bal)}</td></tr>`;
  }).join('');
  const box = (l, v, c) => `<div class="rounded-xl p-3" style="background:${c}14"><div class="text-xs text-slate-500">${l}</div><div class="font-bold text-lg" style="color:${c}">${v}</div></div>`;
  openModal(`${modalHead('menu_book', esc(it.name), `${esc(it.cat ? it.cat.name : '')} · ผู้รับผิดชอบ: ${esc(it.resp ? it.resp.name : '-')}`)}
    <div class="p-5 md:p-6 overflow-auto">
      <div class="grid grid-cols-3 gap-3">${box('งบประมาณ', money(it.budgetN), '#1D4ED8')}${box('ใช้จ่ายแล้ว', money(it.used), '#0EA5E9')}${box('คงเหลือ', money(it.remain), it.remain < 0 ? '#D32F2F' : '#0EA5E9')}</div>
      <div class="flex items-center gap-2 mt-3"><div class="flex-1">${prog(it.p)}</div><span class="text-sm font-bold text-slate-600">${it.p.toFixed(1)}%</span></div>
      <div class="mt-4 overflow-x-auto rounded-xl border border-slate-100"><table class="tbl w-full"><thead><tr><th class="px-3 py-2.5">#</th><th class="px-3 py-2.5 text-left">วันที่</th><th class="px-3 py-2.5 text-left">เลขที่เอกสาร</th><th class="px-3 py-2.5 text-left">รายละเอียด</th><th class="px-3 py-2.5 text-left">สถานะ</th><th class="px-3 py-2.5 text-right">จำนวนเงิน</th><th class="px-3 py-2.5 text-right">คงเหลือ</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7" class="py-10 text-center text-slate-400">ยังไม่มีการเบิกจ่ายในรายการนี้</td></tr>'}</tbody></table></div>
    </div>
    <div class="px-5 md:px-6 py-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-2 shrink-0">${can('editor') ? '<button class="btn btn-primary" id="ledgerAdd"><span class="mi">add_card</span>บันทึกการเบิกจ่าย</button>' : ''}<button class="btn btn-ghost" data-close>ปิด</button></div>`, 'max-w-4xl');
  if ($('#ledgerAdd')) $('#ledgerAdd').onclick = () => openForm(cfgExpenses(), null, { itemId, fiscalYearId: base.fiscalYearId });
}

/* ---------- 6) รายการเบิกจ่าย ---------- */
function itemOptions(fyId) {
  return computeFY(fyId).cats.filter((c) => c.items.length).map((c) => ({ group: `${c.code ? c.code + ' ' : ''}${c.name}`, items: c.items.map((i) => [i.id, `${i.code ? i.code + ' ' : ''}${i.name} — คงเหลือ ${money(i.remain)}`]) }));
}
function cfgExpenses() {
  return {
    id: 'expenses', table: 'expenses', entity: 'รายการเบิกจ่าย', icon: 'payments', addLabel: 'บันทึกการเบิกจ่าย', wide: true,
    rows: () => {
      const im = {}; S.data.items.forEach((i) => { im[i.id] = i; });
      const cm = {}; S.data.categories.forEach((c) => { cm[c.id] = c; });
      return S.data.expenses.filter((e) => e.fiscalYearId === S.fy).map((e) => { const it = im[e.itemId]; return Object.assign({}, e, { item: it, cat: it ? cm[it.categoryId] : null }); })
        .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt)));
    },
    search: (r) => `${r.docNo} ${r.description} ${r.payee} ${r.note} ${r.item ? r.item.name : ''} ${r.cat ? r.cat.name : ''}`,
    searchPh: 'ค้นหาเลขที่เอกสาร รายละเอียด ผู้รับเงิน...',
    filters: [
      { key: 'cat', label: 'ทุกหมวด', options: () => computeFY(S.fy).cats.map((c) => [c.id, c.name]), test: (r, v) => r.cat && r.cat.id === v },
      { key: 'item', label: 'ทุกรายการ', options: () => computeFY(S.fy).items.map((i) => [i.id, i.name]), test: (r, v) => r.itemId === v },
      { key: 'month', label: 'ทุกเดือน', options: () => FY_MON_FULL.map((m, i) => [String(i), m]), test: (r, v) => String(fiscalMonthIndex(r.date)) === v },
      { key: 'status', label: 'ทุกสถานะ', options: () => Object.keys(EXP_STATUS).map((s) => [s, s]), test: (r, v) => r.status === v }
    ],
    summary: (rows) => {
      const act = rows.filter((r) => r.status !== 'ยกเลิก');
      const paid = sum(act.filter((r) => r.status !== 'รอเบิกจ่าย'), 'amount'), pend = sum(act.filter((r) => r.status === 'รอเบิกจ่าย'), 'amount');
      const chip = (l, v, c) => `<div class="flex items-center gap-2 rounded-xl px-3 py-2" style="background:${c}14"><span class="w-2 h-2 rounded-full" style="background:${c}"></span><span class="text-xs text-slate-500">${l}</span><span class="font-bold text-sm" style="color:${c}">${v}</span></div>`;
      return `<div class="px-4 py-3 flex flex-wrap gap-2 border-b border-slate-100">${chip('จำนวน', rows.length + ' รายการ', '#1D4ED8')}${chip('ยอดรวม', money(paid + pend) + ' บาท', '#0288D1')}${chip('เบิกจ่ายแล้ว', money(paid), '#0EA5E9')}${chip('รอเบิกจ่าย', money(pend), '#F57C00')}</div>`;
    },
    columns: [
      { label: 'วันที่', html: (r) => `<span class="whitespace-nowrap">${thDate(r.date)}</span>`, csv: (r) => r.date },
      { label: 'เลขที่เอกสาร', html: (r) => esc(r.docNo || '-'), cls: 'whitespace-nowrap' },
      { label: 'รายละเอียด', html: (r) => `<div class="font-semibold text-slate-700">${esc(r.description)}${r.attachment ? ` <a href="${esc(r.attachment)}" target="_blank" rel="noopener" class="text-brand-500" title="ไฟล์แนบ"><span class="mi text-[18px]">attach_file</span></a>` : ''}</div><div class="text-xs text-slate-400">${esc(r.item ? r.item.name : 'ไม่พบรายการ')}</div>`, csv: (r) => r.description },
      { label: 'รายการงบประมาณ', html: (r) => esc(r.item ? r.item.name : ''), csvOnly: true },
      { label: 'ผู้รับเงิน', html: (r) => esc(r.payee || '-') },
      mcol('จำนวนเงิน', 'amount', { sum: (r) => (r.status === 'ยกเลิก' ? 0 : num(r.amount)), html: (r) => `<span class="${r.status === 'ยกเลิก' ? 'line-through text-slate-400' : 'font-semibold'}">${money(r.amount)}</span>` }),
      { label: 'สถานะ', html: (r) => expBadge(r.status), csv: (r) => r.status, center: true }
    ],
    fields: (data) => [
      { key: 'itemId', label: 'รายการงบประมาณ', type: 'select', required: true, full: true, options: () => itemOptions(data.fiscalYearId || S.fy) },
      { key: '_info', type: 'html' },
      { key: 'date', label: 'วันที่เบิกจ่าย', type: 'date', required: true },
      { key: 'docNo', label: 'เลขที่เอกสาร/ฎีกา', placeholder: 'เช่น บจ.001/2570' },
      { key: 'description', label: 'รายละเอียดการเบิกจ่าย', required: true, full: true },
      { key: 'amount', label: 'จำนวนเงิน', type: 'money', required: true },
      { key: 'status', label: 'สถานะ', type: 'select', noEmpty: true, options: () => Object.keys(EXP_STATUS).map((s) => [s, s]) },
      { key: 'payee', label: 'ผู้รับเงิน/ร้านค้า', full: true },
      { key: 'attachment', label: 'ไฟล์แนบ (ใบเสร็จ/เอกสาร)', type: 'file', full: true },
      { key: 'note', label: 'หมายเหตุ', type: 'textarea', full: true }
    ],
    defaults: () => {
      const fy = fyObj(); let d = today();
      if (fy && fy.startDate && d < fy.startDate) d = fy.startDate;
      if (fy && fy.endDate && d > fy.endDate) d = fy.endDate;
      return { fiscalYearId: S.fy, date: d, status: 'เบิกจ่ายแล้ว', itemId: (S.ui.expenses && S.ui.expenses.f.item) || '', amount: '' };
    },
    formSub: (d) => `ปีงบประมาณ ${esc((byId('fiscalYears', d.fiscalYearId || S.fy) || {}).year || '')}`,
    onForm: (form, data) => {
      const sel = form.elements.itemId, box = $('#f__info');
      const upd = () => {
        const it = computeFY(data.fiscalYearId || S.fy).items.find((i) => i.id === sel.value);
        if (!it) { box.innerHTML = ''; return; }
        const own = data.id && data.itemId === it.id && data.status !== 'ยกเลิก' ? num(data.amount) : 0;
        const rem = it.remain + own;
        box.innerHTML = `<div class="rounded-xl bg-brand-50 px-4 py-3 text-sm flex flex-wrap gap-x-6 gap-y-1"><span>งบประมาณ <b>${money(it.budgetN)}</b></span><span>ใช้ไปแล้ว <b>${money(it.used - own)}</b></span><span>คงเหลือ <b class="${rem < 0 ? 'text-rose-600' : 'text-brand-600'}">${money(rem)}</b> บาท</span></div>`;
      };
      sel.addEventListener('change', upd); upd();
    },
    beforeSave: async (rec, old) => {
      if (!(num(rec.amount) > 0)) { info('จำนวนเงินต้องมากกว่า 0', 'ข้อมูลไม่ถูกต้อง'); return false; }
      const fy = byId('fiscalYears', rec.fiscalYearId || (old && old.fiscalYearId));
      if (fy && rec.date && fy.startDate && fy.endDate && (rec.date < fy.startDate || rec.date > fy.endDate)) {
        if (!(await confirmBox('วันที่อยู่นอกช่วงปีงบประมาณ', `ปีงบประมาณ ${esc(fy.year)} คือ ${thDate(fy.startDate)} – ${thDate(fy.endDate)}<br>ต้องการบันทึกต่อหรือไม่?`))) return false;
      }
      if (rec.status !== 'ยกเลิก') {
        const it = byId('items', rec.itemId);
        const used = sum(S.data.expenses.filter((e) => e.itemId === rec.itemId && e.id !== rec.id && e.status !== 'ยกเลิก'), 'amount');
        const rem = num(it && it.budget) - used;
        if (num(rec.amount) > rem) return confirmBox('ยอดเบิกเกินงบคงเหลือ', `รายการ <b>${esc(it ? it.name : '')}</b> คงเหลือ <b>${money(rem)}</b> บาท<br>ยอดที่บันทึก ${money(rec.amount)} บาท (เกิน <b class="text-rose-600">${money(num(rec.amount) - rem)}</b> บาท)<br>ต้องการบันทึกต่อหรือไม่?`);
      }
      return true;
    },
    describe: (r) => `${r.docNo ? r.docNo + ' ' : ''}${r.description} (${money(r.amount)} บาท)`,
    emptyText: 'ยังไม่มีรายการเบิกจ่ายในปีงบประมาณนี้'
  };
}
VIEWS.expenses = () => { if (!needFY()) crud(cfgExpenses()); };

/* ---------- 7) ผู้รับผิดชอบ ---------- */
function cfgResponsibles() {
  return {
    id: 'responsibles', table: 'responsibles', entity: 'ผู้รับผิดชอบ', icon: 'groups', addLabel: 'เพิ่มผู้รับผิดชอบ',
    rows: () => { const its = S.fy ? computeFY(S.fy).items : []; return S.data.responsibles.map((p) => { const mine = its.filter((i) => i.responsibleId === p.id); const b = sum(mine, 'budgetN'), u = sum(mine, 'used'); return Object.assign({}, p, { nItems: mine.length, budgetN: b, used: u, p: pct(u, b) }); }).sort((a, b) => a.name.localeCompare(b.name, 'th')); },
    search: (r) => `${r.name} ${r.position} ${r.department} ${r.phone} ${r.email}`,
    columns: [
      { label: 'ชื่อ-สกุล', html: (r) => `<div class="flex items-center gap-3"><div class="w-9 h-9 rounded-full bg-brand-50 text-brand-600 grid place-items-center font-bold shrink-0">${esc(r.name.replace(/^(นางสาว|นาง|นาย|ดร\.|ว่าที่ร้อยตรี)\s*/, '').charAt(0))}</div><div><div class="font-semibold text-slate-700">${esc(r.name)}</div><div class="text-xs text-slate-400">${esc(r.position || '')}</div></div></div>`, csv: (r) => r.name },
      { label: 'ตำแหน่ง', html: (r) => esc(r.position || ''), csvOnly: true },
      { label: 'กลุ่มงาน/ฝ่าย', html: (r) => esc(r.department || '-') },
      { label: 'ติดต่อ', html: (r) => `${r.phone ? `<div class="whitespace-nowrap"><span class="mi text-[16px] text-slate-400">call</span> ${esc(r.phone)}</div>` : ''}${r.email ? `<div class="text-xs text-slate-500">${esc(r.email)}</div>` : ''}` || '-', csv: (r) => [r.phone, r.email].filter(Boolean).join(' ') },
      { label: 'รายการที่รับผิดชอบ', html: (r) => r.nItems, center: true },
      mcol('งบประมาณ', 'budgetN'),
      mcol('ใช้จ่ายแล้ว', 'used'),
      { label: 'ร้อยละ', html: (r) => progCell(r.p), csv: (r) => r.p.toFixed(2) }
    ],
    actions: [{ id: 'items', icon: 'list_alt', title: 'ดูรายการที่รับผิดชอบ', run: (r) => { S.ui.items = { q: '', f: { resp: r.id } }; go('items'); } }],
    fields: [
      { key: 'name', label: 'ชื่อ-สกุล', required: true, full: true },
      { key: 'position', label: 'ตำแหน่ง' },
      { key: 'department', label: 'กลุ่มงาน/ฝ่าย' },
      { key: 'phone', label: 'เบอร์โทรศัพท์' },
      { key: 'email', label: 'อีเมล', type: 'email' },
      { key: 'note', label: 'หมายเหตุ', type: 'textarea', full: true }
    ],
    describe: (r) => r.name,
    emptyText: 'ยังไม่มีข้อมูลผู้รับผิดชอบ'
  };
}
VIEWS.responsibles = () => crud(cfgResponsibles());

/* ---------- 8) รายงานสรุป ---------- */
VIEWS.report = () => {
  if (needFY()) return;
  const ui = S.ui.report || (S.ui.report = { fy: S.fy, plan: '', resp: '', asOf: '' });
  if (!byId('fiscalYears', ui.fy)) ui.fy = S.fy;
  const st = computeFY(ui.fy, ui), fy = st.fy, set = S.settings, y = num(fy.year);
  const plans = {};
  st.cats.forEach((c) => { const p = c.plan || NO_PLAN; (plans[p] = plans[p] || []).push(c); });
  const td = (v) => `<td class="num">${money(v)}</td>`;
  let n = 0;
  const body = Object.keys(plans).map((p) => {
    const cs = plans[p], b = sum(cs, 'budgetN'), u = sum(cs, 'used'), pe = sum(cs, 'pending');
    return `<tr class="r-plan"><td colspan="3">${esc(p)}</td>${td(b)}${td(u - pe)}${td(pe)}${td(b - u)}<td class="num">${pct(u, b).toFixed(2)}</td></tr>` +
      cs.map((c) => `<tr class="r-cat"><td></td><td colspan="2"><span class="dot" style="background:${esc(c.color || '#1D4ED8')}"></span>${esc([c.code, c.name].filter(Boolean).join(' '))}</td>${td(c.budgetN)}${td(c.used - c.pending)}${td(c.pending)}<td class="num ${c.remain < 0 ? 'neg' : ''}">${money(c.remain)}</td><td class="num">${c.p.toFixed(2)}</td></tr>` +
        c.items.map((i) => `<tr><td class="text-center">${++n}</td><td style="padding-left:24px">${esc([i.code, i.name].filter(Boolean).join(' '))}</td><td>${esc(i.resp ? i.resp.name : '-')}</td>${td(i.budgetN)}${td(i.used - i.pending)}${td(i.pending)}<td class="num ${i.remain < 0 ? 'neg' : ''}">${money(i.remain)}</td><td class="num">${i.p.toFixed(2)}</td></tr>`).join('')).join('');
  }).join('');
  let cum = 0;
  const months = st.monthly.map((v, i) => { cum += v; return `<tr><td>${FY_MON_FULL[i]} ${i < 3 ? y - 1 : y}</td>${td(v)}${td(cum)}<td class="num">${pct(cum, st.allocated).toFixed(2)}</td></tr>`; }).join('');
  const rm = {};
  st.items.forEach((i) => { const k = i.responsibleId || '-'; const o = rm[k] || (rm[k] = { name: i.resp ? i.resp.name : 'ไม่ระบุผู้รับผิดชอบ', n: 0, b: 0, u: 0 }); o.n++; o.b += i.budgetN; o.u += i.used; });
  const resps = Object.values(rm).sort((a, b) => b.b - a.b);
  const filt = [ui.plan && `แผนงาน: ${ui.plan}`, ui.resp && `ผู้รับผิดชอบ: ${(byId('responsibles', ui.resp) || {}).name || ''}`].filter(Boolean).join(' · ');
  const opt = (v, l, sel) => `<option value="${esc(v)}" ${String(v) === String(sel) ? 'selected' : ''}>${esc(l)}</option>`;
  $('#view').innerHTML = `
  <div class="panel mb-4 no-print animate-slide-up"><div class="flex flex-wrap items-end gap-3">
    <div><div class="text-xs font-semibold text-slate-500 mb-1">ปีงบประมาณ</div><select id="rFy" class="inp" style="width:auto">${sortedYears().map((f) => opt(f.id, 'ปีงบประมาณ ' + f.year, ui.fy)).join('')}</select></div>
    <div><div class="text-xs font-semibold text-slate-500 mb-1">แผนงาน</div><select id="rPlan" class="inp" style="width:auto">${opt('', 'ทุกแผนงาน', ui.plan)}${plansOf(ui.fy).map((p) => opt(p, p, ui.plan)).join('')}</select></div>
    <div><div class="text-xs font-semibold text-slate-500 mb-1">ผู้รับผิดชอบ</div><select id="rResp" class="inp" style="width:auto">${opt('', 'ทุกคน', ui.resp)}${S.data.responsibles.map((p) => opt(p.id, p.name, ui.resp)).join('')}</select></div>
    <div><div class="text-xs font-semibold text-slate-500 mb-1">ข้อมูล ณ วันที่</div><input id="rAsOf" type="date" class="inp" style="width:auto" value="${esc(ui.asOf)}"></div>
    <div class="ml-auto flex gap-2"><button class="btn btn-soft" id="rCsv"><span class="mi">download</span>CSV</button><button class="btn btn-primary" id="rPrint"><span class="mi">print</span>พิมพ์ / บันทึก PDF</button></div>
  </div></div>
  <div class="print-doc bg-white rounded-2xl shadow-soft p-6 md:p-10 animate-slide-up" id="reportDoc">
    <div class="flex items-center gap-4 border-b-2 border-brand-500 pb-4">
      <div class="w-16 h-16 rounded-xl border border-slate-200 grid place-items-center overflow-hidden shrink-0">${logoHtml()}</div>
      <div class="flex-1 min-w-0"><div class="text-xl font-bold text-brand-700">รายงานสรุปการใช้จ่ายงบประมาณค่าใช้สอย</div>
        <div class="text-slate-600 font-semibold">ปีงบประมาณ พ.ศ. ${esc(fy.year)}${set.orgName ? ' · ' + esc(set.orgName) : ''}</div>
        <div class="text-xs text-slate-500">${set.orgSub ? esc(set.orgSub) + ' · ' : ''}${filt ? esc(filt) + ' · ' : ''}ข้อมูล ณ วันที่ ${thDate(ui.asOf || today(), true)}</div></div>
    </div>
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 my-5">
      ${[['งบประมาณ', st.total, '#1D4ED8'], ['เบิกจ่ายแล้ว', st.paid, '#0EA5E9'], ['รอเบิกจ่าย', st.pending, '#F57C00'], ['คงเหลือ', st.remain, st.remain < 0 ? '#D32F2F' : '#0288D1']].map(([l, v, c]) => `<div class="rounded-xl border p-3" style="border-color:${c}40;background:${c}0d"><div class="text-xs text-slate-500">${l}</div><div class="font-bold text-lg" style="color:${c}">${money(v)}</div><div class="text-[11px] text-slate-400">บาท</div></div>`).join('')}
    </div>
    <div class="text-sm text-slate-600 mb-2">อัตราการใช้จ่ายรวม <b class="text-brand-600">${st.p.toFixed(2)}%</b> · จัดสรรลงรายการ ${money(st.allocated)} บาท จาก ${st.items.length} รายการ ใน ${st.cats.length} หมวด</div>
    <div class="font-bold text-brand-700 mt-5 mb-2">1. สรุปตามแผนงาน / หมวด / รายการ</div>
    <div class="overflow-x-auto"><table class="rpt"><thead><tr><th style="width:40px">ที่</th><th>รายการ</th><th>ผู้รับผิดชอบ</th><th>งบประมาณ</th><th>เบิกจ่ายแล้ว</th><th>รอเบิกจ่าย</th><th>คงเหลือ</th><th>ร้อยละ</th></tr></thead>
    <tbody>${body || '<tr><td colspan="8" class="text-center" style="padding:24px;color:#94a3b8">ไม่มีข้อมูล</td></tr>'}
    <tr class="r-total"><td colspan="3" class="text-center">รวมทั้งสิ้น</td>${td(st.allocated)}${td(st.paid)}${td(st.pending)}${td(st.allocated - st.used)}<td class="num">${pct(st.used, st.allocated).toFixed(2)}</td></tr></tbody></table></div>
    <div class="grid md:grid-cols-2 gap-6 mt-6">
      <div><div class="font-bold text-brand-700 mb-2">2. การใช้จ่ายรายเดือน</div><table class="rpt"><thead><tr><th>เดือน</th><th>ใช้จ่าย</th><th>สะสม</th><th>ร้อยละสะสม</th></tr></thead><tbody>${months}</tbody></table></div>
      <div><div class="font-bold text-brand-700 mb-2">3. สรุปตามผู้รับผิดชอบ</div><table class="rpt"><thead><tr><th>ผู้รับผิดชอบ</th><th>รายการ</th><th>งบประมาณ</th><th>ใช้จ่าย</th><th>ร้อยละ</th></tr></thead><tbody>${resps.map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${r.n}</td>${td(r.b)}${td(r.u)}<td class="num">${pct(r.u, r.b).toFixed(2)}</td></tr>`).join('') || '<tr><td colspan="5" class="text-center">-</td></tr>'}</tbody></table></div>
    </div>
    ${set.footerNote ? `<div class="mt-6 text-sm text-slate-600">${esc(set.footerNote)}</div>` : ''}
    <div class="mt-12 flex justify-end"><div class="text-center text-sm text-slate-700" style="min-width:280px">
      <div>ลงชื่อ ....................................................... ผู้รายงาน</div>
      <div class="mt-2">( ${esc(set.reporterName || '.......................................................')} )</div>
      <div class="mt-1">${esc(set.reporterPosition || '')}</div>
      <div class="mt-1">วันที่ ${thDate(today(), true)}</div></div></div>
  </div>`;
  const re = () => VIEWS.report();
  $('#rFy').onchange = (e) => { ui.fy = e.target.value; ui.plan = ''; re(); };
  $('#rPlan').onchange = (e) => { ui.plan = e.target.value; re(); };
  $('#rResp').onchange = (e) => { ui.resp = e.target.value; re(); };
  $('#rAsOf').onchange = (e) => { ui.asOf = e.target.value; re(); };
  $('#rPrint').onclick = () => window.print();
  $('#rCsv').onclick = () => exportCsv(`รายงานสรุป_ปีงบ${fy.year}`, ['แผนงาน', 'หมวด', 'รหัส', 'รายการ', 'ผู้รับผิดชอบ', 'งบประมาณ', 'เบิกจ่ายแล้ว', 'รอเบิกจ่าย', 'คงเหลือ', 'ร้อยละ'],
    st.items.map((i) => [i.cat ? i.cat.plan || NO_PLAN : '', i.cat ? i.cat.name : '', i.code, i.name, i.resp ? i.resp.name : '', i.budgetN, i.used - i.pending, i.pending, i.remain, i.p.toFixed(2)]));
};

/* ---------- 9) ผู้ใช้งานระบบ ---------- */
function cfgUsers() {
  return {
    id: 'users', table: 'users', entity: 'ผู้ใช้งาน', icon: 'manage_accounts', addLabel: 'เพิ่มผู้ใช้งาน',
    canAdd: () => can('admin'), canEdit: () => can('admin'), canDelete: (r) => can('admin') && r.id !== S.user.id,
    rows: () => S.data.users.slice().sort((a, b) => (ROLE_RANK[b.role] || 0) - (ROLE_RANK[a.role] || 0) || String(a.username).localeCompare(String(b.username))),
    search: (r) => `${r.username} ${r.displayName} ${r.role}`,
    filters: [{ key: 'role', label: 'ทุกสิทธิ์', options: () => ROLES.map((x) => [x[0], ROLE_SHORT[x[0]][0]]), test: (r, v) => r.role === v }],
    columns: [
      { label: 'ผู้ใช้งาน', html: (r) => `<div class="flex items-center gap-3"><div class="w-9 h-9 rounded-full grid place-items-center font-bold text-blue-900 shrink-0" style="background:#DBEAFE">${esc(String(r.displayName || r.username).charAt(0))}</div><div><div class="font-semibold text-slate-700">${esc(r.displayName)}${r.id === S.user.id ? ' <span class="text-xs text-brand-500">(คุณ)</span>' : ''}</div><div class="text-xs text-slate-400">@${esc(r.username)}</div></div></div>`, csv: (r) => r.displayName },
      { label: 'ชื่อผู้ใช้', html: (r) => esc(r.username), csvOnly: true },
      { label: 'สิทธิ์', html: (r) => roleBadge(r.role), csv: (r) => (ROLE_SHORT[r.role] || [r.role])[0] },
      { label: 'ผู้รับผิดชอบที่เชื่อมโยง', html: (r) => esc((byId('responsibles', r.responsibleId) || {}).name || '-') },
      { label: 'สถานะ', html: (r) => (isTrue(r.active) ? badge('ใช้งาน', '#16A34A') : badge('ระงับ', '#EF5350')), csv: (r) => (isTrue(r.active) ? 'ใช้งาน' : 'ระงับ'), center: true },
      { label: 'เข้าใช้ล่าสุด', html: (r) => (r.lastLogin ? `<span class="whitespace-nowrap text-sm">${thDateTime(r.lastLogin)}</span>` : '<span class="text-slate-400">-</span>'), csv: (r) => r.lastLogin }
    ],
    fields: (d, isNew) => [
      { key: 'username', label: 'ชื่อผู้ใช้ (ภาษาอังกฤษ)', required: true, placeholder: 'เช่น somsri' },
      { key: 'displayName', label: 'ชื่อที่แสดง', required: true },
      { key: 'role', label: 'สิทธิ์การใช้งาน', type: 'select', noEmpty: true, required: true, options: () => ROLES, full: true },
      { key: 'responsibleId', label: 'เชื่อมโยงกับผู้รับผิดชอบ', type: 'select', placeholder: '— ไม่ระบุ —', options: () => S.data.responsibles.map((p) => [p.id, p.name]) },
      { key: 'password', label: isNew ? 'รหัสผ่าน' : 'รหัสผ่านใหม่', type: 'password', required: (n) => n, placeholder: isNew ? 'อย่างน้อย 6 ตัวอักษร' : 'เว้นว่างถ้าไม่ต้องการเปลี่ยน' },
      { key: 'active', label: 'เปิดใช้งานบัญชีนี้', type: 'checkbox', full: true }
    ],
    defaults: () => ({ role: 'editor', active: 'TRUE' }),
    beforeSave: (rec) => {
      if (!/^[a-zA-Z0-9._-]{3,30}$/.test(rec.username)) { info('ชื่อผู้ใช้ต้องเป็นอักษรภาษาอังกฤษ ตัวเลข หรือ . _ - ความยาว 3–30 ตัว', 'ข้อมูลไม่ถูกต้อง'); return false; }
      if (rec.password && rec.password.length < 6) { info('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร', 'ข้อมูลไม่ถูกต้อง'); return false; }
      return true;
    },
    saveFn: async (rec) => {
      const password = rec.password;
      const record = Object.assign({}, rec); delete record.password;
      const saved = await api('saveUser', { record, password });
      if (saved.id === S.user.id) Object.assign(S.user, saved);
      return saved;
    },
    describe: (r) => `${r.displayName} (${r.username})`
  };
}
VIEWS.users = () => crud(cfgUsers());

/* ---------- 10) ตั้งค่าระบบ ---------- */
VIEWS.settings = () => {
  const s = S.settings;
  const F = [
    { key: 'systemName', label: 'ชื่อระบบ', full: true },
    { key: 'orgName', label: 'ชื่อหน่วยงาน / โรงเรียน' },
    { key: 'orgSub', label: 'สังกัด' },
    { key: 'logoUrl', label: 'โลโก้หน่วยงาน', type: 'file', accept: 'image/*', full: true, help: 'อัปโหลดรูป PNG/JPG (แนะนำพื้นหลังโปร่งใส) หรือวางลิงก์รูปภาพ' },
    { key: 'reporterName', label: 'ชื่อผู้รายงาน (แสดงท้ายรายงานและส่วนท้ายเว็บ)' },
    { key: 'reporterPosition', label: 'ตำแหน่งผู้รายงาน' },
    { key: 'warnPercent', label: 'แจ้งเตือนเมื่อใช้งบเกิน (%)', type: 'number' },
    { key: 'footerNote', label: 'ข้อความท้ายรายงาน', type: 'textarea', full: true }
  ];
  const tool = (id, icon, title, text, cls) => `<button id="${id}" class="w-full text-left flex items-start gap-3 rounded-xl border border-slate-100 p-3 hover:bg-slate-50 ${cls || ''}"><span class="mi mt-0.5">${icon}</span><span><span class="block font-semibold text-sm">${title}</span><span class="block text-xs text-slate-500">${text}</span></span></button>`;
  $('#view').innerHTML = `<div class="grid xl:grid-cols-3 gap-4">
    <form id="setForm" class="panel xl:col-span-2 animate-slide-up" novalidate>
      <div class="panel-title"><span class="mi">apartment</span>ข้อมูลหน่วยงานและการแสดงผล</div>
      <div class="grid sm:grid-cols-2 gap-4">${F.map((f) => fieldHtml(f, s[f.key])).join('')}</div>
      <div class="flex items-center gap-3 mt-6 pt-4 border-t border-slate-100">
        <div id="logoPreview" class="w-14 h-14 rounded-xl border border-slate-200 grid place-items-center overflow-hidden bg-white">${logoHtml()}</div>
        <div class="text-xs text-slate-500">ตัวอย่างโลโก้</div>
        <button class="btn btn-primary ml-auto" type="submit"><span class="mi">save</span>บันทึกการตั้งค่า</button>
      </div>
    </form>
    <div class="space-y-4">
      <div class="panel animate-slide-up"><div class="panel-title"><span class="mi">database</span>การเชื่อมต่อฐานข้อมูล</div>
        <div class="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-900"><b class="flex items-center gap-1.5"><span class="mi text-[18px]">check_circle</span>เชื่อมต่อฐานข้อมูลแล้ว</b><div class="text-xs break-all mt-1 opacity-80">${esc(API_URL)}</div>
          <div class="text-xs mt-1 opacity-80">${CONFIG_URL ? 'กำหนดไว้ในไฟล์ config.js' : 'บันทึกไว้ในเบราว์เซอร์นี้ (ใส่ใน config.js เพื่อให้ทุกเครื่องใช้ได้ทันที)'}</div></div>
        <div class="flex gap-2 mt-3"><button id="tPing" class="btn btn-soft flex-1"><span class="mi">wifi_tethering</span>ทดสอบ</button>${CONFIG_URL ? '' : '<button id="tConn" class="btn btn-soft flex-1"><span class="mi">link</span>เปลี่ยน URL</button>'}</div>
      </div>
      <div class="panel animate-slide-up"><div class="panel-title"><span class="mi">build</span>เครื่องมือจัดการข้อมูล</div><div class="space-y-2">
        ${tool('tBackup', 'cloud_download', 'สำรองข้อมูล (JSON)', 'ดาวน์โหลดข้อมูลทั้งหมดเก็บไว้')}
        <label class="block">${tool('tRestoreBtn', 'cloud_upload', 'นำเข้าข้อมูลสำรอง', 'แทนที่ข้อมูลปัจจุบันด้วยไฟล์สำรอง (JSON)', 'pointer-events-none')}<input id="tRestore" type="file" accept="application/json,.json" class="hidden"></label>
        ${tool('tReset', 'delete_forever', 'ล้างข้อมูลทั้งหมด', 'ลบปีงบประมาณ หมวด รายการ การเบิกจ่าย และผู้รับผิดชอบ', 'text-rose-600')}
      </div></div>
    </div></div>`;
  const form = $('#setForm');
  form.elements.logoUrl.addEventListener('input', () => { const u = form.elements.logoUrl.value.trim(); $('#logoPreview').innerHTML = u ? `<img src="${esc(u)}" class="w-full h-full object-contain p-1">` : '<span class="mi fill text-brand-500" style="font-size:28px">account_balance</span>'; });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const vals = collect(form, F);
    vals.warnPercent = String(Math.min(100, Math.max(1, num(vals.warnPercent) || 80)));
    try { S.settings = await api('saveSettings', { settings: vals }); applyBranding(); renderSidebar(); } catch (err) { alertErr(err); }
  };
  $('#tPing').onclick = async () => { const t0 = Date.now(); try { await api('ping', {}, { done: 'เชื่อมต่อฐานข้อมูลได้ปกติ' }); toast(`ตอบสนองภายใน ${Date.now() - t0} ms`, 'info'); } catch (err) { alertErr(err); } };
  $('#tBackup').onclick = () => { const d = {}; DATA_TABLES.forEach((t) => { d[t] = S.data[t]; }); download(`budget-backup_${today()}.json`, JSON.stringify({ app: 'budget-tracker', exportedAt: nowStr(), settings: S.settings, data: d }, null, 2), 'application/json'); toast('ดาวน์โหลดไฟล์สำรองแล้ว'); };
  $('#tRestore').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) restoreBackup(f); };
  $('#tReset').onclick = resetData;
  if ($('#tConn')) $('#tConn').onclick = async () => {
    if (!(await confirmBox('เปลี่ยนการเชื่อมต่อฐานข้อมูล?', 'ระบบจะออกจากระบบ แล้วให้วาง URL ของ Google Apps Script ใหม่', { icon: 'question', ok: 'ดำเนินการต่อ' }))) return;
    try { await api('logout'); } catch (e) { /* ignore */ }
    store.del('bt_api_url'); store.del('bt_session'); API_URL = ''; S.user = null; S.token = null;
    showSetup();
  };
};
async function restoreBackup(file) {
  let j;
  try { j = JSON.parse(await file.text()); } catch (e) { return alertErr(new Error('ไฟล์ไม่ใช่ JSON ที่ถูกต้อง')); }
  const d = (j && j.data) || j || {};
  if (!Array.isArray(d.fiscalYears)) return alertErr(new Error('ไม่พบข้อมูลปีงบประมาณในไฟล์สำรอง'));
  if (!(await confirmBox('นำเข้าข้อมูลสำรอง?', `ข้อมูลปัจจุบัน (ยกเว้นผู้ใช้และการตั้งค่า) จะถูก<b>แทนที่</b>ด้วยข้อมูลในไฟล์<br>ปีงบประมาณ ${d.fiscalYears.length} ปี · รายการเบิกจ่าย ${(d.expenses || []).length} รายการ`, { danger: true, ok: 'นำเข้า' }))) return;
  try {
    const tables = {}; DATA_TABLES.forEach((t) => { tables[t] = Array.isArray(d[t]) ? d[t] : []; });
    await Busy.run('import', 'ข้อมูลสำรอง', async () => { await api('reset'); await api('bulk', { tables }); await loadAll(); });
    rerender();
  } catch (e) { alertErr(e); }
}
async function resetData() {
  let ok;
  if (window.Swal) {
    const r = await Swal.fire({ icon: 'warning', title: 'ล้างข้อมูลทั้งหมด?', html: 'ข้อมูลปีงบประมาณ หมวด รายการ การเบิกจ่าย และผู้รับผิดชอบทั้งหมดจะถูกลบ<br><span class="text-sm text-slate-500">(บัญชีผู้ใช้และการตั้งค่ายังคงอยู่)</span><br><br>พิมพ์คำว่า <b>ยืนยัน</b> เพื่อดำเนินการ', input: 'text', showCancelButton: true, confirmButtonText: 'ล้างข้อมูล', cancelButtonText: 'ยกเลิก', confirmButtonColor: '#EF5350', reverseButtons: true,
      preConfirm: (v) => { if (v !== 'ยืนยัน') { Swal.showValidationMessage('กรุณาพิมพ์คำว่า ยืนยัน'); return false; } return true; } });
    ok = r.isConfirmed;
  } else ok = prompt('พิมพ์คำว่า ยืนยัน เพื่อล้างข้อมูลทั้งหมด') === 'ยืนยัน';
  if (!ok) return;
  try { await Busy.run('reset', '', async () => { await api('reset'); await loadAll(); }); rerender(); } catch (e) { alertErr(e); }
}

/* ---------- 11) บันทึกกิจกรรม ---------- */
VIEWS.logs = async () => {
  $('#view').innerHTML = '<div class="space-y-3">' + Array(6).fill('<div class="h-12 rounded-xl bg-white/70 animate-pulse"></div>').join('') + '</div>';
  try { S.logs = await api('logs', { limit: 1000 }); } catch (e) { alertErr(e); S.logs = []; }
  if (S.view !== 'logs') return;
  const actColor = { 'เพิ่ม': '#0EA5E9', 'แก้ไข': '#0288D1', 'ลบ': '#EF5350', 'เข้าสู่ระบบ': '#5C6BC0', 'ออกจากระบบ': '#78909C', 'ล้างข้อมูล': '#D32F2F', 'นำเข้าข้อมูล': '#8E24AA' };
  crud({
    id: 'logs', table: 'logs', entity: 'บันทึกกิจกรรม', readOnly: true, csvName: 'บันทึกกิจกรรม',
    rows: () => S.logs,
    search: (r) => `${r.username} ${r.action} ${r.detail} ${TABLE_LABEL[r.table] || ''}`,
    filters: [
      { key: 'action', label: 'ทุกการกระทำ', options: () => Array.from(new Set(S.logs.map((l) => l.action))).map((a) => [a, a]), test: (r, v) => r.action === v },
      { key: 'table', label: 'ทุกเมนู', options: () => Object.keys(TABLE_LABEL).map((k) => [k, TABLE_LABEL[k]]), test: (r, v) => r.table === v },
      { key: 'user', label: 'ผู้ใช้ทั้งหมด', options: () => Array.from(new Set(S.logs.map((l) => l.username))).map((u) => [u, u]), test: (r, v) => r.username === v }
    ],
    columns: [
      { label: 'เวลา', html: (r) => `<span class="whitespace-nowrap">${thDateTime(r.time)}</span>`, csv: (r) => r.time },
      { label: 'ผู้ใช้', html: (r) => `<span class="font-semibold">${esc(r.username)}</span>` },
      { label: 'การกระทำ', html: (r) => badge(r.action, actColor[r.action] || '#78909C'), csv: (r) => r.action },
      { label: 'เมนู', html: (r) => esc(TABLE_LABEL[r.table] || r.table || '-') },
      { label: 'รายละเอียด', html: (r) => esc(r.detail || '-') }
    ],
    emptyText: 'ยังไม่มีบันทึกกิจกรรม'
  });
};

/* ================= ค้นหา / โปรไฟล์ ================= */
function openSearch() {
  if (!S.user) return;
  openModal(`<div class="px-4 py-3 border-b border-slate-100 flex items-center gap-2 shrink-0"><span class="mi text-brand-500">search</span><input id="gq" class="flex-1 text-base py-2 bg-transparent" placeholder="ค้นหารายการงบประมาณ การเบิกจ่าย หมวด ผู้รับผิดชอบ..." autocomplete="off"><button class="icon-btn" data-close><span class="mi">close</span></button></div>
    <div id="gres" class="overflow-auto p-2" style="max-height:65vh"><div class="p-8 text-center text-slate-400 text-sm">พิมพ์อย่างน้อย 2 ตัวอักษร (ค้นหาทุกปีงบประมาณ)</div></div>`, 'max-w-2xl');
  const inp = $('#gq');
  setTimeout(() => inp.focus(), 50);
  let found = [];
  inp.oninput = () => {
    const q = inp.value.trim().toLowerCase();
    if (q.length < 2) { $('#gres').innerHTML = '<div class="p-8 text-center text-slate-400 text-sm">พิมพ์อย่างน้อย 2 ตัวอักษร</div>'; return; }
    const has = (...v) => v.join(' ').toLowerCase().indexOf(q) >= 0;
    const fyY = (id) => (byId('fiscalYears', id) || {}).year || '-';
    found = [];
    S.data.items.filter((i) => has(i.code, i.name, i.note)).slice(0, 10).forEach((i) => found.push({ g: 'รายการงบประมาณ', icon: 'receipt_long', t: i.name, s: `ปีงบ ${fyY(i.fiscalYearId)} · งบ ${money(i.budget)} บาท`, view: 'items', q: i.name, fy: i.fiscalYearId, ledger: i.id }));
    S.data.expenses.filter((e) => has(e.docNo, e.description, e.payee, e.note)).slice(0, 10).forEach((e) => found.push({ g: 'รายการเบิกจ่าย', icon: 'payments', t: e.description, s: `${thDate(e.date)} · ${e.docNo || '-'} · ${money(e.amount)} บาท · ปีงบ ${fyY(e.fiscalYearId)}`, view: 'expenses', q: e.docNo || e.description, fy: e.fiscalYearId }));
    S.data.categories.filter((c) => has(c.code, c.name, c.plan)).slice(0, 6).forEach((c) => found.push({ g: 'หมวด / แผนงาน', icon: 'category', t: c.name, s: `${c.plan || NO_PLAN} · ปีงบ ${fyY(c.fiscalYearId)}`, view: 'categories', q: c.name, fy: c.fiscalYearId }));
    S.data.responsibles.filter((r) => has(r.name, r.position, r.department)).slice(0, 6).forEach((r) => found.push({ g: 'ผู้รับผิดชอบ', icon: 'groups', t: r.name, s: [r.position, r.department].filter(Boolean).join(' · '), view: 'responsibles', q: r.name }));
    let last = '';
    $('#gres').innerHTML = found.length ? found.map((r, i) => { const h = r.g !== last ? `<div class="px-3 pt-3 pb-1 text-xs font-bold text-slate-400">${r.g}</div>` : ''; last = r.g; return `${h}<button class="w-full text-left flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-brand-50" data-i="${i}"><span class="mi text-brand-500">${r.icon}</span><span class="min-w-0"><span class="block font-semibold text-slate-700 truncate">${esc(r.t)}</span><span class="block text-xs text-slate-400 truncate">${esc(r.s)}</span></span></button>`; }).join('')
      : '<div class="p-8 text-center text-slate-400 text-sm">ไม่พบข้อมูลที่ตรงกับคำค้นหา</div>';
  };
  $('#gres').onclick = (e) => {
    const a = e.target.closest('[data-i]');
    if (!a) return;
    const r = found[+a.dataset.i];
    closeModal();
    if (r.fy && r.fy !== S.fy) setFy(r.fy, true);
    S.ui[r.view] = { q: r.q, f: {} };
    if (S.view === r.view) renderView(); else go(r.view);
    if (r.ledger) setTimeout(() => openLedger(r.ledger), 80);
  };
}
function openProfile() {
  openModal(`<form id="pwForm" class="flex flex-col" novalidate>${modalHead('account_circle', esc(S.user.displayName), `${esc((ROLE_SHORT[S.user.role] || [''])[0])} · @${esc(S.user.username)}`)}
    <div class="p-6 space-y-4">
      <div class="font-semibold text-slate-700">เปลี่ยนรหัสผ่าน</div>
      ${fieldHtml({ key: 'oldPassword', label: 'รหัสผ่านเดิม', type: 'password' })}
      ${fieldHtml({ key: 'newPassword', label: 'รหัสผ่านใหม่', type: 'password', placeholder: 'อย่างน้อย 6 ตัวอักษร' })}
      ${fieldHtml({ key: 'confirm', label: 'ยืนยันรหัสผ่านใหม่', type: 'password' })}
    </div>
    <div class="px-6 py-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-2"><button type="button" class="btn btn-ghost" data-close>ปิด</button><button class="btn btn-primary" type="submit"><span class="mi">key</span>เปลี่ยนรหัสผ่าน</button></div></form>`, 'max-w-md');
  $('#pwForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    if (f.newPassword.value.length < 6) return info('รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร');
    if (f.newPassword.value !== f.confirm.value) return info('รหัสผ่านใหม่และการยืนยันไม่ตรงกัน');
    try { await api('changePassword', { oldPassword: f.oldPassword.value, newPassword: f.newPassword.value }); closeModal(); } catch (err) { alertErr(err); }
  };
}

/* ================= เปลือกของแอป ================= */
function applyBranding() {
  const s = S.settings;
  document.title = s.systemName || DEFAULT_SETTINGS.systemName;
  $('#splashTitle').textContent = s.systemName;
  ['#loginLogo', '#loginLogoM'].forEach((id) => { $(id).innerHTML = logoHtml(); });
  $('#loginSys').textContent = s.systemName; $('#loginSysM').textContent = s.systemName;
  $('#loginOrg').textContent = s.orgName; $('#loginOrgM').textContent = s.orgName || s.orgSub;
  $('#loginOrgSub').textContent = s.orgSub;
  renderFooter();
}
function renderFooter() {
  const s = S.settings;
  $('#appFooter').innerHTML = `<div class="flex flex-wrap items-center gap-3">
    <div class="w-9 h-9 rounded-xl bg-brand-500 text-white grid place-items-center shrink-0"><span class="mi text-[20px]">account_balance_wallet</span></div>
    <div class="min-w-0"><div class="font-bold text-brand-600 text-sm">${esc(s.systemName)}</div>
      ${s.reporterName ? `<div class="text-xs text-slate-500">ครูผู้รายงาน : <b class="text-slate-600">${esc(s.reporterName)}</b>${s.reporterPosition ? ` (${esc(s.reporterPosition)})` : ''}</div>` : ''}</div>
    <div class="ml-auto text-xs text-slate-400">© ${new Date().getFullYear() + 543}${s.orgName ? ' ' + esc(s.orgName) : ''} · บันทึกข้อมูลลงฐานข้อมูลอัตโนมัติ</div></div>`;
}
function renderSidebar() {
  if (!S.user) return;
  const s = S.settings;
  $('#brandLogo').innerHTML = logoHtml();
  $('#brandName').textContent = s.orgName || s.systemName; $('#brandSub').textContent = s.orgSub || (s.orgName ? '' : (can('admin') ? 'ตั้งชื่อหน่วยงานได้ที่เมนูตั้งค่าระบบ' : ''));
  const ys = sortedYears();
  $('#fySelect').innerHTML = ys.length ? ys.map((y) => `<option value="${esc(y.id)}" ${y.id === S.fy ? 'selected' : ''}>ปีงบ ${esc(y.year)} · ${(FY_STATUS[y.status] || ['-'])[0]}</option>`).join('') : '<option value="">— ยังไม่มีปีงบประมาณ —</option>';
  $('#nav').innerHTML = MENU.filter((m) => can(m.role || 'viewer')).map((m) => `<a href="#/${m.id}" data-nav="${m.id}" class="nav-item flex items-center gap-3 px-4 py-2.5 rounded-xl text-white/85 text-[15px] ${m.id === S.view ? 'active' : ''}"><span class="mi text-[22px]">${m.icon}</span><span>${m.label}</span></a>`).join('');
  $('#userAvatar').textContent = String(S.user.displayName || S.user.username || '?').trim().charAt(0);
  $('#userName').textContent = S.user.displayName; $('#userRole').textContent = (ROLE_SHORT[S.user.role] || [S.user.role])[0];
}
function setFy(id, silent) {
  S.fy = id; store.set('bt_fy', id);
  ['items', 'expenses', 'categories'].forEach((k) => { if (S.ui[k]) S.ui[k].f = {}; });
  if (S.ui.report) S.ui.report.fy = id;
  if (S.ui.compare) S.ui.compare.a = id;
  if (!silent) rerender();
}
function pickFy() {
  const saved = store.get('bt_fy', null);
  if (saved && byId('fiscalYears', saved)) { S.fy = saved; return; }
  const ys = sortedYears();
  const act = ys.find((f) => f.status === 'active');
  S.fy = (act || ys[0] || {}).id || null;
}
async function loadAll() {
  const d = await api('bootstrap');
  S.user = d.user; S.settings = Object.assign({}, DEFAULT_SETTINGS, d.settings || {});
  Object.keys(S.data).forEach((k) => { S.data[k] = Array.isArray(d[k]) ? d[k] : []; });
  S.data.fiscalYears.forEach((f) => { const rg = fyRange(f.year); if (!f.startDate) f.startDate = rg.startDate; if (!f.endDate) f.endDate = rg.endDate; });
  pickFy();
}
function go(id) { if (location.hash === '#/' + id) route(); else location.hash = '#/' + id; }
function route() {
  if (!S.user) return;
  let id = (location.hash.match(/^#\/(\w+)/) || [])[1] || 'dashboard';
  const m = MENU.find((x) => x.id === id);
  if (!m || !can(m.role || 'viewer')) id = 'dashboard';
  S.view = id;
  closeSidebar();
  renderView();
}
function renderView() {
  killCharts();
  const m = MENU.find((x) => x.id === S.view) || MENU[0];
  smoothText($('#pageTitle'), m.label);
  smoothText($('#pageSub'), m.sub);
  $$('#nav .nav-item').forEach((a) => a.classList.toggle('active', a.dataset.nav === S.view));
  $('#view').onclick = null;
  try {
    const r = VIEWS[S.view]();
    if (r && r.catch) r.catch((e) => { console.error(e); alertErr(e); });
  } catch (e) {
    console.error(e);
    $('#view').innerHTML = emptyState('error', 'แสดงผลหน้านี้ไม่สำเร็จ', esc(e.message || e));
  }
  const v = $('#view');
  v.classList.remove('view-enter'); void v.offsetWidth; v.classList.add('view-enter');   // เล่นแอนิเมชันเข้าหน้าใหม่
  try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { window.scrollTo(0, 0); }
}
function rerender() { renderSidebar(); renderView(); }
function openSidebar() { $('#sidebar').classList.remove('-translate-x-full'); $('#backdrop').classList.remove('hidden'); }
function closeSidebar() { if (window.innerWidth < 1024) { $('#sidebar').classList.add('-translate-x-full'); $('#backdrop').classList.add('hidden'); } }

function showLogin() {
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
  $('#setupForm').classList.add('hidden');
  const f = $('#loginForm');
  f.classList.remove('hidden'); f.classList.remove('form-swap'); void f.offsetWidth; f.classList.add('form-swap');
  f.reset(); $('#loginErr').classList.add('hidden');
  $('#loginGreet').textContent = greeting();
  $('#changeConn').classList.toggle('hidden', !!CONFIG_URL);
  if (S.bootError) { $('#loginErr').textContent = S.bootError; $('#loginErr').classList.remove('hidden'); }
  setTimeout(() => f.elements.username.focus(), 100);
}
function showSetup(msg) {
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
  $('#loginForm').classList.add('hidden');
  const f = $('#setupForm');
  f.classList.remove('hidden'); f.classList.remove('form-swap'); void f.offsetWidth; f.classList.add('form-swap');
  f.elements.url.value = API_URL || String(store.get('bt_api_url', '') || '');
  $('#setupErr').classList.toggle('hidden', !msg);
  $('#setupErr').textContent = msg || '';
  applyBranding();
  setTimeout(() => f.elements.url.focus(), 100);
}
function showApp() {
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#dateChip').innerHTML = `<span class="mi text-[16px]">calendar_month</span>${thDate(today())}`;
  applyBranding();
  renderSidebar();
  route();
}
function splash(p, text) { const b = $('#splashBar'); if (b) b.style.width = p + '%'; if (text) smoothText($('#splashSub'), text); }
function hideSplash() { setTimeout(() => $('#splash').classList.add('hide'), 450); }

function bindShell() {
  $('#loginForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target, btn = $('#loginBtn');
    $('#loginErr').classList.add('hidden');
    btn.disabled = true; btn.innerHTML = '<span class="mi animate-spin">progress_activity</span>กำลังเข้าสู่ระบบ...';
    try {
      await Busy.run('login', '', async () => {
        const r = await api('login', { username: f.elements.username.value, password: f.elements.password.value });
        S.token = r.token;
        store.set('bt_session', { token: r.token, mode: API_URL });
        await loadAll();
      }, null);
      S.bootError = null;
      showApp();
      toast(`${greeting()} คุณ${S.user.displayName}`);
    } catch (err) {
      $('#loginErr').textContent = errMsg(err);
      $('#loginErr').classList.remove('hidden');
    } finally { btn.disabled = false; btn.innerHTML = '<span class="mi">login</span>เข้าสู่ระบบ'; }
  };
  $('#togglePw').onclick = () => { const p = $('#loginForm').elements.password; p.type = p.type === 'password' ? 'text' : 'password'; $('#togglePw .mi').textContent = p.type === 'password' ? 'visibility' : 'visibility_off'; };
  $('#changeConn').onclick = () => showSetup();
  $('#setupForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target, btn = $('#setupBtn'), err = $('#setupErr');
    const url = String(f.elements.url.value || '').trim();
    err.classList.add('hidden');
    if (!API_URL_RE.test(url)) {
      err.textContent = 'URL ไม่ถูกต้อง — ต้องเป็นลิงก์เว็บแอปรูปแบบ https://script.google.com/macros/s/.../exec';
      err.classList.remove('hidden');
      return;
    }
    btn.disabled = true; btn.innerHTML = '<span class="mi animate-spin">progress_activity</span>กำลังทดสอบการเชื่อมต่อ...';
    try {
      const inf = await Busy.run('connect', '', () => remote('publicInfo', {}, url));
      if (!inf || !inf.settings) throw new Error('URL นี้ไม่ใช่ API ของระบบติดตามงบประมาณ — ตรวจสอบว่าวางโค้ด Code.gs ถูกต้อง');
      API_URL = url;
      store.set('bt_api_url', url);
      S.settings = Object.assign({}, DEFAULT_SETTINGS, inf.settings);
      S.bootError = null;
      applyBranding();
      showLogin();
    } catch (ex) {
      err.textContent = errMsg(ex);
      err.classList.remove('hidden');
    } finally { btn.disabled = false; btn.innerHTML = '<span class="mi">link</span>ทดสอบและเชื่อมต่อ'; }
  };
  $('#fySelect').onchange = (e) => { if (e.target.value) { setFy(e.target.value); const y = fyObj(); toast(`กำลังแสดงข้อมูลปีงบประมาณ ${y ? y.year : ''}`, 'info'); } };
  $('#menuBtn').onclick = openSidebar;
  $('#backdrop').onclick = closeSidebar;
  $('#searchBtn').onclick = openSearch;
  $('#userBtn').onclick = openProfile;
  $('#refreshBtn').onclick = async () => {
    const i = $('#refreshBtn .mi'); i.classList.add('animate-spin');
    try { await Busy.run('load', '', loadAll, 'อัปเดตข้อมูลล่าสุดแล้ว'); rerender(); } catch (e) { alertErr(e); } finally { i.classList.remove('animate-spin'); }
  };
  $('#logoutBtn').onclick = async () => {
    if (!(await confirmBox('ออกจากระบบ?', '', { icon: 'question', ok: 'ออกจากระบบ' }))) return;
    try { await api('logout'); } catch (e) { /* ignore */ }
    S.user = null; S.token = null; store.del('bt_session');
    history.replaceState(null, '', location.pathname + location.search);
    showLogin();
  };
  window.addEventListener('hashchange', route);
  // ระลอกคลื่นเมื่อกดปุ่ม — ให้ทุกการกดรู้สึกนุ่มนวลและตอบสนองทันที
  document.addEventListener('pointerdown', (e) => {
    const t = e.target.closest && e.target.closest('.btn,.icon-btn,.nav-item');
    if (!t || t.disabled) return;
    const r = t.getBoundingClientRect(), d = Math.max(r.width, r.height) * 2.2;
    const sp = document.createElement('span');
    sp.className = 'ripple';
    sp.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
    t.appendChild(sp);
    setTimeout(() => sp.remove(), 650);
  });
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) { closeModal(); return; }
    const g = e.target.closest('[data-go]');
    if (g) { e.preventDefault(); go(g.dataset.go); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('#modal').classList.contains('show') && !(window.Swal && Swal.isVisible())) closeModal();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && S.user) { e.preventDefault(); openSearch(); }
  });
  document.addEventListener('focusin', (e) => { if (e.target.matches && e.target.matches('[data-money]') && e.target.value !== '') e.target.value = String(num(e.target.value)); });
  document.addEventListener('focusout', (e) => { if (e.target.matches && e.target.matches('[data-money]') && e.target.value.trim() !== '') e.target.value = money(num(e.target.value)); });
  document.addEventListener('change', async (e) => {
    const inp = e.target;
    if (!inp.matches || !inp.matches('[data-upload]')) return;
    const file = inp.files && inp.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { inp.value = ''; return alertErr(new Error('ไฟล์ต้องมีขนาดไม่เกิน 10MB')); }
    const target = inp.closest('form').elements[inp.dataset.upload];
    const lbl = inp.closest('label');
    lbl.style.opacity = '.5'; lbl.style.pointerEvents = 'none';
    try {
      const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(file); });
      const r = await api('upload', { file: { name: file.name, mimeType: file.type || 'application/octet-stream', data } });
      target.value = r.url;
      target.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (err) { alertErr(err); } finally { lbl.style.opacity = ''; lbl.style.pointerEvents = ''; inp.value = ''; }
  });
}

async function boot() {
  if (window.Chart) {
    Chart.defaults.font.family = "'Sarabun', sans-serif";
    Chart.defaults.color = '#64748b';
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
  }
  bindShell();
  S.booting = true;   // ระหว่างหน้าโหลดแรก ใช้หน้าจอ splash แทนหน้าต่างกำลังโหลด
  API_URL = CONFIG_URL || String(store.get('bt_api_url', '') || '');
  splash(15, 'กำลังเริ่มต้นระบบ...');
  if (!API_URL) { S.booting = false; splash(100, 'พร้อมใช้งาน'); showSetup(); hideSplash(); return; }
  try {
    splash(40, 'กำลังเชื่อมต่อฐานข้อมูล...');
    const inf = await api('publicInfo');
    S.settings = Object.assign({}, DEFAULT_SETTINGS, inf.settings || {});
  } catch (e) { S.bootError = errMsg(e); }
  applyBranding();
  splash(65, 'กำลังโหลดข้อมูล...');
  const sess = store.get('bt_session', null);
  if (!S.bootError && sess && sess.token && sess.mode === API_URL) {
    S.token = sess.token;
    try { splash(80, 'กำลังโหลดข้อมูลของคุณ...'); await loadAll(); S.booting = false; splash(100, 'พร้อมใช้งาน'); showApp(); hideSplash(); return; } catch (e) { S.token = null; S.user = null; store.del('bt_session'); }
  }
  S.booting = false;
  splash(100, 'พร้อมใช้งาน');
  showLogin();
  hideSplash();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
