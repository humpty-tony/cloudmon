package store

import (
	"fmt"
	"strings"
)

// LineageNode is one ancestor in an assumed-role chain, together with the
// AssumeRole event by which it created the session directly BELOW it. Nodes are
// returned origin-first (the ultimate caller) down to the immediate parent of the
// event under inspection.
type LineageNode struct {
	IdentityType string `json:"identityType"`
	Arn          string `json:"arn"`
	UserName     string `json:"userName"`
	AccountID    string `json:"accountId"`
	RoleArn      string `json:"roleArn"`
	SessionName  string `json:"sessionName"`
	InvokedBy    string `json:"invokedBy"` // for AWSService: the calling service
	// The AssumeRole* event this node performed to mint the session beneath it.
	ViaSeq      int64  `json:"viaSeq"`
	ViaEvent    string `json:"viaEvent"`
	ViaTime     string `json:"viaTime"`
	ViaSourceIP string `json:"viaSourceIP"`
}

// Lineage is the assumed-role ancestry for one event: who ultimately assumed the
// role. Complete=false means the chain broke (an AssumeRole wasn't in the dataset
// - cross-account, outside the time range, or a service-internal assumption).
type Lineage struct {
	Applicable     bool          `json:"applicable"`     // false unless the event is an AssumedRole
	SourceIdentity string        `json:"sourceIdentity"` // immutable origin, if sts:SourceIdentity is set
	Complete       bool          `json:"complete"`       // reached a real principal (not an unresolved role)
	Nodes          []LineageNode `json:"nodes"`          // origin-first → immediate parent
}

const lineageMaxDepth = 12

// Lineage walks the assumed-role chain for the event `seq` by following the
// credential key: a session's userIdentity.accessKeyId equals the
// responseElements.credentials.accessKeyId of the AssumeRole that minted it, whose
// userIdentity is the caller. Repeat up the chain.
func (s *Store) Lineage(seq int64) (Lineage, error) {
	lin := Lineage{Nodes: []LineageNode{}}

	var seed []struct {
		AccessKeyID    string `json:"accessKeyId"`
		SourceIdentity string `json:"sourceIdentity"`
		IdentityType   string `json:"identityType"`
	}
	if err := s.queryJSON(fmt.Sprintf("SELECT accessKeyId, sourceIdentity, identityType FROM events WHERE seq=%d;", seq), &seed); err != nil {
		return lin, err
	}
	if len(seed) == 0 || seed[0].IdentityType != "AssumedRole" {
		return lin, nil // not an assumed-role event → no lineage
	}
	lin.Applicable = true
	lin.SourceIdentity = seed[0].SourceIdentity
	if seed[0].AccessKeyID == "" {
		return lin, nil // no key to follow
	}

	// Walk up: each hop is the AssumeRole event whose issuedKeyId equals the child
	// session's key; its userIdentity is the parent, whose own key feeds the next hop.
	q := fmt.Sprintf(`WITH RECURSIVE chain AS (
  SELECT seq, eventName, eventTime, sourceIPAddress, identityType, identityArn, userName, accountId, roleArn, sessionName, invokedBy, accessKeyId AS caller_key, 1 AS depth
  FROM events WHERE issuedKeyId = %s AND issuedKeyId <> '' AND issuedKeyId IS DISTINCT FROM accessKeyId
  UNION ALL
  SELECT e.seq, e.eventName, e.eventTime, e.sourceIPAddress, e.identityType, e.identityArn, e.userName, e.accountId, e.roleArn, e.sessionName, e.invokedBy, e.accessKeyId, c.depth + 1
  FROM events e JOIN chain c ON e.issuedKeyId = c.caller_key
  WHERE c.identityType = 'AssumedRole' AND c.caller_key <> '' AND e.issuedKeyId IS DISTINCT FROM e.accessKeyId AND c.depth < %d
)
SELECT seq, eventName, eventTime, sourceIPAddress, identityType, identityArn, userName, accountId, roleArn, sessionName, invokedBy
FROM chain ORDER BY depth DESC;`, sqlStr(seed[0].AccessKeyID), lineageMaxDepth)

	var rows []struct {
		Seq          int64  `json:"seq"`
		EventName    string `json:"eventName"`
		EventTime    string `json:"eventTime"`
		SourceIP     string `json:"sourceIPAddress"`
		IdentityType string `json:"identityType"`
		IdentityArn  string `json:"identityArn"`
		UserName     string `json:"userName"`
		AccountID    string `json:"accountId"`
		RoleArn      string `json:"roleArn"`
		SessionName  string `json:"sessionName"`
		InvokedBy    string `json:"invokedBy"`
	}
	if err := s.queryJSON(q, &rows); err != nil {
		return lin, err
	}
	for _, r := range rows {
		lin.Nodes = append(lin.Nodes, LineageNode{
			IdentityType: r.IdentityType, Arn: r.IdentityArn, UserName: r.UserName, AccountID: r.AccountID,
			RoleArn: r.RoleArn, SessionName: r.SessionName, InvokedBy: r.InvokedBy,
			ViaSeq: r.Seq, ViaEvent: r.EventName, ViaTime: r.EventTime, ViaSourceIP: r.SourceIP,
		})
	}
	// Complete when the origin-most node we found is a real principal, not a role
	// whose own assumption we couldn't locate.
	if len(lin.Nodes) > 0 && lin.Nodes[0].IdentityType != "AssumedRole" {
		lin.Complete = true
	}
	return lin, nil
}

