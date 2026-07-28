package awsflow

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/sts"
)

// Profile is a named entry from the local AWS shared config, classified so the UI
// can group it (SSO / assume-role / access keys).
type Profile struct {
	Name   string `json:"name"`
	Kind   string `json:"kind"` // "sso" | "assume-role" | "keys" | "other"
	Region string `json:"region"`
}

// Identity is the confirmed caller, from sts:GetCallerIdentity.
type Identity struct {
	Account string `json:"account"`
	Arn     string `json:"arn"`
	UserID  string `json:"userId"`
	Profile string `json:"profile"`
	Region  string `json:"region"`
}

// awsDir resolves the directory holding the shared config files.
func awsDir() string {
	if v := os.Getenv("AWS_CONFIG_FILE"); v != "" {
		return filepath.Dir(v)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ".aws"
	}
	return filepath.Join(home, ".aws")
}

// ListProfiles enumerates named profiles from ~/.aws/config and ~/.aws/credentials
// (merged, config wins on kind/region), classifying each by the keys it carries.
func ListProfiles() ([]Profile, error) {
	dir := awsDir()
	byName := map[string]*Profile{}
	var order []string
	get := func(name string) *Profile {
		if p, ok := byName[name]; ok {
			return p
		}
		p := &Profile{Name: name, Kind: "other"}
		byName[name] = p
		order = append(order, name)
		return p
	}
	parse := func(path string, isConfig bool) {
		f, err := os.Open(path)
		if err != nil {
			return
		}
		defer f.Close()
		var cur *Profile
		sc := bufio.NewScanner(f)
		for sc.Scan() {
			line := strings.TrimSpace(sc.Text())
			if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, ";") {
				continue
			}
			if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
				name := strings.TrimSpace(line[1 : len(line)-1])
				if isConfig {
					name = strings.TrimSpace(strings.TrimPrefix(name, "profile "))
				}
				if strings.HasPrefix(name, "sso-session ") { // not a profile
					cur = nil
					continue
				}
				cur = get(name)
				continue
			}
			if cur == nil {
				continue
			}
			k, v, ok := strings.Cut(line, "=")
			if !ok {
				continue
			}
			k = strings.ToLower(strings.TrimSpace(k))
			v = strings.TrimSpace(v)
			switch {
			case k == "region":
				if cur.Region == "" {
					cur.Region = v
				}
			case k == "sso_start_url" || k == "sso_session" || k == "sso_account_id":
				cur.Kind = "sso"
			case (k == "role_arn" || k == "source_profile") && cur.Kind != "sso":
				cur.Kind = "assume-role"
			case k == "credential_process" && cur.Kind == "other":
				cur.Kind = "process"
			case k == "aws_access_key_id" && cur.Kind == "other":
				cur.Kind = "keys"
			}
		}
	}
	parse(filepath.Join(dir, "config"), true)
	parse(filepath.Join(dir, "credentials"), false)

	out := make([]Profile, 0, len(order))
	for _, n := range order {
		out = append(out, *byName[n])
	}
	return out, nil
}

// LoadConfig builds an aws.Config for the given profile + region using the standard
// credential chain (SSO, assume-role, and static keys all resolve here).
func LoadConfig(ctx context.Context, profile, region string) (aws.Config, error) {
	opts := []func(*awsconfig.LoadOptions) error{}
	if region != "" {
		opts = append(opts, awsconfig.WithRegion(region))
	}
	if cp := credentialProcess(profile); cp != "" {
		// Resolve the profile's external credential_process OURSELVES with the console
		// window hidden - the SDK's built-in resolver spawns a visible shell every time
		// on a Windows GUI app. Overriding the credentials provider means the SDK never
		// runs the process itself.
		opts = append(opts, awsconfig.WithCredentialsProvider(aws.NewCredentialsCache(&procCredProvider{command: cp})))
	} else if profile != "" {
		opts = append(opts, awsconfig.WithSharedConfigProfile(profile))
	}
	return awsconfig.LoadDefaultConfig(ctx, opts...)
}

