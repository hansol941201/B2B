// 참고 사이트 기반 새 화면 시험 — 모의 DB만 사용한다. 운영 DB 요청이 나가면 실패.
//   NODE_PATH=<playwright> E2E_CHROME=<chrome> node tests/e2e-rebuild.cjs <기준 데이터 JSON> <결과 폴더>
const { chromium } = require('playwright'), { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), assert = require('assert');
const [baselineFile, outDir] = process.argv.slice(2);
const PORT = 5189, BASE = `http://localhost:${PORT}`, baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
const MONTH = (() => { const d = new Date(), m = d.getMonth() + 1; return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m; })();
const PREV = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); const m = d.getMonth() + 1; return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m; })();
fs.mkdirSync(outDir, { recursive: true });
const results = [], errors = [], prod = []; let pass = 0;
async function t(name, fn) { try { await fn(); pass++; results.push('성공 ' + name); console.log('성공 ' + name); } catch (e) { results.push('실패 ' + name + ' — ' + String(e.message).split('\n')[0]); console.log('실패 ' + name + '\n', String(e.message).slice(0, 900)); process.exitCode = 1; } }
const db = async () => (await fetch(BASE + '/__db')).json();
const patchDb = o => fetch(BASE + '/__rtdb/shared/b2bOpsTracker.json', { method: 'PATCH', body: JSON.stringify(o) });
const until = async (fn, ms) => { const end = Date.now() + (ms || 8000); let e; while (Date.now() < end) { try { const r = await fn(); if (r !== false) return r; } catch (x) { e = x; } await new Promise(r => setTimeout(r, 150)); } throw e || new Error('시간 초과'); };
async function newPage(browser, opts) {
  const ctx = await browser.newContext(opts || { viewport: { width: 1320, height: 900 } }), p = await ctx.newPage();
  p.on('console', m => { if (m.type() === 'error' && !/__nosdk|ERR_|404|Failed to load/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', e => errors.push(String(e)));
  p.on('request', r => { if (/firebasedatabase\.app|firebaseio\.com/.test(r.url())) prod.push(r.url()); });
  p.dialogs = []; p.dialogAnswer = true;
  p.on('dialog', d => { p.dialogs.push(d.message()); return p.dialogAnswer ? d.accept() : d.dismiss(); });
  return p;
}
const ready = p => p.waitForFunction(() => /동기화 완료/.test((document.querySelector('#cloud-text') || {}).textContent || ''), null, { timeout: 15000 });
const open = async p => { await p.goto(BASE + '/'); await ready(p); await p.waitForTimeout(200); };
const tab = async (p, id) => { await p.click(`.tab[data-page="${id}"]`); await p.waitForTimeout(120); };
const keepOld = (d, skip) => Object.keys(baseline).forEach(k => { if (!(skip || []).includes(k)) assert.deepStrictEqual(d[k], baseline[k], k + ' 변경됨'); });
const indText = (p, id) => p.locator(`.kpi-ind[data-ind="${id}"]`).first().innerText();

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, 'mock-server.cjs'), String(PORT), baselineFile], { stdio: 'inherit' });
  await new Promise(r => setTimeout(r, 600));
  const browser = await chromium.launch(process.env.E2E_CHROME ? { executablePath: process.env.E2E_CHROME } : {});
  const p = await newPage(browser);
  try {
    await t('열기만 하면 저장 없음 · 기존 데이터 그대로', async () => { await open(p); await new Promise(r => setTimeout(r, 1000)); assert.deepStrictEqual(await db(), baseline); });
    await t('메뉴 6개: 오늘·멤버별 상세·KPI 체계·앱·도구 모음·전체 업무 관리·설정', async () => {
      const names = (await p.locator('.tab').allInnerTexts()).map(s => s.replace(/[^가-힣A-Za-z·\s]/g, '').trim());
      assert.deepStrictEqual(names, ['오늘', '멤버별 상세', 'KPI 체계', '앱·도구 모음', '전체 업무 관리', '설정']);
    });
    await t('홈 바로가기: 탭 줄 맨 앞, 통합 KPI 대시보드를 새 창으로, 화면 전환은 그대로', async () => {
      const first = await p.locator('.tabs > *').first().evaluate(e => ({ id: e.id, href: e.getAttribute('href'), target: e.target, rel: e.rel, text: e.innerText.trim(), icon: !!e.querySelector('svg.ic-home') }));
      assert.equal(first.id, 'tab-home'); assert.ok(/^홈/.test(first.text), first.text); assert.ok(first.icon, '선 아이콘');
      assert.equal(first.href, 'https://script.google.com/macros/s/AKfycbxVUyuJxCDL3BcYJmLzEiOFieKn14kUQKKfcPxwm8qN5PUHLWiLQG5EKhLI9ghafmFjSw/exec');
      assert.equal(first.target, '_blank'); assert.ok(/noopener/.test(first.rel));
      assert.equal(await p.locator('.tab.active').getAttribute('data-page'), 'today', '기본 화면은 오늘');
    });
    await t('팀원 3명과 담당자 ID 일치', async () => {
      const txt = await p.locator('#today-grid').innerText();
      ['박희선', '조재연', '신한솔'].forEach(n => assert.ok(txt.includes(n), n));
      assert.ok(!txt.includes('최세혁'));
      const shs = await p.locator('#today-grid > *:has-text("신한솔")').first().innerText();
      assert.ok(/협약서 PDF/.test(shs) && /공사실적정리/.test(shs), '신한솔 업무');
      const m1 = await p.locator('#today-grid > *:has-text("박희선")').first().innerText();
      assert.ok(!/협약서 PDF/.test(m1), '업무가 다른 팀원에게 가면 안 됨');
    });
    await t('다른 부서 내장 데이터 없음', async () => {
      const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
      ['주현진', '신명희', '송보람', '김경미', '신수진', '김수진', '김영성', '김미연', '이지연', '임채명', 'embedded-data', 'openFirebaseSettings()'].forEach(w => { if (w !== 'openFirebaseSettings()') assert.ok(!src.includes(w), w); });
      assert.equal(await p.evaluate(() => typeof window.FB), 'undefined', '전체 덮어쓰기 저장 없음');
    });
    /* 프로젝트 */
    await t('프로젝트 추가 팝업: 세부업무 포함 등록, 진행률 자동 계산', async () => {
      await p.evaluate(() => openProjectModal());
      await p.waitForSelector('#modal-project.open');
      await p.fill('#project-modal-title-input', '시험 프로젝트');
      await p.selectOption('#project-modal-member', 'shs');
      await p.evaluate(() => { UI.draftSubtasks = [{ id: 'd1', title: '세부 A', progress: 100, status: 'done' }, { id: 'd2', title: '세부 B', progress: 0, status: 'todo' }]; renderDraftSubtasks(); });
      await p.evaluate(() => submitProjectModal());
      const d = await until(async () => { const x = await db(); return Object.keys(x.projects).length === 2 ? x : false; });
      const np = Object.values(d.projects).find(x => x.id !== 'SX1');
      assert.equal(np.owner, 'shs'); assert.equal(np.name, '시험 프로젝트'); assert.equal(np.tasks.length, 2); assert.equal(np.tasks[0].p, 100);
      assert.deepStrictEqual(d.projects.SX1, baseline.projects.SX1, 'SX1 그대로');
      keepOld(d, ['projects']);
    });
    await t('세부업무 상태 단추 ○ ▶ ✓ 와 평균 자동 계산', async () => {
      const d0 = await db(), np = Object.values(d0.projects).find(x => x.id !== 'SX1');
      const sid = await p.evaluate(id => DATA.tasks.find(t => t.id === id).subtasks[1].id, np.id);
      await p.evaluate(([a, b]) => cycleSubtaskStatus(a, b), [np.id, sid]);
      await until(async () => { const x = await db(); return x.projects[np.id].tasks[1].p === 10; });
      assert.equal(await p.evaluate(id => DATA.tasks.find(t => t.id === id).progress, np.id), 55);
      await p.evaluate(([a, b]) => cycleSubtaskStatus(a, b), [np.id, sid]);
      const x = await until(async () => { const v = await db(); return v.projects[np.id].tasks[1].p === 100 ? v : false; });
      assert.equal(await p.evaluate(id => DATA.tasks.find(t => t.id === id).status, np.id), 'done');
      assert.ok(x.projects[np.id].updatedAt, '갱신일');
    });
    await t('프로젝트 수정 팝업: 기존 진행 메모 유지', async () => {
      const d0 = await db(), np = Object.values(d0.projects).find(x => x.id !== 'SX1');
      const tasks = np.tasks.map((t, i) => i === 0 ? Object.assign({}, t, { n: '메모 유지', r: '잔여 유지' }) : t);
      await patchDb({ ['projects/' + np.id]: Object.assign({}, np, { tasks }) });
      await p.reload(); await ready(p);
      await p.evaluate(id => openProjectModal(id), np.id);
      await p.fill('#project-modal-title-input', '시험 프로젝트 수정');
      await p.evaluate(() => submitProjectModal());
      const x = await until(async () => { const v = await db(); return v.projects[np.id].name === '시험 프로젝트 수정' ? v : false; });
      assert.equal(x.projects[np.id].tasks[0].n, '메모 유지'); assert.equal(x.projects[np.id].tasks[0].r, '잔여 유지');
    });
    await t('저장 충돌: 다른 사람이 먼저 저장하면 확인', async () => {
      const d0 = await db(), np = Object.values(d0.projects).find(x => x.id !== 'SX1');
      await p.evaluate(id => openProjectModal(id), np.id);
      await p.fill('#project-modal-title-input', '내 입력');
      await patchDb({ ['projects/' + np.id]: Object.assign({}, np, { name: '다른 사람 입력', updatedAt: new Date().toISOString() }) });
      await new Promise(r => setTimeout(r, 2700));
      p.dialogs.length = 0; p.dialogAnswer = false;
      await p.evaluate(() => submitProjectModal());
      p.dialogAnswer = true;
      assert.ok(/먼저/.test(p.dialogs[0] || ''), '경고 없음');
      assert.equal((await db()).projects[np.id].name, '다른 사람 입력', '취소하면 덮어쓰지 않음');
      assert.equal(await p.inputValue('#project-modal-title-input'), '내 입력', '입력 유지');
      await p.evaluate(() => closeModal());
    });
    /* 루틴 */
    await t('루틴 추가 팝업 · 기존 루틴 8개 유지', async () => {
      await p.evaluate(() => openRoutineModal());
      await p.waitForSelector('#modal-routine.open');
      await p.fill('#routine-modal-title-input', '시험 루틴');
      await p.selectOption('#routine-modal-member', 'm2');
      await p.evaluate(() => submitRoutineModal());
      const x = await until(async () => { const v = await db(); return v.routines.m2 ? v : false; });
      assert.equal(x.routines.m2[0].t, '시험 루틴'); assert.equal(x.routines.m2[0].cy, '일');
      assert.deepStrictEqual(x.routines.shs, baseline.routines.shs, '기존 루틴 그대로');
    });
    await t('루틴 오늘 체크는 날짜별 기록으로 저장', async () => {
      await p.evaluate(() => toggleRoutineCheck('RS2', today()));
      const x = await until(async () => { const v = await db(); return v.routineChecks ? v : false; });
      const c = Object.values(x.routineChecks)[0];
      assert.equal(c.routineId, 'RS2');
      assert.deepStrictEqual(x.routines.shs, baseline.routines.shs, '기존 루틴 표시값 그대로');
    });
    await t('멤버별 상세: 팀원 선택 시 그 팀원 업무만', async () => {
      await tab(p, 'detail');
      await p.evaluate(() => setDetailMember('m1'));
      assert.ok(!/협약서 PDF/.test(await p.locator('#page-detail').innerText()));
      await p.evaluate(() => setDetailMember('shs'));
      assert.ok(/협약서 PDF/.test(await p.locator('#page-detail').innerText()));
      assert.ok((await p.locator('#member-pick > *').count()) === 3);
    });
    await t('전체 업무 관리: 검색·담당 필터', async () => {
      await tab(p, 'manage');
      await p.fill('#b2b-task-q', '협약서');
      const vis = await p.locator('#manage-task-tbody tr:visible').count();
      assert.equal(vis, 1);
      await p.fill('#b2b-task-q', '');
      await p.selectOption('#b2b-task-who', '조재연');
      assert.equal(await p.locator('#manage-task-tbody tr:visible').count(), 0);
      assert.equal(await p.locator('#manage-routine-tbody tr:visible').count(), 1);
      await p.selectOption('#b2b-task-who', '');
    });
    /* KPI */
    const pick = async name => { await p.click(`#kpi-root .member-chip:has-text("${name}")`); await p.waitForTimeout(80); };
    await t('KPI 체계: 팀 KPI 3개 카드가 맨 위, 팀원 3명 선택, 선택한 사람 지표만', async () => {
      await tab(p, 'kpi');
      assert.equal(await p.locator('.ks-team .ks-teamcard').count(), 3);
      const first = await p.locator('#kpi-root > *').first().innerText();
      assert.ok(/팀 KPI 3개/.test(first) && /최상위 목표/.test(first), '팀 KPI가 맨 위');
      assert.deepStrictEqual((await p.locator('#kpi-root .member-chip').allInnerTexts()).map(x => x.replace(/\d+/g, '').trim()), ['박희선', '조재연', '신한솔']);
      await pick('신한솔');
      assert.equal(await p.locator('#kpi-member-view .kpi-ind').count(), 14);
      const v = await p.locator('#kpi-member-view').innerText();
      assert.ok(/고객을 직접 움직이는 일/.test(v) && /실행을 받쳐 주는 일/.test(v) && /관리 후 고객 변화/.test(v) && /개인 평가 점수가 아니에요/.test(v), '실행·운영 지원·고객 변화 구분');
      assert.ok(!/실제 성과/.test(v), '개인 성과 표현 없음');
      assert.ok(/미응답 업체 재연락 관리/.test(v) && /고객등급 상승률/.test(v));
      await pick('박희선');
      assert.equal(await p.locator('#kpi-member-view .kpi-ind').count(), 0);
      assert.ok(/아직 박희선님의 지표가 없어요/.test(await p.locator('#kpi-member-view').innerText()));
      await pick('신한솔');
    });
    await t('팀 KPI 아래 연결된 팀원 활동(실행·운영 지원)과 관리 후 고객 변화가 한눈에', async () => {
      const blocks = p.locator('.ks-team .kt-block');
      assert.equal(await blocks.count(), 3);
      const acts = async i => (await blocks.nth(i).locator('.kt-act').evaluateAll(a => a.map(e => e.dataset.act))).join(',');
      assert.equal(await acts(0), 'LI01,LI02,LI03,LI04,LI06,LI05,LI09,LG1', 'KPI ① 연결(핵심 먼저, 참고 뒤, 고객 변화 끝)');
      assert.equal(await acts(1), 'LI04,LI05,LI06,LI07,LG2');
      assert.equal(await acts(2), 'LI01,LI02,LI04,LI05,LI06,LI08,LI09,LG3');
      const t0 = await blocks.nth(0).locator('.kt-tree').innerText();
      assert.ok(/이 KPI를 높이는 팀원 활동/.test(t0) && /신한솔/.test(t0) && /실행/.test(t0) && /운영 지원/.test(t0) && /참고/.test(t0), t0.slice(0, 200));
      assert.ok(/박희선 · 조재연: 아직 연결된 활동 없음/.test(t0));
      assert.ok(/관리 후 고객 변화/.test(t0) && /개인 점수 아님/.test(t0));
      assert.ok(!/LG4|장기 미활동|고객등급 상승률/.test(await p.locator('.ks-team').innerText()), '팀 KPI 에 직접 연결 안 된 고객 변화 지표는 팀원별 보기에만');
      await blocks.nth(0).locator('.kt-act[data-act="LI03"]').click();
      await p.waitForSelector('#modal-kpi.open');
      assert.ok(/신규업체 첫 이용 활성화/.test(await p.locator('#modal-kpi-title').innerText()));
      await p.evaluate(() => closeModal());
    });
    await t('평소 화면: 지표명·목표·현재 실적·달성률만 (기준값·계산식은 상세보기 안)', async () => {
      const v = await p.locator('#kpi-root').innerText();
      ['계산식', '분모', '분자', '가중치', '선행활동 점수', '담당 업체·현장', '관리 대상 미팅', '미확정'].forEach(w => assert.ok(!v.includes(w), w + ' 노출'));
      const card = await indText(p, 'LI02');
      ['목표', '현재 실적', '달성률', '상세보기'].forEach(w => assert.ok(card.includes(w), w));
    });
    await t('입력 없으면 미측정 · 목표·현재 실적 입력하면 달성률 자동', async () => {
      assert.ok(/미측정/.test(await indText(p, 'LI02')));
      await p.fill('.kpi-ind[data-ind="LI02"] .kmv.tgt', '10'); await p.press('.kpi-ind[data-ind="LI02"] .kmv.tgt', 'Tab');
      await p.fill('.kpi-ind[data-ind="LI02"] .kmv:not(.tgt)', '7'); await p.press('.kpi-ind[data-ind="LI02"] .kmv:not(.tgt)', 'Tab');
      await until(async () => /70%/.test(await indText(p, 'LI02')));
      const r = (await until(async () => { const x = await db(); const v = x.perfMonthly['LI02_' + MONTH]; return v && v.num === 7 ? x : false; })).perfMonthly['LI02_' + MONTH];
      assert.equal(r.den, 10, '목표는 기존 대상 수 칸에 저장'); assert.equal(r.mode, 'auto'); assert.ok(r.updatedBy);
    });
    await t('현재 실적이 목표보다 크면 저장 안 됨', async () => {
      await p.fill('.kpi-ind[data-ind="LI02"] .kmv:not(.tgt)', '30'); await p.press('.kpi-ind[data-ind="LI02"] .kmv:not(.tgt)', 'Tab');
      await new Promise(r => setTimeout(r, 300));
      assert.equal((await db()).perfMonthly['LI02_' + MONTH].num, 7);
      assert.ok(/현재 실적이 목표보다/.test(await p.locator('#toast').innerText()));
    });
    await t('후행지표 미측정은 선행지표 달성률로 채우지 않음', async () => {
      for (const id of ['LG1', 'LG2', 'LG3', 'LG4', 'LG5']) assert.ok(/미측정/.test(await indText(p, id)), id);
      assert.ok(!/70%/.test(await p.locator('.ks-sec.lag').innerText()));
    });
    await t('상세보기: 무엇을 세는지·기준·세부업무, 진행률은 달성률과 분리', async () => {
      await p.locator('.kpi-ind[data-ind="LI03"] .ks-more').click();
      await p.waitForSelector('#modal-kpi.open');
      const b0 = await p.locator('#modal-kpi-body').innerText();
      assert.ok(/무엇을 세나요/.test(b0) && /후속관리 대상 업체 수/.test(b0), '목표 설명');
      await p.locator('#modal-kpi summary:has-text("기준·계산식·설명")').click();
      assert.ok(await p.locator('#b2b-target').isVisible(), '기준 달성률은 상세보기 안');
      await p.locator('#modal-kpi .sub-status-btn').first().click();
      const x = await until(async () => { const v = await db(); const r = v.perfMonthly['LI03_' + MONTH]; return r && r.prog && r.prog.t1 === 50 ? v : false; });
      assert.equal(x.perfMonthly['LI03_' + MONTH].den, undefined);
      assert.ok(/미측정/.test(await p.locator('#modal-kpi .kpi-ind').innerText()));
      assert.ok(/업무 진행률/.test(await p.locator('#modal-kpi-body').innerText()));
      await p.fill('#b2b-sub-add', '시험 세부업무'); await p.click('#modal-kpi .subtask-add button');
      await until(async () => (await db()).leadDefs.LI03.tasks.length === 10);
      await p.evaluate(() => closeModal());
    });
    await t('팀 KPI 실적과 개인 후행지표는 별도 저장', async () => {
      await p.fill('.kpi-ind[data-ind="MK1"] .kmv.tgt', '51'); await p.press('.kpi-ind[data-ind="MK1"] .kmv.tgt', 'Tab');
      await p.fill('.kpi-ind[data-ind="MK1"] .kmv:not(.tgt)', '17'); await p.press('.kpi-ind[data-ind="MK1"] .kmv:not(.tgt)', 'Tab');
      await until(async () => /33\.3%/.test(await indText(p, 'MK1')));
      assert.ok(/미측정/.test(await indText(p, 'LG1')), '개인 후행지표에 섞이면 안 됨');
      await p.fill('.kpi-ind[data-ind="LG1"] .kmv.tgt', '8'); await p.press('.kpi-ind[data-ind="LG1"] .kmv.tgt', 'Tab');
      await p.fill('.kpi-ind[data-ind="LG1"] .kmv:not(.tgt)', '3'); await p.press('.kpi-ind[data-ind="LG1"] .kmv:not(.tgt)', 'Tab');
      const x = await until(async () => { const v = await db(); return v.perfMonthly['LG1_' + MONTH] && v.perfMonthly['LG1_' + MONTH].num === 3 ? v : false; });
      assert.equal(x.perfMonthly['MK1_' + MONTH].num, 17);
    });
    await t('팀 KPI 상세에 개인 활동 점수를 섞지 않음 · 가중치 미설정 유지', async () => {
      await p.locator('.kpi-ind[data-ind="MK1"] .ks-more').click();
      await p.locator('#modal-kpi summary:has-text("기준·계산식·설명")').click();
      const b = await p.locator('#modal-kpi-body').innerText();
      assert.ok(!/선행활동 점수|개인 점수/.test(b), '팀 선행점수 표시 없음');
      assert.ok(/연결된 팀원 활동/.test(b) && /이 KPI 실적에 더하지 않음/.test(b));
      await p.evaluate(() => closeModal());
      const x = await db();
      Object.values(x.mainKpis).forEach(k => assert.equal(k.memberWeights, undefined));
    });
    await t('개인 활동 달성률이 올라도 팀 KPI 실적은 그대로', async () => {
      const before = await p.locator('.kpi-ind[data-ind="MK1"] .kstatus').first().innerText();
      await p.fill('.kpi-ind[data-ind="LI05"] .kmv.tgt', '4'); await p.press('.kpi-ind[data-ind="LI05"] .kmv.tgt', 'Tab');
      await p.fill('.kpi-ind[data-ind="LI05"] .kmv:not(.tgt)', '4'); await p.press('.kpi-ind[data-ind="LI05"] .kmv:not(.tgt)', 'Tab');
      await until(async () => /100%/.test(await indText(p, 'LI05')));
      assert.equal(await p.locator('.kpi-ind[data-ind="MK1"] .kstatus').first().innerText(), before);
      assert.ok(/100%/.test(await p.locator('.kt-act[data-act="LI05"]').first().innerText()), '트리의 활동 달성률은 갱신');
      assert.equal((await db()).perfMonthly['MK1_' + MONTH].num, 17, '팀 KPI 기록 그대로');
    });
    await t('월별 실적 분리: 전월 입력해도 이번 달 유지', async () => {
      await p.selectOption('#kpi-month', PREV);
      assert.ok(/미측정/.test(await indText(p, 'LI02')));
      await p.fill('.kpi-ind[data-ind="LI02"] .kmv.tgt', '4'); await p.press('.kpi-ind[data-ind="LI02"] .kmv.tgt', 'Tab');
      await until(async () => (await db()).perfMonthly['LI02_' + PREV]);
      await p.selectOption('#kpi-month', MONTH);
      assert.ok(/70%/.test(await indText(p, 'LI02')));
      await p.locator('.kpi-ind[data-ind="LI02"] .ktext').click();
      await p.locator('#modal-kpi summary:has-text("월별 실적")').click();
      const b = await p.locator('#modal-kpi-body').innerText();
      assert.ok(b.includes(MONTH) && b.includes(PREV), b.slice(0, 200));
      await p.evaluate(() => closeModal());
    });
    await t('팀원 선택은 새로고침 후에도 유지', async () => {
      await pick('조재연'); await p.reload(); await ready(p); await tab(p, 'kpi');
      assert.ok(/조재연/.test(await p.locator('#kpi-root .member-chip.on').innerText()));
      await pick('신한솔');
    });
    await t('카드 자동값(perfAuto): 표시·잠금, 직접 입력값은 이력으로 남고 화면은 자동값을 쓰지 않음', async () => {
      const auto = { id: 'LI01_' + MONTH, ref: 'LI01', month: MONTH, mode: 'auto', num: 45, den: 50, source: '고객관리카드', rule: '카드 미팅 판정 · 유예 3일 · 등록 기한 14일 · 조율 기한 30일', computedAt: new Date().toISOString(),
        counts: { done: 30, scheduled: 10, waiting: 5, missed: 2, late: 3, carried: 1, coord: 2, branch: 3, format: 1, exempt: 4 } };
      const manual = { id: 'LI01_' + MONTH, ref: 'LI01', month: MONTH, mode: 'auto', num: 3, den: 5, updatedBy: '시험', rev: 1 };
      await patchDb({ ['perfMonthly/LI01_' + MONTH]: manual, ['perfAuto/LI01_' + MONTH]: auto });
      await p.reload(); await ready(p); await tab(p, 'kpi'); await pick('신한솔');
      const card = await indText(p, 'LI01');
      assert.ok(/90%/.test(card) && /카드 자동/.test(card), card);
      assert.equal(await p.locator('.kpi-ind[data-ind="LI01"] .kmv.tgt').first().inputValue(), '50');
      assert.ok(await p.locator('.kpi-ind[data-ind="LI01"] .kmv.tgt').first().getAttribute('readonly') !== null, '잠금');
      await p.evaluate(() => b2bSetVal('LI01', 'num', { value: '1', dataset: {} }));
      assert.ok(/자동으로 계산되는 지표/.test(await p.locator('#toast').innerText()));
      await p.locator('.kpi-ind[data-ind="LI01"] .ks-more').click();
      const b = await p.locator('#modal-kpi-body').innerText();
      assert.ok(/고객관리카드 자동 계산/.test(b) && /누락\s*2건/.test(b) && /등록 지연\s*3건/.test(b), b.slice(0, 300));
      await p.locator('#modal-kpi summary:has-text("월별 실적")').click();
      assert.ok(/직접 입력\(이전\)/.test(await p.locator('#modal-kpi-body').innerText()));
      await p.evaluate(() => closeModal());
      await new Promise(r => setTimeout(r, 600));
      const d = await db();
      assert.deepStrictEqual(d.perfAuto['LI01_' + MONTH], auto, '자동값은 화면이 바꾸지 않음');
      assert.deepStrictEqual(d.perfMonthly['LI01_' + MONTH], manual, '직접 입력값 유지');
      assert.ok(!/90%/.test(await p.locator('.ks-sec.lag').innerText()), '후행지표에 섞이지 않음');
    });
    await t('팀 KPI 대시보드 자동값: "대시보드 자동" 표시·잠금, 직접 입력값 유지, 개인 지표와 섞이지 않음', async () => {
      const before = (await db()).perfMonthly['MK1_' + MONTH];
      const auto = { id: 'MK1_' + MONTH, ref: 'MK1', month: MONTH, mode: 'auto', num: 3, den: 15, source: '통합 KPI 대시보드', rule: '통합 KPI 대시보드 대표 KPI · 기준일 2026-05-20 이후 · 관찰 60일', computedAt: new Date().toISOString(), counts: { open: 8, openHit: 2 } };
      await patchDb({ ['perfAuto/MK1_' + MONTH]: auto });
      await p.reload(); await ready(p); await tab(p, 'kpi');
      const card = await indText(p, 'MK1');
      assert.ok(/20%/.test(card) && /대시보드 자동/.test(card), card);
      assert.ok(await p.locator('.kpi-ind[data-ind="MK1"] .kmv.tgt').first().getAttribute('readonly') !== null, '잠금');
      await p.locator('.kpi-ind[data-ind="MK1"] .ks-more').click();
      const b = await p.locator('#modal-kpi-body').innerText();
      assert.ok(/통합 KPI 대시보드 자동 계산/.test(b) && /60일 관찰 중\(분모 제외\)\s*8곳/.test(b) && /통합시트/.test(b), b.slice(0, 400));
      await p.evaluate(() => closeModal());
      assert.ok(/카드 자동/.test(await indText(p, 'LI01')), '개인 지표는 카드 자동 그대로');
      await new Promise(r => setTimeout(r, 600));
      const d = await db();
      assert.deepStrictEqual(d.perfAuto['MK1_' + MONTH], auto);
      assert.deepStrictEqual(d.perfMonthly['MK1_' + MONTH], before, '직접 입력값 유지');
    });
    /* 설정 */
    await t('설정: 가중치 저장, 팀원 삭제 보호, 담당 확인', async () => {
      await tab(p, 'settings');
      assert.ok(await p.locator('#page-settings [data-w-member="MK1"]').count());
      p.dialogs.length = 0;
      await p.evaluate(() => deleteMember('shs'));
      assert.deepStrictEqual(p.dialogs, [], '담당 업무가 있으면 확인 창도 없이 거부');
      assert.ok((await db()).members.shs);
      await patchDb({ 'projects/C9': { id: 'C9', prog: 'P1', owner: 'csh', name: '이전 담당 시험 업무', note: '', tasks: [{ t: 'a', p: 10, n: '', r: '' }] } });
      await new Promise(r => setTimeout(r, 2500));
      await p.reload(); await ready(p); await tab(p, 'settings');
      assert.ok(/이전 담당 시험 업무/.test(await p.locator('#settings-extra').innerText()));
      assert.equal((await db()).projects.C9.owner, 'csh', '자동 이전 없음');
      await patchDb({ 'projects/C9': null });
    });
    await t('정체 표시: 7일 넘게 갱신 없는 업무만', async () => {
      const d = await db(), np = Object.values(d.projects).find(x => x.id !== 'SX1');
      await patchDb({ ['projects/' + np.id]: Object.assign({}, np, { tasks: [{ t: 'x', p: 40, n: '', r: '' }], updatedAt: new Date(Date.now() - 10 * 86400000).toISOString() }) });
      await p.reload(); await ready(p);
      await p.waitForTimeout(200);
      const body = await p.locator('body').innerText();
      assert.ok(/진행이 더딘 업무/.test(body), '안내 없음');
      assert.ok(!/정체된 업무 없음/.test(body));
      await p.evaluate(() => toggleStaleBanner()); await p.waitForTimeout(150);
      assert.ok((await p.locator('body').innerText()).includes('10일'), '10일 표시');
    });
    await t('기존 데이터 유지: 팀원·루틴·지표·링크·자동화·공고 요약', async () => {
      const d = await db();
      Object.keys(baseline.members).forEach(id => assert.deepStrictEqual(d.members[id], baseline.members[id], id));
      ['automations', 'bid', 'kpis', 'links', 'meta', 'personal', 'programs', 'workKpis'].forEach(k => assert.deepStrictEqual(d[k], baseline[k], k));
      assert.deepStrictEqual(d.projects.SX1, baseline.projects.SX1);
      ['S1', 'C1', 'J1'].forEach(id => assert.equal(d.projects[id], undefined, id + ' 복구 금지'));
      assert.ok(Object.keys(d.perfHistory).length >= 5);
    });
    await t('이전 화면(legacy)에서도 같은 데이터가 보이고 새 기록이 지워지지 않음', async () => {
      const before = await db();
      const o = await newPage(browser);
      await o.goto(BASE + '/legacy.html'); await o.waitForFunction(() => document.querySelector('#view .wrap'));
      assert.ok(await o.locator('.sp-ind').count() === 14 || await o.locator('.sp').count());
      await o.waitForTimeout(800);
      const after = await db();
      assert.deepStrictEqual(after, before, '이전 화면을 열어도 변경 없음');
      assert.ok(await o.locator('[data-nav-more]').count());
      await o.goto(BASE + '/legacy.html#admin'); await o.reload(); await o.waitForFunction(() => document.querySelector('#view .wrap'));
      assert.ok(await o.locator('#btnSeed').isDisabled(), '기준선 되돌리기 잠금');
      await o.context().close();
    });
    await p.reload(); await ready(p);
    await p.screenshot({ path: path.join(outDir, '입력후_오늘_PC.png'), fullPage: true });
    /* 모바일 */
    for (const [w, h] of [[360, 740], [375, 812], [390, 844]]) {
      const m = await newPage(browser, { viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      await t(`모바일 ${w}px: 메뉴 전체 가로 넘침 없음`, async () => {
        await open(m);
        for (const id of ['today', 'detail', 'kpi', 'automation', 'manage', 'settings']) {
          await m.tap(`.tab[data-page="${id}"]`); await m.waitForTimeout(150);
          const over = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          assert.ok(over <= 0, id + ' 넘침 ' + over);
          await m.screenshot({ path: path.join(outDir, `모바일${w}_${id}.png`) });
        }
        await m.tap('.tab[data-page="kpi"]'); await m.tap('#kpi-root .member-chip:has-text("신한솔")');
        await m.screenshot({ path: path.join(outDir, `모바일${w}_kpi_신한솔.png`), fullPage: true });
        const o2 = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert.ok(o2 <= 0, '개인 지표 넘침 ' + o2);
      });
      await m.context().close();
    }
    await t('화면 오류 없음', async () => assert.deepStrictEqual(errors, []));
    await t('운영 Firebase 요청 0건', async () => assert.deepStrictEqual(prod, []));
  } finally { await browser.close(); server.kill(); }
  fs.writeFileSync(path.join(outDir, 'e2e-rebuild-결과.txt'), results.join('\n') + `\n\n${pass} / ${results.length} 성공\n`);
  console.log(`\n${pass} / ${results.length} 성공`);
})().catch(e => { console.error(e); process.exit(1); });
