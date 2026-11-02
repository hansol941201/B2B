/**
 * B2B 업무트래커 KPI 자동 집계 서버 (Google Apps Script, 시간 트리거)
 *
 * 하는 일: 고객관리카드(Firebase pour-dashboard)의 업체 목록을 읽어 "1·2차 미팅 누락 방지"(LI01)
 *          분자·분모와 분류별 건수를 계산하고, B2B 업무트래커 shared/b2bOpsTracker/perfAuto 에만 쓴다.
 * 하지 않는 일: 카드 데이터 쓰기(GET 만), 트래커의 다른 위치 쓰기, 업체명·연락처 등 업체 정보 전송.
 *
 * 설정(스크립트 속성):
 *   CARD_PASSWORD  고객관리카드 공용(직원) 비밀번호 — 관리자 비밀번호가 아님
 * 실행: installTriggers() 를 한 번 실행하면 매일 07시·13시(한국 시간)에 runKpiSync 가 돈다.
 *       checkKpiSync() 는 계산만 하고 트래커에 쓰지 않는다(점검용).
 * 로그인에 실패하면 그 회차는 멈추고 다시 시도하지 않는다(공용 계정 잠금 방지). 트래커의 마지막 값은 그대로 둔다.
 *
 * 이 파일은 tools/kpi-sync/build-server.cjs 가 server.template.gs + 카드 원본 함수 + meeting-kpi.cjs 로 만든다 — 직접 고치지 말 것.
 */
var FIREBASE_API_KEY = 'AIzaSyDyQBXCc0WN4wFVsGBLZ6GXsyV0sGvyG34';          // 카드 firebaseConfig.js 공개 웹 설정(비밀값 아님)
var FIREBASE_PROJECT = 'pour-dashboard';
var CARD_ACCOUNT = 'hansol2-owner@pour-dashboard.firebaseapp.com';                  // 카드 공용 계정
var COMPANIES_DOC = 'shin2-companies-staging';
var CARD_HTML_URL = 'https://bridgeone-m.github.io/card/index.html';
var TRACKER_URL = 'https://b2b-task-tracker-39144-default-rtdb.asia-southeast1.firebasedatabase.app/shared/b2bOpsTracker.json';
var CARD_BUILD = 'd4a56ea';                      // 판정 함수를 잘라 온 카드 버전
var SYNC_HOURS = [7, 13];
/* CARD-LOGIC-START — 고객관리카드 index.html 원본 함수(자동 생성, 직접 고치지 말 것) */
var window = { SHIN2_PARTNER_SNAPSHOT: [] };
var _partnerNameIndexCache = null;
function questionnaireMailSentLabel() { return null; } // 질문서 메일 발송은 미팅 판정에 쓰지 않는다
var MEETING_MISS_GRACE_DAYS = 3;
var MEETING_REG_LIMIT_DAYS = 14;
var MEETING_COORD_LIMIT_DAYS = 30;
function getMouManualConfirm(co){
    const v = co && co.mouManualConfirm;
    return (v && typeof v === 'object') ? v : null;
  }
function isMouManuallyConfirmedRaw(co){
    const v = getMouManualConfirm(co);
    return !!(v && v.confirmed === true);
  }
function isMouManuallyConfirmed(co){
    if(isAgreementInvalidated(co)) return false;
    return isMouManuallyConfirmedRaw(co);
  }
function isAgreementInvalidated(co){
    const v = co && co.agreementInvalidated;
    return !!(v && typeof v === 'object' && v.at);
  }
function isAgreementTerminated(co){ return !!(co && co.agreementStatus === 'terminated'); }
function parsePartnerDateLabel(label){
    if(!label || label === 'X') return null;
    const m = String(label).match(/(\d{2,4})[.\-](\d{1,2})[.\-](\d{1,2})/);
    if(!m) return null;
    let y = parseInt(m[1],10); if(y < 100) y += 2000;
    const mo = parseInt(m[2],10), d = parseInt(m[3],10);
    const dt = new Date(y, mo-1, d);
    if(isNaN(dt.getTime())) return null;
    return { ts: dt.getTime(), display: y + '.' + String(mo).padStart(2,'0') + '.' + String(d).padStart(2,'0') };
  }