// ---- Full lineage graph (the "Lineage view"): sessions are nodes, AssumeRole
// events are edges. Each session has exactly one parent (issuedKeyId is unique),
// so the structure is a tree rooted at a real principal. ----

// GraphNode is one session (or root principal) in the lineage tree.
type GraphNode struct {
	ID           string `json:"id"`   // accessKeyId, or "arn:<arn>" for keyless roots
	Kind         string `json:"kind"` // origin | ancestor | parent | current | sibling | descendant
	IdentityType string `json:"identityType"`
	Arn          string `json:"arn"`
	RoleArn      string `json:"roleArn"`
	RoleName     string `json:"roleName"`
	UserName     string `json:"userName"`
	SessionName  string `json:"sessionName"`
	AccountID    string `json:"accountId"`
	AccessKeyID  string `json:"accessKeyId"`
	InvokedBy    string `json:"invokedBy"`            // for AWSService: the calling service (e.g. config.amazonaws.com)
	OriginKind   string `json:"originKind,omitempty"` // sso | service-linked | service (for the UI badge)
	Events       int    `json:"events"`               // activity count (events performed by this SESSION key)
	ChildCount   int    `json:"childCount"`           // total AssumeRole calls this session made (for expand affordance)
	// Role-level rollup: a busy role is assumed many times (many session keys), so a
	// single session node can legitimately show 0 activity while the role is active.
	// These give the whole-role picture so that 0 isn't misread as "role did nothing".
	RoleEvents   int `json:"roleEvents,omitempty"`   // events across every session of this role
	RoleSessions int `json:"roleSessions,omitempty"` // distinct session keys the role minted
	// event nodes (kind "event") - the session's actual activity, expanded on demand.
	Seq         int64  `json:"seq,omitempty"`
	EventName   string `json:"eventName,omitempty"`
	EventSource string `json:"eventSource,omitempty"`
	EventTime   string `json:"eventTime,omitempty"`
	ErrorCode   string `json:"errorCode,omitempty"`
	ReadOnly    bool   `json:"readOnly,omitempty"`
	Resource    string `json:"resource,omitempty"` // the object the API acted on (KMS key, S3 object, secret, …)
}

// GraphEdge is the AssumeRole that created Child from Parent.
type GraphEdge struct {
	Parent       string `json:"parent"`
	Child        string `json:"child"`
	ViaSeq       int64  `json:"viaSeq"`
	ViaEvent     string `json:"viaEvent"`
	ViaTime      string `json:"viaTime"`
	ViaIP        string `json:"viaIP"`
	CrossAccount bool   `json:"crossAccount,omitempty"` // parent and child live in different accounts
}

type LineageTree struct {
	Applicable bool        `json:"applicable"`
	CurrentID  string      `json:"currentId"`
	RootID     string      `json:"rootId"`
	Nodes      []GraphNode `json:"nodes"`
	Edges      []GraphEdge `json:"edges"`
	Notes      []string    `json:"notes"`
}

const graphChildCap = 40 // children shown per node (with an honest "N more" note)

// nodeID / role parsing helpers ------------------------------------------------

func nodeID(accessKeyID, arn string) string {
	if accessKeyID != "" {
		return accessKeyID
	}
	return "arn:" + arn
}

func roleTail(arn string) string {
	if arn == "" {
		return ""
	}
	if ps := ssoPermissionSet(arn); ps != "" {
		return ps // IAM Identity Center (SSO) reserved role → the permission set, not "aws-reserved"
	}
	p := strings.Split(arn, "/")
	if strings.Contains(arn, "aws-service-role/") {
		return p[len(p)-1] // service-linked role → the AWSServiceRoleFor… name, not "aws-service-role"
	}
	if len(p) > 1 {
		return p[1] // for assumed-role/Role/Session and role/Role, index 1 is the role name
	}
	return arn
}

