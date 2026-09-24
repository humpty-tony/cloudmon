package queryjob

import (
	"context"
	"testing"
)

func TestCancellationBeforeAndDuringRequests(t *testing.T) {
	var r Registry
	r.Cancel("queued")
	ctx, done, err := r.Begin(context.Background(), "queued")
	if err != nil {
		t.Fatal(err)
	}
	if ctx.Err() != context.Canceled {
		t.Fatal("queued cancellation lost")
	}
	done()
	done()
	live, finish, err := r.Begin(context.Background(), "live")
	if err != nil {
		t.Fatal(err)
	}
	defer finish()
	r.Cancel("queued")
	if live.Err() != nil {
		t.Fatal("late cancellation reached a different request")
	}
	r.Cancel("live")
	if live.Err() != context.Canceled {
		t.Fatal("running cancellation lost")
	}
	if _, _, err := r.Begin(context.Background(), "queued"); err == nil {
		t.Fatal("reused completed token")
	}
}