function normCompanyNameForPartnerMatch(s){
    if(!s) return '';
    let t = String(s).replace(/\(주\)|（주）|㈜|주식회사/g, '');
    t = t.replace(/[\s()\[\]㈱·\-_,.]/g, '');
    return t.trim().toLowerCase();
  }
function getPartnerNameIndex(){
    if(_partnerNameIndexCache) return _partnerNameIndexCache;
    const idx = new Map();
    (window.SHIN2_PARTNER_SNAPSHOT || []).forEach(p=>{
      const key = normCompanyNameForPartnerMatch(p.name);
      if(!key) return;
      if(!idx.has(key)) idx.set(key, []);
      idx.get(key).push(p);
    });
    _partnerNameIndexCache = idx;
    return idx;
  }
function findPartnerRecordForCompany(co){
    const key = normCompanyNameForPartnerMatch(co && co.name);
    if(!key) return null;
    const hits = getPartnerNameIndex().get(key);
    if(!hits || hits.length !== 1) return null; // 모호(동명 여러 건)하면 연결하지 않는다
    return hits[0];
  }
function resolveNewMouForCompany(co){
    if(D.isAgreementInvalidated(co)) return null;   // §협약 무효 처리 — 원본은 남기고 판정에서만 뺀다
    if(co.partnerDashboard && co.partnerDashboard.newMou) return co.partnerDashboard.newMou;
    const rec = findPartnerRecordForCompany(co);
    return (rec && rec.newMou) || null;
  }
function resolvePartnerAgreementDate(co){
    if(D.isAgreementInvalidated(co)) return null;   // §협약 무효 처리
    if(co.partnerDashboard && co.partnerDashboard.progressSyncedAt){
      const nm = co.partnerDashboard.newMou || {};
      return nm.mouDone ? (nm.mouLabel || nm.mou || null) : null;
    }
    if(co.partnerDashboard && co.partnerDashboard.mouDate) return co.partnerDashboard.mouDate;
    const rec = findPartnerRecordForCompany(co);
    return (rec && rec.mouDate) || null;
  }
function getStageCorrections(co){
    return (co.partnerDashboard && co.partnerDashboard.stageCorrections) || {};
  }
function findStageCorrection(co, keys){
    // §협약 무효 처리 — MOU 체결 정정도 무효 처리 업체에는 적용하지 않는다(정정 기록 자체는 보존).
    if(keys.indexOf('mouDone') >= 0 && D.isAgreementInvalidated(co)) return null;
    const corrections = getStageCorrections(co);
    for(let i=0;i<keys.length;i++){ if(corrections[keys[i]]) return corrections[keys[i]]; }
    return null;
  }
function stageCorrectionToStateFields(corr){
    if(!corr) return null;
    return {
      state: corr.status === 'done' ? 'done' : (corr.status === 'scheduled' ? 'scheduled' : 'waiting'),
      dateDisplay: corr.dateText || '—',
      scheduledLabel: corr.status === 'scheduled' ? (corr.dateText || null) : null,
      owner: corr.owner || null,
      // §미팅 시각 라운드 — 정정으로 저장한 시각(timeText)도 그대로 실어 나른다.
      scheduledTime: corr.timeText || null,
      // §상태 동기화 점검 — 예전엔 항상 null이라 탭에서 등록한 MOU/미팅이 경과일 판정
      // (관리필요·의지박약·MOU 진행상황 경과)에서 빠졌다. 날짜 문자열에서 그대로 계산한다.
      ts: (()=>{ const p = corr.dateText ? parsePartnerDateLabel(corr.dateText) : null; return p && typeof p.ts === 'number' ? p.ts : null; })()
    };
  }
