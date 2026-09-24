// Package queryjob connects bridge cancellation requests to query contexts.
package queryjob

import (
	"context"
	"fmt"
	"sync"
)

// Registry accepts cancellation before a bridge call begins, as well as while
// SQL is running. A bounded history also prevents immediate token reuse.
type Registry struct {
	mu     sync.Mutex
	active map[string]context.CancelFunc
	recent map[string]bool // true: cancelled before start; false: finished
	order  []string
}

func (r *Registry) remember(id string, cancelled bool) {
	if r.recent == nil {
		r.recent = make(map[string]bool)
	}
	if _, exists := r.recent[id]; !exists {
		r.order = append(r.order, id)
	}
	r.recent[id] = cancelled
	for len(r.order) > 128 {
		delete(r.recent, r.order[0])
		r.order = r.order[1:]
	}
}
func (r *Registry) Begin(parent context.Context, id string) (context.Context, func(), error) {
	if len(id) == 0 || len(id) > 128 {
		return nil, nil, fmt.Errorf("invalid query request ID")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.active == nil {
		r.active = make(map[string]context.CancelFunc)
	}
	if _, exists := r.active[id]; exists {
		return nil, nil, fmt.Errorf("query request is already active")
	}
	cancelled, seen := r.recent[id]
	if seen && !cancelled {
		return nil, nil, fmt.Errorf("query request ID was already used")
	}
	ctx, cancel := context.WithCancel(parent)
	r.active[id] = cancel
	if cancelled {
		cancel()
	}
	var once sync.Once
	done := func() {
		once.Do(func() { cancel(); r.mu.Lock(); defer r.mu.Unlock(); delete(r.active, id); r.remember(id, false) })
	}
	return ctx, done, nil
}
func (r *Registry) Cancel(id string) {
	if len(id) == 0 || len(id) > 128 {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if cancel, exists := r.active[id]; exists {
		cancel()
		return
	}
	if _, seen := r.recent[id]; !seen {
		r.remember(id, true)
	}
}
