// Package cache is the §14.1 freshness layer: a generic TTL + bounded-LRU +
// single-flight memo of GitLab answers, keyed per question (operation AND
// parameters).
//
// Rules (SPEC §14.1, §15.9), all pinned by cache_test.go:
//   - an answer is re-used while age < TTL (DefaultTTL = 5 min); at age >= TTL
//     it is stale and the next Get fetches again;
//   - simultaneous Gets of the same key share ONE fetch and all receive the
//     same value/error (single-flight). A refresh=true Get that arrives while a
//     fetch for that key is already in flight joins it;
//   - an error is NEVER remembered (neither a failed request nor a response that
//     reported an error) — the very next Get fetches again;
//   - refresh=true discards the remembered answer FIRST (so a failing refresh
//     leaves nothing remembered) and fetches again;
//   - at most `capacity` answers are remembered; inserting beyond that evicts
//     the least-recently-used entry (a hit counts as a use);
//   - different keys are different questions (see Key).
package cache

import (
	"container/list"
	"context"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"
)

// DefaultTTL is the §2.3 "Data freshness" value.
const DefaultTTL = 5 * time.Minute

// DefaultCapacity is the "small fixed number of the most recent distinct
// answers" of §14.1 (per Cache instance).
const DefaultCapacity = 256

// Cache memoises values of type V. Safe for concurrent use.
type Cache[V any] struct {
	ttl      time.Duration
	capacity int
	now      func() time.Time

	mu       sync.Mutex
	recency  *list.List               // of *entry[V]; front = most recently used
	entries  map[string]*list.Element // key → element of recency
	inFlight map[string]*call[V]
}

type entry[V any] struct {
	key       string
	val       V
	fetchedAt time.Time
}

// call is one shared fetch; val and err are written before done is closed.
type call[V any] struct {
	done chan struct{}
	val  V
	err  error
}

// New creates a cache. ttl <= 0 → DefaultTTL; capacity <= 0 → DefaultCapacity;
// now == nil → time.Now (tests inject a fake clock).
func New[V any](ttl time.Duration, capacity int, now func() time.Time) *Cache[V] {
	if ttl <= 0 {
		ttl = DefaultTTL
	}
	if capacity <= 0 {
		capacity = DefaultCapacity
	}
	if now == nil {
		now = time.Now
	}
	return &Cache[V]{
		ttl:      ttl,
		capacity: capacity,
		now:      now,
		recency:  list.New(),
		entries:  map[string]*list.Element{},
		inFlight: map[string]*call[V]{},
	}
}

// Get returns the remembered answer for key, or calls fetch (once, shared by
// all concurrent callers of the same key) and remembers its result if and
// only if err == nil.
//
// fetch receives a context that is NOT cancelled when an individual caller's
// ctx is cancelled (use context.WithoutCancel(ctx)), so one impatient caller
// cannot fail the shared fetch for the others. If ctx is done while waiting,
// Get returns ctx.Err() to that caller only.
func (c *Cache[V]) Get(ctx context.Context, key string, refresh bool, fetch func(ctx context.Context) (V, error)) (V, error) {
	c.mu.Lock()
	if refresh {
		c.removeLocked(key)
	} else if v, ok := c.lookupLocked(key); ok {
		c.mu.Unlock()
		return v, nil
	}
	cl, ok := c.inFlight[key]
	if !ok {
		cl = &call[V]{done: make(chan struct{})}
		c.inFlight[key] = cl
		go c.run(context.WithoutCancel(ctx), key, cl, fetch)
	}
	c.mu.Unlock()

	select {
	case <-cl.done:
		return cl.val, cl.err
	case <-ctx.Done():
		var zero V
		return zero, ctx.Err()
	}
}

// run performs the shared fetch in its own goroutine so that every waiting
// caller (including the one that started it) can give up independently.
func (c *Cache[V]) run(ctx context.Context, key string, cl *call[V], fetch func(context.Context) (V, error)) {
	defer close(cl.done)
	defer func() {
		if r := recover(); r != nil {
			cl.err = fmt.Errorf("internal error: %v", r)
			c.mu.Lock()
			delete(c.inFlight, key)
			c.mu.Unlock()
		}
	}()
	cl.val, cl.err = fetch(ctx)

	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.inFlight, key)
	if cl.err == nil {
		c.storeLocked(key, cl.val)
	}
}

// Len reports how many answers are currently remembered (expired-but-not-yet-
// evicted entries may be counted). Used by tests to observe the LRU bound.
func (c *Cache[V]) Len() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.recency.Len()
}

// lookupLocked returns a fresh remembered answer and marks it as used. A hit
// does not extend its freshness, which is measured from the fetch.
func (c *Cache[V]) lookupLocked(key string) (V, bool) {
	el, ok := c.entries[key]
	if !ok {
		var zero V
		return zero, false
	}
	e := el.Value.(*entry[V])
	if c.now().Sub(e.fetchedAt) >= c.ttl {
		c.removeLocked(key)
		var zero V
		return zero, false
	}
	c.recency.MoveToFront(el)
	return e.val, true
}

func (c *Cache[V]) storeLocked(key string, val V) {
	e := &entry[V]{key: key, val: val, fetchedAt: c.now()}
	if el, ok := c.entries[key]; ok {
		el.Value = e
		c.recency.MoveToFront(el)
		return
	}
	c.entries[key] = c.recency.PushFront(e)
	for c.recency.Len() > c.capacity {
		oldest := c.recency.Back()
		c.removeLocked(oldest.Value.(*entry[V]).key)
	}
}

func (c *Cache[V]) removeLocked(key string) {
	if el, ok := c.entries[key]; ok {
		c.recency.Remove(el)
		delete(c.entries, key)
	}
}

// Key builds an unambiguous cache key from an operation name and its
// parameters: Key(op, a...) == Key(op, b...) iff the operation and every
// parameter are equal (no collisions through separators, e.g.
// Key("x","a/b","c") != Key("x","a","b/c")).
func Key(op string, params ...string) string {
	var b strings.Builder
	for _, part := range append([]string{op}, params...) {
		// Length-prefixing every part makes the encoding injective whatever
		// characters the parts contain.
		b.WriteString(strconv.Itoa(len(part)))
		b.WriteByte(':')
		b.WriteString(part)
	}
	return b.String()
}