function buildProgressStages(co){
    const sourceNm = resolveNewMouForCompany(co);
    const nm = sourceNm || {};
    const now = Date.now();
    // §업무관리 협약체결 판정 누락 라운드 §1/§2 — 최종 협약완료 = newMou.mouDone(①신규
    // 파이프라인 자체 신호) OR partnerList의 실제 협약체결일(②resolvePartnerAgreementDate,
    // 위 참고) 존재. ②만 있고 ①은 false/없음인 성일피앤씨 같은 "이미 정식 협력업체"가
    // 실제 사례다. agreementDateLabel은 실제로 존재하는 값이라 지어내는 게 아니다(§ "협약일을
    // 미팅일로 복사"는 여전히 금지 — 아래서 q/m1/m2에는 날짜를 절대 옮기지 않고 mou 단계
    // 자신에게만 쓴다).
    const agreementDateLabel = resolvePartnerAgreementDate(co);
    function dateState(label){
      const p = parsePartnerDateLabel(label);
      if(!p) return { state:'waiting', dateDisplay:'—', ts:null };
      return { state: p.ts <= now ? 'done' : 'scheduled', dateDisplay: p.display, ts: p.ts };
    }
    const q = (()=>{
      const reply = parsePartnerDateLabel(nm.qReplyLabel);
      if(reply) return { state:'done', dateDisplay: reply.display, ts: reply.ts };
      const sent = parsePartnerDateLabel(nm.qSentLabel);
      if(sent) return { state:'waiting', dateDisplay: sent.display, ts: sent.ts }; // 발송만 되고 회신 대기
      // §질문서 발송 상태 연결 — 동기화 발송일이 없으면 CRM에서 성공 발송한 질문서 메일 기록.
      const mailSent = parsePartnerDateLabel(questionnaireMailSentLabel(co));
      if(mailSent) return { state:'waiting', dateDisplay: mailSent.display, ts: mailSent.ts, viaMail:true };
      return { state:'waiting', dateDisplay:'—', ts:null };
    })();
    // §협력사 동기화 라운드 §6: m1Scheduled/m2Scheduled(예정일, 완료일 m1Label/m2Label과는
    // 별도 필드 — partner-dashboard 실제 구조 확인)이 있으면 state/dateDisplay/ts는 전혀
    // 안 바꾸고 scheduledLabel/owner만 얹는다(기존 stage 객체 읽던 코드는 그대로 동작,
    // "이미 일정이 잡혀 있는데 다시 제안이라고 표시" 방지는 computeNextActionLabel에서만
    // 추가로 처리).
    // §partner-dashboard 진행정보 동기화 라운드 §1/§2/§4 — 실제 조사 결과: m1Label/m2Label은
    // "완료일"이고, "예정일"은 별도 필드(m1Scheduled/m1ScheduledLabel, §협력사 동기화
    // 라운드에서 이미 확인)다. 지금까지는 이 예정 필드를 stage.state에는 전혀 반영하지 않고
    // scheduledLabel/owner로만 얹어놨었다(computeNextActionLabel만 별도로 읽던 상태) — 그
    // 결과 완료일이 없는데 예정일만 있는 업체가 카드/목록 어디서나 "대기 —"로 보이는 실제
    // 버그가 있었다(고객카드는 stage.state만 읽지 scheduledLabel을 안 읽었다). 이제 완료가
    // 아니면서 예정일이 있으면 state를 'scheduled'로, dateDisplay/ts도 예정일 기준으로
    // 바꾼다 — buildProgressStages 하나만 고치면 이걸 읽는 모든 화면(고객카드/목록 배지/
    // 다음 행동/업무관리)이 자동으로 같은 값을 쓴다(§4 "공통 함수로 source of truth 통일").
    function withScheduleOverride(base, scheduledLabel, owner, scheduledTime){
      // §미팅 시각 라운드(신규) — 시각은 날짜 라벨 문자열에 섞지 않고 별도 필드로만 들고
      // 다닌다. parsePartnerDateLabel이 라벨에서 날짜만 뽑아 display를 다시 만들기 때문에
      // 라벨에 시각을 붙이면 표시에서 사라지고, 상태 판정(stageDateAutoStatus)도 라벨을
      // 파싱하므로 형식을 흐리지 않는 편이 안전하다.
      const result = Object.assign({}, base, { scheduledLabel: scheduledLabel || null, owner: owner || null, scheduledTime: scheduledTime || null });
      if(result.state !== 'done' && scheduledLabel){
        const p = parsePartnerDateLabel(scheduledLabel);
        if(p){ result.state = 'scheduled'; result.dateDisplay = p.display; result.ts = p.ts; }
      }
      return result;
    }
    const m1 = withScheduleOverride(dateState(nm.m1Label), nm.m1ScheduledLabel, nm.m1Owner, nm.m1ScheduledTime);
    const m2 = withScheduleOverride(dateState(nm.m2Label), nm.m2ScheduledLabel, nm.m2Owner, nm.m2ScheduledTime);
    if(co.partnerDashboard && co.partnerDashboard.progressSyncedAt){
      if(nm.qReplyDone || nm.qReplySkipped) q.state = 'done';
      if(nm.m1Done || nm.m1Skipped) m1.state = 'done';
      if(nm.m2Done || nm.m2Skipped) m2.state = 'done';
    }
    const mou = (()=>{
      if(nm.mouDone){
        const p = parsePartnerDateLabel(nm.mouLabel);
        return { state:'done', dateDisplay: p ? p.display : '완료', ts: p ? p.ts : now };
      }
      // §업무관리 협약체결 판정 누락 라운드 §2 — newMou 파이프라인 자체엔 mouDone 신호가
      // 없어도(또는 false), partnerList의 실제 협약체결일이 있으면 그걸로 done 처리한다.
      // mouLabel(신규 파이프라인 필드)에는 전혀 쓰지 않고 이 stage 객체의 dateDisplay/ts만
      // agreementDateLabel 기준으로 채운다 — 원본 필드를 바꿔치기하지 않는다.
      if(agreementDateLabel){
        const p = parsePartnerDateLabel(agreementDateLabel);
        return { state:'done', dateDisplay: p ? p.display : '완료', ts: p ? p.ts : now };
      }
      return dateState(nm.mouLabel);
    })();
    // §MOU 체결 업체의 단계 판정 예외 처리 라운드 §1~§3: 1·2차 미팅 없이 바로 MOU를
    // 체결하는 자회사/특수 업체가 실제로 있다(원본에 질문서/미팅 기록 자체가 없음). 지금까지는
    // mou만 done이고 q/m1/m2는 그대로 dateState(원본 날짜 라벨)로만 계산돼, 이런 업체가
    // 고객카드/업무관리에서 앞 단계가 "대기"인 미진행 업체처럼 보였다. mouDone===true(원본의
    // 실제 서명완료 신호)면 상태 계산 우선순위 최상단에서 q/m1/m2를 전부 done으로 간주한다 —
    // 이미 실제 날짜(dateState)로 done 판정된 단계는 그 날짜를 그대로 두고, 날짜가 없던
    // 단계만 dateDisplay '—'/ts null을 유지한 채 상태만 done으로 바꾼다(§2 "실제 날짜는 절대
    // 만들지 않기" — MOU 날짜를 앞 단계로 복사하지 않고, qSentLabel/m1Label/m2Label 같은
    // 원본 필드에도 전혀 쓰지 않는다. co에는 이 결과를 저장하지 않는다 — 매번 다시 계산하는
    // 화면 표시용 값일 뿐이다, §7).
    const mouDoneFlag = !!nm.mouDone || !!agreementDateLabel;
    function applyMouDoneException(stage){
      if(!mouDoneFlag || stage.state === 'done') return stage;
      return Object.assign({}, stage, { state:'done' });
    }
    const stages = [
      { key:'q', label:'질문서', ...applyMouDoneException(q) },
      { key:'m1', label:'1차미팅', ...applyMouDoneException(m1) },
      { key:'m2', label:'2차미팅', ...applyMouDoneException(m2) },
      { key:'mou', label:'MOU', ...mou }
    ];
    // §협약 진행단계 수정·완료 취소 라운드(신규) — 정정 레이어는 mouDoneFlag 예외 처리보다도
    // 나중에, 즉 가장 마지막에 적용한다(사용자가 명시적으로 되돌린 값이 최종 진실 — MOU가
    // 외부 원본에서 여전히 완료로 남아있어도 그걸로 다시 덮어써지지 않는다). buildAgreementStageRows
    // 쪽의 더 세분화된(qSend/qReply, m1Scheduled/m1Done, m2Scheduled/m2Done) 정정 중 "완료" 계열을
    // 우선 반영해 이 4단계 진행바(고객카드·업무관리 배지 등 공유 화면)에도 같은 정정이 보이게 한다.
    // §상태 동기화 점검 — 발송(qSend) 정정만 있으면 "회신 대기"(날짜는 발송일)로 둔다. 예전엔
    // 발송만 등록해도 질문서가 완료로 잡혀 MOU 진행상황엔 "1차미팅 잡기", 탭엔 "회신 대기"로 어긋났다.
    const qCorrFields = (()=>{
      const c = getStageCorrections(co);
      if(c.qReply) return stageCorrectionToStateFields(c.qReply);
      if(!c.qSend) return null;
      const f = stageCorrectionToStateFields(c.qSend);
      if(f && f.state === 'done'){ f.state = 'waiting'; f.qSendOnly = true; }
      return f;
    })();
    const correctionOverrides = {
      q: qCorrFields,
      m1: stageCorrectionToStateFields(findStageCorrection(co, ['m1Done','m1Scheduled'])),
      m2: stageCorrectionToStateFields(findStageCorrection(co, ['m2Done','m2Scheduled'])),
      mou: stageCorrectionToStateFields(findStageCorrection(co, ['mouDone']))
    };
    // §미팅 완료 반영 수정 라운드(신규) — 협약 진행 탭에서 등록한 "예정"(m1Scheduled/m2Scheduled)
    // 정정이, 그 뒤 MOU 진행상황·알림의 [미팅 완료 처리]로 완료된 미팅을 계속 "예정"으로 덮어
    // 진행 바·체결 상태가 안 바뀌던 문제. 완료 정정(m1Done/m2Done)이 따로 없고 원래 값이 이미
    // "완료"면 예정 정정보다 완료를 따른다. 완료 취소 등 완료 키 정정은 지금처럼 그대로 우선한다.
    const stageCorrMap = getStageCorrections(co);
    const SCHED_ONLY_DONE_KEY = { m1:'m1Done', m2:'m2Done' };
    const correctedStages = stages.map(s=>{
      const ov = correctionOverrides[s.key];
      if(!ov) return s;
      const doneKey = SCHED_ONLY_DONE_KEY[s.key];
      if(doneKey && !stageCorrMap[doneKey] && s.state === 'done' && ov.state !== 'done') return s;
      if(s.key === 'q' && ov.qSendOnly && s.state === 'done') return s;   // 원본에 회신이 있으면 회신 우선
      return Object.assign({}, s, ov, { corrected:true });
    });
    // 현재 단계(§6): 마지막으로 완료된 단계의 "다음" 단계. 전부 완료면 MOU, 전부 대기면 질문서.
    let lastDoneIdx = -1;
    correctedStages.forEach((s,i)=>{ if(s.state === 'done') lastDoneIdx = i; });
    const currentIdx = lastDoneIdx === -1 ? 0 : Math.min(lastDoneIdx + 1, correctedStages.length - 1);
    // §업무관리 협약체결 판정 누락 라운드: sourceNm(newMou)이 아예 없어도 agreementDateLabel
    // (실제 협약체결일)만 있는 업체도 "데이터 없음"으로 취급하지 않는다 — 진행정보 자체가
    // 존재하는데도 이 값 하나만으로 progress 전체가 무시되는 걸 막는다.
    return { stages: correctedStages, currentIdx, hasAny: !!sourceNm || !!agreementDateLabel || !!q.viaMail || Object.keys(stageCorrMap).length > 0 };
  }
