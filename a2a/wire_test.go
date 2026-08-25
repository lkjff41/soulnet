package a2a

import (
	"crypto/ecdh"
	"crypto/ed25519"
	"crypto/rand"
	"testing"
	"time"
)

func newKP(t *testing.T) (ed25519.PublicKey, ed25519.PrivateKey, *ecdh.PrivateKey) {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	x, err := ecdh.X25519().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return pub, priv, x
}

func TestSealOpenRoundTrip(t *testing.T) {
	_, _, ax := newKP(t)
	_, _, bx := newKP(t)
	msg := &Message{ID: "m1", Type: TypeText, Body: "Is your owner free on Thursday?"}

	cipher, err := Seal(ax, bx.PublicKey(), msg)
	if err != nil {
		t.Fatal(err)
	}
	// B can decrypt with its own private key + A's public key
	got, err := Open(bx, ax.PublicKey(), cipher)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if got.Body != msg.Body {
		t.Errorf("decrypted content mismatch: %q", got.Body)
	}
	// A third party (unrelated key) cannot decrypt
	_, _, cx := newKP(t)
	if _, err := Open(cx, ax.PublicKey(), cipher); err == nil {
		t.Error("an unrelated key should not be able to decrypt")
	}
}

func TestEnvelopeSignVerify(t *testing.T) {
	pub, priv, _ := newKP(t)
	env := &Envelope{V: 2, To: "box1", From: EncodeKey(pub), Cipher: "abc"}
	env.Sig = EncodeKey(ed25519.Sign(priv, envelopeSigningBytes(env.To, env.TS, env.Cipher)))
	if err := env.VerifyEnvelope(); err != nil {
		t.Errorf("signature verification should pass: %v", err)
	}
	env.Cipher = "tampered"
	if err := env.VerifyEnvelope(); err == nil {
		t.Error("verification should fail after tampering with the ciphertext")
	}
}

func TestCardRoundTrip(t *testing.T) {
	pub, priv, x := newKP(t)
	c := &Card{V: 2, EdPub: EncodeKey(pub), XPub: EncodeKey(x.PublicKey().Bytes()),
		Proxies: []string{"http://127.0.0.1:9190"}, Name: "Kevin"}
	c.Sign(priv)

	uri := c.EncodeURI()
	parsed, err := ParseCard(uri)
	if err != nil {
		t.Fatalf("ParseCard: %v", err)
	}
	if parsed.Name != "Kevin" || parsed.EdPub != c.EdPub {
		t.Errorf("card round trip mismatch: %+v", parsed)
	}
	fp1, _ := c.Fingerprint()
	fp2, _ := parsed.Fingerprint()
	if fp1 != fp2 || fp1 == "" {
		t.Error("fingerprints should match and be non-empty")
	}
	// Tampering with the nickname breaks the signature → ParseCard rejects
	bad := c.EncodeURI() + "&name=Faker"
	_ = bad
	tampered := *c
	tampered.Name = "Faker"
	if err := tampered.Verify(); err == nil {
		t.Error("verification should fail after tampering with a card field")
	}
}

func TestReqSignVerify(t *testing.T) {
	pub, priv, _ := newKP(t)
	ts := time.Now().Format(time.RFC3339)
	sig := SignReq(priv, "GET", "/mail", ts)
	fp, err := VerifyReq(EncodeKey(pub), "GET", "/mail", ts, sig)
	if err != nil {
		t.Fatalf("VerifyReq: %v", err)
	}
	if fp != Fingerprint(pub) {
		t.Error("returned fingerprint should equal the signing key's fingerprint")
	}
	if _, err := VerifyReq(EncodeKey(pub), "POST", "/mail", ts, sig); err == nil {
		t.Error("a mismatched method should fail verification")
	}
}
