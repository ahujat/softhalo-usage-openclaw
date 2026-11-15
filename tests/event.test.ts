import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { attemptCost, buildEvent, callKind, isWsl, profileId, publish, resolveRoot, safeName, usageRoot, writeFailedNotice, wslMissNotice, wslRootFinder } from '../src/event.ts'

const NOW = new Date('2026-11-09T10:00:00.000Z')

function tempRoot() {
  return mkdtempSync(join(tmpdir(), 'softhalo-oc-'))
}

test('usage maps onto the four non-overlapping buckets', () => {
  const e = buildEvent(
    { runId: 'r1', sessionId: 's1', provider: 'anthropic', model: 'claude-sonnet-5-5', usage: { input: 12, output: 40, cacheRead: 900, cacheWrite: 30, total: 982 } },
    { agentId: 'main' },
    'oc-x',
    NOW,
  )
  assert.deepEqual(e.usage, { input_uncached: 12, cache_read: 900, cache_write: 30, output: 40, reasoning: null })
  assert.equal(e.format, 'softhalo.event/1')
  assert.equal(e.app, 'openclaw')
  assert.equal(e.session_id, 's1')
  assert.equal(e.call_kind, 'main')
  assert.equal(e.status, 'completed')
  assert.equal(e.completed_at, NOW.toISOString())
  assert.match(e.day, /^\d{4}-\d{2}-\d{2}$/)
})

test('missing counters are null, never zero, and no usage at all is an explicit null', () => {
  const partial = buildEvent({ sessionId: 's1', usage: { output: 5 } }, {}, 'p', NOW)
  assert.deepEqual(partial.usage, { input_uncached: null, cache_read: null, cache_write: null, output: 5, reasoning: null })
  assert.equal(buildEvent({ sessionId: 's1' }, {}, 'p', NOW).usage, null)
  assert.equal(buildEvent({ sessionId: 's1', usage: {} }, {}, 'p', NOW).usage, null)
})

test('no prompt, assistant text or message is ever copied', () => {
  const e = buildEvent(
    { sessionId: 's1', usage: { input: 1 }, prompt: 'secret prompt', assistantTexts: ['secret answer'], lastAssistant: { content: 'x' } } as never,
    {},
    'p',
    NOW,
  )
  const text = JSON.stringify(e)
  assert.ok(!text.includes('secret'))
})

test('the cost OpenRouter billed is sent as dollars and marked provider-billed', () => {
  // What OpenClaw passes at run time for an OpenRouter attempt: OpenRouter's usage.cost, summed.
  const usage = { input: 12, output: 40, cacheRead: 900, total: 952, cost: { total: 0.00123, totalOrigin: 'provider-billed' }, costStatus: 'complete' }
  const e = buildEvent({ sessionId: 's1', provider: 'openrouter', model: 'anthropic/claude-sonnet-5.5', usage }, {}, 'p', NOW)
  assert.equal(e.cost_usd, 0.00123)
  assert.equal(e.cost_source, 'provider-billed')
})

test('a catalog cost is sent as an estimate, and an unavailable or missing cost is left out', () => {
  assert.deepEqual(attemptCost({ cost: { total: 0.5 } }), { cost_usd: 0.5, cost_source: 'openclaw-estimate' })
  assert.deepEqual(attemptCost({ cost: { total: 0 } }), { cost_usd: 0, cost_source: 'openclaw-estimate' })
  assert.equal(attemptCost({ cost: { total: 0.5 }, costStatus: 'unavailable' }), null)
  assert.equal(attemptCost({ cost: { total: -1 } }), null)
  assert.equal(attemptCost({ cost: { total: Number.NaN } }), null)
  assert.equal(attemptCost({ input: 5 }), null)
  assert.equal(attemptCost(undefined), null)
  const e = buildEvent({ sessionId: 's1', usage: { input: 5 } }, {}, 'p', NOW)
  assert.ok(!('cost_usd' in e) && !('cost_source' in e))
})

