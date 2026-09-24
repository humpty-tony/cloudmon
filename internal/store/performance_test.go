package store

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"cloudmon/internal/model"
)

// Opt-in, fixed workload for before/after comparisons, not a timing-based CI gate.
// CLOUDMON_PERF=1 go test ./internal/store -run '^TestStorePerformance$' -count=1 -v
func TestStorePerformance(t *testing.T) {
	if os.Getenv("CLOUDMON_PERF") != "1" {
		t.Skip("set CLOUDMON_PERF=1 to measure database latency")
	}
	s := New(bin(t), filepath.Join(t.TempDir(), "performance.duckdb"))
	const initial = 10000
	const samples = 25
	record := func(i int) string {
		return fmt.Sprintf(`{"eventID":"perf-%d","recipientAccountId":"123456789012","eventTime":%q,"eventName":"DescribeInstances","eventSource":"ec2.amazonaws.com","awsRegion":"us-east-1","readOnly":true,"userIdentity":{"type":"IAMUser","arn":"arn:aws:iam::123456789012:user/user-%d","accessKeyId":"AKIA%d"},"requestParameters":{"value":9007199254740993}}`, i, time.Date(2026, 1, 1, 0, 0, i, 0, time.UTC).Format(time.RFC3339), i%100, i%100)
	}
	var input strings.Builder
	for i := 0; i < initial; i++ {
		input.WriteString(record(i) + "\n")
	}
	if _, err := s.IngestReader(strings.NewReader(input.String()), "performance-fixture"); err != nil {
		t.Fatal(err)
	}
	report := func(name string, times []time.Duration) {
		sort.Slice(times, func(i, j int) bool { return times[i] < times[j] })
		t.Logf("%s: n=%d p50=%.2fms p95=%.2fms", name, len(times), float64(times[len(times)/2])/float64(time.Millisecond), float64(times[(len(times)*95-1)/100])/float64(time.Millisecond))
	}
	measure := func(name string, fn func() error) {
		if err := fn(); err != nil { // warm the path before collecting samples
			t.Fatal(err)
		}
		times := make([]time.Duration, samples)
		for i := range times {
			start := time.Now()
			if err := fn(); err != nil {
				t.Fatal(err)
			}
			times[i] = time.Since(start)
		}
		report(name, times)
	}
	measure("raw", func() error { _, err := s.Raw(5000); return err })
	measure("page-200", func() error { _, err := s.Page(Filter{}, 0, 200); return err })
	measure("aggregates", func() error { _, err := s.Aggregates(Filter{}); return err })

	// A writer runs continuously while the foreground inspects events/pages and
	// refreshes aggregates. Every acknowledged batch must be durable and visible.
	done := make(chan error, 1)
	writes := make([]time.Duration, samples)
	go func() {
		for i := 0; i < samples; i++ {
			batch := make([]model.CloudTrailEvent, 10)
			for j := range batch {
				batch[j], _ = model.FromRawJSON([]byte(record(initial + i*10 + j)))
			}
			start := time.Now()
			_, err := s.AppendFrom(batch, "performance-live")
			writes[i] = time.Since(start)
			if err != nil {
				done <- err
				return
			}
		}
		done <- nil
	}()
	reads := make([]time.Duration, samples)
	var readErr error
	for i := range reads {
		start := time.Now()
		_, readErr = s.Raw(5000)
		reads[i] = time.Since(start)
		if readErr != nil {
			break
		}
		if _, readErr = s.Page(Filter{}, 0, 200); readErr != nil {
			break
		}
		if i%5 == 0 {
			if _, readErr = s.Aggregates(Filter{}); readErr != nil {
				break
			}
		}
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if readErr != nil {
		t.Fatal(readErr)
	}
	report("raw-during-ingestion", reads)
	report("append-10-during-queries", writes)
	if count, err := s.Count(); err != nil || count != initial+samples*10 {
		t.Fatalf("durable total = %d, %v", count, err)
	}
}