function getMouStage(progress){
    return progress.stages.find(s=> s.key === 'mou') || null;
  }
function isConfirmedPartner(co, progress){
    if(D.isMouManuallyConfirmed && D.isMouManuallyConfirmed(co)) return true;   // ①
    const mou = getMouStage(progress);
    return !!(progress && progress.hasAny && mou && mou.state === 'done');      // ②
  }
function classifyWorkQueueMeeting(progress, co){
    if(!progress.hasAny) return null;
    const byKey = {}; progress.stages.forEach(s=> byKey[s.key] = s);
    if(byKey.mou.state === 'done') return null; // MOU 완료 업체는 미팅/MOU 행동 없음(§7 예시)
    if(co && isConfirmedPartner(co, progress)) return null; // §상태 동기화 점검 — 수동 MOU 확정도 MOU 완료로(공식 판정)
    // 질문서 회신 전은 이 화면 판정 대상 아님(§6 전제조건) — 단 1·2차가 이미 잡혔거나 끝난
    // 업체(협약 진행 탭에서 회신 기록 없이 등록)는 다음 행동이 사라지지 않게 그대로 판정한다.
    if(byKey.q.state !== 'done' && byKey.m1.state === 'waiting' && byKey.m2.state === 'waiting') return null;
    if(byKey.m1.state !== 'done'){
      // §partner-dashboard 진행정보 동기화 라운드 §6 — 예전엔 예정일이 있으면 그냥 목록에서
      // 빠졌다(§ "1차미팅 잡기" 대상만 아님). 그러면 일정을 잡아둔 업체가 업무관리 어디에도
      // 안 보이는 실제 문제(㈜제일도장 사례)가 있어, "예정된 미팅"이라는 별도 type으로
      // 계속 보여준다 — 새 날짜/담당 데이터가 아니라 byKey.m1.scheduledLabel/owner(이미
      // buildProgressStages가 계산해 둔 값)만 그대로 넘긴다.
      if(byKey.m1.scheduledLabel) return { type:'m1Scheduled', label:'일정 확인', anchor: byKey.m1, stageLabel:'1차미팅 예정', scheduledLabel: byKey.m1.scheduledLabel, scheduledTime: byKey.m1.scheduledTime, owner: byKey.m1.owner };
      return { type:'m1', label:'1차미팅 잡기', anchor: byKey.q, stageLabel:'질문서 완료' };
    }
    if(byKey.m2.state !== 'done'){
      if(byKey.m2.scheduledLabel) return { type:'m2Scheduled', label:'일정 확인', anchor: byKey.m2, stageLabel:'2차미팅 예정', scheduledLabel: byKey.m2.scheduledLabel, scheduledTime: byKey.m2.scheduledTime, owner: byKey.m2.owner };
      return { type:'m2', label:'2차미팅 잡기', anchor: byKey.m1, stageLabel:'1차미팅 완료' };
    }
    return { type:'mou', label:'MOU 진행', anchor: byKey.m2, stageLabel:'2차미팅 완료' };
  }
