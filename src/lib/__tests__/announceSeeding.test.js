import test from 'node:test'
import assert from 'node:assert/strict'
import { createAnnouncer } from '../announce.js'

// The seeding rule, tested on its own.
//
// A board must not read out everyone already waiting when it loads — but it must
// announce the very first patient alerted AFTER it loads. Getting the boundary
// between those two wrong produced a bug that only ever showed up once per board
// load, which is exactly the kind nobody can reproduce on demand.

function fakeEngine() {
  const said = []
  return { said, voices: () => [{ lang: 'en-US', name: 'Zira' }], wait: () => Promise.resolve(),
    chime: async () => {}, speak: async (t) => { said.push(t) } }
}
const tick = () => new Promise((r) => setTimeout(r, 0))

// The hook's decision, extracted so it can be exercised without React.
function payload(a, { settings, items }) {
  if (!a.hasSeeded()) {
    if (settings === undefined) return          // fetch has not landed yet
    a.seed(items.map((i) => i.id))
    return
  }
  for (const i of items) a.announce({ id: i.id, text: i.text, chime: false })
}

test('the FIRST alert on a board that opened empty is announced — not swallowed as the seed', async () => {
  const eng = fakeEngine()
  const a = createAnnouncer(eng)

  // Board opens. The room is empty, but the payload HAS arrived.
  payload(a, { settings: {}, items: [] })
  await tick()
  assert.equal(eng.said.length, 0, 'nothing to announce yet')

  // Receptionist presses Alert for the first time.
  payload(a, { settings: {}, items: [{ id: 'q1:ready', text: 'Ramesh, you are next' }] })
  await tick()
  assert.deepEqual(eng.said, ['Ramesh, you are next'],
    'this is the bug: keying the seed on items made the first Alert silent')
})

test('a board that opens with people already waiting still stays silent', async () => {
  const eng = fakeEngine()
  const a = createAnnouncer(eng)

  // Reload after a power cut: five already flagged.
  payload(a, { settings: {}, items: [
    { id: 'q1:ready', text: 'A' }, { id: 'q2:ready', text: 'B' }, { id: 'q3:ready', text: 'C' },
    { id: 'q4:ready', text: 'D' }, { id: 'q5:ready', text: 'E' },
  ] })
  await tick()
  assert.equal(eng.said.length, 0, 'a full hall must not be read out on reload')

  payload(a, { settings: {}, items: [{ id: 'q6:ready', text: 'F' }] })
  await tick()
  assert.deepEqual(eng.said, ['F'], 'but the next one is announced')
})

test('nothing is seeded before the fetch lands, so the first real payload is not lost', async () => {
  const eng = fakeEngine()
  const a = createAnnouncer(eng)

  // React renders once with no data. Seeding here would mark the board ready and
  // let the first real payload count as "new" — reciting the whole hall.
  payload(a, { settings: undefined, items: [] })
  assert.equal(a.hasSeeded(), false, 'an empty pre-fetch render must not seed')

  payload(a, { settings: {}, items: [{ id: 'q1:ready', text: 'A' }] })
  await tick()
  assert.equal(a.hasSeeded(), true)
  assert.equal(eng.said.length, 0, 'the first real payload is the seed')
})

test('the 30-second poll re-delivering the same patient stays silent', async () => {
  const eng = fakeEngine()
  const a = createAnnouncer(eng)
  payload(a, { settings: {}, items: [] })
  payload(a, { settings: {}, items: [{ id: 'q1:ready', text: 'Ramesh' }] })
  payload(a, { settings: {}, items: [{ id: 'q1:ready', text: 'Ramesh' }] })  // poll
  payload(a, { settings: {}, items: [{ id: 'q1:ready', text: 'Ramesh' }] })  // poll
  await tick()
  assert.equal(eng.said.length, 1, 'once, however many times the poll re-sends it')
})
