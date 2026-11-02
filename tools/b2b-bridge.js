/* ============================================================
   B2B 연결 — 화면은 참고 트래커 코드를 쓰고, 저장은 B2B Firebase 구조에 맞춘다.
   - 저장 원본: shared/b2bOpsTracker (기존 팀원·프로젝트·루틴·지표 그대로)
   - 문서 전체를 덮어쓰지 않고 바뀐 항목만 "컬렉션/항목" 경로로 보낸다.
   ============================================================ */
const FB_URL = "https://b2b-task-tracker-39144-default-rtdb.asia-southeast1.firebasedatabase.app";
const FB_PATH = "shared/b2bOpsTracker", FB_SDK_VER = "10.12.5", FB_POLL_MS = 2000;
const FB_SINGLE = ["meta", "bid", "perfConfig"];
const FB_BY_ID = ["members", "programs", "projects", "workKpis", "kpis", "automations", "links", "mainKpis", "leadDefs", "lagDefs", "perfMonthly", "perfHistory", "routineChecks"];
const FB_BY_MEMBER = ["routines", "personal"];
const KEY_PENDING_B2B = "netform.b2b.tracker.pending.v1", KEY_ACTOR_B2B = "netform.b2b.tracker.actor.v1";
const PC = PerfCalc, TEAM_ID = "team_b2b";
const MEMBER_COLORS = ["#1B5E6E", "#B89968", "#2E7D52", "#B4651E", "#5B4B8A", "#B83A2E"];
const CY_TO_FREQ = { "일": "daily", "주": "weekly", "월": "monthly", "분기": "quarterly", "연": "yearly", "년": "yearly" };
const FREQ_TO_CY = { daily: "일", weekly: "주", monthly: "월", quarterly: "분기", yearly: "연" };
const B2B = { shape: null, synced: null, pending: null, writing: 0, seq: 0, mode: null, sdk: null, root: null, state: "connecting", poll: null, retry: null, deferred: false };
const copy = o => o === undefined ? undefined : JSON.parse(JSON.stringify(o));

/* 서버는 키를 정렬하고 빈 값을 저장하지 않으므로 그 기준으로 같은지 본다 */
function canon(v) {
  const norm = x => {
    if (x === null || x === undefined) return undefined;
    if (Array.isArray(x)) { const a = x.map(norm).filter(y => y !== undefined); return a.length ? a : undefined; }
    if (typeof x === "object") { const o = {}; Object.keys(x).sort().forEach(k => { const y = norm(x[k]); if (y !== undefined) o[k] = y; }); return Object.keys(o).length ? o : undefined; }
    return x;
  };
  return JSON.stringify(norm(v));
}

/* ---------- 원격 → 작업 데이터 ---------- */
function b2bNormalize(s) {
  ["members", "projects", "routines", "programs", "links", "automations", "perfMonthly", "perfHistory", "routineChecks"].forEach(k => { if (!s[k]) s[k] = {}; });
  const bySeed = (col, keyList) => { (PERF_SEED[col] || []).forEach(x => { if (!s[col][x.id]) s[col][x.id] = copy(x); }); };
  ["mainKpis", "leadDefs", "lagDefs"].forEach(c => { if (!s[c]) s[c] = {}; bySeed(c); });
  if (!s.perfConfig) s.perfConfig = copy(PERF_SEED.perfConfig);
  Object.values(s.leadDefs).forEach(l => { if (!l.member) l.member = "shs"; });
  Object.values(s.lagDefs).forEach(g => {
    if (!g.member) g.member = "shs";
    const seed = (PERF_SEED.lagDefs || []).find(x => x.id === g.id) || {};
    ["owner", "src", "linkNote"].forEach(f => { if (!g[f] && seed[f]) g[f] = seed[f]; });
    ["formula", "denLabel", "numLabel", "scope", "outcome"].forEach(f => { if (seed[f]) g[f] = seed[f]; });
    delete g.ref;
  });
  if (!s.members.shs && Object.values(s.leadDefs).some(l => l.member === "shs")) s.members.shs = { id: "shs", name: "신한솔", role: "매니저", color: "#8A4E9E", focus: "", scope: "" };
  return s;
}
function subStatus(t) { const p = Number(t.p) || 0; return t.st || (p >= 100 ? "done" : p > 0 ? "doing" : "todo"); }
function toData(s) {
  const members = Object.values(s.members).sort((a, b) => a.id < b.id ? -1 : 1).map((m, i) => ({ id: m.id, teamId: TEAM_ID, name: String(m.name || "").trim(), role: m.role || "", color: m.color || MEMBER_COLORS[i % MEMBER_COLORS.length], isAlba: false, kpi: m.kpi || "", _raw: m }));
  const tasks = Object.values(s.projects).map(p => {
    const subs = (p.tasks || []).map((t, i) => ({ id: t.id || (p.id + "_s" + i), title: t.t || "(이름 없음)", progress: Number(t.p) || 0, status: subStatus(t), lastUpdatedAt: t.u || "", _raw: t }));
    const avg = subs.length ? Math.round(subs.reduce((a, x) => a + x.progress, 0) / subs.length) : (Number(p.progress) || 0);
    const up = (p.updatedAt || "").slice(0, 10);
    return { id: p.id, memberId: p.owner, title: p.name || "", taskType: p.taskType || "project", priority: p.priority || "mid", status: p.status === "hold" ? "hold" : avg >= 100 ? "done" : avg > 0 ? "doing" : "todo", progress: avg, subtasks: subs, startDate: p.startDate || "", dueDate: p.dueDate || "", createdAt: p.createdAt || up, lastUpdatedAt: up, completedAt: p.completedAt || null, note: p.note || "", _raw: p };
  });
  const routines = [];
  Object.keys(s.routines).forEach(mid => {
    if (!s.members[mid]) return; // 팀원 목록에 없는 담당의 루틴은 건드리지 않는다
    (s.routines[mid] || []).forEach(r => { if (r) {
      const frequency = r.frequency || CY_TO_FREQ[r.cy] || "daily";
      routines.push({ id: r.id, memberId: mid, title: r.t || "", frequency, weekdays: r.weekdays || (frequency === "weekly" ? [1] : []), monthDay: r.monthDay || 1, yearMonth: r.yearMonth || 1, active: r.active !== false, assignee: r.assignee || "member", createdAt: r.createdAt || "", _raw: r });
    } });
  });
  const dashboards = Object.values(s.links).map(l => ({ id: l.id, title: l.name || "", owner: l.owner || "", purpose: l.d || "", appUrl: l.url || "", htmlUrl: l.htmlUrl || "", thumbnail: l.thumbnail || "", tags: l.cat ? [l.cat] : [], createdAt: l.createdAt || 0, _raw: l }));
  return { teams: [{ id: TEAM_ID, name: (s.meta && s.meta.team) || "B2B운영팀", color: "#1B5E6E", icon: "🏢", kpi: (s.meta && s.meta.goal) || "" }], members, tasks, routines, routineChecks: Object.values(s.routineChecks), dashboards, manuals: [], kpiPlan: { teamGoals: [], kpis: [] } };
}