// credentialProcess returns the credential_process command configured for a profile
// (in ~/.aws/config or credentials), or "" if the profile doesn't use one.
func credentialProcess(profile string) string {
	if profile == "" {
		return ""
	}
	dir := awsDir()
	find := func(path string, isConfig bool) string {
		f, err := os.Open(path)
		if err != nil {
			return ""
		}
		defer f.Close()
		inTarget := false
		sc := bufio.NewScanner(f)
		for sc.Scan() {
			line := strings.TrimSpace(sc.Text())
			if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, ";") {
				continue
			}
			if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
				name := strings.TrimSpace(line[1 : len(line)-1])
				if isConfig {
					name = strings.TrimSpace(strings.TrimPrefix(name, "profile "))
				}
				inTarget = name == profile
				continue
			}
			if !inTarget {
				continue
			}
			if k, v, ok := strings.Cut(line, "="); ok && strings.ToLower(strings.TrimSpace(k)) == "credential_process" {
				return strings.TrimSpace(v)
			}
		}
		return ""
	}
	if cp := find(filepath.Join(dir, "config"), true); cp != "" {
		return cp
	}
	return find(filepath.Join(dir, "credentials"), false)
}

// procCredProvider runs a credential_process command with its console window hidden
// and parses the standard JSON credential output.
type procCredProvider struct{ command string }

func (p *procCredProvider) Retrieve(ctx context.Context) (aws.Credentials, error) {
	cmd := shellCommand(ctx, p.command)
	var out, errb bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errb
	if err := cmd.Run(); err != nil {
		return aws.Credentials{}, fmt.Errorf("credential_process failed: %v: %s", err, stripANSI(errb.String()))
	}
	var r struct {
		AccessKeyID     string `json:"AccessKeyId"`
		SecretAccessKey string `json:"SecretAccessKey"`
		SessionToken    string `json:"SessionToken"`
		Expiration      string `json:"Expiration"`
	}
	if err := json.Unmarshal(bytes.TrimSpace(out.Bytes()), &r); err != nil {
		return aws.Credentials{}, fmt.Errorf("credential_process output was not valid JSON: %w", err)
	}
	if r.AccessKeyID == "" {
		return aws.Credentials{}, fmt.Errorf("credential_process returned no AccessKeyId")
	}
	c := aws.Credentials{
		AccessKeyID:     r.AccessKeyID,
		SecretAccessKey: r.SecretAccessKey,
		SessionToken:    r.SessionToken,
		Source:          "cloudmon-credential_process",
	}
	if r.Expiration != "" {
		if t, e := time.Parse(time.RFC3339, r.Expiration); e == nil {
			c.CanExpire = true
			c.Expires = t
		}
	}
	return c, nil
}

var ansiRE = regexp.MustCompile("\x1b\\[[0-9;?]*[ -/]*[@-~]")

// stripANSI removes terminal color/escape codes so helper output (e.g. Granted's
// coloured error) reads cleanly in the UI.
func stripANSI(s string) string { return strings.TrimSpace(ansiRE.ReplaceAllString(s, "")) }

// safeWorkingDir returns a real (non-UNC) working directory. cmd.exe refuses to run
// with a UNC working directory (\\server\share\...) and warns to stderr, so handing
// child shells the user's home dir keeps credential helpers working regardless of
// where the executable itself was launched from.
func safeWorkingDir() string {
	if h, err := os.UserHomeDir(); err == nil && h != "" {
		return h
	}
	return os.TempDir()
}

// shellCommand builds a hidden-window shell invocation for a command string, with a
// safe (non-UNC) working directory.
func shellCommand(ctx context.Context, command string) *exec.Cmd {
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.CommandContext(ctx, "cmd", "/c", command)
	} else {
		cmd = exec.CommandContext(ctx, "sh", "-c", command)
	}
	cmd.Dir = safeWorkingDir()
	hideWindow(cmd)
	return cmd
}

// RunLoginCommand runs an SSO-login command with its console hidden - whatever the
// credential helper told the user to run (e.g. `granted sso login …`, `aws sso login
// --profile …`). It opens the browser and blocks until the flow completes.
func RunLoginCommand(ctx context.Context, command string) error {
	command = strings.TrimSpace(command)
	if command == "" {
		return fmt.Errorf("no login command to run")
	}
	// Run WITHOUT a shell: split to argv and exec directly. The command string is
	// partly derived from credential-helper/STS error text, so any shell metacharacters
	// in it (`;`, `|`, `$(…)`, …) must never be interpreted - passed as literal argv
	// they are just flags the login tool rejects. Require a recognized login tool as
	// argv[0] too (defence in depth at the exec boundary, since this is a bound method).
	args := strings.Fields(command)
	if len(args) == 0 {
		return fmt.Errorf("no login command to run")
	}
	if !allowedLoginTool(args[0]) {
		return fmt.Errorf("refusing to run %q: not a recognized SSO login command", command)
	}
	cmd := exec.CommandContext(ctx, args[0], args[1:]...)
	cmd.Dir = safeWorkingDir()
	hideWindow(cmd)
	var buf bytes.Buffer
	cmd.Stdout, cmd.Stderr = &buf, &buf
	if err := cmd.Run(); err != nil {
		out := stripANSI(buf.String())
		if out == "" {
			out = err.Error()
		}
		return fmt.Errorf("login did not complete: %s", out)
	}
	return nil
}

