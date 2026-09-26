package attribution

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

type roundTripper func(*http.Request) (*http.Response, error)

func (f roundTripper) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func graphTestClient(t *testing.T, handler http.HandlerFunc) *http.Client {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	target, _ := url.Parse(server.URL)
	return &http.Client{Transport: roundTripper(func(r *http.Request) (*http.Response, error) {
		if r.URL.Scheme != "https" || r.URL.Host != "graph.microsoft.com" {
			t.Fatalf("wrong Graph host: %s", r.URL)
		}
		clone := r.Clone(r.Context())
		u := *r.URL
		u.Scheme = target.Scheme
		u.Host = target.Host
		clone.URL = &u
		return http.DefaultTransport.RoundTrip(clone)
	})}
}
func entraSeed() string {
	return strings.Replace(testSeed, `"type":"AssumedRole"`, `"type":"AssumedRole","arn":"arn:aws:sts::123456789012:assumed-role/Example/alice#EXT#@example.test"`, 1)
}
func entraConfig() Config {
	return Config{EntraTenantID: "11111111-1111-1111-1111-111111111111", EntraMappings: []FederationMapping{{RoleARN: "arn:aws:iam::123456789012:role/Example", ValidFrom: "2026-09-01T00:00:00Z", ValidTo: "2026-10-01T00:00:00Z", VerifiedAt: "2026-09-20T00:00:00Z", Note: "Operator reviewed claim mapping"}}}
}
func TestEntraAttestedMappingAndTenantBinding(t *testing.T) {
	cfg := entraConfig()
	payload := base64.RawURLEncoding.EncodeToString([]byte(`{"tid":"` + cfg.EntraTenantID + `"}`))
	token := "header." + payload + ".signature"
	calls := 0
	d := testDeps(nil)
	d.getenv = func(name string) string {
		if name != "CLOUDMON_ENTRA_TOKEN" {
			t.Fatal(name)
		}
		return token
	}
	d.http = graphTestClient(t, func(w http.ResponseWriter, req *http.Request) {
		calls++
		if req.Header.Get("Authorization") != "Bearer "+token || req.URL.EscapedPath() != "/v1.0/users/alice%23EXT%23@example.test" || req.URL.Query().Get("$select") != "id,displayName,userPrincipalName,mail" {
			t.Errorf("bad Graph request %s", req.URL)
		}
		fmt.Fprint(w, `{"id":"object-1","displayName":"Alice","userPrincipalName":"alice@example.test","mail":"alice@example.test"}`)
	})
	e, _ := parseEvent(entraSeed())
	r := emptyResult(testNow)
	enrichEntra(context.Background(), []trailEvent{e}, cfg, d, &r)
	if calls != 1 || len(r.Evidence) != 1 || sourceStatus(r, "entra").Status != "candidate" || !strings.Contains(r.Evidence[0].Description, "operator attestation") {
		t.Fatalf("missing conditional result: %+v", r)
	}
	b, _ := json.Marshal(r)
	if strings.Contains(string(b), token) {
		t.Fatal("token leaked")
	}
}
func TestEntraNoMappingOrWrongTenantSkips(t *testing.T) {
	for _, which := range []string{"none", "wrong-role", "expired", "tenant-mismatch"} {
		t.Run(which, func(t *testing.T) {
			cfg := entraConfig()
			switch which {
			case "none":
				cfg.EntraMappings = nil
			case "wrong-role":
				cfg.EntraMappings[0].RoleARN += "Other"
			case "expired":
				cfg.EntraMappings[0].ValidTo = "2026-09-24T00:00:00Z"
			}
			d := testDeps(nil)
			d.getenv = func(string) string {
				return "h." + base64.RawURLEncoding.EncodeToString([]byte(`{"tid":"wrong"}`)) + ".s"
			}
			d.http = graphTestClient(t, func(http.ResponseWriter, *http.Request) { t.Error("must not send lookup") })
			e, _ := parseEvent(entraSeed())
			r := emptyResult(testNow)
			enrichEntra(context.Background(), []trailEvent{e}, cfg, d, &r)
			if len(r.Evidence) > 0 {
				t.Fatal("unattested identity accepted")
			}
		})
	}
}
func TestEntraOpaqueTokenOrganizationBinding(t *testing.T) {
	d := testDeps(nil)
	d.getenv = func(string) string { return "synthetic-opaque-token" }
	calls := 0
	d.http = graphTestClient(t, func(w http.ResponseWriter, req *http.Request) {
		calls++
		if req.URL.Path == "/v1.0/organization" {
			fmt.Fprint(w, `{"value":[{"id":"11111111-1111-1111-1111-111111111111"}]}`)
		} else {
			fmt.Fprint(w, `{"id":"user-object"}`)
		}
	})
	e, _ := parseEvent(entraSeed())
	r := emptyResult(testNow)
	enrichEntra(context.Background(), []trailEvent{e}, entraConfig(), d, &r)
	if calls != 2 || len(r.Evidence) != 1 {
		t.Fatalf("organization binding: %+v calls=%d", r, calls)
	}
}
