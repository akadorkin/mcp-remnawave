import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { RemnawaveClient } from '../client/index.js';
import { run } from './helpers.js';

export function registerSystemTools(server: McpServer, client: RemnawaveClient) {
    server.tool('system_stats', 'Panel statistics: users, nodes, traffic, system resources', {}, () => run(() => client.getStats()));
    server.tool('system_bandwidth_stats', 'Bandwidth statistics over standard periods', {}, () => run(() => client.getBandwidthStats()));
    server.tool('system_nodes_metrics', 'Per-node metrics', {}, () => run(() => client.getNodesMetrics()));
    server.tool('system_nodes_statistics', 'Nodes statistics (traffic per node over last days)', {}, () => run(() => client.getNodesStatistics()));
    server.tool('system_stats_recap', 'Recap statistics', {}, () => run(() => client.getStatsRecap()));
    server.tool(
        'system_stats_digest',
        'Digest statistics for a period',
        { start: z.string().describe('ISO 8601'), end: z.string().describe('ISO 8601') },
        ({ start, end }) => run(() => client.getStatsDigest(start, end)),
    );
    server.tool('system_http_stats', 'HTTP request statistics of the panel', {}, () => run(() => client.getHttpStats()));
    server.tool('system_health', 'Panel health check', {}, () => run(() => client.getHealth()));
    server.tool('system_metadata', 'Panel metadata (version, build)', {}, () => run(() => client.getSystemMetadata()));
    server.tool('system_configuration', 'Panel runtime configuration', {}, () => run(() => client.getConfiguration()));
    server.tool('system_generate_x25519', 'Generate an X25519 key pair for VLESS Reality', {}, () => run(() => client.generateX25519()));
    server.tool('auth_status', 'Auth status of the panel', {}, () => run(() => client.getAuthStatus()));
    server.tool(
        'system_srr_matcher',
        'Test subscription response rules (SRR) against the matcher',
        { responseRules: z.record(z.unknown()).describe('Response rules object {version, settings, rules}') },
        (p) => run(() => client.testSrrMatcher(p)),
    );
}