test('Codex-harness runs are delegated and subagent runs are labelled', () => {
  assert.equal(callKind({ harnessId: 'codex' }, {}), 'delegated')
  assert.equal(callKind({ resolvedRef: 'codex/gpt-5.4' }, {}), 'delegated')
  assert.equal(callKind({}, { sessionKey: 'agent:main:subagent:abc' }), 'subagent')
  assert.equal(callKind({ resolvedRef: 'openai/gpt-5.4' }, { sessionKey: 'agent:main:main' }), 'main')
})

test('the profile is a one-way hash that ignores path spelling', () => {
  const a = profileId('C:\\Users\\u\\.openclaw\\', 'main')
  assert.equal(a, profileId('c:/users/u/.openclaw', 'main'))
  assert.notEqual(a, profileId('c:/users/u/.openclaw', 'work'))
  assert.match(a, /^oc-[0-9a-f]{20}$/)
  assert.ok(!a.includes('users'))
})

test('the usage folder follows each system', () => {
  assert.equal(usageRoot({ LOCALAPPDATA: 'C:\\L' }, 'win32', 'C:\\U'), join('C:\\L', 'Softhalo', 'usage'))
  assert.equal(usageRoot({}, 'win32', 'C:\\U'), null)
  assert.equal(usageRoot({}, 'darwin', '/Users/u'), join('/Users/u', 'Library', 'Application Support', 'Softhalo', 'usage'))
  assert.equal(usageRoot({ XDG_STATE_HOME: '/s' }, 'linux', '/home/u'), join('/s', 'softhalo', 'usage'))
  assert.equal(usageRoot({}, 'linux', '/home/u'), join('/home/u', '.local', 'state', 'softhalo', 'usage'))
})

test('inside WSL the Soft Halo folder of the Windows user is used', () => {
  assert.equal(isWsl({ WSL_DISTRO_NAME: 'Ubuntu' }, 'linux', '6.6.0'), true)
  assert.equal(isWsl({}, 'linux', '5.15.153.1-microsoft-standard-WSL2'), true)
  assert.equal(isWsl({}, 'linux', '6.8.0-generic'), false)
  assert.equal(isWsl({ WSL_DISTRO_NAME: 'Ubuntu' }, 'win32', ''), false)

  const users = tempRoot()
  try {
    const wsl = { WSL_DISTRO_NAME: 'Ubuntu', USER: 'ann' }
    mkdirSync(join(users, 'Public', 'AppData', 'Local', 'Softhalo'), { recursive: true })
    mkdirSync(join(users, 'Other', 'AppData', 'Local', 'Temp'), { recursive: true })
    assert.equal(resolveRoot(wsl, 'linux', '/home/ann', '', users), null)
    mkdirSync(join(users, 'Sam', 'AppData', 'Local', 'Softhalo'), { recursive: true })
    assert.equal(resolveRoot(wsl, 'linux', '/home/ann', '', users), `${users}/Sam/AppData/Local/Softhalo/usage`)
    mkdirSync(join(users, 'Ann', 'AppData', 'Local', 'Softhalo'), { recursive: true })
    assert.equal(resolveRoot(wsl, 'linux', '/home/ann', '', users), `${users}/Ann/AppData/Local/Softhalo/usage`)
    assert.equal(resolveRoot({ ...wsl, USER: 'bob' }, 'linux', '/home/bob', '', users), null)
    assert.equal(resolveRoot({ ...wsl, SOFTHALO_USAGE_DIR: '/mnt/d/x/' }, 'linux', '/home/ann', '', users), '/mnt/d/x')
  } finally {
    rmSync(users, { recursive: true, force: true })
  }
})

