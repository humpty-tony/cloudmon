// Package capture holds the durable resource journal. It contains profile names
// and resource handles, never AWS credentials or session tokens.
package capture

import (
	"encoding/json"
	"fmt"
	"strings"

	"cloudmon/internal/awsflow"
	"cloudmon/internal/config"
)

const (
	Provisioning = "provisioning"
	Ready        = "ready"
	Cleanup      = "cleanup"
)

type Session struct {
	Version int                     `json:"version"`
	Phase   string                  `json:"phase"`
	Config  config.ConnectionConfig `json:"config"`
	Infra   awsflow.Infra           `json:"infra"`
}

func (s Session) Validate() error {
	if s.Version != 1 {
		return fmt.Errorf("unsupported capture journal version %d", s.Version)
	}
	if s.Phase != Provisioning && s.Phase != Ready && s.Phase != Cleanup {
		return fmt.Errorf("invalid capture journal phase %q", s.Phase)
	}
	if s.Infra.Account == "" || s.Infra.Region == "" {
		return fmt.Errorf("capture journal is missing its account or region")
	}
	if s.Infra.Owned && (!strings.HasPrefix(s.Infra.QueueName, "cloudmon-capture-") || !strings.HasPrefix(s.Infra.RuleName, "cloudmon-cloudtrail-")) {
		return fmt.Errorf("capture journal is missing its planned resource names")
	}
	if (s.Phase == Ready || !s.Infra.Owned) && s.Infra.QueueURL == "" {
		return fmt.Errorf("capture journal is missing its queue URL")
	}
	return nil
}

func (s Session) Encode() (string, error) {
	if err := s.Validate(); err != nil {
		return "", err
	}
	s.Config.DumpPath = ""
	b, err := json.Marshal(s)
	return string(b), err
}

func Decode(raw string) (*Session, error) {
	if raw == "" {
		return nil, nil
	}
	var s Session
	if err := json.Unmarshal([]byte(raw), &s); err != nil {
		return nil, fmt.Errorf("read capture journal: %w", err)
	}
	if err := s.Validate(); err != nil {
		return nil, err
	}
	return &s, nil
}