// originKind classifies a node's origin for a UI badge: sso | service-linked |
// service (an AWS service), or "" for an ordinary principal/role. NOTE: invokedBy is
// deliberately NOT used - a customer role driven by an AWS service (CloudFormation
// service role, SSM Automation, …) carries invokedBy but is still a customer role.
func originKind(identityType, roleArn, identityArn string) string {
	switch {
	case isSSOSession(roleArn, identityArn):
		return "sso"
	case strings.Contains(roleArn, "aws-service-role/") || strings.Contains(identityArn, "aws-service-role/") ||
		strings.Contains(roleArn, "AWSServiceRoleFor") || strings.Contains(identityArn, "AWSServiceRoleFor"):
		// the AWSServiceRoleFor… form catches zero-activity children resolved from the
		// STS session arn (which lacks the aws-service-role/ path).
		return "service-linked"
	case identityType == "AWSService":
		return "service"
	}
	return ""
}

// ssoPermissionSet extracts the AWS IAM Identity Center (SSO) permission-set name
// from a reserved SSO role/identity arn, or "" if it isn't one. These look like
//
//	…:role/aws-reserved/sso.amazonaws.com/<region>/AWSReservedSSO_<Perm>_<hash>
//
// and the session arn  …:assumed-role/AWSReservedSSO_<Perm>_<hash>/<user>.
// The trailing _<hash> is dropped; permission-set names may themselves contain "_".
func ssoPermissionSet(arn string) string {
	for _, seg := range strings.Split(arn, "/") {
		if strings.HasPrefix(seg, "AWSReservedSSO_") {
			name := strings.TrimPrefix(seg, "AWSReservedSSO_")
			if j := strings.LastIndex(name, "_"); j > 0 {
				name = name[:j] // drop the trailing _<hash>
			}
			return name
		}
	}
	return ""
}

// isSSOSession reports whether a session is an IAM Identity Center (SSO) session,
// from either its role arn (the aws-reserved path) or its assumed-role identity arn.
func isSSOSession(roleArn, identityArn string) bool {
	return strings.Contains(roleArn, "aws-reserved/sso.amazonaws.com") ||
		ssoPermissionSet(roleArn) != "" || ssoPermissionSet(identityArn) != ""
}

// parseStsArn pulls the account, role and session out of an assumed-role STS arn:
// arn:aws:sts::<acct>:assumed-role/<role>/<session>
func parseStsArn(arn string) (account, role, session string) {
	parts := strings.Split(arn, ":")
	if len(parts) >= 6 {
		account = parts[4]
		seg := strings.SplitN(parts[5], "/", 3)
		if len(seg) >= 2 {
			role = seg[1]
		}
		if len(seg) >= 3 {
			session = seg[2]
		}
	}
	return
}

// childRow is one AssumeRole edge out of a session.
type childRow struct {
	Seq       int64  `json:"seq"`
	EventName string `json:"eventName"`
	EventTime string `json:"eventTime"`
	SourceIP  string `json:"sourceIPAddress"`
	ChildKey  string `json:"child_key"`
	ChildArn  string `json:"child_arn"`
}

// childrenOf returns the AssumeRole edges a session made, capped; trunc=true when
// there were more than the cap.
func (s *Store) childrenOf(key string) (rows []childRow, trunc bool, err error) {
	if key == "" {
		return nil, false, nil
	}
	q := fmt.Sprintf(`SELECT seq, eventName, eventTime, sourceIPAddress, issuedKeyId AS child_key, issuedRoleArn AS child_arn
FROM events WHERE accessKeyId = %s AND eventName LIKE 'AssumeRole%%' AND issuedKeyId <> '' AND issuedKeyId IS DISTINCT FROM accessKeyId
ORDER BY eventTime LIMIT %d;`, sqlStr(key), graphChildCap+1)
	if err = s.queryJSON(q, &rows); err != nil {
		return nil, false, err
	}
	if len(rows) > graphChildCap {
		rows = rows[:graphChildCap]
		trunc = true
	}
	return rows, trunc, nil
}

func sqlValues(vals []string) string {
	q := make([]string, len(vals))
	for i, v := range vals {
		q[i] = sqlStr(v)
	}
	return strings.Join(q, ",")
}

func uniqNonEmpty(in []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, v := range in {
		if v != "" && !seen[v] {
			seen[v] = true
			out = append(out, v)
		}
	}
	return out
}

type sident struct {
	Type, Arn, RoleArn, UserName, SessionName, AccountID, InvokedBy string
}

