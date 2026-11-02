// KPI 자동 집계(미팅 누락) 시험 — 카드 원본 함수·월별 집계·집계 서버를 가짜 데이터로 돌린다.
// 실제 카드·트래커·Google 에는 접속하지 않는다.  CARD_DIR=<카드 저장소 폴더> node tests/kpi-sync.test.cjs
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert'), { execSync } = require('child_process');
const { cardLogicSource, cutFunction } = require('../tools/kpi-sync/card-cut.cjs');
const MeetingKpi = require('../tools/kpi-sync/meeting-kpi.cjs');
const CARD_DIR = process.env.CARD_DIR || path.join(__dirname, '..', '..', 'card-meeting-miss');
const cardHtml = fs.readFileSync(path.join(CARD_DIR, 'index.html'), 'utf8');
let pass = 0; const results = [];
function t(name, fn) { try { fn(); pass++; results.push('성공 ' + name); } catch (e) { results.push('실패 ' + name + ' — ' + e.message); process.exitCode = 1; } }

const NOW = new Date(2026, 10, 20, 12, 0, 0).getTime(); // 2026-11-20 12:00 (한국 시간 기준 시험)
const fixedDate = now => class extends Date { constructor(...a) { if (a.length) super(...a); else super(now); } static now() { return now; } };
const day = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
function cardContext(now) {
  const ctx = vm.createContext({ Date: fixedDate(now), Map, Set, JSON, Math, Object, Array, String, Number, parseInt, isNaN, console });
  vm.runInContext(cardLogicSource(cardHtml), ctx);
  return ctx;
}
const co = (id, nm, extra) => Object.assign({ id: 'c' + id, name: '시험업체' + id, partnerDashboard: { newMou: nm } }, extra || {});
// 상태별 대표 업체(이름·숫자는 가짜)
const COMPANIES = [
  co(1, { qReplyLabel: '26.10.01', qReplyDone: true }),                                   // 1차 필요 · 등록 지연
  co(2, { qReplyLabel: '26.11.10', qReplyDone: true }),                                   // 1차 필요 · 등록 대기
  co(3, { qReplyLabel: '26.10.01', m1ScheduledLabel: '26.11.10', m1Scheduled: true }),    // 1차 예정 지남 · 누락
  co(4, { qReplyLabel: '26.10.01', m1ScheduledLabel: '26.11.19', m1Scheduled: true }),    // 1차 예정 · 유예 안
  co(5, { qReplyLabel: '26.10.01', m1Label: '26.11.10', m1Done: true }),                  // 1차 완료(11월) → 2차 필요 · 대기
  co(6, { qReplyLabel: '26.10.01', m1Label: '일정 조율중(11.01)' }),                        // 조율 중
  co(7, { qReplyLabel: '26.10.01', m1Label: '일정 조율중(10.01)' }),                        // 조율 30일 넘음 · 등록 지연
  co(8, { qReplyLabel: '26.10.01', m1Label: '양산지사' }),                                  // 지사 진행
  co(9, { qReplyLabel: '26.10.01', m1Label: '26.10.05', m1Done: true, mouDone: true, mouLabel: '26.10.20' }), // 1차 완료(10월) · 2차 예외
  co(10, { qReplyLabel: '26.10.01', m1Label: '26.10.05', m1Done: true }),                 // 1차 완료(10월) → 2차 등록 지연(10.19)
  co(11, { qReplyLabel: '26.10.01' }, { agreementStatus: 'terminated' }),                 // 협약 종료 · 제외
  co(12, { qReplyLabel: '26.10.01' }, { deletedAt: '2026-10-02T00:00:00Z' }),             // 삭제 · 제외
  co(13, { qReplyLabel: '26.10.01', m1Label: '??' }),                                     // 날짜 확인
  co(14, { qSentLabel: '26.11.01' }),                                                     // 질문서 회신 전 · 대상 아님
];
const items = cardContext(NOW).CardLogic.collect(COMPANIES, [], NOW);
const byId = k => items.filter(r => r.id === k).map(r => r.key + ':' + r.status).join(',');

