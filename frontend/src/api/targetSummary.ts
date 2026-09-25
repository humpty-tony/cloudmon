// Display-only summary; no invented ARNs, arbitrary parameter values or per-row raw fetches.
export function targetSummary(record: Record<string, unknown>): string {
  const req = record.requestParameters;
  const p = req && typeof req === "object" && !Array.isArray(req) ? req as Record<string, unknown> : {};
  const text = (v: unknown) => typeof v === "string" ? v : "";
  const resources = Array.isArray(record.resources) ? record.resources : [];
  const first = resources[0] && typeof resources[0] === "object" ? resources[0] as Record<string, unknown> : {};
  const instances = p.instancesSet && typeof p.instancesSet === "object" ? p.instancesSet as Record<string, unknown> : {};
  const instance = Array.isArray(instances.items) && instances.items[0] && typeof instances.items[0] === "object" ? instances.items[0] as Record<string, unknown> : {};
  return (text(p.secretId) || (text(p.bucketName) ? text(p.bucketName) + (text(p.key) ? "/" + text(p.key) : "") : "") || text(first.ARN)
    || text(p.roleArn) || text(p.roleName) || text(p.policyArn) || text(p.instanceId) || text(instance.instanceId)
    || text(p.keyId) || text(p.functionName) || text(p.resourceArn) || text(p.tableName)).slice(0, 512);
}
