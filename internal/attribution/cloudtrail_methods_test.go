package attribution

import (
	"strings"
	"testing"
)

func TestEveryCredentialMethodRejectsFailedOrMissingIssuance(t *testing.T) {
	for _, method := range issuanceMethodsForTest {
		t.Run(method, func(t *testing.T) {
			raw := strings.Replace(issuance("candidate", "ASIAchild", "AKIAroot"), "AssumeRole", method, 1)
			e, err := parseEvent(raw)
			if err != nil || e.issuedKey() != "ASIAchild" {
				t.Fatal("valid credential method rejected")
			}
			for _, bad := range []string{"denied", "error-message", "wrong-service", "missing-key", "unsupported-api"} {
				t.Run(bad, func(t *testing.T) {
					candidate := e
					switch bad {
					case "denied":
						candidate.ErrorCode = "AccessDenied"
					case "error-message":
						candidate.ErrorMessage = "denied"
					case "wrong-service":
						candidate.Source = "sso.amazonaws.com"
					case "missing-key":
						candidate.Response.Credentials.Key = ""
					case "unsupported-api":
						candidate.Name = "GetCallerIdentity"
					}
					if candidate.issuedKey() != "" {
						t.Fatal("non-issuance accepted")
					}
				})
			}
		})
	}
}
