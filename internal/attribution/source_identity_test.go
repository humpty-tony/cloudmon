package attribution

import (
	"context"
	"strings"
	"testing"
)

func TestRecordedSourceIdentityIsNotDirectoryProof(t *testing.T) {
	seed := strings.Replace(strings.Replace(testSeed, "2026-09-25", "2025-09-25", 1), `"sessionContext":{`, `"sessionContext":{"sourceIdentity":"recorded@example.test",`, 1)
	r, err := resolveWith(context.Background(), seed, []string{seed}, Config{}, testDeps(nil))
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, e := range r.Evidence {
		if e.Source == "source-identity" {
			count++
			if e.SubjectID != "recorded@example.test" || e.NodeKey != "ASIAchild" || !strings.Contains(e.Description, "not directory verification") {
				t.Fatalf("misleading source identity: %+v", e)
			}
		}
	}
	if count != 1 {
		t.Fatalf("recorded source identity missing or duplicated: %d", count)
	}
}
