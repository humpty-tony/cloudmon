package main

import (
	"context"
	"fmt"
	"time"

	"cloudmon/internal/awsflow"
	"cloudmon/internal/capture"
	"cloudmon/internal/config"
	"cloudmon/internal/store"
	"github.com/aws/aws-sdk-go-v2/aws"
)

type RecoveryState struct {
	Evidence     store.EvidenceStats `json:"evidence"`
	Capture      *capture.Session    `json:"capture"`
	CaptureError string              `json:"captureError"`
	Active       bool                `json:"active"`
}

// GetRecoveryState reads only local state. Launching CloudMon never starts an
// AWS consumer or provisions/deletes infrastructure automatically.
func (a *App) GetRecoveryState() (RecoveryState, error) {
	a.lifecycleMu.Lock()
	defer a.lifecycleMu.Unlock()
	var state RecoveryState
	if a.ensureDB() == nil {
		return state, fmt.Errorf("saved evidence unavailable: %v", a.dbErr)
	}
	stats, err := a.db.EvidenceStats()
	if err != nil {
		return state, err
	}
	state.Evidence = stats
	if err := a.loadCapture(); err != nil {
		state.CaptureError = err.Error()
	} else {
		state.Capture = a.capSession
	}
	a.capMu.Lock()
	state.Active = a.capActive
	a.capMu.Unlock()
	return state, nil
}

// Caller holds lifecycleMu for all journal access. A malformed/newer journal is
// never silently discarded or overwritten by a new capture.
func (a *App) loadCapture() error {
	if a.capLoaded {
		return nil
	}
	if a.ensureDB() == nil {
		return fmt.Errorf("saved capture unavailable: %v", a.dbErr)
	}
	raw, err := a.db.GetState("capture")
	if err != nil {
		return err
	}
	session, err := capture.Decode(raw)
	if err != nil {
		return err
	}
	a.capSession = session
	a.capLoaded = true
	if session != nil {
		a.capMu.Lock()
		a.capInfra = session.Infra
		a.capProfile = session.Config.Profile
		a.capMu.Unlock()
	}
	return nil
}

func (a *App) saveCapture(session *capture.Session) error {
	raw := ""
	if session != nil {
		var err error
		raw, err = session.Encode()
		if err != nil {
			return err
		}
	}
	if err := a.db.SetState("capture", raw); err != nil {
		return fmt.Errorf("save capture recovery state: %w", err)
	}
	a.capSession = session
	a.capLoaded = true
	a.capMu.Lock()
	defer a.capMu.Unlock()
	if session == nil {
		a.capInfra = awsflow.Infra{}
		a.capProfile = ""
	} else {
		a.capInfra = session.Infra
		a.capProfile = session.Config.Profile
	}
	return nil
}

func (a *App) StartCapture() (awsflow.Infra, error) {
	a.lifecycleMu.Lock()
	defer a.lifecycleMu.Unlock()
	if err := a.loadCapture(); err != nil {
		return awsflow.Infra{}, err
	}
	a.capMu.Lock()
	active := a.capActive
	infra := a.capInfra
	a.capMu.Unlock()
	if active {
		return infra, nil
	}
	if a.capSession != nil {
		return awsflow.Infra{}, fmt.Errorf("a saved capture already exists; resume it or remove its infrastructure before starting another")
	}
	a.mu.Lock()
	cfg := a.cfg
	a.mu.Unlock()
	if config.Mode(cfg.Mode) != config.ModeCreateInfra && config.Mode(cfg.Mode) != config.ModeExistingSQS {
		return awsflow.Infra{}, fmt.Errorf("choose a live capture connection")
	}
	region := cfg.Region
	if region == "" {
		region = "us-east-1"
	}
	if config.Mode(cfg.Mode) == config.ModeExistingSQS {
		region = awsflow.RegionFromQueueURL(cfg.QueueURL)
		if region == "" {
			return awsflow.Infra{}, fmt.Errorf("couldn't read the queue's region from its URL")
		}
	}
	cfg.Region = region
	cfg.DumpPath = ""
	ctx, cancel := context.WithTimeout(a.ctx, 90*time.Second)
	defer cancel()
	awscfg, err := awsflow.LoadConfig(ctx, cfg.Profile, region)
	if err != nil {
		return awsflow.Infra{}, err
	}
	id, err := awsflow.VerifyIdentity(ctx, awscfg, cfg.Profile, region)
	if err != nil {
		return awsflow.Infra{}, err
	}
	if config.Mode(cfg.Mode) == config.ModeExistingSQS {
		if err := awsflow.CheckQueue(ctx, awscfg, cfg.QueueURL); err != nil {
			return awsflow.Infra{}, err
		}
		infra = awsflow.Infra{QueueURL: cfg.QueueURL, Region: region, Account: id.Account, AllMgmt: !cfg.WriteOnly}
	} else {
		infra, err = awsflow.Provision(ctx, awscfg, id.Account, region, cfg.CapturePattern, !cfg.WriteOnly, func(partial awsflow.Infra) error {
			return a.saveCapture(&capture.Session{Version: 1, Phase: capture.Provisioning, Config: cfg, Infra: partial})
		})
		if err != nil {
			a.Log("error", "capture setup interrupted: "+err.Error())
			if a.capSession != nil {
				return infra, fmt.Errorf("capture setup interrupted; resource names are saved for cleanup: %w", err)
			}
			return infra, err
		}
	}
	if err := a.saveCapture(&capture.Session{Version: 1, Phase: capture.Ready, Config: cfg, Infra: infra}); err != nil {
		return infra, err
	}
	a.startPoller(awscfg, infra)
	return infra, nil
}

