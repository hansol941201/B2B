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
// 멤버는 신한솔 카드 표시를 위해 추가될 수 있다. 기존 멤버와 나머지 키는 그대로여야 한다
function sameOld(d) {
  OLD_KEYS.forEach(k => {
    if (k !== 'members') return assert.deepStrictEqual(d[k], baseline[k], k + ' 변경됨');
    Object.keys(baseline.members).forEach(id => assert.deepStrictEqual(d.members[id], baseline.members[id], '멤버 ' + id + ' 변경됨'));
  });
}

async function newPage(browser, opts, fresh) {
  const ctx = await browser.newContext(opts || { viewport: { width: 1320, height: 900 } });
  // 시험은 신한솔 개인 지표 탭에서 시작한다. 처음 접속 기본 탭은 별도 시험에서 확인.
  if (!fresh) await ctx.addInitScript(() => { if (!localStorage.getItem('netform.b2b.tracker.tasktab.v1')) localStorage.setItem('netform.b2b.tracker.tasktab.v1', 'kpi:shs'); });
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
async function tab(p, tt) {
  if (!await p.locator(`[data-tt="${tt}"][aria-pressed="true"]`).count()) await p.click(`[data-tt="${tt}"]`);
}
function tabFor(type, id, view) {
  if (type === 'kpi') return view === 'weights' ? 'kpi:shs' : 'work';
  return id.indexOf('LX') === 0 ? 'kpi:m1' : 'kpi:shs';
}
async function openModal(p, type, id, view) {
  await tab(p, tabFor(type, id, view));
  await p.click(`[data-pf-open="${type}"][data-id="${id}"][data-v="${view}"]`);
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
  await openModal(p, 'kpi', kid, 'weights');
  for (const li of Object.keys(w)) await p.fill(`[data-pf-w="${li}"]`, w[li] == null ? '' : String(w[li]));
  await p.fill('#pfActor', '시험자');
  await p.click('#pfSaveW');
  await p.click('#pfClose');
}
async function setMemberWeights(p, kid, w) {
  await openModal(p, 'kpi', kid, 'links');
  for (const mid of Object.keys(w)) await p.fill(`[data-pf-mw="${mid}"]`, String(w[mid]));
  await p.fill('#pfActor', '시험자');
  await p.click('#pfSaveMW');
  await p.click('#pfClose');
}
const kpiCardText = async (p, kid) => { await tab(p, 'work'); return p.locator(`article.k:has([data-id="${kid}"])`).innerText(); };
const personalText = async (p, kid) => { await tab(p, 'kpi:shs'); return p.locator(`article.ms:has([data-id="${kid}"])`).innerText(); };
const leadCardText = async (p, id) => { await tab(p, 'kpi:shs'); return p.locator(`article:has([data-pf-open="lead"][data-id="${id}"][data-v="edit"])`).innerText(); };
const lagCardText = async (p, id) => { await tab(p, 'kpi:shs'); return p.locator(`article:has([data-pf-open="lag"][data-id="${id}"][data-v="edit"])`).innerText(); };
const boardCard = mid => `.bcol:has([data-pf-card="${mid}"])`;
async function openCard(p, mid) {
  await tab(p, 'work');
  const b = p.locator(`[data-pf-card="${mid}"]`);
  if ((await b.getAttribute('aria-expanded')) !== 'true') await b.click();
}
async function openRow(p, id) {
  const b = p.locator(`[data-pfb-acc="${id}"]`);
  if ((await b.getAttribute('aria-expanded')) !== 'true') await b.click();
}
const rowText = (p, id) => p.locator(`[data-pfb-acc="${id}"]`).innerText();
const reload = async p => { await p.reload(); await p.waitForFunction(() => document.querySelector('#view .wrap')); };
const API = BASE + '/__rtdb/shared/b2bOpsTracker.json';
const patchDb = o => fetch(API, { method: 'PATCH', body: JSON.stringify(o) });
const until = async (fn, ms) => { const end = Date.now() + (ms || 8000); let e; while (Date.now() < end) { try { const r = await fn(); if (r !== false) return r; } catch (x) { e = x; } await new Promise(r => setTimeout(r, 150)); } throw e || new Error('시간 초과'); };

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, 'mock-server.cjs'), String(PORT), baselineFile, oldHtml], { stdio: 'inherit' });
  await new Promise(r => setTimeout(r, 600));
  const browser = await chromium.launch(process.env.E2E_CHROME ? { executablePath: process.env.E2E_CHROME } : {});
  const p = await newPage(browser);
  try {
    // 로컬 호환 서버는 연결이 끊기면 다른 연결의 쓰기를 놓칠 수 있어, 다른 화면을 열기 전에 시험한다
    await t('처음 접속하면 팀 업무 현황과 공통 KPI가 먼저 보이고 개인 지표는 신한솔 탭에 있음', async () => {
      const f = await newPage(browser, null, true);
      await open(f);
      assert.ok(/팀 업무 현황/.test(await f.locator('.phead h1').innerText()));
      assert.equal(await f.locator('article.k').count(), 3);
      assert.ok(/B2B팀 공통 KPI/.test(await f.locator('#view .wrap').innerText()));
      await f.click('[data-tt="kpi:shs"]');
      assert.ok(/신한솔 개인 지표/.test(await f.locator('.phead h1').innerText()));
      assert.equal(await f.locator('article.k').count(), 0, '개인 화면에 팀 KPI 카드 없음');
      await f.reload(); await f.waitForFunction(() => document.querySelector('#view .wrap'));
      assert.ok(/신한솔 개인 지표/.test(await f.locator('.phead h1').innerText()), '선택한 탭 기억');
      await f.context().close();
    });
    await t('처음 열어도 저장 없음 — 기존 데이터 그대로', async () => {
      await open(p); await new Promise(r => setTimeout(r, 1500));
      assert.deepStrictEqual(await db(), baseline);
    });
    await t('개인 선행·후행지표 14개 담당자가 신한솔', async () => {
      const txt = await p.locator('#view .wrap').innerText();
      assert.equal((txt.match(/담당 신한솔/g) || []).length, 14);
    });
    await t('팀 공통 KPI 3 · 개인 선행 9 · 개인 후행 5 표시', async () => {
      assert.equal(await p.locator('[data-pf-open="lead"][data-v="edit"]').count(), 9);
      assert.equal(await p.locator('[data-pf-open="lag"][data-v="edit"]').count(), 5);
      assert.equal(await p.locator('article.support').count(), 2);
      assert.equal(await p.locator('article.ms').count(), 3);
      await p.screenshot({ path: path.join(outDir, '01_초기_개인지표.png'), fullPage: true });
      await tab(p, 'work');
      assert.equal(await p.locator('article.k').count(), 3);
      const txt = await p.locator('article.k').first().innerText();
      assert.ok(/팀 전체 실제 달성률/.test(txt) && /팀 선행활동 점수/.test(txt), txt);
      await p.screenshot({ path: path.join(outDir, '01_초기_팀업무현황.png'), fullPage: true });
    });
    await t('팀원 카드는 접힌 상태로 시작하고 요약을 보여 줌', async () => {
      await tab(p, 'work');
      assert.equal(await p.locator(boardCard('shs') + ' .pfb-row').count(), 0, '처음엔 접힘');
      const sum = await p.locator(boardCard('shs') + ' .pf-card-sum').innerText();
      assert.ok(/지표 세부업무 진행률/.test(sum) && /선행 달성률 평균/.test(sum) && /후행 실적/.test(sum), sum);
      assert.equal(await p.locator(boardCard('m1') + ' .pf-card-sum').count(), 0, '지표 없는 팀원은 지표 요약 없음');
    });
    await t('담당자 카드: 신한솔은 기존 업무 유지 + 지표 14개, 다른 팀원은 추후 등록 안내', async () => {
      await openCard(p, 'shs');
      const shs = await p.locator(boardCard('shs')).innerText();
      assert.ok(/공사실적정리/.test(shs), '기존 루틴');
      assert.equal(await p.locator(boardCard('shs') + ' .pfb-row').count(), 14);
      assert.ok(/개인 선행지표 9개/.test(shs) && /개인 후행지표 5개/.test(shs), shs);
      assert.ok(/목표/.test(shs) && /실적/.test(shs) && /미측정/.test(shs));
      assert.ok(/담당 업체·현장 기준/.test(shs), '후행지표 집계 범위 표시');
      await openCard(p, 'm1');
      assert.equal(await p.locator(boardCard('m1') + ' .pfb-row').count(), 0);
      assert.ok(/추후 별도 등록/.test(await p.locator(boardCard('m1')).innerText()));
      await p.reload(); await p.waitForFunction(() => document.querySelector('#view .wrap'));
      assert.equal(await p.locator('[data-pf-card="shs"]').getAttribute('aria-expanded'), 'true', '펼침 기억');
    });
    await t('팀원 필터: 고른 팀원 카드만 펼쳐서 표시', async () => {
      await tab(p, 'work');
      await p.click('[data-pf-member="m1"]');
      assert.equal(await p.locator('.bcol').count(), 1);
      assert.equal(await p.locator(boardCard('m1')).count(), 1);
      await p.click('[data-pf-member="shs"]');
      assert.equal(await p.locator('.bcol').count(), 1);
      assert.equal(await p.locator(boardCard('shs') + ' .pfb-row').count(), 14);
      await p.click('[data-pf-member="all"]');
      assert.equal(await p.locator('.bcol').count(), 2);
    });
    await t('갱신 날짜가 없는 기존 프로젝트는 정체로 단정하지 않음', async () => {
      await tab(p, 'work');
      const s = await p.locator('details.disc summary').first().innerText();
      assert.ok(/진행이 더딘 업무 0건/.test(s) && /갱신 기록 없는 프로젝트 1건/.test(s), s);
      assert.deepStrictEqual(await db(), baseline, '보기만으로 저장되면 안 됨');
    });
    await t('회귀 방지: 기존 개인 성과 줄 배치가 유지됨', async () => {
      await p.click('[data-perf="shs"]');
      const cols = await p.evaluate(() => getComputedStyle(document.querySelector('.pf-body.on .pf-row')).gridTemplateColumns.split(' ').length);
      assert.equal(cols, 4);
      await p.click('[data-perf="shs"]');
    });
    await t('초기 상태: 실적 미측정 · 점수 산출 대기 (0으로 표시 안 함)', async () => {
      const txt = await kpiCardText(p, 'MK1');
      assert.ok(/미측정/.test(txt) && /미확정/.test(txt) && /팀원 반영 가중치 미설정 1명/.test(txt), txt);
      assert.ok(!/\b0%/.test(txt), txt);
      assert.ok(/수동 관리/.test(txt), '수동 관리 표시 없음');
      assert.ok(/가중치 미설정 5개/.test(await personalText(p, 'MK1')));
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
    await t('가중치 일부만 설정 → 개인 점수 산출 대기', async () => {
      await setWeights(p, 'MK1', { LI01: 30, LI02: 30 });
      const txt = await personalText(p, 'MK1');
      assert.ok(/산출 대기/.test(txt) && /가중치 미설정 3개/.test(txt), txt);
    });
    await t('가중치 합계 90% → 경고 · 산출 대기', async () => {
      await setWeights(p, 'MK1', { LI01: 30, LI02: 30, LI03: 30, LI04: 0, LI06: 0 });
      assert.ok(/가중치 합계 90%/.test(await personalText(p, 'MK1')));
      await openModal(p, 'kpi', 'MK1', 'weights');
      assert.ok(/100%가 되어야/.test(await p.locator('#pfScoreLine').innerText()));
      await p.click('#pfClose');
    });
    await t('입력 중 가중치 미리 계산', async () => {
      await openModal(p, 'kpi', 'MK1', 'weights');
      await p.fill('[data-pf-w="LI03"]', '40');
      assert.ok(/합계 100%/.test(await p.locator('#pfScoreLine').innerText()));
      await p.fill('#pfActor', '시험자'); await p.click('#pfSaveW'); await p.click('#pfClose');
    });
    await t('미측정 지표가 남아 있으면 산출 대기 (0 대체 없음)', async () => {
      const txt = await personalText(p, 'MK1');
      assert.ok(/산출 대기/.test(txt) && /미측정 지표 1개/.test(txt), txt);
    });
    await t('개인 점수 78% — 팀원 가중치를 정하기 전에는 팀 점수로 쓰지 않음', async () => {
      await saveDirect(p, 'LI01', 100); await saveDirect(p, 'LI02', 80); await saveDirect(p, 'LI03', 60);
      assert.ok(/78\s*%/.test(await personalText(p, 'MK1')));
      const team = await kpiCardText(p, 'MK1');
      assert.ok(/미확정/.test(team) && /팀원 반영 가중치 미설정 1명/.test(team) && /신한솔 개인 점수 78% \(참고\)/.test(team), team);
      assert.ok(!/\d/.test(await p.locator('article.k:has([data-id="MK1"]) .pf-v').nth(1).locator('.n').innerText()), '팀 점수 칸에 숫자 없음');
      const saved = await db();
      Object.values(saved.mainKpis).forEach(k => assert.equal(k.memberWeights, undefined, k.id + ' 저장으로 팀원 가중치가 생기면 안 됨'));
    });
    await t('팀원 가중치 합계 검사 → 설정 후 팀 점수 계산', async () => {
      await setMemberWeights(p, 'MK1', { shs: 80 });
      assert.ok(/합계 80%/.test(await kpiCardText(p, 'MK1')));
      await setMemberWeights(p, 'MK1', { shs: 100 });
      const team = await kpiCardText(p, 'MK1');
      assert.ok(/78\s*%/.test(team) && /신한솔 100%/.test(team), team);
    });
    await t('개인 달성률 변경이 팀 점수에 자동 반영 — 상승 (80→100 = 84%)', async () => {
      await saveDirect(p, 'LI02', 100);
      assert.ok(/84\s*%/.test(await kpiCardText(p, 'MK1')));
      assert.ok(/84\s*%/.test(await personalText(p, 'MK1')));
    });
    await t('개인 달성률 변경이 팀 점수에 자동 반영 — 하락 (100→50 = 69%)', async () => {
      await saveDirect(p, 'LI02', 50);
      assert.ok(/69\s*%/.test(await kpiCardText(p, 'MK1')));
      await saveDirect(p, 'LI02', 80);
    });
    await t('분모 0 → 대상 없음 · 남은 가중치로 비례 재배분', async () => {
      await saveAuto(p, 'lead', 'LI02', null, 0);
      assert.ok(/대상 없음/.test(await leadCardText(p, 'LI02')));
      const txt = await personalText(p, 'MK1');
      assert.ok(/대상 없음 1개 제외/.test(txt), txt); // (100*30+60*40)/70 = 77.1
      assert.ok(/77\.1\s*%/.test(txt), txt);
      assert.ok(/77\.1\s*%/.test(await kpiCardText(p, 'MK1')));
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
    await t('KPI ③ 현장·시공사 단위 별도 저장', async () => {
      await openModal(p, 'kpi', 'MK3', 'input');
      await p.fill('[data-pf="den"]', '100'); await p.fill('[data-pf="num"]', '25');
      await p.fill('[data-pf="u.site.den"]', '80'); await p.fill('[data-pf="u.site.num"]', '20');
      await p.fill('[data-pf="u.contractor.den"]', '40'); await p.fill('[data-pf="u.contractor.num"]', '12');
      await p.fill('#pfActor', '시험자'); await p.click('#pfSaveRec'); await p.click('#pfClose');
      const r = (await db()).perfMonthly['MK3_' + MONTH];
      assert.equal(r.units.site.num, 20); assert.equal(r.units.contractor.den, 40);
    });
    await t('개인 후행지표와 팀 KPI 실적은 서로 섞이지 않음', async () => {
      const lag = await lagCardText(p, 'LG3');
      assert.ok(/미측정/.test(lag) && !/25\s*%/.test(lag), '팀 KPI 값이 개인 후행지표에 나타남: ' + lag);
      const before = (await db()).perfMonthly['MK3_' + MONTH];
      await saveAuto(p, 'lag', 'LG3', 3, 10);
      const lg3 = await lagCardText(p, 'LG3');
      assert.ok(/30\s*%/.test(lg3) && /집계 범위 신한솔 담당 업체·현장/.test(lg3), lg3);
      const team = await kpiCardText(p, 'MK3');
      assert.ok(/25\s*%/.test(team) && /25 ÷ 100/.test(team), team);
      const d = await until(async () => { const x = await db(); return x.perfMonthly['LG3_' + MONTH] ? x : false; });
      assert.deepStrictEqual(d.perfMonthly['MK3_' + MONTH], before);
      assert.equal(d.perfMonthly['LG3_' + MONTH].num, 3);
    });
    await t('담당자 카드와 개인 화면 자동 동기화 (양방향)', async () => {
      await openCard(p, 'shs');
      await openRow(p, 'LI06');
      await p.click(boardCard('shs') + ' [data-pf-open="lead"][data-id="LI06"]');
      await p.waitForSelector('#pfModal.on');
      await p.check('input[name=pfmode][value=direct]');
      await p.fill('[data-pf="direct"]', '33'); await p.fill('#pfActor', '시험자');
      await p.click('#pfSaveRec'); await p.click('#pfClose');
      assert.ok(/33\s*%/.test(await rowText(p, 'LI06')));
      assert.ok(/33\s*%/.test(await leadCardText(p, 'LI06')));
      await saveDirect(p, 'LI06', 44);
      await tab(p, 'work');
      assert.ok(/44\s*%/.test(await rowText(p, 'LI06')));
    });
    await t('후행지표 직접 실적 · 목표 대비 미달 목록', async () => {
      await saveAuto(p, 'lag', 'LG4', 1, 4);
      await openModal(p, 'lag', 'LG4', 'edit');
      await p.fill('[data-pf-def-num="target"]', '50'); await p.fill('#pfActor', '시험자');
      await p.click('#pfSaveDef'); await p.click('#pfClose');
      await tab(p, 'kpi:shs');
      assert.ok(/장기 미활동 업체 재활성화율 25%/.test(await p.locator('.note').last().innerText()));
    });
    await t('담당자·목표 수정 · 변경 이력과 세부업무 체크·메모', async () => {
      await openModal(p, 'lead', 'LI05', 'edit');
      await p.fill('[data-pf-def="owner"]', '담당자A'); await p.fill('[data-pf-def-num="target"]', '95'); await p.fill('#pfActor', '시험자');
      await p.click('#pfSaveDef');
      await p.click('[data-pf-view="input"]');
      await p.click('[data-sub-cycle="LI05"][data-i="0"]');
      await p.click('[data-sub-cycle="LI05"][data-i="0"]');
      await p.click('[data-sub-cycle="LI05"][data-i="1"]');
      await p.fill('#pfNote', 'B2B001 점검 완료');
      await p.click('#pfSaveRec');
      const body = await p.locator('#pfModal').innerText();
      assert.ok(/담당자 신한솔 → 담당자A/.test(body) && /목표 달성률 미설정 → 95%/.test(body), '정의 변경 이력');
      assert.ok(/메모: B2B001 점검 완료/.test(body) && /완료 1 \/ 11/.test(body), '작업 이력');
      assert.ok(/\s50% → 100%|50% → 100%/.test(body), '세부업무 변경 이력');
      await p.click('#pfClose');
      assert.ok(/담당자A/.test(await leadCardText(p, 'LI05')));
    });
    await tab(p, 'kpi:shs');
    await p.screenshot({ path: path.join(outDir, '05_입력후_개인지표.png'), fullPage: true });
    await tab(p, 'work');
    await p.screenshot({ path: path.join(outDir, '05_입력후_팀업무현황.png'), fullPage: true });
    await t('새로고침 후 데이터 유지', async () => {
      await p.reload(); await p.waitForFunction(() => document.querySelector('#view .wrap'));
      const txt = await kpiCardText(p, 'MK1');
      assert.ok(/78\s*%/.test(txt) && /33\.3\s*%/.test(txt), txt);
      assert.ok(/담당자A/.test(await leadCardText(p, 'LI05')));
    });
    await t('기존 멤버·업무·프로젝트 유지, 신한솔 멤버만 추가', async () => {
      const d = await db();
      assert.deepStrictEqual(Object.keys(d.members).sort(), ['m1', 'shs']);
      assert.equal(d.members.shs.name, '신한솔');
      assert.deepStrictEqual(d.projects, baseline.projects);
      assert.deepStrictEqual(d.routines, baseline.routines);
    });
    await t('기존 데이터 유지 — 기존 키 전부 원본과 동일', async () => { sameOld(await until(async () => { const d = await db(); return d.perfHistory ? d : false; })); });
    await t('원본과 수동 입력 구분: 이력 보관·ID 부여', async () => {
      const d = await db();
      assert.ok(Object.keys(d.perfHistory).length >= 10);
      assert.ok(d.perfMonthly['LI01_' + MONTH].updatedBy === '시험자');
      assert.equal(Object.keys(d.leadDefs).length, 9);
      assert.deepStrictEqual(Object.keys(d.mainKpis), ['MK1', 'MK2', 'MK3']);
      Object.values(d.leadDefs).concat(Object.values(d.lagDefs)).forEach(x => assert.equal(x.member, 'shs', x.id));
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
      console.log('  참고: 구버전 저장 후 업무 KPI ' + Object.keys(baseline.workKpis).length + ' → ' + Object.keys(after.workKpis).length + '개, 멤버 ' + Object.keys(before.members).length + ' → ' + Object.keys(after.members || {}).length + '명 (구버전 결함)');
      await o.context().close();
      await fetch(BASE + '/__rtdb/shared/b2bOpsTracker.json', { method: 'PATCH', body: JSON.stringify({ workKpis: baseline.workKpis, members: before.members }) }); // 구버전 저장이 지운 컬렉션 복원
      await p.reload(); await p.waitForFunction(() => document.querySelector('#view .wrap'));
    });

    /* 1·2단계 */
    await t('세부업무 ○ ▶ ✓ 순환 · 업무 진행률 평균 자동 · 달성률은 미측정 유지', async () => {
      await reload(p); await openCard(p, 'shs'); await openRow(p, 'LI09');
      const key = 'LI09_' + MONTH, sub = '[data-sub-cycle="LI09"][data-i="0"]';
      const txt0 = await p.locator(sub).innerText(); assert.equal(txt0, '○');
      await p.click(sub); assert.equal(await p.locator(sub).innerText(), '▶');
      await until(async () => { const d = await db(); return d.perfMonthly[key] && d.perfMonthly[key].prog.t1 === 50; });
      await p.click(sub); assert.equal(await p.locator(sub).innerText(), '✓');
      await p.click(sub); assert.equal(await p.locator(sub).innerText(), '○');
      await p.click(sub); await p.click(sub);
      const row = await rowText(p, 'LI09');
      assert.ok(/미측정/.test(row) && /업무 진행률 8%/.test(row), row);
      const r = await until(async () => { const d = await db(); return d.perfMonthly[key].prog.t1 === 100 ? d.perfMonthly[key] : false; });
      assert.equal(r.den, undefined, '세부업무로 분모가 생기면 안 됨');
      assert.equal(r.direct, undefined);
      assert.ok(/78\s*%/.test(await personalText(p, 'MK1')), '개인 점수 불변');
    });
    await t('세부업무 진행률 직접 입력 · 범위 제한 · 평균 재계산', async () => {
      await openCard(p, 'shs'); await openRow(p, 'LI09');
      await p.fill('#pfs-b-LI09-1', '40'); await p.press('#pfs-b-LI09-1', 'Tab');
      assert.ok(/업무 진행률 12%/.test(await rowText(p, 'LI09')), await rowText(p, 'LI09')); // (100+40)/12
      await p.fill('#pfs-b-LI09-1', '150'); await p.press('#pfs-b-LI09-1', 'Tab');
      assert.equal(await p.inputValue('#pfs-b-LI09-1'), '100');
      assert.ok(/업무 진행률 17%/.test(await rowText(p, 'LI09')), await rowText(p, 'LI09'));
      assert.ok(/미측정/.test(await rowText(p, 'LI09')));
    });
    await t('달성률 입력값이 있으면 세부업무를 바꿔도 달성률·KPI 점수 불변', async () => {
      await openRow(p, 'LI01');
      const before = (await db()).perfMonthly['LI01_' + MONTH];
      assert.ok(/100%/.test(await rowText(p, 'LI01')));
      await p.click('[data-sub-cycle="LI01"][data-i="2"]');
      const row = await rowText(p, 'LI01');
      assert.ok(/업무 진행률 6%/.test(row), row);
      assert.ok(/^[\s\S]*100%/.test(row), row);
      const after = await until(async () => { const x = (await db()).perfMonthly['LI01_' + MONTH]; return x.prog ? x : false; });
      assert.equal(after.direct, before.direct);
      assert.equal(after.mode, before.mode);
      assert.ok(/78\s*%/.test(await personalText(p, 'MK1')));
      assert.ok(/33\.3\s*%/.test(await kpiCardText(p, 'MK1')), '팀 실제 달성률 불변');
    });
    await t('세부업무 추가: 기존 진행률 유지 · 새로고침 후에도 유지 · 이력 기록', async () => {
      await openCard(p, 'shs'); await openRow(p, 'LI09');
      await p.fill('#pfs-add-b-LI09', '시험 세부업무'); await p.click('[data-sub-add="LI09"]');
      const d = await until(async () => { const x = await db(); return x.leadDefs.LI09.tasks.length === 13 ? x : false; });
      assert.equal(d.perfMonthly['LI09_' + MONTH].prog.t1, 100, '기존 진행률 유지');
      assert.ok(Object.values(d.perfHistory).some(h => h.ref === 'LI09' && h.summary === '세부업무 추가'));
      await reload(p); await openCard(p, 'shs'); await openRow(p, 'LI09');
      assert.ok(/시험 세부업무/.test(await p.locator('.pfb-acc:has(.pfb-row[data-id="LI09"])').innerText()));
      assert.ok(/업무 진행률 15%/.test(await rowText(p, 'LI09')), await rowText(p, 'LI09')); // 200/13
    });
    await t('상태 필터가 세부업무에도 적용됨', async () => {
      await openCard(p, 'shs'); await openRow(p, 'LI09');
      await p.click('[data-f="st"][data-v="done"]');
      const n = await p.locator('.pfb-acc:has(.pfb-row[data-id="LI09"]) .pfs-row').count();
      assert.equal(n, 2);
      assert.equal(await p.locator('.pfb-acc:has(.pfb-row[data-id="LI09"]) .pfs-row:not(.done)').count(), 0);
      await p.click('[data-f="st"][data-v="all"]');
    });
    await t('월별 분리: 전월 진행률은 별도 · 월별 실적 표 확인', async () => {
      await openCard(p, 'shs'); await openRow(p, 'LI09');
      await p.selectOption('#pfMonthSel', PREV);
      assert.ok(/업무 진행률 0%/.test(await rowText(p, 'LI09')), await rowText(p, 'LI09'));
      await p.selectOption('#pfMonthSel', MONTH);
      const body = await p.locator('.pfb-acc:has(.pfb-row[data-id="LI09"])').innerText();
      assert.ok(body.includes(MONTH) && /업무 진행률 15%/.test(body), body.slice(0, 300));
    });
    await t('이전 체크 표시는 완료로 읽고, 바꾸면 진행률로 넘어감', async () => {
      const r = (await db()).perfMonthly['LI05_' + MONTH];
      await patchDb({ ['perfMonthly/LI05_' + MONTH]: Object.assign({}, r, { prog: {}, checks: { t1: true, t2: true } }) });
      await reload(p); await openCard(p, 'shs'); await openRow(p, 'LI05');
      assert.ok(/업무 진행률 18%/.test(await rowText(p, 'LI05')), await rowText(p, 'LI05')); // 200/11
      assert.equal(await p.locator('[data-sub-cycle="LI05"][data-i="0"]').innerText(), '✓');
      await p.click('[data-sub-cycle="LI05"][data-i="0"]');
      const x = await until(async () => { const v = (await db()).perfMonthly['LI05_' + MONTH]; return v.prog && v.prog.t1 === 0 ? v : false; });
      assert.equal(x.checks.t2, true, '다른 체크 유지');
      assert.equal(x.checks.t1, undefined);
    });
    await t('입력 중인 상세 창에서 세부업무를 바꿔도 입력값 유지 · 저장 충돌 없음', async () => {
      await openModal(p, 'lead', 'LI07', 'input');
      await p.check('input[name=pfmode][value=auto]');
      await p.fill('[data-pf="den"]', '20'); await p.fill('[data-pf="num"]', '5'); await p.fill('#pfNote', '입력 중');
      await p.click('[data-sub-cycle="LI07"][data-i="0"]');
      assert.equal(await p.inputValue('[data-pf="den"]'), '20');
      assert.equal(await p.inputValue('#pfNote'), '입력 중');
      p.dialogs.length = 0;
      await p.click('#pfSaveRec');
      assert.deepStrictEqual(p.dialogs, [], '자기 변경을 충돌로 보면 안 됨');
      const r = await until(async () => { const x = (await db()).perfMonthly['LI07_' + MONTH]; return x.den === 20 ? x : false; });
      assert.equal(r.prog.t1, 50, '세부업무 진행률 유지'); assert.equal(r.num, 5);
      await p.click('#pfClose');
    });
    await t('입력자가 없으면 세부업무를 저장하지 않고 안내', async () => {
      await p.evaluate(() => localStorage.removeItem('netform.b2b.tracker.actor.v1'));
      await reload(p); await openCard(p, 'shs'); await openRow(p, 'LI09');
      const before = (await db()).perfMonthly['LI09_' + MONTH].rev;
      await p.click('[data-sub-cycle="LI09"][data-i="3"]');
      await new Promise(r => setTimeout(r, 500));
      assert.equal((await db()).perfMonthly['LI09_' + MONTH].rev, before);
      assert.ok(/입력자/.test(await p.locator('#toast').innerText()));
      await p.fill('#pfActorBar', '시험자'); await p.press('#pfActorBar', 'Tab');
      await p.click('[data-sub-cycle="LI09"][data-i="3"]');
      const r = await until(async () => { const x = (await db()).perfMonthly['LI09_' + MONTH]; return x.rev > before ? x : false; });
      assert.equal(r.updatedBy, '시험자');
    });
    await t('프로젝트 세부업무: 상태 변경 · 평균 자동 · 추가 · 프로젝트 추가 · 갱신일 기록', async () => {
      await openCard(p, 'shs');
      if ((await p.locator('[data-proj="SX1"]').getAttribute('aria-expanded')) !== 'true') await p.click('[data-proj="SX1"]');
      await p.click('[data-task-cycle="SX1:0"]');
      const a = await until(async () => { const d = await db(); return d.projects.SX1.tasks[0].p === 50 ? d : false; });
      assert.ok(a.projects.SX1.updatedAt, '갱신일');
      assert.equal(a.projects.SX1.name, baseline.projects.SX1.name);
      await p.click('[data-task-cycle="SX1:0"]');
      await p.fill('#pfa-task-SX1', '시험 하위업무'); await p.click('[data-task-add="SX1"]');
      await until(async () => (await db()).projects.SX1.tasks.length === 2);
      await p.click('[data-task-cycle="SX1:1"]');
      assert.ok(/75%/.test(await p.locator('[data-proj="SX1"]').innerText()), await p.locator('[data-proj="SX1"]').innerText()); // (100+50)/2
      await p.fill('#pfa-proj-shs', '시험 프로젝트'); await p.click('[data-proj-add="shs"]');
      const b = await until(async () => { const d = await db(); return Object.keys(d.projects).length === 2 ? d : false; });
      const np = Object.values(b.projects).find(x => x.id !== 'SX1');
      assert.equal(np.owner, 'shs'); assert.equal(np.name, '시험 프로젝트'); assert.ok(np.updatedAt);
    });
    await t('프로젝트 진행률은 지표에 합산되지 않음 — 연결은 표시만', async () => {
      await openCard(p, 'shs');
      const before = await rowText(p, 'LI08');
      await p.locator(boardCard('shs') + ' .myedit').click();
      await p.click('[data-pjedit="SX1"]');
      await p.check('[data-pe-lead="SX1"][value="LI08"]');
      const d = await until(async () => { const x = await db(); return x.projects.SX1.leads && x.projects.SX1.leads.LI08 ? x : false; });
      assert.ok(/연결 선행지표: /.test(await p.locator(boardCard('shs')).innerText()));
      await p.locator(boardCard('shs') + ' .myedit').click();
      await openRow(p, 'LI08');
      const acc = await p.locator('.pfb-acc:has(.pfb-row[data-id="LI08"])').innerText();
      assert.ok(/연결 프로젝트/.test(acc) && /협약서 PDF/.test(acc) && /진행률 합산 안 함/.test(acc), acc.slice(0, 200));
      assert.equal(await rowText(p, 'LI08'), before, '연결해도 지표 수치 불변');
      assert.equal(d.perfMonthly['LI08_' + MONTH], undefined, '지표 기록이 생기면 안 됨');
    });
    await t('정체 표시: 기준일 지난 프로젝트·지표만 표시, 완료·미시작 제외', async () => {
      const old = new Date(Date.now() - 10 * 86400000).toISOString(), d0 = await db();
      const others = Object.values(d0.projects).find(x => x.id !== 'SX1');
      await patchDb({ 'projects/SX1': Object.assign({}, d0.projects.SX1, { updatedAt: old }), ['projects/' + others.id]: Object.assign({}, others, { tasks: [{ t: '끝난 일', p: 100, n: '', r: '' }], updatedAt: old }), ['perfMonthly/LI09_' + MONTH]: Object.assign({}, d0.perfMonthly['LI09_' + MONTH], { updatedAt: old }) });
      await reload(p); await tab(p, 'work');
      const s = await p.locator('details.disc summary').first().innerText();
      assert.ok(/진행이 더딘 업무 2건/.test(s), s); // SX1, LI09. 완료된 프로젝트는 제외
      await p.locator('details.disc summary').first().click();
      const list = await p.locator('details.disc .body').first().innerText();
      assert.ok(/협약서 PDF/.test(list) && /10일/.test(list) && /앱 전환/.test(list), list);
      await openCard(p, 'shs');
      assert.ok(/10일 정체/.test(await p.locator('[data-proj="SX1"]').innerText()));
      assert.ok(/10일 정체/.test(await rowText(p, 'LI09')));
      await p.click('details.disc [data-pf-stale-proj="SX1"]');
      assert.equal(await p.locator('.bcol').count(), 1, '해당 팀원으로 이동');
      await p.click('[data-pf-member="all"]');
      await patchDb({ 'projects/SX1': baseline.projects.SX1, ['projects/' + others.id]: null, 'leadDefs/LI09': Object.assign({}, d0.leadDefs.LI09, { tasks: d0.leadDefs.LI09.tasks.slice(0, 12) }) });
      await reload(p);
    });
    await t('다른 팀원 개인 지표 추가 (편집 모드): 신한솔 지표·점수와 분리', async () => {
      const before = await db(), mk2 = before.mainKpis.MK2;
      await openCard(p, 'm1');
      await p.locator(boardCard('m1') + ' .myedit').click();
      await p.locator(boardCard('m1') + ' details.disc summary').click();
      await p.fill('#pfnd-name-m1', '시험 선행지표'); await p.fill('#pfnd-den-m1', '대상 건수'); await p.fill('#pfnd-num-m1', '완료 건수');
      await p.check('[data-pfnd-kpi="m1"][value="MK2"]');
      await p.click('[data-pfnd-add="m1"]');
      const d = await until(async () => { const x = await db(); return x.leadDefs.LIm11 ? x : false; });
      assert.equal(d.leadDefs.LIm11.member, 'm1');
      assert.ok(d.mainKpis.MK2.links.some(l => l.li === 'LIm11'));
      assert.deepStrictEqual(d.mainKpis.MK2.weights || {}, mk2.weights || {}, '가중치 자동 설정 금지');
      assert.equal(d.mainKpis.MK2.memberWeights, undefined, '팀원 가중치 자동 설정 금지');
      await p.locator(boardCard('m1') + ' .myedit').click();
      assert.equal(await p.locator(boardCard('m1') + ' .pfb-row').count(), 1);
      assert.equal(await p.locator(boardCard('shs') + ' .pfb-row').count(), 14);
      assert.ok(await p.locator('[data-tt="kpi:m1"]').count());
      await patchDb({ 'leadDefs/LIm11': null, 'mainKpis/MK2': mk2, 'members/m1': before.members.m1 });
      await reload(p);
    });
    await t('변경 이력·월별 기록 보존 — 위 조작 뒤에도 삭제 없음', async () => {
      const d = await db();
      assert.ok(Object.keys(d.perfHistory).length >= 30, '이력 ' + Object.keys(d.perfHistory).length);
      ['LI01', 'LI02', 'LI03'].forEach(id => { assert.ok(d.perfMonthly[id + '_' + MONTH], id); assert.ok(d.perfMonthly[id + '_' + PREV], id + ' 전월'); });
      assert.deepStrictEqual(d.projects, baseline.projects, '시험 후 프로젝트 원복');
      assert.deepStrictEqual(d.routines, baseline.routines);
      assert.deepStrictEqual(d.members.m1, baseline.members.m1, 'm1 수정 없음');
    });
    await t('다른 팀원 지표 추가: 팀 점수는 가중 종합, 신한솔 개인 점수·실적은 그대로', async () => {
      const before = await db(), mk1 = before.mainKpis.MK1;
      const personalBefore = await personalText(p, 'MK1');
      assert.ok(/78\s*%/.test(personalBefore), personalBefore);
      await patchDb({
        'leadDefs/LX01': { id: 'LX01', no: '①', name: '시험 지표', member: 'm1', owner: '팀원', cycle: '매주', rev: 0, formula: 'a ÷ b', denLabel: '대상', numLabel: '완료', measure: '시험', src: '수동 관리', linkNote: '시험' },
        'mainKpis/MK1': Object.assign({}, mk1, { links: mk1.links.concat([{ li: 'LX01', rel: 'core' }]), weights: Object.assign({}, mk1.weights, { LX01: 100 }) })
      });
      await p.reload(); await p.waitForFunction(() => document.querySelector('#view .wrap'));
      assert.ok(await p.locator('[data-tt="kpi:m1"]').count(), '다른 팀원 탭 생성');
      await saveDirect(p, 'LX01', 50);
      assert.ok(/미확정/.test(await kpiCardText(p, 'MK1')) , '새 팀원 가중치 전에는 미확정');
      await setMemberWeights(p, 'MK1', { shs: 60, m1: 40 });
      const team = await kpiCardText(p, 'MK1'); // 78×0.6 + 50×0.4 = 66.8
      assert.ok(/66\.8\s*%/.test(team) && /신한솔 60%/.test(team), team);
      assert.ok(/78\s*%/.test(await personalText(p, 'MK1')), '신한솔 개인 점수 불변');
      await openModal(p, 'kpi', 'MK1', 'weights');
      assert.equal(await p.locator('#pfmMember').count(), 1, '팀원 선택 칸');
      await p.click('#pfClose');
      await openCard(p, 'shs'); await openCard(p, 'm1');
      assert.equal(await p.locator(boardCard('shs') + ' .pfb-row').count(), 14, '신한솔 카드에 다른 팀원 지표 없음');
      assert.equal(await p.locator(boardCard('m1') + ' .pfb-row').count(), 1, '다른 팀원 카드 지표 줄: ' + (await p.locator(boardCard('m1')).innerText()).slice(0, 300));
      const d = await db();
      assert.equal(d.perfMonthly['LI01_' + MONTH].direct, before.perfMonthly['LI01_' + MONTH].direct);
      await patchDb({ 'leadDefs/LX01': null, ['perfMonthly/LX01_' + MONTH]: null, 'mainKpis/MK1': mk1 });
      await p.reload(); await p.waitForFunction(() => document.querySelector('#view .wrap'));
      assert.ok(/78\s*%/.test(await kpiCardText(p, 'MK1')));
    });
    await t('이전 구조로 저장된 지표도 값 손실 없이 표시', async () => {
      const before = await db(), lg1 = before.lagDefs.LG1, li9 = before.leadDefs.LI09;
      const oldLg1 = { id: 'LG1', no: '①', name: lg1.name, ref: 'MK1', rev: 0, measure: lg1.measure, target: 40 };
      const oldLi9 = Object.assign({}, li9); delete oldLi9.member;
      const lg2 = before.lagDefs.LG2, oldLg2 = Object.assign({}, lg2, { denLabel: '60일 관찰 완료 업체 수', numLabel: '다른 현장 재이용 업체 수' }); delete oldLg2.scope;
      await patchDb({ 'lagDefs/LG1': oldLg1, 'lagDefs/LG2': oldLg2, 'leadDefs/LI09': oldLi9 });
      await p.reload(); await p.waitForFunction(() => document.querySelector('#view .wrap'));
      assert.equal(await p.locator('[data-pf-open="lead"][data-v="edit"]').count() + await p.locator(boardCard('shs') + ' .pfb-row').count() >= 9, true);
      const txt = await lagCardText(p, 'LG1');
      assert.ok(/40%/.test(txt) && /담당 신한솔/.test(txt), txt);
      await openModal(p, 'lag', 'LG1', 'input');
      assert.equal(await p.locator('[data-pf="den"]').count(), 1);
      assert.ok(/담당 신규 MOU 체결업체 수/.test(await p.locator('#pfModal').innerText()));
      await p.click('#pfClose');
      await openModal(p, 'lag', 'LG2', 'input');
      const lg2txt = await p.locator('#pfModal').innerText();
      assert.ok(/담당 업체 중 60일 관찰 완료 업체 수/.test(lg2txt) && /신한솔 담당 업체·현장/.test(lg2txt), '이전 기준 문구가 담당 기준으로 바뀜');
      await p.click('#pfClose');
      assert.ok(/플랫폼/.test(await leadCardText(p, 'LI09')));
      await patchDb({ 'lagDefs/LG1': lg1, 'lagDefs/LG2': lg2, 'leadDefs/LI09': li9 });
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
      await tab(p, 'work');
      assert.ok(/팀 업무 현황/.test(await p.locator('.phead h1').innerText()));
      assert.ok(await p.locator('.filters').count());
      for (const id of ['programs', 'metrics', 'auto', 'map', 'hub', 'admin', 'tasks']) {
        await p.click(`[data-go="${id}"]`);
        await p.waitForTimeout(150);
        assert.ok((await p.locator('#view .wrap').innerText()).length > 50, id);
      }
      assert.ok(/팀 업무 현황/.test(await p.locator('.phead h1').innerText()), '탭 기억');
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
      await t(`모바일 ${w}px: 개인 지표 화면 가로 넘침 없음`, async () => {
        await open(m);
        const o = await over(); assert.ok(o.scroll <= 0 && !o.bad.length, JSON.stringify(o));
        await m.screenshot({ path: path.join(outDir, `02_모바일${w}_개인지표.png`), fullPage: true });
      });
      await t(`모바일 ${w}px: 상세·가중치 창 넘침 없음 · 터치 영역 36px 이상`, async () => {
        await m.tap('[data-pf-open="lead"][data-id="LI01"][data-v="input"]');
        await m.waitForSelector('#pfModal.on');
        let o = await over(); assert.ok(!o.bad.length, JSON.stringify(o));
        const small = await m.evaluate(() => [...document.querySelectorAll('#pfModal button, #pfModal input:not([type=checkbox]):not([type=radio]), #pfModal select')].filter(e => e.offsetHeight && e.offsetHeight < 36).map(e => e.id || e.className));
        assert.deepStrictEqual(small, []);
        await m.screenshot({ path: path.join(outDir, `03_모바일${w}_상세.png`) });
        await m.tap('#pfClose');
        await m.tap('[data-tt="work"]');
        await m.tap('[data-pf-open="kpi"][data-id="MK1"][data-v="links"]');
        o = await over(); assert.ok(!o.bad.length, JSON.stringify(o));
        await m.screenshot({ path: path.join(outDir, `04_모바일${w}_팀점수.png`) });
        await m.tap('#pfClose');
        const cardBtn = await m.evaluate(() => Math.min(...[...document.querySelectorAll('.pf-acts .mini')].map(e => e.offsetHeight)));
        assert.ok(cardBtn >= 36, '카드 버튼 ' + cardBtn);
      });
      await t(`모바일 ${w}px: 팀 업무 현황·담당자 카드 넘침 없음 · 터치 영역`, async () => {
        assert.ok(/팀 업무 현황/.test(await m.locator('.phead h1').innerText()));
        let o = await over(); assert.ok(o.scroll <= 0 && !o.bad.length, JSON.stringify(o));
        await m.screenshot({ path: path.join(outDir, `06_모바일${w}_접힘.png`), fullPage: true });
        await m.tap('[data-pf-card="shs"]');
        await m.tap('.pfb-row[data-id="LI02"]');
        await m.tap('[data-proj="SX1"]');
        o = await over(); assert.ok(o.scroll <= 0 && !o.bad.length, JSON.stringify(o));
        const small = await m.evaluate(() => [...document.querySelectorAll('.pfb-row,.pfs,.pfs-pct,.pfa-row input,.pfa-row button,.pf-card-tg,.fg button')].filter(e => e.offsetHeight && e.offsetHeight < 30).map(e => e.className));
        assert.deepStrictEqual(small, []);
        const min = await m.evaluate(() => Math.min(...[...document.querySelectorAll('.pfs,.pfs-pct,.pfb-row,.pf-card-tg')].map(e => e.offsetHeight)));
        assert.ok(min >= 38, '최소 높이 ' + min);
        await m.screenshot({ path: path.join(outDir, `07_모바일${w}_펼침.png`) });
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