// resolveIdentities looks up each session key's identity from its OWN events.
// Keys that performed no events won't appear (caller falls back to the edge arn).
func (s *Store) resolveIdentities(keys []string) (map[string]sident, error) {
	m := map[string]sident{}
	ks := uniqNonEmpty(keys)
	if len(ks) == 0 {
		return m, nil
	}
	q := "SELECT accessKeyId AS k, any_value(identityType) AS t, any_value(identityArn) AS a, any_value(roleArn) AS r, any_value(userName) AS u, any_value(sessionName) AS sn, any_value(accountId) AS ac, any_value(invokedBy) AS ib " +
		"FROM events WHERE accessKeyId IN (" + sqlValues(ks) + ") GROUP BY k;"
	var raw []struct {
		K  string `json:"k"`
		T  string `json:"t"`
		A  string `json:"a"`
		R  string `json:"r"`
		U  string `json:"u"`
		Sn string `json:"sn"`
		Ac string `json:"ac"`
		Ib string `json:"ib"`
	}
	if err := s.queryJSON(q, &raw); err != nil {
		return m, err
	}
	for _, r := range raw {
		m[r.K] = sident{Type: r.T, Arn: r.A, RoleArn: r.R, UserName: r.U, SessionName: r.Sn, AccountID: r.Ac, InvokedBy: r.Ib}
	}
	return m, nil
}

// resourceExpr picks the object an event acted on. CloudTrail's top-level
// `resources` array is the most reliable (present for KMS, S3, IAM, Lambda, …);
// we fall back to the common requestParameters identifiers for events that omit it.
const resourceExpr = `COALESCE(
    NULLIF(json_extract_string(raw,'$.resources[0].ARN'),''),
    NULLIF(json_extract_string(raw,'$.requestParameters.keyId'),''),
    NULLIF(json_extract_string(raw,'$.requestParameters.secretId'),''),
    NULLIF(json_extract_string(raw,'$.requestParameters.roleArn'),''),
    NULLIF(json_extract_string(raw,'$.requestParameters.roleName'),''),
    NULLIF(json_extract_string(raw,'$.requestParameters.functionName'),''),
    NULLIF(json_extract_string(raw,'$.requestParameters.bucketName'),''),
    NULLIF(json_extract_string(raw,'$.requestParameters.tableName'),''),
    NULLIF(json_extract_string(raw,'$.requestParameters.parameterName'),''),
    NULLIF(json_extract_string(raw,'$.requestParameters.name'),''),
    NULLIF(json_extract_string(raw,'$.requestParameters.userName'),''),
    NULLIF(json_extract_string(raw,'$.requestParameters.policyArn'),''),
    NULLIF(json_extract_string(raw,'$.requestParameters.groupName'),''),
    NULLIF(json_extract_string(raw,'$.requestParameters.instanceId'),''),
    '') AS resource`

// roleActivity returns, per role arn, the total events and distinct session keys
// across the whole role - the rollup that contextualises a session node's own count.
func (s *Store) roleActivity(roleArns []string) (map[string][2]int, error) {
	m := map[string][2]int{}
	rs := uniqNonEmpty(roleArns)
	if len(rs) == 0 {
		return m, nil
	}
	q := "SELECT roleArn AS r, count(*) AS c, count(DISTINCT accessKeyId) AS sess FROM events WHERE roleArn IN (" + sqlValues(rs) + ") GROUP BY r;"
	var raw []struct {
		R    string `json:"r"`
		C    int    `json:"c"`
		Sess int    `json:"sess"`
	}
	if err := s.queryJSON(q, &raw); err != nil {
		return m, err
	}
	for _, x := range raw {
		m[x.R] = [2]int{x.C, x.Sess}
	}
	return m, nil
}

// countBy runs "SELECT accessKeyId, count(*) ... GROUP BY" with an optional extra
// predicate, returning key→count. Used for activity counts and child counts.
func (s *Store) countBy(keys []string, extra string) (map[string]int, error) {
	m := map[string]int{}
	ks := uniqNonEmpty(keys)
	if len(ks) == 0 {
		return m, nil
	}
	where := "accessKeyId IN (" + sqlValues(ks) + ")"
	if extra != "" {
		where += " AND " + extra
	}
	q := "SELECT accessKeyId AS k, count(*) AS c FROM events WHERE " + where + " GROUP BY k;"
	var raw []struct {
		K string `json:"k"`
		C int    `json:"c"`
	}
	if err := s.queryJSON(q, &raw); err != nil {
		return m, err
	}
	for _, r := range raw {
		m[r.K] = r.C
	}
	return m, nil
}

// ancRow is one step of the ancestry walk (an AssumeRole event + its caller).
type ancRow struct {
	Seq          int64  `json:"seq"`
	EventName    string `json:"eventName"`
	EventTime    string `json:"eventTime"`
	SourceIP     string `json:"sourceIPAddress"`
	IdentityType string `json:"identityType"`
	IdentityArn  string `json:"identityArn"`
	UserName     string `json:"userName"`
	AccountID    string `json:"accountId"`
	RoleArn      string `json:"roleArn"`
	SessionName  string `json:"sessionName"`
	InvokedBy    string `json:"invokedBy"`
	NodeKey      string `json:"node_key"`
}

