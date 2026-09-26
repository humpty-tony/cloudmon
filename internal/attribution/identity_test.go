package attribution

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/cloudtrail"
	"github.com/aws/aws-sdk-go-v2/service/identitystore"
	idTypes "github.com/aws/aws-sdk-go-v2/service/identitystore/types"
)

type fakeIdentity struct {
	calls int
	fail  bool
}

func (f *fakeIdentity) DescribeUser(_ context.Context, in *identitystore.DescribeUserInput, _ ...func(*identitystore.Options)) (*identitystore.DescribeUserOutput, error) {
	f.calls++
	if aws.ToString(in.IdentityStoreId) != "d-1234567890" || aws.ToString(in.UserId) != "11111111-1111-1111-1111-111111111111" {
		panic("wrong immutable identifiers")
	}
	if f.fail {
		return nil, errors.New("denied secret token must not leak")
	}
	return &identitystore.DescribeUserOutput{UserId: in.UserId, IdentityStoreId: in.IdentityStoreId, DisplayName: aws.String("Fixture service identity"), UserName: aws.String("svc-fixture"), Emails: []idTypes.Email{{Value: aws.String("fixture@example.test"), Primary: true}}}, nil
}
func withIdentity(raw string) string {
	return strings.Replace(raw, `"userIdentity":{`, `"userIdentity":{"onBehalfOf":{"userId":"11111111-1111-1111-1111-111111111111","identityStoreArn":"arn:aws:identitystore::123456789012:identitystore/d-1234567890"},`, 1)
}
func sourceStatus(r Result, source string) SourceStatus {
	for _, s := range r.Sources {
		if s.Source == source {
			return s
		}
	}
	return SourceStatus{}
}
func TestIdentityCenterSeedAndAncestorExactIDs(t *testing.T) {
	raw := withIdentity(issuance("a", "ASIAchild", "ASIAparent"))
	ct := &fakeCT{fn: func(*cloudtrail.LookupEventsInput) (*cloudtrail.LookupEventsOutput, error) { return ctPage(raw), nil }}
	id := &fakeIdentity{}
	d := testDeps(ct)
	base := d.aws
	d.aws = func(ctx context.Context, p, r string) (awsClients, error) {
		c, e := base(ctx, p, r)
		c.identity = id
		return c, e
	}
	r, err := resolveWith(context.Background(), withIdentity(testSeed), nil, Config{AWSRegions: []string{"eu-west-1"}, IdentityCenterRegion: "us-east-2"}, d)
	if err != nil || id.calls != 1 {
		t.Fatalf("lookup/cache: %v calls=%d", err, id.calls)
	}
	count := 0
	for _, e := range r.Evidence {
		if e.Source == "identity-center" {
			count++
			if e.UserName != "svc-fixture" || !strings.Contains(e.Description, "not proof of a human") {
				t.Fatalf("unsafe identity: %+v", e)
			}
		}
	}
	if count != 2 || sourceStatus(r, "identity-center").Status != "complete" {
		t.Fatalf("not stacked across nodes: %+v", r)
	}
}
func TestIdentityCenterMissingRegionAndDenied(t *testing.T) {
	for _, home := range []string{"", "us-east-2"} {
		t.Run(home, func(t *testing.T) {
			ct := &fakeCT{fn: func(*cloudtrail.LookupEventsInput) (*cloudtrail.LookupEventsOutput, error) { return ctPage(), nil }}
			id := &fakeIdentity{fail: true}
			d := testDeps(ct)
			base := d.aws
			d.aws = func(ctx context.Context, p, r string) (awsClients, error) {
				c, e := base(ctx, p, r)
				c.identity = id
				return c, e
			}
			r, err := resolveWith(context.Background(), withIdentity(testSeed), nil, Config{AWSRegions: []string{"eu-west-1"}, IdentityCenterRegion: home}, d)
			if err != nil || sourceStatus(r, "identity-center").Status != "unavailable" {
				t.Fatalf("missing honest state: %+v %v", r, err)
			}
			if strings.Contains(sourceStatus(r, "identity-center").Detail, "secret token") {
				t.Fatal("error reflected")
			}
			if home == "" && id.calls != 0 {
				t.Fatal("guessed home region")
			}
		})
	}
}