/* ---------- 작업 데이터 → 원격 모양 ---------- */
function fromData() {
  const s = B2B.shape, d = DATA, now = new Date().toISOString();
  const nextMembers = {};
  d.members.forEach(m => {
    const raw = copy(m._raw) || { id: m.id, focus: "", scope: "" };
    if (String(raw.name || "").trim() !== m.name) raw.name = m.name;
    raw.role = m.role;
    if (m.kpi) raw.kpi = m.kpi; else delete raw.kpi;
    if (m._raw ? m._raw.color : false) raw.color = m.color; else if (!m._raw) raw.color = m.color;
    nextMembers[m.id] = raw;
  });
  s.members = nextMembers;
  const nextProjects = {};
  d.tasks.forEach(t => {
    const base = copy(t._raw) || { id: t.id, prog: Object.keys(s.programs).sort()[0] || "", note: "" };
    const next = copy(base);
    next.id = t.id; next.name = t.title; next.owner = t.memberId; next.note = t.note || base.note || "";
    if (t.taskType && t.taskType !== "project") next.taskType = t.taskType; else delete next.taskType;
    if (t.priority && t.priority !== "mid") next.priority = t.priority; else delete next.priority;
    ["startDate", "dueDate", "createdAt", "completedAt"].forEach(f => { if (t[f]) next[f] = t[f]; else delete next[f]; });
    if (t.status === "hold") next.status = "hold"; else delete next.status;
    next.tasks = (t.subtasks || []).map(x => {
      const o = copy(x._raw) || { id: x.id, n: "", r: "" };
      o.t = x.title === "(이름 없음)" ? "" : x.title;
      o.p = Number(x.progress) || 0;
      const auto = o.p >= 100 ? "done" : o.p > 0 ? "doing" : "todo";
      if (x.status !== auto) o.st = x.status; else delete o.st;
      return o;
    });
    if (!next.tasks.length) { delete next.tasks; if (t.progress) next.progress = t.progress; else delete next.progress; } else delete next.progress;
    const strip = o => { const c = copy(o); delete c.updatedAt; delete c.updatedBy; return c; };
    if (canon(strip(next)) !== canon(strip(base)) || !t._raw) { next.updatedAt = now; next.updatedBy = b2bActor(""); }
    nextProjects[t.id] = next;
  });
  s.projects = nextProjects;
  Object.keys(s.routines).forEach(mid => { if (s.members[mid]) s.routines[mid] = []; });
  d.routines.forEach(r => {
    const raw = copy(r._raw) || { id: r.id, done: false };
    raw.t = r.title; raw.cy = FREQ_TO_CY[r.frequency] || raw.cy;
    raw.frequency = r.frequency;
    if (r.frequency === "weekly" && !(r.weekdays.length === 1 && r.weekdays[0] === 1 && !raw.weekdays)) raw.weekdays = r.weekdays; else delete raw.weekdays;
    /* 기본값은 저장하지 않아 기존 루틴 모양을 바꾸지 않는다 */
    if (["monthly", "quarterly", "yearly"].includes(r.frequency) && r.monthDay && r.monthDay !== 1) raw.monthDay = r.monthDay; else delete raw.monthDay;
    if (r.frequency === "yearly" && r.yearMonth && r.yearMonth !== 1) raw.yearMonth = r.yearMonth; else delete raw.yearMonth;
    if (r.active === false) raw.active = false; else delete raw.active;
    if (r.assignee && r.assignee !== "member") raw.assignee = r.assignee; else delete raw.assignee;
    (s.routines[r.memberId] = s.routines[r.memberId] || []).push(raw);
  });
  /* 기존 루틴은 빈도 칸을 늘리지 않는다: 원래 값과 같으면 원래 모양 유지 */
  Object.keys(s.routines).forEach(mid => { (s.routines[mid] || []).forEach(raw => { if (CY_TO_FREQ[raw.cy] === raw.frequency) delete raw.frequency; }); });
  const checks = {}; d.routineChecks.forEach(c => { checks[c.id] = c; }); s.routineChecks = checks;
  const links = {};
  (d.dashboards || []).forEach(x => {
    const raw = copy(x._raw) || { id: x.id };
    raw.name = x.title; raw.d = x.purpose || ""; raw.url = x.appUrl || "";
    if (x.owner) raw.owner = x.owner; else delete raw.owner;
    if (x.htmlUrl) raw.htmlUrl = x.htmlUrl; else delete raw.htmlUrl;
    if (x.thumbnail) raw.thumbnail = x.thumbnail; else delete raw.thumbnail;
    raw.cat = (x.tags || [])[0] || raw.cat || "";
    links[x.id] = raw;
  });
  s.links = links;
  if (d.teams[0] && s.meta && d.teams[0].kpi !== s.meta.goal) s.meta.goal = d.teams[0].kpi;
}
function diffShape(oldS, newS) {
  const patch = {}; oldS = oldS || {};
  FB_SINGLE.forEach(k => { if (canon(oldS[k]) !== canon(newS[k])) patch[k] = newS[k] === undefined ? null : newS[k]; });
  FB_BY_ID.concat(FB_BY_MEMBER).forEach(k => {
    const om = oldS[k] || {}, nm = newS[k] || {};
    Object.keys(nm).forEach(id => { if (canon(om[id]) !== canon(nm[id])) patch[k + "/" + id] = nm[id]; });
    Object.keys(om).forEach(id => { if (!(id in nm)) patch[k + "/" + id] = null; });
  });
  return Object.keys(patch).length ? patch : null;
}
function mergeInto(target, patch) {
  target = target || {};
  Object.keys(patch).forEach(key => {
    const i = key.indexOf("/");
    if (i < 0) { target[key] = patch[key]; return; }
    const c = key.slice(0, i), id = key.slice(i + 1);
    if (!target[c]) target[c] = {};
    if (patch[key] === null) delete target[c][id]; else target[c][id] = patch[key];
  });
  return target;
}

