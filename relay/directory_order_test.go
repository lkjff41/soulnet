package relay

import (
	"crypto/ed25519"
	"crypto/rand"
	"testing"
	"time"

	"github.com/startupworld-ai/soulnet/a2a"
)

// Regression: the directory queries of both squares used to build candidates by iterating a Go map and only stable-sorted by score,
// so equal-score entries kept the random map order -- refresh/re-enter/restart all shuffled them.
// The two cases below pin the worst case "all entries same score, same timestamp": the order must be unique and reproducible.

// mkEntryAt builds a self-signed capability card with a fixed updated_at (to construct equal-score, equal-time ties).
func mkEntryAt(t *testing.T, name string, tags []string, at time.Time) *DirEntry {
	t.Helper()
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	fp := a2a.Fingerprint(pub)
	card := &a2a.Card{V: 2, EdPub: a2a.EncodeKey(pub), XPub: a2a.EncodeKey(pub), Proxies: []string{"https://r"}, Name: name}
	card.Sign(priv)
	prof := &a2a.Profile{
		V: 1, Fingerprint: fp,
		Skills:    []a2a.Skill{{ID: "s", Title: name, Tags: tags, Desc: "same-kind desc"}},
		Intro:     "same-kind intro",
		Accepting: true, UpdatedAt: at,
	}
	prof.Sign(priv)
	return &DirEntry{Card: card, Profile: prof}
}

func dirFPs(entries []*DirEntry) []string {
	out := make([]string, 0, len(entries))
	for _, e := range entries {
		out = append(out, e.Profile.Fingerprint)
	}
	return out
}

func sameSeq(t *testing.T, want, got []string, what string) {
	t.Helper()
	if len(want) != len(got) {
		t.Fatalf("%s: count mismatch want %d got %d", what, len(want), len(got))
	}
	for i := range want {
		if want[i] != got[i] {
			t.Fatalf("%s: position %d swapped\nwant %v\ngot  %v", what, i, want, got)
		}
	}
}

func TestDirectoryQueryStableOrder(t *testing.T) {
	base := t.TempDir()
	d := NewDirectory(base)
	at := time.Date(2026, 7, 20, 10, 0, 0, 0, time.UTC)
	for i := 0; i < 24; i++ { // 24 entries: enough for map iteration jitter to show
		if err := d.Publish(mkEntryAt(t, "same-kind skill", []string{"writing"}, at)); err != nil {
			t.Fatal(err)
		}
	}

	want := dirFPs(d.Query(nil, "", 0))
	if len(want) != 24 {
		t.Fatalf("should list all 24, got %d", len(want))
	}
	// repeated queries on the same instance
	for i := 0; i < 20; i++ {
		sameSeq(t, want, dirFPs(d.Query(nil, "", 0)), "capability square repeated query")
	}
	// reload from disk (equivalent to a relay restart)
	for i := 0; i < 5; i++ {
		sameSeq(t, want, dirFPs(NewDirectory(base).Query(nil, "", 0)), "capability square after reload")
	}
	// equal-score hits with criteria must be stable too
	kwWant := dirFPs(d.Query([]string{"writing"}, "same-kind", 0))
	for i := 0; i < 5; i++ {
		sameSeq(t, kwWant, dirFPs(d.Query([]string{"writing"}, "same-kind", 0)), "capability square query with criteria")
	}
	// limit truncation must be a prefix of the same sequence
	if top := dirFPs(d.Query(nil, "", 5)); len(top) != 5 {
		t.Fatalf("limit=5 should return 5, got %d", len(top))
	} else {
		sameSeq(t, want[:5], top, "capability square limit prefix")
	}
}

// With different timestamps the newer one must come first (second key of the sort contract).
func TestDirectoryQueryNewestFirst(t *testing.T) {
	d := NewDirectory(t.TempDir())
	old := mkEntryAt(t, "old", nil, time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	recent := mkEntryAt(t, "recent", nil, time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC))
	if err := d.Publish(old); err != nil {
		t.Fatal(err)
	}
	if err := d.Publish(recent); err != nil {
		t.Fatal(err)
	}
	got := d.Query(nil, "", 0)
	if len(got) != 2 || got[0].Profile.Fingerprint != recent.Profile.Fingerprint {
		t.Fatalf("the more recently updated should come first, got %v", dirFPs(got))
	}
}
