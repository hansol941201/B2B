// 참고 트래커(pourservice/service-task-tracker) 소스에서 B2B용 index.html을 만든다.
// 화면·동작 코드는 그대로 쓰고, 다른 부서의 내장 데이터와 전체 덮어쓰기 저장은 제거한다.
//   node tools/build-from-reference.cjs <참고 index.html> [출력 파일]
const fs = require('fs'), path = require('path');
const [refFile, outFile] = process.argv.slice(2);
const root = path.join(__dirname, '..');
let h = fs.readFileSync(refFile, 'utf8').replace(/\r\n/g, '\n');
const legacy = fs.readFileSync(path.join(root, 'legacy.html'), 'utf8').replace(/\r\n/g, '\n');
function once(a, b) { const i = h.indexOf(a); if (i < 0 || h.indexOf(a, i + 1) >= 0) throw new Error('anchor: ' + a.slice(0, 80)); h = h.slice(0, i) + b + h.slice(i + a.length); }
function cut(start, end, text) { const i = h.indexOf(start); if (i < 0) throw new Error('start: ' + start); const j = h.indexOf(end, i + start.length); if (j < 0) throw new Error('end: ' + end); h = h.slice(0, i) + (text || '') + h.slice(j); }
function grab(start, end) { const i = h.indexOf(start), j = h.indexOf(end, i + start.length); if (i < 0 || j < 0) throw new Error('grab: ' + start); return h.slice(i, j); }
function fnBody(name, body) { // 함수 본문 교체 (중괄호 짝 맞추기, 문자열 안의 괄호는 내장 데이터가 빠진 뒤에 호출)
  const sig = 'function ' + name + '(';
  const i = h.indexOf(sig); if (i < 0) throw new Error('fn ' + name);
  let p = h.indexOf('{', h.indexOf(')', i)), depth = 0, q = p, str = null, esc = false;
  for (; q < h.length; q++) {
    const c = h[q];
    if (str) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === str) str = null; continue; }
    if (c === '"' || c === "'" || c === '`') { str = c; continue; }
    if (c === '/' && h[q + 1] === '/') { q = h.indexOf('\n', q); continue; }
    if (c === '{') depth++;
    if (c === '}') { depth--; if (!depth) break; }
  }
  h = h.slice(0, p) + '{' + body + '}' + h.slice(q + 1);
}

/* 1. 다른 부서 내장 데이터·연결 설정 제거 */
cut('<script type="application/json" id="embedded-data">', '<script>\n', '');
cut('<!-- ===== 모달: Firebase 클라우드 동기화 설정 ===== -->', '<script>\n', '');
fnBody('buildKpiPlan', "return { teamGoals: [], kpis: [] };");
fnBody('migrateData', '');
fnBody('loadEmbeddedData', '');
fnBody('loadSampleData', '');
fnBody('clearAll', '');

/* 업무가 없는 팀원의 달성 원이 100%로 보이지 않게 한다 */
once('totalToday > 0 ? Math.round(doneToday/totalToday*100) : 100', 'totalToday > 0 ? Math.round(doneToday/totalToday*100) : 0');

/* 2. 이름·메뉴 */
once('<title>업무 트래커 | 넷폼알앤디</title>', '<title>B2B운영팀 업무 트래커</title>');
once('<span class="brand-mark">서비스운영본부 업무 트래커</span>', '<span class="brand-mark">B2B운영팀 업무 트래커</span>');
once('<span class="brand-sub">SERVICE OPS · TASK TRACKER</span>', '<span class="brand-sub">B2B OPS · TASK TRACKER</span>');
once(`<div class="cloud-status" id="cloud-status" onclick="openFirebaseSettings()" title="클라우드 동기화 설정">`, `<div class="cloud-status" id="cloud-status" title="저장 상태">`);
cut(`<button class="action-btn ghost sm" onclick="document.getElementById('import-file-top').click()"`, `<button class="action-btn project" onclick="openAddMenu()"`, '');
cut('<div class="tabs">\n', '</div>\n</div>\n\n<!-- ============== MAIN', `<div class="tabs">
    <button class="tab active" data-page="today">📅 오늘</button>
    <button class="tab" data-page="detail">👤 멤버별 상세</button>
    <button class="tab" data-page="kpi">🎯 KPI 체계</button>
    <button class="tab" data-page="automation">🧰 앱·도구 모음</button>
    <button class="tab" data-page="manage">📋 전체 업무 관리</button>
    <button class="tab" data-page="settings">⚙️ 설정</button>
  `);
