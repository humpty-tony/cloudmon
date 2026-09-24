package store

import (
	"fmt"
	"strings"
	"time"
)

// Only these documented STS operations issue credentials through this response
// shape. An arbitrary service/event returning a similarly named field is not an
// issuance edge. Missing expiration is permitted but explicitly qualified.
const issuancePredicate = `eventSource = 'sts.amazonaws.com' AND eventName IN ('AssumeRole','AssumeRoleWithSAML','AssumeRoleWithWebIdentity','AssumeRoot','GetSessionToken','GetFederationToken') AND coalesce(errorCode,'') = '' AND coalesce(errorMessage,'') = '' AND coalesce(issuedKeyId,'') <> ''`
const issuanceCap = 64
const lineageColumns = `(SELECT count(DISTINCT o.raw) FROM observations o WHERE o.eventKey=events.eventKey)>1 AS hasVariants, seq, eventName, eventTime, sourceIPAddress, identityType, identityArn, userName, accountId, roleArn, sessionName, invokedBy, accessKeyId AS node_key, principalId, sourceIdentity,
 coalesce(json_exists(raw,'$.userIdentity.sessionContext'),false) AS hasContext,
 json_extract_string(raw,'$.sharedEventID') AS sharedEventID,
 json_extract_string(raw,'$.responseElements.credentials.expiration') AS expiration,
 issuedKeyId, coalesce(issuedRoleArn, json_extract_string(raw,'$.responseElements.federatedUser.arn')) AS issuedArn,
 json_extract_string(raw,'$.requestParameters.roleArn') AS targetRole,
 json_extract_string(raw,'$.requestParameters.targetPrincipal') AS targetPrincipal`

type ancRow struct {
	HasVariants     bool   `json:"hasVariants"`
	Seq             int64  `json:"seq"`
	EventName       string `json:"eventName"`
	EventTime       string `json:"eventTime"`
	SourceIP        string `json:"sourceIPAddress"`
	IdentityType    string `json:"identityType"`
	IdentityArn     string `json:"identityArn"`
	UserName        string `json:"userName"`
	AccountID       string `json:"accountId"`
	RoleArn         string `json:"roleArn"`
	SessionName     string `json:"sessionName"`
	InvokedBy       string `json:"invokedBy"`
	NodeKey         string `json:"node_key"`
	PrincipalID     string `json:"principalId"`
	SourceIdentity  string `json:"sourceIdentity"`
	HasContext      bool   `json:"hasContext"`
	SharedEventID   string `json:"sharedEventID"`
	Expiration      string `json:"expiration"`
	IssuedKey       string `json:"issuedKeyId"`
	IssuedArn       string `json:"issuedArn"`
	TargetRole      string `json:"targetRole"`
	TargetPrincipal string `json:"targetPrincipal"`
	Evidence        string
	EvidenceSeqs    []int64
}

