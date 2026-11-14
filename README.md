# Soft Halo Usage for OpenClaw

**Shows your OpenClaw token usage in Soft Halo's always-on-top overlay, next to Claude Code and your other AI tools.** This plugin records usage numbers to a local folder; the Soft Halo desktop app reads them.

Status: 0.2.0. Tested on 12 November 2026 with OpenClaw 2026.11.3 in WSL: one OpenRouter run was recorded with its provider-billed cost and shown by Soft Halo 2.0.5.20.

## Requirements

- OpenClaw 2026.6.35 or later, which has the `llm_output` hook. Costs need a newer OpenClaw: 2026.6.35 reports tokens but no cost, 2026.11.3 reports both. Recent OpenClaw releases need Node 24.16 or later.
- **Windows** (OpenClaw on Windows itself or in WSL), with **Soft Halo for Windows 2.0.5.20 or later**. Without it, the plugin only writes small files that nothing reads.

Soft Halo with AI usage is in beta: get the signed 2.0.5.28 build from the [beta page](https://softhalo.app/download/beta-20528-c17d7d2ef502eea9) (SHA-256 `9AFBDAEF9CE076B6ED1525FF7E6D93D61C0B4A4F5F9152ED59A446B0F0389C59`, also in [SHA256SUMS.txt](https://softhalo.app/downloads/windows/beta-2.0.5.28-9afbdaef9ce076b6/SHA256SUMS.txt)).

## Install

1. Install it from [ClawHub](https://docs.openclaw.ai/clawhub), where it is published as `@ahujat/softhalo-usage-openclaw`:
   ```bash
   openclaw plugins install --accept-capabilities clawhub:@ahujat/softhalo-usage-openclaw
   ```
   `--accept-capabilities` consents to the usage hook below. Keep the `clawhub:` prefix: without it OpenClaw looks the name up on npm, where the plugin is not published.

   Or install from a checkout of this repository, which includes the built `dist/` (or run `npm run build`):
   ```bash
   openclaw plugins install --force --accept-capabilities ./softhalo-usage-openclaw
   ```
   OpenClaw asks for `--force` for any plugin from a local folder.
2. In `openclaw.json`, allow the plugin and its usage hook:
   ```json
   "plugins": {
     "allow": ["softhalo-usage"],
     "entries": { "softhalo-usage": { "enabled": true, "hooks": { "allowConversationAccess": true } } }
   }
   ```
   OpenClaw loads a plugin it cannot verify only when `plugins.allow` lists it, and puts `llm_output`, the only hook that reports token usage, behind `allowConversationAccess` for every non-bundled plugin. The plugin reads only the usage counters, the cost, model and ids from it; see *What it records*. If `plugins.allow` already lists other plugins, add `softhalo-usage` to that list.
3. Restart the gateway.

**Installing from a local folder in WSL? Keep the folder on the Linux side** (for example under `~/`), not on a Windows drive such as `/mnt/c` or `/mnt/e`. WSL shows Windows drives as writable by everyone, and OpenClaw refuses to load a plugin from such a folder ("blocked plugin candidate: world-writable path"). The plugin still writes to Soft Halo's Windows folder; see *In WSL* below.

## What it records

After each model run attempt, one small file with:

- token counts: uncached input, cache reads, cache writes and output (OpenClaw already reports them separately)
- the attempt's cost in US dollars, when OpenClaw has one: the provider's own bill where it reports one (OpenRouter does, marked `provider-billed`), otherwise OpenClaw's estimate from its price catalog (marked `openclaw-estimate`)
- the provider and model, the session id and agent id
- whether the run was the main agent, a subagent, or delegated to a Codex runtime (Codex's own collector counts those, so Soft Halo keeps OpenClaw's copy out of the totals)
- the time and local date it finished

It never records prompts, responses, assistant text, messages or tool output, even though the hook makes them available. Your OpenClaw folder and agent are identified only by a one-way hash.

**Accuracy.** OpenClaw reports usage once per run attempt, so one record can cover several model calls in a tool loop; the tokens are exact, the request count is per attempt. OpenClaw does not dispatch `llm_output` for incognito sessions, and may not for a run cut off by a gateway restart; those runs are missing.

## Files this plugin writes and reads

It writes one file per run attempt into Soft Halo's inbox, and nothing else:

- `%LOCALAPPDATA%\Softhalo\usage\inbox\openclaw-<session>-<time>-<process>-<random>.json`

Each file is written as `.tmp` and renamed when whole, so Soft Halo never reads half a file. Soft Halo deletes it after storing it. While Soft Halo reports its inbox full (`inbox\.full`), the plugin writes nothing and keeps a count in `%LOCALAPPDATA%\Softhalo\usage\openclaw-dropped.json`, which the next file reports so Soft Halo can show the gap.

### In WSL

When OpenClaw runs inside WSL on the same Windows PC, the plugin writes to the same Windows folder, through the C: drive mount: `/mnt/c/Users/<Windows user>/AppData/Local/Softhalo/usage/`. It finds the Windows user by looking for an `AppData/Local/Softhalo` folder under `/mnt/c/Users`. If exactly one user has one, it uses that. If several do, it uses the one whose name matches your Linux user name. If it finds none, it writes nothing. If your C: drive is mounted elsewhere, or the names differ, set `SOFTHALO_USAGE_DIR` to the folder, for example `/mnt/c/Users/Ann/AppData/Local/Softhalo/usage`. `SOFTHALO_USAGE_DIR` also overrides the folder on Windows.

It reads only that count file and checks whether `inbox\.full` exists.

## What it does not do

- No network requests. Nothing leaves your machine.
- No tools, commands, channels or changes to how your agents behave.

## Development

```bash
node --test tests/event.test.ts
npm run build
```

`npm run build` writes `dist/` from the TypeScript sources with Node's own type stripping, so it needs no compiler or dependencies. OpenClaw loads `dist/index.js`; an installed plugin must ship JavaScript, and OpenClaw accepts TypeScript entries only from a linked development folder.

`node tests/make-fixture.ts <folder>` writes this plugin's real output for Soft Halo's collector tests (`Fixtures/AiUsage/adapter-output`).

## Privacy

See [PRIVACY.md](PRIVACY.md).

## License

MIT. See [LICENSE](LICENSE).