h = h.split('서비스운영본부').join('B2B운영팀');

/* 3. 앱·도구 모음 */
once('<div class="section-title">🚀 자동화 대시보드 <span class="count" id="dash-count">0</span></div>', '<div class="section-title">🧰 앱·도구 모음 <span class="count" id="dash-count">0</span></div>');
h = h.replace(/<p class="section-sub">팀원들이 만든 자동화·대시보드 앱을 한곳에 모아 공유합니다\.[^\n]*\n/, '<p class="section-sub">업무에 쓰는 사이트와 도구를 한곳에 모았습니다. 카드를 누르면 바로 열립니다.</p>\n');
once('＋ 대시보드 추가</button>', '＋ 앱·도구 추가</button>');

/* 4. KPI 체계 머리글 */
h = h.replace(/<p class="section-sub">팀 목표 2개 아래에 담당자별 KPI를 정렬했습니다\.[^\n]*\n/, '<p class="section-sub"><b>목표</b>와 <b>현재 실적</b>에 숫자를 넣으면 <b>달성률</b>이 저절로 계산돼요. 자세한 기준은 <b>상세보기</b>에 있어요.</p>\n');
once('🎯 B2B운영팀 KPI 체계 <span class="count" id="kpi-updated">최종본</span>', '🎯 KPI 체계 <span class="count" id="kpi-updated">—</span>');
once(`<button class="btn ghost btn-sm" onclick="exportKpiSummary()" style="margin-left:auto;">📋 텍스트 복사</button>`, `<label class="ks-month">몇 월? <select id="kpi-month" onchange="UI.kpiMonth=this.value; renderKpiPage();"></select></label>`);
/* 보기 전환 버튼 대신 화면 안의 팀원 선택을 쓴다 */
cut('<div class="kpi-viewtoggle">', '<label class="ks-month">', '');

/* 5. 전체 업무 관리 / 설정 분리 */
const memberSec = grab('<div class="section-title">멤버 <span class="count" id="manage-member-count">', '<div class="section-title">🔄 루틴 업무 <span class="count" id="manage-routine-count">');
const memberNoComment = memberSec.replace(/\s*<!-- [^\n]*-->\s*$/, '\n');
cut('<div class="section-title">멤버 <span class="count" id="manage-member-count">', '<div class="section-title">🔄 루틴 업무 <span class="count" id="manage-routine-count">', '');
cut('<!-- 데이터 -->', '</main>', `</div>

  <div class="page" id="page-settings">
    ${memberNoComment}
    <div class="section-title" style="margin-top:30px;">저장·백업</div>
    <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
      <button class="btn ghost" onclick="exportData()">📦 JSON 내보내기</button>
      <span class="section-sub" style="margin:0;">저장은 항목별로 자동 처리됩니다. 복구는 이전 화면의 설정에서 합니다.</span>
    </div>
    <div id="settings-extra"></div>
  </div>

`);
/* 팀 관리 블록은 숨기고 요소만 남긴다(참고 코드가 값을 채움) */
once('<!-- 팀 관리 -->', '<div style="display:none;"><!-- 팀 관리 -->');
once('<div class="section-title">🔄 루틴 업무 <span class="count" id="manage-routine-count">', '</div><div class="section-title">🔄 루틴 업무 <span class="count" id="manage-routine-count">');
/* 검색·필터 */
once('<div class="page" id="page-manage">\n', `<div class="page" id="page-manage">
    <div class="b2b-search"><input type="text" id="b2b-task-q" placeholder="업무·담당자 검색" oninput="b2bFilterTasks()"><select id="b2b-task-who" onchange="b2bFilterTasks()"></select></div>
`);

