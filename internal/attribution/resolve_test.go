package attribution

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestResolveRejectsInvalidInputWithoutEcho(t *testing.T) {
	r, err := Resolve(context.Background(), `{"secretAccessKey":"do-not-reflect"`, nil, Config{})
	if err == nil || strings.Contains(err.Error(), "do-not-reflect") {
		t.Fatalf("unsafe/missing validation: %v", err)
	}
	b, _ := json.Marshal(r)
	for _, field := range []string{`"sources":[]`, `"evidence":[]`, `"records":[]`} {
		if !strings.Contains(string(b), field) {
			t.Fatalf("missing non-null list %s: %s", field, b)
		}
	}
}
