package main

import (
	"cloudmon/internal/attribution"
	"cloudmon/internal/config"
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestDynamicAttributionUsesConnectionAndLocalSSOConfig(t *testing.T) {
	dir := isolateAttributionConfig(t)
	file := filepath.Join(dir, "aws-config")
	if err := os.WriteFile(file, []byte("[profile connected]\nsso_session = work\nsso_account_id = 111122223333\nsso_role_name = Audit\n[sso-session work]\nsso_region = eu-west-1\nsso_start_url = https://example.awsapps.com/start\n[profile chained]\nrole_arn = arn:aws:iam::111122223333:role/IR\nsource_profile = connected\n"), 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("AWS_CONFIG_FILE", file)
	t.Setenv("AWS_SHARED_CREDENTIALS_FILE", filepath.Join(dir, "no-credentials"))
	a := NewApp()
	a.ctx = context.Background()
	if err := a.SaveAttributionSettings(attribution.Config{AWSProfile: "old-lineage-profile"}); err != nil {
		t.Fatal(err)
	}
	for _, profile := range []string{"connected", "chained"} {
		a.cfg = config.ConnectionConfig{Mode: "create-infra", Profile: profile, Region: "us-east-1"}
		got, err := a.GetAttributionSettings()
		if err != nil {
			t.Fatal(err)
		}
		if got.AWSProfile != profile || got.IdentityCenterRegion != "eu-west-1" {
			t.Fatalf("requires separate lineage setup: %+v", got)
		}
	}
	a.cfg = config.ConnectionConfig{}
	a.capProfile = "connected"
	got, err := a.GetAttributionSettings()
	if err != nil || got.AWSProfile != "connected" {
		t.Fatalf("saved capture connection not reused: %+v %v", got, err)
	}
}
