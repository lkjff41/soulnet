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

// Capability card delisting auth. Isomorphic to the app-square version in unpublish_auth_test.go --
// this is not defensive programming, it closes a hole that REALLY EXISTED:
//
// handleUnpublish used to accept a bare {fingerprint} and delete. fingerprint is a field publicly
// returned by GET /directory/query, so a loop over the query results could wipe every capability card
// in the discovery square. 4353a84a fixed the app square (appdirectory.go); the capability directory
// (directory.go) was missed back then, same origin and shape.
//
// Now the owner must sign "directory-unpublish:<fingerprint>" with their private key,
// and the key fingerprint must be the one being delisted.
func TestDirUnpublishRequiresOwnerSignature(t *testing.T) {
	d := NewDirectory(t.TempDir())
	mux := http.NewServeMux()
	mux.HandleFunc("POST /directory/publish", d.handlePublish)
	mux.HandleFunc("POST /directory/unpublish", d.handleUnpublish)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	// mkEntry does not return the private key, and this test needs the owner key to sign the delisting request, so build our own.
	pub, ownerPriv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	fp := a2a.Fingerprint(pub)
	card := &a2a.Card{V: 2, EdPub: a2a.EncodeKey(pub), XPub: a2a.EncodeKey(pub),
		Proxies: []string{"https://r"}, Name: "victim"}
	card.Sign(ownerPriv)
	prof := &a2a.Profile{V: 1, Fingerprint: fp, Intro: "victim",
		Skills:    []a2a.Skill{{ID: "s", Title: "writing", Tags: []string{"writing"}, Desc: "d"}},
		Accepting: true, UpdatedAt: time.Now().UTC()}
	prof.Sign(ownerPriv)

	body, _ := json.Marshal(&DirEntry{Card: card, Profile: prof})
	if r, err := http.Post(srv.URL+"/directory/publish", "application/json",
		bytes.NewReader(body)); err != nil || r.StatusCode != 200 {
		t.Fatalf("list a card first: %v %v", r, err)
	}

	post := func(t *testing.T, payload map[string]any) int {
		t.Helper()
		raw, _ := json.Marshal(payload)
		resp, err := http.Post(srv.URL+"/directory/unpublish", "application/json", bytes.NewReader(raw))
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		return resp.StatusCode
	}

	// 1. bare {fingerprint}: the shape of the old client / attacker curl, must be rejected
	if code := post(t, map[string]any{"fingerprint": fp}); code == 200 {
		t.Fatal("delisting with the fingerprint alone -- anyone could wipe the discovery square, this is the hole to close")
	}
	if d.Get(fp) == nil {
		t.Fatal("the card must still be there after rejection")
	}

	// 2. someone else's valid key + the victim fingerprint: the signature is valid, but you are not the owner of this card
	otherPub, otherPriv, _ := ed25519.GenerateKey(rand.Reader)
	if code := post(t, map[string]any{
		"fingerprint": fp,
		"ed_pub":      a2a.EncodeKey(otherPub),
		"sig":         a2a.EncodeKey(ed25519.Sign(otherPriv, a2a.DirUnpublishSigningBytes(fp))),
	}); code == 200 {
		t.Fatal("signing someone else's fingerprint with your own key delisted it -- privilege escalation")
	}
	if d.Get(fp) == nil {
		t.Fatal("the card must still be there after the escalation is rejected")
	}

	// 3. wrong signed content (own key, but a different fingerprint signed): a signature for another fingerprint cannot be reused
	if code := post(t, map[string]any{
		"fingerprint": fp,
		"ed_pub":      a2a.EncodeKey(pub),
		"sig":         a2a.EncodeKey(ed25519.Sign(ownerPriv, a2a.DirUnpublishSigningBytes("SOMEONE-ELSE"))),
	}); code == 200 {
		t.Fatal("signed content not matching fingerprint was let through")
	}
	if d.Get(fp) == nil {
		t.Fatal("the card must still be there after the mismatching signature is rejected")
	}

	// 4. cross-protocol reuse: the app-square "unpublish:<id>" signature must not open the capability directory lock
	if code := post(t, map[string]any{
		"fingerprint": fp,
		"ed_pub":      a2a.EncodeKey(pub),
		"sig":         a2a.EncodeKey(ed25519.Sign(ownerPriv, []byte("unpublish:"+fp))), // app-square delisting domain (lives in the product now), spelled out literally
	}); code == 200 {
		t.Fatal("the app-square delisting signature opened the capability directory lock -- the two signing domains must be isolated")
	}

	// 5. the owner: must be able to delist their own card normally -- over-fixing so even the owner cannot get in would be another bug
	if code := post(t, map[string]any{
		"fingerprint": fp,
		"ed_pub":      a2a.EncodeKey(pub),
		"sig":         a2a.EncodeKey(ed25519.Sign(ownerPriv, a2a.DirUnpublishSigningBytes(fp))),
	}); code != 200 {
		t.Fatalf("the owner delisting should succeed, got %d", code)
	}
	if d.Get(fp) != nil {
		t.Fatal("the card should disappear from the directory after the owner delists")
	}
	if len(d.Query([]string{"writing"}, "", 10)) != 0 {
		t.Fatal("should no longer be searchable after delisting")
	}
}

// TestDirUnpublishClientSignsRequest runs the client end to end: a2a.UnpublishProfile
// must emit a signature the relay recognises; both ends share a2a.DirUnpublishSigningBytes.
// Without this, the server gate is fine but the client cannot produce the right signature and users see "delist does nothing".
func TestDirUnpublishClientSignsRequest(t *testing.T) {
	d := NewDirectory(t.TempDir())
	mux := http.NewServeMux()
	mux.HandleFunc("POST /directory/unpublish", d.handleUnpublish)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	fp := a2a.Fingerprint(pub)
	if err := a2a.UnpublishProfile(srv.URL, fp, priv); err != nil {
		t.Fatalf("client-signed delisting should be accepted by the relay: %v", err)
	}

	// swap in a private key that does not match the fingerprint: the server must reject (the client must not be able to bypass either)
	_, otherPriv, _ := ed25519.GenerateKey(rand.Reader)
	if err := a2a.UnpublishProfile(srv.URL, fp, otherPriv); err == nil {
		t.Fatal("delisting someone else's fingerprint with someone else's private key must fail")
	}
}
