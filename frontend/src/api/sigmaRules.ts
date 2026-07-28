// Sigma rule library: a curated set of CloudTrail example rules (offline, bundled)
// plus the user's own saved rules in localStorage. The Sigma view's "Rules" menu
// loads these into the editor.

export interface SigmaRuleEntry {
  name: string;
  yaml: string;
}

export const BUNDLED_RULES: SigmaRuleEntry[] = [
  {
    name: "Root account activity",
    yaml: `title: AWS Root Account Activity
logsource:
  product: aws
  service: cloudtrail
detection:
  selection:
    userIdentity.type: Root
  condition: selection
level: high`,
  },
  {
    name: "Console login without MFA",
    yaml: `title: Console Login Without MFA
logsource:
  product: aws
  service: cloudtrail
detection:
  selection:
    eventName: ConsoleLogin
    additionalEventData.MFAUsed: 'No'
  condition: selection
level: high`,
  },
  {
    name: "GetSecretValue (non-service)",
    yaml: `title: SecretsManager GetSecretValue by a non-service principal
logsource:
  product: aws
  service: cloudtrail
detection:
  selection:
    eventSource: secretsmanager.amazonaws.com
    eventName: GetSecretValue
  filter_service:
    userIdentity.invokedBy|endswith: .amazonaws.com
  condition: selection and not filter_service
level: medium`,
  },
  {
    name: "CloudTrail logging disabled",
    yaml: `title: CloudTrail Logging Tampered
logsource:
  product: aws
  service: cloudtrail
detection:
  selection:
    eventSource: cloudtrail.amazonaws.com
    eventName:
      - StopLogging
      - DeleteTrail
      - UpdateTrail
      - PutEventSelectors
  condition: selection
level: high`,
  },
  {
    name: "AssumeRole from external account (fieldref)",
    yaml: `title: AssumeRole From an External Account
logsource:
  product: aws
  service: cloudtrail
detection:
  selection:
    eventName: AssumeRole
  filter_internal:
    userIdentity.accountId|fieldref: recipientAccountId
  condition: selection and not filter_internal
level: medium`,
  },
  {
    name: "Console login outside corp ranges (cidr)",
    yaml: `title: Console Login From Outside Corporate Ranges
logsource:
  product: aws
  service: cloudtrail
detection:
  selection:
    eventName: ConsoleLogin
  filter_corp:
    sourceIPAddress|cidr:
      - 10.0.0.0/8
      - 172.16.0.0/12
      - 192.168.0.0/16
  condition: selection and not filter_corp
level: medium`,
  },
];

const KEY = "cloudmon.sigmaRules";

export function loadUserRules(): SigmaRuleEntry[] {
  try {
    const v = localStorage.getItem(KEY);
    const parsed = v ? JSON.parse(v) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(rules: SigmaRuleEntry[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(rules));
  } catch {
    /* quota / private mode - ignore */
  }
}

/** Save (or overwrite by name) a user rule; returns the new list. */
export function saveUserRule(name: string, yaml: string): SigmaRuleEntry[] {
  const rules = loadUserRules().filter((r) => r.name !== name);
  rules.push({ name, yaml });
  persist(rules);
  return rules;
}

export function deleteUserRule(name: string): SigmaRuleEntry[] {
  const rules = loadUserRules().filter((r) => r.name !== name);
  persist(rules);
  return rules;
}