/* ---------- 전송 ---------- */
function b2bSetState(st) {
  B2B.state = st;
  const t = $("cloud-text"), i = $("cloud-icon");
  if (t) t.textContent = { connecting: "연결 중", synced: "동기화 완료", saving: "저장 중", error: "연결 오류 · 재시도", offline: "오프라인" }[st] || st;
  if (i) i.textContent = st === "synced" ? "☁️" : st === "error" || st === "offline" ? "⚠️" : "⏳";
}
function fbWrite(patch) {
  if (B2B.mode === "sdk" && B2B.sdk && B2B.root) return B2B.sdk.update(B2B.root, patch);
  return fetch(FB_URL + "/" + FB_PATH + ".json", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }).then(r => { if (!r.ok) throw new Error("HTTP " + r.status); });
}
function fbRead() {
  if (B2B.mode === "sdk" && B2B.sdk && B2B.root) return B2B.sdk.get(B2B.root).then(s => s.val());
  return fetch(FB_URL + "/" + FB_PATH + ".json", { cache: "no-store" }).then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
}
function b2bFlush() {
  const shape = copy(B2B.shape), patch = diffShape(B2B.synced, shape);
  if (patch) B2B.pending = Object.assign({}, B2B.pending || {}, patch);
  if (!B2B.pending) { b2bSetState("synced"); return; }
  const sending = B2B.pending;
  try { localStorage.setItem(KEY_PENDING_B2B, JSON.stringify(sending)); } catch (e) {}
  b2bSetState("saving");
  B2B.writing++; B2B.seq++;
  fbWrite(sending).then(() => {
    B2B.writing--; B2B.seq++;
    B2B.synced = mergeInto(B2B.synced || {}, copy(sending));
    if (B2B.pending === sending) { B2B.pending = null; try { localStorage.removeItem(KEY_PENDING_B2B); } catch (e) {} }
    b2bSetState("synced");
  }).catch(() => {
    B2B.writing--; B2B.seq++;
    b2bSetState("error");
    clearTimeout(B2B.retry);
    B2B.retry = setTimeout(b2bFlush, 3000);
  });
}
function b2bActive() {
  const a = document.activeElement;
  return a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable) && a.closest("main");
}
function b2bApplyRemote(raw) {
  if (!raw) return;
  if (B2B.synced && canon(raw) === canon(B2B.synced)) return; // 내가 방금 올린 것의 메아리
  B2B.synced = copy(raw);
  B2B.shape = b2bNormalize(copy(raw));
  DATA = toData(B2B.shape);
  if (b2bActive()) { B2B.deferred = true; return; } // 입력 중인 칸을 빼앗지 않는다
  renderAll();
  if (UI.b2bInd && !UI.b2bIndDirty) b2bDrawInd();
}
document.addEventListener("focusout", () => { setTimeout(() => { if (B2B.deferred && !b2bActive()) { B2B.deferred = false; renderAll(); } }, 0); });
function b2bPollTick() {
  if (B2B.writing) return;
  const seq = B2B.seq;
  fbRead().then(raw => {
    if (B2B.state === "error" || B2B.state === "offline") b2bSetState(B2B.pending ? "saving" : "synced");
    if (B2B.pending || B2B.writing || seq !== B2B.seq) return; // 저장 전에 읽은 옛 값으로 덮어쓰지 않는다
    b2bApplyRemote(raw);
  }).catch(() => b2bSetState(B2B.pending ? "error" : "offline"));
}
function b2bStartPoll() { B2B.mode = "rest"; clearInterval(B2B.poll); B2B.poll = setInterval(b2bPollTick, FB_POLL_MS); }
function b2bBoot() {
  b2bSetState("connecting");
  const sdk = Promise.race([
    Promise.all([import("https://www.gstatic.com/firebasejs/" + FB_SDK_VER + "/firebase-app.js"), import("https://www.gstatic.com/firebasejs/" + FB_SDK_VER + "/firebase-database.js")]).then(m => {
      const app = m[0].initializeApp({ databaseURL: FB_URL }), db = m[1].getDatabase(app);
      B2B.sdk = m[1]; B2B.root = m[1].ref(db, FB_PATH); B2B.mode = "sdk";
      return new Promise((resolve, reject) => {
        let first = true;
        m[1].onValue(B2B.root, s => { if (first) { first = false; resolve(s.val()); } else b2bApplyRemote(s.val()); }, reject);
      });
    }),
    new Promise((_, rej) => setTimeout(() => rej(new Error("sdk timeout")), 6000))
  ]);
  return sdk.catch(() => { b2bStartPoll(); return fbRead(); }).then(raw => {
    B2B.synced = copy(raw) || {};
    B2B.shape = b2bNormalize(copy(raw) || {});
    let pend = null;
    try { pend = JSON.parse(localStorage.getItem(KEY_PENDING_B2B) || "null"); } catch (e) {}
    if (pend) { mergeInto(B2B.shape, pend); B2B.pending = pend; }
    DATA = toData(B2B.shape);
    b2bSetState(pend ? "saving" : "synced");
    if (pend) b2bFlush();
  }).catch(() => {
    B2B.shape = b2bNormalize({}); B2B.synced = {};
    DATA = toData(B2B.shape);
    b2bSetState("offline");
    if (!B2B.poll) b2bStartPoll();
  }).then(() => { updateFreqOptions(); renderAll(); });
}
/* 참고 트래커의 저장 지점을 B2B 저장으로 바꾼다 */
save = function () { fromData(); DATA = toData(B2B.shape); b2bFlush(); };
load = function () {};
loadSampleData = clearAll = importData = function () { toast("이 기능은 사용하지 않습니다"); };
exportData = function () {
  const blob = new Blob([JSON.stringify(B2B.shape, null, 2)], { type: "application/json" }), a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "b2b-tracker-" + today() + ".json"; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000); toast("JSON 파일을 내려받았습니다");
};
updateCloudStatusUI = function () {};
function b2bActor(fallback) { let v = ""; try { v = localStorage.getItem(KEY_ACTOR_B2B) || ""; } catch (e) {} return v || fallback || "미입력"; }

/* 프로젝트 저장 충돌 방지: 수정 창을 연 뒤 다른 사람이 저장했으면 확인을 받는다 */
const _openProjectModal = openProjectModal, _submitProjectModal = submitProjectModal;
openProjectModal = function (id) { _openProjectModal(id); UI.b2bProj = id ? { id, at: (B2B.shape.projects[id] || {}).updatedAt || "" } : null; };
submitProjectModal = function () {
  const b = UI.b2bProj;
  if (b && ((B2B.shape.projects[b.id] || {}).updatedAt || "") !== b.at && !confirm("다른 사용자가 먼저 이 프로젝트를 저장했습니다.\n\n확인: 내 입력으로 덮어쓰기\n취소: 저장하지 않고 입력 유지")) return;
  _submitProjectModal();
};
/* 담당 업무가 있는 팀원은 지우지 않는다 */
deleteMember = deleteMemberQuick = function (id) {
  const has = DATA.tasks.some(t => t.memberId === id) || DATA.routines.some(r => r.memberId === id) || Object.values(B2B.shape.leadDefs).some(l => l.member === id);
  if (has) return toast("담당 업무나 지표가 있어 삭제할 수 없습니다");
  if (!confirm("이 팀원을 삭제합니다. 계속할까요?")) return;
  DATA.members = DATA.members.filter(m => m.id !== id); save(); renderAll();
};
deleteTeam = addTeam = function () {};

