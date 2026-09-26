// Package attribution acquires scoped attribution evidence. It does not decide
// whether a candidate issuance is a valid lineage edge or prove a human operator.
package attribution

import (
	"context"
	"time"
)

type Config struct {
	AWSProfile           string              `json:"awsProfile"`
	AWSRegions           []string            `json:"awsRegions"`
	IdentityCenterRegion string              `json:"identityCenterRegion"`
	EntraTenantID        string              `json:"entraTenantId"`
	EntraTokenEnv        string              `json:"entraTokenEnv"`
	EntraMappings        []FederationMapping `json:"entraMappings"`
	VaultAddress         string              `json:"vaultAddress"`
	VaultTokenEnv        string              `json:"vaultTokenEnv"`
	VaultAuditPath       string              `json:"vaultAuditPath"`
	VaultAuditDevice     string              `json:"vaultAuditDevice"`
}

type FederationMapping struct {
	RoleARN    string `json:"roleArn"`
	ValidFrom  string `json:"validFrom"`
	ValidTo    string `json:"validTo"`
	VerifiedAt string `json:"verifiedAt"`
	Note       string `json:"note"`
}

type Result struct {
	FetchedAt string         `json:"fetchedAt"`
	Sources   []SourceStatus `json:"sources"`
	Evidence  []Evidence     `json:"evidence"`
	Records   []Record       `json:"records"`
}

type SourceStatus struct {
	Source    string `json:"source"`
	Status    string `json:"status"`
	Detail    string `json:"detail"`
	AccountID string `json:"accountId"`
	Region    string `json:"region"`
	From      string `json:"from"`
	To        string `json:"to"`
	Events    int    `json:"events"`
	Pages     int    `json:"pages"`
}

type Evidence struct {
	Source      string     `json:"source"`
	Method      string     `json:"method"`
	NodeKey     string     `json:"nodeKey"`
	SubjectID   string     `json:"subjectId"`
	DisplayName string     `json:"displayName"`
	UserName    string     `json:"userName"`
	Email       string     `json:"email"`
	Description string     `json:"description"`
	ObservedAt  string     `json:"observedAt"`
	Initiator   *Initiator `json:"initiator,omitempty"`
}

type Initiator struct {
	IP        string `json:"ip"`
	UserAgent string `json:"userAgent"`
	Time      string `json:"time"`
	EventID   string `json:"eventId"`
	Region    string `json:"region"`
	MFA       string `json:"mfa"`
}

type Record struct {
	ID        string `json:"id"`
	Raw       string `json:"raw"`
	Source    string `json:"source"`
	AccountID string `json:"accountId"`
	Region    string `json:"region"`
	FetchedAt string `json:"fetchedAt"`
}

func emptyResult(now time.Time) Result {
	return Result{FetchedAt: now.UTC().Format(time.RFC3339Nano), Sources: []SourceStatus{}, Evidence: []Evidence{}, Records: []Record{}}
}

// Resolve is an explicit, read-only network enrichment request. Config contains
// environment variable names, never token values. Source failures are reported in
// Sources; invalid input and caller cancellation also return a safe generic error.
func Resolve(ctx context.Context, seed string, local []string, cfg Config) (Result, error) {
	return resolveWith(ctx, seed, local, cfg, productionDependencies())
}
