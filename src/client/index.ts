import { REST_API } from '@remnawave/backend-contract';
import { Config } from '../config.js';

type Params = Record<string, unknown>;
type Query = Record<string, unknown> | undefined;

/**
 * Thin HTTP client over the Remnawave REST API (panel 3.4+).
 * All paths come from @remnawave/backend-contract so a contract bump
 * surfaces removed or renamed routes as type errors at build time.
 */
export class RemnawaveClient {
    private baseUrl: string;
    private headers: Record<string, string>;

    constructor(config: Config) {
        this.baseUrl = config.baseUrl;
        this.headers = {
            Authorization: `Bearer ${config.apiToken}`,
            'Content-Type': 'application/json',
        };
        if (config.apiKey) {
            this.headers['X-Api-Key'] = config.apiKey;
        }
        if (config.cfAccessClientId) {
            this.headers['CF-Access-Client-Id'] = config.cfAccessClientId;
        }
        if (config.cfAccessClientSecret) {
            this.headers['CF-Access-Client-Secret'] = config.cfAccessClientSecret;
        }
    }

    /** Serialise a query object; arrays/objects are JSON-encoded (panel expects `filters=[...]`). */
    private qs(query: Query): string {
        if (!query) return '';
        const p = new URLSearchParams();
        for (const [k, v] of Object.entries(query)) {
            if (v === undefined || v === null) continue;
            p.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
        }
        const s = p.toString();
        return s ? `?${s}` : '';
    }

    private async request<T = unknown>(
        method: string,
        path: string,
        body?: unknown,
        query?: Query,
    ): Promise<T> {
        const url = `${this.baseUrl}${path}${this.qs(query)}`;
        const options: RequestInit = { method, headers: this.headers };
        if (body !== undefined) {
            options.body = JSON.stringify(body);
        }
        const res = await fetch(url, options);
        const text = await res.text();
        let parsed: unknown = undefined;
        if (text) {
            try {
                parsed = JSON.parse(text);
            } catch {
                parsed = text;
            }
        }
        if (!res.ok) {
            const msg =
                parsed && typeof parsed === 'object' && 'message' in parsed
                    ? String((parsed as { message: unknown }).message)
                    : text || `HTTP ${res.status} ${res.statusText}`;
            throw new Error(`Remnawave API error (${res.status} ${method} ${path}): ${msg}`);
        }
        return parsed as T;
    }

    private get<T = unknown>(path: string, query?: Query) {
        return this.request<T>('GET', path, undefined, query);
    }
    private post<T = unknown>(path: string, body?: unknown, query?: Query) {
        return this.request<T>('POST', path, body, query);
    }
    private patch<T = unknown>(path: string, body?: unknown) {
        return this.request<T>('PATCH', path, body);
    }
    private put<T = unknown>(path: string, body?: unknown) {
        return this.request<T>('PUT', path, body);
    }
    private delete<T = unknown>(path: string, body?: unknown) {
        return this.request<T>('DELETE', path, body);
    }

    // ---------------------------------------------------------------- Users

