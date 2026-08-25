package a2a

import (
	"crypto/ed25519"
	"crypto/rand"
	"testing"
	"time"
)

// testCard builds a card with a valid public key (fingerprint computable).
func testCard(name string) *Card {
	pub, _, _ := ed25519.GenerateKey(rand.Reader)
	return &Card{V: 2, EdPub: EncodeKey(pub), XPub: EncodeKey(pub), Proxies: []string{"https://r"}, Name: name}
}

// UnreadCount counts only messages "sent by the peer (dir=="in") and later than the cursor".
func TestConvStore_UnreadCount(t *testing.T) {
	dir := t.TempDir()
	cs := NewConvStore(dir)
	peer := "fpPeer"
	base := time.Date(2026, 6, 24, 10, 0, 0, 0, time.UTC)
	add := func(id, d string, off time.Duration) {
		if err := cs.Append(peer, &ConvEntry{Dir: d, Message: Message{ID: id, TS: base.Add(off)}}); err != nil {
			t.Fatal(err)
		}
	}
	add("a", "in", 1*time.Minute)  // before the read cursor
	add("b", "out", 2*time.Minute) // sent by us, never counts as unread
	add("c", "in", 3*time.Minute)  // unread
	add("d", "in", 4*time.Minute)  // unread

	cursor := base.Add(2 * time.Minute) // read up to minute 2
	if got := cs.UnreadCount(peer, cursor); got != 2 {
		t.Fatalf("unread should be 2 (c,d), got %d", got)
	}
	// cursor past the end → everything read
	if got := cs.UnreadCount(peer, base.Add(time.Hour)); got != 0 {
		t.Fatalf("cursor past the end should give 0, got %d", got)
	}
	// zero cursor → every in counts as unread (a,c,d)
	if got := cs.UnreadCount(peer, time.Time{}); got != 3 {
		t.Fatalf("zero cursor should count all in=3, got %d", got)
	}
	// peer without a conversation file → 0, no error
	if got := cs.UnreadCount("nobody", time.Time{}); got != 0 {
		t.Fatalf("no conversation should give 0, got %d", got)
	}
}

// A new friend's read cursor is set to now; MarkRead only moves forward; BackfillRead fills zero cursors.
func TestFriendStore_ReadCursor(t *testing.T) {
	dir := t.TempDir()
	fs := NewFriendStore(dir)
	card := testCard("Bob")
	fp, err := card.Fingerprint()
	if err != nil {
		t.Fatal(err)
	}
	before := time.Now()
	if err := fs.Add(card, "Bob"); err != nil {
		t.Fatal(err)
	}
	fr := fs.Get(fp)
	if fr == nil {
		t.Fatal("friend not created")
	}
	if fr.LastReadAt.Before(before) {
		t.Fatalf("new friend's read cursor should be >= creation time, got %v", fr.LastReadAt)
	}

	// MarkRead moves forward
	future := time.Now().Add(time.Hour)
	if err := fs.MarkRead(fp, future); err != nil {
		t.Fatal(err)
	}
	if got := fs.Get(fp).LastReadAt; !got.Equal(future) {
		t.Fatalf("cursor after MarkRead should be %v, got %v", future, got)
	}
	// Marking backwards must not move the cursor back
	past := time.Now().Add(-time.Hour)
	if err := fs.MarkRead(fp, past); err != nil {
		t.Fatal(err)
	}
	if got := fs.Get(fp).LastReadAt; !got.Equal(future) {
		t.Fatalf("cursor must not move back, should still be %v, got %v", future, got)
	}
	// MarkRead on a non-friend is silently ignored
	if err := fs.MarkRead("nobody", time.Now()); err != nil {
		t.Fatalf("MarkRead on a non-friend should not error: %v", err)
	}
}

func TestFriendStore_BackfillRead(t *testing.T) {
	dir := t.TempDir()
	fs := NewFriendStore(dir)
	card := testCard("Old")
	fp, _ := card.Fingerprint()
	if err := fs.Add(card, "Old"); err != nil {
		t.Fatal(err)
	}
	// Simulate legacy data: zero the cursor
	if err := fs.MarkRead(fp, time.Time{}); err != nil {
		t.Fatal(err)
	}
	// MarkRead will not move back to zero, so set the field directly and save to simulate history
	f := fs.load()
	f.Friends[0].LastReadAt = time.Time{}
	if err := fs.save(f); err != nil {
		t.Fatal(err)
	}
	if !fs.Get(fp).LastReadAt.IsZero() {
		t.Fatal("precondition: cursor should be zero")
	}

	before := time.Now()
	if err := fs.BackfillRead(); err != nil {
		t.Fatal(err)
	}
	got := fs.Get(fp).LastReadAt
	if got.IsZero() || got.Before(before) {
		t.Fatalf("cursor after Backfill should be >= execution time, got %v", got)
	}
	// A second Backfill is idempotent: non-zero cursors untouched
	prev := got
	if err := fs.BackfillRead(); err != nil {
		t.Fatal(err)
	}
	if got2 := fs.Get(fp).LastReadAt; !got2.Equal(prev) {
		t.Fatalf("Backfill should be idempotent, cursor must not change: %v → %v", prev, got2)
	}
}
