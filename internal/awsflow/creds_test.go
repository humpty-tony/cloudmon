package awsflow

import (
	"os"
	"path/filepath"
	"testing"
)

func TestListProfiles(t *testing.T) {
	dir := t.TempDir()
	cfg := `[default]
region = us-east-1
aws_access_key_id = AKIADEFAULT

[profile sso-prod]
sso_start_url = https://example.awsapps.com/start
sso_account_id = 123456789012
region = us-west-2

[profile role1]
role_arn = arn:aws:iam::111111111111:role/audit
source_profile = default
region = eu-west-1

[sso-session my-sso]
sso_start_url = https://example.awsapps.com/start
`
	creds := `[keysonly]
aws_access_key_id = AKIAKEYS
aws_secret_access_key = secret
`
	if err := os.WriteFile(filepath.Join(dir, "config"), []byte(cfg), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "credentials"), []byte(creds), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("AWS_CONFIG_FILE", filepath.Join(dir, "config"))

	ps, err := ListProfiles()
	if err != nil {
		t.Fatal(err)
	}
	by := map[string]Profile{}
	for _, p := range ps {
		by[p.Name] = p
	}
	if p, ok := by["default"]; !ok || p.Kind != "keys" || p.Region != "us-east-1" {
		t.Errorf("default = %+v, want keys/us-east-1", p)
	}
	if p, ok := by["sso-prod"]; !ok || p.Kind != "sso" || p.Region != "us-west-2" {
		t.Errorf("sso-prod = %+v, want sso/us-west-2", p)
	}
	if p, ok := by["role1"]; !ok || p.Kind != "assume-role" || p.Region != "eu-west-1" {
		t.Errorf("role1 = %+v, want assume-role/eu-west-1", p)
	}
	if p, ok := by["keysonly"]; !ok || p.Kind != "keys" {
		t.Errorf("keysonly = %+v, want keys", p)
	}
	if _, ok := by["my-sso"]; ok {
		t.Error("sso-session block must NOT be listed as a profile")
	}
}
