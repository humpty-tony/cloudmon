// Package model defines the normalized CloudTrail event that every ingestion
// source (live EventBridge->SQS, S3 log files, or a manual dump) reduces to.
// Keeping one struct means the UI, filtering, and rendering are source-agnostic.
package model

import "encoding/json"

// UserIdentity is the normalized subset of the CloudTrail userIdentity block
// that the UI surfaces. The full block is preserved in CloudTrailEvent.RawJSON.
type UserIdentity struct {
	Type        string `json:"type"`
	PrincipalID string `json:"principalId"`
	ARN         string `json:"arn"`
	AccountID   string `json:"accountId"`
	UserName    string `json:"userName"`
}

// CloudTrailEvent is the single internal event shape used across CloudMon.
// JSON tags are camelCase so the Wails-generated TypeScript bindings match the
// frontend interface without translation.
type CloudTrailEvent struct {
	// Seq is a local monotonic sequence number assigned by the store on insert.
	// It drives stable ordering and incremental pagination in the UI; it is not
	// part of the CloudTrail record itself.
	Seq int64 `json:"seq"`

	EventID          string       `json:"eventID"`
	EventTime        string       `json:"eventTime"` // RFC3339, from the record
	EventName        string       `json:"eventName"`
	EventSource      string       `json:"eventSource"`
	AWSRegion        string       `json:"awsRegion"`
	SourceIPAddress  string       `json:"sourceIPAddress"`
	UserAgent        string       `json:"userAgent"`
	UserIdentity     UserIdentity `json:"userIdentity"`
	ReadOnly         bool         `json:"readOnly"`
	ManagementEvent  bool         `json:"managementEvent"`
	ErrorCode        string       `json:"errorCode,omitempty"`
	ErrorMessage     string       `json:"errorMessage,omitempty"`
	RecipientAccount string       `json:"recipientAccountId"`

	// RawJSON is the original JSON record for the detail pane.
	RawJSON string `json:"rawJSON"`
}

// Result returns a short outcome label used by the UI (and color coding).
func (e CloudTrailEvent) Result() string {
	if e.ErrorCode != "" {
		return e.ErrorCode
	}
	return "Success"
}

// Failed reports whether the API call errored.
func (e CloudTrailEvent) Failed() bool { return e.ErrorCode != "" }

// ctRecord mirrors the on-the-wire CloudTrail record field names. Both the
// EventBridge "detail" payload and the objects inside an S3 log file's
// "Records" array use this shape, so one decoder serves every source.
type ctRecord struct {
	EventID          string          `json:"eventID"`
	EventTime        string          `json:"eventTime"`
	EventName        string          `json:"eventName"`
	EventSource      string          `json:"eventSource"`
	AWSRegion        string          `json:"awsRegion"`
	SourceIPAddress  string          `json:"sourceIPAddress"`
	UserAgent        string          `json:"userAgent"`
	ReadOnly         bool            `json:"readOnly"`
	ManagementEvent  bool            `json:"managementEvent"`
	ErrorCode        string          `json:"errorCode"`
	ErrorMessage     string          `json:"errorMessage"`
	RecipientAccount string          `json:"recipientAccountId"`
	UserIdentity     json.RawMessage `json:"userIdentity"`
}

// FromRawJSON parses a single CloudTrail record (as delivered by EventBridge or
// found in an S3 log file) into the normalized CloudTrailEvent. The original
// object bytes are retained without re-encoding for evidence storage.
func FromRawJSON(raw []byte) (CloudTrailEvent, error) {
	var r ctRecord
	if err := json.Unmarshal(raw, &r); err != nil {
		return CloudTrailEvent{}, err
	}

	var ui UserIdentity
	if len(r.UserIdentity) > 0 {
		_ = json.Unmarshal(r.UserIdentity, &ui) // best-effort; identity shapes vary
	}

	e := CloudTrailEvent{
		EventID:          r.EventID,
		EventTime:        r.EventTime,
		EventName:        r.EventName,
		EventSource:      r.EventSource,
		AWSRegion:        r.AWSRegion,
		SourceIPAddress:  r.SourceIPAddress,
		UserAgent:        r.UserAgent,
		UserIdentity:     ui,
		ReadOnly:         r.ReadOnly,
		ManagementEvent:  r.ManagementEvent,
		ErrorCode:        r.ErrorCode,
		ErrorMessage:     r.ErrorMessage,
		RecipientAccount: r.RecipientAccount,
	}

	e.RawJSON = string(raw)

	return e, nil
}
