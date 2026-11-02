// 화면 시험 — 모의 DB만 사용한다. 운영 Realtime Database 요청이 하나라도 나가면 실패로 처리한다.
//   NODE_PATH=<playwright 위치> node tests/e2e.cjs <기준 데이터 JSON> <구버전 html> <결과 폴더>
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), assert = require('assert');
const [baselineFile, oldHtml, outDir] = process.argv.slice(2);
const PORT = 5199, BASE = `http://localhost:${PORT}`;
const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
const MONTH = (() => { const d = new Date(), m = d.getMonth() + 1; return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m; })();
const PREV = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); const m = d.getMonth() + 1; return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m; })();
fs.mkdirSync(outDir, { recursive: true });

const results = [], consoleErrors = [], prodRequests = [];
let pass = 0;
async function t(name, fn) {
  try { await fn(); pass++; results.push('성공 ' + name); console.log('성공 ' + name); }
  catch (e) { results.push('실패 ' + name + ' — ' + String(e.message).split('\n')[0]); console.log('실패 ' + name + '\n', e.message); process.exitCode = 1; }
}
const db = async () => (await fetch(BASE + '/__db')).json();
const reset = () => fetch(BASE + '/__reset');
const OLD_KEYS = Object.keys(baseline);
function sameOld(d) { OLD_KEYS.forEach(k => assert.deepStrictEqual(d[k], baseline[k], k + ' 변경됨')); }

