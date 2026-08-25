package a2a

import (
	"bytes"
	"crypto/ed25519"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// DirHit is one directory-query hit (public card + capability declaration).
// Note: the relay package already imports a2a, so to avoid an import cycle this client lives in package a2a and does not import relay.
type DirHit struct {
	Card    *Card    `json:"card"`
	Profile *Profile `json:"profile"`
}

var dirHTTP = &http.Client{Timeout: 15 * time.Second}

// PublishProfile opt-in publishes the public card + capability declaration to the relay directory.
func PublishProfile(relayBase string, card *Card, p *Profile) error {
	body, _ := json.Marshal(DirHit{Card: card, Profile: p})
	resp, err := dirHTTP.Post(strings.TrimRight(relayBase, "/")+"/directory/publish", "application/json", bytes.NewReader(body))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		msg, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("发布失败(%d): %s", resp.StatusCode, strings.TrimSpace(string(msg)))
	}
	return nil
}

// DirUnpublishSigningBytes is the bytes-to-sign of a capability-card unpublish request.
// This is the **only** definition: the relay side's directory.go calls it directly (relay already imports a2a)
// instead of keeping its own copy — the app-market shape where each end carries its own copy is precisely one of
// the reasons this hole was missed.
//
// The prefix deliberately differs from the app market's "unpublish:<id>": the two unpublish signatures must never
// be cross-usable, lest some day an id and a fingerprint happen to share a shape and one signature opens two locks.
func DirUnpublishSigningBytes(fingerprint string) []byte {
	return []byte("directory-unpublish:" + fingerprint)
}

// UnpublishProfile removes the listing from the relay directory; it must be signed with the local private key to prove "this card is mine".
// The relay verifies the signature and checks Fingerprint(ed_pub) == fingerprint — a valid signature by someone else is not enough.
func UnpublishProfile(relayBase, fingerprint string, priv ed25519.PrivateKey) error {
	if len(priv) != ed25519.PrivateKeySize {
		return fmt.Errorf("下架需要本机私钥签名，但私钥无效")
	}
	pub, _ := priv.Public().(ed25519.PublicKey)
	body, _ := json.Marshal(map[string]string{
		"fingerprint": fingerprint,
		"ed_pub":      EncodeKey(pub),
		"sig":         EncodeKey(ed25519.Sign(priv, DirUnpublishSigningBytes(fingerprint))),
	})
	resp, err := dirHTTP.Post(strings.TrimRight(relayBase, "/")+"/directory/unpublish", "application/json", bytes.NewReader(body))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		msg, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("下架失败(%d): %s", resp.StatusCode, strings.TrimSpace(string(msg)))
	}
	return nil
}

// QueryDirectory does a coarse inverted-index pre-filter of candidates.
func QueryDirectory(relayBase string, tags []string, keyword string, limit int) ([]DirHit, error) {
	u := fmt.Sprintf("%s/directory/query?tags=%s&kw=%s&limit=%d",
		strings.TrimRight(relayBase, "/"), urlQ(strings.Join(tags, ",")), urlQ(keyword), limit)
	resp, err := dirHTTP.Get(u)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("查询失败(%d)", resp.StatusCode)
	}
	var out struct {
		Entries []DirHit `json:"entries"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	return out.Entries, nil
}

// FetchProfile fetches exactly one public card (card + profile) from the relay directory by fingerprint.
// Used after adding a friend to sync the peer's full capability card locally. Not found (404) returns (nil, nil),
// so the caller can degrade gracefully (log it, do not block adding the friend).
func FetchProfile(relayBase, fingerprint string) (*DirHit, error) {
	u := fmt.Sprintf("%s/directory/fetch?fp=%s", strings.TrimRight(relayBase, "/"), urlQ(fingerprint))
	resp, err := dirHTTP.Get(u)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return nil, nil
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("取名片失败(%d)", resp.StatusCode)
	}
	var hit DirHit
	if err := json.NewDecoder(resp.Body).Decode(&hit); err != nil {
		return nil, err
	}
	return &hit, nil
}

func urlQ(s string) string {
	return strings.NewReplacer(" ", "%20", "&", "%26", "#", "%23").Replace(s)
}
