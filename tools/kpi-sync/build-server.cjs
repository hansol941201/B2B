// 집계 서버 만들기 — server.template.gs + 고객관리카드 원본 판정 함수 + meeting-kpi.cjs → dist/Code.gs
//   node tools/kpi-sync/build-server.cjs <카드 저장소 폴더>
// 카드의 공개 웹 설정(apiKey)과 공용 계정 주소만 채운다. 비밀번호는 넣지 않는다(스크립트 속성에서 읽음).
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const { cardLogicSource } = require('./card-cut.cjs');
const cardDir = process.argv[2];
if (!cardDir) throw new Error('사용법: node tools/kpi-sync/build-server.cjs <카드 저장소 폴더>');
const card = fs.readFileSync(path.join(cardDir, 'index.html'), 'utf8');
const fc = fs.readFileSync(path.join(cardDir, 'firebaseConfig.js'), 'utf8');
if (!/projectId:\s*"pour-dashboard"/.test(fc)) throw new Error('카드 Firebase 프로젝트가 pour-dashboard 가 아님');
const apiKey = /apiKey:\s*"([^"]+)"/.exec(fc)[1];
const account = /HANSOL2_FIXED_EMAIL\s*=\s*'([^']+)'/.exec(card)[1];
let build = 'unknown';
try {
  build = execSync('git rev-parse --short HEAD', { cwd: cardDir }).toString().trim();
  if (execSync('git status --porcelain -- index.html', { cwd: cardDir }).toString().trim()) build += '+커밋 전 수정';
} catch (e) {}
const kpi = fs.readFileSync(path.join(__dirname, 'meeting-kpi.cjs'), 'utf8');
const kpiBlock = kpi.slice(kpi.indexOf('/* KPI-SYNC-START */'), kpi.indexOf('/* KPI-SYNC-END */') + '/* KPI-SYNC-END */'.length);
let gs = fs.readFileSync(path.join(__dirname, 'server.template.gs'), 'utf8');
gs = gs.replace('__FIREBASE_API_KEY__', apiKey).replace('__CARD_ACCOUNT__', account).replace('__CARD_BUILD__', build)
  .replace('// __CARD_LOGIC__', () => cardLogicSource(card)).replace('// __KPI_LOGIC__', () => kpiBlock);
if (/__[A-Z_]+__/.test(gs)) throw new Error('채우지 못한 자리표시자가 있음');
const out = path.join(__dirname, 'dist');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'Code.gs'), gs);
fs.writeFileSync(path.join(out, 'appsscript.json'), JSON.stringify({
  timeZone: 'Asia/Seoul', runtimeVersion: 'V8', exceptionLogging: 'STACKDRIVER',
  oauthScopes: ['https://www.googleapis.com/auth/script.external_request', 'https://www.googleapis.com/auth/script.scriptapp']
}, null, 2) + '\n');
console.log('dist/Code.gs', gs.length, 'chars · 카드', build);