async function newPage(browser, opts, fresh) {
  const ctx = await browser.newContext(opts || { viewport: { width: 1320, height: 900 } });
  // 시험은 KPI 탭에서 진행한다. 처음 접속 기본 탭은 별도 시험에서 확인.
  if (!fresh) await ctx.addInitScript(() => { if (!localStorage.getItem('netform.b2b.tracker.tasktab.v1')) localStorage.setItem('netform.b2b.tracker.tasktab.v1', 'kpi'); });
  const p = await ctx.newPage();
  p.on('console', m => { if (m.type() === 'error' && !/__nosdk|ERR_|404|Failed to load/.test(m.text())) consoleErrors.push(m.text()); });
  p.on('pageerror', e => consoleErrors.push(String(e)));
  p.on('request', r => { if (/firebasedatabase\.app|firebaseio\.com/.test(r.url())) prodRequests.push(r.url()); });
  p.dialogs = [];
  p.dialogAnswer = true;
  p.on('dialog', d => { p.dialogs.push(d.message()); return p.dialogAnswer ? d.accept() : d.dismiss(); });
  return p;
}
async function open(p, hash) {
  await p.goto(BASE + '/#' + (hash || 'tasks'));
  await p.reload();
  await p.waitForFunction(() => document.querySelector('#view .wrap'));
}
const card = id => `[data-pf-open][data-id="${id}"]`;
async function openModal(p, type, id, view) {
  const sel = `[data-pf-open="${type}"][data-id="${id}"][data-v="${view}"]`;
  await p.click(sel);
  await p.waitForSelector('#pfModal.on', { timeout: 5000 });
}
async function saveDirect(p, id, val, opts) {
  opts = opts || {};
  await openModal(p, 'lead', id, 'input');
  if (opts.month) { await p.selectOption('#pfmMonth', opts.month); }
  await p.check('input[name=pfmode][value=direct]');
  await p.fill('[data-pf="direct"]', String(val));
  await p.fill('#pfActor', opts.by || '시험자');
  await p.click('#pfSaveRec');
  await p.click('#pfClose');
}
async function saveAuto(p, type, id, num, den, opts) {
  opts = opts || {};
  await openModal(p, type, id, 'input');
  if (opts.month) await p.selectOption('#pfmMonth', opts.month);
  if (type === 'lead') await p.check('input[name=pfmode][value=auto]');
  await p.fill('[data-pf="den"]', String(den));
  if (num != null) await p.fill('[data-pf="num"]', String(num));
  await p.fill('#pfActor', opts.by || '시험자');
  await p.click('#pfSaveRec');
  await p.click('#pfClose');
}
async function setWeights(p, kid, w) {
  await openModal(p, 'kpi', kid, 'links');
  for (const li of Object.keys(w)) await p.fill(`[data-pf-w="${li}"]`, w[li] == null ? '' : String(w[li]));
  await p.fill('#pfActor', '시험자');
  await p.click('#pfSaveW');
  await p.click('#pfClose');
}
const kpiCardText = (p, kid) => p.locator(`article.k:has([data-id="${kid}"])`).innerText();
const leadCardText = (p, id) => p.locator(`article:has([data-pf-open="lead"][data-id="${id}"])`).innerText();
const until = async (fn, ms) => { const end = Date.now() + (ms || 8000); let e; while (Date.now() < end) { try { const r = await fn(); if (r !== false) return r; } catch (x) { e = x; } await new Promise(r => setTimeout(r, 150)); } throw e || new Error('시간 초과'); };

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, 'mock-server.cjs'), String(PORT), baselineFile, oldHtml], { stdio: 'inherit' });
  await new Promise(r => setTimeout(r, 600));
  const browser = await chromium.launch(process.env.E2E_CHROME ? { executablePath: process.env.E2E_CHROME } : {});
  const p = await newPage(browser);
  try {
    // 로컬 호환 서버는 연결이 끊기면 다른 연결의 쓰기를 놓칠 수 있어, 다른 화면을 열기 전에 시험한다
    await t('처음 접속하면 팀 업무 현황이 먼저 보이고 KPI는 신한솔 탭에 있음', async () => {
      const f = await newPage(browser, null, true);
      await open(f);
      assert.ok(/팀 업무 현황/.test(await f.locator('.phead h1').innerText()));
      assert.equal(await f.locator('article.k').count(), 0);
      await f.click('[data-tt="kpi"]');
      assert.ok(/신한솔 KPI·선행지표 관리/.test(await f.locator('.phead h1').innerText()));
      assert.equal(await f.locator('article.k').count(), 3);
      await f.reload(); await f.waitForFunction(() => document.querySelector('#view .wrap'));
      assert.equal(await f.locator('article.k').count(), 3, '선택한 탭 기억');
      await f.context().close();
    });
    await t('처음 열어도 저장 없음 — 기존 데이터 그대로', async () => {
      await open(p); await new Promise(r => setTimeout(r, 1500));
      assert.deepStrictEqual(await db(), baseline);
    });
    await t('선행지표 9개 담당자가 신한솔', async () => {
      const txt = await p.locator('#view .wrap').innerText();
      assert.equal((txt.match(/담당 신한솔/g) || []).length, 9);
    });
    await t('메인 KPI 3 · 선행지표 9 · 후행지표 5 표시', async () => {
      assert.equal(await p.locator('article.k').count(), 3);
      assert.equal(await p.locator('[data-pf-open="lead"][data-v="edit"]').count(), 9);
      assert.equal(await p.locator('article.support').count(), 2);
      const lag = await p.locator('.pf-grid').nth(3).locator('article').count();
      assert.equal(lag, 5);
      await p.screenshot({ path: path.join(outDir, '01_초기_데스크톱.png'), fullPage: true });
    });
    await t('초기 상태: 실적 미측정 · 선행점수 산출 대기 (0으로 표시 안 함)', async () => {
      const txt = await kpiCardText(p, 'MK1');
      assert.ok(/미측정/.test(txt) && /산출 대기/.test(txt) && /가중치 미설정 5개/.test(txt), txt);
      assert.ok(!/\b0%/.test(txt), txt);
      assert.ok(/수동 관리/.test(txt), '수동 관리 표시 없음');
    });
    await t('선행지표 달성률 0% 입력', async () => {
      await saveDirect(p, 'LI03', 0);
      const txt = await leadCardText(p, 'LI03');
      assert.ok(/0\s*%/.test(txt) && /직접 입력/.test(txt), txt);
    });
    await t('선행지표 달성률 50% 입력', async () => {
      await saveDirect(p, 'LI03', 50);
      assert.ok(/50\s*%/.test(await leadCardText(p, 'LI03')));
    });
    await t('선행지표 달성률 100% 입력 · 자동 계산과 구분 표시', async () => {
      await saveAuto(p, 'lead', 'LI01', 10, 10);
      const txt = await leadCardText(p, 'LI01');
      assert.ok(/100\s*%/.test(txt) && /자동 계산/.test(txt), txt);
    });
    await t('가중치 일부만 설정 → 산출 대기 유지', async () => {
      await setWeights(p, 'MK1', { LI01: 30, LI02: 30 });
      const txt = await kpiCardText(p, 'MK1');
      assert.ok(/산출 대기/.test(txt) && /가중치 미설정 3개/.test(txt), txt);
    });
    await t('가중치 합계 90% → 경고 · 산출 대기', async () => {
      await setWeights(p, 'MK1', { LI01: 30, LI02: 30, LI03: 30, LI04: 0, LI06: 0 });
      assert.ok(/가중치 합계 90%/.test(await kpiCardText(p, 'MK1')));
      await openModal(p, 'kpi', 'MK1', 'links');
      assert.ok(/100%가 되어야/.test(await p.locator('#pfScoreLine').innerText()));
      await p.click('#pfClose');
    });
    await t('입력 중 가중치 미리 계산 · 수치 입력 즉시 재계산', async () => {
      await openModal(p, 'kpi', 'MK1', 'links');
      await p.fill('[data-pf-w="LI03"]', '40');
      assert.ok(/합계 100%/.test(await p.locator('#pfScoreLine').innerText()));
      await p.fill('#pfActor', '시험자'); await p.click('#pfSaveW'); await p.click('#pfClose');
    });
    await t('미측정 지표가 남아 있으면 산출 대기 (0 대체 없음)', async () => {
      const txt = await kpiCardText(p, 'MK1');
      assert.ok(/산출 대기/.test(txt) && /미측정 지표 1개/.test(txt), txt);
    });
    await t('명령서 예시 78% 계산', async () => {
      await saveDirect(p, 'LI01', 100); await saveDirect(p, 'LI02', 80); await saveDirect(p, 'LI03', 60);
      const txt = await kpiCardText(p, 'MK1');
      assert.ok(/78\s*%/.test(txt), txt);
    });
    await t('연결 KPI 선행점수 상승 (재연락 80→100 = 84%)', async () => {
      await saveDirect(p, 'LI02', 100);
      assert.ok(/84\s*%/.test(await kpiCardText(p, 'MK1')));
    });
    await t('연결 KPI 선행점수 하락 (재연락 100→50 = 69%)', async () => {
      await saveDirect(p, 'LI02', 50);
      assert.ok(/69\s*%/.test(await kpiCardText(p, 'MK1')));
      await saveDirect(p, 'LI02', 80);
    });
    await t('분모 0 → 대상 없음 · 남은 가중치로 비례 재배분', async () => {
      await saveAuto(p, 'lead', 'LI02', null, 0);
      assert.ok(/대상 없음/.test(await leadCardText(p, 'LI02')));
      const txt = await kpiCardText(p, 'MK1');
      assert.ok(/대상 없음 1개 제외/.test(txt), txt); // (100*30+60*40)/70 = 77.1
      assert.ok(/77\.1\s*%/.test(txt), txt);
      await saveDirect(p, 'LI02', 80);
    });
    await t('입력 검사: 분자>분모 · 입력자 누락 거부', async () => {
      await openModal(p, 'lead', 'LI04', 'input');
      await p.check('input[name=pfmode][value=auto]');
      await p.fill('[data-pf="den"]', '3'); await p.fill('[data-pf="num"]', '5'); await p.fill('#pfActor', '시험자');
      await p.click('#pfSaveRec');
      assert.ok(/분자가 분모보다/.test(await p.locator('.pf-bad').innerText()));
      await p.fill('[data-pf="num"]', '2'); await p.fill('#pfActor', '');
      await p.click('#pfSaveRec');
      assert.ok(/입력자/.test(await p.locator('.pf-bad').innerText()));
      p.dialogAnswer = true; await p.click('#pfClose');
      assert.equal((await db()).perfMonthly['LI04_' + MONTH], undefined);
    });
    await t('월별 실적 저장 · 전월 대비 증감', async () => {
      await saveDirect(p, 'LI01', 90, { month: PREV }); await saveDirect(p, 'LI02', 60, { month: PREV }); await saveDirect(p, 'LI03', 50, { month: PREV });
      const lead = await leadCardText(p, 'LI02');
      assert.ok(/\+20%p/.test(lead), lead); // 60 → 80
      const kpi = await kpiCardText(p, 'MK1'); // 전월 27+18+20 = 65, 이번 달 78
      assert.ok(/\+13%p/.test(kpi), kpi);
      await p.selectOption('#pfMonthSel', PREV);
      assert.ok(/65\s*%/.test(await kpiCardText(p, 'MK1')));
      await p.selectOption('#pfMonthSel', MONTH);
    });
    await t('실제 KPI는 선행점수와 무관 (실적 17/51 = 33.3% 유지)', async () => {
      await saveAuto(p, 'kpi', 'MK1', 17, 51);
      assert.ok(/33\.3\s*%/.test(await kpiCardText(p, 'MK1')));
      await saveDirect(p, 'LI03', 10);
      const txt = await kpiCardText(p, 'MK1');
      assert.ok(/33\.3\s*%/.test(txt) && /17 ÷ 51/.test(txt), txt);
      await saveDirect(p, 'LI03', 60);
    });
    await t('KPI ③ 현장·시공사 단위 별도 저장, 후행지표는 KPI 실적 공유', async () => {
      await openModal(p, 'kpi', 'MK3', 'input');
      await p.fill('[data-pf="den"]', '100'); await p.fill('[data-pf="num"]', '25');
      await p.fill('[data-pf="u.site.den"]', '80'); await p.fill('[data-pf="u.site.num"]', '20');
      await p.fill('[data-pf="u.contractor.den"]', '40'); await p.fill('[data-pf="u.contractor.num"]', '12');
      await p.fill('#pfActor', '시험자'); await p.click('#pfSaveRec'); await p.click('#pfClose');
      const r = (await db()).perfMonthly['MK3_' + MONTH];
      assert.equal(r.units.site.num, 20); assert.equal(r.units.contractor.den, 40);
      const lag = await p.locator('article:has-text("L2 → L3 전환율")').innerText();
      assert.ok(/25\s*%/.test(lag), lag);
    });
    await t('후행지표 직접 실적 · 목표 대비 미달 목록', async () => {
      await saveAuto(p, 'lag', 'LG4', 1, 4);
      await p.click('[data-pf-open="lag"][data-id="LG4"]');
      await p.click('[data-pf-view="edit"]');
      await p.fill('[data-pf-def-num="target"]', '50'); await p.fill('#pfActor', '시험자');
      await p.click('#pfSaveDef'); await p.click('#pfClose');
      assert.ok(/장기 미활동 업체 재활성화율 25%/.test(await p.locator('.note').last().innerText()));
    });
    await t('담당자·목표 수정 · 변경 이력과 세부업무 체크·메모', async () => {
      await openModal(p, 'lead', 'LI05', 'edit');
      await p.fill('[data-pf-def="owner"]', '담당자A'); await p.fill('[data-pf-def-num="target"]', '95'); await p.fill('#pfActor', '시험자');
      await p.click('#pfSaveDef');
      await p.click('[data-pf-view="input"]');
      await p.check('[data-pf-chk="t1"]'); await p.check('[data-pf-chk="t2"]');
      await p.fill('#pfNote', 'B2B001 점검 완료');
      await p.click('#pfSaveRec');
      const body = await p.locator('#pfModal').innerText();
      assert.ok(/담당자 신한솔 → 담당자A/.test(body) && /목표 달성률 미설정 → 95%/.test(body), '정의 변경 이력');
      assert.ok(/메모: B2B001 점검 완료/.test(body) && /세부업무 체크리스트 \(2 \/ 11\)/.test(body), '작업 이력');
      await p.click('#pfClose');
      assert.ok(/담당자A/.test(await leadCardText(p, 'LI05')));
    });
    await p.screenshot({ path: path.join(outDir, '05_입력후_데스크톱.png'), fullPage: true });
    await t('새로고침 후 데이터 유지', async () => {
      await p.reload(); await p.waitForFunction(() => document.querySelector('#view .wrap'));
      const txt = await kpiCardText(p, 'MK1');
      assert.ok(/78\s*%/.test(txt) && /33\.3\s*%/.test(txt), txt);
      assert.ok(/담당자A/.test(await leadCardText(p, 'LI05')));
    });
    await t('기존 데이터 유지 — 기존 키 전부 원본과 동일', async () => { sameOld(await until(async () => { const d = await db(); return d.perfHistory ? d : false; })); });
    await t('원본과 수동 입력 구분: 이력 보관·ID 부여', async () => {
      const d = await db();
      assert.ok(Object.keys(d.perfHistory).length >= 10);
      assert.ok(d.perfMonthly['LI01_' + MONTH].updatedBy === '시험자');
      assert.equal(Object.keys(d.leadDefs).length, 9);
      assert.deepStrictEqual(Object.keys(d.mainKpis), ['MK1', 'MK2', 'MK3']);
    });

    /* 다른 사용자 */
    const q = await newPage(browser);
    await t('다른 사용자 변경이 화면에 반영', async () => {
      await open(q);
      await saveDirect(p, 'LI07', 40, { by: '사용자A' });
      await until(async () => /40\s*%/.test(await leadCardText(q, 'LI07')));
    });
    await t('서로 다른 항목 동시 저장 — 둘 다 보존', async () => {
      await Promise.all([saveDirect(p, 'LI04', 71, { by: '사용자A' }), saveDirect(q, 'LI06', 72, { by: '사용자B' })]);
      await until(async () => { const d = await db(); return d.perfMonthly['LI04_' + MONTH] && d.perfMonthly['LI06_' + MONTH] && d.perfMonthly['LI04_' + MONTH].direct === 71 && d.perfMonthly['LI06_' + MONTH].direct === 72; });
    });
    await t('같은 항목 저장 충돌: 경고 후 취소하면 상대 값 유지', async () => {
      await until(async () => /71\s*%/.test(await leadCardText(q, 'LI04')) && /72\s*%/.test(await leadCardText(p, 'LI06')));
      await openModal(q, 'lead', 'LI04', 'input');
      await q.fill('[data-pf="direct"]', '11'); await q.fill('#pfActor', '사용자B');
      await saveDirect(p, 'LI04', 55, { by: '사용자A' });
      await until(async () => (await db()).perfMonthly['LI04_' + MONTH].direct === 55);
      await new Promise(r => setTimeout(r, 2600)); // 폴링으로 q에 도착
      assert.equal(await q.inputValue('[data-pf="direct"]'), '11', '입력 중 값이 사라짐');
      q.dialogs.length = 0; q.dialogAnswer = false;
      await q.click('#pfSaveRec');
      assert.ok(/사용자A님이/.test(q.dialogs[0] || ''), '충돌 경고 없음');
      await new Promise(r => setTimeout(r, 700));
      assert.equal((await db()).perfMonthly['LI04_' + MONTH].direct, 55);
    });
    await t('같은 항목 저장 충돌: 확인하면 덮어쓰고 이력에 양쪽 값 남음', async () => {
      q.dialogAnswer = true;
      await q.click('#pfSaveRec');
      await until(async () => (await db()).perfMonthly['LI04_' + MONTH].direct === 11);
      await q.click('#pfClose');
      const d = await db();
      const h = Object.values(d.perfHistory).filter(x => x.ref === 'LI04' && (x.changes || []).some(c => c.from === '55' && c.to === '11'));
      assert.equal(h.length, 1);
      assert.equal(h[0].by, '사용자B');
    });
    await q.context().close();

    /* 구버전 화면 */
    await t('구버전 화면이 열려 있어도 새 데이터가 지워지지 않음', async () => {
      const before = await db();
      const o = await newPage(browser);
      o.on('console', () => {});
      await o.goto(BASE + '/old/#admin');
      await o.waitForFunction(() => document.querySelector('#view .wrap'));
      // 구버전은 기존 항목 수정이 저장되지 않으므로, 전체가 교체되는 JSON 가져오기로 쓰기를 일으킨다
      const f = path.join(outDir, 'old-import.json');
      const conv = { meta: baseline.meta, members: Object.values(baseline.members), kpis: Object.values(baseline.kpis), programs: Object.values(baseline.programs), projects: Object.values(baseline.projects), routines: baseline.routines, workKpis: Object.values(baseline.workKpis).map(w => w.id === 'W1' ? Object.assign({}, w, { target: 41 }) : w), automations: Object.values(baseline.automations), links: Object.values(baseline.links), personal: baseline.personal, bid: baseline.bid };
      fs.writeFileSync(f, JSON.stringify(conv));
      await o.setInputFiles('#fileImp', f);
      const after = await until(async () => { const d = await db(); return d.workKpis.W1.target === 41 ? d : false; });
      ['mainKpis', 'leadDefs', 'lagDefs', 'perfMonthly', 'perfHistory'].forEach(k => assert.deepStrictEqual(after[k], before[k], k));
      fs.unlinkSync(f);
      console.log('  참고: 구버전 저장 후 업무 KPI 항목 수 ' + Object.keys(baseline.workKpis).length + ' → ' + Object.keys(after.workKpis).length + ' (구버전 결함)');
      await o.context().close();
      await fetch(BASE + '/__rtdb/shared/b2bOpsTracker.json', { method: 'PATCH', body: JSON.stringify({ workKpis: baseline.workKpis }) });
      await p.reload(); await p.waitForFunction(() => document.querySelector('#view .wrap'));
    });

    await t('한 항목을 저장해도 같은 컬렉션의 다른 항목이 지워지지 않음', async () => {
      const before = await db();
      await open(p, 'admin');
      await p.fill('[data-wk="1"]', '71');
      const d = await until(async () => { const x = await db(); return x.workKpis.W2.target === 71 ? x : false; });
      assert.equal(Object.keys(d.workKpis).length, Object.keys(before.workKpis).length);
      assert.deepStrictEqual(Object.keys(d.mainKpis), ['MK1', 'MK2', 'MK3']);
      await p.fill('[data-wk="1"]', String(baseline.workKpis.W2.target));
      await until(async () => (await db()).workKpis.W2.target === baseline.workKpis.W2.target);
    });
    await t('이전 버전이 남긴 묶음 형태의 대기 변경도 안전하게 적용', async () => {
      const before = await db();
      await p.evaluate(() => localStorage.setItem('netform.b2b.tracker.pending.v1', JSON.stringify({ workKpis: { W3: { calc: 'todo', d: 'x', dir: 'down', id: 'W3', n: '미착수 비율', target: 16, unit: '%' } } })));
      await p.reload(); await p.waitForFunction(() => document.querySelector('#view .wrap'));
      const d = await until(async () => { const x = await db(); return x.workKpis.W3.target === 16 ? x : false; });
      assert.equal(Object.keys(d.workKpis).length, Object.keys(before.workKpis).length);
      await fetch(BASE + '/__rtdb/shared/b2bOpsTracker.json', { method: 'PATCH', body: JSON.stringify({ 'workKpis/W3': baseline.workKpis.W3 }) });
      await p.reload(); await p.waitForFunction(() => document.querySelector('#view .wrap'));
    });
    await t('기존 항목 수정도 서버에 저장됨 (업무 KPI 목표)', async () => {
      await open(p, 'admin');
      await p.fill('[data-wk="0"]', '40');
      const d = await until(async () => { const x = await db(); return x.workKpis.W1.target === 40 ? x : false; });
      assert.equal(d.workKpis.W1.target, 40);
      await p.fill('[data-wk="0"]', '42');
      await until(async () => (await db()).workKpis.W1.target === 42);
      await p.reload(); await p.waitForFunction(() => document.querySelector('#view .wrap'));
      assert.equal(await p.inputValue('[data-wk="0"]'), '42');
      await p.fill('[data-wk="0"]', String(baseline.workKpis.W1.target));
      await until(async () => (await db()).workKpis.W1.target === baseline.workKpis.W1.target);
    });

    /* 복구 기능 */
    await t('JSON 내보내기에 새 데이터 포함', async () => {
      await open(p, 'admin');
      const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#btnExp')]);
      const o = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
      assert.ok(o.perfMonthly.length > 5 && o.leadDefs.length === 9);
      assert.ok(o.kpis && o.projects && o.routines);
    });
    await t('옛 백업 JSON을 가져와도 월별 실적·이력 유지', async () => {
      const before = await db();
      const f = path.join(outDir, 'old-backup.json');
      const old = { meta: baseline.meta, members: Object.values(baseline.members), kpis: Object.values(baseline.kpis), programs: Object.values(baseline.programs), projects: Object.values(baseline.projects), routines: baseline.routines, workKpis: Object.values(baseline.workKpis), automations: Object.values(baseline.automations), links: Object.values(baseline.links), personal: baseline.personal, bid: baseline.bid };
      fs.writeFileSync(f, JSON.stringify(old));
      await p.setInputFiles('#fileImp', f);
      await new Promise(r => setTimeout(r, 900));
      const d = await db();
      assert.deepStrictEqual(d.perfMonthly, before.perfMonthly);
      assert.deepStrictEqual(d.perfHistory, before.perfHistory);
      fs.unlinkSync(f);
    });
    await t('값 비우기·기준선 되돌리기에도 월별 실적·이력 유지', async () => {
      const before = await db();
      p.dialogAnswer = true;
      await p.click('#btnWipe'); await new Promise(r => setTimeout(r, 800));
      await open(p, 'admin');
      await p.click('#btnSeed'); await new Promise(r => setTimeout(r, 800));
      const d = await db();
      assert.deepStrictEqual(d.perfMonthly, before.perfMonthly);
      assert.deepStrictEqual(d.perfHistory, before.perfHistory);
      assert.deepStrictEqual(d.mainKpis, before.mainKpis);
      await reset();
    });
    await t('미응답 판정 기간·재발송 주기 설정 저장', async () => {
      await open(p, 'admin');
      await p.fill('[data-pf-cfg="noReplyDays"]', '7'); await p.dispatchEvent('[data-pf-cfg="noReplyDays"]', 'change');
      await p.fill('[data-pf-cfg="resendDays"]', '3'); await p.dispatchEvent('[data-pf-cfg="resendDays"]', 'change');
      const d = await until(async () => { const x = await db(); return x.perfConfig && x.perfConfig.resendDays === 3 ? x : false; });
      assert.equal(d.perfConfig.noReplyDays, 7);
      await reset();
    });

    /* 기존 화면 */
    await t('기존 메뉴 7개 전부 정상 표시 · 팀 업무 현황 탭 유지', async () => {
      await p.goto(BASE + '/#tasks'); await p.reload(); await p.waitForFunction(() => document.querySelector('#view .wrap'));
      await p.click('[data-tt="work"]');
      assert.ok(/팀 업무 현황/.test(await p.locator('.phead h1').innerText()));
      assert.ok(await p.locator('.filters').count());
      for (const id of ['programs', 'metrics', 'auto', 'map', 'hub', 'admin', 'tasks']) {
        await p.click(`[data-go="${id}"]`);
        await p.waitForTimeout(150);
        assert.ok((await p.locator('#view .wrap').innerText()).length > 50, id);
      }
      assert.ok(/팀 업무 현황/.test(await p.locator('.phead h1').innerText()), '탭 기억');
      await p.click('[data-tt="kpi"]');
    });

    /* 모바일 */
    for (const [w, h] of [[360, 740], [390, 844]]) {
      const m = await newPage(browser, { viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      const over = () => m.evaluate(() => {
        const vw = document.documentElement.clientWidth, bad = [];
        document.querySelectorAll('#view *, #pfModal *').forEach(e => {
          const r = e.getBoundingClientRect();
          if (r.width && r.right > vw + 1 && !e.closest('.tabs,.pf-vw,.tblwrap') && getComputedStyle(e).position !== 'fixed') bad.push(e.className || e.tagName);
        });
        return { scroll: document.documentElement.scrollWidth - vw, bad: bad.slice(0, 5) };
      });
      await t(`모바일 ${w}px: KPI 화면 가로 넘침 없음`, async () => {
        await open(m);
        const o = await over(); assert.ok(o.scroll <= 0 && !o.bad.length, JSON.stringify(o));
        await m.screenshot({ path: path.join(outDir, `02_모바일${w}_KPI.png`), fullPage: true });
      });
      await t(`모바일 ${w}px: 상세·가중치 창 넘침 없음 · 터치 영역 36px 이상`, async () => {
        await m.tap('[data-pf-open="lead"][data-id="LI01"][data-v="input"]');
        await m.waitForSelector('#pfModal.on');
        let o = await over(); assert.ok(!o.bad.length, JSON.stringify(o));
        const small = await m.evaluate(() => [...document.querySelectorAll('#pfModal button, #pfModal input:not([type=checkbox]):not([type=radio]), #pfModal select')].filter(e => e.offsetHeight && e.offsetHeight < 36).map(e => e.id || e.className));
        assert.deepStrictEqual(small, []);
        await m.screenshot({ path: path.join(outDir, `03_모바일${w}_상세.png`) });
        await m.tap('#pfClose');
        await m.tap('[data-pf-open="kpi"][data-id="MK1"][data-v="links"]');
        o = await over(); assert.ok(!o.bad.length, JSON.stringify(o));
        await m.screenshot({ path: path.join(outDir, `04_모바일${w}_가중치.png`) });
        await m.tap('#pfClose');
        const cardBtn = await m.evaluate(() => Math.min(...[...document.querySelectorAll('.pf-acts .mini')].map(e => e.offsetHeight)));
        assert.ok(cardBtn >= 36, '카드 버튼 ' + cardBtn);
      });
      await t(`모바일 ${w}px: 팀 업무 현황 탭 유지`, async () => {
        await m.tap('[data-tt="work"]');
        assert.ok(/팀 업무 현황/.test(await m.locator('.phead h1').innerText()));
      });
      await m.context().close();
    }

    await t('화면 오류 없음', async () => assert.deepStrictEqual(consoleErrors, []));
    await t('운영 Firebase 요청 0건', async () => assert.deepStrictEqual(prodRequests, []));
  } finally {
    await browser.close();
    server.kill();
  }
  fs.writeFileSync(path.join(outDir, 'e2e-결과.txt'), results.join('\n') + `\n\n${pass} / ${results.length} 성공\n`);
  console.log(`\n${pass} / ${results.length} 성공`);
})().catch(e => { console.error(e); process.exit(1); });
