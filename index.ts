// Soft Halo Usage for OpenClaw: records token usage for the Soft Halo desktop overlay.
// One hook, `llm_output`; one local file per model run attempt; no network, no tools, no commands.

import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry'
import { buildEvent, defaults, profileId, publish, writeFailedNotice, wslMissNotice, type AgentContext, type LlmOutputEvent } from './src/event.ts'

export default definePluginEntry({
  id: 'softhalo-usage',
  name: 'Soft Halo Usage',
  description: 'Records token usage to a local folder for the Soft Halo desktop app. No network requests.',
  register(api) {
    const { root, stateDir, wsl } = defaults()
    if (!root) {
      // Nothing to write to. In WSL, say why once (C: not mounted, or no Soft Halo on Windows).
      if (wsl) api.logger?.warn?.(wslMissNotice())
      return
    }

    let writeWarned = false
    api.on('llm_output', async (event: LlmOutputEvent, ctx: AgentContext) => {
      try {
        const now = new Date()
        const profile = profileId(stateDir, ctx?.agentId ?? 'main')
        await publish(root, buildEvent(event, ctx ?? {}, profile, now), now)
      } catch (error) {
        // Usage collection must never disturb the agent: a failed write loses one record only.
        // A folder that can't be written at all is said once, not on every run.
        if (!writeWarned && typeof (error as NodeJS.ErrnoException)?.code === 'string') {
          writeWarned = true
          api.logger?.warn?.(writeFailedNotice(root, error))
        }
      }
    })
  },
})
