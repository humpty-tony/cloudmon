package store

import (
	"context"
	"database/sql"
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
	ViaSeq       int64   `json:"viaSeq"`
	ViaEvent     string  `json:"viaEvent"`
	ViaTime      string  `json:"viaTime"`
	ViaSourceIP  string  `json:"viaSourceIP"`
	Evidence     string  `json:"evidence"`
	EvidenceSeqs []int64 `json:"evidenceSeqs"`
}

// Lineage is a credential ancestry supported by the loaded evidence. Status and
// Reason explain where the walk stopped; Complete never verifies a human identity.
type Lineage struct {
	Applicable     bool          `json:"applicable"`     // recorded temporary credentials
	SourceIdentity string        `json:"sourceIdentity"` // recorded attribute, not verified human identity
	Complete       bool          `json:"complete"`       // reached a recorded non-session principal
	Status         string        `json:"status"`
	Reason         string        `json:"reason"`
	Nodes          []LineageNode `json:"nodes"` // origin-first → immediate parent
}

const lineageMaxDepth = 12

// ---- Full lineage graph (the "Lineage view"): sessions are nodes, AssumeRole
// events are edges. Only an unambiguous observed parent is drawn; conflicting
// evidence is explained instead of being flattened into a false chain. ----

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
	InvokedBy    string `json:"invokedBy"` // for AWSService: the calling service (e.g. config.amazonaws.com)
	IdentityNote string `json:"identityNote,omitempty"`
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
	Parent       string  `json:"parent"`
	Child        string  `json:"child"`
	ViaSeq       int64   `json:"viaSeq"`
	ViaEvent     string  `json:"viaEvent"`
	ViaTime      string  `json:"viaTime"`
	ViaIP        string  `json:"viaIP"`
	ViaUserAgent string  `json:"viaUserAgent,omitempty"`
	ViaRegion    string  `json:"viaRegion,omitempty"`
	ViaEventID   string  `json:"viaEventId,omitempty"`
	ViaMFA       string  `json:"viaMfa,omitempty"`
	Evidence     string  `json:"evidence,omitempty"`
	EvidenceSeqs []int64 `json:"evidenceSeqs,omitempty"`
	CrossAccount bool    `json:"crossAccount,omitempty"` // parent and child live in different accounts
}

type LineageTree struct {
	Snapshot   *Snapshot   `json:"snapshot,omitempty"`
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
		if strings.Contains(arn, ":assumed-role/") {
			return p[1]
		}
		return p[len(p)-1]
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
	case strings.Contains(roleArn, ":role/aws-service-role/"):
		// Require the observed service-linked role path, not a lookalike name.
		return "service-linked"
	case identityType == "AWSService":
		return "service"
	}
	return ""
}

// ssoPermissionSet extracts the AWS IAM Identity Center (SSO) permission-set name
// from an observed reserved SSO role ARN, or "" if its path is not recorded. These look like
//
//	…:role/aws-reserved/sso.amazonaws.com/<region>/AWSReservedSSO_<Perm>_<hash>
//
// A session ARN alone lacks this path and is not enough for classification.
// The trailing _<hash> is dropped; permission-set names may themselves contain "_".
func ssoPermissionSet(arn string) string {
	if !strings.Contains(arn, ":role/aws-reserved/sso.amazonaws.com/") {
		return ""
	}
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
	return strings.Contains(roleArn, ":role/aws-reserved/sso.amazonaws.com/") && ssoPermissionSet(roleArn) != ""
}

