// 계산 규칙 시험 — index.html에 들어 있는 PerfCalc를 그대로 꺼내 실행한다.  node tests/perf-calc.test.cjs
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const block = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(b => b.includes('var PerfCalc'));
const ctx = { SEED: {} };
vm.runInNewContext(block, ctx);
const PC = ctx.PerfCalc, S = ctx.PERF_SEED;
let pass = 0;
const results = [];
function t(name, fn) { try { fn(); pass++; results.push('성공 ' + name); } catch (e) { results.push('실패 ' + name + ' — ' + e.message); process.exitCode = 1; } }
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, a + ' != ' + b);

function kpi(weights) {
  return { links: Object.keys(weights).map(li => ({ li })), weights: Object.fromEntries(Object.entries(weights).filter(([, w]) => w != null)) };
}
function getter(map) { return (li) => map[li] || null; }
const dir = v => ({ mode: 'direct', direct: v });
const auto = (num, den) => ({ mode: 'auto', num, den });

t('달성률 0% 입력', () => { const r = PC.rate(dir(0)); assert.equal(r.state, 'ok'); assert.equal(r.value, 0); assert.equal(r.mode, 'direct'); });
t('달성률 50% 입력', () => assert.equal(PC.rate(dir(50)).value, 50));
t('달성률 100% 입력', () => assert.equal(PC.rate(dir(100)).value, 100));
t('분자·분모 자동 계산은 자동으로 구분', () => { const r = PC.rate(auto(7, 10)); assert.equal(r.value, 70); assert.equal(r.mode, 'auto'); });
t('달성률은 0~100으로 제한', () => { assert.equal(PC.rate(auto(12, 10)).value, 100); assert.equal(PC.rate(dir(140)).value, 100); assert.equal(PC.rate(dir(-5)).value, 0); });
t('분모 0은 대상 없음', () => assert.equal(PC.rate(auto(0, 0)).state, 'empty'));
t('자료 없음은 미측정이고 0이 아님', () => { const r = PC.rate(null); assert.equal(r.state, 'none'); assert.equal(r.value, undefined); assert.equal(PC.rate({ mode: 'auto', den: 5 }).state, 'none'); assert.equal(PC.rate({ mode: 'direct' }).state, 'none'); });