test('inside WSL without a folder the warning says why', () => {
  const users = tempRoot()
  try {
    assert.match(wslMissNotice(join(users, 'missing')), /isn't visible at/)
    assert.match(wslMissNotice(users), /no Windows user/)
    mkdirSync(join(users, 'Ann', 'AppData', 'Local', 'Softhalo'), { recursive: true })
    mkdirSync(join(users, 'Sam', 'AppData', 'Local', 'Softhalo'), { recursive: true })
    const notice = wslMissNotice(users)
    assert.match(notice, /several Windows users/)
    assert.match(notice, /SOFTHALO_USAGE_DIR/)
  } finally {
    rmSync(users, { recursive: true, force: true })
  }
})

test('a folder that cannot be written names the folder and the error code', async () => {
  const dir = tempRoot()
  try {
    writeFileSync(join(dir, 'x'), 'a file, so x/usage can never be a folder')
    const root = join(dir, 'x', 'usage')
    const error = await publish(root, buildEvent({ usage: { input: 1, output: 2 } } as never, {} as never, 'oc-test', NOW), NOW).then(() => null, e => e)
    assert.ok(error, 'the write must fail')
    const notice = writeFailedNotice(root, error)
    assert.match(notice, /can't write to/)
    assert.match(notice, /\((ENOTDIR|EEXIST|ENOENT)\)/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an event is published into the inbox as one whole .json file with no .tmp left', async () => {
  const root = tempRoot()
  try {
    const e = buildEvent({ sessionId: 'sess/1', usage: { input: 1, output: 2 } }, {}, 'p', NOW)
    const r = await publish(root, e, NOW)
    const files = readdirSync(join(root, 'inbox'))
    assert.equal(files.length, 1)
    assert.match(files[0], /^openclaw-sess_1-\d+-\d+-[0-9a-f]{8}\.json$/)
    assert.equal(r.written, join(root, 'inbox', files[0]))
    const back = JSON.parse(readFileSync(r.written!, 'utf8'))
    assert.equal(back.session_id, 'sess/1')
    assert.equal(back.dropped_before, undefined)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('two events in the same millisecond get different names', async () => {
  const root = tempRoot()
  try {
    const e = buildEvent({ sessionId: 's', usage: { output: 1 } }, {}, 'p', NOW)
    await publish(root, e, NOW)
    await publish(root, e, NOW)
    assert.equal(readdirSync(join(root, 'inbox')).length, 2)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('while the inbox is full nothing is written, and the next event reports the gap', async () => {
  const root = tempRoot()
  try {
    const e = buildEvent({ sessionId: 's', usage: { output: 1 } }, {}, 'p', NOW)
    mkdirSync(join(root, 'inbox'))
    writeFileSync(join(root, 'inbox', '.full'), '') // Soft Halo's marker

    assert.deepEqual(await publish(root, e, NOW), { written: null, dropped: true })
    assert.deepEqual(await publish(root, e, NOW), { written: null, dropped: true })
    assert.deepEqual(readdirSync(join(root, 'inbox')), ['.full'])

    rmSync(join(root, 'inbox', '.full'))
    const r = await publish(root, e, NOW)
    assert.equal(JSON.parse(readFileSync(r.written!, 'utf8')).dropped_before, 2)
    assert.equal(existsSync(join(root, 'openclaw-dropped.json')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('file names stay plain even for odd session ids', () => {
  assert.equal(safeName('../../etc'), '______etc')
  assert.equal(safeName(''), 'unknown')
})

test('an unmounted Windows drive: the warning says to mount it', () => {
  assert.match(wslMissNotice('/no/such/mnt/c/Users'), /Mount your Windows drive/)
})

test('a drive mounted later is found within a minute, without a restart', () => {
  const base = mkdtempSync(join(tmpdir(), 'softhalo-oc-mount-'))
  try {
    const users = join(base, 'c', 'Users').split('\\').join('/')
    let clock = 1_000_000
    const rootNow = wslRootFinder(users, 'u', () => clock)
    assert.equal(rootNow(), null)
    // The drive is mounted and Soft Halo's folder appears; the plugin looks again only after a minute.
    mkdirSync(join(users, 'Tarun', 'AppData', 'Local', 'Softhalo'), { recursive: true })
    clock += 30_000
    assert.equal(rootNow(), null)
    clock += 31_000
    assert.equal(rootNow(), `${users}/Tarun/AppData/Local/Softhalo/usage`)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})