// parseStsArn pulls the account, role and session out of an assumed-role STS arn:
// arn:aws:sts::<acct>:assumed-role/<role>/<session>
func parseStsArn(arn string) (account, role, session string) {
	parts := strings.Split(arn, ":")
	if len(parts) == 6 && parts[2] == "sts" && strings.HasPrefix(parts[5], "assumed-role/") {
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

// childRow carries one qualified issuance edge.
type childRow struct {
	Seq                                                                                                                             int64
	EventName, EventTime, SourceIP, ChildKey, ChildArn, TargetRole, TargetPrincipal, CallerType, CallerArn, CallerAccount, Evidence string
	UserAgent, Region, EventID, MFA                                                                                                 string
	EvidenceSeqs                                                                                                                    []int64
}

func (s *lineageReader) childrenOf(key string) ([]childRow, bool, error) {
	if key == "" {
		return nil, false, nil
	}
	var keys []struct {
		K string `json:"k"`
	}
	q := fmt.Sprintf("SELECT DISTINCT issuedKeyId AS k FROM events WHERE accessKeyId=%s AND %s AND issuedKeyId IS DISTINCT FROM accessKeyId ORDER BY k LIMIT %d", sqlStr(key), issuancePredicate, graphChildCap+1)
	if err := s.queryJSON(q, &keys); err != nil {
		return nil, false, err
	}
	trunc := len(keys) > graphChildCap
	if trunc {
		keys = keys[:graphChildCap]
	}
	var rows []childRow
	for _, k := range keys {
		var uses []ancRow
		if err := s.queryJSON("SELECT "+lineageColumns+" FROM events WHERE accessKeyId="+sqlStr(k.K)+" ORDER BY try_cast(eventTime AS TIMESTAMPTZ) NULLS FIRST, seq LIMIT 1", &uses); err != nil {
			return nil, false, err
		}
		var child *ancRow
		if len(uses) > 0 {
			child = &uses[0]
		}
		r, _, reason, err := s.issuer(k.K, child)
		if err != nil {
			return nil, false, err
		}
		if r == nil {
			s.notes = append(s.notes, "Child credential omitted: "+reason)
			continue
		}
		if r.NodeKey != key {
			s.notes = append(s.notes, "Child credential has a different or missing caller key in the selected observation; omitted.")
			continue
		}
		rows = append(rows, childRow{Seq: r.Seq, EventName: r.EventName, EventTime: r.EventTime, SourceIP: r.SourceIP, UserAgent: r.UserAgent, Region: r.Region, EventID: r.EventID, MFA: r.MFA, ChildKey: k.K, ChildArn: r.IssuedArn, TargetRole: r.TargetRole, TargetPrincipal: r.TargetPrincipal, CallerType: r.IdentityType, CallerArn: r.IdentityArn, CallerAccount: r.AccountID, Evidence: r.Evidence, EvidenceSeqs: r.EvidenceSeqs})
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
	Type, Arn, RoleArn, UserName, SessionName, AccountID, InvokedBy, Note string
}

// resolveIdentities looks up each session key's identity from its OWN events.
// Keys that performed no events won't appear (caller falls back to the edge arn).
func (s *lineageReader) resolveIdentities(keys []string) (map[string]sident, error) {
	m := map[string]sident{}
	ks := uniqNonEmpty(keys)
	if len(ks) == 0 {
		return m, nil
	}
	q := "SELECT accessKeyId AS k, identityType AS t, identityArn AS a, roleArn AS r, userName AS u, sessionName AS sn, accountId AS ac, invokedBy AS ib, greatest(count(DISTINCT nullif(identityArn,'')) OVER (PARTITION BY accessKeyId), count(DISTINCT nullif(identityType,'')) OVER (PARTITION BY accessKeyId), count(DISTINCT nullif(roleArn,'')) OVER (PARTITION BY accessKeyId), count(DISTINCT nullif(accountId,'')) OVER (PARTITION BY accessKeyId)) AS variants " +
		"FROM events WHERE accessKeyId IN (" + sqlValues(ks) + ") QUALIFY row_number() OVER (PARTITION BY accessKeyId ORDER BY (coalesce(identityArn,'') <> '') DESC, seq) = 1;"

	var raw []struct {
		Variants int    `json:"variants"`
		K        string `json:"k"`
		T        string `json:"t"`
		A        string `json:"a"`
		R        string `json:"r"`
		U        string `json:"u"`
		Sn       string `json:"sn"`
		Ac       string `json:"ac"`
		Ib       string `json:"ib"`
	}
	if err := s.queryJSON(q, &raw); err != nil {
		return m, err
	}
	for _, r := range raw {
		if r.Variants > 1 {
			m[r.K] = sident{Note: "Conflicting identities use this access key; showing issuance evidence only."}
			continue
		}
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
func (s *lineageReader) roleActivity(roleArns []string) (map[string][2]int, error) {
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
func (s *lineageReader) countBy(keys []string, extra string) (map[string]int, error) {
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

// LineageGraph builds the lineage tree centred on event `seq`: the full ancestry
// up to the origin, the immediate parent's other children (siblings), and the
// event's own direct children. Deeper nodes are fetched on demand via
// LineageChildren (each carries childCount so the UI knows it's expandable).
func (s *lineageReader) LineageGraph(seq int64) (LineageTree, error) {
	tree := LineageTree{Nodes: []GraphNode{}, Edges: []GraphEdge{}, Notes: []string{}}

	seedRow, err := s.seed(seq)
	if err != nil {
		return tree, err
	}
	if seedRow == nil || !seedRow.temporary() {
		return tree, nil
	}
	if seedRow.NodeKey == "" {
		tree.Applicable = true
		tree.Notes = append(tree.Notes, "No access key is recorded; credential links cannot be established.")
		return tree, nil
	}
	seed := []ancRow{*seedRow}
	ks := seed[0].NodeKey
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
	*cur = GraphNode{ID: ks, Kind: "current", IdentityType: seed[0].IdentityType, Arn: seed[0].IdentityArn,
		RoleArn: seed[0].RoleArn, RoleName: roleTail(seed[0].RoleArn), UserName: seed[0].UserName,
		SessionName: seed[0].SessionName, AccountID: seed[0].AccountID, AccessKeyID: ks, InvokedBy: seed[0].InvokedBy}

	// ancestry
	anc, status, reason, err := s.ancestry(seed[0])
	if err != nil {
		return tree, err
	}
	if status != "observed" {
		tree.Notes = append(tree.Notes, reason)
	}
	var parentKey, parentID string
	prevID := ks
	for i := range anc {
		a := anc[i]
		id := ancestorID(a)
		n := ensure(id)
		kind := "ancestor"
		if i == 0 {
			kind = "parent"
			parentKey, parentID = a.NodeKey, id
		}
		*n = GraphNode{ID: id, Kind: kind, IdentityType: a.IdentityType, Arn: a.IdentityArn,
			RoleArn: a.RoleArn, RoleName: roleTail(a.RoleArn), UserName: a.UserName, SessionName: a.SessionName,
			AccountID: a.AccountID, AccessKeyID: a.NodeKey, InvokedBy: a.InvokedBy}
		tree.Edges = append(tree.Edges, GraphEdge{Parent: id, Child: prevID, ViaSeq: a.Seq, ViaEvent: a.EventName, ViaTime: a.EventTime, ViaIP: a.SourceIP, ViaUserAgent: a.UserAgent, ViaRegion: a.Region, ViaEventID: a.EventID, ViaMFA: a.MFA, Evidence: a.Evidence, EvidenceSeqs: a.EvidenceSeqs})
		prevID = id
	}
	tree.RootID = ks
	if len(anc) > 0 {
		topID := ancestorID(anc[len(anc)-1])
		tree.RootID = topID
		if status == "observed" {
			nodes[topID].Kind = "origin"
		}
	}
	if ps := ssoPermissionSet(seed[0].RoleArn); ps != "" {
		tree.Notes = append(tree.Notes, "Recorded IAM Identity Center role: permission set "+ps+". This role label does not establish the login that created the session.")
	}
	if seed[0].SourceIdentity != "" {
		tree.Notes = append(tree.Notes, "Recorded sourceIdentity: "+seed[0].SourceIdentity+". Its identity assurance depends on the issuing policy and identity provider.")
	}

	// keys whose identity we must resolve from own-events (siblings + children)
	var resolveKeys []string
	// edge-arn fallback for keys with no own events
	edgeRows := map[string]childRow{}

	addChild := func(parentNodeID, parentKey, kind string, c childRow) {
		id := nodeID(c.ChildKey, c.ChildArn)
		if _, exists := nodes[id]; exists {
			return // self-loop (accessKeyId == issuedKeyId) - not a real child
		}
		if _, exists := nodes[id]; !exists {
			ensure(id)
			nodes[id].Kind = kind
			nodes[id].AccessKeyID = c.ChildKey
			resolveKeys = append(resolveKeys, c.ChildKey)
			edgeRows[c.ChildKey] = c
		}
		tree.Edges = append(tree.Edges, GraphEdge{Parent: parentNodeID, Child: id, ViaSeq: c.Seq, ViaEvent: c.EventName, ViaTime: c.EventTime, ViaIP: c.SourceIP, ViaUserAgent: c.UserAgent, ViaRegion: c.Region, ViaEventID: c.EventID, ViaMFA: c.MFA, Evidence: c.Evidence, EvidenceSeqs: c.EvidenceSeqs})
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
			applyIssuedIdentity(n, edgeRows[k])
		}
		if id, ok := idents[k]; ok {
			n.IdentityNote = id.Note
		}

	}

	// activity + child counts for every session node
	var allKeys []string
	for _, id := range order {
		if k := nodes[id].AccessKeyID; k != "" {
			allKeys = append(allKeys, k)
		}
	}
	acts, err := s.countBy(allKeys, "")
	if err != nil {
		return tree, err
	}
	{
		for k, c := range acts {
			if nodes[k] != nil {
				nodes[k].Events = c
			}
		}
	}
	ccs, err := s.childCounts(allKeys)
	if err != nil {
		return tree, err
	}
	{
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
	ra, err := s.roleActivity(roleArns)
	if err != nil {
		return tree, err
	}
	{
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
func (s *lineageReader) LineageChildren(accessKeyID string) (LineageTree, error) {
	tree := LineageTree{Nodes: []GraphNode{}, Edges: []GraphEdge{}, Notes: []string{}}
	kids, trunc, err := s.childrenOf(accessKeyID)
	if err != nil {
		return tree, err
	}
	var keys []string
	edgeRows := map[string]childRow{}
	for _, c := range kids {
		keys = append(keys, c.ChildKey)
		edgeRows[c.ChildKey] = c
		tree.Edges = append(tree.Edges, GraphEdge{Parent: accessKeyID, Child: nodeID(c.ChildKey, c.ChildArn), ViaSeq: c.Seq, ViaEvent: c.EventName, ViaTime: c.EventTime, ViaIP: c.SourceIP, ViaUserAgent: c.UserAgent, ViaRegion: c.Region, ViaEventID: c.EventID, ViaMFA: c.MFA, Evidence: c.Evidence, EvidenceSeqs: c.EvidenceSeqs})
	}
	idents, err := s.resolveIdentities(keys)
	if err != nil {
		return tree, err
	}
	acts, err := s.countBy(keys, "")
	if err != nil {
		return tree, err
	}
	ccs, err := s.childCounts(keys)
	if err != nil {
		return tree, err
	}
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
			applyIssuedIdentity(&n, edgeRows[c.ChildKey])
		}
		if id, ok := idents[c.ChildKey]; ok {
			n.IdentityNote = id.Note
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
	ra, err := s.roleActivity(roleArns)
	if err != nil {
		return tree, err
	}
	{
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
func (s *lineageReader) LineageEvents(accessKeyID string) (LineageTree, error) {
	tree := LineageTree{Nodes: []GraphNode{}, Edges: []GraphEdge{}, Notes: []string{}}
	if accessKeyID == "" {
		return tree, nil
	}
	q := fmt.Sprintf("SELECT seq, eventName, eventSource, eventTime, errorCode, readOnly, %s FROM events WHERE accessKeyId = %s ORDER BY eventTime DESC, seq DESC LIMIT %d;", resourceExpr, sqlStr(accessKeyID), eventNodeCap+1)
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
		tree.Notes = append(tree.Notes, fmt.Sprintf("Showing the newest %d events.", eventNodeCap))
	}
	return tree, nil
}

// A lineage response is built from one committed read; lazy expansion uses the
// same generation and sequence cutoff and rejects replaced datasets.
type lineageReader struct {
	queryJSON func(string, any) error
	notes     []string
}

func (s *Store) lineageRead(snapshot *Snapshot, fn func(*lineageReader) error) (Snapshot, error) {
	var snap Snapshot
	err := s.readSnapshot(context.Background(), func(ctx context.Context, tx *sql.Tx) error {
		var err error
		if snapshot == nil {
			snap, err = snapshotOn(ctx, tx)
		} else {
			snap = *snapshot
			err = validateSnapshot(ctx, tx, snap)
		}
		if err != nil {
			return err
		}
		r := &lineageReader{queryJSON: func(q string, dst any) error {
			return queryJSONOn(ctx, tx, fmt.Sprintf("WITH events AS (SELECT * FROM main.events WHERE seq <= %d) ", snap.MaxSeq)+q, dst)
		}}
		return fn(r)
	})
	return snap, err
}
func (s *Store) LineageGraph(seq int64, snapshots ...Snapshot) (LineageTree, error) {
	var requested *Snapshot
	if len(snapshots) > 0 {
		requested = &snapshots[0]
	}
	var tree LineageTree
	snap, err := s.lineageRead(requested, func(r *lineageReader) error {
		var err error
		tree, err = r.LineageGraph(seq)
		tree.Notes = append(tree.Notes, uniqNonEmpty(r.notes)...)
		return err
	})
	tree.Snapshot = &snap
	return tree, err
}
func (s *Store) LineageChildren(key string, snapshots ...Snapshot) (LineageTree, error) {
	var tree LineageTree
	var snapshot *Snapshot
	if len(snapshots) > 0 {
		snapshot = &snapshots[0]
	}
	snap, err := s.lineageRead(snapshot, func(r *lineageReader) error {
		var err error
		tree, err = r.LineageChildren(key)
		tree.Notes = append(tree.Notes, uniqNonEmpty(r.notes)...)
		return err
	})
	tree.Snapshot = &snap
	return tree, err
}
func (s *Store) LineageEvents(key string, snapshots ...Snapshot) (LineageTree, error) {
	var tree LineageTree
	var snapshot *Snapshot
	if len(snapshots) > 0 {
		snapshot = &snapshots[0]
	}
	snap, err := s.lineageRead(snapshot, func(r *lineageReader) error { var err error; tree, err = r.LineageEvents(key); return err })
	tree.Snapshot = &snap
	return tree, err
}

func (s *Store) LineageRaw(seq int64, snapshot Snapshot) (string, error) {
	var rows []struct {
		Raw string `json:"raw"`
	}
	_, err := s.lineageRead(&snapshot, func(r *lineageReader) error {
		return r.queryJSON(fmt.Sprintf("SELECT raw FROM events WHERE seq=%d", seq), &rows)
	})
	if err != nil {
		return "", err
	}
	if len(rows) == 0 {
		return "", fmt.Errorf("issuance event is no longer available")
	}
	return rows[0].Raw, nil
}
