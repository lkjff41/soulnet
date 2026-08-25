package relay

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/startupworld-ai/soulnet/a2a"
)

// signedReq builds a request carrying a valid A2A signature for method+path.
func signedReq(t *testing.T, priv ed25519.PrivateKey, method, url, path string, body []byte) *http.Request {
	t.Helper()
	req, err := http.NewRequest(method, url, bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	ts := time.Now().UTC().Format(time.RFC3339)
	req.Header.Set(a2a.HeaderPub, a2a.EncodeKey(priv.Public().(ed25519.PublicKey)))
	req.Header.Set(a2a.HeaderTimestamp, ts)
	req.Header.Set(a2a.HeaderSignature, a2a.SignReq(priv, method, path, ts))
	return req
}

func TestHandleRejectsDuplicateAndCoreRoutes(t *testing.T) {
	s := newTestServer(t)
	ok := func(w http.ResponseWriter, r *http.Request) { WriteJSON(w, 200, map[string]any{"ext": true}) }
	if err := s.HandleFunc("GET /ext/ping", ok); err != nil {
		t.Fatalf("first registration: %v", err)
	}
	if err := s.HandleFunc("GET /ext/ping", ok); err == nil {
		t.Fatal("second registration of the same pattern must fail")
	}
	if err := s.HandleFunc("POST /mail", ok); err == nil {
		t.Fatal("a core route must not be overridable by an extension")
	}
	if err := s.HandleFunc("GET /ext/{a}/x", ok); err != nil {
		t.Fatal(err)
	}
	if err := s.HandleFunc("GET /ext/y/{b}", ok); err == nil {
		t.Fatal("a pattern conflicting with an existing one must surface as an error, not a panic")
	}
	srv := httptest.NewServer(s.Handler())
	defer srv.Close()
	resp, err := http.Get(srv.URL + "/ext/ping")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&out)
	if resp.StatusCode != 200 || out["ext"] != true {
		t.Fatalf("extension route not served: %d %v", resp.StatusCode, out)
	}
	if s.DataDir() == "" {
		t.Fatal("DataDir must return the directory the server was created with")
	}
}

func TestUseWrapsWholeHandler(t *testing.T) {
	s := newTestServer(t)
	s.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if strings.HasPrefix(r.Host, "alice.") {
				WriteJSON(w, 200, map[string]any{"tunnel": r.Host})
				return
			}
			next.ServeHTTP(w, r)
		})
	})
	srv := httptest.NewServer(s.Handler())
	defer srv.Close()
	req, _ := http.NewRequest("GET", srv.URL+"/health", nil)
	req.Host = "alice.alter.test"
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var out map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&out)
	resp.Body.Close()
	if out["tunnel"] != "alice.alter.test" {
		t.Fatalf("middleware must see the request before the mux: %v", out)
	}
	resp, err = http.Get(srv.URL + "/health")
	if err != nil {
		t.Fatal(err)
	}
	out = nil
	_ = json.NewDecoder(resp.Body).Decode(&out)
	resp.Body.Close()
	if out["ok"] != true {
		t.Fatalf("non-matching hosts must fall through to the core routes: %v", out)
	}
}

func TestAdminOKAndRequireAdmin(t *testing.T) {
	s := newTestServer(t)
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { WriteJSON(w, 200, map[string]any{"admin": true}) })
	if err := s.Handle("GET /admin/x", s.RequireAdmin(inner)); err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(s.Handler())
	defer srv.Close()
	get := func(token string) int {
		req, _ := http.NewRequest("GET", srv.URL+"/admin/x", nil)
		if token != "" {
			req.Header.Set("X-Admin-Token", token)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return resp.StatusCode
	}
	if get("anything") != 403 {
		t.Fatal("with no token configured every admin check must fail")
	}
	s.SetAdminToken("secret")
	if get("wrong") != 403 || get("") != 403 {
		t.Fatal("wrong or missing token must be rejected")
	}
	if get("secret") != 200 {
		t.Fatal("correct token must pass")
	}
	req, _ := http.NewRequest("GET", srv.URL+"/admin/x?token=secret", nil)
	resp, _ := http.DefaultClient.Do(req)
	resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatal("token may also be passed as ?token=")
	}
}

