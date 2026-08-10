// Find every control on the screen, by looking at the screen.
//
// WHY THIS EXISTS
// audit.mjs used to drive each module from a hand-written list of button and tab
// names. That list is always shorter than the module. Appointments' entry was two
// fields — a search placeholder and four tab names — while the module actually has
// five tabs, nine icon-only buttons, five filters, five dialogs and two tables. The
// audit reported "done" having touched about a sixth of it.
//
// A hand-written list also cannot be right for long: it goes stale the moment
// someone adds a button, and nothing fails when it does. So nothing here is named
// in advance. Every run walks the live DOM and reports what is actually there,
// which is why the same command works on all fourteen modules without being told
// anything about them.
//
// THE HARD PART IS NAMING
// A bare <Button><ChevronLeft/></Button> has no text, no aria-label and no title —
// Appointments has six of them and Playwright's getByRole finds none. But lucide
// stamps its class on the svg, so `lucide-chevron-left` is a real name hiding in
// the markup. That fallback is what makes icon-only buttons clickable and, more
// importantly, *reportable* by name when they are missed.

/**
 * Tag every interactive element with data-audit-id and return a description of it.
 *
 * The id is what makes a control clickable later: querying by text is ambiguous in
 * this app ("Cancel" appears in five different dialogs, "Confirmed" is a stat card
 * AND a filter option AND a status badge), so the walk addresses controls by id and
 * keeps the name only for the report.
 *
 * Call this again after anything that changes the DOM — a tab switch, an opened
 * dialog, a filter change. Ids are reassigned from scratch each time.
 */
