# mcp-remnawave

[English](#english) | [Русский](#русский)

<p align="center">
  <img src="assets/certified-ai-bullshit.jpeg" alt="Certified AI Bullshit" width="200">
</p>

> Version 2.0.0 was rewritten for the Remnawave 3.x API by Claude (Anthropic) and verified live against a 3.4.3 panel. Read the diff before trusting it with write access. / Версия 2.0.0 переписана под API Remnawave 3.x с помощью Claude (Anthropic) и проверена на живой панели 3.4.3. Прежде чем давать ей права на запись, прочитайте diff.

---
изображение certified-ai-bullshit принадлежит https://github.com/vas3k

<a id="english"></a>

## MCP Server for Remnawave Panel

MCP server ([Model Context Protocol](https://modelcontextprotocol.io)) providing LLM clients (Claude Desktop, Claude Code, Cursor, Windsurf, etc.) with tools to manage a [Remnawave](https://github.com/remnawave/) VPN panel.

**Version:** 2.0.0 | **Remnawave panel:** 3.4.x | **Contract:** @remnawave/backend-contract 3.4.13

> Panel 2.x users: stay on the [1.2.0 release](https://github.com/TrackLine/mcp-remnawave/releases) of the upstream project. Version 2.0.0 targets the 3.x API, which is not backward compatible (see [Migration from 1.x](#migration-from-1x)).

### Features

- **184 tools** — users, nodes, hosts, subscriptions, bandwidth stats, squads, HWID, config profiles, inbounds, connections, API tokens, billing, snippets, external squads, settings, subscription page configs, node plugins, node integrations and metadata
- **3 resources** — real-time panel stats, node status, health checks
- **5 prompts** — guided workflows for common tasks
- **Readonly mode** — restrict to 88 read-only tools for safe monitoring
- **Caddy / Cloudflare Access support** — `X-Api-Key` and `CF-Access-*` headers
- **Type-safe** — every route comes from [@remnawave/backend-contract](https://www.npmjs.com/package/@remnawave/backend-contract); `npm run build` type-checks first, so a contract bump surfaces removed routes at build time
- **stdio transport** — works with any MCP-compatible client

### Requirements

- Node.js >= 22
- Remnawave panel **3.4 or newer** with an API token (Settings > API Tokens)

### Installation

```bash
git clone https://github.com/akadorkin/mcp-remnawave.git
cd mcp-remnawave
npm install
npm run build
```

### Configuration

Create a `.env` file or pass environment variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `REMNAWAVE_BASE_URL` | Yes | Panel URL (e.g. `https://vpn.example.com`) |
| `REMNAWAVE_API_TOKEN` | Yes | API token from panel settings |
| `REMNAWAVE_API_KEY` | No | API key for Caddy reverse proxy authentication |
| `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` | No | Cloudflare Access service token |
| `REMNAWAVE_READONLY` | No | Set to `true` to enable readonly mode |

```env
REMNAWAVE_BASE_URL=https://vpn.example.com
REMNAWAVE_API_TOKEN=your-api-token-here
```

### Caddy with Custom Path

If your Remnawave panel is deployed behind [Caddy with a custom path and API key protection](https://docs.remnawave.com/docs/security/caddy-with-custom-path/), set the base URL to include the custom path and provide the API key:

```env
REMNAWAVE_BASE_URL=https://example.com/your-secret-path/api
REMNAWAVE_API_KEY=your-caddy-api-key
```

The `X-Api-Key` header will be added to every request automatically.

### Readonly Mode

Set `REMNAWAVE_READONLY=true` to disable all write operations (create, update, delete, enable, disable, restart, revoke, reset, drop). Only read/list tools will be registered. Tools that *start* a collection job (`connections_by_user`, `connections_by_node`, `connections_geocheck`) are considered read-only: they change nothing on the panel.

In readonly mode, the available tools are reduced from 184 to 88:

| Category | Available tools |
|----------|----------------|
| Users (10) | `users_list`, `users_find`, `users_stream`, `users_get`, `users_get_by_username`, `users_get_by_short_uuid`, `users_tags_list`, `users_resolve`, `users_accessible_nodes`, `users_subscription_request_history` |
| Nodes (3) | `nodes_list`, `nodes_get`, `nodes_tags_list` |
| Hosts (3) | `hosts_list`, `hosts_get`, `hosts_tags_list` |
| System & auth (13) | `system_stats`, `system_bandwidth_stats`, `system_nodes_metrics`, `system_nodes_statistics`, `system_stats_recap`, `system_stats_digest`, `system_http_stats`, `system_health`, `system_metadata`, `system_configuration`, `system_generate_x25519`, `auth_status`, `system_srr_matcher` |
| Bandwidth stats (7) | `bandwidth_nodes_usage`, `bandwidth_node_users_usage`, `bandwidth_nodes_users_usage`, `bandwidth_nodes_usage_by_uuids`, `bandwidth_user_usage`, `bandwidth_squad_usage`, `bandwidth_squad_user_usage` |
| Subscriptions & templates (12) | `subscriptions_list`, `subscriptions_get_by_id`, `subscriptions_get_by_username`, `subscriptions_get_by_short_uuid`, `subscription_info`, `subscriptions_get_raw_by_short_uuid`, `subscriptions_get_connection_keys`, `subscription_request_history_list`, `subscription_request_history_stats`, `sub_templates_list`, `sub_templates_get`, `sub_settings_get` |
| Config profiles & inbounds (5) | `config_profiles_list`, `config_profiles_get`, `inbounds_list`, `config_profiles_get_inbounds`, `config_profiles_get_computed_config` |
| Internal squads (3) | `squads_list`, `squads_get`, `squads_accessible_nodes` |
| External squads (2) | `external_squads_list`, `external_squads_get` |
| HWID devices (4) | `hwid_devices_list`, `hwid_devices_list_all`, `hwid_stats`, `hwid_top_users` |
| Connections (6) | `connections_by_user`, `connections_by_user_result`, `connections_by_node`, `connections_by_node_result`, `connections_geocheck`, `connections_geocheck_result` |
| API tokens (2) | `api_tokens_list`, `api_tokens_scopes` |
| Keygen (1) | `keygen_get` |
| Infra billing (4) | `billing_providers_list`, `billing_provider_get`, `billing_nodes_list`, `billing_history_list` |
| Snippets (1) | `snippets_list` |
| Panel settings (1) | `settings_get` |
| Subscription page configs (2) | `sub_page_configs_list`, `sub_page_configs_get` |
| Node plugins & shared lists (5) | `node_plugins_list`, `node_plugins_get`, `node_plugins_torrent_reports`, `node_plugins_torrent_stats`, `shared_lists_list` |
| Node integrations (2) | `node_integrations_list`, `node_integrations_get` |
| Metadata (2) | `metadata_node_get`, `metadata_user_get` |

### Usage with Claude Desktop

Add to your Claude Desktop configuration (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "remnawave": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-remnawave/dist/index.js"],
      "env": {
        "REMNAWAVE_BASE_URL": "https://vpn.example.com",
        "REMNAWAVE_API_TOKEN": "your-api-token-here",
        "REMNAWAVE_READONLY": "true"
      }
    }
  }
}
```

### Usage with Claude Code

```bash
claude mcp add -s user remnawave \
  -e REMNAWAVE_BASE_URL=https://vpn.example.com \
  -e REMNAWAVE_API_TOKEN=your-api-token-here \
  -e REMNAWAVE_READONLY=true \
  -- node /absolute/path/to/mcp-remnawave/dist/index.js
```

### Usage with Cursor / Windsurf

Add to `.cursor/mcp.json` or `.windsurf/mcp.json` in your project — same JSON as for Claude Desktop.

### Docker

```bash
npm run build
docker compose up -d
```

Environment variables are passed via `.env` file or `docker-compose.yml`.

### Migration from 1.x

Remnawave 3.x changed its identifiers, so most user-related tool parameters changed:

| 1.x | 2.0 | Notes |
|-----|-----|-------|
| `uuid` (user) | `id` (number) | Users are addressed by numeric `id`; the old UUID is now `vlessUuid` and is only a credential |
| `userUuid` (HWID) | `userId` | |
| `uuids` in `users_bulk_*` | `userIds` | numbers |
| `users_get_by_telegram_id`, `_by_email`, `_by_tag`, `_by_id`, `_by_subscription_uuid` | `users_find` / `users_list` filters / `users_stream` | Dedicated lookup routes were removed from the API |
| `subscriptions_get_by_uuid` | `subscriptions_get_by_id` | |
| `hosts_bulk_set_inbound`, `hosts_bulk_set_port` | `hosts_bulk_update` | Any host field can be bulk-applied |
| `tag` (host) | `tags` (array) | `allowInsecure` removed |
| `excludedInternalSquads` (host) | `internalSquads` + `internalSquadsMode` (`EXCLUDE` / `ALLOW_ONLY`) | |
| `ip_control_*` | `connections_*` | `drop` now takes `userIds` |
| `squads_add_users` (**added ALL users** in 1.x: the body was ignored) | `squads_add_users` with `userIds`; `squads_add_all_users` for the old behaviour | Same for `remove` and for external squads |
| `api_tokens_create { tokenName }` | `{ name, expiresInDays, scopes? }` | |
| `billing_node_create` | `name` and `nextBillingAt` are now required | |
| `nodes_restart` | takes `forceRestart` (default `false`) | 1.x sent no body and failed validation |
| `remnawave://users/{uuid}` | `remnawave://users/{id}` | |

New in 2.0: `users_extend`, `users_stream`, `users_accessible_nodes`, `users_subscription_request_history`, `bandwidth_*`, `system_stats_digest`, `system_http_stats`, `system_configuration`, `connections_geocheck`, `node_integrations_*`, `shared_lists_*`, `*_sync`, `api_tokens_scopes`, `sub_templates_*`, `sub_settings_get`, `hosts_reorder`, `squads_get`, `squads_reorder`.

Not exposed (absent from panel 3.4.3 or unstable between 3.4.x releases): tag get/set endpoints for profiles/squads/templates, node SSH tickets, shared-list delete / get-by-name.

### Notes from a live run against panel 3.4.3

- Bandwidth tools accept `YYYY-MM-DD`; a full ISO timestamp is truncated to the date because the panel validates these params as `date`.
- A token with role **API** gets `403 Forbidden` on `api_tokens_*` and `settings_*`. That is the role, not a bug.
- `metadata_*_get` returns `404 Metadata not found` until metadata has been created for that object.
- `connections_by_*` return a `jobId`; poll the matching `*_result` tool until `isCompleted` is true.

### Available Tools

#### Users (28 tools)

| Tool | Description | Mode |
|------|-------------|------|
| `users_list` | List Remnawave VPN users with pagination and optional column filters (exact match). Filter ids known to work: telegramId, vlessUuid, email, tag, status. | read |
| `users_find` | Find users by an exact attribute value: telegramId, email, tag or vlessUuid. Shortcut over users_list filters. | read |
| `users_stream` | Cursor-based export of users, optionally filtered by status/strategy/telegramId/email/tag/externalSquadUuid. Use for iterating over all users. | read |
| `users_get` | Get a user by numeric id | read |
| `users_get_by_username` | Get a user by username | read |
| `users_get_by_short_uuid` | Get a user by subscription short UUID | read |
| `users_tags_list` | List all user tags | read |
| `users_resolve` | Resolve a user by exactly one of: id, shortUuid, username | read |
| `users_accessible_nodes` | List nodes a user can connect to (via their internal squads) | read |
| `users_subscription_request_history` | Subscription fetch history (client apps, IPs, user agents) for a user | read |
| `users_create` | Create a new VPN user | write |
| `users_update` | Update an existing user (identify by id or username) | write |
| `users_delete` | Delete a user | write |
| `users_enable` | Enable a disabled user | write |
| `users_disable` | Disable a user | write |
| `users_revoke_subscription` | Revoke subscription: regenerates the short UUID and credentials (or only passwords) | write |
| `users_reset_traffic` | Reset traffic counter of a user | write |
| `users_extend` | Extend expiration date of a user by N days | write |
| `users_bulk_delete_by_status` | Delete all users with the given status | write |
| `users_bulk_update` | Bulk update fields for selected users | write |
| `users_bulk_reset_traffic` | Reset traffic for selected users | write |
| `users_bulk_revoke_subscription` | Revoke subscriptions for selected users | write |
| `users_bulk_delete` | Delete selected users | write |
| `users_bulk_update_squads` | Set internal squads for selected users | write |
| `users_bulk_extend_expiration` | Extend expiration date for selected users | write |
| `users_bulk_all_update` | Update ALL users at once | write |
| `users_bulk_all_reset_traffic` | Reset traffic counters for ALL users | write |
| `users_bulk_all_extend_expiration` | Extend expiration date for ALL users | write |

#### Nodes (15 tools)

| Tool | Description | Mode |
|------|-------------|------|
| `nodes_list` | List all nodes with status and traffic | read |
| `nodes_get` | Get a node by UUID | read |
| `nodes_tags_list` | List all node tags | read |
| `nodes_create` | Create a node. Requires name, address, activeConfigProfileUuid and activeInbounds. | write |
| `nodes_update` | Update a node (only the provided fields change) | write |
| `nodes_delete` | Delete a node (cascades: usage history, billing, host bindings) | write |
| `nodes_enable` | Enable a node | write |
| `nodes_disable` | Disable a node | write |
| `nodes_restart` | Restart xray on a node | write |
| `nodes_restart_all` | Restart xray on all nodes | write |
| `nodes_reset_traffic` | Reset traffic counter of a node | write |
| `nodes_reorder` | Reorder nodes | write |
| `nodes_bulk_profile_modification` | Set config profile and inbounds for selected nodes | write |
| `nodes_bulk_actions` | Enable / disable / restart / reset traffic on selected nodes | write |
| `nodes_bulk_update` | Bulk update properties for selected nodes | write |

#### Hosts (11 tools)

| Tool | Description | Mode |
|------|-------------|------|
| `hosts_list` | List all hosts | read |
| `hosts_get` | Get a host by UUID | read |
| `hosts_tags_list` | List all host tags | read |
| `hosts_create` | Create a host. Requires remark, address, port, configProfileUuid and configProfileInboundUuid. | write |
| `hosts_update` | Update a host (only the provided fields change) | write |
| `hosts_delete` | Delete a host | write |
| `hosts_reorder` | Reorder hosts | write |
| `hosts_bulk_enable` | Enable selected hosts | write |
| `hosts_bulk_disable` | Disable selected hosts | write |
| `hosts_bulk_delete` | Delete selected hosts | write |
| `hosts_bulk_update` | Apply the same field values to selected hosts (replaces the old set-inbound / set-port tools) | write |

#### System & auth (13 tools)

| Tool | Description | Mode |
|------|-------------|------|
| `system_stats` | Panel statistics: users, nodes, traffic, system resources | read |
| `system_bandwidth_stats` | Bandwidth statistics over standard periods | read |
| `system_nodes_metrics` | Per-node metrics | read |
| `system_nodes_statistics` | Nodes statistics (traffic per node over last days) | read |
| `system_stats_recap` | Recap statistics | read |
| `system_stats_digest` | Digest statistics for a period | read |
| `system_http_stats` | HTTP request statistics of the panel | read |
| `system_health` | Panel health check | read |
| `system_metadata` | Panel metadata (version, build) | read |
| `system_configuration` | Panel runtime configuration | read |
| `system_generate_x25519` | Generate an X25519 key pair for VLESS Reality | read |
| `auth_status` | Auth status of the panel | read |
| `system_srr_matcher` | Test subscription response rules (SRR) against the matcher | read |

#### Bandwidth stats (7 tools)

| Tool | Description | Mode |
|------|-------------|------|
| `bandwidth_nodes_usage` | Traffic per node for a period (top N nodes) | read |
| `bandwidth_node_users_usage` | Top users by traffic on one node for a period | read |
| `bandwidth_nodes_users_usage` | Top users by traffic across several nodes for a period | read |
| `bandwidth_nodes_usage_by_uuids` | Traffic of the given nodes for a period (optionally only nodes above minTotalBytes) | read |
| `bandwidth_user_usage` | Traffic of a user per node for a period | read |
| `bandwidth_squad_usage` | Traffic of users in an internal squad for a period (cursor paginated) | read |
| `bandwidth_squad_user_usage` | Traffic of one user inside an internal squad for a period | read |

#### Subscriptions & templates (12 tools)

| Tool | Description | Mode |
|------|-------------|------|
| `subscriptions_list` | List subscriptions with pagination | read |
| `subscriptions_get_by_id` | Get subscription of a user by numeric user id | read |
| `subscriptions_get_by_username` | Get subscription by username | read |
| `subscriptions_get_by_short_uuid` | Get subscription by short UUID | read |
| `subscription_info` | Public subscription info (what the client app sees) by short UUID | read |
| `subscriptions_get_raw_by_short_uuid` | Raw subscription (hosts with resolved links) by short UUID | read |
| `subscriptions_get_connection_keys` | Connection keys (links) of a user by numeric user id | read |
| `subscription_request_history_list` | Subscription request history (paginated, filterable) | read |
| `subscription_request_history_stats` | Subscription request history statistics | read |
| `sub_templates_list` | List subscription templates | read |
| `sub_templates_get` | Get a subscription template by UUID | read |
| `sub_settings_get` | Get global subscription settings | read |

#### Config profiles & inbounds (9 tools)

| Tool | Description | Mode |
|------|-------------|------|
| `config_profiles_list` | List all config profiles | read |
| `config_profiles_get` | Get a config profile by UUID | read |
| `inbounds_list` | List all inbounds from all config profiles | read |
| `config_profiles_get_inbounds` | Get inbounds for a specific config profile | read |
| `config_profiles_get_computed_config` | Get computed configuration for a config profile | read |
| `config_profiles_create` | Create a new config profile | write |
| `config_profiles_update` | Update a config profile | write |
| `config_profiles_delete` | Delete a config profile | write |
| `config_profiles_reorder` | Reorder config profiles | write |

#### Internal squads (11 tools)

| Tool | Description | Mode |
|------|-------------|------|
| `squads_list` | List internal squads | read |
| `squads_get` | Get an internal squad by UUID | read |
| `squads_accessible_nodes` | Nodes reachable through a squad | read |
| `squads_create` | Create an internal squad | write |
| `squads_update` | Update an internal squad | write |
| `squads_delete` | Delete an internal squad | write |
| `squads_reorder` | Reorder internal squads | write |
| `squads_add_users` | Add specific users (by numeric id) to an internal squad | write |
| `squads_remove_users` | Remove specific users (by numeric id) from an internal squad | write |
| `squads_add_all_users` | Add EVERY user of the panel to an internal squad | write |
| `squads_remove_all_users` | Remove EVERY user from an internal squad | write |

#### External squads (8 tools)

| Tool | Description | Mode |
|------|-------------|------|
| `external_squads_list` | List external squads | read |
| `external_squads_get` | Get an external squad by UUID | read |
| `external_squads_create` | Create an external squad | write |
| `external_squads_update` | Update an external squad (templates, subscription settings, headers, HWID settings...) | write |
| `external_squads_delete` | Delete an external squad | write |
| `external_squads_add_all_users` | Assign EVERY user of the panel to an external squad | write |
| `external_squads_remove_all_users` | Detach EVERY user from an external squad | write |
| `external_squads_reorder` | Reorder external squads | write |

#### HWID devices (7 tools)

| Tool | Description | Mode |
|------|-------------|------|
| `hwid_devices_list` | List HWID devices of a user | read |
| `hwid_devices_list_all` | List HWID devices across all users (paginated) | read |
| `hwid_stats` | HWID device statistics | read |
| `hwid_top_users` | Users with the most HWID devices | read |
| `hwid_device_create` | Register a HWID device for a user | write |
| `hwid_device_delete` | Delete one HWID device of a user | write |
| `hwid_devices_delete_all` | Delete all HWID devices of a user | write |

#### Connections (7 tools)

| Tool | Description | Mode |
|------|-------------|------|
| `connections_by_user` | Start a job collecting active connections (IPs) of a user across nodes. Returns a jobId. | read |
| `connections_by_user_result` | Fetch the result of a connections_by_user job | read |
| `connections_by_node` | Start a job collecting active connections of all users on a node. Returns a jobId. | read |
| `connections_by_node_result` | Fetch the result of a connections_by_node job | read |
| `connections_geocheck` | Start a geo/IP check from a node (optionally for a given ip or interface). Returns a jobId. | read |
| `connections_geocheck_result` | Fetch the result of a geocheck job | read |
| `connections_drop` | Drop active connections by user ids or IP addresses on all / specific nodes | write |

#### API tokens (4 tools)

| Tool | Description | Mode |
|------|-------------|------|
| `api_tokens_list` | List API tokens | read |
| `api_tokens_scopes` | List available API token scopes | read |
| `api_tokens_create` | Create an API token | write |
| `api_tokens_delete` | Delete an API token | write |

#### Keygen (1 tools)

| Tool | Description | Mode |
|------|-------------|------|
| `keygen_get` | Generate a new SECRET_KEY for node configuration | read |

#### Infra billing (12 tools)

| Tool | Description | Mode |
|------|-------------|------|
| `billing_providers_list` | List infrastructure billing providers | read |
| `billing_provider_get` | Get a billing provider by UUID | read |
| `billing_nodes_list` | List billing nodes | read |
| `billing_history_list` | List billing history (paginated) | read |
| `billing_provider_create` | Create a billing provider | write |
| `billing_provider_update` | Update a billing provider | write |
| `billing_provider_delete` | Delete a billing provider | write |
| `billing_node_create` | Attach a node to a billing provider | write |
| `billing_node_update` | Set next billing date for billing nodes | write |
| `billing_node_delete` | Delete a billing node | write |
| `billing_history_create` | Record a payment | write |
| `billing_history_delete` | Delete a payment record | write |

#### Snippets (5 tools)

| Tool | Description | Mode |
|------|-------------|------|
| `snippets_list` | List configuration snippets | read |
| `snippets_create` | Create a configuration snippet | write |
| `snippets_update` | Replace the content of a snippet | write |
| `snippets_delete` | Delete a snippet by name | write |
| `snippets_sync` | Push a snippet to nodes / config profiles that use it | write |

#### Panel settings (2 tools)

| Tool | Description | Mode |
|------|-------------|------|
| `settings_get` | Get Remnawave panel settings | read |
| `settings_update` | Update Remnawave panel settings | write |

#### Subscription page configs (7 tools)

| Tool | Description | Mode |
|------|-------------|------|
| `sub_page_configs_list` | List all subscription page configurations | read |
| `sub_page_configs_get` | Get a subscription page config by UUID | read |
| `sub_page_configs_create` | Create a subscription page configuration | write |
| `sub_page_configs_update` | Update a subscription page configuration | write |
| `sub_page_configs_delete` | Delete a subscription page configuration | write |
| `sub_page_configs_reorder` | Reorder subscription page configurations | write |
| `sub_page_configs_clone` | Clone a subscription page configuration | write |

#### Node plugins & shared lists (16 tools)

| Tool | Description | Mode |
|------|-------------|------|
| `node_plugins_list` | List node plugins | read |
| `node_plugins_get` | Get a node plugin by UUID | read |
| `node_plugins_torrent_reports` | Torrent blocker reports (paginated) | read |
| `node_plugins_torrent_stats` | Torrent blocker statistics | read |
| `shared_lists_list` | List node plugin shared lists | read |
| `node_plugins_create` | Create a node plugin | write |
| `node_plugins_update` | Update a node plugin | write |
| `node_plugins_delete` | Delete a node plugin | write |
| `node_plugins_reorder` | Reorder node plugins | write |
| `node_plugins_clone` | Clone a node plugin | write |
| `node_plugins_sync` | Push a plugin to the nodes that use it | write |
| `node_plugins_execute` | Execute a plugin command (blockIps / unblockIps / recreateTables) on target nodes | write |
| `node_plugins_torrent_truncate` | Truncate all torrent blocker reports | write |
| `shared_lists_create` | Create a shared list | write |
| `shared_lists_update` | Update a shared list | write |
| `shared_lists_sync` | Push a shared list to nodes | write |

#### Node integrations (5 tools)

| Tool | Description | Mode |
|------|-------------|------|
| `node_integrations_list` | List node integrations | read |
| `node_integrations_get` | Get a node integration by UUID | read |
| `node_integrations_create` | Create a node integration | write |
| `node_integrations_update` | Update a node integration | write |
| `node_integrations_delete` | Delete a node integration | write |

#### Metadata (4 tools)

| Tool | Description | Mode |
|------|-------------|------|
| `metadata_node_get` | Get custom metadata of a node | read |
| `metadata_user_get` | Get custom metadata of a user | read |
| `metadata_node_upsert` | Create or replace custom metadata of a node | write |
| `metadata_user_upsert` | Create or replace custom metadata of a user | write |

### Resources

| URI | Description |
|-----|-------------|
| `remnawave://stats` | Current panel statistics |
| `remnawave://nodes` | All nodes status |
| `remnawave://health` | Panel health status |
| `remnawave://users/{id}` | Specific user details (numeric id) |

### Prompts

| Prompt | Description |
|--------|-------------|
| `create_user_wizard` | Step-by-step user creation guide |
| `node_diagnostics` | Node troubleshooting |
| `traffic_report` | Traffic usage report |
| `user_audit` | Complete user audit |
| `bulk_user_cleanup` | Find and manage expired users |

### Example Queries

```
"Show me all users with expired subscriptions"
"Find the user with telegram id 123456 and extend them by 30 days"
"Create user vasya with 50 GB limit for one month"
"Restart node amsterdam-01"
"Top 10 users by traffic on node fl1 this week"
"Which nodes are offline right now?"
"Drop all connections of user 42"
```

### Project Structure

```
src/
├── index.ts                       # Entry point (stdio transport)
├── server.ts                      # McpServer setup
├── config.ts                      # Environment config
├── client/
│   └── index.ts                   # Remnawave HTTP client (routes from backend-contract)
├── tools/
│   ├── helpers.ts                 # Result formatting helpers
│   ├── index.ts                   # Tool registration
│   ├── users.ts                       # Users (28)
│   ├── nodes.ts                       # Nodes (15)
│   ├── hosts.ts                       # Hosts (11)
│   ├── system.ts                      # System & auth (13)
│   ├── bandwidth.ts                   # Bandwidth stats (7)
│   ├── subscriptions.ts               # Subscriptions & templates (12)
│   ├── inbounds.ts                    # Config profiles & inbounds (9)
│   ├── squads.ts                      # Internal squads (11)
│   ├── external-squads.ts             # External squads (8)
│   ├── hwid.ts                        # HWID devices (7)
│   ├── connections.ts                 # Connections (7)
│   ├── api-tokens.ts                  # API tokens (4)
│   ├── keygen.ts                      # Keygen (1)
│   ├── infra-billing.ts               # Infra billing (12)
│   ├── snippets.ts                    # Snippets (5)
│   ├── settings.ts                    # Panel settings (2)
│   ├── subscription-page-configs.ts   # Subscription page configs (7)
│   ├── node-plugins.ts                # Node plugins & shared lists (16)
│   ├── node-integrations.ts           # Node integrations (5)
│   ├── metadata.ts                    # Metadata (4)
├── resources/
│   └── index.ts                   # MCP resources
└── prompts/
    └── index.ts                   # MCP prompts
```

### Development

```bash
npm run typecheck   # tsc --noEmit
npm run build       # typecheck + tsup bundle
```

### License

MIT

---

<a id="русский"></a>

## MCP-сервер для Remnawave Panel

MCP-сервер ([Model Context Protocol](https://modelcontextprotocol.io)), предоставляющий LLM-клиентам (Claude Desktop, Claude Code, Cursor, Windsurf и др.) инструменты для управления VPN-панелью [Remnawave](https://github.com/remnawave/).

**Версия:** 2.0.0 | **Панель Remnawave:** 3.4.x | **Контракт:** @remnawave/backend-contract 3.4.13

> Для панели 2.x используйте [релиз 1.2.0](https://github.com/TrackLine/mcp-remnawave/releases) исходного проекта. Версия 2.0.0 рассчитана на API 3.x, обратной совместимости нет (см. [Миграция с 1.x](#миграция-с-1x)).

### Возможности

- **184 инструментов** — пользователи, ноды, хосты, подписки, статистика трафика, группы, HWID, конфиг-профили, inbounds, соединения, API-токены, биллинг, сниппеты, внешние группы, настройки, страницы подписок, плагины и интеграции нод, метаданные
- **3 ресурса** — статистика панели, статус нод, проверка здоровья
- **5 промптов** — пошаговые сценарии для типичных задач
- **Readonly-режим** — только 88 инструментов чтения
- **Поддержка Caddy / Cloudflare Access** — заголовки `X-Api-Key` и `CF-Access-*`
- **Type-safe** — все маршруты берутся из [@remnawave/backend-contract](https://www.npmjs.com/package/@remnawave/backend-contract); `npm run build` сначала прогоняет проверку типов, поэтому удалённые маршруты ловятся на сборке
- **stdio транспорт** — работает с любым MCP-совместимым клиентом

### Требования

- Node.js >= 22
- Панель Remnawave **3.4 или новее** с API-токеном (Настройки > API Tokens)

### Установка

```bash
git clone https://github.com/akadorkin/mcp-remnawave.git
cd mcp-remnawave
npm install
npm run build
```

### Конфигурация

Создайте файл `.env` или передайте переменные окружения:

| Переменная | Обязательная | Описание |
|------------|-------------|----------|
| `REMNAWAVE_BASE_URL` | Да | URL панели (например `https://vpn.example.com`) |
| `REMNAWAVE_API_TOKEN` | Да | API-токен из настроек панели |
| `REMNAWAVE_API_KEY` | Нет | API-ключ для аутентификации через Caddy reverse proxy |
| `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` | Нет | Сервисный токен Cloudflare Access |
| `REMNAWAVE_READONLY` | Нет | `true` для включения режима только чтения |

```env
REMNAWAVE_BASE_URL=https://vpn.example.com
REMNAWAVE_API_TOKEN=ваш-api-токен
```

### Caddy с кастомным путём

Если панель развёрнута за [Caddy с кастомным путём и защитой API-ключом](https://docs.remnawave.com/docs/security/caddy-with-custom-path/), укажите полный путь в base URL и API-ключ:

```env
REMNAWAVE_BASE_URL=https://example.com/your-secret-path/api
REMNAWAVE_API_KEY=ваш-caddy-api-ключ
```

Заголовок `X-Api-Key` будет добавляться к каждому запросу автоматически.

### Режим Readonly

Установите `REMNAWAVE_READONLY=true`, чтобы отключить все операции записи (создание, обновление, удаление, включение, отключение, перезапуск, отзыв, сброс, drop). Инструменты, которые лишь *запускают* сбор данных (`connections_by_user`, `connections_by_node`, `connections_geocheck`), считаются инструментами чтения: на панели они ничего не меняют.

В readonly-режиме доступно 88 инструментов из 184:

| Категория | Доступные инструменты |
|-----------|----------------------|
| Пользователи (10) | `users_list`, `users_find`, `users_stream`, `users_get`, `users_get_by_username`, `users_get_by_short_uuid`, `users_tags_list`, `users_resolve`, `users_accessible_nodes`, `users_subscription_request_history` |
| Ноды (3) | `nodes_list`, `nodes_get`, `nodes_tags_list` |
| Хосты (3) | `hosts_list`, `hosts_get`, `hosts_tags_list` |
| Система и авторизация (13) | `system_stats`, `system_bandwidth_stats`, `system_nodes_metrics`, `system_nodes_statistics`, `system_stats_recap`, `system_stats_digest`, `system_http_stats`, `system_health`, `system_metadata`, `system_configuration`, `system_generate_x25519`, `auth_status`, `system_srr_matcher` |
| Статистика трафика (7) | `bandwidth_nodes_usage`, `bandwidth_node_users_usage`, `bandwidth_nodes_users_usage`, `bandwidth_nodes_usage_by_uuids`, `bandwidth_user_usage`, `bandwidth_squad_usage`, `bandwidth_squad_user_usage` |
| Подписки и шаблоны (12) | `subscriptions_list`, `subscriptions_get_by_id`, `subscriptions_get_by_username`, `subscriptions_get_by_short_uuid`, `subscription_info`, `subscriptions_get_raw_by_short_uuid`, `subscriptions_get_connection_keys`, `subscription_request_history_list`, `subscription_request_history_stats`, `sub_templates_list`, `sub_templates_get`, `sub_settings_get` |
| Конфиг-профили и inbounds (5) | `config_profiles_list`, `config_profiles_get`, `inbounds_list`, `config_profiles_get_inbounds`, `config_profiles_get_computed_config` |
| Внутренние группы (squads) (3) | `squads_list`, `squads_get`, `squads_accessible_nodes` |
| Внешние группы (2) | `external_squads_list`, `external_squads_get` |
| HWID-устройства (4) | `hwid_devices_list`, `hwid_devices_list_all`, `hwid_stats`, `hwid_top_users` |
| Соединения (6) | `connections_by_user`, `connections_by_user_result`, `connections_by_node`, `connections_by_node_result`, `connections_geocheck`, `connections_geocheck_result` |
| API-токены (2) | `api_tokens_list`, `api_tokens_scopes` |
| Keygen (1) | `keygen_get` |
| Биллинг инфраструктуры (4) | `billing_providers_list`, `billing_provider_get`, `billing_nodes_list`, `billing_history_list` |
| Сниппеты (1) | `snippets_list` |
| Настройки панели (1) | `settings_get` |
| Страницы подписок (2) | `sub_page_configs_list`, `sub_page_configs_get` |
| Плагины нод и общие списки (5) | `node_plugins_list`, `node_plugins_get`, `node_plugins_torrent_reports`, `node_plugins_torrent_stats`, `shared_lists_list` |
| Интеграции нод (2) | `node_integrations_list`, `node_integrations_get` |
| Метаданные (2) | `metadata_node_get`, `metadata_user_get` |

### Использование с Claude Desktop

Добавьте в конфигурацию Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json` на macOS):

```json
{
  "mcpServers": {
    "remnawave": {
      "command": "node",
      "args": ["/абсолютный/путь/к/mcp-remnawave/dist/index.js"],
      "env": {
        "REMNAWAVE_BASE_URL": "https://vpn.example.com",
        "REMNAWAVE_API_TOKEN": "ваш-api-токен",
        "REMNAWAVE_READONLY": "true"
      }
    }
  }
}
```

### Использование с Claude Code

```bash
claude mcp add -s user remnawave \
  -e REMNAWAVE_BASE_URL=https://vpn.example.com \
  -e REMNAWAVE_API_TOKEN=ваш-api-токен \
  -e REMNAWAVE_READONLY=true \
  -- node /абсолютный/путь/к/mcp-remnawave/dist/index.js
```

### Использование с Cursor / Windsurf

Добавьте в `.cursor/mcp.json` или `.windsurf/mcp.json` проекта тот же JSON, что и для Claude Desktop.

### Docker

```bash
npm run build
docker compose up -d
```

Переменные окружения передаются через `.env` или `docker-compose.yml`.

### Миграция с 1.x

Remnawave 3.x поменял идентификаторы, поэтому изменились параметры большинства инструментов для пользователей:

| 1.x | 2.0 | Примечание |
|-----|-----|------------|
| `uuid` (пользователь) | `id` (число) | Пользователь адресуется числовым `id`; старый UUID теперь называется `vlessUuid` и является только credential'ом |
| `userUuid` (HWID) | `userId` | |
| `uuids` в `users_bulk_*` | `userIds` | числа |
| `users_get_by_telegram_id`, `_by_email`, `_by_tag`, `_by_id`, `_by_subscription_uuid` | `users_find` / фильтры `users_list` / `users_stream` | Отдельные маршруты поиска удалены из API |
| `subscriptions_get_by_uuid` | `subscriptions_get_by_id` | |
| `hosts_bulk_set_inbound`, `hosts_bulk_set_port` | `hosts_bulk_update` | Массово применяется любое поле хоста |
| `tag` (хост) | `tags` (массив) | `allowInsecure` удалён |
| `excludedInternalSquads` (хост) | `internalSquads` + `internalSquadsMode` (`EXCLUDE` / `ALLOW_ONLY`) | |
| `ip_control_*` | `connections_*` | `drop` принимает `userIds` |
| `squads_add_users` (в 1.x **добавлял ВСЕХ пользователей**: тело запроса игнорировалось) | `squads_add_users` с `userIds`; для старого поведения — `squads_add_all_users` | То же для `remove` и внешних групп |
| `api_tokens_create { tokenName }` | `{ name, expiresInDays, scopes? }` | |
| `billing_node_create` | `name` и `nextBillingAt` теперь обязательны | |
| `nodes_restart` | принимает `forceRestart` (по умолчанию `false`) | 1.x не слал тело и не проходил валидацию |
| `remnawave://users/{uuid}` | `remnawave://users/{id}` | |

Новое в 2.0: `users_extend`, `users_stream`, `users_accessible_nodes`, `users_subscription_request_history`, `bandwidth_*`, `system_stats_digest`, `system_http_stats`, `system_configuration`, `connections_geocheck`, `node_integrations_*`, `shared_lists_*`, `*_sync`, `api_tokens_scopes`, `sub_templates_*`, `sub_settings_get`, `hosts_reorder`, `squads_get`, `squads_reorder`.

Не вынесено в инструменты (нет в панели 3.4.3 или меняется между релизами 3.4.x): get/set тегов для профилей/групп/шаблонов, SSH-тикеты нод, удаление и поиск по имени для shared-lists.

### Заметки по живому прогону на панели 3.4.3

- Bandwidth-инструменты принимают `YYYY-MM-DD`; полный ISO-таймстамп обрезается до даты, потому что панель валидирует эти параметры как `date`.
- Токен с ролью **API** получает `403 Forbidden` на `api_tokens_*` и `settings_*`. Это роль токена, не ошибка сервера.
- `metadata_*_get` отвечает `404 Metadata not found`, пока метаданные для объекта не созданы.
- `connections_by_*` возвращают `jobId`; результат забирается соответствующим `*_result`, пока `isCompleted` не станет true.

### Доступные инструменты

Полный перечень с описаниями — в разделе [Available Tools](#available-tools) выше. Сводка по категориям:

| Категория | Всего | Чтение |
|-----------|-------|--------|
| Пользователи | 28 | 10 |
| Ноды | 15 | 3 |
| Хосты | 11 | 3 |
| Система и авторизация | 13 | 13 |
| Статистика трафика | 7 | 7 |
| Подписки и шаблоны | 12 | 12 |
| Конфиг-профили и inbounds | 9 | 5 |
| Внутренние группы | 11 | 3 |
| Внешние группы | 8 | 2 |
| HWID-устройства | 7 | 4 |
| Соединения | 7 | 6 |
| API-токены | 4 | 2 |
| Keygen | 1 | 1 |
| Биллинг инфраструктуры | 12 | 4 |
| Сниппеты | 5 | 1 |
| Настройки панели | 2 | 1 |
| Страницы подписок | 7 | 2 |
| Плагины нод и общие списки | 16 | 5 |
| Интеграции нод | 5 | 2 |
| Метаданные | 4 | 2 |

### Ресурсы

| URI | Описание |
|-----|----------|
| `remnawave://stats` | Текущая статистика панели |
| `remnawave://nodes` | Статус всех нод |
| `remnawave://health` | Состояние здоровья панели |
| `remnawave://users/{id}` | Данные пользователя по числовому id |

### Промпты

| Промпт | Описание |
|--------|----------|
| `create_user_wizard` | Пошаговое создание пользователя |
| `node_diagnostics` | Диагностика ноды |
| `traffic_report` | Отчёт по трафику |
| `user_audit` | Полный аудит пользователя |
| `bulk_user_cleanup` | Поиск и управление просроченными пользователями |

### Примеры запросов

```
«Покажи всех пользователей с истёкшей подпиской»
«Найди пользователя с telegram id 123456 и продли на 30 дней»
«Создай пользователя vasya с лимитом 50 ГБ на месяц»
«Перезапусти ноду amsterdam-01»
«Топ-10 пользователей по трафику на ноде fl1 за неделю»
«Какие ноды сейчас офлайн?»
«Сбрось все соединения пользователя 42»
```

### Структура проекта

```
src/
├── index.ts                       # Точка входа (stdio транспорт)
├── server.ts                      # Настройка McpServer
├── config.ts                      # Конфигурация окружения
├── client/
│   └── index.ts                   # HTTP-клиент Remnawave (маршруты из backend-contract)
├── tools/
│   ├── helpers.ts                 # Хелперы форматирования
│   ├── index.ts                   # Регистрация инструментов
│   ├── users.ts                       # Пользователи (28)
│   ├── nodes.ts                       # Ноды (15)
│   ├── hosts.ts                       # Хосты (11)
│   ├── system.ts                      # Система и авторизация (13)
│   ├── bandwidth.ts                   # Статистика трафика (7)
│   ├── subscriptions.ts               # Подписки и шаблоны (12)
│   ├── inbounds.ts                    # Конфиг-профили и inbounds (9)
│   ├── squads.ts                      # Внутренние группы (squads) (11)
│   ├── external-squads.ts             # Внешние группы (8)
│   ├── hwid.ts                        # HWID-устройства (7)
│   ├── connections.ts                 # Соединения (7)
│   ├── api-tokens.ts                  # API-токены (4)
│   ├── keygen.ts                      # Keygen (1)
│   ├── infra-billing.ts               # Биллинг инфраструктуры (12)
│   ├── snippets.ts                    # Сниппеты (5)
│   ├── settings.ts                    # Настройки панели (2)
│   ├── subscription-page-configs.ts   # Страницы подписок (7)
│   ├── node-plugins.ts                # Плагины нод и общие списки (16)
│   ├── node-integrations.ts           # Интеграции нод (5)
│   ├── metadata.ts                    # Метаданные (4)
├── resources/
│   └── index.ts                   # MCP-ресурсы
└── prompts/
    └── index.ts                   # MCP-промпты
```

### Разработка

```bash
npm run typecheck   # tsc --noEmit
npm run build       # проверка типов + сборка tsup
```

### Лицензия

MIT