// allowedLoginTool reports whether name is a recognized SSO-login helper (the same set
// the extractors accept). Tolerates a bare name or a full path, with or without .exe.
func allowedLoginTool(name string) bool {
	base := strings.TrimSuffix(filepath.Base(name), ".exe")
	switch base {
	case "granted", "aws", "assumego", "aws-vault", "aws2":
		return true
	}
	return false
}

// VerifyIdentity confirms who the caller is via a read-only sts:GetCallerIdentity
// BEFORE anything is created. Errors are classified so the UI can distinguish an
// expired SSO session from missing/invalid credentials.
func VerifyIdentity(ctx context.Context, cfg aws.Config, profile, region string) (Identity, error) {
	out, err := sts.NewFromConfig(cfg).GetCallerIdentity(ctx, &sts.GetCallerIdentityInput{})
	if err != nil {
		return Identity{}, classifyAuthErr(err, profile)
	}
	return Identity{
		Account: aws.ToString(out.Account),
		Arn:     aws.ToString(out.Arn),
		UserID:  aws.ToString(out.UserId),
		Profile: profile,
		Region:  region,
	}, nil
}

// authError carries a clean, human message for the UI while preserving the raw
// underlying error for the log (Unwrap) - so the UI isn't a wall of SDK text.
type authError struct {
	msg string
	raw error
}

func (e *authError) Error() string { return e.msg }
func (e *authError) Unwrap() error { return e.raw }

var (
	loginQuotedRE = regexp.MustCompile(`(?i)'([^']*sso[- ]?login[^']*)'`)
	loginBareRE   = regexp.MustCompile(`(?i)\b((?:granted|aws|assumego|aws-vault|aws2)\s+sso[- ]?login[^\n'"]*)`)
)

// extractLoginCmd pulls the login command a credential helper suggests out of its
// (possibly noisy) output - e.g. `granted sso login --sso-start-url … --sso-region …`.
func extractLoginCmd(s string) string {
	if mm := loginQuotedRE.FindStringSubmatch(s); mm != nil {
		return strings.TrimSpace(mm[1])
	}
	if mm := loginBareRE.FindStringSubmatch(s); mm != nil {
		return strings.TrimSpace(mm[1])
	}
	return ""
}

func brief(s string) string {
	s = strings.TrimSpace(s)
	if len(s) > 220 {
		return s[:220] + "…"
	}
	return s
}

// classifyAuthErr turns a raw STS/credential error into a clean, actionable message.
// It distinguishes an UNAUTHORIZED role (403 - logging in again won't help) from a
// STALE session (needs a fresh login), and surfaces the exact login command when one
// would actually fix it. The raw error is kept for the log via authError.Unwrap.
func classifyAuthErr(err error, profile string) error {
	raw := stripANSI(err.Error())
	m := strings.ToLower(raw)
	authz := strings.Contains(m, "403") || strings.Contains(m, "forbidden") ||
		strings.Contains(m, "no access") || strings.Contains(m, "accessdenied") ||
		strings.Contains(m, "access denied") || strings.Contains(m, "not authorized") ||
		strings.Contains(m, "unauthorized")
	loginCmd := extractLoginCmd(raw)
	stale := strings.Contains(m, "expired") || strings.Contains(m, "token") ||
		strings.Contains(m, "no cached") || strings.Contains(m, "sso session") ||
		strings.Contains(m, "please log")

	var msg string
	switch {
	case authz:
		// Valid session, but the role/permission-set isn't granted to this user.
		msg = fmt.Sprintf("Signed in, but you're not authorized for the role in profile %q (access denied / 403). Pick a profile whose permission set you can assume.", profile)
	case loginCmd != "" || stale:
		msg = fmt.Sprintf("The session for profile %q needs refreshing.", profile)
		if loginCmd != "" {
			msg += " Sign in with: " + loginCmd
		}
	case strings.Contains(m, "credential") && strings.Contains(m, "process"):
		msg = fmt.Sprintf("The credential process for profile %q failed: %s", profile, brief(raw))
	default:
		msg = fmt.Sprintf("Couldn't verify profile %q - credentials may be missing or invalid: %s", profile, brief(raw))
	}
	return &authError{msg: msg, raw: err}
}
