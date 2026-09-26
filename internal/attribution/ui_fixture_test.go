package attribution

import (
	"cloudmon/internal/store"
	"context"
	"encoding/json"
	"fmt"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/cloudtrail"
	"github.com/aws/aws-sdk-go-v2/service/identitystore"
	idTypes "github.com/aws/aws-sdk-go-v2/service/identitystore/types"
	"github.com/aws/aws-sdk-go-v2/service/sts"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type fixtureIdentity struct{}

func (fixtureIdentity) DescribeUser(_ context.Context, in *identitystore.DescribeUserInput, _ ...func(*identitystore.Options)) (*identitystore.DescribeUserOutput, error) {
	return &identitystore.DescribeUserOutput{UserId: in.UserId, IdentityStoreId: in.IdentityStoreId, DisplayName: aws.String("Alice Chen"), UserName: aws.String("alice.chen@example.com"), Emails: []idTypes.Email{{Value: aws.String("alice.chen@example.com"), Primary: true}}}, nil
}

type fixtureAccount struct{}

func (fixtureAccount) GetCallerIdentity(context.Context, *sts.GetCallerIdentityInput, ...func(*sts.Options)) (*sts.GetCallerIdentityOutput, error) {
	return &sts.GetCallerIdentityOutput{Account: aws.String("111122223333")}, nil
}

// Optional artifact generation exercises the real adapter + strict native store,
// with synthetic AWS API responses. It performs no authenticated/provider calls.
func TestAttributionUIFixture(t *testing.T) {
	dir := os.Getenv("CLOUDMON_ATTRIBUTION_FIXTURE_DIR")
	if dir == "" {
		t.Skip("optional UI artifact generation")
	}
	data, err := os.ReadFile(filepath.Join(dir, "fixture.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Seed     json.RawMessage `json:"seed"`
		Issued   json.RawMessage `json:"issued"`
		Settings Config          `json:"settings"`
	}
	if err = json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	ct := &fakeCT{fn: func(*cloudtrail.LookupEventsInput) (*cloudtrail.LookupEventsOutput, error) {
		return ctPage(string(fixture.Issued)), nil
	}}
	deps := testDeps(ct)
	deps.aws = func(context.Context, string, string) (awsClients, error) {
		return awsClients{cloudtrail: ct, sts: fixtureAccount{}, identity: fixtureIdentity{}}, nil
	}
	result, err := resolveWith(context.Background(), string(fixture.Seed), nil, fixture.Settings, deps)
	if err != nil {
		t.Fatal(err)
	}
	db := store.New(filepath.Join(t.TempDir(), "fixture.duckdb"))
	defer db.Close()
	if err = db.Open(); err != nil {
		t.Fatal(err)
	}
	records := []string{}
	var base map[string]json.RawMessage
	if err = json.Unmarshal(fixture.Seed, &base); err != nil {
		t.Fatal(err)
	}
	var stamp string
	json.Unmarshal(base["eventTime"], &stamp)
	at, err := time.Parse(time.RFC3339, stamp)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 30; i++ {
		base["eventID"], _ = json.Marshal(fmt.Sprintf("synthetic-use-%d", i))
		base["eventTime"], _ = json.Marshal(at.Add(-time.Duration(i) * 3 * time.Second).Format(time.RFC3339))
		raw, _ := json.Marshal(base)
		records = append(records, string(raw))
	}
	if _, err = db.IngestReader(strings.NewReader("["+strings.Join(records, ",")+"]"), "synthetic-attribution"); err != nil {
		t.Fatal(err)
	}
	snapshot, err := db.SnapshotContext(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	local, err := db.LineageGraph(30, snapshot)
	if err != nil {
		t.Fatal(err)
	}
	raw := []string{}
	for _, record := range result.Records {
		raw = append(raw, record.Raw)
	}
	overlay, err := db.HistoricalLineage(30, snapshot, raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(overlay.Graph.Edges) != 1 || overlay.Graph.Edges[0].ViaIP != "198.51.100.24" || len(result.Evidence) != 3 {
		t.Fatalf("actual native correlation or evidence missing: graph=%+v result=%+v", overlay.Graph, result)
	}
	output := map[string]any{"local": local, "report": map[string]any{"result": result, "graph": overlay.Graph, "raw": overlay.Raw, "cached": false}}
	encoded, err := json.MarshalIndent(output, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(dir, "native-result.json"), encoded, 0600); err != nil {
		t.Fatal(err)
	}
}
