package attribution

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/url"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws/arn"
)

const graphURL = "https://graph.microsoft.com/v1.0"

func mappedSession(e trailEvent, cfg Config, now time.Time) (string, *FederationMapping) {
	a, err := arn.Parse(e.Identity.ARN)
	if err != nil || a.Service != "sts" || !strings.HasPrefix(a.Resource, "assumed-role/") {
		return "", nil
	}
	parts := strings.Split(a.Resource, "/")
	if len(parts) < 3 || parts[len(parts)-1] == "" {
		return "", nil
	}
	eventTime, err := time.Parse(time.RFC3339Nano, e.Time)
	if err != nil {
		return "", nil
	}
	for i := range cfg.EntraMappings {
		m := &cfg.EntraMappings[i]
		if m.RoleARN == "" || m.RoleARN != e.Identity.Session.Issuer.ARN {
			continue
		}
		start, e1 := time.Parse(time.RFC3339Nano, m.ValidFrom)
		end, e2 := time.Parse(time.RFC3339Nano, m.ValidTo)
		attested, e3 := time.Parse(time.RFC3339Nano, m.VerifiedAt)
		if e1 != nil || e2 != nil || e3 != nil || !start.Before(end) || attested.After(now) || eventTime.Before(start) || !eventTime.Before(end) {
			continue
		}
		if created := e.Identity.Session.Attributes.Created; created != "" {
			at, err := time.Parse(time.RFC3339Nano, created)
			if err != nil || at.Before(start) || !at.Before(end) {
				continue
			}
		}
		return parts[len(parts)-1], m
	}
	return "", nil
}
func tokenTenant(token string) string {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return ""
	}
	data, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return ""
	}
	var claims struct {
		Tenant string `json:"tid"`
	}
	if json.Unmarshal(data, &claims) != nil {
		return ""
	}
	return claims.Tenant
}
func enrichEntra(ctx context.Context, events []trailEvent, cfg Config, d dependencies, r *Result) {
	status := SourceStatus{Source: "entra", Status: "skipped", Detail: "No applicable operator-attested exact role ARN/event-time mapping; session names alone are not identity evidence."}
	if len(cfg.EntraMappings) > 64 {
		status.Status = "error"
		status.Detail = "Too many federation mappings (maximum 64)."
		r.Sources = append(r.Sources, status)
		return
	}
	type match struct {
		e       trailEvent
		session string
		mapping *FederationMapping
	}
	matches := []match{}
	seen := map[string]bool{}
	for _, e := range events {
		session, mapping := mappedSession(e, cfg, d.now())
		if mapping == nil {
			continue
		}
		key := e.nodeKey() + "\x00" + session
		if seen[key] {
			continue
		}
		seen[key] = true
		matches = append(matches, match{e, session, mapping})
	}
	if len(matches) == 0 {
		r.Sources = append(r.Sources, status)
		return
	}
	if cfg.EntraTenantID == "" {
		status.Status = "unavailable"
		status.Detail = "An explicit Entra tenant binding is required; no directory request was made."
		r.Sources = append(r.Sources, status)
		return
	}
	token, err := environmentToken(d, cfg.EntraTokenEnv, "CLOUDMON_ENTRA_TOKEN")
	if err != nil {
		status.Status = "unavailable"
		status.Detail = "Entra token environment variable is unset or invalid."
		r.Sources = append(r.Sources, status)
		return
	}
	// A tid decoded here is NOT independently verified. The *same* bearer token
	// must also be accepted by Graph before any candidate evidence is emitted.
	tid := tokenTenant(token)
	if tid != "" && !strings.EqualFold(tid, cfg.EntraTenantID) {
		status.Status = "error"
		status.Detail = "Graph token tenant does not match the configured Entra tenant."
		r.Sources = append(r.Sources, status)
		return
	}
	if tid == "" {
		var org struct {
			Value []struct {
				ID string `json:"id"`
			} `json:"value"`
		}
		status.Pages++
		err := requestJSON(ctx, d, "GET", graphURL+"/organization?$select=id", "Authorization", "Bearer "+token, "", &org)
		bound := false
		for _, v := range org.Value {
			if strings.EqualFold(v.ID, cfg.EntraTenantID) {
				bound = true
			}
		}
		if err != nil || !bound {
			status.Status = "unavailable"
			status.Detail = "Graph organization lookup could not establish the configured tenant binding (permission, token or tenant mismatch)."
			r.Sources = append(r.Sources, status)
			return
		}
	}
	type user struct {
		ID          string `json:"id"`
		DisplayName string `json:"displayName"`
		UserName    string `json:"userPrincipalName"`
		Mail        string `json:"mail"`
	}
	cache := map[string]*user{}
	failures := 0
	for _, match := range matches {
		u, ok := cache[match.session]
		if !ok {
			if len(cache) >= 32 || ctx.Err() != nil {
				failures++
				status.Detail = "Entra lookup limit or deadline reached; enrichment is incomplete."
				break
			}
			value := &user{}
			status.Pages++
			err := requestJSON(ctx, d, "GET", graphURL+"/users/"+url.PathEscape(match.session)+"?$select=id,displayName,userPrincipalName,mail", "Authorization", "Bearer "+token, "", value)
			if err == nil && value.ID != "" {
				u = value
			}
			cache[match.session] = u
		}
		if u == nil {
			failures++
			status.Detail = "Graph user unavailable (permission, deleted user, token or transport); no identity was inferred."
			continue
		}
		m := match.mapping
		description := "Directory candidate based on operator attestation, not automatically verified federation trust or proof of a human operator. Exact role " + m.RoleARN + "; valid [" + m.ValidFrom + ", " + m.ValidTo + "); attested " + m.VerifiedAt + ". Current directory metadata may differ from event-time attributes."
		// Do not copy freeform notes into evidence: an operator could accidentally put
		// secret material there. The original non-secret mapping is kept in Config.
		r.Evidence = append(r.Evidence, Evidence{Source: "entra", Method: "operator-attested-role-session-mapping", NodeKey: match.e.nodeKey(), SubjectID: cfg.EntraTenantID + "/" + u.ID, DisplayName: u.DisplayName, UserName: u.UserName, Email: u.Mail, Description: description, ObservedAt: r.FetchedAt, Initiator: match.e.initiator()})
		status.Events++
	}
	if status.Events > 0 {
		status.Status = "candidate"
		if failures > 0 {
			status.Status = "partial"
		} else {
			status.Detail = "Tenant-bound Graph directory candidates; role/session-name mapping is operator attestation, not automatically verified trust."
		}
	} else {
		status.Status = "unavailable"
	}
	r.Sources = append(r.Sources, status)
}