/* ---------- 전체 업무 관리: 검색·담당 필터 ---------- */
const _renderManagePage = renderManagePage;
renderManagePage = function () {
  _renderManagePage();
  const q = ($("b2b-task-q") ? $("b2b-task-q").value : "").trim().toLowerCase(), who = $("b2b-task-who") ? $("b2b-task-who").value : "";
  const sel = $("b2b-task-who");
  if (sel) { const v = sel.value; sel.innerHTML = '<option value="">전체 담당자</option>' + DATA.members.map(m => `<option value="${m.name}">${escapeHtml(m.name)}</option>`).join(""); sel.value = v; }
  ["manage-task-tbody", "manage-routine-tbody"].forEach(id => {
    const body = $(id); if (!body) return;
    Array.from(body.children).forEach(tr => { const t = tr.innerText.toLowerCase(); tr.style.display = (!q || t.includes(q)) && (!who || t.includes(who.toLowerCase())) ? "" : "none"; });
  });
};
function b2bFilterTasks() { renderManagePage(); }

/* ---------- 지표 값 저장 ---------- */
function b2bMonth() { if (!UI.kpiMonth) { const d = new Date(), m = d.getMonth() + 1; UI.kpiMonth = d.getFullYear() + "-" + (m < 10 ? "0" : "") + m; } return UI.kpiMonth; }
function b2bRec(ref, month) { return B2B.shape.perfMonthly[ref + "_" + month] || null; }
function b2bRate(ref, month) { return PC.rate(b2bRec(ref, month)); }
function b2bDef(ref) { const s = B2B.shape; return s.mainKpis[ref] || s.leadDefs[ref] || s.lagDefs[ref] || null; }
function b2bLis(mid) { const o = {}; Object.values(B2B.shape.leadDefs).forEach(l => { if (l.member === mid) o[l.id] = 1; }); return li => !!o[li]; }
function b2bMembersOf(k) { const out = []; (k.links || []).forEach(l => { const d = B2B.shape.leadDefs[l.li]; if (d && d.member && !out.includes(d.member)) out.push(d.member); }); return out; }
function b2bMemberScore(k, mid, month, draft) { return PC.score(k, month, b2bRec, draft, b2bLis(mid)); }
function b2bTeamScore(k, month, draft) { return PC.teamScore(k, b2bMembersOf(k), mid => b2bMemberScore(k, mid, month), draft); }
function b2bHist(h) { const id = "H" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); h.id = id; h.at = new Date().toISOString(); B2B.shape.perfHistory[id] = h; }
function b2bPct(v) { return PC.round1(v); }
function b2bMemberName(id) { const m = B2B.shape.members[id]; return m ? String(m.name || "").trim() : id; }
function b2bSetVal(ref, field, el) {
  const month = b2bMonth(), def = b2bDef(ref), cur = b2bRec(ref, month), rev = cur ? (cur.rev || 0) : 0;
  const raw = (el.value || "").trim(), val = raw === "" ? null : Number(raw);
  if (el.dataset.rev !== undefined && +el.dataset.rev !== rev && !confirm((cur && cur.updatedBy || "다른 사용자") + "님이 먼저 저장했습니다. 내 값으로 덮어쓸까요?")) { renderKpiPage(); return; }
  const next = cur ? copy(cur) : { id: ref + "_" + month, ref, month, mode: "auto" };
  const oldV = next.mode === "direct" ? null : next[field];
  if (val === null) delete next[field]; else next[field] = val;
  if (next.mode === "direct") { next.mode = "auto"; delete next.direct; }
  const errs = PC.validate({ mode: "auto", den: next.den == null ? null : next.den, num: next.num == null ? null : next.num });
  if (val !== null && (isNaN(val) || val < 0)) errs.unshift("0 이상의 숫자를 입력해 주세요.");
  if (errs.length && !(field === "num" && next.den == null)) { toast(errs[0].replace("분자가 분모보다", "완료 수가 대상 수보다")); renderKpiPage(); if (UI.b2bInd) b2bDrawInd(); return; }
  next.updatedAt = new Date().toISOString(); next.updatedBy = b2bActor(def && def.owner); next.rev = rev + 1;
  B2B.shape.perfMonthly[next.id] = next;
  b2bHist({ ref, month, kind: "value", by: next.updatedBy, summary: "실적 변경", changes: [{ f: field === "den" ? (def.denLabel || "대상 수") : (def.numLabel || "완료 수"), from: oldV == null ? "미입력" : String(oldV), to: val == null ? "미입력" : String(val) }] });
  DATA = toData(B2B.shape); b2bFlush(); renderAll(); if (UI.b2bInd) b2bDrawInd();
}
function b2bSetTarget(ref, el) {
  const def = b2bDef(ref), raw = (el.value || "").trim(), val = raw === "" ? null : Number(raw);
  if (val !== null && (isNaN(val) || val < 0 || val > 100)) { toast("목표는 0~100 사이여야 합니다"); b2bDrawInd(); return; }
  const old = PC.isNum(def.target) ? def.target : null;
  if (old === val) return;
  if (val === null) delete def.target; else def.target = val;
  def.rev = (def.rev || 0) + 1; def.updatedAt = new Date().toISOString(); def.updatedBy = b2bActor(def.owner);
  b2bHist({ ref, kind: "def", by: def.updatedBy, summary: "목표 변경", changes: [{ f: "목표 달성률", from: old == null ? "미설정" : old + "%", to: val == null ? "미설정" : val + "%" }] });
  b2bFlush(); renderAll(); b2bDrawInd();
}
function b2bSubSet(ref, i, pct) {
  const def = B2B.shape.leadDefs[ref], month = b2bMonth(), cur = b2bRec(ref, month), name = (def.tasks || [])[i], before = PC.taskPct(cur, i);
  pct = Math.max(0, Math.min(100, Math.round(pct)));
  if (name == null || pct === before) { b2bDrawInd(); return; }
  const next = cur ? copy(cur) : { id: ref + "_" + month, ref, month, mode: "auto" };
  next.prog = next.prog || {}; next.prog["t" + (i + 1)] = pct;
  if (next.checks) delete next.checks["t" + (i + 1)];
  next.updatedAt = new Date().toISOString(); next.updatedBy = b2bActor(def.owner); next.rev = (next.rev || 0) + 1;
  B2B.shape.perfMonthly[next.id] = next;
  b2bHist({ ref, month, kind: "task", by: next.updatedBy, summary: "세부업무 진행률 변경", changes: [{ f: name, from: before + "%", to: pct + "%" }] });
  b2bFlush(); renderAll(); b2bDrawInd();
}
function b2bSubAdd(ref) {
  const inp = $("b2b-sub-add"), v = inp ? inp.value.trim() : "", def = B2B.shape.leadDefs[ref];
  if (!v) return;
  def.tasks = def.tasks || []; def.tasks.push(v); def.rev = (def.rev || 0) + 1; def.updatedAt = new Date().toISOString(); def.updatedBy = b2bActor(def.owner);
  b2bHist({ ref, kind: "def", by: def.updatedBy, summary: "세부업무 추가", changes: [{ f: "세부업무", from: "없음", to: v }] });
  b2bFlush(); b2bDrawInd();
}

