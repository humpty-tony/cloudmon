package attribution

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/service/cloudtrail"
	"github.com/aws/aws-sdk-go-v2/service/sts"
)

const (
	maxEventBytes   = 1 << 20
	maxInputBytes   = 8 << 20
	maxWindowBytes  = 32 << 20
	maxLocal        = 2048
	maxRegions      = 8
	maxPages        = 20 // per region; the shared deadline also bounds the whole request
	maxDepth        = 12
	maxCandidates   = 512 // parent isolated overlay bound
	maxWindowEvents = 4096
	resolveTimeout  = 60 * time.Second
)

var regionPattern = regexp.MustCompile(`^[a-z]{2}(-[a-z]+){1,3}-[0-9]{1,2}$`)

// Shared by retrieval planning and candidate parsing; do not infer a method
// from a role label or omit less common temporary-credential issuance APIs.
var supportedIssuanceAPIs = [...]string{"AssumeRole", "AssumeRoleWithSAML", "AssumeRoleWithWebIdentity", "AssumeRoot", "GetSessionToken", "GetFederationToken"}

type cloudtrailAPI interface {
	LookupEvents(context.Context, *cloudtrail.LookupEventsInput, ...func(*cloudtrail.Options)) (*cloudtrail.LookupEventsOutput, error)
}
type stsAPI interface {
	GetCallerIdentity(context.Context, *sts.GetCallerIdentityInput, ...func(*sts.Options)) (*sts.GetCallerIdentityOutput, error)
}
type awsClients struct {
	cloudtrail cloudtrailAPI
	sts        stsAPI
	identity   identityAPI
}
type dependencies struct {
	now       func() time.Time
	aws       func(context.Context, string, string) (awsClients, error)
	wait      func(context.Context, string) error
	http      *http.Client
	getenv    func(string) string
	allowHTTP bool // private; only injected test clients may use loopback HTTP
}

type trailEvent struct {
	ID           string `json:"eventID"`
	Time         string `json:"eventTime"`
	Source       string `json:"eventSource"`
	Name         string `json:"eventName"`
	Region       string `json:"awsRegion"`
	Account      string `json:"recipientAccountId"`
	IP           string `json:"sourceIPAddress"`
	UserAgent    string `json:"userAgent"`
	ErrorCode    string `json:"errorCode"`
	ErrorMessage string `json:"errorMessage"`
	Identity     struct {
		Key        string `json:"accessKeyId"`
		ARN        string `json:"arn"`
		Principal  string `json:"principalId"`
		OnBehalfOf struct {
			UserID   string `json:"userId"`
			StoreARN string `json:"identityStoreArn"`
		} `json:"onBehalfOf"`
		Session struct {
			SourceIdentity string `json:"sourceIdentity"`
			Issuer         struct {
				ARN string `json:"arn"`
			} `json:"sessionIssuer"`
			Attributes struct {
				MFA     string `json:"mfaAuthenticated"`
				Created string `json:"creationDate"`
			} `json:"attributes"`
		} `json:"sessionContext"`
	} `json:"userIdentity"`
	Response struct {
		Credentials struct {
			Key string `json:"accessKeyId"`
		} `json:"credentials"`
	} `json:"responseElements"`
	raw     string
	remote  bool
	account string
	region  string
}

func parseEvent(raw string) (trailEvent, error) {
	var e trailEvent
	if len(raw) > maxEventBytes || len(raw) == 0 || strings.TrimSpace(raw) == "null" {
		return e, errors.New("invalid or oversized CloudTrail JSON")
	}
	if json.Unmarshal([]byte(raw), &e) != nil {
		return e, errors.New("invalid CloudTrail JSON")
	}
	if _, err := time.Parse(time.RFC3339Nano, e.Time); err != nil {
		return e, errors.New("CloudTrail eventTime is missing or invalid")
	}
	e.raw = raw
	return e, nil
}
func (e trailEvent) issuedKey() string {
	if e.Source != "sts.amazonaws.com" || e.ErrorCode != "" || e.ErrorMessage != "" {
		return ""
	}
	for _, name := range supportedIssuanceAPIs {
		if e.Name == name {
			return e.Response.Credentials.Key
		}
	}
	return ""
}
func (e trailEvent) nodeKey() string {
	if e.Identity.Key != "" {
		return e.Identity.Key
	}
	if e.ID != "" {
		return "event:" + e.ID
	}
	return "record:" + rawID(e.raw)
}
func (e trailEvent) initiator() *Initiator {
	return &Initiator{IP: e.IP, UserAgent: e.UserAgent, Time: e.Time, EventID: e.ID, Region: e.Region, MFA: e.Identity.Session.Attributes.MFA}
}
func rawID(raw string) string { sum := sha256.Sum256([]byte(raw)); return hex.EncodeToString(sum[:]) }
func regionsFor(cfg Config, seed trailEvent) ([]string, error) {
	regions := cfg.AWSRegions
	if len(regions) == 0 {
		regions = []string{"us-east-1"}
		if seed.Region != "" && seed.Region != "us-east-1" {
			regions = append([]string{seed.Region}, regions...)
		}
	}
	if len(regions) > maxRegions {
		return nil, errors.New("at most eight AWS Regions may be queried")
	}
	out := []string{}
	seen := map[string]bool{}
	for _, region := range regions {
		if !regionPattern.MatchString(region) {
			return nil, errors.New("invalid AWS Region")
		}
		if !seen[region] {
			out = append(out, region)
			seen[region] = true
		}
	}
	if cfg.IdentityCenterRegion != "" && !regionPattern.MatchString(cfg.IdentityCenterRegion) {
		return nil, errors.New("invalid Identity Center Region")
	}
	return out, nil
}

