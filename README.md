# mcp-remnawave

**English** · [Русский](README.ru.md)

<p align="center">
  <img src="assets/certified-ai-bullshit.jpeg" alt="Certified AI Bullshit" width="180">
</p>
<p align="center"><sub>Badge image by <a href="https://github.com/vas3k">vas3k</a></sub></p>

MCP server for the [Remnawave](https://github.com/remnawave/) panel. It gives an LLM client
(Claude Code, Claude Desktop, Cursor…) the whole panel API plus the things the raw API makes painful:
fleet-wide joins, compact output and safe, reviewable edits of big configs.

> Written with Claude (Anthropic) and checked against a live 3.4.4 panel and a local mock for the write paths.
> Read the diff before giving it write access.

| | |
|---|---|
| Version | 3.0.0 |
| Panel | Remnawave 3.4.x |
| Contract | `@remnawave/backend-contract` 3.4.x |
| Runtime | Node.js 22+ |
| Tools | 200 (95 in read-only mode) — [full list](docs/TOOLS.md) |

## Why 3.0

Version 2 mapped the API one-to-one. In real use that meant:

- `nodes_list` returned 2.3 MB, `hosts_list` 1.3 MB — clients rejected the answer;
- REALITY private keys of every inbound leaked into outputs of `nodes_*` and `squads_*`;
- changing one address in a 300-inbound profile or a 160 KB template meant resending all of it;
- a 400 said only “Validation failed”, without the field;
- “which pools use this host?”, “why does this inbound reach nobody?” were answered in SQL.

3.0 keeps full API coverage and adds:

| Area | What you get |
|---|---|
| Output | Compact rows by default; secrets masked; anything over the size limit is written to a file and the path returned |
| Errors | Field-level validation messages; bodies checked against the contract before sending; retries and throttling for a panel that times out under load |
| Views | `fleet_overview`, `inbound_trace`, `host_usage`, `pools_audit`, `config_search` — the joins across nodes, profiles, squads, hosts and template pools |
| Editing | `config_profile_patch`, `sub_template_patch`, `pools_edit`, `hosts_bulk_edit`, `hosts_clone`, `hosts_move`, `node_inbounds_edit`, `squad_inbounds_edit` |
| Safety | Dry run → `planHash` → apply; backup before every write; write journal; `backup_restore` |
| Checks | Pool emptied by a disabled host, inbound removal that would null host bindings, tag collisions across profiles, routing references to missing outbounds/balancers, contract limits |
| References | Nodes, profiles, squads and templates by **name**; inbounds by **tag**; hosts by uuid or a unique prefix |

## Quick start

```bash
git clone https://github.com/akadorkin/mcp-remnawave.git
cd mcp-remnawave
npm ci && npm run build
```

Claude Code:

```bash
claude mcp add remnawave -s user \
  -e REMNAWAVE_BASE_URL=https://panel.example.com \
  -e REMNAWAVE_API_TOKEN=<token> \
  -- node /path/to/mcp-remnawave/dist/index.js
```

Other clients: run `node dist/index.js` over stdio with the same environment.

## Configuration

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `REMNAWAVE_BASE_URL` | yes | | Panel URL, without `/api` |
| `REMNAWAVE_API_TOKEN` | yes | | API token (Settings → API tokens) |
| `REMNAWAVE_READONLY` | | `false` | `true` registers only reading tools |
| `REMNAWAVE_STATE_DIR` | | `~/.local/state/remnawave-mcp` | Backups, journal, oversized outputs, subscription snapshots |
| `REMNAWAVE_MAX_OUTPUT_CHARS` | | `40000` | Larger results go to a file |
| `REMNAWAVE_REDACT_KEYS` | | `privateKey,mldsa65Seed` | Keys masked in every output |
| `REMNAWAVE_TIMEOUT_MS` | | `60000` | Per-request timeout |
| `REMNAWAVE_SUB_BASE_URL` | | `<base>/api/sub` | Prefix for public subscription URLs |
| `REMNAWAVE_PROBE_SHORT_UUID` | | | Default account for `subscription_fetch` — use a monitoring account |
| `REMNAWAVE_API_KEY` | | | Sent as `X-Api-Key` (Caddy auth) |
| `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` | | | Cloudflare Access service token |

## How edits work

Every tool that changes profiles, templates, pools, several hosts or node bindings runs in two steps:

1. Call it without `apply` → you get the exact diff, blockers, warnings and a `planHash`.
2. Call it again with `apply: true, planHash: "…"` → the plan is rebuilt from fresh data; if anything changed
   since step 1, the apply is refused. Otherwise each object is backed up, written, re-read and compared.

Single-object tools (`hosts_update`, `nodes_update`, …) write immediately but still back up and journal.
Destructive ones (`nodes_delete`, `config_profiles_delete`, `squads_*_all_users`) first show the impact and
require `confirmName`.

`journal_list` shows what was changed, `backups_list` / `backup_restore` roll it back.

### Paths

Edits address JSON with pointer paths plus selectors:

```text
/outbounds[tag=relay-out]/settings/vnext/0/address
/inbounds[tag=vless-reality-443]/streamSettings/realitySettings/serverNames
/routing/rules[outboundTag=block][network=tcp,udp]
/routing/rules[inboundTag~=vless-5443]          # ~= : array contains
/remnawave/injectHosts/0/selector/values
```

A selector must match exactly one element — never a guess.
Operations: `replace`, `set`, `add`, `remove`, `test`, `move`, `copy`, `merge`, `insert`, `array_add`,
`array_remove`, `replace_string` (with `expect` = exact number of replacements).

```json
{
  "profile": "eu-ingress",
  "ops": [{ "op": "replace", "path": "/outbounds[tag=relay-out]/settings/vnext/0/address", "value": "10.0.0.2" }]
}
```

## Development

```bash
npm run build        # tsc --noEmit, then tsup
npm run docs:tools   # regenerate docs/TOOLS.md
```

```text
src/
  client/      HTTP client: retries, throttle, field-level errors
  core/        fleet index (joins), JSON edit engine + diff, plan/apply, backups, output policy, views
  tools/       tool groups; fleet.ts, maintenance.ts and subscription-render.ts are the cross-cutting ones
  resources/   remnawave://stats, nodes, health, users/{id}
  prompts/     guided workflows
```

Upstream: [TrackLine/mcp-remnawave](https://github.com/TrackLine/mcp-remnawave) (1.x, panel 2.x).

## License

MIT