export async function discover(page, { scope = null } = {}) {
  return page.evaluate((scopeSel) => {
    const root = scopeSel ? document.querySelector(scopeSel) : document
    if (!root) return null

    let seq = 0
    document.querySelectorAll('[data-audit-id]').forEach((el) => el.removeAttribute('data-audit-id'))

    const visible = (el) => {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return false
      const s = getComputedStyle(el)
      return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'
    }

    // lucide-react renders <svg class="lucide lucide-chevron-left ...">. That class
    // is the only name an icon-only button has, so it is what we report it by.
    const iconName = (el) => {
      const svg = el.querySelector('svg')
      if (!svg) return null
      const cls = [...svg.classList].find((c) => c.startsWith('lucide-'))
      return cls ? cls.replace('lucide-', '') : null
    }

    const nearestHeading = (el) => {
      let n = el
      while (n && n !== document.body) {
        let p = n.previousElementSibling
        while (p) {
          const h = p.matches?.('h1,h2,h3,h4,[class*="CardTitle"]') ? p : p.querySelector?.('h1,h2,h3,h4')
          if (h?.innerText?.trim()) return h.innerText.trim().slice(0, 30)
          p = p.previousElementSibling
        }
        n = n.parentElement
      }
      return null
    }

    // Where an element sits, as a short path. This is the last-resort name, and it
    // has to be STABLE across discoveries: naming an unnamed button after the
    // discovery counter meant the same button was called something different every
    // pass, so the ledger never recognised it, the walk kept re-picking it, and one
    // button consumed the entire budget for its category while 31 others were never
    // touched. A position is boring but it is the same position next time.
    const domPath = (el) => {
      const parts = []
      let n = el
      for (let up = 0; n && n !== document.body && up < 3; up++) {
        const parent = n.parentElement
        if (!parent) break
        const index = [...parent.children].indexOf(n)
        parts.unshift(`${n.tagName.toLowerCase()}${index}`)
        n = parent
      }
      return parts.join('>')
    }

    // The fallback chain. Order matters: visible text is what a user would call the
    // control, and the icon class is a last resort that still beats "button #7".
    const nameOf = (el) => {
      const text = el.innerText?.trim().replace(/\s+/g, ' ')
      if (text) return text.slice(0, 48)
      const aria = el.getAttribute('aria-label')
      if (aria) return aria
      const title = el.getAttribute('title')
      if (title) return title
      const near = nearestHeading(el)
      const icon = iconName(el)
      if (icon) return near ? `${icon} (${near})` : icon
      // No text, no label, no icon — nothing a user or a screen reader can read.
      // Worth reporting as such rather than hiding behind a generated id.
      return `unlabelled ${domPath(el)}${near ? ` (${near})` : ''}`
    }

    const tag = (el) => {
      const id = String(++seq)
      el.setAttribute('data-audit-id', id)
      return id
    }

    const describe = (el, kind, extra = {}) => ({
      id: tag(el),
      kind,
      name: nameOf(el),
      icon: iconName(el),
      disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
      ...extra,
    })

    // React attaches its props to the DOM node under a __reactProps$xxx key. It is
    // the only way to tell a <div> that does something on click from a <div> that
    // merely looks like it does — and this app's stat cards and appointment cards
    // are both plain divs.
    const reactOnClick = (el) => {
      const key = Object.keys(el).find((k) => k.startsWith('__reactProps$'))
      return key ? typeof el[key]?.onClick === 'function' : false
    }

    // The app shell is not part of the module being audited. Counting the sidebar's
    // seventeen navigation links as Pharmacy controls padded its "NOT CLICKED" list
    // with "Dashboard, Patients, Appointments…" and buried the controls that were
    // genuinely missed. Clicking them would also navigate away mid-walk.
    const isChrome = (el) =>
      !!el.closest('nav, aside, [role="navigation"], header[class*="sidebar" i], [class*="sidebar" i], [data-sidebar]')

    const all = (sel) => [...root.querySelectorAll(sel)].filter((el) => visible(el) && !isChrome(el))
    const out = {
      buttons: [], iconButtons: [], tabs: [], comboboxes: [], dateInputs: [],
      searchInputs: [], textInputs: [], checkboxes: [], clickableCards: [],
      tableRows: [], links: [], dialogOpen: null,
    }

    // A dialog traps interaction — when one is open the page behind it is not
    // reachable, so report only the dialog's own controls or the walk will spend
    // its time clicking things that silently do nothing.
    const dialog = [...document.querySelectorAll('[role="dialog"]')].find(visible)
    if (dialog && !scopeSel) {
      out.dialogOpen = {
        title: dialog.querySelector('h2,[id*="title"]')?.innerText?.trim() || '(untitled)',
      }
    }
    const area = dialog && !scopeSel ? dialog : root

    // Inside a dialog nothing is app chrome, so the exclusion only applies to the
    // page itself — a dialog's own close button must still be found and reported.
    const areaAll = (sel) => [...area.querySelectorAll(sel)]
      .filter((el) => visible(el) && (area !== root || !isChrome(el)))

    for (const el of areaAll('button, [role="button"]')) {
      if (el.getAttribute('role') === 'tab') continue
      if (el.getAttribute('role') === 'combobox' || el.getAttribute('aria-haspopup') === 'listbox') continue
      const hasText = !!el.innerText?.trim()
      const d = describe(el, hasText ? 'button' : 'iconButton', {
        variant: el.className.includes('destructive') ? 'destructive' : null,
        inRow: !!el.closest('tr'),
      })
      ;(hasText ? out.buttons : out.iconButtons).push(d)
    }

    for (const el of areaAll('[role="tab"]')) {
      out.tabs.push(describe(el, 'tab', { selected: el.getAttribute('aria-selected') === 'true' }))
    }

    for (const el of areaAll('[role="combobox"], select')) {
      out.comboboxes.push(describe(el, 'combobox', {
        // Radix renders the trigger's current value as its text; the option list
        // does not exist in the DOM until it is opened, so the walk reads it then.
        current: el.innerText?.trim().slice(0, 30) || el.value || null,
      }))
    }

    for (const el of areaAll('input[type="date"]')) out.dateInputs.push(describe(el, 'dateInput', {
      label: el.getAttribute('placeholder') || el.getAttribute('aria-label') || nearestHeading(el),
      value: el.value,
    }))

    for (const el of areaAll('input[type="text"], input[type="search"], input:not([type])')) {
      const ph = el.getAttribute('placeholder') || ''
      const d = describe(el, /search|find/i.test(ph) ? 'searchInput' : 'textInput', { placeholder: ph })
      ;(d.kind === 'searchInput' ? out.searchInputs : out.textInputs).push(d)
    }

    for (const el of areaAll('input[type="checkbox"], [role="checkbox"]')) {
      out.checkboxes.push(describe(el, 'checkbox', { inRow: !!el.closest('tr') }))
    }

    // Anything that responds to a click but is not a real control. Two kinds matter:
    // things that work (the stat cards, the Monthly appointment cards) and things
    // that only look like they work — a cursor-pointer with no handler is a lie the
    // UI tells the user, and the audit should say so.
    for (const el of areaAll('[class*="cursor-pointer"]')) {
      if (el.closest('button, [role="button"], [role="tab"], a')) continue
      // A clickable table row is a row, not a card. Reported as both, the same ten
      // DOM elements were counted twice — clicked as rows and simultaneously filed
      // as ten "unreachable" cards, because the second walk looked for a card that
      // the first had already consumed. Patients showed 10/10 rows clicked and
      // 0/10 cards unreachable, for one set of ten patients.
      if (el.closest('tbody tr')) continue
      out.clickableCards.push(describe(el, 'clickableCard', {
        hasHandler: reactOnClick(el),
        text: el.innerText?.trim().replace(/\s+/g, ' ').slice(0, 48) || null,
      }))
    }

    for (const el of areaAll('tbody tr')) {
      out.tableRows.push(describe(el, 'tableRow', { hasHandler: reactOnClick(el) }))
    }

    for (const el of areaAll('a[href]')) {
      if (!el.innerText?.trim() && !el.querySelector('svg')) continue
      out.links.push(describe(el, 'link', { href: el.getAttribute('href') }))
    }

    out.total = Object.values(out).filter(Array.isArray).reduce((n, a) => n + a.length, 0)
    return out
  }, scope)
}

/** Flatten a discovery result into one list, for the coverage ledger. */
export function flatten(found) {
  if (!found) return []
  return Object.entries(found)
    .filter(([, v]) => Array.isArray(v))
    .flatMap(([, v]) => v)
}

/**
 * Open a Radix combobox and read its options. They are not in the DOM until the
 * trigger is clicked, so this is the only way to know what a filter can be set to
 * without hard-coding the list per module.
 */
export async function readOptions(page, id) {
  await page.click(`[data-audit-id="${id}"]`).catch(() => {})
  await page.waitForTimeout(350)
  const options = await page.evaluate(() =>
    [...document.querySelectorAll('[role="option"]')]
      .map((o) => o.innerText?.trim())
      .filter(Boolean),
  )
  await page.keyboard.press('Escape').catch(() => {})
  await page.waitForTimeout(200)
  return options
}