func resolveWith(parent context.Context, raw string, local []string, cfg Config, d dependencies) (Result, error) {
	now := d.now()
	r := emptyResult(now)
	seed, err := parseEvent(raw)
	if err != nil {
		return r, err
	}
	regions, err := regionsFor(cfg, seed)
	if err != nil {
		return r, err
	}
	if len(local) > maxLocal {
		return r, errors.New("too many local attribution records")
	}
	ctx, cancel := context.WithTimeout(parent, resolveTimeout)
	defer cancel()
	events := []trailEvent{seed}
	total := len(raw)
	for _, s := range local {
		total += len(s)
		if total > maxInputBytes {
			return r, errors.New("local attribution input exceeds size limit")
		}
		e, err := parseEvent(s)
		if err != nil {
			return r, errors.New("invalid local CloudTrail record")
		}
		events = append(events, e)
	}
	if err := ctx.Err(); err != nil {
		return r, err
	}
	fetched := fetchCloudTrail(ctx, seed, events, regions, cfg, d, &r)
	all := append(append([]trailEvent{}, events...), fetched...)
	selected, truncated := selectAncestors(events, all)
	if truncated {
		r.Sources = append(r.Sources, SourceStatus{Source: "cloudtrail", Status: "partial", Detail: "Candidate ancestry depth or count limit reached; strict lineage validation is still required."})
	}
	relevant := append([]trailEvent{}, events...)
	for _, e := range selected {
		relevant = append(relevant, e)
		if !e.remote {
			continue
		}
		id := e.ID
		if id == "" {
			id = rawID(e.raw)
		}
		r.Records = append(r.Records, Record{ID: id, Raw: e.raw, Source: "cloudtrail", AccountID: e.account, Region: e.region, FetchedAt: r.FetchedAt})
		r.Evidence = append(r.Evidence, Evidence{Source: "cloudtrail", Method: "issued-access-key-candidate", NodeKey: e.issuedKey(), SubjectID: e.Identity.Principal, Description: "Exact issued access-key candidate; validate ordering, expiration, caller consistency and ambiguity in the strict lineage resolver. Not proof of a human operator.", ObservedAt: e.Time, Initiator: e.initiator()})
	}
	for i := range r.Sources {
		if r.Sources[i].Source == "cloudtrail" && r.Sources[i].Status == "complete" {
			for _, rec := range r.Records {
				if rec.AccountID == r.Sources[i].AccountID && rec.Region == r.Sources[i].Region {
					r.Sources[i].Status = "candidate"
					break
				}
			}
		}
	}
	seenSourceIdentity := map[string]bool{}
	for _, event := range relevant {
		value := event.Identity.Session.SourceIdentity
		key := event.nodeKey() + "\x00" + value
		if value == "" || seenSourceIdentity[key] {
			continue
		}
		seenSourceIdentity[key] = true
		r.Evidence = append(r.Evidence, Evidence{Source: "source-identity", Method: "recorded-attribute", NodeKey: event.nodeKey(), SubjectID: value, DisplayName: value, ObservedAt: event.Time, Description: "Recorded source identity; assurance depends on issuer policy. This is not directory verification or proof of a human operator."})
	}
	enrichIdentity(ctx, relevant, cfg, d, &r)
	enrichEntra(ctx, relevant, cfg, d, &r)
	enrichVault(ctx, relevant, cfg, d, &r)
	if err := parent.Err(); err != nil {
		return r, err
	}
	return r, nil
}

// Candidate collection deliberately leaves temporal/role/ambiguity validation to
// the parent strict resolver. It must retain competing observations verbatim.
func selectAncestors(roots, all []trailEvent) ([]trailEvent, bool) {
	index := map[string][]trailEvent{}
	for _, e := range all {
		if k := e.issuedKey(); k != "" {
			index[k] = append(index[k], e)
		}
	}
	frontier := []string{}
	seenKeys := map[string]bool{}
	for _, e := range roots {
		if e.Identity.Key != "" && !seenKeys[e.Identity.Key] {
			seenKeys[e.Identity.Key] = true
			frontier = append(frontier, e.Identity.Key)
		}
	}
	out := []trailEvent{}
	seenRaw := map[string]bool{}
	for depth := 0; depth < maxDepth && len(frontier) > 0; depth++ {
		next := []string{}
		for _, key := range frontier {
			for _, e := range index[key] {
				hash := rawID(e.raw)
				if seenRaw[hash] {
					continue
				}
				seenRaw[hash] = true
				if len(out) >= maxCandidates {
					return out, true
				}
				out = append(out, e)
				p := e.Identity.Key
				if p != "" && !seenKeys[p] {
					seenKeys[p] = true
					next = append(next, p)
				}
			}
		}
		frontier = next
	}
	for _, key := range frontier {
		if len(index[key]) > 0 {
			return out, true
		}
	}
	return out, false
}
