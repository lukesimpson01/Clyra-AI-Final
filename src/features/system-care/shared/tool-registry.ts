import { z } from "zod";

const empty = z.object({}).strict();
const id = z.string().min(1).max(180);

/**
 * The complete authority offered to the System Care model. There is
 * intentionally no shell, command, script, registry editor, or raw-path tool.
 */
export const systemCareToolSchemas = {
  getDeviceProfile: empty,
  getStorageOverview: empty,
  getHealthMetrics: empty,
  scanCleanup: z.object({ categories: z.array(z.string().max(80)).max(20).optional() }).strict(),
  scanDuplicates: z.object({ locationIds: z.array(id).min(1).max(12), deep: z.boolean().default(false) }).strict(),
  scanLargeFiles: z.object({ locationIds: z.array(id).min(1).max(12), minimumBytes: z.number().int().min(100_000_000) }).strict(),
  listApps: empty,
  getAppDetails: z.object({ applicationId: id }).strict(),
  scanAppLeftovers: z.object({ applicationId: id }).strict(),
  listStartupItems: empty,
  setStartupItemEnabled: z.object({ id, enabled: z.boolean(), approvalId: id }).strict(),
  getProcesses: empty,
  quitApplication: z.object({ applicationId: id, approvalId: id }).strict(),
  checkUpdates: empty,
  prepareUninstall: z.object({ applicationId: id }).strict(),
  uninstallApplication: z.object({ planId: id, approvalId: id }).strict(),
  moveFilesToTrash: z.object({ candidateIds: z.array(id).min(1).max(500), approvalId: id }).strict(),
  runMaintenanceTask: z.object({ taskId: id, approvalId: id }).strict(),
  getSecurityPosture: empty,
  webResearchUnknownItem: z.object({ itemId: id, sanitizedQuery: z.string().min(3).max(240) }).strict(),
} as const;

export type SystemCareToolName = keyof typeof systemCareToolSchemas;

export function parseSystemCareToolCall(name: string, args: unknown) {
  if (!(name in systemCareToolSchemas)) throw new Error(`Unregistered System Care tool: ${name}`);
  return systemCareToolSchemas[name as SystemCareToolName].parse(args);
}