function meetingMissTextKind(text){
    const s = String(text || '');
    if(/지사/.test(s)) return 'branch';
    if(/조율|예정|미정|협의|잡는\s*중/.test(s)) return 'coord';
    return 'format';
  }
function meetingCoordSince(text, now){
    const m = String(text || '').match(/(\d{1,2})[.\/](\d{1,2})/);
    if(!m) return null;
    const ref = new Date(now);
    let d = new Date(ref.getFullYear(), parseInt(m[1],10) - 1, parseInt(m[2],10));
    if(isNaN(d.getTime())) return null;
    if(d.getTime() > now) d = new Date(ref.getFullYear() - 1, parseInt(m[1],10) - 1, parseInt(m[2],10));
    return d.getTime();
  }
function classifyMeetingMiss(co, progress, now){
    const out = [];
    if(!co || D.isAgreementTerminated(co) || !progress || !progress.stages) return out;
    const DAY = 86400000;
    const nm = resolveNewMouForCompany(co) || {};
    const byKey = {}; progress.stages.forEach(s=> byKey[s.key] = s);
    const need = classifyWorkQueueMeeting(progress, co); // 지금 잡아야 할 미팅 — 업무관리와 같은 판정
    ['m1','m2'].forEach(key=>{
      const st = byKey[key];
      if(!st) return;
      if(st.state === 'done'){
        out.push(typeof st.ts === 'number' ? { key, status:'done', due:st.ts } : { key, status:'exempt', due:null });
        return;
      }
      if(st.state === 'scheduled' && typeof st.ts === 'number'){
        const days = Math.floor((now - st.ts) / DAY); // 예정일 다음 날 = 1일
        out.push({ key, status: days > MEETING_MISS_GRACE_DAYS ? 'missed' : 'scheduled', due:st.ts, days });
        return;
      }
      // 날짜로 읽히지 않는 글(단계 보정이 있으면 원본 글은 보지 않는다)
      const raw = st.corrected ? [] : [nm[key + 'Label'], nm[key + 'ScheduledLabel']]
        .filter(v=> v != null && String(v).trim() !== '' && v !== 'X');
      if(raw.length){
        const text = raw.join(' '), kind = meetingMissTextKind(text);
        if(kind === 'coord'){
          const since = meetingCoordSince(text, now);
          const days = since != null ? Math.floor((now - since) / DAY) : null;
          if(days != null && days > MEETING_COORD_LIMIT_DAYS){
            out.push({ key, status:'late', due: since + MEETING_COORD_LIMIT_DAYS * DAY, days, text });
            return;
          }
        }
        out.push({ key, status:kind, due:null, text });
        return;
      }
      if(need && need.type === key){
        const a = need.anchor && typeof need.anchor.ts === 'number' ? need.anchor.ts : null;
        if(a == null){ out.push({ key, status:'format', due:null, text:'기준일 없음' }); return; }
        const days = Math.floor((now - a) / DAY);
        out.push({ key, status: days > MEETING_REG_LIMIT_DAYS ? 'late' : 'waiting', due: a + MEETING_REG_LIMIT_DAYS * DAY, days });
      }
    });
    return out;
  }
