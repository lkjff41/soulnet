package a2a

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// Mission status constants (state machine: draft→open/(directed)assigned→bidding→assigned→in_progress→delivered→accepted→settled; cancelled from any point).
const (
	MissionStatusDraft      = "draft"
	MissionStatusOpen       = "open"
	MissionStatusBidding    = "bidding"
	MissionStatusAssigned   = "assigned"
	MissionStatusInProgress = "in_progress"
	MissionStatusDelivered  = "delivered"
	MissionStatusAccepted   = "accepted"
	MissionStatusSettled    = "settled"
	MissionStatusCancelled  = "cancelled"
	MissionStatusRejected   = "rejected" // the assignee declined
	MissionStatusRework     = "rework"   // the delivery was sent back, needs rework
)

// Mission is a mission contract (module B).
//
//	~/.soulmirror/a2a/missions/<id>.json
type Mission struct {
	ID          string    `json:"id"`
	From        string    `json:"from"`         // initiator fingerprint
	To          string    `json:"to,omitempty"` // assignee fingerprint; empty = open mission
	Title       string    `json:"title,omitempty"`
	Goal        string    `json:"goal"`                  // mission goal (required)
	Deliverable string    `json:"deliverable,omitempty"` // form of the deliverable
	Acceptance  []string  `json:"acceptance"`            // acceptance criteria (required, >=1)
	Budget      int       `json:"budget"`                // chuangli amount; 0 = negotiate (stays 0 until agreed, settlement is blocked)
	Deadline    string    `json:"deadline,omitempty"`    // RFC3339 or empty
	Status      string    `json:"status"`
	TS          time.Time `json:"ts"`
	// History records the status transitions (status + time per step); Save appends automatically when
	// status changes, so the detail page's progress timeline can show when each step happened.
	History []MissionEvent `json:"history,omitempty"`
	// ——— Bidding (BACKLOG-E3 basic version) ———
	// Bidding is a negotiation channel independent of the main state machine: both sides propose/counter the
	// Budget back and forth, and only when one side accepts is the agreed amount written into Budget and settlement
	// unblocked. Until then Budget stays 0/its original value.
	// ProposedBudget is [the latest proposal currently on the table awaiting the peer's answer]; ProposedBy is the proposer's fingerprint.
	// Both are cleared after acceptance (ProposedBudget=0, ProposedBy="").
	ProposedBudget int    `json:"proposed_budget,omitempty"`
	ProposedBy     string `json:"proposed_by,omitempty"`
	// BudgetAgreed marks that Budget was formally agreed through bidding (as opposed to "priced when the mission was posted, no bidding needed").
	BudgetAgreed bool `json:"budget_agreed,omitempty"`
}

// MissionEvent is one status change (one cell of the progress timeline).
type MissionEvent struct {
	Status string    `json:"status"`
	TS     time.Time `json:"ts"`
}

// Validate mechanically validates the mission contract.
func (m *Mission) Validate() error {
	if strings.TrimSpace(m.Goal) == "" {
		return fmt.Errorf("任务目标 goal 不能为空")
	}
	var valid []string
	for _, a := range m.Acceptance {
		if strings.TrimSpace(a) != "" {
			valid = append(valid, a)
		}
	}
	if len(valid) == 0 {
		return fmt.Errorf("验收标准 acceptance 至少需要一条")
	}
	m.Acceptance = valid
	return nil
}

// missionOrder is the progression index of main-line statuses (the branches rejected/rework/cancelled are off the main line).
var missionOrder = map[string]int{
	MissionStatusAssigned:   1,
	MissionStatusInProgress: 2,
	MissionStatusDelivered:  3,
	MissionStatusAccepted:   4,
	MissionStatusSettled:    5,
}

// MissionAtOrPast reports whether status [is at or already past] the main-line target status (only main-line statuses are ordered).
// Used for idempotency checks on deliver/accept/settle: e.g. with target=delivered, delivered/accepted/settled all count as "reached/past".
// Returns false if either side is off the main line (rejected/rework/cancelled/draft/open…), leaving it to the normal status check.
func MissionAtOrPast(status, target string) bool {
	so, ok1 := missionOrder[status]
	to, ok2 := missionOrder[target]
	if !ok1 || !ok2 {
		return false
	}
	return so >= to
}

