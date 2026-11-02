// 고객관리카드 index.html 에서 미팅 판정에 필요한 함수를 잘라 온다(카드 파일은 읽기만 한다).
// 집계 서버 빌드와 시험이 같은 목록을 쓴다 — 카드 판정이 바뀌면 빌드를 다시 해야 서버에 반영된다.
const CARD_FNS = [
  'getMouManualConfirm', 'isMouManuallyConfirmedRaw', 'isMouManuallyConfirmed', 'isAgreementInvalidated', 'isAgreementTerminated',
  'parsePartnerDateLabel', 'normCompanyNameForPartnerMatch', 'getPartnerNameIndex', 'findPartnerRecordForCompany',
  'resolveNewMouForCompany', 'resolvePartnerAgreementDate', 'getStageCorrections', 'findStageCorrection',
  'stageCorrectionToStateFields', 'buildProgressStages', 'getMouStage', 'isConfirmedPartner',
  'classifyWorkQueueMeeting', 'meetingMissTextKind', 'meetingCoordSince', 'classifyMeetingMiss',
];
const CARD_CONSTS = ['MEETING_MISS_GRACE_DAYS', 'MEETING_REG_LIMIT_DAYS', 'MEETING_COORD_LIMIT_DAYS'];

function cutFunction(html, name) {
  const i = html.indexOf(`function ${name}(`);
  if (i < 0) throw new Error('카드에서 함수를 찾지 못함: ' + name);
  if (html.indexOf(`function ${name}(`, i + 1) >= 0) throw new Error('같은 이름 함수가 둘 이상: ' + name);
  let d = 0, k = html.indexOf('{', html.indexOf(')', i)), str = null, esc = false;
  for (; k < html.length; k++) {
    const c = html[k];
    if (str) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === str) str = null; continue; }
    if (c === '"' || c === "'" || c === '`') { str = c; continue; }
    if (c === '/' && html[k + 1] === '/') { k = html.indexOf('\n', k); continue; }
    if (c === '{') d++;
    else if (c === '}') { d--; if (d === 0) break; }
  }
  return html.slice(i, k + 1);
}
function cutConst(html, name) {
  const m = new RegExp(`const ${name}\\s*=\\s*(\\d+);`).exec(html);
  if (!m) throw new Error('카드에서 상수를 찾지 못함: ' + name);
  return `var ${name} = ${m[1]};`;
}
// 서버·시험 공용 판정 블록. 전역에 CardLogic.collect(companies, snapshot, now) 를 만든다.
function cardLogicSource(html) {
  return [
    '/* CARD-LOGIC-START — 고객관리카드 index.html 원본 함수(자동 생성, 직접 고치지 말 것) */',
    'var window = { SHIN2_PARTNER_SNAPSHOT: [] };',
    'var _partnerNameIndexCache = null;',
    'function questionnaireMailSentLabel() { return null; } // 질문서 메일 발송은 미팅 판정에 쓰지 않는다',
    CARD_CONSTS.map(n => cutConst(html, n)).join('\n'),
    CARD_FNS.map(n => cutFunction(html, n)).join('\n'),
    'var D = { isAgreementInvalidated: isAgreementInvalidated, isMouManuallyConfirmed: isMouManuallyConfirmed, isAgreementTerminated: isAgreementTerminated };',
    'var CardLogic = {',
    '  rule: { grace: MEETING_MISS_GRACE_DAYS, reg: MEETING_REG_LIMIT_DAYS, coord: MEETING_COORD_LIMIT_DAYS },',
    '  // 카드 업무관리와 같은 대상(소프트 삭제 제외)으로 업체·미팅별 판정 목록을 만든다',
    '  collect: function (companies, snapshot, now) {',
    '    window.SHIN2_PARTNER_SNAPSHOT = snapshot || []; _partnerNameIndexCache = null;',
    '    var out = [];',
    '    (companies || []).forEach(function (co) {',
    '      if (!co || co.deletedAt) return;',
    '      classifyMeetingMiss(co, buildProgressStages(co), now).forEach(function (r) { out.push({ id: String(co.id), key: r.key, status: r.status, due: r.due }); });',
    '    });',
    '    return out;',
    '  }',
    '};',
    '/* CARD-LOGIC-END */',
  ].join('\n');
}
module.exports = { CARD_FNS, cutFunction, cardLogicSource };
