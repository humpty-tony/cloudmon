import { useEffect, useRef, useState } from "react";
import type { AwsIdentity, AwsProfile, RecoveryState, ConnectionConfig, ConnectionMode, RequiredPermission, TrailStatus } from "../api/types";
import { backend } from "../api/backend";
import { parseDump } from "../api/dumpParser";
import { RecoveryCard, removalPrompt } from "./RecoveryCard";
import logo from "../assets/logo.png";

interface Props {
  embedded?: boolean;
  initialMode?: ConnectionMode;
  refresh?: number;
  onBusyChange?: (busy: boolean) => void;
  onRecovery?: (state: RecoveryState) => void;
  onConnect: (cfg: ConnectionConfig) => Promise<void>;
  onRestore: (state: RecoveryState, resume: boolean) => Promise<void>;
}

interface ModeDef {
  mode: ConnectionMode;
  title: string;
  blurb: string;
  note: string;
}

const MODES: ModeDef[] = [
  {
    mode: "create-infra",
    title: "Create infrastructure",
    blurb:
      "CloudMon builds its own EventBridge rule + SQS queue on the default bus, then streams live CloudTrail events. It never touches your existing trail.",
    note: "Retained after exit until you remove it. AWS charges and queue retention still apply.",
  },
  {
    mode: "existing-sqs",
    title: "Connect to existing SQS",
    blurb:
      "Point CloudMon at an SQS queue that receives CloudTrail events. Messages are deleted only after local storage succeeds. Use a dedicated queue; other consumers compete for the same messages.",
    note: "Supported payloads: CloudTrail records, EventBridge detail, and SNS wrappers. S3 object notifications need an importer.",
  },
  {
    mode: "import-dump",
    title: "Import a dump",
    blurb:
      "Load a CloudTrail export offline. JSON log files (Records[]) are full-fidelity; CSV from Event History is supported but lossy.",
    note: "Replaces the saved dataset only after the entire import succeeds. No AWS access needed.",
  },
];

// A correct EventBridge narrowing example: match on detail-type, filter within detail
// by eventSource (CloudTrail API calls carry source aws.<service>, never aws.cloudtrail).
const DEFAULT_PATTERN = `{
  "detail-type": ["AWS API Call via CloudTrail"],
  "detail": {
    "eventCategory": ["Management"],
    "eventSource": ["s3.amazonaws.com", "iam.amazonaws.com"]
  }
}`;

const REGIONS = [
  "us-east-1", "us-east-2", "us-west-1", "us-west-2",
  "eu-west-1", "eu-west-2", "eu-central-1",
  "ap-southeast-1", "ap-southeast-2", "ap-northeast-1",
  "ca-central-1", "sa-east-1",
];

