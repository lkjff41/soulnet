package a2a

import (
	"testing"
	"time"
)

// ConvStore.Seen dedups via a lazily loaded in-memory index: the first call scans the file to build it,
// Append maintains it, and a new instance (simulated restart) rebuilds it from the file.
func TestConvStore_SeenIndex(t *testing.T) {
	dir := t.TempDir()
	cs := NewConvStore(dir)
	peer := "fpPeer"

	if cs.Seen(peer, "m1") {
		t.Error("empty conversation should not have m1")
	}
	if err := cs.Append(peer, &ConvEntry{Dir: "in", Message: Message{ID: "m1"}}); err != nil {
		t.Fatal(err)
	}
	if !cs.Seen(peer, "m1") {
		t.Error("m1 should be seen after Append")
	}
	if cs.Seen(peer, "m2") {
		t.Error("m2 should not be seen before Append")
	}
	// The index takes effect right after Append (no file rescan needed)
	if err := cs.Append(peer, &ConvEntry{Dir: "in", Message: Message{ID: "m2"}}); err != nil {
		t.Fatal(err)
	}
	if !cs.Seen(peer, "m2") {
		t.Error("m2 should be seen immediately after Append")
	}

	// A new instance (simulated restart, empty index) should rebuild from the file
	cs2 := NewConvStore(dir)
	if !cs2.Seen(peer, "m1") || !cs2.Seen(peer, "m2") {
		t.Error("seen index should be rebuilt from the file after restart")
	}
	if cs2.Seen(peer, "m3") {
		t.Error("m3 does not exist and should not be seen")
	}
}

// The single-pass Summary result must match Recent(peer, 0)+a second loop (the friend-list endpoint's old approach).
func TestConvStoreSummary(t *testing.T) {
	dir := t.TempDir()
	cs := NewConvStore(dir)
	peer := "fpPeer"

	// Empty conversation: all zeros.
	if cnt, last, unread := cs.Summary(peer, time.Time{}); cnt != 0 || last != nil || unread != 0 {
		t.Fatalf("empty conversation should give (0,nil,0), got (%d,%v,%d)", cnt, last, unread)
	}

	base := time.Now().Add(-time.Hour)
	entries := []*ConvEntry{
		{Dir: "in", Message: Message{ID: "m1", Body: "morning", TS: base}},
		{Dir: "out", Message: Message{ID: "m2", Body: "ok", TS: base.Add(10 * time.Minute)}},
		{Dir: "in", Message: Message{ID: "m3", Body: "there?", TS: base.Add(20 * time.Minute)}},
		{Dir: "in", Message: Message{ID: "m4", Body: "last one", TS: base.Add(30 * time.Minute)}},
	}
	for _, e := range entries {
		if err := cs.Append(peer, e); err != nil {
			t.Fatal(err)
		}
	}

	// Read cursor after m1: unread = m3, m4 (in and later than the cursor; out does not count).
	since := base.Add(5 * time.Minute)
	cnt, last, unread := cs.Summary(peer, since)
	if cnt != 4 {
		t.Errorf("count=%d want 4", cnt)
	}
	if last == nil || last.Body != "last one" || last.Dir != "in" {
		t.Errorf("last should be the final in message, got %+v", last)
	}
	if unread != 2 {
		t.Errorf("unread=%d want 2", unread)
	}

	// Item-by-item alignment with the old approach (full Recent + second loop).
	es := cs.Recent(peer, 0)
	oldUnread := 0
	for _, e := range es {
		if e.Dir == "in" && e.TS.After(since) {
			oldUnread++
		}
	}
	if len(es) != cnt || oldUnread != unread || es[len(es)-1].Body != last.Body {
		t.Errorf("Summary disagrees with the old Recent approach: (%d,%q,%d) vs (%d,%q,%d)",
			cnt, last.Body, unread, len(es), es[len(es)-1].Body, oldUnread)
	}
}