    getUsers(query: Params = {}) {
        return this.get(REST_API.USERS.GET, query);
    }
    streamUsers(query: Params = {}) {
        return this.get(REST_API.USERS.STREAM, query);
    }
    getUserById(id: number) {
        return this.get(REST_API.USERS.GET_BY_ID(String(id)));
    }
    getUserByUsername(username: string) {
        return this.get(REST_API.USERS.GET_BY.USERNAME(username));
    }
    getUserByShortUuid(shortUuid: string) {
        return this.get(REST_API.USERS.GET_BY.SHORT_UUID(shortUuid));
    }
    getUserTags() {
        return this.get(REST_API.USERS.TAGS.GET);
    }
    resolveUsers(params: Params) {
        return this.post(REST_API.USERS.RESOLVE, params);
    }
    getUserAccessibleNodes(id: number) {
        return this.get(REST_API.USERS.ACCESSIBLE_NODES(String(id)));
    }
    getUserSubscriptionRequestHistory(id: number) {
        return this.get(REST_API.USERS.SUBSCRIPTION_REQUEST_HISTORY(String(id)));
    }
    createUser(params: Params) {
        return this.post(REST_API.USERS.CREATE, params);
    }
    updateUser(params: Params) {
        return this.patch(REST_API.USERS.UPDATE, params);
    }
    deleteUser(id: number) {
        return this.delete(REST_API.USERS.DELETE(String(id)));
    }
    enableUser(id: number) {
        return this.post(REST_API.USERS.ACTIONS.ENABLE(String(id)));
    }
    disableUser(id: number) {
        return this.post(REST_API.USERS.ACTIONS.DISABLE(String(id)));
    }
    revokeUserSubscription(id: number, params: Params = {}) {
        return this.post(REST_API.USERS.ACTIONS.REVOKE_SUBSCRIPTION(String(id)), params);
    }
    resetUserTraffic(id: number) {
        return this.post(REST_API.USERS.ACTIONS.RESET_TRAFFIC(String(id)));
    }
    extendUser(id: number, days: number) {
        return this.post(REST_API.USERS.ACTIONS.EXTEND_EXPIRATION_DATE(String(id)), { days });
    }
    bulkDeleteUsersByStatus(params: Params) {
        return this.post(REST_API.USERS.BULK.DELETE_BY_STATUS, params);
    }
    bulkUpdateUsers(params: Params) {
        return this.post(REST_API.USERS.BULK.UPDATE, params);
    }
    bulkResetUsersTraffic(params: Params) {
        return this.post(REST_API.USERS.BULK.RESET_TRAFFIC, params);
    }
    bulkRevokeUsersSubscription(params: Params) {
        return this.post(REST_API.USERS.BULK.REVOKE_SUBSCRIPTION, params);
    }
    bulkDeleteUsers(params: Params) {
        return this.post(REST_API.USERS.BULK.DELETE, params);
    }
    bulkUpdateUserSquads(params: Params) {
        return this.post(REST_API.USERS.BULK.UPDATE_SQUADS, params);
    }
    bulkExtendUsersExpiration(params: Params) {
        return this.post(REST_API.USERS.BULK.EXTEND_EXPIRATION_DATE, params);
    }
    bulkAllUpdateUsers(params: Params) {
        return this.post(REST_API.USERS.BULK.ALL.UPDATE, params);
    }
    bulkAllResetUsersTraffic() {
        return this.post(REST_API.USERS.BULK.ALL.RESET_TRAFFIC);
    }
    bulkAllExtendUsersExpiration(params: Params) {
        return this.post(REST_API.USERS.BULK.ALL.EXTEND_EXPIRATION_DATE, params);
    }

    // ---------------------------------------------------------------- Nodes

    getNodes() {
        return this.get(REST_API.NODES.GET);
    }
    getNodeByUuid(uuid: string) {
        return this.get(REST_API.NODES.GET_BY_UUID(uuid));
    }
    getNodeTags() {
        return this.get(REST_API.NODES.TAGS.GET);
    }
    createNode(params: Params) {
        return this.post(REST_API.NODES.CREATE, params);
    }
    updateNode(params: Params) {
        return this.patch(REST_API.NODES.UPDATE, params);
    }
    deleteNode(uuid: string) {
        return this.delete(REST_API.NODES.DELETE(uuid));
    }
    enableNode(uuid: string) {
        return this.post(REST_API.NODES.ACTIONS.ENABLE(uuid));
    }
    disableNode(uuid: string) {
        return this.post(REST_API.NODES.ACTIONS.DISABLE(uuid));
    }
    restartNode(uuid: string, forceRestart = false) {
        return this.post(REST_API.NODES.ACTIONS.RESTART(uuid), { forceRestart });
    }
    restartAllNodes(forceRestart = false) {
        return this.post(REST_API.NODES.ACTIONS.RESTART_ALL, { forceRestart });
    }
    resetNodeTraffic(uuid: string) {
        return this.post(REST_API.NODES.ACTIONS.RESET_TRAFFIC(uuid));
    }
    reorderNodes(nodes: Array<{ viewPosition: number; uuid: string }>) {
        return this.post(REST_API.NODES.ACTIONS.REORDER, { nodes });
    }
    bulkNodeProfileModification(params: Params) {
        return this.post(REST_API.NODES.BULK_ACTIONS.PROFILE_MODIFICATION, params);
    }
    bulkNodeActions(params: Params) {
        return this.post(REST_API.NODES.BULK_ACTIONS.ACTIONS, params);
    }
    bulkUpdateNodes(params: Params) {
        return this.post(REST_API.NODES.BULK_ACTIONS.UPDATE, params);
    }