func (s *Store) ancestry(startKey string) ([]ancRow, error) {
	q := fmt.Sprintf(`WITH RECURSIVE chain AS (
  SELECT seq, eventName, eventTime, sourceIPAddress, identityType, identityArn, userName, accountId, roleArn, sessionName, invokedBy, accessKeyId AS node_key, 1 AS depth
  FROM events WHERE issuedKeyId = %s AND issuedKeyId <> '' AND issuedKeyId IS DISTINCT FROM accessKeyId
  UNION ALL
  SELECT e.seq, e.eventName, e.eventTime, e.sourceIPAddress, e.identityType, e.identityArn, e.userName, e.accountId, e.roleArn, e.sessionName, e.invokedBy, e.accessKeyId, c.depth + 1
  FROM events e JOIN chain c ON e.issuedKeyId = c.node_key
  WHERE c.identityType = 'AssumedRole' AND c.node_key <> '' AND e.issuedKeyId IS DISTINCT FROM e.accessKeyId AND c.depth < %d
)
SELECT seq, eventName, eventTime, sourceIPAddress, identityType, identityArn, userName, accountId, roleArn, sessionName, invokedBy, node_key FROM chain ORDER BY depth;`, sqlStr(startKey), lineageMaxDepth)
	var rows []ancRow
	err := s.queryJSON(q, &rows)
	return rows, err
}