t('명령서 예시: 100·80·60 / 30·30·40 = 78%', () => { const s = PC.score(kpi({ A: 30, B: 30, C: 40 }), 'm', getter({ A: dir(100), B: dir(80), C: dir(60) })); assert.equal(s.state, 'ok'); near(s.value, 78); });
t('달성률 80→100이면 선행점수 84%로 상승', () => near(PC.score(kpi({ A: 30, B: 30, C: 40 }), 'm', getter({ A: dir(100), B: dir(100), C: dir(60) })).value, 84));
t('달성률이 떨어지면 선행점수 하락', () => near(PC.score(kpi({ A: 30, B: 30, C: 40 }), 'm', getter({ A: dir(100), B: dir(50), C: dir(60) })).value, 69));
t('가중치 미설정은 산출 대기', () => { const s = PC.score(kpi({ A: 30, B: null }), 'm', getter({ A: dir(100), B: dir(80) })); assert.equal(s.state, 'wait'); assert.equal(s.code, 'unset'); });
t('가중치 합계 100% 아니면 산출 대기', () => { const s = PC.score(kpi({ A: 30, B: 30 }), 'm', getter({ A: dir(100), B: dir(80) })); assert.equal(s.state, 'wait'); assert.equal(s.code, 'sum'); assert.equal(s.total, 60); });
t('가중치 합계 소수 오차 허용', () => assert.ok(PC.weightStatus(kpi({ A: 33.33, B: 33.33, C: 33.34 })).sum100));
t('미측정 지표가 있으면 0으로 대체하지 않고 산출 대기', () => { const s = PC.score(kpi({ A: 50, B: 50 }), 'm', getter({ A: dir(100) })); assert.equal(s.state, 'wait'); assert.equal(s.code, 'none'); assert.deepEqual(Array.from(s.missing), ['B']); assert.equal(s.value, undefined); });
t('가중치 0인 지표는 미측정이어도 계산을 막지 않음', () => near(PC.score(kpi({ A: 100, B: 0 }), 'm', getter({ A: dir(60) })).value, 60));
t('대상 없음은 빼고 남은 가중치로 비례 재배분', () => { const s = PC.score(kpi({ A: 50, B: 50 }), 'm', getter({ A: dir(80), B: auto(0, 0) })); assert.equal(s.state, 'ok'); near(s.value, 80); assert.deepEqual(Array.from(s.excluded), ['B']); });
t('모든 지표가 대상 없음이면 점수 대상 없음', () => assert.equal(PC.score(kpi({ A: 100 }), 'm', getter({ A: auto(0, 0) })).state, 'empty'));
t('입력 중 초안 가중치로 미리 계산', () => near(PC.score(kpi({ A: 30, B: 70 }), 'm', getter({ A: dir(100), B: dir(0) }), { A: 50, B: 50 }).value, 50));
t('전월 대비 증감', () => { assert.equal(PC.delta(84, 78), 6); assert.equal(PC.delta(70, 78), -8); assert.equal(PC.delta(70, null), null); assert.equal(PC.delta(null, 70), null); });
t('전월 계산은 연도를 넘김', () => { assert.equal(PC.prevMonth('2026-01'), '2025-12'); assert.equal(PC.prevMonth('2026-11'), '2026-10'); assert.equal(PC.monthsBack('2026-02', 3).join(), '2026-02,2026-01,2025-12'); });
t('입력 검사: 분자>분모, 음수, 범위 초과, 분자만 입력 거부', () => { assert.ok(PC.validate(auto(5, 3)).length); assert.ok(PC.validate(auto(-1, 3)).length); assert.ok(PC.validate(dir(101)).length); assert.ok(PC.validate({ mode: 'auto', num: 3 }).length); assert.equal(PC.validate(auto(3, 3)).length, 0); assert.equal(PC.validate(auto(0, 0)).length, 0); });
t('보조 수치: 대기시간 감소율·비율, 자료 없으면 계산 안 함', () => { assert.equal(PC.derive({ from: ['a', 'b'], op: 'cut' }, { a: 10, b: 4 }), 60); assert.equal(PC.derive({ from: ['a', 'b'], op: 'ratio' }, { a: 1, b: 4 }), 25); assert.equal(PC.derive({ from: ['a', 'b'], op: 'ratio' }, { a: 1, b: 0 }), null); assert.equal(PC.derive({ from: ['a', 'b'], op: 'cut' }, { a: 1 }), null); });