t('카드 원본 함수 판정: 상태별 분류', () => {
  assert.equal(byId('c1'), 'm1:late'); assert.equal(byId('c2'), 'm1:waiting'); assert.equal(byId('c3'), 'm1:missed');
  assert.equal(byId('c4'), 'm1:scheduled'); assert.equal(byId('c5'), 'm1:done,m2:waiting'); assert.equal(byId('c6'), 'm1:coord');
  assert.equal(byId('c7'), 'm1:late'); assert.equal(byId('c8'), 'm1:branch'); assert.equal(byId('c9'), 'm1:done,m2:exempt');
  assert.equal(byId('c10'), 'm1:done,m2:late'); assert.equal(byId('c13'), 'm1:format');
});
t('협약 종료·삭제·질문서 회신 전 업체는 판정 대상 아님', () => { ['c11', 'c12', 'c14'].forEach(k => assert.equal(byId(k), '', k)); });
t('기한: 예정일 + 3일 안이면 누락 아님, 넘으면 누락', () => {
  const one = s => cardContext(day(s) + 12 * 3600e3).CardLogic.collect([co(3, { qReplyLabel: '26.10.01', m1ScheduledLabel: '26.11.10' })], [], day(s) + 12 * 3600e3)[0].status;
  assert.equal(one('2026-11-13'), 'scheduled'); assert.equal(one('2026-11-14'), 'missed');
});
t('기한: 미팅 필요 후 14일 안이면 대기, 넘으면 등록 지연', () => {
  const one = s => cardContext(day(s) + 12 * 3600e3).CardLogic.collect([co(1, { qReplyLabel: '26.11.01' })], [], day(s) + 12 * 3600e3)[0].status;
  assert.equal(one('2026-11-15'), 'waiting'); assert.equal(one('2026-11-16'), 'late');
});

t('월별 집계: 이번 달(11월) 분자·분모와 이월', () => {
  const r = MeetingKpi.monthly(items, '2026-11', NOW);
  // 11월 기준일: c2 대기(11.24) · c3 누락(11.10) · c4 예정(11.19) · c5 완료(11.10)·2차 대기(11.24) / 이월: c1(10.15)·c7(10.31)·c10(10.19)
  assert.equal(r.den, 8); assert.equal(r.num, 4);
  assert.equal(r.counts.carried, 3); assert.equal(r.counts.missed, 1); assert.equal(r.counts.late, 3);
  assert.equal(r.counts.coord, 1); assert.equal(r.counts.branch, 1); assert.equal(r.counts.format, 1); assert.equal(r.counts.exempt, 1);
});
t('월별 집계: 지난달(10월)은 기준일이 10월인 미팅만, 확인 필요 건수는 넣지 않음', () => {
  const r = MeetingKpi.monthly(items, '2026-10', NOW);
  // 10월: c9 완료(10.05) · c10 완료(10.05) · c1 지연(10.15) · c10 2차 지연(10.19) · c7 지연(10.31)
  assert.equal(r.den, 5); assert.equal(r.num, 2); assert.equal(r.counts.carried, 0); assert.equal(r.counts.coord, 0);
});
t('트래커 달성률 계산과 맞물림: 4/8 = 50%', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const block = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(b => b.includes('var PerfCalc'));
  const c = { SEED: {} }; vm.runInNewContext(block, c);
  const r = MeetingKpi.monthly(items, '2026-11', NOW);
  assert.equal(c.PerfCalc.rate({ mode: 'auto', num: r.num, den: r.den }).value, 50);
});
t('다시 계산할 달: 5일까지는 지난달 포함, 6일부터 이번 달만', () => {
  assert.deepStrictEqual(MeetingKpi.targetMonths(day('2026-12-05')), ['2026-11', '2026-12']);
  assert.deepStrictEqual(MeetingKpi.targetMonths(day('2026-12-06')), ['2026-12']);
  assert.deepStrictEqual(MeetingKpi.targetMonths(day('2027-01-02')), ['2026-12', '2027-01']);
});

t('카드 MOU 진행상황 "미팅 누락·일정 확인" 필터와 서버 집계가 같은 업체·미팅', () => {
  const ctx = cardContext(NOW);
  ctx.COMPANIES = COMPANIES;
  vm.runInContext([
    ...['collectMeetingMiss', 'meetingMissIndex'].map(n => cutFunction(cardHtml, n)),
    'var isMeetingMissRow = function (r) { return r.status === "missed" || r.status === "late"; }; var MEETING_CHECK_LABEL = { coord: 1, branch: 1, format: 1 };',
    'D.loadActiveCompanies = function () { return COMPANIES.filter(function (c) { return !c.deletedAt; }); };',
    'var out = []; meetingMissIndex().forEach(function (rows, id) { rows.forEach(function (r) { out.push(id + ":" + r.key + ":" + r.status); }); }); this.ui = JSON.stringify(out.sort());',
  ].join(String.fromCharCode(10)), ctx);
  const srv = items.filter(r => ['missed', 'late', 'coord', 'branch', 'format'].includes(r.status)).map(r => r.id + ':' + r.key + ':' + r.status).sort();
  assert.equal(ctx.ui, JSON.stringify(srv));
});