    // ---------------------------------------------------------------- Hosts

    getHosts() {
        return this.get(REST_API.HOSTS.GET);
    }
    getHostByUuid(uuid: string) {
        return this.get(REST_API.HOSTS.GET_BY_UUID(uuid));
    }
    getHostTags() {
        return this.get(REST_API.HOSTS.TAGS.GET);
    }
    createHost(params: Params) {
        return this.post(REST_API.HOSTS.CREATE, params);
    }
    updateHost(params: Params) {
        return this.patch(REST_API.HOSTS.UPDATE, params);
    }
    deleteHost(uuid: string) {
        return this.delete(REST_API.HOSTS.DELETE(uuid));
    }
    reorderHosts(hosts: Array<{ viewPosition: number; uuid: string }>) {
        return this.post(REST_API.HOSTS.ACTIONS.REORDER, { hosts });
    }
    bulkEnableHosts(params: Params) {
        return this.post(REST_API.HOSTS.BULK.ENABLE_HOSTS, params);
    }
    bulkDisableHosts(params: Params) {
        return this.post(REST_API.HOSTS.BULK.DISABLE_HOSTS, params);
    }
    bulkDeleteHosts(params: Params) {
        return this.post(REST_API.HOSTS.BULK.DELETE_HOSTS, params);
    }
    bulkUpdateHosts(params: Params) {
        return this.patch(REST_API.HOSTS.BULK.UPDATE, params);
    }

    // ---------------------------------------------------------------- System

    getStats() {
        return this.get(REST_API.SYSTEM.STATS.SYSTEM_STATS);
    }
    getBandwidthStats() {
        return this.get(REST_API.SYSTEM.STATS.BANDWIDTH_STATS);
    }
    getNodesMetrics() {
        return this.get(REST_API.SYSTEM.STATS.NODES_METRICS);
    }
    getNodesStatistics() {
        return this.get(REST_API.SYSTEM.STATS.NODES_STATS);
    }
    getStatsRecap() {
        return this.get(REST_API.SYSTEM.STATS.RECAP);
    }
    getStatsDigest(start: string, end: string) {
        return this.get(REST_API.SYSTEM.STATS.DIGEST, { start, end });
    }
    getHttpStats() {
        return this.get(REST_API.SYSTEM.STATS.HTTP);
    }
    getHealth() {
        return this.get(REST_API.SYSTEM.HEALTH);
    }
    getSystemMetadata() {
        return this.get(REST_API.SYSTEM.METADATA);
    }
    getConfiguration() {
        return this.get(REST_API.SYSTEM.CONFIGURATION);
    }
    generateX25519() {
        return this.get(REST_API.SYSTEM.TOOLS.GENERATE_X25519);
    }
    testSrrMatcher(params: Params) {
        return this.post(REST_API.SYSTEM.TESTERS.SRR_MATCHER, params);
    }

    // ---------------------------------------------------------------- Subscriptions