func (r ancRow) temporary() bool {
	return r.IdentityType == "AssumedRole" || r.IdentityType == "FederatedUser" || strings.HasPrefix(r.NodeKey, "ASIA") || r.HasContext
}
func (r ancRow) terminal() bool {
	if r.temporary() {
		return false
	}
	switch r.IdentityType {
	case "IAMUser", "Root":
		return r.IdentityArn != "" && strings.HasPrefix(r.NodeKey, "AKIA")
	case "AWSService":
		return r.InvokedBy != "" || r.IdentityArn != ""
	case "SAMLUser", "WebIdentityUser":
		return r.PrincipalID != "" || r.UserName != ""
	}
	return false
}
func ancestorID(r ancRow) string {
	if r.NodeKey != "" {
		return r.NodeKey
	}
	// A keyless caller in one issuance must not collapse with other unknown callers.
	return fmt.Sprintf("principal:%d", r.Seq)
}
func (s *lineageReader) seed(seq int64) (*ancRow, error) {
	var rows []ancRow
	if err := s.queryJSON(fmt.Sprintf("SELECT %s FROM events WHERE seq=%d", lineageColumns, seq), &rows); err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, fmt.Errorf("event is no longer available; reopen the investigation")
	}
	return &rows[0], nil
}
func evidenceTime(value string) (time.Time, error) {
	for _, layout := range []string{time.RFC3339Nano, "Jan 2, 2006, 3:04:05 PM", "Jan 2, 2006 3:04:05 PM", "Jan 2, 2006, 15:04:05"} {
		if t, err := time.Parse(layout, value); err == nil {
			return t, nil
		}
	}
	return time.Time{}, fmt.Errorf("unrecognised timestamp")
}
func disagrees(a, b string) bool { return a != "" && b != "" && a != b }
func sameIssuance(a, b ancRow) bool {
	if a.SharedEventID == "" || a.SharedEventID != b.SharedEventID {
		return false
	}
	// Recipient-account records may identify the caller only as AWSAccount. Keep
	// the richer whole observation, but only when their available fields agree.
	typeConflict := disagrees(a.IdentityType, b.IdentityType) && a.IdentityType != "AWSAccount" && b.IdentityType != "AWSAccount"
	return !typeConflict && a.EventName == b.EventName && a.EventTime == b.EventTime &&
		!disagrees(a.NodeKey, b.NodeKey) && !disagrees(a.IdentityArn, b.IdentityArn) && !disagrees(a.AccountID, b.AccountID) &&
		!disagrees(a.PrincipalID, b.PrincipalID) && !disagrees(a.IssuedArn, b.IssuedArn) && !disagrees(a.TargetRole, b.TargetRole) &&
		!disagrees(a.TargetPrincipal, b.TargetPrincipal) && !disagrees(a.Expiration, b.Expiration)
}
func identityScore(r ancRow) int {
	n := 0
	if r.NodeKey != "" {
		n += 4
	}
	if r.IdentityArn != "" {
		n += 2
	}
	if r.IdentityType != "AWSAccount" {
		n++
	}
	return n
}
func issuanceFits(r ancRow, child *ancRow) (string, bool) {
	issued, err := evidenceTime(r.EventTime)
	if err != nil {
		return "Issuance time is missing or invalid.", false
	}
	var expiry time.Time
	if r.Expiration != "" {
		expiry, err = evidenceTime(r.Expiration)
		if err != nil || expiry.Before(issued) {
			return "Credential expiration is invalid or precedes issuance.", false
		}
	}
	if child != nil {
		used, err := evidenceTime(child.EventTime)
		if err != nil {
			return "The inspected use has no valid event time.", false
		}
		if issued.After(used) {
			return "Credential issuance is later than the inspected use.", false
		}
		if !expiry.IsZero() && !used.Before(expiry) {
			return "The inspected use falls outside the recorded credential lifetime.", false
		}
		if disagrees(r.IssuedArn, child.IdentityArn) || disagrees(r.TargetRole, child.RoleArn) {
			return "Issued identity conflicts with the identity using this access key.", false
		}
		if r.EventName == "GetSessionToken" && disagrees(r.IdentityArn, child.IdentityArn) {
			return "Session-token caller and credential user disagree.", false
		}
		if r.EventName == "AssumeRoot" {
			target := r.TargetPrincipal
			if parts := strings.Split(target, ":"); len(parts) == 6 {
				target = parts[4]
			}
			if disagrees(target, child.AccountID) {
				return "AssumeRoot target and credential account disagree.", false
			}
		}
	}
	return "", true
}
func (s *lineageReader) issuer(key string, child *ancRow) (*ancRow, string, string, error) {
	var rows []ancRow
	q := fmt.Sprintf("SELECT %s FROM events WHERE issuedKeyId=%s AND %s ORDER BY seq LIMIT %d", lineageColumns, sqlStr(key), issuancePredicate, issuanceCap+1)
	if err := s.queryJSON(q, &rows); err != nil {
		return nil, "", "", err
	}
	for _, row := range rows {
		if row.HasVariants {
			return nil, "ambiguous", "An issuance event has different source versions; inspect Sources & hashes before choosing an interpretation.", nil
		}
	}
	if len(rows) > issuanceCap {
		return nil, "ambiguous", "Too many issuance observations share this access key; no parent was selected.", nil
	}
	if len(rows) == 0 {
		return nil, "missing", "No successful supported STS issuance for this key is present in the loaded evidence.", nil
	}
	// Group before time validation: a corrupt counterpart must not silently be
	// removed, allowing a conflicting shared event to look unambiguous.
	var groups []ancRow
	for _, r := range rows {
		r.EvidenceSeqs = []int64{r.Seq}
		found := false
		for i, g := range groups {
			if r.SharedEventID != "" && r.SharedEventID == g.SharedEventID {
				if !sameIssuance(r, g) {
					return nil, "ambiguous", "Linked cross-account observations contain conflicting issuance fields.", nil
				}
				seqs := append(g.EvidenceSeqs, r.Seq)
				if identityScore(r) > identityScore(g) {
					groups[i] = r
				}
				groups[i].EvidenceSeqs = seqs
				found = true
				break
			}
		}
		if !found {
			groups = append(groups, r)
		}
	}
	var valid []ancRow
	reason := "Issuance evidence does not agree with this credential use."
	for _, r := range groups {
		if why, ok := issuanceFits(r, child); ok {
			valid = append(valid, r)
		} else {
			reason = why
		}
	}
	if len(valid) == 0 {
		return nil, "conflict", reason, nil
	}
	if len(valid) > 1 {
		return nil, "ambiguous", "Multiple distinct STS issuances match this access key; no parent was selected.", nil
	}
	r := valid[0]
	r.Evidence = "Exact access-key match to successful STS issuance"
	if child != nil {
		r.Evidence += "; issuance precedes use"
	}
	if r.Expiration == "" {
		r.Evidence += "; expiration not recorded"
	} else {
		r.Evidence += "; recorded lifetime checked"
	}
	if len(r.EvidenceSeqs) > 1 {
		r.Evidence += "; linked by sharedEventID"
	}
	return &r, "", "", nil
}
func (s *lineageReader) ancestry(seed ancRow) ([]ancRow, string, string, error) {
	rows := []ancRow{}
	if seed.HasVariants {
		return rows, "ambiguous", "This event has different source versions; inspect Sources & hashes before choosing an interpretation.", nil
	}
	seen := map[string]bool{seed.NodeKey: true}
	cur := seed
	for depth := 0; depth < lineageMaxDepth; depth++ {
		if cur.terminal() {
			return rows, "observed", "Chain reaches a recorded principal; this does not verify the human operator.", nil
		}
		if cur.NodeKey == "" {
			return rows, "missing-key", "No access key is recorded for this caller; the chain cannot continue.", nil
		}
		r, status, reason, err := s.issuer(cur.NodeKey, &cur)
		if err != nil || r == nil {
			return rows, status, reason, err
		}
		if r.NodeKey != "" && seen[r.NodeKey] {
			return rows, "cycle", "Credential evidence contains a cycle; the repeated link was omitted.", nil
		}
		rows = append(rows, *r)
		if r.NodeKey != "" {
			seen[r.NodeKey] = true
		}
		if r.IdentityType == "AWSAccount" {
			return rows, "account-only", "The issuance records the caller's account, but not its credential or principal identity.", nil
		}
		cur = *r
	}
	if cur.terminal() {
		return rows, "observed", "Chain reaches a recorded principal.", nil
	}
	return rows, "depth-limit", fmt.Sprintf("Stopped after %d credential links; earlier ancestry is not shown.", lineageMaxDepth), nil
}
func (s *Store) Lineage(seq int64) (Lineage, error) {
	lin := Lineage{Nodes: []LineageNode{}}
	_, err := s.lineageRead(nil, func(r *lineageReader) error {
		seed, err := r.seed(seq)
		if err != nil {
			return err
		}
		if !seed.temporary() {
			return nil
		}
		lin.Applicable = true
		lin.SourceIdentity = seed.SourceIdentity
		rows, status, reason, err := r.ancestry(*seed)
		if err != nil {
			return err
		}
		lin.Status = status
		lin.Reason = reason
		lin.Complete = status == "observed"
		for i := len(rows) - 1; i >= 0; i-- {
			a := rows[i]
			lin.Nodes = append(lin.Nodes, LineageNode{
				IdentityType: a.IdentityType, Arn: a.IdentityArn, UserName: a.UserName, AccountID: a.AccountID, RoleArn: a.RoleArn, SessionName: a.SessionName, InvokedBy: a.InvokedBy,
				ViaSeq: a.Seq, ViaEvent: a.EventName, ViaTime: a.EventTime, ViaSourceIP: a.SourceIP, Evidence: a.Evidence, EvidenceSeqs: a.EvidenceSeqs,
			})
		}
		return nil
	})
	return lin, err
}

