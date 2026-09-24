// Package config holds connection configuration and the IAM permissions each
// connection mode requires (surfaced on the connection screen).
package config

// Mode identifies how CloudMon obtains events.
type Mode string

const (
	ModeCreateInfra Mode = "create-infra"
	ModeExistingSQS Mode = "existing-sqs"
	ModeImportDump  Mode = "import-dump"
)

// ConnectionConfig mirrors the frontend ConnectionConfig (JSON tags must match).
type ConnectionConfig struct {
	Mode           string `json:"mode"`
	Region         string `json:"region"`
	Profile        string `json:"profile"`
	QueueURL       string `json:"queueUrl"`
	RuleARN        string `json:"ruleArn"`
	DumpPath       string `json:"dumpPath"`
	CapturePattern string `json:"capturePattern"`
	// WriteOnly narrows Flow A's capture to write-only management events. Default
	// (false) captures ALL management events - including read-only calls like
	// AssumeRole, kms:Decrypt and GetSecretValue - which a plain rule would drop.
	WriteOnly bool `json:"writeOnly"`
}

// RequiredPermission is one IAM action + why it's needed.
type RequiredPermission struct {
	Action string `json:"action"`
	Reason string `json:"reason"`
}

// RequiredPermissions returns the IAM actions a given connection mode needs.
func RequiredPermissions(mode string) []RequiredPermission {
	switch Mode(mode) {
	case ModeCreateInfra:
		return []RequiredPermission{
			{"events:PutRule", "Create the EventBridge rule that captures CloudTrail events"},
			{"events:PutTargets", "Point the rule at the CloudMon SQS queue"},
			{"events:DeleteRule / RemoveTargets", "Tear the capture pipeline down cleanly"},
			{"sqs:CreateQueue", "Create the queue CloudMon polls"},
			{"sqs:SetQueueAttributes", "Attach the policy allowing EventBridge to deliver"},
			{"sqs:GetQueueAttributes", "Read queue ARN/attributes for wiring"},
			{"sqs:GetQueueUrl", "Recover a queue by its saved name after interrupted setup"},
			{"sqs:ReceiveMessage / DeleteMessage", "Consume events at runtime"},
			{"sqs:ChangeMessageVisibility", "Keep received messages leased while their local commit is pending"},
			{"sqs:DeleteQueue", "Delete the queue on teardown (the rule teardown alone would leak it)"},
			{"cloudtrail:DescribeTrails / GetTrailStatus / GetEventSelectors", "Check active trails and their management-event selectors"},
		}
	case ModeExistingSQS:
		return []RequiredPermission{
			{"sqs:ReceiveMessage", "Poll the provided queue for events"},
			{"sqs:DeleteMessage", "Acknowledge messages only after the local commit"},
			{"sqs:ChangeMessageVisibility", "Keep messages leased while processing"},
			{"sqs:GetQueueAttributes", "Validate the queue is reachable"},
		}
	case ModeImportDump:
		return []RequiredPermission{
			{"(none)", "Reads a local file - no AWS access required"},
		}
	default:
		return []RequiredPermission{}
	}
}
