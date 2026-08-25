package relay

import (
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/startupworld-ai/soulnet/a2a"
)

// Regression: post office delivery must never lose a single letter.
//
// Historical bug -- deliver() used time.Now().UnixNano() directly as the inbox file name. On Windows the wall clock is
// extremely coarse (measured: consecutive UnixNano() calls are almost always equal, smallest non-zero gap ~0.5ms); when
// two letters reached the same mailbox within half a millisecond, the second os.WriteFile silently overwrote the first --
// no error, the letter was gone. Symptom: A2A mission state stuck (mission_update lost).
func TestDeliverNoLossRapidSequential(t *testing.T) {
	s := newTestServer(t)
	const n = 500
	for i := 0; i < n; i++ {
		if err := s.deliver(testEnvelope("box-seq", i)); err != nil {
			t.Fatalf("delivery %d failed: %v", i, err)
		}
	}
	items, err := s.readInbox("box-seq")
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != n {
		t.Fatalf("delivered %d letters rapidly, only %d read back (%d lost)", n, len(items), n-len(items))
	}
	// The order must still be the delivery order: readInbox sorts by lexical file name, the uniqueness scheme must not break time order.
	for i, it := range items {
		want := fmt.Sprintf("%d", i)
		if it.Cipher != want {
			t.Fatalf("position %d out of order: want cipher=%q, got %q", i, want, it.Cipher)
		}
	}
}

// Concurrent delivery to the same mailbox must not lose a letter either (the relay is an HTTP server; deliver naturally runs on many goroutines).
func TestDeliverNoLossConcurrent(t *testing.T) {
	s := newTestServer(t)
	const workers, per = 8, 60
	var wg sync.WaitGroup
	errs := make(chan error, workers*per)
	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func(w int) {
			defer wg.Done()
			for i := 0; i < per; i++ {
				if err := s.deliver(testEnvelope("box-conc", w*per+i)); err != nil {
					errs <- err
				}
			}
		}(w)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatalf("concurrent delivery failed: %v", err)
	}
	items, err := s.readInbox("box-conc")
	if err != nil {
		t.Fatal(err)
	}
	if want := workers * per; len(items) != want {
		t.Fatalf("delivered %d letters concurrently, only %d read back (%d lost)", want, len(items), want-len(items))
	}
	// ack_ids must be pairwise distinct (unique file names).
	seen := map[string]bool{}
	for _, it := range items {
		if seen[it.AckID] {
			t.Fatalf("duplicate ack_id: %s", it.AckID)
		}
		seen[it.AckID] = true
	}
}

func newTestServer(t *testing.T) *Server {
	t.Helper()
	s, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return s
}

// testEnvelope builds a letter with "recognisable content": Cipher holds the sequence number so order can be asserted.
func testEnvelope(to string, i int) *a2a.Envelope {
	return &a2a.Envelope{V: 2, To: to, From: "test-from", TS: time.Now(), Cipher: fmt.Sprintf("%d", i)}
}