/* ---------- KPI 체계 ---------- */
function b2bIndRow(def) {
  const month = b2bMonth(), r = b2bRate(def.id, month), rec = b2bRec(def.id, month), ok = r.state === "ok", pct = ok ? b2bPct(r.value) : 0;
  const cls = !ok ? "s-todo" : pct >= 100 ? "s-done" : pct > 0 ? "s-doing" : "s-todo";
  const rev = rec ? (rec.rev || 0) : 0, label = ok ? pct + "%" : r.state === "empty" ? "대상 없음" : "미측정";
  const den = rec && rec.mode !== "direct" && PC.isNum(rec.den) ? rec.den : "", num = rec && rec.mode !== "direct" && PC.isNum(rec.num) ? rec.num : "";
  const color = pct >= 100 ? "var(--success)" : "var(--accent)";
  return `<div class="kpi-ind" data-ind="${def.id}">
    <span class="kstatus ${cls}">${label}</span>
    <div class="ktext b2b-link" onclick="b2bOpenInd('${def.id}')">${def.no ? def.no + " " : ""}${escapeHtml(def.name)}</div>
    <div class="kpi-measure">
      <input type="number" min="0" inputmode="numeric" class="kmv" value="${num}" placeholder="완료" title="${escapeHtml(def.numLabel || "완료 수")}" data-rev="${rev}" onchange="b2bSetVal('${def.id}','num',this)">
      <span class="kmslash">/</span>
      <input type="number" min="0" inputmode="numeric" class="kmv tgt" value="${den}" placeholder="대상" title="${escapeHtml(def.denLabel || "대상 수")}" data-rev="${rev}" onchange="b2bSetVal('${def.id}','den',this)">
    </div>
    <div class="kpi-mbar"><i style="width:${pct}%; background:${color};"></i></div>
  </div>`;
}
function b2bGoalBlock(k, i) {
  const month = b2bMonth(), r = b2bRate(k.id, month), t = b2bTeamScore(k, month), ok = r.state === "ok", color = MEMBER_COLORS[i % MEMBER_COLORS.length];
  const undecided = t.state === "wait" && (t.code === "unset" || t.code === "sum");
  const score = t.state === "ok" ? b2bPct(t.value) + "%" : t.state === "empty" ? "대상 없음" : undecided ? "미확정" : "산출 대기";
  const refs = b2bMembersOf(k).map(mid => { const s = b2bMemberScore(k, mid, month); return `${escapeHtml(b2bMemberName(mid))} 개인 점수 ${s.state === "ok" ? b2bPct(s.value) + "%" : s.state === "empty" ? "대상 없음" : "산출 대기"}`; }).join(" · ");
  const links = (k.links || []).filter(l => l.rel === "core").map(l => { const d = B2B.shape.leadDefs[l.li]; return d ? `<span class="badge" style="background:var(--accent-soft); color:var(--accent); cursor:pointer;" onclick="b2bOpenInd('${d.id}')">${d.no} ${escapeHtml(d.name)}</span>` : ""; }).join(" ");
  const pct = ok ? b2bPct(r.value) : 0;
  return `<div class="kpi-goalcard"><div class="kpi-goalcard-head"><div class="gnum" style="background:${color};">${k.no}</div>
    <div class="gbody"><div class="gtitle">${escapeHtml(k.name)}</div><div class="gdesc">${escapeHtml(k.purpose || "")}</div></div>
    <div class="gprog"><div class="pct" style="color:${ok ? color : "var(--muted)"}; ${ok ? "" : "font-size:18px;"}">${ok ? pct + '<span style="font-size:12px;">%</span>' : r.state === "empty" ? "대상 없음" : "미측정"}</div><div class="plabel">팀 전체 실제 달성률</div><div class="pbar"><i style="width:${pct}%; background:${color};"></i></div></div></div>
    <div class="kpi-goalcard-body">
      <div class="kpi-ind-group"><div class="kpi-ind-title lag"><span class="tag">실적</span> 팀 전체 실적 · ${escapeHtml(k.src || "")}</div>${b2bIndRow(k)}</div>
      <div class="kpi-connector"><span class="arr">↳</span> <span>팀 선행활동 점수 <b>${score}</b>${t.reason && t.state !== "ok" ? " · " + escapeHtml(t.reason) : ""}${refs ? " · " + refs + " (참고)" : ""}</span></div>
      <div class="b2b-chips">${links}</div>
    </div></div>`;
}
function b2bOwnerView() {
  const s = B2B.shape;
  return Object.values(s.members).sort((a, b) => a.id < b.id ? -1 : 1).map(m => {
    const name = String(m.name || "").trim(), leads = Object.values(s.leadDefs).filter(l => l.member === m.id).sort((a, b) => a.id < b.id ? -1 : 1), lags = Object.values(s.lagDefs).filter(g => g.member === m.id).sort((a, b) => a.id < b.id ? -1 : 1);
    const month = b2bMonth(), lm = leads.filter(l => b2bRate(l.id, month).state === "ok").length, gm = lags.filter(g => b2bRate(g.id, month).state === "ok").length;
    const head = `<div class="kpi-owner-head"><div class="avatar" style="background:${m.color || "#1B5E6E"}; width:34px; height:34px;">${escapeHtml(initials(name))}</div><div><div class="oname">${escapeHtml(name)}</div><div class="orole">${escapeHtml(m.role || "")}</div></div><span class="ocount">${leads.length || lags.length ? `선행 ${lm}/${leads.length} · 후행 ${gm}/${lags.length} 측정` : "개인 지표 등록 전"}</span></div>`;
    if (!leads.length && !lags.length) return head + `<div class="empty" style="padding:18px;"><div>개인 선행·후행지표가 아직 등록되지 않았습니다.</div></div>`;
    const scores = Object.values(s.mainKpis).map(k => { const v = b2bMemberScore(k, m.id, month); return `<span class="badge" style="background:var(--accent-soft); color:var(--accent);">KPI ${k.no} 개인 점수 ${v.state === "ok" ? b2bPct(v.value) + "%" : v.state === "empty" ? "대상 없음" : "산출 대기"}</span>`; }).join(" ");
    return head + `<div class="kpi-card"><div class="b2b-chips" style="margin-bottom:10px;">${scores}</div>
      <div class="kpi-ind-group"><div class="kpi-ind-title lag"><span class="tag">후행</span> 후행지표 · 실제 성과 <span style="color:var(--muted); font-weight:600;">(${escapeHtml((lags[0] && lags[0].scope) || "")} 기준)</span></div>${lags.map(b2bIndRow).join("")}</div>
      <div class="kpi-connector"><span class="arr">↳</span> 위 성과를 만들기 위한 <b>선행지표(실행)</b> — 완료 수와 대상 수를 입력하면 달성률이 계산됩니다</div>
      <div class="kpi-ind-group"><div class="kpi-ind-title lead"><span class="tag">선행</span> 선행지표 · 실제 관리 실적</div>${leads.map(b2bIndRow).join("")}</div></div>`;
  }).join("");
}
renderKpiPage = function () {
  const root = $("kpi-root"); if (!root || !B2B.shape) return;
  const s = B2B.shape, month = b2bMonth();
  if (!UI.kpiView) UI.kpiView = "goal";
  const sel = $("kpi-month");
  if (sel) { const o = {}; PC.monthsBack(month > b2bNowMonth() ? month : b2bNowMonth(), 18).forEach(m => { o[m] = 1; }); Object.values(s.perfMonthly).forEach(r => { o[r.month] = 1; }); sel.innerHTML = Object.keys(o).sort().reverse().map(m => `<option${m === month ? " selected" : ""}>${m}</option>`).join(""); }
  if ($("kpi-updated")) $("kpi-updated").textContent = month;
  const kpis = Object.values(s.mainKpis).sort((a, b) => a.id < b.id ? -1 : 1), leads = Object.values(s.leadDefs).length, lags = Object.values(s.lagDefs).length;
  $("kpi-view-goal").classList.toggle("on", UI.kpiView === "goal"); $("kpi-view-owner").classList.toggle("on", UI.kpiView === "owner");
  root.innerHTML = `<div class="kpi-teamvision"><div class="lbl">${escapeHtml(DATA.teams[0].name)} · 팀 공통 KPI</div><div class="txt">${escapeHtml(DATA.teams[0].kpi || "")}</div><div class="meta">팀원 ${Object.keys(s.members).length}명 · 공통 KPI ${kpis.length}개 · 개인 선행 ${leads}개 · 개인 후행 ${lags}개 · 팀 선행점수는 팀원별 가중치 확정 전까지 미확정</div></div>` +
    (UI.kpiView === "goal" ? kpis.map(b2bGoalBlock).join("") : b2bOwnerView());
};
function b2bNowMonth() { const d = new Date(), m = d.getMonth() + 1; return d.getFullYear() + "-" + (m < 10 ? "0" : "") + m; }
setKpiView = function (v) { UI.kpiView = v; renderKpiPage(); };

