// Soft Halo Usage for OpenClaw: turns one `llm_output` hook call into one softhalo.event/1 file.
// Only allowlisted usage and identity fields are copied; prompts, assistant text and messages
// in the hook payload are never read into the record.

import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync, readdirSync } from 'node:fs'
import { homedir, release } from 'node:os'
import { join } from 'node:path'

export const ADAPTER_VERSION = '0.2.2'
/** Soft Halo refuses event files over 16 KiB. */
export const EVENT_MAX_BYTES = 16 * 1024
const ID_MAX = 200

/** The subset of OpenClaw's `llm_output` event this adapter reads. */
export interface LlmOutputEvent {
  runId?: string
  sessionId?: string
  provider?: string
  model?: string
  resolvedRef?: string
  harnessId?: string
  /**
   * OpenClaw's plugin type lists only the token counts, but at run time this is the attempt's
   * normalized usage, which also carries `cost` (summed over the attempt's model calls) and
   * `costStatus`. `cost.totalOrigin` is "provider-billed" when every call's total came from the
   * provider's own bill (OpenRouter's `usage.cost`); otherwise the total is OpenClaw's estimate from
   * its model price catalog.
   */
  usage?: {
    input?: number
    output?: number
    cacheRead?: number
    cacheWrite?: number
    total?: number
    cost?: { total?: number; totalOrigin?: string }
    costStatus?: string
  }
}

/** The subset of OpenClaw's hook context this adapter reads. */
export interface AgentContext {
  agentId?: string
  sessionKey?: string
  sessionId?: string
}

export type Counter = number | null

export interface EventRecord {
  format: 'softhalo.event/1'
  app: 'openclaw'
  adapter_version: string
  profile: string
  session_id: string
  agent_id: string | null
  call_kind: 'main' | 'subagent' | 'delegated'
  status: 'completed'
  provider: string
  model: string
  completed_at: string
  utc_offset_minutes: number
  day: string
  usage: { input_uncached: Counter; cache_read: Counter; cache_write: Counter; output: Counter; reasoning: null } | null
  /** In US dollars (OpenRouter credits are dollars). Absent when OpenClaw has no cost for the attempt. */
  cost_usd?: number
  /** "provider-billed": the provider's own bill. "openclaw-estimate": OpenClaw's catalog prices. */
  cost_source?: 'provider-billed' | 'openclaw-estimate'
  dropped_before?: number
}

/** Soft Halo's usage folder on this system, or null when no home folder is known. */
export function usageRoot(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, home: string | undefined): string | null {
  const trim = (p: string) => p.replace(/[\\/]+$/, '')
  if (platform === 'win32') return env.LOCALAPPDATA ? join(trim(env.LOCALAPPDATA), 'Softhalo', 'usage') : null
  if (!home) return null
  if (platform === 'darwin') return join(trim(home), 'Library', 'Application Support', 'Softhalo', 'usage')
  if (env.XDG_STATE_HOME && env.XDG_STATE_HOME.startsWith('/')) return join(trim(env.XDG_STATE_HOME), 'softhalo', 'usage')
  return join(trim(home), '.local', 'state', 'softhalo', 'usage')
}

/** WSL mounts the Windows C: drive here unless /etc/wsl.conf moves it; SOFTHALO_USAGE_DIR covers that case. */
export const WSL_USERS_DIR = '/mnt/c/Users'
/** Windows profile folders that are never a person's. */
const NOT_A_USER = new Set(['all users', 'default', 'default user', 'public'])

/** True inside WSL, where Soft Halo itself runs on the Windows side. */
export function isWsl(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, osRelease: string): boolean {
  return platform === 'linux' && (!!env.WSL_DISTRO_NAME || !!env.WSL_INTEROP || /microsoft/i.test(osRelease))
}

/**
 * Inside WSL: the Windows user whose `AppData\Local\Softhalo` folder exists, seen through the
 * drive mount. One such user is the answer; with several, the one named like the Linux user;
 * otherwise null, and nothing is written (SOFTHALO_USAGE_DIR then says where).
 */
