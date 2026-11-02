// 팀 KPI 3개 전송(dashboard-push.gs) 시험 — 대시보드 캐시·트래커를 가짜로 흉내 낸다. 실제 Google·트래커 접속 없음.
//   node tests/dashboard-push.test.cjs
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'kpi-sync', 'dashboard-push.gs'), 'utf8');
let pass = 0; const results = [];
function t(name, fn) { try { fn(); pass++; results.push('성공 ' + name); } catch (e) { results.push('실패 ' + name + ' — ' + e.message); process.exitCode = 1; } }

const AT = Date.UTC(2026, 10, 2, 11, 0, 0); // 2026-11-02 20:00 KST
// 대시보드 결과(analyze.js OUT.kpi3) 모양 — 업체명이 든 todo 목록도 실제처럼 넣어 전송되지 않는지 본다
const KPI3 = { base: '2026-05-20', obs: 60, per: { after: { from: '2026-05-20', to: '2026-11-02' } },
  k1: { before: { n: 30, done: 23, hit: 9, open: 0, openHit: 0 }, after: { n: 25, done: 17, hit: 3, open: 8, openHit: 2 } },
  k2: { before: { done: 19 }, after: { n: 18, done: 16, active: 10, open: 2, openActive: 1 } },
  k3: { before: { n: 0 }, after: { n: 1014, sure: 19, cand: 7, sameDay: 3 } },
  todo: { k1open: [['비밀업체', '2026-10-20', 10]], k1miss: [['다른업체', '2026-08-01']] } };
function env({ cache = { meta: { at: AT, computedAt: '2026-11-02 20:00:00' }, json: JSON.stringify({ kpi3: KPI3 }) }, code = 200 } = {}) {
  const writes = [];
  const ctx = vm.createContext({ Date, JSON, Math, Object, Array, String, Number, console: { log() {} },
    readCache_: () => cache,
    Utilities: { formatDate: (d, tz, f) => { const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' }).formatToParts(d); return p.find(x => x.type === 'year').value + '-' + p.find(x => x.type === 'month').value; } },
    UrlFetchApp: { fetch: (url, opt) => { writes.push({ url, opt }); return { getResponseCode: () => code }; } } });
  const before = new Set(Object.keys(ctx));
  vm.runInContext(src, ctx);
  return { ctx, writes, globals: Object.keys(ctx).filter(k => !before.has(k)).sort() };
}

t('대시보드 첫 화면과 같은 분자·분모: ① 3/17 · ② 10/16 · ③ 19/1014', () => {
  const e = env(); const r = e.ctx.trackerPushRun();
  assert.ok(r.ok, r.error);
  const body = JSON.parse(e.writes[0].opt.payload);
  assert.equal(JSON.stringify(Object.keys(body).sort()), JSON.stringify(['perfAuto/MK1_2026-11', 'perfAuto/MK2_2026-11', 'perfAuto/MK3_2026-11']));
  const g = k => body['perfAuto/' + k + '_2026-11'];
  assert.equal(g('MK1').num, 3); assert.equal(g('MK1').den, 17); assert.equal(g('MK1').counts.open, 8);
  assert.equal(g('MK2').num, 10); assert.equal(g('MK2').den, 16);
  assert.equal(g('MK3').num, 19); assert.equal(g('MK3').den, 1014); assert.equal(g('MK3').counts.cand, 7);
  assert.equal(g('MK1').mode, 'auto'); assert.equal(g('MK1').source, '통합 KPI 대시보드');
  assert.equal(e.writes[0].opt.method, 'patch'); assert.ok(/b2b-task-tracker-39144/.test(e.writes[0].url));
});
t('업체명(todo 목록)은 보내지 않음', () => { const e = env(); e.ctx.trackerPushRun(); const p = e.writes[0].opt.payload; assert.ok(!p.includes('비밀업체') && !p.includes('다른업체')); });
t('점검 실행은 쓰지 않음', () => { const e = env(); const r = e.ctx.trackerPushCheck(); assert.ok(r.ok); assert.equal(e.writes.length, 0); assert.equal(JSON.stringify(Array.from(r.values)), JSON.stringify(['MK1 3/17', 'MK2 10/16', 'MK3 19/1014'])); });
t('대시보드 계산 결과가 없으면 쓰지 않음', () => { const e = env({ cache: null }); const r = e.ctx.trackerPushRun(); assert.equal(r.ok, false); assert.ok(/NO_CACHE/.test(r.error)); assert.equal(e.writes.length, 0); });
t('결과에 대표 KPI가 없으면 쓰지 않음', () => { const e = env({ cache: { meta: { at: AT }, json: '{}' } }); const r = e.ctx.trackerPushRun(); assert.ok(/FORMAT/.test(r.error)); assert.equal(e.writes.length, 0); });
t('트래커 저장 실패는 오류로 남김', () => { const e = env({ code: 401 }); const r = e.ctx.trackerPushRun(); assert.equal(r.ok, false); assert.ok(/WRITE/.test(r.error)); });
t('월은 대시보드 계산 시각(한국 시간) 기준', () => {
  const e = env({ cache: { meta: { at: Date.UTC(2026, 10, 30, 16, 0, 0) }, json: JSON.stringify({ kpi3: KPI3 }) } }); // 12-01 01:00 KST
  e.ctx.trackerPushRun(); assert.ok(Object.keys(JSON.parse(e.writes[0].opt.payload))[0].endsWith('2026-12'));
});
t('대시보드 프로젝트에 넣어도 겹치는 전역 이름 없음', () => { assert.equal(JSON.stringify(env().globals), JSON.stringify(['TrackerPush', 'trackerPushCheck', 'trackerPushRun'])); });
t('대시보드를 다시 계산하거나 캐시에 쓰지 않음', () => { ['getDashboard(', 'compute_(', 'writeCache_(', 'warmUp(', 'Sheets.'].forEach(w => assert.ok(!src.includes(w), w)); });

console.log(results.join('\n') + `\n\n${pass} / ${results.length} 성공`);
