export type ToolResponse = {
    content: Array<{ type: 'text'; text: string }>;
    isError?: boolean;
};

export function toolResult(data: unknown): ToolResponse {
    return {
        content: [
            {
                type: 'text' as const,
                text: JSON.stringify(data ?? { success: true }, null, 2),
            },
        ],
    };
}

export function toolError(error: unknown): ToolResponse {
    const message = error instanceof Error ? error.message : String(error);
    return {
        content: [
            {
                type: 'text' as const,
                text: `Error: ${message}`,
            },
        ],
        isError: true,
    };
}

/** Run an API call and wrap the outcome as an MCP tool response. */
export async function run(fn: () => Promise<unknown>): Promise<ToolResponse> {
    try {
        return toolResult(await fn());
    } catch (e) {
        return toolError(e);
    }
}
