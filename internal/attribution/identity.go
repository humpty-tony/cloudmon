package attribution

import (
	"context"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/aws/arn"
	"github.com/aws/aws-sdk-go-v2/service/identitystore"
)

type identityAPI interface {
	DescribeUser(context.Context, *identitystore.DescribeUserInput, ...func(*identitystore.Options)) (*identitystore.DescribeUserOutput, error)
}

func identityStoreID(value string) string {
	a, err := arn.Parse(value)
	if err != nil || a.Service != "identitystore" || !strings.HasPrefix(a.Resource, "identitystore/") {
		return ""
	}
	id := strings.TrimPrefix(a.Resource, "identitystore/")
	if id == "" || len(id) > 128 || strings.ContainsAny(id, "/?# \t\r\n") {
		return ""
	}
	return id
}
func enrichIdentity(ctx context.Context, events []trailEvent, cfg Config, d dependencies, r *Result) {
	status := SourceStatus{Source: "identity-center", Status: "unavailable", Region: cfg.IdentityCenterRegion, Detail: "No event-recorded onBehalfOf store/user identifiers; role names and identity types are not attribution."}
	type lookup struct {
		user *identitystore.DescribeUserOutput
		ok   bool
	}
	cache := map[string]lookup{}
	seen := map[string]bool{}
	var client identityAPI
	failures, successes := 0, 0
	for _, e := range events {
		behalf := e.Identity.OnBehalfOf
		if behalf.StoreARN == "" || behalf.UserID == "" {
			continue
		}
		store := identityStoreID(behalf.StoreARN)
		if store == "" {
			failures++
			status.Detail = "Invalid event-recorded Identity Store ARN; no inferred identifier was substituted."
			continue
		}
		if cfg.IdentityCenterRegion == "" {
			status.Detail = "Configure the Identity Center home Region to resolve event-recorded immutable user IDs."
			failures++
			break
		}
		key := behalf.StoreARN + "\x00" + behalf.UserID
		if seen[key+"\x00"+e.nodeKey()] {
			continue
		}
		seen[key+"\x00"+e.nodeKey()] = true
		hit, cached := cache[key]
		if !cached {
			if len(cache) >= 32 {
				failures++
				status.Detail = "Identity Center lookup limit reached; directory enrichment is incomplete."
				break
			}
			if ctx.Err() != nil {
				failures++
				status.Detail = "Identity Center lookup cancelled or deadline exceeded."
				break
			}
			if client == nil {
				clients, err := d.aws(ctx, cfg.AWSProfile, cfg.IdentityCenterRegion)
				if err != nil || clients.identity == nil {
					failures++
					status.Detail = "Identity Center AWS configuration/credentials unavailable."
					break
				}
				client = clients.identity
			}
			user, err := client.DescribeUser(ctx, &identitystore.DescribeUserInput{IdentityStoreId: aws.String(store), UserId: aws.String(behalf.UserID)})
			status.Pages++
			hit = lookup{user: user, ok: err == nil && user != nil && aws.ToString(user.UserId) == behalf.UserID && (aws.ToString(user.IdentityStoreId) == "" || aws.ToString(user.IdentityStoreId) == store)}
			cache[key] = hit
		}
		if !hit.ok {
			failures++
			status.Detail = "Identity Center DescribeUser unavailable (permission, deleted user, credentials or transport); no identity was inferred."
			continue
		}
		user := hit.user
		email := ""
		for _, v := range user.Emails {
			if email == "" || v.Primary {
				email = aws.ToString(v.Value)
			}
			if v.Primary {
				break
			}
		}
		r.Evidence = append(r.Evidence, Evidence{Source: "identity-center", Method: "event-recorded-store-user-id", NodeKey: e.nodeKey(), SubjectID: behalf.StoreARN + "/user/" + behalf.UserID, DisplayName: aws.ToString(user.DisplayName), UserName: aws.ToString(user.UserName), Email: email, ObservedAt: r.FetchedAt, Description: "Current directory metadata for exact event-recorded Identity Store/user IDs; not an event-time name snapshot and not proof of a human operator.", Initiator: e.initiator()})
		successes++
		status.Events++
	}
	if successes > 0 {
		status.Status = "complete"
		if failures > 0 {
			status.Status = "partial"
		} else {
			status.Detail = "Exact event-recorded store/user IDs resolved; current directory metadata, not proof of who operated the credentials."
		}
	}
	r.Sources = append(r.Sources, status)
}
