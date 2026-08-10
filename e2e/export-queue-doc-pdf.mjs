import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const mdPath = path.join(root, 'docs', 'QUEUE-MANAGEMENT-SYSTEM.md')
const htmlPath = path.join(root, 'docs', 'QUEUE-MANAGEMENT-SYSTEM.html')
const pdfPath = path.join(root, 'docs', 'Queue-Management-System-Complete-Documentation.pdf')

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function inline(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
}

function tableToHtml(rows) {
  const cells = (line) => line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => inline(cell.trim()))

  const header = cells(rows[0])
  const body = rows.slice(2).map(cells)
  return [
    '<table>',
    '<thead><tr>',
    ...header.map((h) => `<th>${h}</th>`),
    '</tr></thead>',
    '<tbody>',
    ...body.map((row) => `<tr>${row.map((c) => `<td>${c}</td>`).join('')}</tr>`),
    '</tbody>',
    '</table>',
  ].join('')
}

function markdownToHtml(md) {
  const lines = md.split(/\r?\n/)
  const out = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i += 1
      continue
    }

    const fence = line.match(/^```(\w+)?\s*$/)
    if (fence) {
      const lang = fence[1] || ''
      const body = []
      i += 1
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        body.push(lines[i])
        i += 1
      }
      i += 1
      out.push(`<pre class="${lang === 'mermaid' ? 'diagram' : ''}"><code>${escapeHtml(body.join('\n'))}</code></pre>`)
      continue
    }

    const img = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/)
    if (img) {
      const src = img[2].replaceAll('\\', '/')
      out.push(`<figure><img src="${escapeHtml(src)}" alt="${escapeHtml(img[1])}"><figcaption>${escapeHtml(img[1])}</figcaption></figure>`)
      i += 1
      continue
    }

    const h = line.match(/^(#{1,6})\s+(.+)$/)
    if (h) {
      const level = h[1].length
      out.push(`<h${level}>${inline(h[2])}</h${level}>`)
      i += 1
      continue
    }

    if (/^\|.+\|$/.test(line) && i + 1 < lines.length && /^\|\s*-+/.test(lines[i + 1])) {
      const rows = [line, lines[i + 1]]
      i += 2
      while (i < lines.length && /^\|.+\|$/.test(lines[i])) {
        rows.push(lines[i])
        i += 1
      }
      out.push(tableToHtml(rows))
      continue
    }

    if (/^\d+\.\s+/.test(line)) {
      const items = []
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ''))
        i += 1
      }
      out.push(`<ol>${items.map((item) => `<li>${inline(item)}</li>`).join('')}</ol>`)
      continue
    }

    if (/^-\s+/.test(line)) {
      const items = []
      while (i < lines.length && /^-\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^-\s+/, ''))
        i += 1
      }
      out.push(`<ul>${items.map((item) => `<li>${inline(item)}</li>`).join('')}</ul>`)
      continue
    }

    const para = [line]
    i += 1
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^!\[/.test(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !/^\|.+\|$/.test(lines[i]) &&
      !/^\d+\.\s+/.test(lines[i]) &&
      !/^-\s+/.test(lines[i])
    ) {
      para.push(lines[i])
      i += 1
    }
    out.push(`<p>${inline(para.join(' '))}</p>`)
  }

  return out.join('\n')
}

const markdown = fs.readFileSync(mdPath, 'utf8')
const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Queue Management System Complete Documentation</title>
  <style>
    @page { size: A4; margin: 14mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111827; line-height: 1.45; font-size: 11px; }
    h1 { font-size: 25px; margin: 0 0 12px; color: #1f2f52; }
    h2 { break-after: avoid; font-size: 18px; margin: 24px 0 10px; padding-top: 6px; color: #243654; border-top: 1px solid #d7dee9; }
    h3 { font-size: 14px; margin: 16px 0 8px; color: #334155; }
    p { margin: 7px 0; }
    table { width: 100%; border-collapse: collapse; margin: 8px 0 14px; break-inside: avoid; }
    th, td { border: 1px solid #d7dee9; padding: 6px 7px; vertical-align: top; }
    th { background: #edf2f7; color: #1f2f52; text-align: left; font-weight: 700; }
    tr:nth-child(even) td { background: #fafbfc; }
    code { background: #edf2f7; border-radius: 3px; padding: 1px 3px; font-family: Consolas, monospace; font-size: 10px; }
    pre { white-space: pre-wrap; background: #f8fafc; border: 1px solid #d7dee9; border-radius: 8px; padding: 10px; font-size: 9px; break-inside: avoid; }
    pre.diagram { background: #f7fbff; }
    figure { margin: 12px 0 18px; break-inside: avoid; }
    img { display: block; max-width: 100%; border: 1px solid #cbd5e1; border-radius: 6px; }
    figcaption { margin-top: 4px; color: #64748b; font-size: 10px; text-align: center; }
    ol, ul { margin: 8px 0 12px 20px; padding: 0; }
    li { margin: 4px 0; }
  </style>
</head>
<body>
${markdownToHtml(markdown)}
</body>
</html>`

fs.writeFileSync(htmlPath, html, 'utf8')

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1240, height: 1754 } })
await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle' })
await page.pdf({
  path: pdfPath,
  format: 'A4',
  printBackground: true,
  preferCSSPageSize: true,
})
await browser.close()

console.log(pdfPath)