// LineageGraph builds the lineage tree centred on event `seq`: the full ancestry
// up to the origin, the immediate parent's other children (siblings), and the
// event's own direct children. Deeper nodes are fetched on demand via
// LineageChildren (each carries childCount so the UI knows it's expandable).
func (s *Store) LineageGraph(seq int64) (LineageTree, error) {
	tree := LineageTree{Nodes: []GraphNode{}, Edges: []GraphEdge{}, Notes: []string{}}

	var seed []struct {
		AccessKeyID        string `json:"accessKeyId"`
		IdentityType       string `json:"identityType"`
		IdentityArn        string `json:"identityArn"`
		RoleArn            string `json:"roleArn"`
		SessionName        string `json:"sessionName"`
		UserName           string `json:"userName"`
		AccountID          string `json:"accountId"`
		InvokedBy          string `json:"invokedBy"`
		RecipientAccountID string `json:"recipientAccountId"`
		SourceIdentity     string `json:"sourceIdentity"`
	}
	if err := s.queryJSON(fmt.Sprintf("SELECT accessKeyId, identityType, identityArn, roleArn, sessionName, userName, accountId, invokedBy, recipientAccountId, sourceIdentity FROM events WHERE seq=%d;", seq), &seed); err != nil {
		return tree, err
	}
	if len(seed) == 0 || seed[0].IdentityType != "AssumedRole" || seed[0].AccessKeyID == "" {
		return tree, nil
	}
	ks := seed[0].AccessKeyID
	tree.Applicable = true
	tree.CurrentID = ks

	nodes := map[string]*GraphNode{}
	var order []string
	ensure := func(id string) *GraphNode {
		if n, ok := nodes[id]; ok {
			return n
		}
		n := &GraphNode{ID: id}
		nodes[id] = n
		order = append(order, id)
		return n
	}

	// current session
	cur := ensure(ks)
	*cur = GraphNode{ID: ks, Kind: "current", IdentityType: "AssumedRole", Arn: seed[0].IdentityArn,
		RoleArn: seed[0].RoleArn, RoleName: roleTail(seed[0].RoleArn), UserName: seed[0].UserName,
		SessionName: seed[0].SessionName, AccountID: seed[0].AccountID, AccessKeyID: ks, InvokedBy: seed[0].InvokedBy}

	// ancestry
	anc, err := s.ancestry(ks)
	if err != nil {
		return tree, err
	}
	// Filter self-loops / cycles: some events carry accessKeyId == issuedKeyId, so the
	// recursive walk revisits the same key and yields bogus self-referential ancestors
	// (seen with certain SSO sessions → 12 dangling self-edges). Stop at the first repeat.
	{
		seen := map[string]bool{ks: true}
		prev := ks
		var clean []ancRow
		for _, a := range anc {
			id := nodeID(a.NodeKey, a.IdentityArn)
			if id == prev || seen[id] {
				break
			}
			seen[id] = true
			prev = id
			clean = append(clean, a)
		}
		anc = clean
	}
	var parentKey, parentID string
	prevID := ks
	for i := range anc {
		a := anc[i]
		id := nodeID(a.NodeKey, a.IdentityArn)
		n := ensure(id)
		kind := "ancestor"
		if i == 0 {
			kind = "parent"
			parentKey, parentID = a.NodeKey, id
		}
		*n = GraphNode{ID: id, Kind: kind, IdentityType: a.IdentityType, Arn: a.IdentityArn,
			RoleArn: a.RoleArn, RoleName: roleTail(a.RoleArn), UserName: a.UserName, SessionName: a.SessionName,
			AccountID: a.AccountID, AccessKeyID: a.NodeKey, InvokedBy: a.InvokedBy}
		tree.Edges = append(tree.Edges, GraphEdge{Parent: id, Child: prevID, ViaSeq: a.Seq, ViaEvent: a.EventName, ViaTime: a.EventTime, ViaIP: a.SourceIP})
		prevID = id
	}
	if len(anc) == 0 {
		tree.RootID = ks
		// Distinguish a cross-account / SSO origin from a merely-missing AssumeRole:
		// a federated Identity Center login, a role used in an account other than the
		// one that owns it, or an assumption logged only in the caller's account are
		// all security-relevant signals worth naming instead of "can't find it".
		roleAcct, recip := seed[0].AccountID, seed[0].RecipientAccountID
		perm := ssoPermissionSet(seed[0].RoleArn)
		if perm == "" {
			perm = ssoPermissionSet(seed[0].IdentityArn)
		}
		switch {
		case isSSOSession(seed[0].RoleArn, seed[0].IdentityArn):
			ps := perm
			if ps == "" {
				ps = "(unknown permission set)"
			}
			tree.Notes = append(tree.Notes, fmt.Sprintf("AWS IAM Identity Center (SSO) session - permission set %s. Its origin is a federated SSO login (centralised in your Identity Center account), not an in-account AssumeRole.", ps))
		case roleAcct != "" && recip != "" && roleAcct != recip:
			tree.Notes = append(tree.Notes, fmt.Sprintf("Cross-account: this role is owned by account %s but used in account %s - the assuming principal is logged in the role's account, not this trail.", roleAcct, recip))
		case seed[0].SourceIdentity != "":
			tree.Notes = append(tree.Notes, fmt.Sprintf("The AssumeRole that created this session isn't in this trail (source identity %q). The origin is likely a federated/SSO login or another account.", seed[0].SourceIdentity))
		default:
			tree.Notes = append(tree.Notes, "The AssumeRole that created this session isn't in this trail - it's outside the time window, a federated/SSO login, or an assumption from another account (logged in the caller's account).")
		}
	} else {
		top := anc[len(anc)-1]
		topID := nodeID(top.NodeKey, top.IdentityArn)
		if top.IdentityType != "AssumedRole" {
			nodes[topID].Kind = "origin"
			tree.RootID = topID
		} else {
			tree.RootID = topID
			tree.Notes = append(tree.Notes, "Ancestry incomplete above "+top.IdentityArn+" (its AssumeRole isn't in the dataset).")
		}
	}

	// keys whose identity we must resolve from own-events (siblings + children)
	var resolveKeys []string
	// edge-arn fallback for keys with no own events
	edgeArn := map[string]string{}

	addChild := func(parentNodeID, parentKey, kind string, c childRow) {
		id := nodeID(c.ChildKey, c.ChildArn)
		if id == parentNodeID {
			return // self-loop (accessKeyId == issuedKeyId) - not a real child
		}
		if _, exists := nodes[id]; !exists {
			ensure(id)
			nodes[id].Kind = kind
			nodes[id].AccessKeyID = c.ChildKey
			resolveKeys = append(resolveKeys, c.ChildKey)
			edgeArn[c.ChildKey] = c.ChildArn
		}
		tree.Edges = append(tree.Edges, GraphEdge{Parent: parentNodeID, Child: id, ViaSeq: c.Seq, ViaEvent: c.EventName, ViaTime: c.EventTime, ViaIP: c.SourceIP})
	}

	// parent's children → siblings (S is already present, so it's just skipped)
	if parentKey != "" {
		kids, trunc, err := s.childrenOf(parentKey)
		if err != nil {
			return tree, err
		}
		for _, c := range kids {
			if c.ChildKey == ks {
				continue // that's S - edge parent→S already added by ancestry
			}
			addChild(parentID, parentKey, "sibling", c)
		}
		if trunc {
			tree.Notes = append(tree.Notes, fmt.Sprintf("Showing the first %d of the parent's children.", graphChildCap))
		}
	}

	// current session's own children
	kids, trunc, err := s.childrenOf(ks)
	if err != nil {
		return tree, err
	}
	for _, c := range kids {
		addChild(ks, ks, "descendant", c)
	}
	if trunc {
		tree.Notes = append(tree.Notes, fmt.Sprintf("Showing the first %d of this session's children.", graphChildCap))
	}

	// resolve sibling/child identities from their own events, else parse the arn
	idents, err := s.resolveIdentities(resolveKeys)
	if err != nil {
		return tree, err
	}
	for _, k := range uniqNonEmpty(resolveKeys) {
		n := nodes[k]
		if n == nil {
			continue
		}
		if id, ok := idents[k]; ok && id.Type != "" {
			n.IdentityType = id.Type
			n.Arn = id.Arn
			n.RoleArn = id.RoleArn
			n.RoleName = roleTail(id.RoleArn)
			n.UserName = id.UserName
			n.SessionName = id.SessionName
			n.AccountID = id.AccountID
			n.InvokedBy = id.InvokedBy
		} else {
			acct, role, sess := parseStsArn(edgeArn[k])
			n.IdentityType = "AssumedRole"
			n.Arn = edgeArn[k]
			n.RoleName = role
			n.SessionName = sess
			n.AccountID = acct
			if role != "" && acct != "" {
				n.RoleArn = "arn:aws:iam::" + acct + ":role/" + role
			}
		}
	}

	// activity + child counts for every session node
	var allKeys []string
	for _, id := range order {
		if k := nodes[id].AccessKeyID; k != "" {
			allKeys = append(allKeys, k)
		}
	}
	if acts, err := s.countBy(allKeys, ""); err == nil {
		for k, c := range acts {
			if nodes[k] != nil {
				nodes[k].Events = c
			}
		}
	}
	if ccs, err := s.countBy(allKeys, "eventName LIKE 'AssumeRole%' AND issuedKeyId <> '' AND issuedKeyId IS DISTINCT FROM accessKeyId"); err == nil {
		for k, c := range ccs {
			if nodes[k] != nil {
				nodes[k].ChildCount = c
			}
		}
	}

	// A node provably has at least as many children as edges we drew from it. Keyless
	// nodes (AWS services, unresolved roots) have no accessKeyId, so countBy can't see
	// them and returns 0 - floor childCount at the out-degree so a service origin with
	// a visible child never reads "child sessions: 0".
	outdeg := map[string]int{}
	for _, e := range tree.Edges {
		if e.Parent != e.Child { // ignore any self-loop
			outdeg[e.Parent]++
		}
	}
	for _, id := range order {
		if outdeg[id] > nodes[id].ChildCount {
			nodes[id].ChildCount = outdeg[id]
		}
	}

	// Flag assumptions that cross an account boundary (caller and role in different
	// accounts) - a cross-account role-assumption we CAN see end-to-end.
	xNoted := false
	for i := range tree.Edges {
		p, c := nodes[tree.Edges[i].Parent], nodes[tree.Edges[i].Child]
		if p != nil && c != nil && p.AccountID != "" && c.AccountID != "" && p.AccountID != c.AccountID {
			tree.Edges[i].CrossAccount = true
			if !xNoted {
				tree.Notes = append(tree.Notes, fmt.Sprintf("Cross-account assumption in this chain: account %s → %s.", p.AccountID, c.AccountID))
				xNoted = true
			}
		}
	}

	// role-level rollup so a 0-activity session node still shows how busy its role is
	var roleArns []string
	for _, id := range order {
		if ra := nodes[id].RoleArn; ra != "" {
			roleArns = append(roleArns, ra)
		}
	}
	if ra, err := s.roleActivity(roleArns); err == nil {
		for _, id := range order {
			if v, ok := ra[nodes[id].RoleArn]; ok {
				nodes[id].RoleEvents, nodes[id].RoleSessions = v[0], v[1]
			}
		}
	}

	for _, id := range order {
		n := nodes[id]
		n.OriginKind = originKind(n.IdentityType, n.RoleArn, n.Arn)
	}

	for _, id := range order {
		tree.Nodes = append(tree.Nodes, *nodes[id])
	}
	return tree, nil
}

