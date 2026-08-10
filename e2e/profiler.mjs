// Name the components that re-rendered, not just how many times.
//
// WHY THIS EXISTS
// The old hook incremented a counter, so a report could say "paging the table
// caused 6 commits" — true, and useless. The question that leads to a fix is
// *which* components rendered, because the answer is usually something that had no
// business rendering at all: the sidebar, the app shell, or a sibling tab's table.
// Nothing in src/ is memoised today, so assume the whole tree re-renders until this
// says otherwise.
//
// HOW IT WORKS
// React looks for window.__REACT_DEVTOOLS_GLOBAL_HOOK__ when it boots and calls
// onCommitFiberRoot on every commit. We install a fake hook before any navigation
// and walk the fiber tree it hands us. `actualDuration` is populated in React's
// development build, so the fibers that actually did work are the ones with a
// non-zero duration — that is what separates "rendered" from "was walked past".

export const HOOK = () => {
  let commits = 0
  const rendered = new Map()   // component name -> { count, ms }

  const nameOf = (fiber) => {
    const t = fiber.type ?? fiber.elementType
    if (!t) return null
    if (typeof t === 'string') return null                    // host element (div, span)
    if (typeof t === 'function') return t.displayName || t.name || null
    if (typeof t === 'object') {
      // memo(), forwardRef(), lazy() wrap the real component one level down.
      return t.displayName || t.render?.displayName || t.render?.name ||
             t.type?.displayName || t.type?.name || null
    }
    return null
  }

  // Iterative, with a node budget. A recursive walk of the whole tree on every
  // commit made the app itself the bottleneck: one audit action produced 1,636
  // commits over a large tree and the page stopped responding, so the audit was
  // measuring the measurement. The budget keeps the observer cheap enough that the
  // numbers still describe the app.
  const BUDGET = 4000

  // Which fibers actually rendered in THIS commit — not simply which ones carry a
  // non-zero actualDuration. React leaves actualDuration on a fiber after its last
  // render, so a component that bailed out still reports the cost of whenever it
  // did render. Counting that is how an earlier version of this file reported the
  // sidebar re-rendering 306 times for three keystrokes: it was visiting the same
  // seventeen untouched NavLinks on every commit and counting each visit.
  //
  // actualStartTime is stamped when a fiber begins work, so anything stamped after
  // the previous commit finished is work from this one. Everything else is history.
  let lastCommitEnd = 0

  const walk = (root) => {
    const stack = [root]
    let seen = 0
    while (stack.length && seen < BUDGET) {
      const fiber = stack.pop()
      if (!fiber) continue
      seen++
      const ms = fiber.actualDuration
      const startedNow = typeof fiber.actualStartTime === 'number' && fiber.actualStartTime > lastCommitEnd
      if (startedNow && typeof ms === 'number' && ms > 0) {
        const name = nameOf(fiber)
        if (name) {
          const prev = rendered.get(name) || { count: 0, ms: 0, self: 0 }
          // actualDuration includes the whole subtree, so a parent's number swallows
          // every child's. selfMs subtracts the children that rendered under it —
          // without it a router wrapping a slow module looks like the slow thing.
          let childMs = 0
          for (let c = fiber.child; c; c = c.sibling) childMs += c.actualDuration || 0
          rendered.set(name, {
            count: prev.count + 1,
            ms: prev.ms + ms,
            self: prev.self + Math.max(0, ms - childMs),
          })
        }
      }
      if (fiber.sibling) stack.push(fiber.sibling)
      if (fiber.child) stack.push(fiber.child)
    }
  }

  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    renderers: new Map(),
    supportsFiber: true,
    checkDCE() {},
    inject(renderer) { this.renderers.set(this.renderers.size + 1, renderer); return this.renderers.size },
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    onCommitFiberRoot(_id, root) {
      commits++
      // Past a few hundred commits the component names are already established and
      // walking again only slows the page down. Keep counting commits — that number
      // is still the finding — but stop paying for detail we already have.
      if (commits > 200) return
      try { walk(root.current) } catch { /* a torn tree mid-commit is not worth failing the audit over */ }
      lastCommitEnd = performance.now()
    },
  }

  window.__profile = () => ({
    commits,
    // Ranked by self time: the component that actually spent the milliseconds,
    // rather than whichever ancestor happens to contain it.
    components: [...rendered.entries()]
      .map(([name, v]) => ({
        name, count: v.count,
        ms: Math.round(v.ms * 10) / 10,
        selfMs: Math.round(v.self * 10) / 10,
      }))
      .sort((a, b) => b.selfMs - a.selfMs),
  })
  window.__profileReset = () => { commits = 0; rendered.clear(); lastCommitEnd = performance.now() }
}

/** Components that must not re-render just because something else changed. */
const SHOULD_NOT_RERENDER = /^(App|Sidebar|AppShell|Layout|Nav|Header|TopBar|MainLayout)/i

/**
 * Turn a profile into findings. Anything in the shell re-rendering because a table
 * paged is a memoisation gap the user pays for on every interaction.
 */
export function judgeProfile(profile, { action, isNavigation = false }) {
  const issues = []
  if (!profile?.components?.length) return issues

  // On a page load everything renders once — that is not a finding, that is what a
  // page load is. Judging it produces twenty lines of noise per module and buries
  // the one interaction that genuinely re-rendered the world.
  if (isNavigation) {
    const worst = profile.components[0]
    if (worst && worst.ms > 400) {
      issues.push({ sev: 'note', why: `first paint spent ${worst.ms} ms in ${worst.name} across ${profile.commits} commits`, what: worst.name })
    }
    return issues
  }

  for (const c of profile.components) {
    if (SHOULD_NOT_RERENDER.test(c.name)) {
      issues.push({
        sev: 'important',
        why: `${c.name} re-rendered ${c.count}× (${c.ms} ms) — the app shell should not repaint for this`,
        what: c.name,
      })
    }
  }

  // A component is only worth flagging if it dominates the action. An absolute
  // threshold flags the whole tree on any slow machine.
  const total = profile.components.reduce((n, c) => n + c.ms, 0)
  const worst = profile.components[0]
  if (worst && worst.ms > 50 && worst.ms > total * 0.4 && !SHOULD_NOT_RERENDER.test(worst.name)) {
    issues.push({ sev: 'important', why: `${worst.name} took ${worst.ms} ms — ${Math.round((worst.ms / total) * 100)}% of this action's render time`, what: worst.name })
  }

  return issues
}
