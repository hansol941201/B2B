/**
 * B2B 업무트래커 KPI 자동 집계 서버 (Google Apps Script, 시간 트리거)
 *
 * 하는 일: 고객관리카드(Firebase pour-dashboard)의 업체 목록을 읽어 "1·2차 미팅 누락 방지"(LI01)
 *          분자·분모와 분류별 건수를 계산하고, B2B 업무트래커 shared/b2bOpsTracker/perfAuto 에만 쓴다.
 * 하지 않는 일: 카드 데이터 쓰기(GET 만), 트래커의 다른 위치 쓰기, 업체명·연락처 등 업체 정보 전송.
 *
 * 설정(스크립트 속성):
 *   CARD_PASSWORD  고객관리카드 공용(직원) 비밀번호 — 관리자 비밀번호가 아님
 * 실행: kpiSyncInstallTriggers() 를 한 번 실행하면 매일 07시·13시(한국 시간)에 kpiSyncRun 이 돈다.
 *       kpiSyncCheck() 는 계산만 하고 트래커에 쓰지 않는다(점검용).
 * 다른 Apps Script 프로젝트(같은 CARD_PASSWORD 를 쓰는 협력사 현황 서버)에 파일 하나로 넣어도 되도록
 * 밖으로 드러나는 이름은 kpiSync… 함수 3개와 KpiSync 하나뿐이다. 다른 프로젝트의 트리거는 건드리지 않는다.
 * 로그인에 실패하면 그 회차는 멈추고 다시 시도하지 않는다(공용 계정 잠금 방지). 트래커의 마지막 값은 그대로 둔다.
 *
 * 이 파일은 tools/kpi-sync/build-server.cjs 가 server.template.gs + 카드 원본 함수 + meeting-kpi.cjs 로 만든다 — 직접 고치지 말 것.
 */
// 편집기는 열린 파일의 맨 위 함수를 기본으로 실행한다 — 쓰기 없는 점검 실행을 맨 위에 둔다.
function kpiSyncCheck() { var r = KpiSync.sync(false); console.log(JSON.stringify(r)); return r; }
function kpiSyncRun() { return KpiSync.sync(true); }
function kpiSyncInstallTriggers() { return KpiSync.install(); }

var KpiSync = (function () {
var FIREBASE_API_KEY = '__FIREBASE_API_KEY__';          // 카드 firebaseConfig.js 공개 웹 설정(비밀값 아님)
var FIREBASE_PROJECT = 'pour-dashboard';
var CARD_ACCOUNT = '__CARD_ACCOUNT__';                  // 카드 공용 계정
var COMPANIES_DOC = 'shin2-companies-staging';
var CARD_HTML_URL = 'https://bridgeone-m.github.io/card/index.html';
var TRACKER_URL = 'https://b2b-task-tracker-39144-default-rtdb.asia-southeast1.firebasedatabase.app/shared/b2bOpsTracker.json';
var CARD_BUILD = '__CARD_BUILD__';                      // 판정 함수를 잘라 온 카드 버전
var SYNC_HOURS = [7, 13];

function installTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'kpiSyncRun') ScriptApp.deleteTrigger(t); });
  SYNC_HOURS.forEach(function (h) { ScriptApp.newTrigger('kpiSyncRun').timeBased().atHour(h).everyDays(1).inTimezone('Asia/Seoul').create(); });
  return SYNC_HOURS;
}
// __CARD_LOGIC__
// __KPI_LOGIC__
function ruleText_() { return '카드 미팅 판정 · 유예 ' + CardLogic.rule.grace + '일 · 등록 기한 ' + CardLogic.rule.reg + '일 · 조율 기한 ' + CardLogic.rule.coord + '일 (카드 ' + CARD_BUILD + ')'; }