func (a *App) ResumeCapture() (awsflow.Infra, error) {
	a.lifecycleMu.Lock()
	defer a.lifecycleMu.Unlock()
	if err := a.loadCapture(); err != nil {
		return awsflow.Infra{}, err
	}
	session := a.capSession
	if session == nil {
		return awsflow.Infra{}, fmt.Errorf("no saved capture")
	}
	if session.Phase != capture.Ready {
		return awsflow.Infra{}, fmt.Errorf("capture setup or cleanup was interrupted; finish removing its infrastructure before starting another")
	}
	a.capMu.Lock()
	active := a.capActive
	a.capMu.Unlock()
	if active {
		return session.Infra, nil
	}
	ctx, cancel := context.WithTimeout(a.ctx, 45*time.Second)
	defer cancel()
	awscfg, err := awsflow.LoadConfig(ctx, session.Config.Profile, session.Infra.Region)
	if err != nil {
		return awsflow.Infra{}, err
	}
	if err := awsflow.VerifyCaptureAccount(ctx, awscfg, session.Infra, session.Config.Profile); err != nil {
		return awsflow.Infra{}, err
	}
	if err := awsflow.CheckQueue(ctx, awscfg, session.Infra.QueueURL); err != nil {
		return awsflow.Infra{}, err
	}
	a.mu.Lock()
	a.cfg = session.Config
	a.mu.Unlock()
	a.startPoller(awscfg, session.Infra)
	return session.Infra, nil
}

func (a *App) startPoller(cfg aws.Config, infra awsflow.Infra) {
	pctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	a.capMu.Lock()
	a.capCancel = cancel
	a.capDone = done
	a.capActive = true
	a.capMu.Unlock()
	poller := awsflow.NewPoller(cfg, infra.QueueURL, a.onLiveBatch, func(err error) { a.Log("warn", "poll: "+err.Error()) })
	go func() { defer close(done); poller.Run(pctx) }()
	a.Log("info", fmt.Sprintf("capture polling queue=%s region=%s account=%s", infra.QueueURL, infra.Region, infra.Account))
}

// TeardownCapture is an explicit user action. Persist cleanup intent before any
// AWS delete and retain it on every failure. Not-found responses allow retrying
// after a crash between the remote deletion and clearing the local journal.
func (a *App) TeardownCapture() error {
	a.lifecycleMu.Lock()
	defer a.lifecycleMu.Unlock()
	a.stopCapture()
	if err := a.loadCapture(); err != nil {
		return err
	}
	if a.capSession == nil {
		return nil
	}
	session := *a.capSession
	if !session.Infra.Owned {
		return a.saveCapture(nil)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	awscfg, err := awsflow.LoadConfig(ctx, session.Config.Profile, session.Infra.Region)
	if err != nil {
		return err
	}
	if err := awsflow.VerifyCaptureAccount(ctx, awscfg, session.Infra, session.Config.Profile); err != nil {
		return err
	}
	session.Phase = capture.Cleanup
	if err := a.saveCapture(&session); err != nil {
		return err
	}
	if err := awsflow.Teardown(ctx, awscfg, session.Infra); err != nil {
		return fmt.Errorf("cleanup incomplete; saved resources remain available for retry: %w", err)
	}
	return a.saveCapture(nil)
}
