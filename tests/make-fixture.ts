// Writes this adapter's real output for Soft Halo's collector tests.
// Usage: node tests/make-fixture.ts <output folder>
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildEvent, profileId } from '../src/event.ts'

const out = process.argv[2]
if (!out) throw new Error('usage: node tests/make-fixture.ts <output folder>')
mkdirSync(out, { recursive: true })

const now = new Date('2026-11-07T12:00:00.000Z')
const profile = profileId('/home/u/.openclaw', 'main')
const cases = {
  'openclaw-main.json': buildEvent(
    { runId: 'r1', sessionId: 'oc-s1', provider: 'anthropic', model: 'claude-sonnet-5-5', usage: { input: 120, output: 60, cacheRead: 1000, cacheWrite: 40, total: 1220 } },
    { agentId: 'main', sessionKey: 'agent:main:main' },
    profile,
    now,
  ),
  'openclaw-no-usage.json': buildEvent({ runId: 'r2', sessionId: 'oc-s1', provider: 'openai', model: 'gpt-5.4' }, { agentId: 'main' }, profile, now),
  'openclaw-delegated.json': buildEvent(
    { runId: 'r3', sessionId: 'oc-s1', provider: 'openai', model: 'gpt-5.4', harnessId: 'codex', usage: { input: 300, output: 100 } },
    { agentId: 'main' },
    profile,
    now,
  ),
}
for (const [name, record] of Object.entries(cases)) writeFileSync(join(out, name), JSON.stringify(record, null, 2) + '\n')
console.log(`wrote ${Object.keys(cases).length} files to ${out}`)