// 계산하고(write 이면) 트래커에 쓴다. 실패해도 예외를 밖으로 던지지 않고 상태만 남긴다.
function syncOnce_(write) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return status_({ ok: false, error: 'BUSY: 다른 실행이 진행 중' });
  try {
    var now = Date.now();
    var companies = readCompaniesDoc_();
    var snapshot = loadPartnerSnapshot_();
    if (snapshot === null) throw new Error('READ: 카드 참조 명단을 읽지 못함');
    var items = CardLogic.collect(companies, snapshot, now);
    var patch = {}, rule = ruleText_(), at = new Date(now).toISOString();
    MeetingKpi.targetMonths(now).forEach(function (m) {
      var r = MeetingKpi.monthly(items, m, now);
      patch['perfAuto/LI01_' + m] = { id: 'LI01_' + m, ref: 'LI01', month: m, mode: 'auto', num: r.num, den: r.den, counts: r.counts, source: '고객관리카드', rule: rule, computedAt: at };
    });
    if (write) {
      var res = UrlFetchApp.fetch(TRACKER_URL, { method: 'patch', contentType: 'application/json', muteHttpExceptions: true, payload: JSON.stringify(patch) });
      if (res.getResponseCode() !== 200) throw new Error('WRITE: 트래커 저장 실패 HTTP ' + res.getResponseCode());
    }
    return status_({ ok: true, wrote: !!write, at: at, months: Object.keys(patch).map(function (k) { var v = patch[k]; return v.month + ' ' + v.num + '/' + v.den; }), patch: patch });
  } catch (err) {
    console.error(err && err.stack || err);
    return status_({ ok: false, error: String(err && err.message || err).slice(0, 200) });
  } finally { lock.releaseLock(); }
}
function status_(o) {
  o.checkedAt = new Date().toISOString();
  var keep = {}; Object.keys(o).forEach(function (k) { if (k !== 'patch') keep[k] = o[k]; });
  try { PropertiesService.getScriptProperties().setProperty('KPI_SYNC_LAST', JSON.stringify(keep)); } catch (e) {}
  return o;
}

// ---- 고객관리카드 읽기(REST, GET 만) ----
function idToken_() {
  var pw = PropertiesService.getScriptProperties().getProperty('CARD_PASSWORD');
  if (!pw) throw new Error('CONFIG: CARD_PASSWORD 스크립트 속성이 없습니다.');
  var res = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + FIREBASE_API_KEY, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ email: CARD_ACCOUNT, password: pw, returnSecureToken: true })
  });
  if (res.getResponseCode() !== 200) throw new Error('AUTH: 로그인 실패 HTTP ' + res.getResponseCode() + ' — 다음 예약 시각까지 다시 시도하지 않음');
  var j = JSON.parse(res.getContentText());
  return { idToken: j.idToken, uid: j.localId };
}
function readCompaniesDoc_() {
  var tok = idToken_();
  var url = 'https://firestore.googleapis.com/v1/projects/' + FIREBASE_PROJECT + '/databases/(default)/documents/users/'
    + encodeURIComponent(tok.uid) + '/shin2/' + COMPANIES_DOC;
  var res = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + tok.idToken } });
  if (res.getResponseCode() !== 200) throw new Error('READ: 업체 목록 조회 실패 HTTP ' + res.getResponseCode());
  var fields = (JSON.parse(res.getContentText()).fields) || {};
  var value = fields.value ? fsValue_(fields.value) : null;
  if (!Array.isArray(value)) throw new Error('READ: 업체 목록 형식 오류');
  return value;
}
// Firestore REST 값 → 일반 JS 값
function fsValue_(v) {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return ((v.arrayValue && v.arrayValue.values) || []).map(fsValue_);
  if ('mapValue' in v) {
    var f = (v.mapValue && v.mapValue.fields) || {}, o = {};
    Object.keys(f).forEach(function (k) { o[k] = fsValue_(f[k]); });
    return o;
  }
  return null;
}
// 카드 HTML 에 내장된 협력사 참조 명단(window.SHIN2_PARTNER_SNAPSHOT) — 판정 함수가 협약·미팅 날짜를 보완할 때 쓴다
function loadPartnerSnapshot_() {
  var res = UrlFetchApp.fetch(CARD_HTML_URL, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return null;
  return extractPartnerSnapshot_(res.getContentText());
}
function extractPartnerSnapshot_(html) {
  var at = html.indexOf('window.SHIN2_PARTNER_SNAPSHOT = [');
  if (at < 0) return [];
  var start = html.indexOf('[', at), d = 0, k = start, s = false, e = false;
  for (; k < html.length; k++) {
    var c = html[k];
    if (s) { if (e) e = false; else if (c === '\\') e = true; else if (c === '"') s = false; continue; }
    if (c === '"') s = true; else if (c === '[') d++; else if (c === ']') { d--; if (d === 0) break; }
  }
  try { return JSON.parse(html.slice(start, k + 1)); } catch (err) { return null; }
}
return { sync: syncOnce_, install: installTriggers_ };
})();