func TestVerifyRequest(t *testing.T) {
	_, priv, _ := ed25519.GenerateKey(rand.Reader)
	req := signedReq(t, priv, "GET", "http://x/ext/me", "/ext/me", nil)
	fp, err := VerifyRequest(req, "GET", "/ext/me")
	if err != nil {
		t.Fatalf("valid signature rejected: %v", err)
	}
	if fp != a2a.Fingerprint(priv.Public().(ed25519.PublicKey)) {
		t.Fatal("VerifyRequest must return the signer fingerprint")
	}
	if _, err := VerifyRequest(req, "POST", "/ext/me"); err == nil {
		t.Fatal("signature over a different method must fail")
	}
	if _, err := VerifyRequest(&http.Request{Header: http.Header{}}, "GET", "/ext/me"); err == nil {
		t.Fatal("unsigned request must fail")
	}
}

func TestEventsDirectoryMailAndCancel(t *testing.T) {
	s := newTestServer(t)
	var mu = make(chan Event, 16)
	cancel := s.Subscribe(func(ev Event) { mu <- ev })
	srv := httptest.NewServer(s.Handler())
	defer srv.Close()

	// directory.published
	e := mkEntry(t, "writer", []string{"writing"})
	raw, _ := json.Marshal(e)
	resp, err := http.Post(srv.URL+"/directory/publish", "application/json", bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("publish: %d", resp.StatusCode)
	}
	ev := <-mu
	if ev.Kind != EventDirectoryPublished || ev.FP != e.Profile.Fingerprint {
		t.Fatalf("expected directory.published for %s, got %+v", e.Profile.Fingerprint, ev)
	}

	// mail.delivered: a validly signed envelope from a fresh identity to some box.
	sender, err := a2a.NewIdentity(t.TempDir(), "sender", []string{srv.URL})
	if err != nil {
		t.Fatal(err)
	}
	recv, err := a2a.NewIdentity(t.TempDir(), "recv", []string{srv.URL})
	if err != nil {
		t.Fatal(err)
	}
	recvCard, _ := recv.Card()
	recvPriv, err := recv.EdPrivate()
	if err != nil {
		t.Fatal(err)
	}
	env, err := a2a.SealEnvelope(sender, recvCard, &a2a.Message{Type: "text", Body: "hi"})
	if err != nil {
		t.Fatal(err)
	}
	raw, _ = json.Marshal(env)
	resp, err = http.Post(srv.URL+"/mail", "application/json", bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("post mail: %d", resp.StatusCode)
	}
	ev = <-mu
	if ev.Kind != EventMailDelivered || ev.FP != env.To || ev.Data["from"] != env.From {
		t.Fatalf("expected mail.delivered, got %+v", ev)
	}

	// mail.acked: fetch then ack as the recipient.
	req := signedReq(t, recvPriv, "GET", srv.URL+"/mail?box="+env.To, "/mail", nil)
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var got struct {
		Messages []struct {
			AckID string `json:"ack_id"`
		} `json:"messages"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&got)
	resp.Body.Close()
	if len(got.Messages) != 1 {
		t.Fatalf("expected one letter, got %d", len(got.Messages))
	}
	body, _ := json.Marshal(map[string]any{"box": env.To, "ack_ids": []string{got.Messages[0].AckID}})
	req = signedReq(t, recvPriv, "POST", srv.URL+"/mail/ack", "/mail/ack", body)
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	ev = <-mu
	if ev.Kind != EventMailAcked || ev.FP != env.To || ev.Data["removed"] != 1 {
		t.Fatalf("expected mail.acked removed=1, got %+v", ev)
	}

	// cancel: no further events reach the subscriber.
	cancel()
	raw, _ = json.Marshal(e)
	resp, _ = http.Post(srv.URL+"/directory/publish", "application/json", bytes.NewReader(raw))
	resp.Body.Close()
	select {
	case ev := <-mu:
		t.Fatalf("subscription cancelled but still received %+v", ev)
	case <-time.After(100 * time.Millisecond):
	}
}

func TestSubscriberPanicIsContained(t *testing.T) {
	s := newTestServer(t)
	s.Subscribe(func(Event) { panic("boom") })
	srv := httptest.NewServer(s.Handler())
	defer srv.Close()
	raw, _ := json.Marshal(mkEntry(t, "x", nil))
	resp, err := http.Post(srv.URL+"/directory/publish", "application/json", bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("a panicking subscriber must not fail the request: %d", resp.StatusCode)
	}
}
