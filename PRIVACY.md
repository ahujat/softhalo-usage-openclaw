# Privacy policy: Soft Halo Usage for OpenClaw

Effective 9 November 2026.

## What the plugin collects

From OpenClaw's `llm_output` hook, and nothing else:

- token counts per model run attempt: uncached input, cache reads, cache writes and output
- the attempt's cost in US dollars, when OpenClaw has one: the provider's own bill where it reports one (OpenRouter does, marked `provider-billed`), otherwise OpenClaw's estimate from its price catalog (marked `openclaw-estimate`)
- the provider and model, the day, and whether the run was the main agent, a subagent or delegated to Codex
- the session id and agent id, and a one-way hash of the OpenClaw folder and agent

It does not collect prompts, responses, assistant text, messages, tool output, file contents, channel or sender details, account names, email addresses or credentials, although the hook makes some of them available.

## How it is used

Each record is written to a folder on your own computer (`%LOCALAPPDATA%\Softhalo\usage\inbox` on Windows) so the Soft Halo desktop app can show your usage. The plugin makes no network requests. Nothing is sent to the developer, to OpenClaw or to anyone else.

## How long it is kept

Soft Halo deletes each file as soon as it has stored it, and keeps its own history under its own settings. Uninstalling the plugin stops all writes, and you can delete the usage folder at any time.

## Children

The plugin is not directed at children under 18.

## Contact

Questions about privacy: email privacy@softhalo.app.
