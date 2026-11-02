// 시험 전용 서버 — index.html의 Firebase 주소를 로컬 모의 DB로 바꿔서 내보낸다.
// 운영 Realtime Database에는 절대 접속하지 않는다.
//   node tests/mock-server.cjs [port] [기준 데이터 JSON] [구버전 html]
// /            새 버전 (이 저장소의 index.html)
// /old/        구버전 html (함께 열려 있는 옛 화면과의 호환 시험용)
// /__db        현재 모의 DB 전체 / /__reset 기준 데이터로 되돌리기
// FBS_DIR=<firebase-server 설치 폴더> 를 주면 REST 폴링 대신 실제 Firebase SDK를 로컬 RTDB 호환 서버에 붙인다
const http = require('http'), fs = require('fs'), path = require('path');
const port = +(process.argv[2] || 5199);
const baselineFile = process.argv[3] || '';
const oldHtmlFile = process.argv[4] || '';
const PROD = 'https://b2b-task-tracker-39144-default-rtdb.asia-southeast1.firebasedatabase.app';
const SDK = 'https://www.gstatic.com/firebasejs/';
const ROOT = 'shared/b2bOpsTracker';

function baseline() { return baselineFile ? JSON.parse(fs.readFileSync(baselineFile, 'utf8')) : {}; }
let db = baseline();
const FBS_PORT = 5400;
const fbs = process.env.FBS_DIR ? new (require(path.join(process.env.FBS_DIR, 'node_modules', 'firebase-server')))(FBS_PORT, 'localhost', { shared: { b2bOpsTracker: baseline() } }) : null;
const fbsRoot = () => fbs.baseRef.child(ROOT);
const fbsVal = async () => { const v = await fbs.getValue(); return (v && v.shared && v.shared.b2bOpsTracker) || {}; };

// Realtime Database처럼 null·빈 객체는 저장하지 않는다
function prune(v) {
  if (v === null || v === undefined) return undefined;
  if (Array.isArray(v)) { const a = v.map(prune).filter(x => x !== undefined); return a.length ? a : undefined; }
  if (typeof v === 'object') {
    const o = {};
    Object.keys(v).sort().forEach(k => { const x = prune(v[k]); if (x !== undefined) o[k] = x; });
    return Object.keys(o).length ? o : undefined;
  }
  return v;
}
function setPath(obj, p, val) {
  const a = p.split('/'), last = a.pop();
  let t = obj;
  a.forEach(k => { if (!t[k] || typeof t[k] !== 'object') t[k] = {}; t = t[k]; });
  if (val === null) delete t[last]; else t[last] = val;
}
function page(file) {
  const html = fs.readFileSync(file, 'utf8');
  const out = fbs ? html.split(PROD).join(`http://localhost:${FBS_PORT}`)
    : html.split(PROD).join(`http://localhost:${port}/__rtdb`).split(SDK).join(`http://localhost:${port}/__nosdk/`);
  if (out.includes(PROD)) throw new Error('운영 DB 주소가 남아 있습니다');
  return out;
}
http.createServer((q, s) => {
  const url = q.url.split('?')[0];
  const send = (code, body, type) => { s.writeHead(code, { 'content-type': type || 'application/json; charset=utf-8', 'cache-control': 'no-store' }); s.end(body); };
  if (url === '/' || url === '/index.html') return send(200, page(path.join(__dirname, '..', 'index.html')), 'text/html; charset=utf-8');
  if (url === '/old/' && oldHtmlFile) return send(200, page(oldHtmlFile), 'text/html; charset=utf-8');
  if (url === '/__db') { if (fbs) return fbsVal().then(v => send(200, JSON.stringify(v))); return send(200, JSON.stringify(db)); }
  if (url === '/__reset') { if (fbs) { fbsRoot().set(baseline()); return setTimeout(() => send(200, '{"ok":true}'), 150); } db = baseline(); return send(200, '{"ok":true}'); }
  if (url === '/__wipe') { db = {}; return send(200, '{"ok":true}'); }
  if (url === '/__rtdb/shared/b2bOpsTrackerBackups.json' && process.env.BACKUPS_FILE) return send(200, fs.readFileSync(process.env.BACKUPS_FILE, 'utf8'));
  if (url === `/__rtdb/${ROOT}.json`) {
    if (q.method === 'GET') return send(200, JSON.stringify(prune(db) || null));
    let body = '';
    q.on('data', d => { body += d; });
    q.on('end', () => {
      const v = JSON.parse(body || 'null');
      if (fbs) { fbsRoot().update(v); return setTimeout(() => send(200, JSON.stringify(v)), 150); } // 서버 내부 참조는 완료 콜백이 오지 않는다
      if (q.method === 'PUT') db = v;
      else if (q.method === 'PATCH') Object.keys(v).forEach(k => setPath(db, k, v[k]));
      else return send(405, '{}');
      db = prune(db) || {};
      send(200, JSON.stringify(v));
    });
    return;
  }
  send(404, '{"error":"not found"}');
}).listen(port, () => console.log('mock on ' + port));
