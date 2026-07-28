// Package awsflow implements CloudMon's live "Flow A" ingestion against AWS: it
// enumerates local ~/.aws profiles, confirms identity via STS, provisions a
// parallel EventBridge rule + SQS queue (never touching the customer's trail), and
// polls the queue for CloudTrail events. Pure Go (no CGO) so the app builds and
// cross-compiles for Windows, macOS, and Linux.
package awsflow

import ebtypes "github.com/aws/aws-sdk-go-v2/service/eventbridge/types"

// Event patterns for the EventBridge rule. We match on detail-type ONLY: CloudTrail
// API-call events reach EventBridge with source "aws.<service>" (aws.ec2, aws.iam,
// aws.kms, …), not "aws.cloudtrail", so constraining source would drop nearly every
// event. detail-type "AWS API Call via CloudTrail" catches all management API calls;
// adding "AWS Console Sign In via CloudTrail" catches console logins (incl. failed
// MFA). The default keeps read-only calls (AssumeRole, kms:Decrypt, GetSecretValue)
// that a plain rule drops; the write-only variant is the opt-out.
const (
	patternAllManagement = `{"detail-type":["AWS API Call via CloudTrail","AWS Console Sign In via CloudTrail"]}`
	patternWriteOnly     = `{"detail-type":["AWS API Call via CloudTrail"],"detail":{"readOnly":[false]}}`
)

// BuildEventPattern returns the EventBridge event pattern for the chosen scope.
func BuildEventPattern(allManagement bool) string {
	if allManagement {
		return patternAllManagement
	}
	return patternWriteOnly
}

// RuleState returns the EventBridge rule state. All-management capture REQUIRES the
// ENABLED_WITH_ALL_CLOUDTRAIL_MANAGEMENT_EVENTS state - a plain ENABLED rule silently
// drops read-only management events (the crown-jewel forensic trail).
func RuleState(allManagement bool) ebtypes.RuleState {
	if allManagement {
		return ebtypes.RuleStateEnabledWithAllCloudtrailManagementEvents
	}
	return ebtypes.RuleStateEnabled
}