/* 지표 상세 창 */
function b2bOpenInd(ref) { closeModal(); UI.b2bInd = ref; $("modal-kpi").classList.add("open"); UI.modalOpen = "kpi"; b2bDrawInd(); }
function b2bDrawInd() {
  const ref = UI.b2bInd, def = ref && b2bDef(ref), el = $("modal-kpi-body");
  if (!def || !el) return;
  const s = B2B.shape, month = b2bMonth(), rec = b2bRec(ref, month), r = b2bRate(ref, month), isLead = !!s.leadDefs[ref], tasks = isLead ? (def.tasks || []) : [], w = isLead ? PC.workStats(tasks, rec) : null;
  $("modal-kpi-title").textContent = (s.mainKpis[ref] ? "KPI " : "") + (def.no || "") + " " + def.name;
  $("modal-kpi-sub").textContent = s.mainKpis[ref] ? "팀 공통 KPI · " + month : (s.leadDefs[ref] ? "개인 선행지표 · " : "개인 후행지표 · ") + b2bMemberName(def.member) + " · " + month;
  const kv = (k, v) => v ? `<div class="b2b-kv"><span>${k}</span><b>${escapeHtml(v)}</b></div>` : "";
  const kl = isLead ? Object.values(s.mainKpis).filter(k => (k.links || []).some(l => l.li === ref)).map(k => "KPI " + k.no).join(", ") : "";
  const projs = isLead ? Object.values(s.projects).filter(p => p.leads && p.leads[ref]).map(p => p.name).join(", ") : "";
  const subs = tasks.map((t, i) => { const p = PC.taskPct(rec, i), k = p >= 100 ? "done" : p > 0 ? "doing" : "todo", icon = { todo: "○", doing: "▶", done: "✓" }[k], nx = PC.nextStep(p); return `<div class="subtask-row ${k}"><button class="sub-status-btn" onclick="b2bSubSet('${ref}',${i},${nx})" title="상태 변경">${icon}</button><div class="subtask-title">${i + 1}. ${escapeHtml(t)}</div><div class="subtask-progress-bar"><div style="width:${p}%"></div></div><input type="number" min="0" max="100" step="10" value="${p}" onchange="b2bSubSet('${ref}',${i},Number(this.value)||0)" style="width:52px; padding:3px; font-size:12px; text-align:right; border:1px solid var(--line); border-radius:4px;"></div>`; }).join("");
  const rows = Object.values(s.perfMonthly).filter(x => x.ref === ref).sort((a, b) => a.month < b.month ? 1 : -1).map(x => { const y = PC.rate(x), ws = isLead ? PC.workStats(tasks, x) : null; return `<tr><td>${x.month}</td><td>${PC.isNum(x.num) && PC.isNum(x.den) ? x.num + " / " + x.den : x.mode === "direct" ? "직접 입력" : "—"}</td><td>${y.state === "ok" ? b2bPct(y.value) + "%" : y.state === "empty" ? "대상 없음" : "미측정"}</td>${isLead ? `<td>${Math.round(ws.value || 0)}%</td>` : ""}<td>${escapeHtml(x.updatedBy || "")}</td></tr>`; }).join("");
  const hist = Object.values(s.perfHistory).filter(h => h.ref === ref).sort((a, b) => a.at < b.at ? 1 : -1).slice(0, 20).map(h => `<div class="b2b-kv"><span>${escapeHtml((h.at || "").slice(0, 16).replace("T", " "))}</span><b>${escapeHtml(h.by || "")} · ${escapeHtml(h.summary || "")} ${escapeHtml((h.changes || []).map(c => c.f + " " + c.from + "→" + c.to).join(", "))}</b></div>`).join("");
  el.innerHTML = `<div class="kpi-ind-group">${b2bIndRow(def)}</div>
    ${isLead ? `<div class="b2b-kv" style="margin-top:8px;"><span>업무 진행률</span><b>${tasks.length ? Math.round(w.value) + "% · 완료 " + w.done + " / " + w.total : "세부업무 없음"} (달성률과 별개)</b></div>` : ""}
    <div class="modal-field-label" style="margin-top:12px;">목표 달성률(%)</div><input type="number" min="0" max="100" id="b2b-target" value="${PC.isNum(def.target) ? def.target : ""}" placeholder="미설정" onchange="b2bSetTarget('${ref}',this)" style="width:120px;">
    <details style="margin-top:12px;"><summary class="b2b-sum">목표·계산식·설명</summary>${kv("계산식", def.formula)}${kv("집계 범위", def.scope)}${kv("관리 목적", def.purpose)}${kv("측정 항목", def.measure)}${kv("목표 설명", def.targetText)}${kv("연결 팀 KPI", kl)}${kv("연결 프로젝트", projs ? projs + " (진행률 합산 안 함)" : "")}${kv("참고", def.outcome || def.defNote)}${kv("데이터", (def.src || "") + (def.linkNote ? " · " + def.linkNote : ""))}</details>
    ${isLead ? `<div class="subtask-container" style="margin-top:12px;"><div class="subtask-head"><span>📎 세부업무</span><span style="font-family:var(--num); font-weight:800;">${w.done}/${w.total}</span></div><div class="subtask-list">${subs}</div><div class="subtask-add"><input type="text" id="b2b-sub-add" placeholder="세부업무 추가" onkeydown="if(event.key==='Enter')b2bSubAdd('${ref}')"><button onclick="b2bSubAdd('${ref}')">+ 추가</button></div></div>` : ""}
    <details style="margin-top:12px;"><summary class="b2b-sum">월별 실적</summary>${rows ? `<table class="table"><thead><tr><th>월</th><th>실적</th><th>달성률</th>${isLead ? "<th>업무 진행률</th>" : ""}<th>입력</th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="empty-small">아직 저장된 실적이 없습니다.</div>'}</details>
    <details style="margin-top:8px;"><summary class="b2b-sum">변경 이력</summary>${hist || '<div class="empty-small">변경 이력이 없습니다.</div>'}</details>`;
}
const _closeModal = closeModal;
closeModal = function () { UI.b2bInd = null; _closeModal(); };

/* ---------- 앱·도구 모음: 업무 자동화 목록도 함께 표시 ---------- */
const _renderAutomationPage = renderAutomationPage;
renderAutomationPage = function () {
  _renderAutomationPage();
  const grid = $("dash-grid"); if (!grid || !B2B.shape) return;
  const st = { run: "운영", dev: "개발", plan: "계획" }, list = Object.values(B2B.shape.automations);
  if (list.length) grid.insertAdjacentHTML("beforeend", `<div class="section-title" style="margin-top:26px;">⚙️ 업무 자동화 <span class="count">${list.length}</span></div><div class="panel"><table class="table"><thead><tr><th>자동화</th><th>담당</th><th>상태</th></tr></thead><tbody>${list.map(a => `<tr><td style="font-weight:600;">${escapeHtml(a.n || "")}</td><td>${escapeHtml(b2bMemberName(a.own))}</td><td><span class="badge">${st[a.st] || escapeHtml(a.st || "")}</span></td></tr>`).join("")}</tbody></table></div>`);
};

/* ---------- 설정 ---------- */
function b2bRenderSettings() {
  const el = $("settings-extra"); if (!el || !B2B.shape) return;
  const s = B2B.shape, hist = Object.values(s.perfHistory).sort((a, b) => a.at < b.at ? 1 : -1).slice(0, 50);
  const names = {}; ["mainKpis", "leadDefs", "lagDefs"].forEach(c => Object.values(s[c]).forEach(x => { names[x.id] = x.name; }));
  const kpis = Object.values(s.mainKpis).sort((a, b) => a.id < b.id ? -1 : 1).map(k => {
    const ms = b2bMembersOf(k), w = k.memberWeights || {}, iw = k.weights || {};
    return `<details class="b2b-det"><summary class="b2b-sum">KPI ${k.no} ${escapeHtml(k.name)}</summary>
      <div class="modal-field-label">팀원 반영 가중치 (합계 100%, 비우면 미설정)</div>${ms.map(m => `<div class="b2b-kv"><span>${escapeHtml(b2bMemberName(m))}</span><input type="number" min="0" max="100" data-w-member="${k.id}" data-id="${m}" value="${PC.isNum(w[m]) ? w[m] : ""}" placeholder="미설정" style="width:90px;"></div>`).join("")}
      <div class="modal-field-label" style="margin-top:8px;">개인 지표 가중치</div>${(k.links || []).map(l => { const d = s.leadDefs[l.li]; return d ? `<div class="b2b-kv"><span>${d.no} ${escapeHtml(d.name)}${l.rel === "ref" ? " · 참고" : ""}</span><input type="number" min="0" max="100" data-w-ind="${k.id}" data-id="${l.li}" value="${PC.isNum(iw[l.li]) ? iw[l.li] : ""}" placeholder="미설정" style="width:90px;"></div>` : ""; }).join("")}
      <button class="btn ghost btn-sm" style="margin-top:8px;" onclick="b2bSaveWeights('${k.id}')">가중치 저장</button></details>`;
  }).join("");
  const act = s.members, orphans = [];
  Object.values(s.projects).forEach(p => { if (!act[p.owner]) orphans.push("프로젝트 " + p.name + " (담당 ID " + p.owner + ")"); });
  Object.keys(s.routines).forEach(k => { if (!act[k] && (s.routines[k] || []).length) orphans.push("루틴 " + s.routines[k].length + "개 (담당 ID " + k + ")"); });
  el.innerHTML = `<div class="section-title" style="margin-top:30px;">가중치 <span class="count">고급 설정</span></div><div class="panel"><div class="panel-body">${kpis}</div></div>
    <div class="section-title" style="margin-top:30px;">진행이 더딘 업무 기준</div><div class="panel"><div class="panel-body"><div class="b2b-kv"><span>미응답 판정 기간(일)</span><input type="number" min="0" data-cfg="noReplyDays" value="${s.perfConfig.noReplyDays == null ? "" : s.perfConfig.noReplyDays}" placeholder="미설정" style="width:90px;" onchange="b2bSetCfg(this)"></div><div class="b2b-kv"><span>재발송 주기(일)</span><input type="number" min="0" data-cfg="resendDays" value="${s.perfConfig.resendDays == null ? "" : s.perfConfig.resendDays}" placeholder="미설정" style="width:90px;" onchange="b2bSetCfg(this)"></div></div></div>
    <div class="section-title" style="margin-top:30px;">담당자 확인이 필요한 업무</div><div class="panel"><div class="panel-body"><p class="section-sub">담당자가 팀원 목록에 없는 업무입니다. 다른 사람에게 자동으로 옮기지 않습니다.</p>${orphans.map(x => `<div class="b2b-kv"><b>${escapeHtml(x)}</b></div>`).join("") || '<div class="empty-small">현재 데이터에는 없습니다.</div>'}<button class="btn ghost btn-sm" style="margin-top:8px;" onclick="b2bShowBackup()">백업에 있는 이전 담당 업무 보기</button><div id="b2b-backup" style="margin-top:8px;"></div></div></div>
    <div class="section-title" style="margin-top:30px;">변경 이력 <span class="count">${Object.keys(s.perfHistory).length}건</span></div><div class="panel"><div class="panel-body">${hist.map(h => `<div class="b2b-kv"><span>${escapeHtml((h.at || "").slice(0, 16).replace("T", " "))}</span><b>${escapeHtml(names[h.ref] || h.ref)} · ${escapeHtml(h.by || "")} · ${escapeHtml(h.summary || "")} ${escapeHtml((h.changes || []).map(c => c.f + " " + c.from + "→" + c.to).join(", "))}</b></div>`).join("") || '<div class="empty-small">변경 이력이 없습니다.</div>'}</div></div>
    <div class="section-title" style="margin-top:30px;">입력자</div><div class="panel"><div class="panel-body"><div class="b2b-kv"><span>이 브라우저의 입력자 이름 (비우면 지표 담당자로 기록)</span><input type="text" value="${escapeHtml(b2bActor(""))==="미입력"?"":escapeHtml(b2bActor(""))}" style="width:140px;" onchange="try{localStorage.setItem('${KEY_ACTOR_B2B}',this.value.trim())}catch(e){}"></div></div></div>
    <div class="section-title" style="margin-top:30px;">이전 화면</div><div class="panel"><div class="panel-body"><p class="section-sub">이전 화면의 기능(중점과제, 성과지표, 구조도, 편집 모드, JSON 복구, 잠긴 기준선 되돌리기)은 그대로 쓸 수 있습니다.</p><a class="btn ghost btn-sm" href="legacy.html">이전 화면 열기</a></div></div>`;
}
function b2bSaveWeights(kid) {
  const k = B2B.shape.mainKpis[kid], read = attr => { const o = {}; let bad = false; document.querySelectorAll(`[${attr}="${kid}"]`).forEach(e => { const v = e.value.trim(); if (v === "") return; const n = Number(v); if (isNaN(n) || n < 0 || n > 100) bad = true; else o[e.dataset.id] = n; }); return bad ? null : o; };
  const mw = read("data-w-member"), iw = read("data-w-ind");
  if (!mw || !iw) return toast("가중치는 0~100 사이여야 합니다");
  if (canon(k.memberWeights) === canon(mw) && canon(k.weights) === canon(iw)) return toast("바뀐 내용이 없습니다");
  const by = b2bActor(""), changes = [{ f: "가중치", from: JSON.stringify({ 팀원: k.memberWeights || {}, 지표: k.weights || {} }).slice(0, 80), to: JSON.stringify({ 팀원: mw, 지표: iw }).slice(0, 80) }];
  if (Object.keys(mw).length) k.memberWeights = mw; else delete k.memberWeights;
  k.weights = iw; k.rev = (k.rev || 0) + 1; k.updatedAt = new Date().toISOString(); k.updatedBy = by;
  b2bHist({ ref: kid, kind: "weight", by, summary: "가중치 변경", changes });
  b2bFlush(); renderAll(); toast("가중치를 저장했습니다");
}
function b2bSetCfg(el) { const k = el.dataset.cfg, v = el.value.trim(); if (v === "" || isNaN(+v) || +v < 0) delete B2B.shape.perfConfig[k]; else B2B.shape.perfConfig[k] = +v; b2bFlush(); toast("저장했습니다"); }
function b2bShowBackup() {
  const box = $("b2b-backup"); box.textContent = "불러오는 중…";
  fetch(FB_URL + "/shared/b2bOpsTrackerBackups.json", { cache: "no-store" }).then(r => { if (!r.ok) throw new Error(); return r.json(); }).then(all => {
    const keys = Object.keys(all || {}).sort(), last = keys.length ? all[keys[keys.length - 1]] : null;
    if (!last) { box.textContent = "백업이 없습니다."; return; }
    const LABEL = { csh: "최세혁", jjy: "조재연 (이전 ID)" }, ps = last.projects || {}, list = (Array.isArray(ps) ? ps : Object.values(ps)).filter(p => p && !B2B.shape.members[p.owner]);
    box.innerHTML = `<p class="section-sub">${escapeHtml(keys[keys.length - 1].slice(0, 10))} 백업 기준 · 읽기 전용 · 복구되지 않습니다</p>` + (list.map(p => { const ts = p.tasks || [], pct = ts.length ? Math.round(ts.reduce((a, t) => a + (Number(t.p) || 0), 0) / ts.length) : 0; return `<div class="b2b-kv"><span>${escapeHtml(LABEL[p.owner] || p.owner)}</span><b>${escapeHtml(p.name)} · 하위업무 ${ts.length}개 · ${pct}%</b></div>`; }).join("") || '<div class="empty-small">확인할 항목이 없습니다.</div>');
  }).catch(() => { box.textContent = "백업을 불러오지 못했습니다."; });
}
const _renderAll = renderAll;
renderAll = function () { if (!B2B.shape) return; _renderAll(); b2bRenderSettings(); };
document.querySelectorAll(".tab").forEach(b => b.addEventListener("click", () => { if (b.dataset.page === "settings") b2bRenderSettings(); }));
