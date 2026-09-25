import type {CloudTrailEvent, UserIdentity} from "./types";

const SERVICES = new Map(Object.entries({
  secretsmanager: "Secrets Manager", s3: "S3", ec2: "EC2", iam: "IAM", sts: "STS", kms: "KMS",
  lambda: "Lambda", dynamodb: "DynamoDB", cloudtrail: "CloudTrail", logs: "CloudWatch Logs",
  monitoring: "CloudWatch", ssm: "Systems Manager", rds: "RDS", eks: "EKS", ecs: "ECS",
  sqs: "SQS", sns: "SNS", cloudformation: "CloudFormation", elasticloadbalancing: "Elastic Load Balancing",
  route53: "Route 53", organizations: "Organizations", signin: "AWS sign-in", ecr: "ECR",
}));
const serviceKey = (source: string) => /^([a-z0-9-]+)\.amazonaws\.com(?:\.cn)?$/.exec(source)?.[1] || "";

/** Exact endpoint mapping only; unfamiliar sources stay literal, not guessed. */
export function eventServiceLabel(source: string): string {
  return SERVICES.get(serviceKey(source)) || source || "Service not recorded";
}

export interface EventActorPresentation {
  name: string;
  session: string;
  typeLabel: string;
}

/** Display-only names. Always keep the original identity for evidence/pivots. */
export function presentEventActor(identity: UserIdentity): EventActorPresentation {
  const assumed = /^arn:[a-z0-9-]+:sts::[0-9]{12}:assumed-role\/(.+)\/([^/]+)$/.exec(identity.arn);
  const role = /^arn:[a-z0-9-]+:iam::[0-9]{12}:role\/(.+)$/.exec(identity.roleArn || "");
  const user = /^arn:[a-z0-9-]+:iam::[0-9]{12}:user\/(.+)$/.exec(identity.arn);
  const last = (value: string) => value.slice(value.lastIndexOf("/") + 1);
  const types = new Map(Object.entries({AssumedRole: "Assumed role", IAMUser: "IAM user", AWSService: "AWS service", AWSAccount: "AWS account", FederatedUser: "Federated user", Root: "Root"}));
  const fallback = identity.arn || identity.principalId || "Identity not recorded";
  return {
    name: identity.type === "AssumedRole"
      ? (assumed ? last(assumed[1]) : role ? last(role[1]) : identity.userName || fallback)
      : identity.type === "Root" ? "Root" : identity.userName || (user ? last(user[1]) : fallback),
    session: identity.sessionName || (identity.type === "AssumedRole" ? assumed?.[2] || "" : ""),
    typeLabel: types.get(identity.type) || identity.type || "Type not recorded",
  };
}

const OPERATIONS = new Map(Object.entries({
  "secretsmanager:GetSecretValue": "Secret read",
  "secretsmanager:PutSecretValue": "Secret update",
  "secretsmanager:DeleteSecret": "Secret deletion",
  "s3:GetObject": "Object read", "s3:PutObject": "Object write", "s3:DeleteObject": "Object deletion",
  "s3:ListObjects": "Object listing", "s3:ListObjectsV2": "Object listing", "s3:ListBuckets": "Bucket listing",
  "sts:AssumeRole": "Role assumption", "sts:AssumeRoleWithSAML": "SAML role assumption",
  "sts:AssumeRoleWithWebIdentity": "Web identity role assumption", "sts:GetCallerIdentity": "Caller identity lookup",
  "iam:ListRoles": "Role listing", "iam:CreateAccessKey": "Access key creation",
  "iam:AttachRolePolicy": "Role policy attachment", "iam:PutRolePolicy": "Role policy update",
  "ec2:DescribeInstances": "Instance listing", "ec2:DescribeVolumes": "Volume listing",
  "ec2:RunInstances": "Instance launch", "ec2:TerminateInstances": "Instance termination",
  "kms:Decrypt": "Decryption", "kms:Encrypt": "Encryption", "kms:GenerateDataKey": "Data key generation",
  "lambda:Invoke": "Function invocation", "cloudtrail:StopLogging": "Trail logging stop",
}));
const DENIALS = new Set(["AccessDenied", "AccessDeniedException", "UnauthorizedOperation", "Client.UnauthorizedOperation", "UnauthorizedException", "NotAuthorizedException"]);

export interface EventMeaning {
  headline: string;
  outcome: string;
  tone: "neutral" | "error";
}

/** Describe the recorded operation/outcome, never impact, intent, or success. */
export function eventMeaning(event: Pick<CloudTrailEvent, "eventName" | "eventSource" | "errorCode" | "errorMessage">): EventMeaning {
  const known = OPERATIONS.get(`${serviceKey(event.eventSource)}:${event.eventName}`);
  const operation = known || event.eventName || "Operation";
  const error = !!(event.errorCode || event.errorMessage);
  return {
    headline: DENIALS.has(event.errorCode || "") ? `${operation} denied`
      : error ? `${operation} reported an error` : `${operation} ${known ? "requested" : "recorded"}`,
    outcome: event.errorCode || (error ? "Error recorded" : "No error recorded"),
    tone: error ? "error" : "neutral",
  };
}
