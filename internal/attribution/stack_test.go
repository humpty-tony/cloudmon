package attribution

import (
	"context"
	"fmt"
	"net/http"
	"testing"

	"github.com/aws/aws-sdk-go-v2/service/cloudtrail"
)

func TestResolveStacksIndependentSources(t *testing.T) {
	ct := &fakeCT{fn: func(*cloudtrail.LookupEventsInput) (*cloudtrail.LookupEventsOutput, error) {
		return ctPage(issuance("issuance", "ASIAchild", "AKIAroot")), nil
	}}
	directory := &fakeIdentity{}
	d := testDeps(ct)
	base := d.aws
	d.aws = func(ctx context.Context, profile, region string) (awsClients, error) {
		if profile != "" {
			t.Fatal("blank profile no longer uses default chain")
		}
		clients, err := base(ctx, profile, region)
		clients.identity = directory
		return clients, err
	}
	d.getenv = func(string) string { return "synthetic-opaque-token" }
	d.http = graphTestClient(t, func(w http.ResponseWriter, req *http.Request) {
		if req.URL.Path == "/v1.0/organization" {
			fmt.Fprint(w, `{"value":[{"id":"11111111-1111-1111-1111-111111111111"}]}`)
		} else {
			fmt.Fprint(w, `{"id":"object-1","displayName":"Fixture"}`)
		}
	})
	cfg := entraConfig()
	cfg.AWSRegions = []string{"eu-west-1"}
	cfg.IdentityCenterRegion = "us-east-2"
	cfg.VaultAuditPath = auditFile(t, auditLine("broker", "ASIAchild", "broker-entity"))
	result, err := resolveWith(context.Background(), withIdentity(entraSeed()), nil, cfg, d)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Sources) != 4 || len(result.Records) != 1 {
		t.Fatalf("unexpected result: %+v", result)
	}
	counts := map[string]int{}
	for _, e := range result.Evidence {
		counts[e.Source]++
	}
	for _, source := range []string{"cloudtrail", "identity-center", "entra", "vault"} {
		if counts[source] != 1 {
			t.Fatalf("source did not stack: %s: %+v", source, counts)
		}
	}
}
