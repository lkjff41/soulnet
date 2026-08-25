package peer

import (
	"fmt"
	"time"

	"github.com/startupworld-ai/soulnet/a2a"
)

// DirectoryQuery does a coarse search of the relay's capability directory by tags /
// keyword. limit<=0 means 20.
func (n *Peer) DirectoryQuery(tags []string, keyword string, limit int) ([]a2a.DirHit, error) {
	if limit <= 0 {
		limit = 20
	}
	hits, err := a2a.QueryDirectory(n.RelayBase(), tags, keyword, limit)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrNetwork, err)
	}
	// Keep only self-consistent signed entries — the directory is a public write
	// endpoint, the client does its own checking.
	out := hits[:0]
	for _, h := range hits {
		if h.Card == nil || h.Card.Verify() != nil {
			continue
		}
		if h.Profile != nil && h.Profile.Verify(h.Card.EdPub) != nil {
			continue
		}
		out = append(out, h)
	}
	return out, nil
}

// DirectoryFetch fetches one public card by exact fingerprint; (nil, nil) when the
// directory has no such entry.
func (n *Peer) DirectoryFetch(fp string) (*a2a.DirHit, error) {
	hit, err := a2a.FetchProfile(n.RelayBase(), fp)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrNetwork, err)
	}
	if hit == nil {
		return nil, nil
	}
	if hit.Card == nil || hit.Card.Verify() != nil {
		return nil, fmt.Errorf("card returned by the directory failed verification")
	}
	if hit.Profile != nil && hit.Profile.Verify(hit.Card.EdPub) != nil {
		return nil, fmt.Errorf("profile returned by the directory failed verification")
	}
	return hit, nil
}

// MyProfile returns the local capability profile (a2a/profile.json); (nil, nil) when none.
func (n *Peer) MyProfile() (*a2a.Profile, error) { return n.Profiles.Mine() }

// SaveProfile stores the local capability profile: fills V/Fingerprint/UpdatedAt, self-signs
// and writes it. Saving ≠ publishing; publishing needs an explicit Publish.
func (n *Peer) SaveProfile(p *a2a.Profile) (*a2a.Profile, error) {
	id := n.Identity()
	if id == nil {
		return nil, ErrNoIdentity
	}
	if p == nil {
		return nil, fmt.Errorf("profile is nil")
	}
	priv, err := id.EdPrivate()
	if err != nil {
		return nil, err
	}
	cp := *p
	if cp.V == 0 {
		cp.V = 1
	}
	cp.Fingerprint = id.Fingerprint()
	cp.UpdatedAt = time.Now()
	cp.Sign(priv)
	if err := n.Profiles.SaveMine(&cp); err != nil {
		return nil, err
	}
	return &cp, nil
}

// Publish publishes the local card plus the public copy of the capability profile (Hidden
// items filtered out, re-signed) to the directory. p nil uses the saved profile.json;
// with neither it returns ErrNoProfile.
func (n *Peer) Publish(p *a2a.Profile) error {
	id := n.Identity()
	if id == nil {
		return ErrNoIdentity
	}
	if p != nil {
		saved, err := n.SaveProfile(p)
		if err != nil {
			return err
		}
		p = saved
	} else {
		saved, err := n.Profiles.Mine()
		if err != nil {
			return err
		}
		if saved == nil {
			return ErrNoProfile
		}
		p = saved
	}
	card, err := id.Card()
	if err != nil {
		return err
	}
	priv, err := id.EdPrivate()
	if err != nil {
		return err
	}
	pub := p.PublicCopy()
	pub.Fingerprint = id.Fingerprint()
	pub.Sign(priv)
	if err := a2a.PublishProfile(n.RelayBase(), card, pub); err != nil {
		return fmt.Errorf("%w: %v", ErrNetwork, err)
	}
	return n.Profiles.SetPublished(true)
}

// Unpublish removes the local card from the directory (signed with the local private key).
func (n *Peer) Unpublish() error {
	id := n.Identity()
	if id == nil {
		return ErrNoIdentity
	}
	priv, err := id.EdPrivate()
	if err != nil {
		return err
	}
	if err := a2a.UnpublishProfile(n.RelayBase(), id.Fingerprint(), priv); err != nil {
		return fmt.Errorf("%w: %v", ErrNetwork, err)
	}
	return n.Profiles.SetPublished(false)
}

// Published reports whether the local card is published (local flag).
func (n *Peer) Published() bool { return n.Profiles.IsPublished() }