// LineageChildren returns the direct children of one session (for lazy expansion
// in the graph), resolved and counted like LineageGraph's nodes.
func (s *Store) LineageChildren(accessKeyID string) (LineageTree, error) {
	tree := LineageTree{Nodes: []GraphNode{}, Edges: []GraphEdge{}, Notes: []string{}}
	kids, trunc, err := s.childrenOf(accessKeyID)
	if err != nil {
		return tree, err
	}
	var keys []string
	edgeArn := map[string]string{}
	for _, c := range kids {
		keys = append(keys, c.ChildKey)
		edgeArn[c.ChildKey] = c.ChildArn
		tree.Edges = append(tree.Edges, GraphEdge{Parent: accessKeyID, Child: nodeID(c.ChildKey, c.ChildArn), ViaSeq: c.Seq, ViaEvent: c.EventName, ViaTime: c.EventTime, ViaIP: c.SourceIP})
	}
	idents, err := s.resolveIdentities(keys)
	if err != nil {
		return tree, err
	}
	acts, _ := s.countBy(keys, "")
	ccs, _ := s.countBy(keys, "eventName LIKE 'AssumeRole%' AND issuedKeyId <> '' AND issuedKeyId IS DISTINCT FROM accessKeyId")
	for _, c := range kids {
		id := nodeID(c.ChildKey, c.ChildArn)
		n := GraphNode{ID: id, Kind: "descendant", AccessKeyID: c.ChildKey, Events: acts[c.ChildKey], ChildCount: ccs[c.ChildKey]}
		if idn, ok := idents[c.ChildKey]; ok && idn.Type != "" {
			n.IdentityType = idn.Type
			n.Arn = idn.Arn
			n.RoleArn = idn.RoleArn
			n.RoleName = roleTail(idn.RoleArn)
			n.UserName = idn.UserName
			n.SessionName = idn.SessionName
			n.AccountID = idn.AccountID
			n.InvokedBy = idn.InvokedBy
		} else {
			acct, role, sess := parseStsArn(edgeArn[c.ChildKey])
			n.IdentityType = "AssumedRole"
			n.Arn = edgeArn[c.ChildKey]
			n.RoleName = role
			n.SessionName = sess
			n.AccountID = acct
			if role != "" && acct != "" {
				n.RoleArn = "arn:aws:iam::" + acct + ":role/" + role
			}
		}
		tree.Nodes = append(tree.Nodes, n)
	}
	// role-level rollup, matching LineageGraph so expanded nodes read consistently
	var roleArns []string
	for _, n := range tree.Nodes {
		if n.RoleArn != "" {
			roleArns = append(roleArns, n.RoleArn)
		}
	}
	if ra, err := s.roleActivity(roleArns); err == nil {
		for i := range tree.Nodes {
			if v, ok := ra[tree.Nodes[i].RoleArn]; ok {
				tree.Nodes[i].RoleEvents, tree.Nodes[i].RoleSessions = v[0], v[1]
			}
		}
	}
	for i := range tree.Nodes {
		tree.Nodes[i].OriginKind = originKind(tree.Nodes[i].IdentityType, tree.Nodes[i].RoleArn, tree.Nodes[i].Arn)
	}
	if trunc {
		tree.Notes = append(tree.Notes, fmt.Sprintf("Showing the first %d children.", graphChildCap))
	}
	return tree, nil
}

