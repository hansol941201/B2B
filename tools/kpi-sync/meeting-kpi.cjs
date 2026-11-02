/* 1·2차 미팅 누락 방지(LI01) 월별 집계 — 고객관리카드 classifyMeetingMiss 결과를 받아 분자·분모를 낸다.
   Apps Script(집계 서버)와 Node 시험이 같은 코드를 쓴다(ES5). 원본 데이터는 받지도 쓰지도 않는다.
     관리 대상(분모) = 기준일(예정일·완료일·등록 기한)이 기준월에 있는 미팅
     정상 관리(분자) = 그중 완료·정상 예정·등록 대기
   지난달 이전에 이미 누락·등록 지연이 되어 아직 남은 미팅(이월)은 비율에서 빼고(사용자 결정 2026-11-02)
   이번 달 계산에서 carried 건수로만 남긴다. 조율 중·지사 진행·날짜 확인도 분모에서 빼고 이번 달 건수로만
   남긴다. 예외(날짜 없는 완료)는 제외. */
/* KPI-SYNC-START */
var MeetingKpi = (function () {
  var OK = { done: 1, scheduled: 1, waiting: 1 }, MISS = { missed: 1, late: 1 }, CHECK = { coord: 1, branch: 1, format: 1 };
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function monthOf(ts) { var d = new Date(ts); return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
  function monthStart(month) { return new Date(+month.slice(0, 4), +month.slice(5, 7) - 1, 1).getTime(); }
  function prevMonth(month) { var d = new Date(+month.slice(0, 4), +month.slice(5, 7) - 2, 1); return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
  function emptyCounts() { return { done: 0, scheduled: 0, waiting: 0, missed: 0, late: 0, carried: 0, coord: 0, branch: 0, format: 0, exempt: 0 }; }
  function monthly(items, month, now) {
    var start = monthStart(month), current = monthOf(now) === month, c = emptyCounts(), num = 0, den = 0;
    items.forEach(function (it) {
      if (it.status === 'exempt') { c.exempt++; return; }
      if (CHECK[it.status]) { if (current) c[it.status]++; return; }
      if (it.due == null || !(OK[it.status] || MISS[it.status])) return;
      if (monthOf(it.due) !== month) {
        if (current && MISS[it.status] && it.due < start) c.carried++;
        return;
      }
      den++;
      c[it.status]++;
      if (OK[it.status]) num++;
    });
    return { num: num, den: den, counts: c };
  }
  // 다시 계산할 달: 이번 달, 그리고 오늘이 5일 이하면 지난달(그 뒤 지난달 값은 고정)
  function targetMonths(now) {
    var m = monthOf(now);
    return new Date(now).getDate() <= 5 ? [prevMonth(m), m] : [m];
  }
  return { monthOf: monthOf, monthly: monthly, targetMonths: targetMonths };
})();
/* KPI-SYNC-END */
if (typeof module !== 'undefined') module.exports = MeetingKpi;
