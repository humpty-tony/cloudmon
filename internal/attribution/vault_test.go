package attribution

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func auditLine(id, key, entity string) string {
	return fmt.Sprintf(`{"type":"response","time":"2026-09-25T10:00:00Z","auth":{"entity_id":%q,"client_token":"must-not-leak-auth"},"request":{"id":%q,"mount_type":"aws","path":"aws/sts/example","operation":"read","remote_address":"192.0.2.10","headers":{"user-agent":["vault-fixture"]}},"response":{"data":{"access_key":%q,"secret_key":"must-not-leak-secret","security_token":"must-not-leak-session"}}}`, entity, id, key)
}
func auditFile(t *testing.T, lines ...string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "audit.jsonl")
	if err := os.WriteFile(p, []byte(strings.Join(lines, "\n")+"\n"), 0600); err != nil {
		t.Fatal(err)
	}
	return p
}
func TestVaultExactSuccessfulAWSResponseOnly(t *testing.T) {
	valid := auditLine("good", "ASIAchild", "entity-good")
	bad := []string{
		strings.Replace(valid, `"type":"response"`, `"type":"request"`, 1),
		strings.Replace(valid, `"type":"response"`, `"type":"response","error":"denied"`, 1),
		strings.Replace(valid, `"mount_type":"aws"`, `"mount_type":"kv"`, 1),
		strings.Replace(valid, `"path":"aws/sts/example"`, `"path":"aws/config/root"`, 1),
		auditLine("empty-entity", "ASIAchild", ""),
		strings.Replace(auditLine("wrong-key", "ASIAother", "other"), `"path":"aws/sts/example"`, `"path":"aws/sts/ASIAchild"`, 1),
	}
	cfg := Config{VaultAuditPath: auditFile(t, append(bad, valid)...)}
	d := testDeps(nil)
	e, _ := parseEvent(testSeed)
	r := emptyResult(testNow)
	enrichVault(context.Background(), []trailEvent{e}, cfg, d, &r)
	if len(r.Evidence) != 1 || r.Evidence[0].SubjectID != "entity-good" || sourceStatus(r, "vault").Status != "candidate" {
		t.Fatalf("not exact issuance: %+v", r)
	}
	init := r.Evidence[0].Initiator
	if init.EventID != "good" || init.IP != "192.0.2.10" || init.UserAgent != "vault-fixture" {
		t.Fatalf("missing initiator: %+v", init)
	}
	encoded, _ := json.Marshal(r)
	if strings.Contains(string(encoded), "must-not-leak") || len(r.Records) != 0 {
		t.Fatalf("Vault secret/raw leaked: %s", encoded)
	}
}
func TestVaultAuditHMACSendsOnlyKnownKey(t *testing.T) {
	digest := "hmac-sha256:" + strings.Repeat("a", 64)
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		calls++
		var body map[string]string
		json.NewDecoder(req.Body).Decode(&body)
		if req.Method != "POST" || req.URL.EscapedPath() != "/v1/sys/audit-hash/audit%2Ffile" || req.Header.Get("X-Vault-Token") != "synthetic-vault-token" || len(body) != 1 || body["input"] != "ASIAchild" {
			t.Errorf("unsafe hash request: %s %+v", req.URL, body)
		}
		fmt.Fprintf(w, `{"data":{"hash":%q}}`, digest)
	}))
	defer server.Close()
	d := testDeps(nil)
	d.http = server.Client()
	d.allowHTTP = true
	d.getenv = func(name string) string {
		if name != "VAULT_TOKEN" {
			t.Fatal(name)
		}
		return "synthetic-vault-token"
	}
	cfg := Config{VaultAddress: server.URL, VaultAuditDevice: "audit/file", VaultAuditPath: auditFile(t, auditLine("a", digest, "entity"), auditLine("b", digest, "entity2"))}
	e, _ := parseEvent(testSeed)
	r := emptyResult(testNow)
	enrichVault(context.Background(), []trailEvent{e}, cfg, d, &r)
	if calls != 1 || len(r.Evidence) != 2 || r.Evidence[0].Method != "audit-hmac-issued-access-key" {
		t.Fatalf("hash/cache candidates: %+v calls=%d", r, calls)
	}
}
func TestVaultMissingHashContextAndOversizedFile(t *testing.T) {
	e, _ := parseEvent(testSeed)
	d := testDeps(nil)
	p := auditFile(t, auditLine("a", "hmac-sha256:"+strings.Repeat("a", 64), "entity"))
	r := emptyResult(testNow)
	enrichVault(context.Background(), []trailEvent{e}, Config{VaultAuditPath: p}, d, &r)
	if sourceStatus(r, "vault").Status != "partial" || len(r.Evidence) > 0 {
		t.Fatalf("missing HMAC context: %+v", r)
	}
	file, err := os.OpenFile(p, os.O_WRONLY, 0600)
	if err != nil {
		t.Fatal(err)
	}
	file.Truncate(64<<20 + 1)
	file.Close()
	r = emptyResult(testNow)
	enrichVault(context.Background(), []trailEvent{e}, Config{VaultAuditPath: p}, d, &r)
	if sourceStatus(r, "vault").Status != "unavailable" {
		t.Fatalf("oversized audit accepted: %+v", r)
	}
}
