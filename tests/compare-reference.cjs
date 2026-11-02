// 참고 사이트와 새 화면을 같은 크기로 띄워 스타일 수치를 비교하고 나란히 캡처한다. 운영 DB에는 접속하지 않는다.
//   NODE_PATH=<playwright> E2E_CHROME=<chrome> node tests/compare-reference.cjs <참고 html> <기준 데이터 JSON> <결과 폴더>
const { chromium } = require('playwright'), { spawn } = require('child_process'), fs = require('fs'), path = require('path');
const [refFile, base, out] = process.argv.slice(2), P = 5190, B = `http://localhost:${P}`;
fs.mkdirSync(out, { recursive: true });
const SEL = ['body', '.brand-mark', '.brand-sub', '.today-pill', '.hero-title', '.hero-sub', '.team-kpi-card', '.team-kpi-input', '.hero-kpi', '.hero-kpi-label', '.hero-kpi-value', '.tabs-wrap', '.tab', '.tab.active', '.section-title', '.today-grid', '.today-grid > *', '.member-kpi-line', '.action-btn.project'];
const PROPS = ['fontFamily', 'fontSize', 'fontWeight', 'color', 'backgroundColor', 'borderRadius', 'paddingTop', 'paddingLeft'];
const measure = p => p.evaluate(([sels, props]) => {
  const o = {};
  sels.forEach(s => { const e = document.querySelector(s); if (!e) { o[s] = null; return; } const c = getComputedStyle(e), r = e.getBoundingClientRect(), v = { w: Math.round(r.width), h: Math.round(r.height) }; props.forEach(k => { v[k] = c[k]; }); o[s] = v; });
  return o;
}, [SEL, PROPS]);
async function openRef(br, viewport, mobile) {
  const c = await br.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
  // 참고 사이트는 외부 쓰기를 막은 빈 브라우저에서만 연다
  await c.route('**/*', r => { const q = r.request(); if (q.method() !== 'GET' || /firebasedatabase|firebaseio/.test(q.url())) return r.abort(); return r.continue(); });
  const p = await c.newPage(); p.on('dialog', d => d.dismiss());
  await p.goto('https://pourservice.github.io/service-task-tracker/', { waitUntil: 'load' }); await p.waitForTimeout(1800);
  return p;
}
async function openNew(br, viewport, mobile) {
  const c = await br.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
  const p = await c.newPage(); p.on('dialog', d => d.dismiss());
  await p.goto(B + '/'); await p.waitForFunction(() => /동기화|오프라인/.test((document.querySelector('#cloud-text') || {}).textContent || ''), null, { timeout: 15000 }); await p.waitForTimeout(600);
  return p;
}
async function pair(br, name, a, b, wide) {
  const img = f => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
  const p = await (await br.newContext({ viewport: { width: wide ? 1500 : 800, height: 900 } })).newPage();
  await p.setContent(`<body style="margin:0;background:#333;font:700 18px sans-serif;color:#fff"><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:12px"><div>참고 사이트<br><img src="${img(a)}" style="width:100%;margin-top:6px"></div><div>수정안<br><img src="${img(b)}" style="width:100%;margin-top:6px"></div></div></body>`);
  await p.waitForTimeout(250);
  await p.screenshot({ path: path.join(out, name + '.png'), fullPage: true });
  await p.context().close();
}
(async () => {
  const sv = spawn(process.execPath, [path.join(__dirname, 'mock-server.cjs'), String(P), base], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 500));
  const br = await chromium.launch({ executablePath: process.env.E2E_CHROME });
  const lines = [];
  for (const [tag, vp, mobile] of [['PC', { width: 1320, height: 900 }, false], ['모바일', { width: 375, height: 812 }, true]]) {
    const a = await openRef(br, vp, mobile), b = await openNew(br, vp, mobile);
    const ma = await measure(a), mb = await measure(b);
    let same = 0, total = 0; const diff = [];
    SEL.forEach(s => {
      if (!ma[s] || !mb[s]) { diff.push(s + ': ' + (ma[s] ? '수정안에 없음' : '참고에 없음')); return; }
      PROPS.concat(['w']).forEach(k => {
        // 너비만 비교한다. 높이는 내용 길이에 따라 달라진다
        total++; if (ma[s][k] === mb[s][k]) same++; else diff.push(s + ' ' + k + ': ' + ma[s][k] + ' → ' + mb[s][k]);
      });
    });
    lines.push(`[${tag}] 스타일 값 일치 ${same} / ${total}`); diff.forEach(d => lines.push('  ' + d));
    const tabs = [['today', 'today', '오늘'], ['detail', 'detail', '멤버별상세'], ['kpi', 'kpi', 'KPI체계'], ['automation', 'automation', '앱도구'], ['manage', 'manage', '전체업무']];
    for (const [ra, nb, nm] of tabs) {
      await a.click(`.tab[data-page="${ra}"]`); await b.click(`.tab[data-page="${nb}"]`);
      await a.waitForTimeout(250); await b.waitForTimeout(250);
      const clip = await a.evaluate(() => { const r = document.querySelector('.tabs-wrap').getBoundingClientRect(); return Math.max(0, r.top + scrollY - 10); });
      await a.evaluate(y => scrollTo(0, y), clip); await b.evaluate(y => scrollTo(0, y), clip);
      const fa = path.join(out, `_r_${tag}_${nm}.png`), fb = path.join(out, `_n_${tag}_${nm}.png`);
      await a.screenshot({ path: fa }); await b.screenshot({ path: fb });
      await pair(br, `비교_${tag}_${nm}`, fa, fb, !mobile);
    }
    await a.evaluate(() => scrollTo(0, 0)); await b.evaluate(() => scrollTo(0, 0));
    for (const [fnName, nm] of [['openProjectModal', '프로젝트팝업'], ['openRoutineModal', '루틴팝업']]) {
      await a.evaluate(n => window[n] ? window[n]() : eval(n + '()'), fnName); await b.evaluate(n => window[n] ? window[n]() : eval(n + '()'), fnName);
      await a.waitForTimeout(250); await b.waitForTimeout(250);
      const fa = path.join(out, `_r_${tag}_${nm}.png`), fb = path.join(out, `_n_${tag}_${nm}.png`);
      await a.screenshot({ path: fa }); await b.screenshot({ path: fb });
      await pair(br, `비교_${tag}_${nm}`, fa, fb, !mobile);
      await a.evaluate(() => closeModal()); await b.evaluate(() => closeModal());
    }
    await a.goto('https://pourservice.github.io/service-task-tracker/'); await a.waitForTimeout(1200);
    await a.screenshot({ path: path.join(out, `_r_${tag}_첫화면.png`) });
    await b.reload(); await b.waitForTimeout(1200);
    await b.screenshot({ path: path.join(out, `_n_${tag}_첫화면.png`) });
    await pair(br, `비교_${tag}_첫화면`, path.join(out, `_r_${tag}_첫화면.png`), path.join(out, `_n_${tag}_첫화면.png`), !mobile);
    await a.context().close(); await b.context().close();
  }
  fs.writeFileSync(path.join(out, '비교_수치.txt'), lines.join('\n') + '\n');
  console.log(lines.join('\n'));
  await br.close(); sv.kill();
})().catch(e => { console.error('실패', e.message.slice(0, 500)); process.exit(1); });