// 등록 내용이 명령서와 맞는지
t('선행지표 9개·고유 ID·필수 항목', () => {
  assert.equal(S.leadDefs.length, 9);
  assert.equal(new Set(S.leadDefs.map(l => l.id)).size, 9);
  S.leadDefs.forEach(l => ['name', 'owner', 'purpose', 'cycle', 'measure', 'formula', 'denLabel', 'numLabel', 'src'].forEach(f => assert.ok(l[f], l.id + ' ' + f)));
});
t('선행지표 담당자는 모두 신한솔', () => S.leadDefs.forEach(l => assert.equal(l.owner, '신한솔', l.id)));
t('세부업무 수가 명령서와 일치', () => assert.deepEqual(S.leadDefs.map(l => l.tasks.length), [9, 9, 9, 11, 11, 10, 10, 10, 12]));
t('KPI별 연결이 명령서 3장과 일치', () => {
  const core = id => S.mainKpis.find(k => k.id === id).links.filter(l => l.rel === 'core').map(l => l.li).sort().join();
  assert.equal(core('MK1'), 'LI01,LI02,LI03,LI04,LI06');
  assert.equal(core('MK2'), 'LI04,LI05,LI06,LI07');
  assert.equal(core('MK3'), 'LI01,LI02,LI04,LI05,LI06');
});
t('초기 가중치: 핵심 연결은 미설정, 운영 지원지표는 0%, 점수는 산출 대기', () => {
  S.mainKpis.forEach(k => {
    assert.equal(k.memberWeights, undefined);
    k.links.forEach(l => { if (l.rel === 'core') assert.equal(k.weights[l.li], undefined); else assert.equal(k.weights[l.li], 0); });
    assert.equal(PC.score(k, '2026-11', () => null).code, 'unset');
  });
  ['LI08', 'LI09'].forEach(id => assert.ok(S.leadDefs.find(l => l.id === id).support));
});
t('후행지표 5개는 신한솔 개인 지표이고 KPI 실적을 참조하지 않음', () => { assert.equal(S.lagDefs.length, 5); S.lagDefs.forEach(g => { assert.equal(g.member, 'shs'); assert.equal(g.ref, undefined); assert.ok(g.denLabel && g.numLabel && g.formula, g.id); ['scope', 'denLabel', 'numLabel', 'formula'].forEach(f => assert.ok(/담당/.test(g[f]), g.id + ' ' + f)); }); });
t('선행지표 9개는 신한솔 개인 지표', () => S.leadDefs.forEach(l => assert.equal(l.member, 'shs', l.id)));
t('개인 점수는 그 팀원의 지표만 계산', () => {
  const k = kpi({ A: 30, B: 70, X: 100 }), only = li => li !== 'X';
  const s = PC.score(k, 'm', getter({ A: dir(100), B: dir(50) }), null, only);
  assert.equal(s.state, 'ok'); near(s.value, 65); assert.equal(s.rows.length, 2);
  assert.equal(PC.weightStatus(k, null, only).total, 100);
  near(PC.score(k, 'm', getter({ X: dir(40) }), null, li => li === 'X').value, 40);
});
const OK = v => ({ state: 'ok', value: v }), WAIT = { state: 'wait', reason: 'x' }, EMPTY = { state: 'empty' };
const team = (w, scores, draft) => PC.teamScore({ memberWeights: w }, Object.keys(scores), id => scores[id], draft);
t('팀 점수: 팀원 가중치 미설정이면 개인 점수를 그대로 쓰지 않고 산출 대기', () => { const s = team({}, { shs: OK(78) }); assert.equal(s.state, 'wait'); assert.equal(s.code, 'unset'); assert.equal(s.value, undefined); });
t('팀 점수: 팀원 가중치로 종합 (78×60% + 50×40% = 66.8)', () => near(team({ shs: 60, m1: 40 }, { shs: OK(78), m1: OK(50) }).value, 66.8));
t('팀 점수: 개인 점수가 오르면 함께 오름', () => { const a = team({ shs: 60, m1: 40 }, { shs: OK(78), m1: OK(50) }).value, b = team({ shs: 60, m1: 40 }, { shs: OK(84), m1: OK(50) }).value; near(b - a, 3.6); });
t('팀 점수: 합계 100% 아니면 산출 대기', () => assert.equal(team({ shs: 60, m1: 30 }, { shs: OK(78), m1: OK(50) }).code, 'sum'));
t('팀 점수: 반영 팀원의 개인 점수가 산출 대기면 팀도 산출 대기', () => { const s = team({ shs: 60, m1: 40 }, { shs: OK(78), m1: WAIT }); assert.equal(s.code, 'member'); assert.deepEqual(Array.from(s.missing), ['m1']); });
t('팀 점수: 가중치 0인 팀원은 대기여도 막지 않음', () => near(team({ shs: 100, m1: 0 }, { shs: OK(78), m1: WAIT }).value, 78));
t('팀 점수: 대상 없음 팀원은 빼고 비례 재배분', () => { const s = team({ shs: 60, m1: 40 }, { shs: OK(78), m1: EMPTY }); near(s.value, 78); assert.deepEqual(Array.from(s.excluded), ['m1']); });
t('팀 점수: 지표 등록 팀원이 없으면 산출 대기', () => assert.equal(team({}, {}).code, 'nomember'));
t('자동 연동으로 표시한 지표 없음', () => { S.leadDefs.concat(S.mainKpis).forEach(x => { assert.equal(x.src, '수동 관리'); assert.ok(/대기/.test(x.linkNote), x.id); }); });

console.log(results.join('\n'));
console.log(`\n${pass} / ${results.length} 성공`);
