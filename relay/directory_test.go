package relay

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/startupworld-ai/soulnet/a2a"
)

func mkEntry(t *testing.T, name string, tags []string) *DirEntry {
	t.Helper()
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	fp := a2a.Fingerprint(pub)
	card := &a2a.Card{V: 2, EdPub: a2a.EncodeKey(pub), XPub: a2a.EncodeKey(pub), Proxies: []string{"https://r"}, Name: name}
	card.Sign(priv)
	prof := &a2a.Profile{V: 1, Fingerprint: fp, Skills: []a2a.Skill{{ID: "s", Title: name, Tags: tags, Desc: "d"}}, Intro: name, Accepting: true, UpdatedAt: time.Now().UTC()}
	prof.Sign(priv)
	return &DirEntry{Card: card, Profile: prof}
}

func TestDirectoryPublishQuery(t *testing.T) {
	d := NewDirectory(t.TempDir())
	if err := d.Publish(mkEntry(t, "writer", []string{"writing", "chinese"})); err != nil {
		t.Fatal(err)
	}
	if err := d.Publish(mkEntry(t, "coder", []string{"code", "go"})); err != nil {
		t.Fatal(err)
	}
	hits := d.Query([]string{"writing"}, "", 10)
	if len(hits) != 1 || hits[0].Profile.Intro != "writer" {
		t.Fatalf("query by tag should only hit writer, got %d", len(hits))
	}
	// a tampered signature must be rejected
	bad := mkEntry(t, "fake", []string{"x"})
	bad.Profile.Intro = "changed"
	if err := d.Publish(bad); err == nil {
		t.Fatal("a tampered card should be rejected")
	}
}

func TestDirectoryUnpublish(t *testing.T) {
	d := NewDirectory(t.TempDir())
	e := mkEntry(t, "writer", []string{"writing"})
	_ = d.Publish(e)
	if err := d.Unpublish(e.Profile.Fingerprint); err != nil {
		t.Fatal(err)
	}
	if len(d.Query([]string{"writing"}, "", 10)) != 0 {
		t.Fatal("should no longer be found after delisting")
	}
}

func TestDirectoryFetch(t *testing.T) {
	d := NewDirectory(t.TempDir())
	e := mkEntry(t, "writer", []string{"writing"})
	if err := d.Publish(e); err != nil {
		t.Fatal(err)
	}
	// exact in-memory fetch
	if got := d.Get(e.Profile.Fingerprint); got == nil || got.Profile.Intro != "writer" {
		t.Fatalf("Get should hit, got %+v", got)
	}
	if d.Get("NO-SUCH") != nil {
		t.Fatal("unknown fingerprint should return nil")
	}
	// exact HTTP fetch
	mux := http.NewServeMux()
	mux.HandleFunc("GET /directory/fetch", d.handleFetch)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	r, _ := http.Get(srv.URL + "/directory/fetch?fp=" + e.Profile.Fingerprint)
	if r.StatusCode != 200 {
		t.Fatalf("hit should be 200, got %d", r.StatusCode)
	}
	var got DirEntry
	if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if got.Profile == nil || got.Profile.Fingerprint != e.Profile.Fingerprint {
		t.Fatalf("fetched card fingerprint mismatch: %+v", got.Profile)
	}
	// miss -> 404
	r404, _ := http.Get(srv.URL + "/directory/fetch?fp=NO-SUCH")
	if r404.StatusCode != http.StatusNotFound {
		t.Fatalf("miss should be 404, got %d", r404.StatusCode)
	}
	// missing fp -> 400
	r400, _ := http.Get(srv.URL + "/directory/fetch")
	if r400.StatusCode != http.StatusBadRequest {
		t.Fatalf("missing fp should be 400, got %d", r400.StatusCode)
	}
}

// The card homepage (public home URL) passes through directory listing/fetch verbatim: daemon and relay share
// one a2a.Profile struct, the signature covers homepage -- listing verifies, fetch returns it unchanged.
func TestDirectoryHomepagePassthrough(t *testing.T) {
	d := NewDirectory(t.TempDir())
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	fp := a2a.Fingerprint(pub)
	card := &a2a.Card{V: 2, EdPub: a2a.EncodeKey(pub), XPub: a2a.EncodeKey(pub), Proxies: []string{"https://r"}, Name: "writer"}
	card.Sign(priv)
	prof := &a2a.Profile{V: 1, Fingerprint: fp, Skills: []a2a.Skill{{ID: "s", Title: "writing", Tags: []string{"writing"}, Desc: "d"}},
		Homepage: "https://me.alter.example/u", Intro: "writer", Accepting: true, UpdatedAt: time.Now().UTC()}
	prof.Sign(priv)
	if err := d.Publish(&DirEntry{Card: card, Profile: prof}); err != nil {
		t.Fatalf("listing a card with homepage should pass verification: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /directory/fetch", d.handleFetch)
	srv := httptest.NewServer(mux)
	defer srv.Close()
	r, _ := http.Get(srv.URL + "/directory/fetch?fp=" + fp)
	var got DirEntry
	if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if got.Profile == nil || got.Profile.Homepage != "https://me.alter.example/u" {
		t.Fatalf("fetch should return homepage verbatim, got %+v", got.Profile)
	}
}

func TestDirectoryHTTP(t *testing.T) {
	d := NewDirectory(t.TempDir())
	mux := http.NewServeMux()
	mux.HandleFunc("POST /directory/publish", d.handlePublish)
	mux.HandleFunc("GET /directory/query", d.handleQuery)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	e := mkEntry(t, "writer", []string{"writing"})
	body, _ := json.Marshal(e)
	resp, err := http.Post(srv.URL+"/directory/publish", "application/json", bytes.NewReader(body))
	if err != nil || resp.StatusCode != 200 {
		t.Fatalf("publish should be 200, got %v %v", resp, err)
	}
	r2, _ := http.Get(srv.URL + "/directory/query?tags=writing&limit=10")
	var out struct {
		Entries []*DirEntry `json:"entries"`
	}
	json.NewDecoder(r2.Body).Decode(&out)
	if len(out.Entries) != 1 {
		t.Fatalf("query should hit 1, got %d", len(out.Entries))
	}
}
