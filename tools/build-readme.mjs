#!/usr/bin/env node
// build-readme: README.md / README.en.md 를 README.html / README.en.html 로 만든다.
//   웹 문서는 마크다운 원문에서 기계적으로 만들기 때문에 두 문서의 내용이 달라질 수 없다.
//   외부 패키지 없음. 마크다운은 이 저장소 README 가 쓰는 부분집합만 지원한다
//   (제목, 문단, 목록(안에 표·인용·코드 포함 가능), 표, 코드 블록, 인용, 가로줄, 코드·굵게·링크, <details>/<summary>/<a id> 줄).
// 사용:  node tools/build-readme.mjs            HTML 을 만든다(바뀐 것만 쓴다)
//        node tools/build-readme.mjs --check    아무것도 쓰지 않고 (1) HTML 이 최신인지 (2) 마크다운과 HTML 의 글자가 같은지 검사. 어긋나면 종료코드 1
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAIRS = [
  { md: 'README.md', html: 'README.html', lang: 'ko', title: 'SoDam Herdr Orchestration Kit — 안내서' },
  { md: 'README.en.md', html: 'README.en.html', lang: 'en', title: 'SoDam Herdr Orchestration Kit — Guide' },
];

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = (s) => esc(s).replace(/"/g, '&quot;');

// ---------------- 인라인 ----------------
function mapHref(h) { return h === 'README.md' ? 'README.html' : h === 'README.en.md' ? 'README.en.html' : h; }
function inline(text) {
  const codes = [];
  let s = text.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = esc(s);
  s = s.replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, (_, u) => `<a href="${attr(u)}">${u}</a>`);       // <자동링크>
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => `<a href="${attr(mapHref(u.replace(/&amp;/g, '&')))}">${t}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[+i])}</code>`);
  return s;
}

// ---------------- 블록 ----------------
const isRawHtml = (l) => /^\s*<\/?(details|summary|a\b)/.test(l);
const isTableLine = (l) => /^\s*\|.*\|\s*$/.test(l);
const isSep = (l) => /^\s*\|(\s*:?-{2,}:?\s*\|)+\s*$/.test(l);
const listMarker = (l) => l.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);

function splitRow(l) {
  const t = l.trim().replace(/^\|/, '').replace(/\|$/, '');
  return t.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

function render(lines) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (l.trim() === '') { i++; continue; }
    if (isRawHtml(l)) { out.push(l.trim()); i++; continue; }
    const fence = l.match(/^(\s*)```(.*)$/);
    if (fence) {
      const buf = []; i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { buf.push(lines[i].replace(new RegExp('^\\s{0,' + fence[1].length + '}'), '')); i++; }
      i++;
      out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }
    const h = l.match(/^(#{1,4})\s+(.*)$/);
    if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }
    if (/^\s*---+\s*$/.test(l)) { out.push('<hr>'); i++; continue; }
    if (/^\s*>/.test(l)) {
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      out.push(`<blockquote>\n${render(buf)}\n</blockquote>`);
      continue;
    }
    if (isTableLine(l) && i + 1 < lines.length && isSep(lines[i + 1])) {
      const head = splitRow(l); i += 2;
      const rows = [];
      while (i < lines.length && isTableLine(lines[i])) { rows.push(splitRow(lines[i])); i++; }
      const th = head.map((c) => `<th>${inline(c)}</th>`).join('');
      const tr = rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('\n');
      out.push(`<div class="tw"><table>\n<thead><tr>${th}</tr></thead>\n<tbody>\n${tr}\n</tbody>\n</table></div>`);
      continue;
    }
    const m = listMarker(l);
    if (m) {
      const ordered = /\d+\./.test(m[2]);
      const base = m[1].length;
      const items = [];
      while (i < lines.length) {
        const mm = listMarker(lines[i]);
        if (!mm || mm[1].length !== base || /\d+\./.test(mm[2]) !== ordered) break;
        const body = [mm[3]]; i++;
        const contentIndent = base + (ordered ? 3 : 2);
        while (i < lines.length) {
          const ln = lines[i];
          if (ln.trim() === '') {
            let j = i; while (j < lines.length && lines[j].trim() === '') j++;
            if (j < lines.length && (lines[j].length - lines[j].trimStart().length) >= contentIndent && !(listMarker(lines[j]) && listMarker(lines[j])[1].length === base)) { body.push(''); i++; continue; }
            break;
          }
          if ((ln.length - ln.trimStart().length) >= contentIndent) { body.push(ln.slice(contentIndent)); i++; continue; }
          break;
        }
        items.push(body);
        let j = i; while (j < lines.length && lines[j].trim() === '') j++;
        if (j < lines.length) { const nx = listMarker(lines[j]); if (nx && nx[1].length === base && /\d+\./.test(nx[2]) === ordered && j > i) i = j; }
      }
      const tag = ordered ? 'ol' : 'ul';
      const li = items.map((b) => {
        const first = b[0]; const rest = b.slice(1);
        const inner = rest.some((x) => x.trim() !== '') ? render(rest) : '';
        return `<li>${inline(first)}${inner ? '\n' + inner + '\n' : ''}</li>`;
      }).join('\n');
      out.push(`<${tag}>\n${li}\n</${tag}>`);
      continue;
    }
    const buf = [];
    while (i < lines.length && lines[i].trim() !== '' && !isRawHtml(lines[i]) && !/^\s*(```|#{1,4}\s|>|---+\s*$)/.test(lines[i]) && !(isTableLine(lines[i]) && i + 1 < lines.length && isSep(lines[i + 1])) && !(buf.length && listMarker(lines[i]))) { buf.push(lines[i].trim()); i++; }
    out.push(`<p>${inline(buf.join(' '))}</p>`);
  }
  return out.join('\n');
}

