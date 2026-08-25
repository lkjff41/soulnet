package relay

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/startupworld-ai/soulnet/a2a"
)

func groupTestServer(t *testing.T) (*Server, *httptest.Server) {
	t.Helper()
	s, err := New(t.TempDir())
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	return s, ts
}

func groupTestIdentity(t *testing.T, name, relay string) *a2a.Identity {
	t.Helper()
	id, err := a2a.NewIdentity(t.TempDir(), name, []string{relay})
	if err != nil {
		t.Fatalf("NewIdentity: %v", err)
	}
	return id
}

func signedRoster(t *testing.T, owner *a2a.Identity, relay string, version int, members ...*a2a.Identity) *a2a.GroupRoster {
	t.Helper()
	cards := make([]*a2a.Card, 0, len(members)+1)
	oc, err := owner.Card()
	if err != nil {
		t.Fatalf("owner card: %v", err)
	}
	cards = append(cards, oc)
	for _, m := range members {
		c, err := m.Card()
		if err != nil {
			t.Fatalf("member card: %v", err)
		}
		cards = append(cards, c)
	}
	gid, _ := a2a.NewGroupID()
	g := &a2a.GroupRoster{V: 1, GroupID: gid, Name: "relay test group", OwnerPub: owner.EdPub,
		Relay: relay, Version: version, Members: cards, TS: time.Now()}
	priv, _ := owner.EdPrivate()
	g.Sign(priv)
	return g
}

func postJSON(t *testing.T, url string, v any) *http.Response {
	t.Helper()
	raw, _ := json.Marshal(v)
	resp, err := http.Post(url, "application/json", bytes.NewReader(raw))
	if err != nil {
		t.Fatalf("POST %s: %v", url, err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	return resp
}

func TestGroupPublishFetchAuth(t *testing.T) {
	_, ts := groupTestServer(t)
	owner := groupTestIdentity(t, "owner", ts.URL)
	bob := groupTestIdentity(t, "bob", ts.URL)
	mallory := groupTestIdentity(t, "mallory", ts.URL)
	g := signedRoster(t, owner, ts.URL, 1, bob)

	if resp := postJSON(t, ts.URL+"/group/publish", g); resp.StatusCode != 200 {
		t.Fatalf("publish: %d", resp.StatusCode)
	}

	// Members can fetch; a stranger cannot.
	if _, err := a2a.NewProxyClient(ts.URL, bob).FetchGroup(context.Background(), g.GroupID); err != nil {
		t.Fatalf("member fetch: %v", err)
	}
	if _, err := a2a.NewProxyClient(ts.URL, mallory).FetchGroup(context.Background(), g.GroupID); err == nil {
		t.Fatalf("stranger fetched the roster")
	}

	// Republish: same version is rejected, higher version accepted, foreign owner rejected.
	if resp := postJSON(t, ts.URL+"/group/publish", g); resp.StatusCode != 409 {
		t.Fatalf("same-version republish: %d", resp.StatusCode)
	}
	g2 := *g
	g2.Version = 2
	g2.TS = time.Now()
	priv, _ := owner.EdPrivate()
	g2.Sign(priv)
	if resp := postJSON(t, ts.URL+"/group/publish", &g2); resp.StatusCode != 200 {
		t.Fatalf("v2 republish: %d", resp.StatusCode)
	}
	hijack := signedRoster(t, mallory, ts.URL, 3)
	hijack.GroupID = g.GroupID
	mpriv, _ := mallory.EdPrivate()
	hijack.Sign(mpriv)
	if resp := postJSON(t, ts.URL+"/group/publish", hijack); resp.StatusCode != 403 {
		t.Fatalf("owner hijack: %d", resp.StatusCode)
	}
}

func TestGroupMailFanOut(t *testing.T) {
	_, ts := groupTestServer(t)
	owner := groupTestIdentity(t, "owner", ts.URL)
	bob := groupTestIdentity(t, "bob", ts.URL)
	carol := groupTestIdentity(t, "carol", ts.URL)
	mallory := groupTestIdentity(t, "mallory", ts.URL)
	g := signedRoster(t, owner, ts.URL, 1, bob, carol)
	if resp := postJSON(t, ts.URL+"/group/publish", g); resp.StatusCode != 200 {
		t.Fatalf("publish: %d", resp.StatusCode)
	}

	sk, _ := a2a.NewGroupSenderKey(1)
	ct, err := a2a.GroupSeal(sk, &a2a.Message{ID: "m1", From: owner.Fingerprint(), GID: g.GroupID,
		TS: time.Now(), Type: a2a.TypeText, Body: "hello group"})
	if err != nil {
		t.Fatalf("seal: %v", err)
	}
	env, err := a2a.SealGroupEnvelope(owner, g.GroupID, ct)
	if err != nil {
		t.Fatalf("seal env: %v", err)
	}
	if err := a2a.NewProxyClient(ts.URL, owner).DeliverGroup(context.Background(), env); err != nil {
		t.Fatalf("DeliverGroup: %v", err)
	}

	// Bob and carol each get exactly one copy; the sender gets none.
	for _, tc := range []struct {
		id   *a2a.Identity
		want int
	}{{bob, 1}, {carol, 1}, {owner, 0}} {
		items, err := a2a.NewProxyClient(ts.URL, tc.id).Poll(context.Background(), 0)
		if err != nil {
			t.Fatalf("poll %s: %v", tc.id.Name, err)
		}
		if len(items) != tc.want {
			t.Fatalf("%s: want %d copies, got %d", tc.id.Name, tc.want, len(items))
		}
		if tc.want == 1 {
			if items[0].GID != g.GroupID || items[0].To != tc.id.Fingerprint() {
				t.Fatalf("%s: bad copy %+v", tc.id.Name, items[0].Envelope)
			}
			if _, err := items[0].VerifyGroupEnvelope(); err != nil {
				t.Fatalf("%s: copy no longer verifies: %v", tc.id.Name, err)
			}
		}
	}

	// A non-member sender is rejected even with a valid signature.
	ct2, _ := a2a.GroupSeal(sk, &a2a.Message{ID: "m2", From: mallory.Fingerprint(), GID: g.GroupID,
		TS: time.Now(), Type: a2a.TypeText, Body: "let me in"})
	env2, _ := a2a.SealGroupEnvelope(mallory, g.GroupID, ct2)
	if err := a2a.NewProxyClient(ts.URL, mallory).DeliverGroup(context.Background(), env2); err == nil {
		t.Fatalf("non-member fan-out accepted")
	}

	// Unknown group.
	env3 := *env
	env3.GID = "00000000000000000000000000000000"
	priv, _ := owner.EdPrivate()
	_ = priv // re-sign for the new gid
	env4, _ := a2a.SealGroupEnvelope(owner, env3.GID, ct)
	if err := a2a.NewProxyClient(ts.URL, owner).DeliverGroup(context.Background(), env4); err == nil {
		t.Fatalf("unknown-group fan-out accepted")
	}
}
