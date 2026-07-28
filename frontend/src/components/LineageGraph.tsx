import type { CloudTrailEvent, FilterField, Lineage, LineageNode, QueryOp } from "../api/types";
import { identityGlyph } from "../api/types";

interface Props {
  lineage: Lineage;
  current: CloudTrailEvent; // the event this lineage belongs to (bottom of the chain)
  onPivot: (field: FilterField, value: string, op: QueryOp) => void;
  onFullView?: () => void; // open the full lineage graph view
}

const GLYPH_CLS: Record<string, string> = {
  Root: "lg-root",
  IAMUser: "lg-iam",
  AssumedRole: "lg-role",
  AWSService: "lg-svc",
  FederatedUser: "lg-fed",
};

/** Tail of an ARN (role name, user name, …). */
function tail(arn: string): string {
  if (!arn) return "";
  const parts = arn.split("/");
  return parts.length > 1 ? parts[parts.length - 1] : arn;
}

function view(type: string, userName: string, roleArn: string, sessionName: string, arn: string, invokedBy: string) {
  switch (type) {
    case "Root":
      return { primary: "root", secondary: arn };
    case "IAMUser":
      return { primary: userName || tail(arn), secondary: arn };
    case "AssumedRole":
      return { primary: tail(roleArn) || tail(arn), secondary: sessionName ? `session: ${sessionName}` : arn };
    case "AWSService":
      return { primary: invokedBy || arn || "AWS service", secondary: "AWS service" };
    case "FederatedUser":
      return { primary: userName || tail(arn), secondary: arn };
    default:
      return { primary: userName || tail(arn) || type, secondary: arn };
  }
}

/** The concrete field+value a node pivots on, or null if it can't round-trip. */
function pivotOf(type: string, userName: string, roleArn: string): [FilterField, string] | null {
  if (type === "AssumedRole" && roleArn) return ["roleArn", roleArn];
  if (userName) return ["userName", userName];
  return null;
}

function Node(props: {
  type: string;
  userName: string;
  roleArn: string;
  sessionName: string;
  arn: string;
  invokedBy?: string;
  current?: boolean;
  onPivot?: () => void;
}) {
  const v = view(props.type, props.userName, props.roleArn, props.sessionName, props.arn, props.invokedBy || "");
  const p = pivotOf(props.type, props.userName, props.roleArn);
  return (
    <div
      className={`lg-node ${props.current ? "lg-node--current" : ""} ${p && !props.current ? "lg-clickable" : ""}`}
      title={props.arn || undefined}
      onClick={!props.current && p ? props.onPivot : undefined}
    >
      <span className={`lg-glyph ${GLYPH_CLS[props.type] || "lg-other"}`}>{identityGlyph(props.type)}</span>
      <span className="lg-body">
        <span className="lg-primary">{v.primary}</span>
        {v.secondary && <span className="lg-secondary">{v.secondary}</span>}
      </span>
      {props.current && <span className="lg-here">this event</span>}
    </div>
  );
}

function Edge({ label }: { label: string }) {
  return (
    <div className={`lg-edge ${label ? "" : "lg-edge--dashed"}`}>
      <span className="lg-edge-label">{label || "AssumeRole - not in dataset"}</span>
    </div>
  );
}

function edgeLabel(n: LineageNode): string {
  const t = n.viaTime ? new Date(n.viaTime).toLocaleTimeString() : "";
  return [n.viaEvent, t, n.viaSourceIP].filter(Boolean).join(" · ");
}

export function LineageGraph({ lineage, current, onPivot, onFullView }: Props) {
  const ui = current.userIdentity;
  return (
    <div className="lg">
      <div className="lg-head">
        <span className="lg-title">Role lineage</span>
        <span className={`lg-tag ${lineage.complete ? "ok" : "warn"}`}>
          {lineage.complete ? "origin resolved" : "chain incomplete"}
        </span>
        {onFullView && (
          <button className="lg-full" onClick={onFullView} title="Open the full lineage graph">
            ⤢ View full lineage
          </button>
        )}
      </div>
      {lineage.sourceIdentity && (
        <div className="lg-source">
          sourceIdentity <b>{lineage.sourceIdentity}</b>
        </div>
      )}
      <div className="lg-chain">
        {!lineage.complete && (
          <>
            <div className="lg-node lg-node--unknown">
              <span className="lg-glyph lg-other">?</span>
              <span className="lg-body">
                <span className="lg-primary">unknown caller</span>
                <span className="lg-secondary">not in dataset - cross-account, out of range, or a service assumption</span>
              </span>
            </div>
            <Edge label="" />
          </>
        )}
        {lineage.nodes.map((n, i) => (
          <div key={i} className="lg-step">
            <Node
              type={n.identityType}
              userName={n.userName}
              roleArn={n.roleArn}
              sessionName={n.sessionName}
              arn={n.arn}
              invokedBy={n.invokedBy}
              onPivot={() => {
                const p = pivotOf(n.identityType, n.userName, n.roleArn);
                if (p) onPivot(p[0], p[1], "include");
              }}
            />
            <Edge label={edgeLabel(n)} />
          </div>
        ))}
        <Node type="AssumedRole" userName={ui.userName} roleArn={ui.roleArn || ""} sessionName={ui.sessionName || ""} arn={ui.arn} current />
      </div>
    </div>
  );
}