    getSubscriptions(start = 0, size = 25) {
        return this.get(REST_API.SUBSCRIPTIONS.GET, { start, size });
    }
    getSubscriptionById(userId: number) {
        return this.get(REST_API.SUBSCRIPTIONS.GET_BY.ID(String(userId)));
    }
    getSubscriptionByUsername(username: string) {
        return this.get(REST_API.SUBSCRIPTIONS.GET_BY.USERNAME(username));
    }
    getSubscriptionByShortUuid(shortUuid: string) {
        return this.get(REST_API.SUBSCRIPTIONS.GET_BY.SHORT_UUID(shortUuid));
    }
    getSubscriptionByShortUuidRaw(shortUuid: string, withDisabledHosts?: boolean) {
        return this.get(REST_API.SUBSCRIPTIONS.GET_BY.SHORT_UUID_RAW(shortUuid), {
            withDisabledHosts: withDisabledHosts === undefined ? undefined : String(withDisabledHosts),
        });
    }
    getConnectionKeysByUserId(userId: number) {
        return this.get(REST_API.SUBSCRIPTIONS.GET_CONNECTION_KEYS_BY_USER_ID(String(userId)));
    }
    getSubscriptionInfo(shortUuid: string) {
        return this.get(REST_API.SUBSCRIPTION.GET_INFO(shortUuid));
    }
    getSubscriptionRequestHistory(query: Params = {}) {
        return this.get(REST_API.SUBSCRIPTION_REQUEST_HISTORY.GET, query);
    }
    getSubscriptionRequestHistoryStats() {
        return this.get(REST_API.SUBSCRIPTION_REQUEST_HISTORY.STATS);
    }

    // ---------------------------------------------------------------- Subscription templates / settings

    getSubscriptionTemplates() {
        return this.get(REST_API.SUBSCRIPTION_TEMPLATE.GET_ALL);
    }
    getSubscriptionTemplate(uuid: string) {
        return this.get(REST_API.SUBSCRIPTION_TEMPLATE.GET(uuid));
    }
    updateSubscriptionTemplate(params: Params) {
        return this.patch(REST_API.SUBSCRIPTION_TEMPLATE.UPDATE, params);
    }
    getSubscriptionSettings() {
        return this.get(REST_API.SUBSCRIPTION_SETTINGS.GET);
    }
    updateSubscriptionSettings(params: Params) {
        return this.patch(REST_API.SUBSCRIPTION_SETTINGS.UPDATE, params);
    }

    // ---------------------------------------------------------------- Config profiles / inbounds

    getConfigProfiles() {
        return this.get(REST_API.CONFIG_PROFILES.GET);
    }
    getConfigProfileByUuid(uuid: string) {
        return this.get(REST_API.CONFIG_PROFILES.GET_BY_UUID(uuid));
    }
    getAllInbounds() {
        return this.get(REST_API.CONFIG_PROFILES.GET_ALL_INBOUNDS);
    }
    getInboundsByProfileUuid(uuid: string) {
        return this.get(REST_API.CONFIG_PROFILES.GET_INBOUNDS_BY_PROFILE_UUID(uuid));
    }
    getComputedConfigByProfileUuid(uuid: string) {
        return this.get(REST_API.CONFIG_PROFILES.GET_COMPUTED_CONFIG_BY_PROFILE_UUID(uuid));
    }
    createConfigProfile(params: Params) {
        return this.post(REST_API.CONFIG_PROFILES.CREATE, params);
    }
    updateConfigProfile(params: Params) {
        return this.patch(REST_API.CONFIG_PROFILES.UPDATE, params);
    }
    deleteConfigProfile(uuid: string) {
        return this.delete(REST_API.CONFIG_PROFILES.DELETE(uuid));
    }
    reorderConfigProfiles(params: Params) {
        return this.post(REST_API.CONFIG_PROFILES.ACTIONS.REORDER, params);
    }

    // ---------------------------------------------------------------- Internal squads