/* 6. 상세 창 자리 */
once('<!-- ===== 플로팅 추가 버튼 ===== -->', `<div class="modal-backdrop" id="modal-kpi" onclick="if(event.target===this)closeModal()">
  <div class="modal modal-lg">
    <div class="modal-head"><div class="modal-head-icon" style="background:var(--accent-soft); color:var(--accent);">🎯</div><div><div class="modal-title" id="modal-kpi-title">지표</div><div class="modal-subtitle" id="modal-kpi-sub"></div></div><button class="modal-close-btn" onclick="closeModal()">×</button></div>
    <div class="modal-body" id="modal-kpi-body"></div>
  </div>
</div>

<!-- ===== 플로팅 추가 버튼 ===== -->`);

/* 7. 스타일 추가: 쓰지 않는 패널 숨김 */
once('</style>\n</head>', `
  #alba-panel, .team-chip-alba, label:has(#routine-modal-alba), [data-r-filter="alba"], [data-r-filter="member"] { display: none !important; }
  .b2b-link { cursor: pointer; }
  .b2b-link:hover { color: var(--accent); text-decoration: underline; }
  .b2b-chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
  .b2b-kv { display: flex; gap: 10px; justify-content: space-between; align-items: center; padding: 6px 0; border-top: 1px solid var(--line-2); font-size: 12.5px; flex-wrap: wrap; }
  .b2b-kv span { color: var(--muted); font-weight: 600; }
  .b2b-kv b { font-weight: 600; min-width: 0; }
  .b2b-sum { cursor: pointer; font-size: 12.5px; font-weight: 800; padding: 6px 0; }
  .b2b-det { border-top: 1px solid var(--line-2); padding: 4px 0; }
  .b2b-search { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
  .b2b-search input { flex: 1 1 220px; min-width: 0; min-height: 40px; }
  .b2b-search select { min-height: 40px; }
  :has(> .member-kpi-line) { align-content: start; grid-auto-rows: max-content; }
  .member-kpi-line, .member-kpi-line.empty { height: auto !important; min-height: 0 !important; max-height: 44px; }
  .member-kpi-text.empty { padding-top: 0 !important; padding-bottom: 0 !important; }
  .member-kpi-line { flex: 0 0 auto; align-self: start; width: 100%; }
  .kpi-goalcard-body > .kpi-ind-group, .kpi-goalcard-body > .kpi-connector, .kpi-goalcard-body > .b2b-chips { grid-column: 1 / -1; }
  #page-settings .panel, #page-manage .panel, #page-settings .form-card { overflow-x: auto; }
  #page-settings .form-card > div { min-width: 0; }
  @media (max-width: 640px) { #page-settings .form-card > div { grid-template-columns: 1fr !important; } }
  @media (max-width: 640px) { .b2b-search input, #kpi-month, .kmv, .b2b-kv input { font-size: 16px; } }
  /* KPI 체계: 쉬운 카드 */
  .ks-month { margin-left: auto; font-size: 13px; font-weight: 700; color: var(--muted); display: inline-flex; align-items: center; gap: 6px; }
  .ks-month select { min-height: 40px; }
  .ks-h { font-size: 15px; font-weight: 800; margin: 22px 0 10px; display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; }
  .ks-h:first-child { margin-top: 4px; }
  .ks-h span { font-size: 12.5px; font-weight: 600; color: var(--muted); }
  .ks-team { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
  .ks-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .kpi-ind.ks-item { display: flex; flex-direction: column; align-items: stretch; gap: 10px; padding: 14px; background: var(--surface); border: 1px solid var(--line); border-radius: 14px; min-width: 0; }
  .kpi-ind.ks-item + .kpi-ind.ks-item { border-top: 1px solid var(--line); }
  .ks-teamcard { border-top: 4px solid var(--accent) !important; }
  .ks-top { display: flex; gap: 8px; align-items: flex-start; min-width: 0; }
  .ks-no { flex: 0 0 auto; font-weight: 700; color: var(--accent); font-size: 18px; line-height: 1.1; }
  .ks-item .ktext { font-size: 15px; font-weight: 700; line-height: 1.35; min-width: 0; word-break: keep-all; overflow-wrap: anywhere; }
  .ks-rate { display: flex; align-items: center; gap: 8px; }
  .ks-item .kstatus { font-family: var(--num); font-size: 20px; font-weight: 800; padding: 4px 12px; border-radius: 10px; min-width: 0; }
  .ks-rate-lbl { font-size: 12.5px; font-weight: 700; color: var(--muted); }
  .ks-item .kpi-mbar { flex: 0 0 8px; width: 100%; height: 8px; }
  .ks-inputs { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .ks-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .ks-field span { font-size: 12.5px; font-weight: 800; color: var(--ink-2); }
  .ks-item .ks-field .kmv { width: 100%; min-width: 0; height: 44px; font-family: var(--num); font-size: 18px; font-weight: 700; text-align: center; padding: 0 6px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); color: var(--ink); -moz-appearance: textfield; }
  .ks-item .ks-field .kmv::-webkit-outer-spin-button, .ks-item .ks-field .kmv::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
  .ks-item .ks-field .kmv:focus { outline: none; border-color: var(--accent); background: var(--accent-soft); }
  .ks-item .ks-field .kmv::placeholder { color: var(--muted); font-size: 14px; font-weight: 600; }
  .ks-more { align-self: flex-start; background: none; border: 0; padding: 6px 0; min-height: 36px; font-size: 13px; font-weight: 700; color: var(--accent); cursor: pointer; }
  .ks-auto { font-size: 11.5px; font-weight: 800; padding: 3px 8px; border-radius: 99px; background: var(--accent-soft); color: var(--accent); white-space: nowrap; }
  .ks-item .ks-field .kmv.is-auto { background: var(--line-2); color: var(--ink-2); border-style: dashed; cursor: default; }
  .ks-item .ks-field .kmv.is-auto:focus { background: var(--line-2); border-color: var(--line); }
  #modal-kpi .ks-more { display: none; }
  #modal-kpi .ks-item .ktext { pointer-events: none; }
  .ks-pick .member-chip { min-height: 44px; font-size: 15px; padding: 8px 18px; }
  .ks-sec { margin-top: 16px; }
  .ks-sec-head { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin-bottom: 10px; }
  .ks-sec-head b { font-size: 16px; font-weight: 800; }
  .ks-tag { font-size: 12px; font-weight: 800; padding: 3px 9px; border-radius: 99px; background: var(--accent-soft); color: var(--accent); }
  .ks-sec.lag .ks-tag { background: var(--warn-soft); color: var(--warn); }
  .ks-help { flex-basis: 100%; font-size: 13px; color: var(--muted); }
  .ks-empty { padding: 18px; text-align: center; color: var(--muted); font-size: 14px; background: var(--surface); border: 1px dashed var(--line); border-radius: 14px; grid-column: 1 / -1; }
  .ks-what { margin-top: 12px; padding: 10px 12px; background: var(--line-2); border-radius: 10px; }
  .ks-what-t { font-size: 13px; font-weight: 800; margin-bottom: 2px; }
  @media (max-width: 900px) { .ks-team { grid-template-columns: 1fr; } }
  @media (max-width: 640px) { .ks-list { grid-template-columns: 1fr; } .ks-month { margin-left: 0; } .ks-item .ks-field .kmv { font-size: 18px; } }
</style>
</head>`);