/* ---- 집계 서버(dist/Code.gs)를 Apps Script 흉내 환경에서 실행 ---- */
execSync(`node "${path.join(__dirname, '..', 'tools', 'kpi-sync', 'build-server.cjs')}" "${CARD_DIR}"`, { stdio: 'ignore' });
const gs = fs.readFileSync(path.join(__dirname, '..', 'tools', 'kpi-sync', 'dist', 'Code.gs'), 'utf8');
function toFs(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (Array.isArray(v)) return { arrayValue: v.length ? { values: v.map(toFs) } : {} };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'object') { const f = {}; Object.keys(v).forEach(k => { if (v[k] !== undefined) f[k] = toFs(v[k]); }); return { mapValue: Object.keys(f).length ? { fields: f } : {} }; }
  return { stringValue: String(v) };
}
function gasServer({ password = 'right', trackerCode = 200 } = {}) {
  const log = { signIns: 0, reads: 0, writes: [], other: [] }, props = { CARD_PASSWORD: 'right' };
  const resp = (code, body) => ({ getResponseCode: () => code, getContentText: () => typeof body === 'string' ? body : JSON.stringify(body) });
  const UrlFetchApp = { fetch(url, opt = {}) {
    const method = (opt.method || 'get').toLowerCase();
    if (url.startsWith('https://identitytoolkit.googleapis.com/')) { log.signIns++; return JSON.parse(opt.payload).password === props.CARD_PASSWORD ? resp(200, { idToken: 'tok', localId: 'uid1' }) : resp(400, {}); }
    if (url.startsWith('https://firestore.googleapis.com/')) { if (method !== 'get') log.other.push('카드 쓰기 ' + method); log.reads++; return (opt.headers || {}).Authorization === 'Bearer tok' && url.endsWith('/users/uid1/shin2/shin2-companies-staging') ? resp(200, { fields: { value: toFs(COMPANIES) } }) : resp(403, {}); }
    if (url === 'https://bridgeone-m.github.io/card/index.html') return resp(200, '<script>window.SHIN2_PARTNER_SNAPSHOT = [];</script>');
    if (url.includes('b2b-task-tracker-39144')) { log.writes.push({ method, url, body: opt.payload }); return resp(trackerCode, '{}'); }
    log.other.push(url); return resp(404, '');
  } };
  props.CARD_PASSWORD = password;
  const ctx = vm.createContext({ Date: fixedDate(NOW), Map, Set, JSON, Math, Object, Array, String, Number, parseInt, isNaN, encodeURIComponent, console: { log() {}, warn() {}, error() {} },
    UrlFetchApp, LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => k === 'CARD_PASSWORD' ? password : null, setProperty: (k, v) => { props[k] = v; } }) } });
  props.CARD_PASSWORD = 'right';
  vm.runInContext(gs, ctx);
  return { ctx, log, props };
}
t('서버: 트래커 perfAuto 에만 쓰고 업체 정보는 보내지 않음', () => {
  const s = gasServer(); const r = s.ctx.runKpiSync();
  assert.ok(r.ok, r.error); assert.equal(s.log.writes.length, 1); assert.equal(s.log.writes[0].method, 'patch');
  const body = JSON.parse(s.log.writes[0].body);
  assert.deepStrictEqual(Object.keys(body), ['perfAuto/LI01_2026-11']);
  const rec = body['perfAuto/LI01_2026-11'];
  assert.equal(rec.num, 4); assert.equal(rec.den, 8); assert.equal(rec.mode, 'auto'); assert.equal(rec.ref, 'LI01');
  const text = s.log.writes[0].body;
  COMPANIES.forEach(c => { assert.ok(!text.includes(c.name), '업체명 전송'); assert.ok(!text.includes('"' + c.id + '"'), '업체 id 전송'); });
  assert.deepStrictEqual(s.log.other, []);
});
t('서버: 점검 실행(checkKpiSync)은 트래커에 쓰지 않음', () => { const s = gasServer(); const r = s.ctx.checkKpiSync(); assert.ok(r.ok); assert.equal(s.log.writes.length, 0); });
t('서버: 로그인 실패면 한 번만 시도하고 트래커에 쓰지 않음', () => {
  const s = gasServer({ password: 'wrong' }); const r = s.ctx.runKpiSync();
  assert.equal(r.ok, false); assert.ok(/AUTH/.test(r.error)); assert.equal(s.log.signIns, 1); assert.equal(s.log.writes.length, 0);
  assert.ok(/AUTH/.test(JSON.parse(s.props.KPI_SYNC_LAST).error));
});
t('서버: 트래커 저장 실패는 오류로 남김', () => { const s = gasServer({ trackerCode: 401 }); const r = s.ctx.runKpiSync(); assert.equal(r.ok, false); assert.ok(/WRITE/.test(r.error)); });
t('서버 파일에 비밀번호·자리표시자 없음', () => { assert.ok(!/__[A-Z_]+__/.test(gs)); assert.ok(gs.includes("getProperty('CARD_PASSWORD')")); });

console.log(results.join('\n') + `\n\n${pass} / ${results.length} 성공`);