    getInternalSquads() {
        return this.get(REST_API.INTERNAL_SQUADS.GET);
    }
    getInternalSquadByUuid(uuid: string) {
        return this.get(REST_API.INTERNAL_SQUADS.GET_BY_UUID(uuid));
    }
    getSquadAccessibleNodes(uuid: string) {
        return this.get(REST_API.INTERNAL_SQUADS.ACCESSIBLE_NODES(uuid));
    }
    createInternalSquad(params: Params) {
        return this.post(REST_API.INTERNAL_SQUADS.CREATE, params);
    }
    updateInternalSquad(params: Params) {
        return this.patch(REST_API.INTERNAL_SQUADS.UPDATE, params);
    }
    deleteInternalSquad(uuid: string) {
        return this.delete(REST_API.INTERNAL_SQUADS.DELETE(uuid));
    }
    reorderInternalSquads(params: Params) {
        return this.post(REST_API.INTERNAL_SQUADS.ACTIONS.REORDER, params);
    }
    /** Adds EVERY user of the panel to the squad (panel semantics of `add-users`). */
    addAllUsersToSquad(squadUuid: string) {
        return this.post(REST_API.INTERNAL_SQUADS.BULK_ACTIONS.ADD_USERS(squadUuid));
    }
    /** Removes EVERY user from the squad. */
    removeAllUsersFromSquad(squadUuid: string) {
        return this.delete(REST_API.INTERNAL_SQUADS.BULK_ACTIONS.REMOVE_USERS(squadUuid));
    }
    addUsersToSquad(squadUuid: string, userIds: number[]) {
        return this.post(REST_API.INTERNAL_SQUADS.BULK_ACTIONS.ADD_MANY_USERS(squadUuid), { userIds });
    }
    removeUsersFromSquad(squadUuid: string, userIds: number[]) {
        return this.delete(REST_API.INTERNAL_SQUADS.BULK_ACTIONS.REMOVE_MANY_USERS(squadUuid), { userIds });
    }

    // ---------------------------------------------------------------- External squads

    getExternalSquads() {
        return this.get(REST_API.EXTERNAL_SQUADS.GET);
    }
    getExternalSquadByUuid(uuid: string) {
        return this.get(REST_API.EXTERNAL_SQUADS.GET_BY_UUID(uuid));
    }
    createExternalSquad(params: Params) {
        return this.post(REST_API.EXTERNAL_SQUADS.CREATE, params);
    }
    updateExternalSquad(params: Params) {
        return this.patch(REST_API.EXTERNAL_SQUADS.UPDATE, params);
    }
    deleteExternalSquad(uuid: string) {
        return this.delete(REST_API.EXTERNAL_SQUADS.DELETE(uuid));
    }
    /** Assigns EVERY user of the panel to the external squad. */
    addAllUsersToExternalSquad(squadUuid: string) {
        return this.post(REST_API.EXTERNAL_SQUADS.BULK_ACTIONS.ADD_USERS(squadUuid));
    }
    /** Detaches EVERY user from the external squad. */
    removeAllUsersFromExternalSquad(squadUuid: string) {
        return this.delete(REST_API.EXTERNAL_SQUADS.BULK_ACTIONS.REMOVE_USERS(squadUuid));
    }
    reorderExternalSquads(params: Params) {
        return this.post(REST_API.EXTERNAL_SQUADS.ACTIONS.REORDER, params);
    }

    // ---------------------------------------------------------------- HWID