const CSS = `
:root{--bg:#fbfaf7;--fg:#1d2433;--muted:#5b6475;--line:#dcd8cf;--soft:#f1eee7;--accent:#1f5fbf;--code-bg:#eeeae0;--warn-bg:#fff4dc;--warn-line:#e0b04a}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#14171d;--fg:#e6e8ee;--muted:#a3abbb;--line:#2e3441;--soft:#1c212a;--accent:#7fb0ff;--code-bg:#222834;--warn-bg:#2b2412;--warn-line:#8a6a1f;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#14171d;--fg:#e6e8ee;--muted:#a3abbb;--line:#2e3441;--soft:#1c212a;--accent:#7fb0ff;--code-bg:#222834;--warn-bg:#2b2412;--warn-line:#8a6a1f;color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.75 "Pretendard","Noto Sans KR","Malgun Gothic",system-ui,-apple-system,"Segoe UI",sans-serif;padding-block:32px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
main{max-width:900px;margin:0 auto;min-width:0}
h1{font-size:2rem;line-height:1.3;margin:.2em 0 .6em;text-wrap:balance}
h2{font-size:1.45rem;margin:2.2em 0 .6em;padding-top:.6em;border-top:2px solid var(--line);text-wrap:balance}
h3{font-size:1.15rem;margin:1.6em 0 .4em}
p,li{overflow-wrap:anywhere}
a{color:var(--accent)}
ul,ol{padding-left:1.4em}
li{margin:.35em 0}
code{font:.9em/1.5 "Cascadia Mono",Consolas,"D2Coding",monospace;background:var(--code-bg);padding:.1em .35em;border-radius:4px;overflow-wrap:anywhere}
pre{background:var(--code-bg);border:1px solid var(--line);border-radius:8px;padding:12px 14px;overflow-x:auto;max-width:100%}
pre code{background:none;padding:0;white-space:pre;overflow-wrap:normal}
.tw{overflow-x:auto;max-width:100%;margin:1em 0}
table{border-collapse:collapse;min-width:100%;font-size:.95rem}
th,td{border:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top}
th{background:var(--soft)}
blockquote{margin:1em 0;padding:.4em 1em;background:var(--warn-bg);border-left:4px solid var(--warn-line);border-radius:4px}
blockquote p{margin:.5em 0}
details{border:1px solid var(--line);border-radius:8px;padding:.5em 1em;margin:.8em 0;background:var(--soft)}
summary{cursor:pointer;padding:.3em 0}
hr{border:0;border-top:1px solid var(--line);margin:2em 0}
`;

function build(pair) {
  const md = readFileSync(join(ROOT, pair.md), 'utf8').replace(/\r\n/g, '\n');
  const body = render(md.split('\n'));
  return `<!doctype html>
<html lang="${pair.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(pair.title)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;
}

// ---------------- 글자 동일 검사 ----------------
const KEEP = /[^\p{L}\p{N}]/gu;
function mdText(md) {
  return md.replace(/\r\n/g, '\n').split('\n')
    .filter((l) => !isSep(l))
    .map((l) => l.replace(/^\s*(```.*)$/, '').replace(/^\s*(?:\d+\.)\s+/, '').replace(/\]\([^)\s]+\)/g, ']'))
    .join('\n')
    .replace(/<\/?(details|summary|a|b)\b[^>]*>/g, '')
    .replace(KEEP, '');
}
function htmlText(html) {
  const bodyOnly = html.slice(html.indexOf('<main>'), html.indexOf('</main>'));
  return bodyOnly.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(KEEP, '');
}

const check = process.argv.includes('--check');
let bad = 0;
for (const p of PAIRS) {
  const html = build(p);
  const f = join(ROOT, p.html);
  const cur = existsSync(f) ? readFileSync(f, 'utf8').replace(/\r\n/g, '\n') : null;
  if (check) {
    if (cur !== html) { console.log(`어긋남: ${p.html} 이(가) ${p.md} 와 다릅니다(node tools/build-readme.mjs 로 다시 만드세요)`); bad++; }
    const a = mdText(readFileSync(join(ROOT, p.md), 'utf8')), b = htmlText(html);
    if (a !== b) {
      let k = 0; while (k < a.length && a[k] === b[k]) k++;
      console.log(`글자 불일치: ${p.md} ↔ ${p.html} (첫 차이 위치 ${k}: md="${a.slice(k, k + 30)}" html="${b.slice(k, k + 30)}")`); bad++;
    } else console.log(`OK ${p.md} ↔ ${p.html}: 글자 ${a.length}자 동일`);
    const ids = new Set([...html.matchAll(/<a id="([^"]+)">/g)].map((m) => m[1]));
    const missing = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]).filter((x) => !ids.has(x));
    if (missing.length) { console.log(`끊어진 목차 링크: ${[...new Set(missing)].join(', ')}`); bad++; }
  } else if (cur !== html) { writeFileSync(f, html, 'utf8'); console.log(`만듦: ${p.html}`); }
  else console.log(`그대로: ${p.html}`);
}
if (check && bad) process.exit(1);
