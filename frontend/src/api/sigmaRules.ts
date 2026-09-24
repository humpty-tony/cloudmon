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
    name: "Successful direct console login without MFA",
    yaml: `title: Successful Direct Console Login Without Recorded MFA
description: Successful IAMUser or Root sign-in with MFAUsed No; does not assess MFA at a federated identity provider.
logsource:
  product: aws
  service: cloudtrail
detection:
  selection:
    eventSource: signin.amazonaws.com
    eventName: ConsoleLogin
    userIdentity.type: [IAMUser, Root]
    responseElements.ConsoleLogin: Success
    additionalEventData.MFAUsed: 'No'
  condition: selection
level: high`,
  },
  {
    name: "GetSecretValue without a service marker",
    yaml: `title: GetSecretValue Without Recorded Service Identity Or Invoker
description: A triage lead; absent service markers do not prove a human operator or successful secret access.
logsource:
  product: aws
  service: cloudtrail
detection:
  selection:
    eventSource: secretsmanager.amazonaws.com
    eventName: GetSecretValue
  filter_service:
    - userIdentity.type: AWSService
    - userIdentity.invokedBy|re: '\\S'
  condition: selection and not filter_service
level: medium`,
  },
  {
    name: "CloudTrail configuration change attempts",
    yaml: `title: CloudTrail Configuration Change Attempts
description: Includes failed and legitimate changes; inspect request parameters, responses and errors before judging impact.
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
    name: "AssumeRole with differing recorded accounts",
    yaml: `title: AssumeRole With Differing Caller And Recipient Accounts
description: Only records where both account IDs are recorded and differ; caller-side records alone can miss cross-account activity.
logsource:
  product: aws
  service: cloudtrail
detection:
  selection:
    eventSource: sts.amazonaws.com
    eventName: AssumeRole
    userIdentity.accountId|re: '^[0-9]{12}$'
    recipientAccountId|re: '^[0-9]{12}$'
  filter_internal:
    userIdentity.accountId|fieldref: recipientAccountId
  condition: selection and not filter_internal
level: medium`,
  },
  {
    name: "Example console-login network filter",
    yaml: `title: Example Console Login Network Filter
description: Replace the example documentation networks with your own trusted egress ranges before using. Literal IP sources only.
logsource:
  product: aws
  service: cloudtrail
detection:
  selection:
    eventSource: signin.amazonaws.com
    eventName: ConsoleLogin
    sourceIPAddress|cidr: [0.0.0.0/0, '::/0']
  filter_example:
    sourceIPAddress|cidr:
      - 192.0.2.0/24
      - 2001:db8::/32
  condition: selection and not filter_example
level: medium`,
  },
];

const KEY = "cloudmon.sigmaRules";

export function loadUserRules(): SigmaRuleEntry[] {
  try {
    const v = localStorage.getItem(KEY);
    const parsed = v ? JSON.parse(v) : [];
    return Array.isArray(parsed) ? parsed.filter((r):r is SigmaRuleEntry=>r&&typeof r.name==="string"&&r.name.length>0&&r.name.length<=120&&typeof r.yaml==="string"&&r.yaml.length<=128*1024).filter((r,i,all)=>all.findIndex(x=>x.name===r.name)===i).slice(0,100) : [];
  } catch {
    return [];
  }
}

function persist(rules: SigmaRuleEntry[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(rules));
  } catch {
    throw new Error("Could not save rules locally. Storage may be full or unavailable.");
  }
}

/** Save (or overwrite by name) a user rule; returns the new list. */
export function saveUserRule(name: string, yaml: string): SigmaRuleEntry[] {
  if(!name.trim()||name.length>120||new TextEncoder().encode(yaml).length>128*1024)throw new Error("Use a name of 1–120 characters and a rule of at most 128 KiB.");
  const rules = loadUserRules().filter((r) => r.name !== name);
  if(rules.length>=100)throw new Error("At most 100 rules can be saved locally.");
  rules.push({ name, yaml });
  persist(rules);
  return rules;
}

export function deleteUserRule(name: string): SigmaRuleEntry[] {
  const rules = loadUserRules().filter((r) => r.name !== name);
  persist(rules);
  return rules;
}
