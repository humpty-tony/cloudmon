// Package ingest loads CloudTrail events from exported files and (later) live
// sources, normalizing everything to model.CloudTrailEvent. The parser accepts
// every common export shape so a user can point CloudMon at whatever they have.
package ingest

import (
	"bytes"
	"sort"
	"time"

	"cloudmon/internal/model"
)

// ParseDump parses a CloudTrail export from raw bytes. Supported shapes:
//   - gzip of any of the below (S3 log files are gzipped)
//   - {"Records": [ <event>, ... ]}           console "Download as JSON" + S3 logs
//   - {"Events": [ {"CloudTrailEvent": "<json string>"}, ... ]}   `aws cloudtrail lookup-events`
//   - [ <event>, ... ]                         bare array
//   - one <event> JSON object per line         NDJSON
//   - CSV                                       console "Download as CSV" (lossy)
//
// Events are returned sorted oldest-first with a monotonic Seq assigned in that
// order, matching the live stream's ordering contract.
func ParseDump(data []byte) ([]model.CloudTrailEvent, error) {
	var events []model.CloudTrailEvent
	err := Stream(bytes.NewReader(data), "input", func(record Record) error {
		event, err := model.FromRawJSON([]byte(record.Raw))
		if err != nil {
			return err
		}
		events = append(events, event)
		return nil
	})
	if err != nil {
		return nil, err
	}
	assignSeq(events)
	return events, nil
}

func assignSeq(events []model.CloudTrailEvent) {
	sort.SliceStable(events, func(i, j int) bool {
		ti, ei := time.Parse(time.RFC3339, events[i].EventTime)
		tj, ej := time.Parse(time.RFC3339, events[j].EventTime)
		if ei != nil || ej != nil {
			// Unparseable timestamps sort after parseable ones; two unparseable (or
			// equal) entries keep their original order (SliceStable). Returning a
			// consistent result here keeps this a valid strict weak ordering.
			return ei == nil && ej != nil
		}
		return ti.Before(tj)
	})
	for i := range events {
		events[i].Seq = int64(i + 1)
	}
}
