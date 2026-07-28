package ingest

import (
	"bytes"
	"compress/gzip"
	"testing"
)

const rec1 = `{"eventID":"11111111-1111-1111-1111-111111111111","eventTime":"2026-07-23T18:00:05Z","eventName":"RunInstances","eventSource":"ec2.amazonaws.com","awsRegion":"us-east-1","sourceIPAddress":"1.2.3.4","userIdentity":{"type":"IAMUser","userName":"alice","arn":"arn:aws:iam::123456789012:user/alice","accountId":"123456789012"},"errorCode":"Client.UnauthorizedOperation","readOnly":false}`
const rec2 = `{"eventID":"22222222-2222-2222-2222-222222222222","eventTime":"2026-07-23T18:00:01Z","eventName":"ListBuckets","eventSource":"s3.amazonaws.com","awsRegion":"us-east-1","sourceIPAddress":"5.6.7.8","userIdentity":{"type":"AssumedRole","userName":"deploy","arn":"arn:aws:sts::123456789012:assumed-role/deploy/x"},"readOnly":true}`

func TestParseRecordsEnvelope(t *testing.T) {
	data := []byte(`{"Records":[` + rec1 + `,` + rec2 + `]}`)
	evs, err := ParseDump(data)
	if err != nil {
		t.Fatal(err)
	}
	if len(evs) != 2 {
		t.Fatalf("want 2 events, got %d", len(evs))
	}
	// sorted oldest-first: rec2 (18:00:01) before rec1 (18:00:05)
	if evs[0].EventName != "ListBuckets" || evs[1].EventName != "RunInstances" {
		t.Fatalf("wrong order: %s, %s", evs[0].EventName, evs[1].EventName)
	}
	if evs[0].Seq != 1 || evs[1].Seq != 2 {
		t.Fatalf("seq not assigned: %d, %d", evs[0].Seq, evs[1].Seq)
	}
	if evs[1].ErrorCode != "Client.UnauthorizedOperation" {
		t.Fatalf("errorCode lost: %q", evs[1].ErrorCode)
	}
	if evs[0].UserIdentity.UserName != "deploy" {
		t.Fatalf("identity lost: %q", evs[0].UserIdentity.UserName)
	}
	if evs[0].RawJSON == "" {
		t.Fatal("rawJSON not retained")
	}
}

func TestParseLookupEventsEnvelope(t *testing.T) {
	// `aws cloudtrail lookup-events` wraps each event as a JSON *string*
	body := `{"Events":[{"EventId":"x","CloudTrailEvent":` + jsonString(rec1) + `}]}`
	evs, err := ParseDump([]byte(body))
	if err != nil {
		t.Fatal(err)
	}
	if len(evs) != 1 || evs[0].EventName != "RunInstances" {
		t.Fatalf("lookup-events parse failed: %+v", evs)
	}
}

func TestParseBareArray(t *testing.T) {
	evs, err := ParseDump([]byte(`[` + rec1 + `,` + rec2 + `]`))
	if err != nil || len(evs) != 2 {
		t.Fatalf("array parse failed: %v %d", err, len(evs))
	}
}

func TestParseNDJSON(t *testing.T) {
	evs, err := ParseDump([]byte(rec1 + "\n" + rec2 + "\n"))
	if err != nil || len(evs) != 2 {
		t.Fatalf("ndjson parse failed: %v %d", err, len(evs))
	}
}

func TestParseGzip(t *testing.T) {
	var buf bytes.Buffer
	w := gzip.NewWriter(&buf)
	w.Write([]byte(`{"Records":[` + rec1 + `]}`))
	w.Close()
	evs, err := ParseDump(buf.Bytes())
	if err != nil || len(evs) != 1 {
		t.Fatalf("gzip parse failed: %v %d", err, len(evs))
	}
}

func TestParseCSV(t *testing.T) {
	csv := "Event ID,Event time,Event name,Event source,User name,AWS region,Source IP address,Error code\n" +
		"abc,2026-07-23T18:00:05Z,RunInstances,ec2.amazonaws.com,alice,us-east-1,1.2.3.4,AccessDenied\n"
	evs, err := ParseDump([]byte(csv))
	if err != nil {
		t.Fatal(err)
	}
	if len(evs) != 1 || evs[0].EventName != "RunInstances" || evs[0].ErrorCode != "AccessDenied" {
		t.Fatalf("csv parse failed: %+v", evs)
	}
	if evs[0].UserIdentity.UserName != "alice" {
		t.Fatalf("csv user lost: %q", evs[0].UserIdentity.UserName)
	}
}

func TestParseEmpty(t *testing.T) {
	if _, err := ParseDump([]byte("   ")); err == nil {
		t.Fatal("expected error on empty input")
	}
}

// jsonString returns s as a quoted JSON string literal.
func jsonString(s string) string {
	var b bytes.Buffer
	b.WriteByte('"')
	for _, r := range s {
		switch r {
		case '"':
			b.WriteString(`\"`)
		case '\\':
			b.WriteString(`\\`)
		default:
			b.WriteRune(r)
		}
	}
	b.WriteByte('"')
	return b.String()
}

func TestRejectNonCloudTrail(t *testing.T) {
	if _, err := ParseDump([]byte(`{"foo":"bar","hello":123}`)); err == nil {
		t.Fatal("expected rejection of a random JSON object")
	}
	if _, err := ParseDump([]byte(`[{"a":1},{"b":2}]`)); err == nil {
		t.Fatal("expected rejection of an arbitrary JSON array")
	}
	if _, err := ParseDump([]byte(`{"Records":[{"eventName":"Ok","eventTime":"2026-07-23T00:00:00Z"}]}`)); err != nil {
		t.Fatalf("valid CloudTrail should pass: %v", err)
	}
}