export function wslUsageRoot(usersDir: string, linuxUser: string | undefined): string | null {
  let people: string[]
  try {
    people = readdirSync(usersDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && !NOT_A_USER.has(d.name.toLowerCase()))
      .map(d => d.name)
      .filter(name => existsSync(`${usersDir}/${name}/AppData/Local/Softhalo`))
  } catch {
    return null
  }
  const pick =
    people.length === 1 ? people[0] : people.find(name => !!linuxUser && name.toLowerCase() === linuxUser.toLowerCase())
  return pick ? `${usersDir.replace(/\/+$/, '')}/${pick}/AppData/Local/Softhalo/usage` : null
}

/** The one warning logged when WSL gives no folder, saying why nothing will be recorded. */
export function wslMissNotice(usersDir = WSL_USERS_DIR): string {
  let why: string
  try {
    const people = readdirSync(usersDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && !NOT_A_USER.has(d.name.toLowerCase()))
      .filter(d => existsSync(`${usersDir}/${d.name}/AppData/Local/Softhalo`))
    why =
      people.length > 1
        ? `several Windows users under ${usersDir} have a Soft Halo folder and none is named like your Linux user`
        : `no Windows user under ${usersDir} has a Soft Halo folder (is Soft Halo installed on Windows?)`
  } catch {
    why = `the Windows drive isn't visible at ${usersDir}`
  }
  return `Soft Halo Usage: nothing is recorded, because ${why}. Set SOFTHALO_USAGE_DIR to Soft Halo's usage folder, for example /mnt/c/Users/<you>/AppData/Local/Softhalo/usage.`
}

/** The one warning logged when the usage folder can't be written (a drive not mounted, no permission). */
export function writeFailedNotice(root: string, error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code ?? 'write failed'
  return `Soft Halo Usage: can't write to ${root} (${code}), so nothing is recorded. Check that the drive is mounted and SOFTHALO_USAGE_DIR, if set, names Soft Halo's usage folder.`
}

/** Where to write: SOFTHALO_USAGE_DIR if set, the Windows side inside WSL, else this system's own folder. */
export function resolveRoot(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  home: string | undefined,
  osRelease: string,
  usersDir = WSL_USERS_DIR,
): string | null {
  if (env.SOFTHALO_USAGE_DIR) return env.SOFTHALO_USAGE_DIR.replace(/[\/]+$/, '')
  if (isWsl(env, platform, osRelease)) return wslUsageRoot(usersDir, env.USER)
  return usageRoot(env, platform, home)
}

/** One-way id for the OpenClaw state folder and agent; neither path nor name is ever written. */
export function profileId(stateDir: string, agentId: string): string {
  const normalized = stateDir.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  return 'oc-' + createHash('sha256').update(`${normalized}|${agentId}`).digest('hex').slice(0, 20)
}

const counter = (v: unknown): Counter => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null)
const clip = (v: unknown, fallback: string): string => {
  const s = typeof v === 'string' && v.trim() ? v.trim() : fallback
  return s.length > ID_MAX ? s.slice(0, ID_MAX) : s
}

/** Local date and UTC offset at `now`, by this machine's time zone. */
export function localDay(now: Date): { day: string; offset: number } {
  const offset = -now.getTimezoneOffset()
  const local = new Date(now.getTime() + offset * 60_000)
  return { day: local.toISOString().slice(0, 10), offset }
}

/**
 * Who ran the work. A Codex harness underneath means Codex's own collector is the authoritative
 * record, so this one is `delegated` and stays outside Soft Halo's totals. Subagent runs carry
 * `:subagent:` in their session key.
 */
export function callKind(event: LlmOutputEvent, ctx: AgentContext): EventRecord['call_kind'] {
  const harness = (event.harnessId ?? '').toLowerCase()
  if (harness === 'codex' || (event.resolvedRef ?? '').toLowerCase().startsWith('codex/')) return 'delegated'
  if ((ctx.sessionKey ?? '').includes(':subagent:')) return 'subagent'
  return 'main'
}

