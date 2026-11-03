/**
 * 팀 공통 KPI 3개 → B2B 업무트래커 자동값 (통합 KPI 대시보드 Apps Script 프로젝트에 파일 하나로 넣는다)
 *
 * 하는 일: 대시보드가 이미 계산해 둔 결과(스크립트 캐시, 첫 화면 "KPI 관리"와 같은 값)를 읽어
 *          팀 KPI ①②③의 분자·분모(와 기준일 전후 비교값 cmp)만 트래커 shared/b2bOpsTracker/perfAuto/MK{1,2,3}_{월} 에 쓴다.
 * 하지 않는 일: 대시보드 다시 계산·캐시 쓰기, 시트·카드 읽기, 트래커의 다른 위치 쓰기, 업체명 전송.
 *   (편집기 Head 와 운영 배포가 다를 수 있어 직접 계산하지 않는다 — 운영 화면이 만든 캐시만 읽는다.)
 * 계산 기준(대시보드 대표 KPI, 2026-10-30 정의, 사용자 확정 2026-11-02):
 *   ① 첫 이용 업체(협약 후 60일 안 L3) ÷ 60일 관찰이 끝난 협약 업체      — kpi3.k1.after.hit / .done
 *   ② 60일 안 재활동 업체 ÷ 첫 이용 후 60일 관찰이 끝난 업체              — kpi3.k2.after.active / .done
 *   ③ 확인된 서비스 요청 건 ÷ 영업보고 건(업체+현장+공종)                  — kpi3.k3.after.sure / .n
 * 캐시가 없으면(최근 6시간 안에 대시보드 계산이 없으면) 그 회차는 쓰지 않는다. 트래커의 마지막 값은 그대로 둔다.
 * 실행: trackerPushCheck() = 계산 결과만 보여 줌(쓰지 않음), trackerPushRun() = 트래커에 씀(트리거용).
 */
function trackerPushCheck() { staffOnly_(); var r = TrackerPush.run(false); console.log(JSON.stringify(r)); return r; }
function trackerPushRun() { staffOnly_(); var r = TrackerPush.run(true); console.log(JSON.stringify(r)); return r; }

var TrackerPush = (function () {
  var TRACKER = 'https://b2b-task-tracker-39144-default-rtdb.asia-southeast1.firebasedatabase.app/shared/b2bOpsTracker.json';
  function pick_(K, at, month) {
    var rule = '통합 KPI 대시보드 대표 KPI · 기준일 ' + K.base + ' 이후 · 관찰 ' + K.obs + '일';
    var rec = function (ref, num, den, counts, cmp) {
      return { id: ref + '_' + month, ref: ref, month: month, mode: 'auto', num: num, den: den, counts: counts, cmp: cmp, source: '통합 KPI 대시보드', rule: rule, computedAt: at };
    };
    // 기준일 전후 비교 — 대시보드 "KPI 관리"의 '이전 대비'와 같은 식(같은 분자·분모, 이전 = 이후와 같은 길이의 기준일 직전 기간).
    // 분자·분모·기간과 세부 건수만 보낸다(업체명 없음).
    var per = K.per || {};
    var cmp = function (k, numKey, denKey, extra) {
      var side = function (p) { var o = K[k][p] || {}, r = { num: o[numKey] || 0, den: o[denKey] || 0 };
        (extra || []).forEach(function (x) { r[x] = o[x] || 0; }); if (per[p]) { r.from = per[p].from; r.to = per[p].to; } return r; };
      return { base: K.base, before: side('before'), after: side('after') };
    };
    var a1 = K.k1.after, a2 = K.k2.after, a3 = K.k3.after;
    var out = {};
    out['perfAuto/MK1_' + month] = rec('MK1', a1.hit, a1.done, { open: a1.open, openHit: a1.openHit }, cmp('k1', 'hit', 'done'));
    out['perfAuto/MK2_' + month] = rec('MK2', a2.active, a2.done, { open: a2.open, openActive: a2.openActive }, cmp('k2', 'active', 'done', ['site', 'plat']));
    out['perfAuto/MK3_' + month] = rec('MK3', a3.sure, a3.n, { cand: a3.cand, sameDay: a3.sameDay }, cmp('k3', 'sure', 'n', ['cand']));
    return out;
  }
  function run(write) {
    try {
      var c = readCache_();
      if (!c) return { ok: false, error: 'NO_CACHE: 최근 6시간 안에 대시보드 계산 결과가 없어 이번 회차는 쓰지 않음' };
      var d = JSON.parse(c.json), K = d.kpi3;
      if (!K || !K.k1 || !K.k2 || !K.k3) return { ok: false, error: 'FORMAT: 대시보드 결과에 대표 KPI(kpi3)가 없음' };
      var at = new Date(c.meta.at).toISOString();
      var month = Utilities.formatDate(new Date(c.meta.at), 'Asia/Seoul', 'yyyy-MM');
      var patch = pick_(K, at, month);
      if (write) {
        var res = UrlFetchApp.fetch(TRACKER, { method: 'patch', contentType: 'application/json', muteHttpExceptions: true, payload: JSON.stringify(patch) });
        if (res.getResponseCode() !== 200) return { ok: false, error: 'WRITE: 트래커 저장 실패 HTTP ' + res.getResponseCode() };
      }
      return { ok: true, wrote: !!write, computedAt: c.meta.computedAt, values: Object.keys(patch).map(function (k) { var v = patch[k]; return v.ref + ' ' + v.num + '/' + v.den; }) };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err).slice(0, 200) };
    }
  }
  return { run: run };
})();
