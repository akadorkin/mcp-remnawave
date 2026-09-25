import {
    CreateHostCommand,
    UpdateHostCommand,
    UpdateNodeCommand,
    CreateNodeCommand,
    UpdateConfigProfileCommand,
    UpdateSubscriptionTemplateCommand,
} from '@remnawave/backend-contract';

type Schema = { safeParse: (v: unknown) => { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } } };

const SCHEMAS: Record<string, Schema> = {
    createHost: CreateHostCommand.RequestBodySchema as unknown as Schema,
    updateHost: UpdateHostCommand.RequestBodySchema as unknown as Schema,
    createNode: CreateNodeCommand.RequestBodySchema as unknown as Schema,
    updateNode: UpdateNodeCommand.RequestBodySchema as unknown as Schema,
    updateConfigProfile: UpdateConfigProfileCommand.RequestBodySchema as unknown as Schema,
    updateSubscriptionTemplate: UpdateSubscriptionTemplateCommand.RequestBodySchema as unknown as Schema,
};

/**
 * Validate a request body against the contract's own zod schema before sending it,
 * so a bad field is reported by name ("serverDescription: max 30") at plan time.
 */
export function contractIssues(kind: keyof typeof SCHEMAS, body: unknown): string[] {
    const r = SCHEMAS[kind].safeParse(body);
    if (r.success) return [];
    return (r.error?.issues ?? []).slice(0, 15).map((i) => `${i.path.length ? i.path.join('.') : '(body)'}: ${i.message}`);
}
