package a2a

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"gopkg.in/yaml.v3"
)

// Friend is one friend entry (A2A v2 §3.3: the relationship is stored only locally on each side).
// Minimal design: no more groups, auto_reply, trusted or other mechanical switches — how the alter talks
// to this person, whether it trusts them, whether it may act on their behalf, all comes from the diplomatic
// protocol + this person's wiki profile. Only identity is kept here.
type Friend struct {
	Fingerprint string    `yaml:"fingerprint" json:"fingerprint"`     // public-key fingerprint (primary key)
	Note        string    `yaml:"note" json:"note"`                   // local note name (links to the wiki person profile)
	Protocol    string    `yaml:"protocol,omitempty" json:"protocol"` // communication protocol for this person only; overrides the general diplomatic protocol on conflict
	Card        *Card     `yaml:"card" json:"card"`                   // card snapshot (public keys, relay addresses)
	AddedAt     time.Time `yaml:"added_at" json:"added_at"`
	// LastReadAt is the "read cursor": when the owner last viewed this person's conversation.
	// Unread count = number of messages the peer sent (dir=="in") after it (see ConvStore.UnreadCount).
	// Set to now when a new friend is created (history counts as read); refreshed when the owner opens the conversation (see MarkRead).
	LastReadAt time.Time `yaml:"last_read_at,omitempty" json:"last_read_at,omitempty"`
}

// friendsFile maps to ~/.soulmirror/a2a/friends.yaml.
type friendsFile struct {
	Friends []*Friend `yaml:"friends"`
}

// FriendStore manages reading/writing friends.yaml.
type FriendStore struct {
	path string
	mu   sync.Mutex
}

// NewFriendStore creates the friend store.
func NewFriendStore(baseDir string) *FriendStore {
	return &FriendStore{path: filepath.Join(baseDir, "a2a", "friends.yaml")}
}

func (s *FriendStore) load() *friendsFile {
	f := &friendsFile{}
	if raw, err := os.ReadFile(s.path); err == nil {
		_ = yaml.Unmarshal(raw, f)
	}
	return f
}

func (s *FriendStore) save(f *friendsFile) error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	raw, err := yaml.Marshal(f)
	if err != nil {
		return err
	}
	return os.WriteFile(s.path, raw, 0o644)
}

// Friends returns the friend list (sorted by note name).Never returns nil (JSON "[]" when empty).
func (s *FriendStore) Friends() []*Friend {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := append([]*Friend{}, s.load().Friends...)
	sort.Slice(out, func(i, j int) bool { return out[i].Note < out[j].Note })
	return out
}

// Get finds a friend by fingerprint; returns nil when absent.
func (s *FriendStore) Get(fp string) *Friend {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, fr := range s.load().Friends {
		if fr.Fingerprint == fp {
			return fr
		}
	}
	return nil
}

// IsFriend reports whether the fingerprint is a friend (whitelist check).
func (s *FriendStore) IsFriend(fp string) bool { return s.Get(fp) != nil }

// Add adds a friend from a card (updates the card snapshot/note if already present). An empty note falls back to the card nickname.
func (s *FriendStore) Add(card *Card, note string) error {
	fp, err := card.Fingerprint()
	if err != nil {
		return err
	}
	if note == "" {
		note = card.Name
	}
	if note == "" {
		note = fp[:8]
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	f := s.load()
	for _, fr := range f.Friends {
		if fr.Fingerprint == fp {
			fr.Card = card
			if note != "" {
				fr.Note = note
			}
			return s.save(f)
		}
	}
	now := time.Now()
	f.Friends = append(f.Friends, &Friend{
		Fingerprint: fp, Note: note, Card: card, AddedAt: now,
		LastReadAt: now, // new friend: no prior exchange, the read cursor starts at creation
	})
	return s.save(f)
}

// MarkRead advances a friend's read cursor to t (called when the owner opens the conversation).
// Non-friends (e.g. "my alter") are silently ignored, no error.
func (s *FriendStore) MarkRead(fp string, t time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	f := s.load()
	for _, fr := range f.Friends {
		if fr.Fingerprint == fp {
			if t.After(fr.LastReadAt) {
				fr.LastReadAt = t
				return s.save(f)
			}
			return nil // the cursor only moves forward, never back
		}
	}
	return nil
}

// BackfillRead gives legacy friends (existing before the upgrade, without a read cursor) an "all read as of now" cursor,
// so a pile of old conversations does not suddenly all turn unread after upgrading. Only touches entries whose LastReadAt is zero; idempotent.
func (s *FriendStore) BackfillRead() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	f := s.load()
	now := time.Now()
	changed := false
	for _, fr := range f.Friends {
		if fr.LastReadAt.IsZero() {
			fr.LastReadAt = now
			changed = true
		}
	}
	if !changed {
		return nil
	}
	return s.save(f)
}

// SetNote changes a friend's note name.
func (s *FriendStore) SetNote(fp, note string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	f := s.load()
	for _, fr := range f.Friends {
		if fr.Fingerprint == fp {
			fr.Note = note
			return s.save(f)
		}
	}
	return fmt.Errorf("不是好友: %s", fp)
}

// Remove deletes the friend with fingerprint fp from friends.yaml. Purely local
// (relationships live only on each side; the peer is not notified) and leaves the
// conversation archive / artifacts / profile snapshot untouched. Returns an error when
// fp is not a friend.
func (s *FriendStore) Remove(fp string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	f := s.load()
	for i, fr := range f.Friends {
		if fr.Fingerprint == fp {
			f.Friends = append(f.Friends[:i], f.Friends[i+1:]...)
			return s.save(f)
		}
	}
	return fmt.Errorf("not a friend: %s", fp)
}

// SetProtocol sets/clears the communication protocol that applies to this friend only (empty string = clear, fall back to the general protocol).
func (s *FriendStore) SetProtocol(fp, protocol string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	f := s.load()
	for _, fr := range f.Friends {
		if fr.Fingerprint == fp {
			fr.Protocol = protocol
			return s.save(f)
		}
	}
	return fmt.Errorf("不是好友: %s", fp)
}