    getUserHwidDevices(userId: number) {
        return this.get(REST_API.HWID.GET_USER_HWID_DEVICES(String(userId)));
    }
    getAllHwidDevices(query: Params = {}) {
        return this.get(REST_API.HWID.GET_ALL_HWID_DEVICES, query);
    }
    getHwidStats() {
        return this.get(REST_API.HWID.STATS);
    }
    getHwidTopUsers(query: Params = {}) {
        return this.get(REST_API.HWID.TOP_USERS_BY_DEVICES, query);
    }
    createUserHwidDevice(params: Params) {
        return this.post(REST_API.HWID.CREATE_USER_HWID_DEVICE, params);
    }
    deleteHwidDevice(userId: number, hwid: string) {
        return this.post(REST_API.HWID.DELETE_USER_HWID_DEVICE, { userId, hwid });
    }
    deleteAllUserHwidDevices(userId: number) {
        return this.post(REST_API.HWID.DELETE_ALL_USER_HWID_DEVICES, { userId });
    }

    // ---------------------------------------------------------------- Bandwidth stats

    getNodesUsage(query: Params) {
        return this.get(REST_API.BANDWIDTH_STATS.NODES.GET, query);
    }
    getNodeUsersUsage(uuid: string, query: Params) {
        return this.get(REST_API.BANDWIDTH_STATS.NODES.GET_USERS(uuid), query);
    }
    getNodesUsersUsage(nodesUuids: string[], query: Params) {
        return this.post(REST_API.BANDWIDTH_STATS.NODES.GET_USERS_BY_NODES, { nodesUuids }, query);
    }
    getNodesUsageByUuids(nodesUuids: string[], query: Params) {
        return this.post(REST_API.BANDWIDTH_STATS.NODES.GET_USAGE, { nodesUuids }, query);
    }
    getUserUsage(userId: number, query: Params) {
        return this.get(REST_API.BANDWIDTH_STATS.USERS.GET_BY_ID(String(userId)), query);
    }
    getInternalSquadUsage(uuid: string, query: Params) {
        return this.get(REST_API.BANDWIDTH_STATS.INTERNAL_SQUADS.GET_USAGE(uuid), query);
    }
    getInternalSquadUserUsage(squadUuid: string, userId: number, query: Params) {
        return this.get(REST_API.BANDWIDTH_STATS.INTERNAL_SQUADS.USER_USAGE(squadUuid, String(userId)), query);
    }

    // ---------------------------------------------------------------- Auth / API tokens / keygen

    getAuthStatus() {
        return this.get(REST_API.AUTH.GET_STATUS);
    }
    getApiTokens() {
        return this.get(REST_API.API_TOKENS.GET);
    }
    getApiTokenScopes() {
        return this.get(REST_API.API_TOKENS.GET_SCOPES);
    }
    createApiToken(params: Params) {
        return this.post(REST_API.API_TOKENS.CREATE, params);
    }
    deleteApiToken(uuid: string) {
        return this.delete(REST_API.API_TOKENS.DELETE(uuid));
    }
    getKeygen() {
        return this.get(REST_API.KEYGEN.GET);
    }

    // ---------------------------------------------------------------- Infra billing

    getBillingProviders() {
        return this.get(REST_API.INFRA_BILLING.GET_PROVIDERS);
    }
    getBillingProviderByUuid(uuid: string) {
        return this.get(REST_API.INFRA_BILLING.GET_PROVIDER_BY_UUID(uuid));
    }
    createBillingProvider(params: Params) {
        return this.post(REST_API.INFRA_BILLING.CREATE_PROVIDER, params);
    }
    updateBillingProvider(params: Params) {
        return this.patch(REST_API.INFRA_BILLING.UPDATE_PROVIDER, params);
    }
    deleteBillingProvider(uuid: string) {
        return this.delete(REST_API.INFRA_BILLING.DELETE_PROVIDER(uuid));
    }
    getBillingNodes() {
        return this.get(REST_API.INFRA_BILLING.GET_BILLING_NODES);
    }
    createBillingNode(params: Params) {
        return this.post(REST_API.INFRA_BILLING.CREATE_BILLING_NODE, params);
    }
    updateBillingNode(params: Params) {
        return this.patch(REST_API.INFRA_BILLING.UPDATE_BILLING_NODE, params);
    }
    deleteBillingNode(uuid: string) {
        return this.delete(REST_API.INFRA_BILLING.DELETE_BILLING_NODE(uuid));
    }
    getBillingHistory(query: Params = {}) {
        return this.get(REST_API.INFRA_BILLING.GET_BILLING_HISTORY, query);
    }
    createBillingHistory(params: Params) {
        return this.post(REST_API.INFRA_BILLING.CREATE_BILLING_HISTORY, params);
    }
    deleteBillingHistory(uuid: string) {
        return this.delete(REST_API.INFRA_BILLING.DELETE_BILLING_HISTORY(uuid));
    }

