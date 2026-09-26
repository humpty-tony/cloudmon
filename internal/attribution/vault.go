package attribution

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"
)

const maxAuditBytes = 64 << 20

var auditHMACPattern = regexp.MustCompile(`^hmac-sha256:[0-9a-f]{64}$`)

type auditRecord struct {
	Type  string          `json:"type"`
	Time  string          `json:"time"`
	Error json.RawMessage `json:"error"`
	Auth  struct {
		EntityID string `json:"entity_id"`
	} `json:"auth"`
	Request struct {
		ID        string              `json:"id"`
		MountType string              `json:"mount_type"`
		Path      string              `json:"path"`
		Operation string              `json:"operation"`
		Remote    string              `json:"remote_address"`
		Headers   map[string][]string `json:"headers"`
	} `json:"request"`
	Response struct {
		MountType string `json:"mount_type"`
		Data      struct {
			AccessKey string          `json:"access_key"`
			Error     json.RawMessage `json:"error"`
			Errors    json.RawMessage `json:"errors"`
		} `json:"data"`
	} `json:"response"`
}

func emptyAuditError(raw json.RawMessage) bool {
	s := strings.TrimSpace(string(raw))
	return s == "" || s == "null" || s == `""` || s == "[]"
}
func (a auditRecord) successfulAWS() bool {
	if a.Type != "response" || !emptyAuditError(a.Error) || !emptyAuditError(a.Response.Data.Error) || !emptyAuditError(a.Response.Data.Errors) || a.Auth.EntityID == "" || a.Request.ID == "" || a.Response.Data.AccessKey == "" {
		return false
	}
	if a.Request.MountType != "aws" && a.Response.MountType != "aws" {
		return false
	}
	if (a.Request.MountType != "" && a.Request.MountType != "aws") || (a.Response.MountType != "" && a.Response.MountType != "aws") {
		return false
	}
	if a.Request.Operation != "read" && a.Request.Operation != "update" {
		return false
	}
	parts := strings.Split(a.Request.Path, "/")
	if len(parts) < 3 || parts[len(parts)-1] == "" || (parts[len(parts)-2] != "sts" && parts[len(parts)-2] != "creds") {
		return false
	}
	_, err := time.Parse(time.RFC3339Nano, a.Time)
	return err == nil
}
func vaultHash(ctx context.Context, key string, cfg Config, d dependencies) (string, error) {
	address, err := url.Parse(cfg.VaultAddress)
	if err != nil || address.Host == "" || address.User != nil || address.RawQuery != "" || address.Fragment != "" || (address.Path != "" && address.Path != "/") {
		return "", errors.New("invalid Vault HTTPS address")
	}
	device := cfg.VaultAuditDevice
	if device == "" || len(device) > 256 || strings.ContainsAny(device, "?#\r\n") {
		return "", errors.New("invalid Vault audit device")
	}
	for _, part := range strings.Split(device, "/") {
		if part == "." || part == ".." {
			return "", errors.New("invalid Vault audit device")
		}
	}
	token, err := environmentToken(d, cfg.VaultTokenEnv, "VAULT_TOKEN")
	if err != nil {
		return "", err
	}
	body, _ := json.Marshal(struct {
		Input string `json:"input"`
	}{key})
	var response struct {
		Data struct {
			Hash string `json:"hash"`
		} `json:"data"`
	}
	endpoint := address.Scheme + "://" + address.Host + "/v1/sys/audit-hash/" + url.PathEscape(device)
	if err := requestJSON(ctx, d, "POST", endpoint, "X-Vault-Token", token, string(body), &response); err != nil {
		return "", err
	}
	if !auditHMACPattern.MatchString(response.Data.Hash) {
		return "", errors.New("invalid Vault audit hash response")
	}
	return response.Data.Hash, nil
}
func enrichVault(ctx context.Context, events []trailEvent, cfg Config, d dependencies, r *Result) {
	status := SourceStatus{Source: "vault", Status: "skipped", Detail: "No local Vault audit JSONL file configured."}
	if cfg.VaultAuditPath == "" {
		r.Sources = append(r.Sources, status)
		return
	}
	// Check before opening to reject FIFOs/devices, then verify the opened object.
	// No credential-bearing audit lines are returned or written to another file.
	info, err := os.Stat(cfg.VaultAuditPath)
	if err != nil || !info.Mode().IsRegular() || info.Size() > maxAuditBytes {
		status.Status = "unavailable"
		status.Detail = "Vault audit file unavailable, non-regular, or larger than 64 MiB."
		r.Sources = append(r.Sources, status)
		return
	}
	file, err := os.Open(cfg.VaultAuditPath)
	if err != nil {
		status.Status = "unavailable"
		status.Detail = "Vault audit file could not be opened."
		r.Sources = append(r.Sources, status)
		return
	}
	defer file.Close()
	info, err = file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > maxAuditBytes {
		status.Status = "unavailable"
		status.Detail = "Vault audit file changed or exceeds the file limit."
		r.Sources = append(r.Sources, status)
		return
	}
	keys := []string{}
	lastSeen := map[string]time.Time{}
	for _, e := range events {
		key := e.Identity.Key
		if key == "" {
			continue
		}
		at, _ := time.Parse(time.RFC3339Nano, e.Time)
		prior, exists := lastSeen[key]
		if !exists {
			keys = append(keys, key)
		}
		if at.After(prior) {
			lastSeen[key] = at
		}
	}
	status.Status = "complete"
	status.Detail = "Bounded local AWS credential-response audit scan complete; a broker identity is not proof of a human operator."
	if len(keys) == 0 {
		status.Status = "unavailable"
		status.Detail = "No event-recorded access-key IDs available for exact Vault matching."
		r.Sources = append(r.Sources, status)
		return
	}
	hashes := map[string]string{}
	hashesAttempted := false
	partial := false
	seen := map[string]bool{}
	limit := &io.LimitedReader{R: file, N: maxAuditBytes + 1}
	scanner := bufio.NewScanner(limit)
	scanner.Buffer(make([]byte, 64<<10), maxEventBytes)
	for scanner.Scan() {
		if ctx.Err() != nil {
			partial = true
			status.Detail = "Vault audit scan cancelled or deadline exceeded."
			break
		}
		if limit.N <= 0 {
			partial = true
			status.Detail = "Vault audit file grew beyond 64 MiB; scan is incomplete."
			break
		}
		line := scanner.Bytes()
		if len(strings.TrimSpace(string(line))) == 0 {
			continue
		}
		var audit auditRecord
		if json.Unmarshal(line, &audit) != nil {
			partial = true
			status.Detail = "Some Vault audit lines were invalid and omitted."
			continue
		}
		status.Events++
		if !audit.successfulAWS() {
			continue
		}
		issued := audit.Response.Data.AccessKey
		if auditHMACPattern.MatchString(issued) && !hashesAttempted {
			hashesAttempted = true
			for i, key := range keys {
				if i >= 32 {
					partial = true
					status.Detail = "Vault hash lookup limit reached; scan is incomplete."
					break
				}
				digest, err := vaultHash(ctx, key, cfg, d)
				status.Pages++
				if err != nil {
					partial = true
					status.Detail = "Vault audit HMAC comparison unavailable (HTTPS address, device, token, permission or transport)."
					continue
				}
				hashes[digest] = key
			}
		}
		key := issued
		method := "exact-issued-access-key"
		if auditHMACPattern.MatchString(issued) {
			key = hashes[issued]
			method = "audit-hmac-issued-access-key"
		}
		observed, exists := lastSeen[key]
		if !exists {
			continue
		}
		issuedAt, _ := time.Parse(time.RFC3339Nano, audit.Time)
		if issuedAt.After(observed) {
			continue
		}
		dedup := audit.Request.ID + "\x00" + key + "\x00" + audit.Auth.EntityID
		if seen[dedup] {
			continue
		}
		seen[dedup] = true
		if len(seen) > maxCandidates {
			partial = true
			status.Detail = "Vault candidate limit reached; scan is incomplete."
			break
		}
		agent := ""
		for name, values := range audit.Request.Headers {
			if strings.EqualFold(name, "user-agent") {
				agent = strings.Join(values, "; ")
				break
			}
		}
		r.Evidence = append(r.Evidence, Evidence{Source: "vault", Method: method, NodeKey: key, SubjectID: audit.Auth.EntityID, Description: "Exact successful AWS credential response attributed to the recorded authenticated Vault entity; broker identities can be shared or workloads, not proof of a human operator. Request " + audit.Request.ID + "; credential path " + audit.Request.Path + ".", ObservedAt: audit.Time, Initiator: &Initiator{IP: audit.Request.Remote, UserAgent: agent, Time: audit.Time, EventID: audit.Request.ID}})
	}
	if scanner.Err() != nil {
		partial = true
		status.Detail = "Vault audit scan failed or encountered an oversized line; scan is incomplete."
	}
	if len(seen) > 0 {
		status.Status = "candidate"
	}
	if partial {
		status.Status = "partial"
	}
	r.Sources = append(r.Sources, status)
}
