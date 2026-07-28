package awsflow

import "testing"

func TestParseEnvelopeEventBridge(t *testing.T) {
	body := `{"version":"0","id":"abc","detail-type":"AWS API Call via CloudTrail","source":"aws.cloudtrail","region":"us-east-1","detail":{"eventID":"e1","eventName":"AssumeRole","eventSource":"sts.amazonaws.com","eventTime":"2025-01-01T00:00:00Z","readOnly":true,"userIdentity":{"type":"AssumedRole","arn":"arn:aws:sts::111:assumed-role/r/s"}}}`
	ev, ok := ParseEnvelope([]byte(body))
	if !ok {
		t.Fatal("expected envelope to parse")
	}
	if ev.EventName != "AssumeRole" {
		t.Errorf("eventName = %q, want AssumeRole", ev.EventName)
	}
	if !ev.ReadOnly {
		t.Error("readOnly should be true")
	}
	if ev.UserIdentity.Type != "AssumedRole" {
		t.Errorf("identity type = %q, want AssumedRole", ev.UserIdentity.Type)
	}
}

func TestParseEnvelopeRawRecord(t *testing.T) {
	body := `{"eventID":"e2","eventName":"ConsoleLogin","eventSource":"signin.amazonaws.com","eventTime":"2025-01-01T00:00:01Z"}`
	ev, ok := ParseEnvelope([]byte(body))
	if !ok || ev.EventName != "ConsoleLogin" {
		t.Fatalf("raw record fallback failed: ok=%v name=%q", ok, ev.EventName)
	}
}

func TestParseEnvelopeGarbage(t *testing.T) {
	if _, ok := ParseEnvelope([]byte("not json at all")); ok {
		t.Error("garbage body should not parse")
	}
	if _, ok := ParseEnvelope([]byte(`{"detail":{"foo":"bar"}}`)); ok {
		t.Error("envelope with no eventName should not parse")
	}
}