    // ---------------------------------------------------------------- Snippets

    getSnippets() {
        return this.get(REST_API.SNIPPETS.GET);
    }
    createSnippet(params: Params) {
        return this.post(REST_API.SNIPPETS.CREATE, params);
    }
    updateSnippet(params: Params) {
        return this.patch(REST_API.SNIPPETS.UPDATE, params);
    }
    deleteSnippet(params: Params) {
        return this.delete(REST_API.SNIPPETS.DELETE, params);
    }
    syncSnippet(name: string) {
        return this.post(REST_API.SNIPPETS.ACTIONS.SYNC, { name });
    }

    // ---------------------------------------------------------------- Panel settings

    getSettings() {
        return this.get(REST_API.REMNAAWAVE_SETTINGS.GET);
    }
    updateSettings(params: Params) {
        return this.patch(REST_API.REMNAAWAVE_SETTINGS.UPDATE, params);
    }

    // ---------------------------------------------------------------- Subscription page configs

    getSubscriptionPageConfigs() {
        return this.get(REST_API.SUBSCRIPTION_PAGE_CONFIGS.GET_ALL);
    }
    getSubscriptionPageConfig(uuid: string) {
        return this.get(REST_API.SUBSCRIPTION_PAGE_CONFIGS.GET(uuid));
    }
    createSubscriptionPageConfig(params: Params) {
        return this.post(REST_API.SUBSCRIPTION_PAGE_CONFIGS.CREATE, params);
    }
    updateSubscriptionPageConfig(params: Params) {
        return this.patch(REST_API.SUBSCRIPTION_PAGE_CONFIGS.UPDATE, params);
    }
    deleteSubscriptionPageConfig(uuid: string) {
        return this.delete(REST_API.SUBSCRIPTION_PAGE_CONFIGS.DELETE(uuid));
    }
    reorderSubscriptionPageConfigs(params: Params) {
        return this.post(REST_API.SUBSCRIPTION_PAGE_CONFIGS.ACTIONS.REORDER, params);
    }
    cloneSubscriptionPageConfig(params: Params) {
        return this.post(REST_API.SUBSCRIPTION_PAGE_CONFIGS.ACTIONS.CLONE, params);
    }

    // ---------------------------------------------------------------- Node plugins / shared lists