var D = { isAgreementInvalidated: isAgreementInvalidated, isMouManuallyConfirmed: isMouManuallyConfirmed, isAgreementTerminated: isAgreementTerminated };
var CardLogic = {
  rule: { grace: MEETING_MISS_GRACE_DAYS, reg: MEETING_REG_LIMIT_DAYS, coord: MEETING_COORD_LIMIT_DAYS },
  // 카드 업무관리와 같은 대상(소프트 삭제 제외)으로 업체·미팅별 판정 목록을 만든다
  collect: function (companies, snapshot, now) {
    window.SHIN2_PARTNER_SNAPSHOT = snapshot || []; _partnerNameIndexCache = null;
    var out = [];
    (companies || []).forEach(function (co) {
      if (!co || co.deletedAt) return;
      classifyMeetingMiss(co, buildProgressStages(co), now).forEach(function (r) { out.push({ id: String(co.id), key: r.key, status: r.status, due: r.due }); });
    });
    return out;
  }
};
/* CARD-LOGIC-END */
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
      var inMonth = monthOf(it.due) === month;
      var carried = current && !inMonth && MISS[it.status] && it.due < start;
      if (!inMonth && !carried) return;
      den++;
      c[it.status]++;
      if (carried) c.carried++;
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
function ruleText_() { return '카드 미팅 판정 · 유예 ' + CardLogic.rule.grace + '일 · 등록 기한 ' + CardLogic.rule.reg + '일 · 조율 기한 ' + CardLogic.rule.coord + '일 (카드 ' + CARD_BUILD + ')'; }

function runKpiSync() { return syncOnce_(true); }
function checkKpiSync() { var r = syncOnce_(false); console.log(JSON.stringify(r)); return r; }
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'runKpiSync') ScriptApp.deleteTrigger(t); });
  SYNC_HOURS.forEach(function (h) { ScriptApp.newTrigger('runKpiSync').timeBased().atHour(h).everyDays(1).inTimezone('Asia/Seoul').create(); });
  return SYNC_HOURS;
}

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
