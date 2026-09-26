package attribution

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/cloudtrail"
)

func TestCloudTrailLimitsFailuresAndCycles(t *testing.T) {
	for _, mode := range []string{"pages", "repeated", "denied", "partial", "cycle", "failed-issuance", "future"} {
		t.Run(mode, func(t *testing.T) {
			ct := &fakeCT{}
			ct.fn = func(in *cloudtrail.LookupEventsInput) (*cloudtrail.LookupEventsOutput, error) {
				if mode == "denied" || mode == "partial" && ct.calls == 2 {
					return nil, errors.New("must-not-reflect-secret")
				}
				raw := issuance("a", "ASIAchild", "ASIAchild")
				if mode == "failed-issuance" {
					raw = strings.Replace(raw, `"eventName":"AssumeRole"`, `"eventName":"AssumeRole","errorCode":"Denied"`, 1)
				}
				p := ctPage(raw)
				switch mode {
				case "pages":
					p.NextToken = aws.String(fmt.Sprint(ct.calls))
				case "repeated", "partial":
					p.NextToken = aws.String("same")
				case "future":
					if in.EndTime.After(testNow) {
						t.Fatal("future lookup")
					}
				}
				return p, nil
			}
			seed := testSeed
			if mode == "future" {
				seed = strings.Replace(seed, "2026-09-25", "2026-09-26", 1)
			}
			r, err := resolveWith(context.Background(), seed, nil, Config{AWSRegions: []string{"eu-west-1"}}, testDeps(ct))
			if err != nil {
				t.Fatal(err)
			}
			expected := "candidate"
			switch mode {
			case "pages", "repeated", "partial":
				expected = "partial"
			case "denied":
				expected = "error"
			case "failed-issuance":
				expected = "complete"
			}
			if r.Sources[0].Status != expected || ct.calls > maxPages {
				t.Fatalf("bounds/status: %+v calls %d", r.Sources, ct.calls)
			}
			b, _ := json.Marshal(r)
			if strings.Contains(string(b), "must-not-reflect") {
				t.Fatal("reflected SDK error")
			}
			if mode == "failed-issuance" && len(r.Records) != 0 {
				t.Fatal("failed issuance accepted")
			}
		})
	}
}
func TestCloudTrailOriginalAuditCredentialsPreserved(t *testing.T) {
	raw := strings.Replace(issuance("logged-token", "ASIAchild", "AKIAroot"), `"credentials":{`, `"credentials":{"sessionToken":"synthetic-audit-session-token",`, 1)
	ct := &fakeCT{fn: func(*cloudtrail.LookupEventsInput) (*cloudtrail.LookupEventsOutput, error) { return ctPage(raw), nil }}
	d := testDeps(ct)
	d.getenv = func(string) string { return "synthetic-connector-auth-secret" }
	r, err := resolveWith(context.Background(), testSeed, nil, Config{AWSRegions: []string{"eu-west-1"}}, d)
	if err != nil || len(r.Records) != 1 || r.Records[0].Raw != raw || r.Sources[0].Status != "candidate" {
		t.Fatalf("original STS audit record was discarded or rewritten: %+v %v", r, err)
	}
	metadata, _ := json.Marshal(r.Evidence)
	if strings.Contains(string(metadata), "synthetic-audit-session-token") {
		t.Fatal("audit payload copied into attribution metadata")
	}
	all, _ := json.Marshal(r)
	if strings.Contains(string(all), "synthetic-connector-auth-secret") {
		t.Fatal("connector authentication secret exposed")
	}
}
func TestRequestSecurityRedirectTLSBodyAndErrorSecrecy(t *testing.T) {
	for _, mode := range []string{"http", "redirect", "large", "echo", "tls"} {
		t.Run(mode, func(t *testing.T) {
			calls := 0
			handler := http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				calls++
				switch mode {
				case "redirect":
					http.Redirect(w, req, "/target", 302)
				case "large":
					fmt.Fprint(w, strings.Repeat(" ", maxHTTPBody+1))
				case "echo":
					fmt.Fprint(w, `{"id":"synthetic-private-token"}`)
				default:
					fmt.Fprint(w, `{}`)
				}
			})
			srv := httptest.NewServer(handler)
			defer srv.Close()
			d := dependencies{http: srv.Client(), allowHTTP: mode != "http"}
			address := srv.URL
			if mode == "tls" {
				tlsServer := httptest.NewTLSServer(handler)
				defer tlsServer.Close()
				address = tlsServer.URL
				d = dependencies{}
			}
			var out any
			err := requestJSON(context.Background(), d, "GET", address, "Authorization", "Bearer synthetic-private-token", "", &out)
			if err == nil || strings.Contains(err.Error(), "synthetic-private-token") {
				t.Fatalf("unsafe request result: %v", err)
			}
			if mode == "http" && calls != 0 || mode == "redirect" && calls != 1 {
				t.Fatalf("redirect/plaintext accepted calls=%d", calls)
			}
		})
	}
}
func TestInputBoundsRegionsCancellationAndDepth(t *testing.T) {
	d := testDeps(nil)
	d.aws = func(context.Context, string, string) (awsClients, error) {
		t.Fatal("unexpected AWS call")
		return awsClients{}, nil
	}
	for _, regions := range [][]string{{"https://other"}, make([]string, 9)} {
		if _, err := resolveWith(context.Background(), testSeed, nil, Config{AWSRegions: regions}, d); err == nil {
			t.Fatal("invalid region accepted")
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := resolveWith(ctx, testSeed, nil, Config{}, d); !errors.Is(err, context.Canceled) {
		t.Fatal("cancellation ignored")
	}
	seed, _ := parseEvent(testSeed)
	regions, _ := regionsFor(Config{}, seed)
	if strings.Join(regions, ",") != "eu-west-1,us-east-1" {
		t.Fatal(regions)
	}
	all := []trailEvent{}
	for i := 0; i < 15; i++ {
		child := fmt.Sprint("key", i)
		if i == 0 {
			child = "ASIAchild"
		}
		e, _ := parseEvent(issuance(fmt.Sprint(i), child, fmt.Sprint("key", i+1)))
		all = append(all, e)
	}
	selected, partial := selectAncestors([]trailEvent{seed}, all)
	if len(selected) != 12 || !partial {
		t.Fatalf("depth cap: %d %v", len(selected), partial)
	}
}

func TestSharedCloudTrailLimiter(t *testing.T) {
	scope := "synthetic-limiter-test"
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := waitCloudTrail(ctx, scope); err != nil {
		t.Fatal(err)
	}
	start := time.Now()
	if err := waitCloudTrail(ctx, scope); err != nil {
		t.Fatal(err)
	}
	if time.Since(start) < 450*time.Millisecond {
		t.Fatal("CloudTrail rate exceeded")
	}
	cancelled, c := context.WithCancel(context.Background())
	c()
	if err := waitCloudTrail(cancelled, scope); !errors.Is(err, context.Canceled) {
		t.Fatal("limiter ignored cancellation")
	}
}
