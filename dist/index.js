// Soft Halo Usage for OpenClaw: records token usage for the Soft Halo desktop overlay.
// One hook, `llm_output`; one local file per model run attempt; no network, no tools, no commands.

import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry'
import { buildEvent, defaults, profileId, publish,                                        } from './src/event.js'

export default definePluginEntry({
  id: 'softhalo-usage',
  name: 'Soft Halo Usage',
  description: 'Records token usage to a local folder for the Soft Halo desktop app. No network requests.',
  register(api) {
    const { root, stateDir } = defaults()
    if (!root) return // no local-data folder known: nothing to write to

    api.on('llm_output', async (event                , ctx              ) => {
      try {
        const now = new Date()
        const profile = profileId(stateDir, ctx?.agentId ?? 'main')
        await publish(root, buildEvent(event, ctx ?? {}, profile, now), now)
      } catch {
        // Usage collection must never disturb the agent: a failed write loses one record only.
      }
    })
  },
})