const eventNodeCap = 60 // events shown when expanding a session's activity

// LineageEvents returns a session's own events as leaf nodes (kind "event"), for
// expanding the activity count in the graph. Capped, newest-order by time.
func (s *Store) LineageEvents(accessKeyID string) (LineageTree, error) {
	tree := LineageTree{Nodes: []GraphNode{}, Edges: []GraphEdge{}, Notes: []string{}}
	if accessKeyID == "" {
		return tree, nil
	}
	q := fmt.Sprintf("SELECT seq, eventName, eventSource, eventTime, errorCode, readOnly, %s FROM events WHERE accessKeyId = %s ORDER BY eventTime LIMIT %d;", resourceExpr, sqlStr(accessKeyID), eventNodeCap+1)
	var rows []struct {
		Seq         int64  `json:"seq"`
		EventName   string `json:"eventName"`
		EventSource string `json:"eventSource"`
		EventTime   string `json:"eventTime"`
		ErrorCode   string `json:"errorCode"`
		ReadOnly    bool   `json:"readOnly"`
		Resource    string `json:"resource"`
	}
	if err := s.queryJSON(q, &rows); err != nil {
		return tree, err
	}
	trunc := false
	if len(rows) > eventNodeCap {
		rows = rows[:eventNodeCap]
		trunc = true
	}
	for _, r := range rows {
		id := fmt.Sprintf("ev:%d", r.Seq)
		tree.Nodes = append(tree.Nodes, GraphNode{ID: id, Kind: "event", Seq: r.Seq, EventName: r.EventName,
			EventSource: r.EventSource, EventTime: r.EventTime, ErrorCode: r.ErrorCode, ReadOnly: r.ReadOnly, Resource: r.Resource})
		tree.Edges = append(tree.Edges, GraphEdge{Parent: accessKeyID, Child: id, ViaSeq: r.Seq, ViaEvent: r.EventName, ViaTime: r.EventTime})
	}
	if trunc {
		tree.Notes = append(tree.Notes, fmt.Sprintf("Showing the first %d events.", eventNodeCap))
	}
	return tree, nil
}