func applyIssuedIdentity(n *GraphNode, c childRow) {
	n.Arn = c.ChildArn
	n.RoleArn = c.TargetRole
	n.RoleName = roleTail(c.TargetRole)
	n.IdentityNote = "Identity from issuance response; no consistent activity identity was found."
	switch c.EventName {
	case "AssumeRole", "AssumeRoleWithSAML", "AssumeRoleWithWebIdentity":
		n.IdentityType = "AssumedRole"
		account, role, session := parseStsArn(c.ChildArn)
		n.AccountID = account
		n.SessionName = session
		if n.RoleName == "" {
			n.RoleName = role
		}
	case "GetFederationToken":
		n.IdentityType = "FederatedUser"
	case "AssumeRoot":
		n.IdentityType = "Root"
		n.AccountID = c.TargetPrincipal
	case "GetSessionToken":
		n.IdentityType = c.CallerType
		n.Arn = c.CallerArn
		n.AccountID = c.CallerAccount
	}
}
func (s *lineageReader) childCounts(keys []string) (map[string]int, error) {
	// This is the number of distinct candidate issued keys. Ambiguous candidates
	// may be omitted on expansion, which is explicitly reported in graph notes.
	counts := map[string]int{}
	keys = uniqNonEmpty(keys)
	if len(keys) == 0 {
		return counts, nil
	}
	var rows []struct {
		K string `json:"k"`
		C int    `json:"c"`
	}
	err := s.queryJSON("SELECT accessKeyId AS k,count(DISTINCT issuedKeyId) AS c FROM events WHERE accessKeyId IN ("+sqlValues(keys)+") AND "+issuancePredicate+" AND issuedKeyId IS DISTINCT FROM accessKeyId GROUP BY k", &rows)
	for _, r := range rows {
		counts[r.K] = r.C
	}
	return counts, err
}
