// 흰색·남색 화면과 선 아이콘 — build-from-reference.cjs 가 완성된 index.html 에 마지막으로 적용한다.
// 기능 코드는 바꾸지 않는다: 색은 색값만 바꾸고, 이모지 아이콘은 화면에 그려진 뒤 같은 모양의 선 아이콘으로 바꾼다.
//   (선택 목록·제목·SVG 글자처럼 그림을 넣을 수 없는 자리는 이모지만 지운다. 저장되는 데이터는 건드리지 않는다.)

/* 따뜻한 미색·청록·금색 → 흰색·남색 (대소문자 무시, 정확히 같은 값만) */
const COLORS = {
  // 기본 토큰
  '#FBFAF6': '#FFFFFF', '#18211D': '#14213A', '#2D3934': '#2A3A55', '#6B7570': '#64748B', '#9AA5A0': '#94A3B8',
  '#E8E5DD': '#E2E8F0', '#F0EEE7': '#F1F5F9', '#1B5E6E': '#1B4480', '#DAEBEE': '#E6EDF8', '#154852': '#13315F',
  '#B89968': '#4A73B5', '#F4EBD9': '#EAF0FA', '#12333B': '#0F2547', '#EAF6F8': '#EEF3FB', '#2A8195': '#3563AE',
  '#C5DEE6': '#C8D6EE',
  // 미색 바탕
  '#FCFBF7': '#F8FAFC', '#FDFBF5': '#F8FAFC', '#FAF8F2': '#F8FAFC', '#FFFBF0': '#F8FAFC', '#FFFAF0': '#F8FAFC',
  '#FFFAF5': '#F8FAFC', '#FFF7F0': '#F8FAFC', '#FFF8E8': '#F5F8FD', '#FFF7E5': '#F1F5FB', '#FCF6E4': '#F1F5FB',
  '#FDF5E8': '#F5F8FD', '#FBF3DA': '#EEF3FB', '#F4E8C8': '#E6EDF8', '#F0F7FA': '#F1F5FB', '#F8FCFD': '#F8FAFC',
  // 금색·갈색 계열 글자·테두리
  '#E5D9B8': '#D3DEF0', '#D9C9A3': '#C3D2EA', '#6E5530': '#1F3D6E', '#8A6E3A': '#2F5490', '#6B5530': '#1F3D6E',
  '#A67E50': '#3B63A3',
};
function recolor(h) {
  let n = 0;
  for (const [from, to] of Object.entries(COLORS)) h = h.replace(new RegExp(from, 'gi'), () => { n++; return to; });
  return { h, n };
}

/* 선 아이콘(24×24, 선 굵기 2) */
const ICONS = {
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>',
  users: '<circle cx="9" cy="8" r="4"/><path d="M2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1M16 4.1a4 4 0 0 1 0 7.8M22 21v-1a6 6 0 0 0-4-5.6"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M9 12h6M9 16h6"/>',
  settings: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  layers: '<path d="M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>',
  repeat: '<path d="m17 2 4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3"/>',
  check: '<circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  hourglass: '<path d="M5 22h14M5 2h14M17 22v-4.2a2 2 0 0 0-.6-1.4L12 12l-4.4 4.4a2 2 0 0 0-.6 1.4V22M7 2v4.2a2 2 0 0 0 .6 1.4L12 12l4.4-4.4a2 2 0 0 0 .6-1.4V2"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 1 1 0 9z"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  clip: '<path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/>',
  bulb: '<path d="M9 18h6M10 22h4M15.1 14c.2-1 .7-1.7 1.4-2.5A6 6 0 1 0 7.5 11.5c.7.8 1.2 1.5 1.4 2.5"/>',
  x: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/>',
  book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  pin: '<path d="M12 17v5M8 4h8M9 4v6l-3 4h12l-3-4V4"/>',
  chart: '<path d="M3 3v18h18M7 16v-4M12 16V8M17 16V9"/>',
  map: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h8"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
  printer: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  package: '<path d="m21 8-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  plug: '<path d="M12 22v-5M9 8V2M15 8V2M18 8v5a6 6 0 0 1-12 0V8z"/>',
  flag: '<path d="M4 22V4M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/>',
  star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21 7 14.2l-5-4.9 6.9-1z"/>',
  building: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01"/>',
  briefcase: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2M2 13h20"/>',
  flask: '<path d="M9 3h6M10 3v6L4 20a1 1 0 0 0 .9 1.5h14.2A1 1 0 0 0 20 20l-6-11V3"/>',
};
/* 이모지 → 아이콘 (dot-* 는 색 점) */
const EMOJI = {
  '📅': 'calendar', '🗓': 'calendar', '📆': 'calendar', '👤': 'user', '🙋': 'user', '👥': 'users', '🎯': 'target', '🧰': 'grid',
  '📋': 'clipboard', '⚙': 'settings', '🚀': 'layers', '🔁': 'repeat', '🔄': 'repeat', '✅': 'check', '⏰': 'clock', '⏱': 'clock',
  '⏳': 'hourglass', '⚠': 'alert', '☁': 'cloud', '📁': 'folder', '🗑': 'trash', '✏': 'edit', '📎': 'clip', '💡': 'bulb', '❌': 'x',
  '📖': 'book', '📌': 'pin', '📊': 'chart', '🗺': 'map', '📄': 'file', '📥': 'download', '🖼': 'image', '🖨': 'printer',
  '📦': 'package', '🔒': 'lock', '🖥': 'monitor', '🔌': 'plug', '🏁': 'flag', '➕': 'plus', '🌐': 'globe', '⭐': 'star',
  '🏢': 'building', '🧑‍💼': 'briefcase', '💼': 'briefcase', '🔬': 'flask', '🔴': 'dot-r', '🟡': 'dot-y', '🟢': 'dot-g',
};