/** The attempt's cost and where it came from, or null when OpenClaw reports none. */
export function attemptCost(usage: LlmOutputEvent['usage']): { cost_usd: number; cost_source: 'provider-billed' | 'openclaw-estimate' } | null {
  const total = usage?.cost?.total
  if (usage?.costStatus === 'unavailable' || typeof total !== 'number' || !Number.isFinite(total) || total < 0) return null
  return { cost_usd: total, cost_source: usage?.cost?.totalOrigin === 'provider-billed' ? 'provider-billed' : 'openclaw-estimate' }
}

export function buildEvent(event: LlmOutputEvent, ctx: AgentContext, profile: string, now: Date): EventRecord {
  const u = event.usage
  const counters = {
    input_uncached: counter(u?.input),
    cache_read: counter(u?.cacheRead),
    cache_write: counter(u?.cacheWrite),
    output: counter(u?.output),
    reasoning: null,
  }
  const anyKnown = counters.input_uncached !== null || counters.cache_read !== null || counters.cache_write !== null || counters.output !== null
  const { day, offset } = localDay(now)
  return {
    format: 'softhalo.event/1',
    app: 'openclaw',
    adapter_version: ADAPTER_VERSION,
    profile,
    session_id: clip(event.sessionId ?? ctx.sessionId, 'unknown'),
    agent_id: ctx.agentId ? clip(ctx.agentId, '') : null,
    call_kind: callKind(event, ctx),
    status: 'completed',
    provider: clip(event.provider, 'unknown'),
    model: clip(event.model, 'unknown'),
    completed_at: now.toISOString(),
    utc_offset_minutes: offset,
    day,
    usage: anyKnown ? counters : null,
    ...(attemptCost(u) ?? {}),
  }
}

/** File-name-safe form of a session id; the record keeps the real one. */
export const safeName = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'unknown'

export interface WriteResult {
  written: string | null
  dropped: boolean
}

/**
 * Publishes one event into `<root>/inbox/` by writing `name.tmp` and renaming it, so Soft Halo
 * only ever sees whole files. While Soft Halo's `inbox/.full` marker exists nothing is written;
 * the request is counted in `openclaw-dropped.json` and reported on the next event instead.
 */
export async function publish(root: string, record: EventRecord, now: Date): Promise<WriteResult> {
  const inbox = join(root, 'inbox')
  const droppedPath = join(root, 'openclaw-dropped.json')
  await mkdir(inbox, { recursive: true })
  const dropped = await readDropped(droppedPath)

  if (existsSync(join(inbox, '.full'))) {
    await writeAtomic(droppedPath, JSON.stringify({ count: dropped + 1 }))
    return { written: null, dropped: true }
  }

  const out: EventRecord = dropped > 0 ? { ...record, dropped_before: dropped } : record
  const text = JSON.stringify(out)
  if (Buffer.byteLength(text) > EVENT_MAX_BYTES) return { written: null, dropped: false }
  const name = `openclaw-${safeName(record.session_id)}-${now.getTime()}-${process.pid}-${randomBytes(4).toString('hex')}`
  const target = join(inbox, `${name}.json`)
  await writeAtomic(target, text)
  if (dropped > 0) await rm(droppedPath, { force: true })
  return { written: target, dropped: false }
}

async function readDropped(path: string): Promise<number> {
  try {
    const n = JSON.parse(await readFile(path, 'utf8'))?.count
    return typeof n === 'number' && n > 0 ? Math.floor(n) : 0
  } catch {
    return 0
  }
}

async function writeAtomic(path: string, text: string): Promise<void> {
  const tmp = path.replace(/\.json$/, '') + '.tmp'
  await writeFile(tmp, text, 'utf8')
  await rename(tmp, path)
}

/** Default folder locations from this process's environment. */
export function defaults(env: NodeJS.ProcessEnv = process.env) {
  const home = env.HOME || env.USERPROFILE || homedir()
  return {
    root: resolveRoot(env, process.platform, home, release()),
    wsl: isWsl(env, process.platform, release()),
    stateDir: env.OPENCLAW_STATE_DIR || join(home, '.openclaw'),
  }
}