// Credential helpers (Granted, aws-vault, the AWS CLI, …) print the exact login
// command to run when a session is stale. Pull it out so we can offer to run it.
function suggestedLogin(err: string | null): string | null {
  if (!err) return null;
  const quoted = err.match(/'([^']*sso[- ]?login[^']*)'/i); // e.g. 'granted sso login --sso-start-url …'
  if (quoted) return quoted[1].trim();
  const bare = err.match(/\b((?:granted|aws|assumego|aws-vault|aws2)\s+sso[- ]?login[^\n'"]*)/i);
  return bare ? bare[1].trim() : null;
}

export function ConnectionScreen({ onConnect, onRestore, embedded = false, initialMode = "create-infra", refresh = 0, onBusyChange, onRecovery }: Props) {
  const [selected, setSelected] = useState<ConnectionMode>(initialMode);
  const [perms, setPerms] = useState<RequiredPermission[]>([]);
  const [profiles, setProfiles] = useState<AwsProfile[]>([]);
  const [region, setRegion] = useState("us-east-1");
  const [profile, setProfile] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileQuery, setProfileQuery] = useState("");
  const [identity, setIdentity] = useState<AwsIdentity | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyErr, setVerifyErr] = useState<string | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [trailStatus, setTrailStatus] = useState<TrailStatus | null>(null);
  const [writeOnly, setWriteOnly] = useState(false); // false = capture ALL management events (incl. reads)
  const [queueUrl, setQueueUrl] = useState("");
  const [ruleArn, setRuleArn] = useState("");
  const [dumpPath, setDumpPath] = useState("");
  const [advOpen, setAdvOpen] = useState(false);
  const [pattern, setPattern] = useState("");
  const [patternError, setPatternError] = useState<string | null>(null);
  const [dumpText, setDumpText] = useState("");
  const [dumpName, setDumpName] = useState("");
  const [dumpInfo, setDumpInfo] = useState<{ count: number } | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const verificationGeneration = useRef(0);
  const [recovery, setRecovery] = useState<RecoveryState | null>(null);
  const [recoveryError, setRecoveryError] = useState("");
  const mounted = useRef(true);
  const loadRecovery = async () => {
    try { const state = await backend.getRecoveryState(); if(mounted.current){setRecovery(state);setRecoveryError("");onRecovery?.(state)} }
    catch(e) { if(mounted.current)setRecoveryError(String(e)) }
  };
  useEffect(()=>{mounted.current=true;void loadRecovery();return()=>{mounted.current=false}},[refresh]);
  useEffect(() => {onBusyChange?.(connecting || loginBusy);}, [connecting, loginBusy, onBusyChange]);
  const restore = async (resume: boolean) => {
    if(!recovery)return;
    setConnecting(true);setConnectError(null);
    try {await onRestore(recovery,resume)} catch(e) {setConnectError(String(e));await loadRecovery()}
    finally {setConnecting(false)}
  };
  const removeSaved = async () => {
    if(!recovery?.capture || !window.confirm(removalPrompt(recovery.capture)))return;
    setConnecting(true);setConnectError(null);
    try {await backend.teardownCapture()} catch(e) {setConnectError(String(e))}
    finally {await loadRecovery();setConnecting(false)}
  };

  useEffect(() => () => { verificationGeneration.current++; }, []);

  useEffect(() => {
    let alive = true;
    backend.requiredPermissions(selected).then((p) => alive && setPerms(p));
    return () => {
      alive = false;
    };
  }, [selected]);

  // Enumerate ~/.aws profiles once (SSO / assume-role / access keys).
  useEffect(() => {
    let alive = true;
    backend
      .listProfiles()
      .then((ps) => {
        if (!alive) return;
        setProfiles(ps);
        if (ps.length) {
          const first = ps.find((p) => p.name === "default") ?? ps[0];
          setProfile(first.name);
          if (first.region) setRegion(first.region);
        }
      })
      .catch(() => alive && setProfiles([]));
    return () => {
      alive = false;
    };
  }, []);

  const canFilter = selected === "create-infra"; // the advanced EventBridge filter only applies to a rule CloudMon creates
  const needsAws = selected !== "import-dump"; // create-infra + existing-sqs both need a profile/region + verified identity

  // Any change to profile/region invalidates a prior identity confirmation.
  const pickProfile = (name: string) => {
    verificationGeneration.current++;
    setVerifying(false);
    setProfile(name);
    setIdentity(null);
    setVerifyErr(null);
    setTrailStatus(null);
    const p = profiles.find((x) => x.name === name);
    if (p?.region) setRegion(p.region);
  };
  const pickRegion = (r: string) => {
    verificationGeneration.current++;
    setVerifying(false);
    setRegion(r);
    setIdentity(null);
    setVerifyErr(null);
    setTrailStatus(null);
  };

  const verify = async () => {
    const generation = ++verificationGeneration.current;
    setVerifying(true);
    setVerifyErr(null);
    setIdentity(null);
    setTrailStatus(null);
    try {
      const id = await backend.verifyIdentity(profile, region);
      if (generation !== verificationGeneration.current) return;
      setIdentity(id);
      // Pre-flight: is a CloudTrail trail actually feeding this region? Without one the
      // pipeline would be created but receive nothing. Non-blocking, best-effort.
      backend.checkTrail(profile, region).then((status) => {
        if (generation === verificationGeneration.current) setTrailStatus(status);
      }).catch(() => {
        if (generation === verificationGeneration.current) setTrailStatus({ hasLoggingTrail: false, trailCount: 0, globalCovered: false, coverageKnown: false, summary: "Coverage unknown: trail status or selectors could not be read. Check CloudTrail read permissions." });
      });
    } catch (e) {
      if (generation === verificationGeneration.current) setVerifyErr((e as Error)?.message || String(e));
    } finally {
      if (generation === verificationGeneration.current) setVerifying(false);
    }
  };

  // Run the login command the credential helper suggested (opens the browser), then
  // re-verify once the session is refreshed.
  const runLogin = async (command: string) => {
    const generation = verificationGeneration.current;
    setLoginBusy(true);
    setVerifyErr(null);
    try {
      await backend.runLoginCommand(command);
      if (generation === verificationGeneration.current) await verify();
    } catch (e) {
      if (generation === verificationGeneration.current) setVerifyErr((e as Error)?.message || String(e));
    } finally {
      setLoginBusy(false);
    }
  };
  const loginCmd = suggestedLogin(verifyErr);

  const regionOptions = profile && !REGIONS.includes(region) && region ? [region, ...REGIONS] : REGIONS;
  const profileMatches = profileQuery
    ? profiles.filter((p) => p.name.toLowerCase().includes(profileQuery.toLowerCase()))
    : profiles;

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setConnectError(null);
    setDumpInfo(null);
    setDumpName(f.name);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      try {
        const evs = parseDump(text);
        setDumpText(text);
        setDumpInfo({ count: evs.length });
      } catch (err) {
        setDumpText("");
        setDumpInfo(null);
        setConnectError(`Not a CloudTrail export: ${(err as Error).message}`);
      }
    };
    reader.onerror = () => setConnectError("Could not read that file.");
    reader.readAsText(f);
  };

  const chooseNative = async () => {
    setConnectError(null);
    setDumpInfo(null);
    const p = await backend.selectDumpPath();
    if (!p) return;
    setDumpPath(p);
    setDumpName(p.split(/[\\/]/).pop() || p);
    setDumpText("");
  };

  // create-infra requires a confirmed identity before it will provision anything.
  const needsIdentity = selected === "create-infra" || selected === "existing-sqs";
  const identityOK = !needsIdentity || !!identity;

  const connect = async () => {
    setConnectError(null);
    if (canFilter && advOpen && pattern.trim()) {
      try {
        JSON.parse(pattern);
      } catch (e) {
        setPatternError((e as Error).message);
        return;
      }
    }
    if (selected === "import-dump" && !dumpText && !dumpPath) {
      setConnectError("Choose a CloudTrail export file first.");
      return;
    }
    if (selected === "existing-sqs" && !queueUrl.trim()) {
      setConnectError("Enter the SQS queue URL to connect to.");
      return;
    }
    setConnecting(true);
    try {
      if (selected === "existing-sqs") {
        await backend.checkQueue(profile, queueUrl.trim()); // block before load if the queue is wrong, in another region, or off-limits
      }
      await onConnect({
        mode: selected,
        region,
        profile,
        queueUrl,
        ruleArn,
        dumpPath,
        dumpText,
        capturePattern: canFilter && advOpen ? pattern.trim() : "",
        writeOnly: selected === "create-infra" ? writeOnly : false,
      });
    } catch (e) {
      setConnectError((e as Error)?.message || String(e));
      await loadRecovery();
    } finally {
      setConnecting(false);
    }
  };

  const box: React.CSSProperties = {
    background: "var(--bg-0)",
    border: "1px solid var(--line-struct)",
    borderRadius: "var(--radius)",
    padding: "12px 14px",
    fontFamily: "var(--mono)",
    fontSize: "12.5px",
    lineHeight: 1.55,
  };

  return (
    <div className={`connect ${embedded ? "connect--embedded" : ""}`}>
      <div className="connect-head" hidden={embedded}>
        <div className="brand">
          <img className="brand-mark" src={logo} alt="" />
          <span className="brand-name">CloudMon</span>
        </div>
        <p className="brand-tag">Live CloudTrail investigation. Choose how to connect.</p>
      </div>

      {recovery && <RecoveryCard state={recovery} busy={connecting} onRestore={restore} onRemove={removeSaved} />}
      {recovery?.capture && connectError && <div className="recovery-card recovery-warning" role="alert">{connectError}</div>}
      {recoveryError && <div className="recovery-card recovery-warning" role="alert">Could not read saved evidence: {recoveryError}.<button className="btn-ghost" onClick={loadRecovery}>Retry saved session</button></div>}
      {!recovery && !recoveryError && <p role="status">Checking saved evidence…</p>}
      <div className="mode-grid">
        {MODES.map((m) => (
          <button
            key={m.mode}
            className={`mode-card ${selected === m.mode ? "selected" : ""}`}
            disabled={connecting}
            onClick={() => setSelected(m.mode)}
          >
            <div className="mode-card-head">
              <span className="mode-radio" />
              <span className="mode-title">{m.title}</span>
              {m.mode === "create-infra" && (
                <span style={{ marginLeft: "auto", color: "var(--tx-3)", fontSize: 11, letterSpacing: ".3px" }}>recommended</span>
              )}
            </div>
            <div className="mode-blurb">{m.blurb}</div>
            <div className="mode-note">{m.note}</div>
          </button>
        ))}
      </div>

      <div className="connect-detail">
        {needsAws && (
          <>
            <div className="field-row">
              <label className="field" style={{ flex: 2 }}>
                <span>Profile</span>
                {profiles.length ? (
                  <div style={{ position: "relative" }}>
                    <input
                      style={{ width: "100%" }}
                      value={profileOpen ? profileQuery : profile}
                      placeholder={`Search ${profiles.length} profiles…`}
                      spellCheck={false}
                      onFocus={() => {
                        setProfileOpen(true);
                        setProfileQuery("");
                      }}
                      onChange={(e) => {
                        setProfileQuery(e.target.value);
                        setProfileOpen(true);
                      }}
                      onBlur={() => window.setTimeout(() => setProfileOpen(false), 150)}
                    />
                    {profileOpen && (
                      <div
                        style={{
                          position: "absolute", zIndex: 20, top: "calc(100% + 4px)", left: 0, right: 0,
                          maxHeight: 300, overflowY: "auto", background: "var(--bg-2)",
                          border: "1px solid var(--line-struct)", borderRadius: "var(--radius)", boxShadow: "var(--overlay-shadow)",
                        }}
                      >
                        {profileMatches.length === 0 && (
                          <div style={{ padding: "8px 10px", color: "var(--tx-3)", fontFamily: "var(--sans)", fontSize: 12.5 }}>
                            No profiles match “{profileQuery}”.
                          </div>
                        )}
                        {profileMatches.slice(0, 200).map((p) => (
                          <button
                            key={p.name}
                            type="button"
                            onMouseDown={(e) => e.preventDefault()} // keep input focus so the click lands before onBlur
                            onClick={() => {
                              pickProfile(p.name);
                              setProfileOpen(false);
                              setProfileQuery("");
                            }}
                            style={{
                              display: "block", width: "100%", textAlign: "left", border: 0, cursor: "pointer",
                              background: p.name === profile ? "var(--acc-sel)" : "transparent",
                              color: "var(--tx-1)", fontFamily: "var(--mono)", fontSize: 13, padding: "7px 10px",
                            }}
                          >
                            {p.name}
                            {p.kind !== "other" ? <span style={{ color: "var(--tx-3)" }}>{`  · ${p.kind}`}</span> : ""}
                          </button>
                        ))}
                        {profileMatches.length > 200 && (
                          <div style={{ padding: "6px 10px", color: "var(--tx-3)", fontFamily: "var(--sans)", fontSize: 11.5 }}>
                            +{profileMatches.length - 200} more - keep typing to narrow.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <input value={profile} onChange={(e) => pickProfile(e.target.value)} placeholder="No ~/.aws profiles found" spellCheck={false} />
                )}
              </label>
              <label className="field" style={{ flex: 1 }}>
                <span>AWS region</span>
                <select value={region} onChange={(e) => pickRegion(e.target.value)}>
                  {regionOptions.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {/* Identity - confirmed via a read-only sts:GetCallerIdentity before anything is created. */}
            <div style={{ ...box, display: "flex", gap: 11, alignItems: "flex-start", marginBottom: 14 }}>
              <span
                style={{
                  width: 8, height: 8, borderRadius: "50%", marginTop: 4, flex: "none",
                  background: identity ? "var(--sev-ok)" : verifyErr ? "var(--sev-err)" : "var(--tx-3)",
                }}
              />
              <div style={{ flex: 1, minWidth: 0, color: "var(--tx-2)" }}>
                {loginBusy ? (
                  <span style={{ fontFamily: "var(--sans)" }}>Opening your browser - complete the sign-in there; CloudMon will re-verify automatically…</span>
                ) : verifying ? (
                  "Confirming identity…"
                ) : identity ? (
                  <>
                    <div style={{ color: "var(--tx-1)" }}>{identity.account} · {region}</div>
                    <div style={{ color: "var(--tx-1)", wordBreak: "break-all" }}>{identity.arn}</div>
                    <div style={{ color: "var(--tx-3)", fontFamily: "var(--sans)", fontSize: 11.5, marginTop: 5 }}>
                      Verified with sts:GetCallerIdentity - a read-only call. Nothing has been created yet.
                    </div>
                  </>
                ) : verifyErr ? (
                  <>
                    <span style={{ color: "var(--sev-err)", fontFamily: "var(--sans)" }}>{verifyErr}</span>
                    {loginCmd && (
                      <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                        <button
                          type="button"
                          className="btn-primary"
                          style={{ padding: "5px 14px", fontSize: 12 }}
                          onClick={() => runLogin(loginCmd)}
                        >
                          Sign in →
                        </button>
                        <code style={{ color: "var(--tx-2)", fontSize: 11.5, wordBreak: "break-all" }}>{loginCmd}</code>
                      </div>
                    )}
                  </>
                ) : (
                  <span style={{ fontFamily: "var(--sans)" }}>Pick a profile, then confirm who you are before anything is created.</span>
                )}
              </div>
              <button type="button" className="btn-ghost" onClick={verify} disabled={verifying || loginBusy || !profile}>
                {identity ? "Re-verify" : "Verify identity"}
              </button>
            </div>
          </>
        )}

        {/* Pre-flight: without a logging trail feeding this region the pipeline gets nothing. */}
        {selected === "create-infra" &&
          trailStatus &&
          (() => {
            const ok = trailStatus.hasLoggingTrail && trailStatus.coverageComplete;
            return (
              <div
                style={{
                  display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 14,
                  padding: "11px 13px", borderRadius: "var(--radius)", fontSize: 12.5, lineHeight: 1.5,
                  color: ok ? "var(--sev-ok)" : "var(--sev-warn)",
                  background: ok ? "rgba(69,193,135,0.08)" : "rgba(230,165,60,0.08)",
                  border: `1px solid ${ok ? "rgba(69,193,135,0.28)" : "rgba(230,165,60,0.30)"}`,
                }}
              >
                <span>{ok ? "✓" : "⚠"}</span>
                <span>
                  <b>CloudTrail:</b> {trailStatus.summary}
                </span>
              </div>
            );
          })()}

        {selected === "create-infra" && (
          <label
            style={{
              display: "flex", gap: 11, alignItems: "flex-start", marginBottom: 14,
              padding: "12px 14px", border: "1px solid var(--line-struct)", borderRadius: "var(--radius)", cursor: "pointer",
            }}
          >
            <input type="checkbox" checked={!writeOnly} onChange={(e) => setWriteOnly(!e.target.checked)} style={{ marginTop: 3 }} />
            <span style={{ fontSize: 13, lineHeight: 1.5 }}>
              <b>Capture all management events - reads included</b>
              <span style={{ display: "block", color: "var(--tx-2)", fontSize: 12.5, marginTop: 3 }}>
                Keeps read-only calls a default rule drops - <code>AssumeRole</code>, <code>kms:Decrypt</code>,{" "}
                <code>GetSecretValue</code> - plus console sign-ins. Recommended.
              </span>
              {writeOnly && (
                <span style={{ display: "block", color: "var(--sev-warn)", fontSize: 12, marginTop: 6 }}>
                  ⚠ Reads off - AssumeRole, kms:Decrypt and GetSecretValue won't be captured, and console logins are missed.
                </span>
              )}
            </span>
          </label>
        )}

        {selected === "existing-sqs" && (
          <div className="field-col">
            <label className="field">
              <span>SQS queue URL</span>
              <input
                value={queueUrl}
                onChange={(e) => setQueueUrl(e.target.value)}
                placeholder="https://sqs.us-east-1.amazonaws.com/123456789012/cloudmon"
                spellCheck={false}
              />
            </label>
            <div className="mode-note">CloudMon deletes messages only after their local commit succeeds. Use a dedicated queue because other consumers compete for the same messages. The queue and its feeding rule remain yours.</div>
          </div>
        )}

        {selected === "import-dump" && (
          <div className="field-col">
            <label className="field">
              <span>CloudTrail export file</span>
              {backend.live ? (
                <button type="button" className="btn-ghost" onClick={chooseNative}>
                  {dumpName ? `Selected: ${dumpName}` : "Choose export file…"}
                </button>
              ) : (
                <input className="file-input" type="file" accept=".json,.csv,.ndjson,application/json,text/csv" onChange={onFile} />
              )}
            </label>
            <div className="file-hint">
              Console <b>Event history → Download events → JSON</b>, an S3 log file (or a whole folder of{" "}
              <code>.json.gz</code>), or <code>aws cloudtrail lookup-events</code> output. Streamed by DuckDB - handles multi-GB dumps.
              {dumpName && dumpInfo && (
                <span className="file-chosen">
                  {" "}
                  · <b>{dumpName}</b> - {dumpInfo.count.toLocaleString()} events ✓
                </span>
              )}
              {backend.live && dumpName && !dumpInfo && (
                <span className="file-chosen"> · <b>{dumpName}</b> ✓</span>
              )}
            </div>
          </div>
        )}

        <div className="perms">
          <div className="perms-head">Required permissions</div>
          <ul className="perms-list">
            {perms.map((p) => (
              <li key={p.action}>
                <code>{p.action}</code>
                <span>{p.reason}</span>
              </li>
            ))}
          </ul>
        </div>

        {canFilter && (
          <div className={`advanced ${advOpen ? "open" : ""}`}>
            <button className="advanced-toggle" onClick={() => setAdvOpen((v) => !v)}>
              <span className="advanced-caret">▶</span>
              Advanced: capture filter (EventBridge pattern)
              <span className="advanced-label-sub">optional · server-side</span>
            </button>
            {advOpen && (
              <div className="advanced-body">
                <div className="advanced-help">
                  Set once at connect time to bound ingest volume/cost. This is server-side and drops
                  events at the source. Day-to-day filtering happens in the app - instantly and
                  non-destructively. Leave blank to capture everything.
                </div>
                <textarea
                  className="pattern-editor"
                  value={pattern}
                  onChange={(e) => setPattern(e.target.value)}
                  onFocus={() => !pattern && setPattern(DEFAULT_PATTERN)}
                  placeholder={DEFAULT_PATTERN}
                  spellCheck={false}
                />
                {patternError && <div className="pattern-error">Invalid JSON: {patternError}</div>}
              </div>
            )}
          </div>
        )}

        <div className="connect-actions">
          {connectError && !recovery?.capture && <span className="connect-error">⚠ {connectError}</span>}
          {needsAws && recovery?.capture && <span className="recovery-warning">Resume or remove the saved capture above before creating another.</span>}
          {needsIdentity && !identity && !connectError && (
            <span style={{ color: "var(--tx-3)", fontSize: 11.5, marginRight: "auto" }}>Verify your identity to continue.</span>
          )}
          <button className="btn-primary" onClick={connect} disabled={connecting || !identityOK || !recovery || !!recoveryError || (needsAws && (!!recovery.capture || !!recovery.captureError))}>
            {connecting ? "Loading…" : selected === "import-dump" ? "Load dump" : selected === "create-infra" ? "Create & capture" : "Connect & capture"}
          </button>
        </div>
      </div>
    </div>
  );
}