/* 알림 표시 자리 (잘라낸 구역에 들어 있던 요소) */
if (!h.includes('id="toast"')) once('</main>', '</main>' + String.fromCharCode(10) + '<div class="toast" id="toast"></div>');

/* 8. 지표 계산·정의는 기존 파일의 블록을 그대로 쓴다 */
const perfStart = legacy.indexOf('<script>/* ============================================================\n   KPI·선행지표 정의와 계산');
const perfEnd = legacy.indexOf('</script>', perfStart);
if (perfStart < 0 || perfEnd < 0) throw new Error('perf block');
const perf = legacy.slice(perfStart, perfEnd + 9);

/* 9. 저장 연결 */
const bridge = fs.readFileSync(path.join(__dirname, 'b2b-bridge.js'), 'utf8').replace(/\r\n/g, '\n');
const initCall = '\ninit();\n</script>';
if (h.lastIndexOf(initCall) < 0) throw new Error('init');
{ const i = h.lastIndexOf(initCall); h = h.slice(0, i) + '\n' + bridge + '\nb2bBoot();\n</script>' + h.slice(i + initCall.length); }
{ const i = h.indexOf('<script>\n'); h = h.slice(0, i) + '<script>var SEED = {};</script>\n' + perf + '\n' + h.slice(i); }