function sprite() {
  return '<svg width="0" height="0" style="position:absolute" aria-hidden="true">' +
    Object.entries(ICONS).map(([k, v]) => `<symbol id="i-${k}" viewBox="0 0 24 24">${v}</symbol>`).join('') + '</svg>';
}
function runtime() {
  return `<script>
/* 이모지 아이콘 → 선 아이콘. 그림을 넣을 수 없는 자리(선택 목록·제목·SVG 글자·직접 편집 칸)는 이모지만 지운다. */
(function () {
  var MAP = ${JSON.stringify(EMOJI)};
  var keys = Object.keys(MAP).sort(function (a, b) { return b.length - a.length; }).map(function (k) { return k.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&'); });
  var RE = new RegExp('(' + keys.join('|') + ')\\uFE0F?', 'g'), HAS = new RegExp(RE.source);
  var PLAIN = { OPTION: 1, OPTGROUP: 1, TEXTAREA: 1, TITLE: 1 }, SKIP = { SCRIPT: 1, STYLE: 1 }, NS = 'http://www.w3.org/2000/svg';
  function icon(name) {
    if (name.indexOf('dot-') === 0) { var d = document.createElement('span'); d.className = 'ic-dot ' + name; return d; }
    var s = document.createElementNS(NS, 'svg'); s.setAttribute('class', 'ic ic-' + name); s.setAttribute('aria-hidden', 'true');
    var u = document.createElementNS(NS, 'use'); u.setAttribute('href', '#i-' + name); s.appendChild(u); return s;
  }
  function fix(t) {
    var v = t.nodeValue, p = t.parentNode;
    if (!v || !p || SKIP[p.nodeName] || !HAS.test(v)) return;
    if (PLAIN[p.nodeName] || (p.closest && (p.closest('svg') || p.closest('[contenteditable]')))) { t.nodeValue = v.replace(RE, '').replace(/^\\s+/, ''); return; }
    var f = document.createDocumentFragment(), last = 0, m; RE.lastIndex = 0;
    while ((m = RE.exec(v))) { if (m.index > last) f.appendChild(document.createTextNode(v.slice(last, m.index))); f.appendChild(icon(MAP[m[1]])); last = RE.lastIndex; }
    if (last < v.length) f.appendChild(document.createTextNode(v.slice(last)));
    p.replaceChild(f, t);
  }
  function walk(root) {
    if (root.nodeType === 3) return fix(root);
    if (root.nodeType !== 1 || SKIP[root.nodeName]) return;
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), list = [], n;
    while ((n = w.nextNode())) if (HAS.test(n.nodeValue)) list.push(n);
    list.forEach(fix);
  }
  walk(document.body);
  new MutationObserver(function (ms) { ms.forEach(function (m) {
    if (m.type === 'characterData') fix(m.target); else m.addedNodes.forEach(walk);
  }); }).observe(document.body, { childList: true, subtree: true, characterData: true });
})();
</script>`;
}
const CSS = `
  /* 선 아이콘 · 흰색·남색 화면 */
  .ic { width: 1.1em; height: 1.1em; vertical-align: -0.18em; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; flex: none; }
  .tab .ic { color: var(--accent); }
  .ic-dot { display: inline-block; width: .7em; height: .7em; border-radius: 50%; vertical-align: .02em; }
  .dot-r { background: var(--danger); } .dot-y { background: #D9A400; } .dot-g { background: var(--success); }
  .today-pill::before { content: none !important; }
  .kpi-teamvision::after { content: none !important; }
  body { background: var(--bg); }
`;
function apply(h) {
  const c = recolor(h); h = c.h;
  const tail = h.lastIndexOf('</body>');
  if (tail < 0) throw new Error('theme: </body> 없음');
  h = h.slice(0, tail) + sprite() + '\n' + runtime() + '\n' + h.slice(tail);
  const st = h.indexOf('</style>\n</head>');
  if (st < 0) throw new Error('theme: style 끝 없음');
  h = h.slice(0, st) + CSS + h.slice(st);
  return { h, colors: c.n };
}
module.exports = { apply, COLORS, EMOJI, ICONS };