// MissionTransitionOK reports whether moving a mission's status from from to to is legal.
//
// The main line (assigned→in_progress→delivered→accepted→settled) allows "forward" moves, including jumps:
// status messages may arrive out of order / get lost (the peer accepts+delivers quickly, so delivered may arrive
// before in_progress), and delivered itself implies in_progress already happened — so forward moves such as
// assigned→delivered must pass; only [backward] moves (delivered→in_progress) and [overwriting a terminal state] are blocked.
// Branches: any non-terminal state may be cancelled; only assigned may be rejected; only delivered may go to rework; rework can only be delivered again.
// from==to (idempotent repeat) returns false.
func MissionTransitionOK(from, to string) bool {
	if from == to {
		return false
	}
	switch from {
	case MissionStatusSettled, MissionStatusRejected, MissionStatusCancelled:
		return false // terminal states cannot transition out
	}
	switch to {
	case MissionStatusCancelled:
		return true // any non-terminal state may be cancelled
	case MissionStatusRejected:
		return from == MissionStatusAssigned // only assigned may be declined
	case MissionStatusRework:
		return from == MissionStatusDelivered // only a delivery may be sent back
	}
	if from == MissionStatusRework {
		return to == MissionStatusDelivered // after rework, only re-delivery
	}
	// Main line: forward only (increasing index, jumps allowed to tolerate reordering), no backward moves.
	of, ok1 := missionOrder[from]
	ot, ok2 := missionOrder[to]
	return ok1 && ok2 && ot > of
}

// MissionStore manages reading/writing a2a/missions/<id>.json.
type MissionStore struct {
	dir string
	mu  sync.Mutex // guards the atomicity of single-file reads/writes

	// keyMu provides a "per-missionID mutex": it serializes the whole Get→change status→Save read-modify-write
	// of one mission, eliminating the race — otherwise two proposals for the same mission (handled concurrently by
	// collectOutbox and the heartbeat loop) could both Get the old status, both pass the status check and each Save,
	// causing [a real double send] (double delivery / double settlement).
	keyMuMu sync.Mutex
	keyMu   map[string]*sync.Mutex
}

// NewMissionStore creates the mission store.
func NewMissionStore(baseDir string) *MissionStore {
	return &MissionStore{
		dir:   filepath.Join(baseDir, "a2a", "missions"),
		keyMu: make(map[string]*sync.Mutex),
	}
}

// LockFor returns (or creates) the mutex dedicated to a missionID. The caller Locks/Unlocks it itself;
// suited to long operations held under the lock (e.g. the relay HTTP call during settle);
// for a simple read-modify-write, WithLock is enough.
func (s *MissionStore) LockFor(id string) *sync.Mutex {
	s.keyMuMu.Lock()
	defer s.keyMuMu.Unlock()
	if s.keyMu == nil {
		s.keyMu = make(map[string]*sync.Mutex)
	}
	m, ok := s.keyMu[id]
	if !ok {
		m = &sync.Mutex{}
		s.keyMu[id] = m
	}
	return m
}

// WithLock runs fn under the mutex dedicated to that missionID, serializing the whole "read mission→check status→save mission" sequence.
// Note: this lock and the s.mu inside Get/Save are two different locks (s.mu only guards single-file read/write atomicity,
// WithLock guards the atomicity of the compound operation across Get/Save), so there is no self-deadlock.
func (s *MissionStore) WithLock(id string, fn func() error) error {
	mu := s.LockFor(id)
	mu.Lock()
	defer mu.Unlock()
	return fn()
}

func (s *MissionStore) path(id string) (string, error) {
	// Prevent path traversal: id must not contain / \ ..
	if id == "" || strings.ContainsAny(id, `/\`) || strings.Contains(id, "..") {
		return "", fmt.Errorf("非法任务 id: %q", id)
	}
	return filepath.Join(s.dir, id+".json"), nil
}

// Save stores (creates or overwrites) one mission.
func (s *MissionStore) Save(m *Mission) error {
	p, err := s.path(m.ID)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	// Maintain the status-transition history: append an entry (with time) when status differs from the last cell, for the progress timeline.
	if n := len(m.History); n == 0 || m.History[n-1].Status != m.Status {
		m.History = append(m.History, MissionEvent{Status: m.Status, TS: time.Now()})
	}
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(p, raw, 0o644)
}

// Get reads a single mission; a missing id returns (nil,nil).
func (s *MissionStore) Get(id string) (*Mission, error) {
	p, err := s.path(id)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	raw, err := os.ReadFile(p)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var m Mission
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, fmt.Errorf("解析任务 %s: %w", id, err)
	}
	return &m, nil
}

// List returns all missions, newest first by timestamp.
func (s *MissionStore) List() ([]*Mission, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entries, err := os.ReadDir(s.dir)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var out []*Mission
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(s.dir, e.Name()))
		if err != nil {
			continue
		}
		var m Mission
		if json.Unmarshal(raw, &m) == nil {
			out = append(out, &m)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].TS.After(out[j].TS) })
	return out, nil
}