/* 10. 다른 부서 정보가 남지 않았는지 검사 */
const banned = ['주현진', '신명희', '송보람', '김경미', '신수진', '김수진', '김영성', '김미연', '이지연', '임채명', 'data:image/jpeg'];
const left = banned.filter(w => h.includes(w));
if (left.length) console.log('남은 표현:', left.join(', '), left.map(w => (h.match(new RegExp(w, 'g')) || []).length).join(','));
const demoArg = process.argv.find(a => a.startsWith('--demo='));
if (demoArg) {
  const demo = JSON.parse(fs.readFileSync(demoArg.slice(7), 'utf8'));
  const script = `<script>
/* 시안 전용: 네트워크 없이 예시 데이터로만 동작하고 저장되지 않는다 */
b2bBoot = function () { const raw = ${JSON.stringify(demo).split("</").join("<\/")}; B2B.synced = copy(raw); B2B.shape = b2bNormalize(copy(raw)); DATA = toData(B2B.shape); b2bSetState('synced'); $('cloud-text').textContent = '시안 · 저장 안 됨'; updateFreqOptions(); renderAll(); };
fbWrite = function () { return Promise.resolve(); };
const _b2bFlush = b2bFlush; b2bFlush = function () { _b2bFlush(); setTimeout(() => { if ($('cloud-text')) $('cloud-text').textContent = '시안 · 저장 안 됨'; }, 30); };
</script>`;
  const tail = 'b2bBoot();\n</script>', i = h.lastIndexOf(tail);
  h = h.slice(0, i) + '</script>' + script + '<script>' + tail + h.slice(i + tail.length);
  h = h.replace(/<!DOCTYPE html>\s*<html[^>]*>\s*<head>/i, '').replace(/<\/head>\s*<body[^>]*>/i, '').replace(/<\/body>\s*<\/html>\s*$/i, '');
  h = h.replace('<title>B2B운영팀 업무 트래커</title>', '<title>B2B 트래커 수정안</title>');
  h = h.replace('<!-- ============== HEADER ============== -->', '<div style="background:#18211D;color:#fff;padding:8px 16px;font:600 13px sans-serif;">시안입니다. 예시 데이터로 동작하고 저장되지 않으며, 새로고침하면 처음 상태로 돌아갑니다.</div><!-- ============== HEADER ============== -->');
}
fs.writeFileSync(outFile || path.join(root, 'index.html'), h);
console.log('built', h.length);
