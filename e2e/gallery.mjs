// Builds ONE self-contained HTML file holding every screenshot in e2e/shots/.
//
//   node e2e/gallery.mjs                 → e2e/shots/index.html
//   node e2e/gallery.mjs --out ~/gm.html
//
// Images are embedded as data URIs, so the result is a single file you can mail,
// open on a phone, or hand to the client — no folder to keep next to it. The
// output lands inside e2e/shots/, which .gitignore already excludes, so nothing
// here reaches the repo.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SHOTS = path.join(__dirname, 'shots')
const argv = process.argv.slice(2)
const OUT = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : path.join(SHOTS, 'index.html')

const files = fs.readdirSync(SHOTS).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort()
if (!files.length) { console.log('e2e/shots/ khaali hai — pehle koi test chalao'); process.exit(0) }

// Screenshots are named by what produced them; the prefix is the grouping.
//   doc-queue-annotated.png     → "Queue"      (manual figure)
//   labcheck-orders.png         → "Laboratory" (audit run)
const GROUP = [
  [/^doc-display/, 'Display boards — manual figures'],
  [/^doc-settings/, 'Settings / Rooms — manual figures'],
  [/^doc-queue/, 'Queue — manual figures'],
  [/^doc-/, 'Other manual figures'],
  [/^labcheck|^dotcheck/, 'Laboratory — audit runs'],
  [/^smoke-fail/, 'Smoke test failures'],
]
const groupOf = (f) => (GROUP.find(([rx]) => rx.test(f)) || [null, 'Ungrouped'])[1]

const groups = {}
let bytes = 0
for (const f of files) {
  const buf = fs.readFileSync(path.join(SHOTS, f))
  bytes += buf.length
  const mime = /\.png$/i.test(f) ? 'image/png' : 'image/jpeg'
  ;(groups[groupOf(f)] ||= []).push({
    name: f.replace(/\.(png|jpe?g)$/i, ''),
    kb: (buf.length / 1024).toFixed(0),
    when: fs.statSync(path.join(SHOTS, f)).mtime.toISOString().slice(0, 10),
    src: `data:${mime};base64,${buf.toString('base64')}`,
  })
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>GudMed HMS — screenshots (${files.length})</title>
<style>
  :root{--ink:#141a20;--body:#3c4650;--muted:#6b7681;--paper:#fbfcfd;--card:#fff;
        --line:#dde3ea;--navy:#1e3a5f}
  @media (prefers-color-scheme:dark){:root{--ink:#e8edf2;--body:#b8c2cc;--muted:#85909b;
        --paper:#11151a;--card:#171d24;--line:#2b333d;--navy:#8fb2d9}}
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--paper);color:var(--body);font:15px/1.6 ui-sans-serif,system-ui,"Segoe UI",sans-serif}
  .wrap{max-width:1200px;margin:0 auto;padding:48px 20px 80px}
  h1{font:600 2.1rem/1.15 "Iowan Old Style",Palatino,Georgia,serif;color:var(--ink)}
  .sub{color:var(--muted);font-size:.9rem;margin-top:6px}
  h2{font:600 1.25rem/1.3 "Iowan Old Style",Palatino,Georgia,serif;color:var(--ink);
     margin:44px 0 14px;padding-bottom:8px;border-bottom:2px solid var(--navy)}
  h2 span{font:400 .78rem ui-sans-serif;color:var(--muted)}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}
  figure{background:var(--card);border:1px solid var(--line);border-radius:4px;overflow:hidden}
  figure img{width:100%;display:block;cursor:zoom-in;background:#fff}
  figcaption{padding:9px 12px;font-size:.78rem;color:var(--muted);
             font-family:ui-monospace,Menlo,Consolas,monospace;
             display:flex;justify-content:space-between;gap:10px}
  figcaption b{color:var(--ink);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  dialog{border:none;background:transparent;max-width:96vw;max-height:96vh;padding:0}
  dialog::backdrop{background:rgba(8,12,16,.9)}
  dialog img{max-width:96vw;max-height:92vh;display:block;cursor:zoom-out;border-radius:4px}
  dialog p{color:#cbd3db;font:12px ui-monospace,Menlo,monospace;text-align:center;padding:8px}
  footer{margin-top:56px;padding-top:16px;border-top:1px solid var(--line);
         color:var(--muted);font-size:.8rem}
</style></head><body><div class="wrap">
<h1>GudMed HMS — screenshots</h1>
<div class="sub">${files.length} figures · ${(bytes / 1048576).toFixed(1)} MB · generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')}
 · <b>one self-contained file</b> — no folder needed beside it</div>
${Object.entries(groups).map(([g, items]) => `
<h2>${esc(g)} <span>${items.length}</span></h2>
<div class="grid">
${items.map((i) => `  <figure>
    <img src="${i.src}" alt="${esc(i.name)}" loading="lazy" data-name="${esc(i.name)}">
    <figcaption><b title="${esc(i.name)}">${esc(i.name)}</b><span>${i.when} · ${i.kb} KB</span></figcaption>
  </figure>`).join('\n')}
</div>`).join('\n')}
<footer>Regenerate after any test run: <code>node e2e/gallery.mjs</code>.
Lives in <code>e2e/shots/</code>, which .gitignore excludes — this file never reaches the repo.</footer>
</div>
<dialog id="lb"><img id="lbimg" alt=""><p id="lbcap"></p></dialog>
<script>
  const lb = document.getElementById('lb'), img = document.getElementById('lbimg'), cap = document.getElementById('lbcap');
  document.querySelectorAll('.grid img').forEach(el => el.addEventListener('click', () => {
    img.src = el.src; cap.textContent = el.dataset.name; lb.showModal();
  }));
  lb.addEventListener('click', () => lb.close());
</script>
</body></html>`

fs.writeFileSync(OUT, html)
console.log(`${files.length} screenshots → ${OUT}`)
console.log(`   ${(bytes / 1048576).toFixed(1)} MB images → ${(fs.statSync(OUT).size / 1048576).toFixed(1)} MB single file`)
for (const [g, items] of Object.entries(groups)) console.log(`   ${String(items.length).padStart(3)}  ${g}`)
