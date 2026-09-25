import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RemnawaveClient } from './client/index.js';
import { Config } from './config.js';
import { Fleet } from './core/fleet.js';
import { Output } from './core/output.js';
import { Ctx } from './core/plan.js';
import { StateStore } from './core/state.js';
import { registerAllTools } from './tools/index.js';
import { instrument } from './tools/helpers.js';
import { registerAllResources } from './resources/index.js';
import { registerAllPrompts } from './prompts/index.js';

export const VERSION = '3.0.0';

export function createServer(config: Config): McpServer {
    const server = new McpServer(
        { name: 'remnawave-mcp', version: VERSION },
        {
            instructions: [
                'Remnawave panel. Start with fleet_overview / nodes_list / hosts_list (compact rows); names work wherever a node, profile, squad or template is expected.',
                'Before touching a host, run host_usage; before touching an inbound, inbound_trace. config_search finds where an IP/domain/tag/uuid is referenced.',
                'Edits of profiles, templates, pools, many hosts and node bindings are two-step: call without apply to get the diff and planHash, then repeat with apply:true and planHash. Every write is backed up (backups_list, backup_restore) and journaled (journal_list).',
                'Large results are written to a file and the path is returned; REALITY private keys are masked in all output.',
            ].join('\n'),
        },
    );

    const client = new RemnawaveClient(config);
    const out = new Output(config);
    const ctx: Ctx = { client, fleet: new Fleet(client), out, state: new StateStore(config), config };

    instrument(server, out);
    registerAllTools(server, ctx);
    registerAllResources(server, ctx);
    registerAllPrompts(server);

    return server;
}