    getNodePlugins() {
        return this.get(REST_API.NODE_PLUGINS.GET_ALL);
    }
    getNodePlugin(uuid: string) {
        return this.get(REST_API.NODE_PLUGINS.GET(uuid));
    }
    createNodePlugin(params: Params) {
        return this.post(REST_API.NODE_PLUGINS.CREATE, params);
    }
    updateNodePlugin(params: Params) {
        return this.patch(REST_API.NODE_PLUGINS.UPDATE, params);
    }
    deleteNodePlugin(uuid: string) {
        return this.delete(REST_API.NODE_PLUGINS.DELETE(uuid));
    }
    reorderNodePlugins(params: Params) {
        return this.post(REST_API.NODE_PLUGINS.ACTIONS.REORDER, params);
    }
    cloneNodePlugin(params: Params) {
        return this.post(REST_API.NODE_PLUGINS.ACTIONS.CLONE, params);
    }
    syncNodePlugin(uuid: string) {
        return this.post(REST_API.NODE_PLUGINS.ACTIONS.SYNC, { uuid });
    }
    executeNodePlugin(params: Params) {
        return this.post(REST_API.NODE_PLUGINS.EXECUTOR, params);
    }
    getSharedLists() {
        return this.get(REST_API.NODE_PLUGINS.SHARED_LISTS.GET_ALL);
    }
    createSharedList(params: Params) {
        return this.post(REST_API.NODE_PLUGINS.SHARED_LISTS.CREATE, params);
    }
    updateSharedList(params: Params) {
        return this.patch(REST_API.NODE_PLUGINS.SHARED_LISTS.UPDATE, params);
    }
    syncSharedList(name: string) {
        return this.post(REST_API.NODE_PLUGINS.SHARED_LISTS.ACTIONS.SYNC, { name });
    }
    getTorrentBlockerReports(query: Params = {}) {
        return this.get(REST_API.NODE_PLUGINS.TORRENT_BLOCKER.GET_REPORTS, query);
    }
    getTorrentBlockerStats() {
        return this.get(REST_API.NODE_PLUGINS.TORRENT_BLOCKER.GET_REPORTS_STATS);
    }
    truncateTorrentBlockerReports() {
        return this.post(REST_API.NODE_PLUGINS.TORRENT_BLOCKER.TRUNCATE_REPORTS);
    }

    // ---------------------------------------------------------------- Node integrations

    getNodeIntegrations() {
        return this.get(REST_API.NODE_INTEGRATIONS.GET_ALL);
    }
    getNodeIntegration(uuid: string) {
        return this.get(REST_API.NODE_INTEGRATIONS.GET(uuid));
    }
    createNodeIntegration(params: Params) {
        return this.post(REST_API.NODE_INTEGRATIONS.CREATE, params);
    }
    updateNodeIntegration(params: Params) {
        return this.patch(REST_API.NODE_INTEGRATIONS.UPDATE, params);
    }
    deleteNodeIntegration(uuid: string) {
        return this.delete(REST_API.NODE_INTEGRATIONS.DELETE(uuid));
    }

    // ---------------------------------------------------------------- Connections (replaces ip-control)

    startConnectionsByUser(userId: number) {
        return this.post(REST_API.CONNECTIONS.CONNECTIONS_BY_USER(String(userId)));
    }
    getConnectionsByUserResult(jobId: string) {
        return this.get(REST_API.CONNECTIONS.CONNECTIONS_BY_USER_RESULT(jobId));
    }
    startConnectionsByNode(nodeUuid: string) {
        return this.post(REST_API.CONNECTIONS.CONNECTIONS_BY_NODE(nodeUuid));
    }
    getConnectionsByNodeResult(jobId: string) {
        return this.get(REST_API.CONNECTIONS.CONNECTIONS_BY_NODE_RESULT(jobId));
    }
    startGeocheckByNode(nodeUuid: string, params: Params = {}) {
        return this.post(REST_API.CONNECTIONS.GEOCHECK_BY_NODE(nodeUuid), params);
    }
    getGeocheckByNodeResult(jobId: string) {
        return this.get(REST_API.CONNECTIONS.GEOCHECK_BY_NODE_RESULT(jobId));
    }
    dropConnections(params: Params) {
        return this.post(REST_API.CONNECTIONS.DROP_CONNECTIONS, params);
    }

    // ---------------------------------------------------------------- Metadata

    getNodeMetadata(uuid: string) {
        return this.get(REST_API.METADATA.NODE.GET(uuid));
    }
    upsertNodeMetadata(uuid: string, params: Params) {
        return this.put(REST_API.METADATA.NODE.UPSERT(uuid), params);
    }
    getUserMetadata(userId: number) {
        return this.get(REST_API.METADATA.USER.GET(String(userId)));
    }
    upsertUserMetadata(userId: number, params: Params) {
        return this.put(REST_API.METADATA.USER.UPSERT(String(userId)), params);
    }
}
