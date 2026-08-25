package a2a

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// OutboxItem is one queued delivery: the recipient's card (so the retry knows which
// relays to try) plus the already-sealed envelope. File format (spec §12):
//
//	<baseDir>/a2a/outbox/<19-digit unix nanos>-<12-digit seq>.json
//	{"card": Card, "env": Envelope}
//
// Files replay in lexical (== chronological) order; the envelope is re-sent as-is, so
// a queued message keeps its original id / ts / signature.
type OutboxItem struct {
	Card *Card     `json:"card"`
	Env  *Envelope `json:"env"`
}

// OutboxEntry is one file in the outbox as returned by ReadOutbox. Item is nil and Err
// non-nil for a file that cannot be parsed (or lacks card/env); the caller decides
// whether to RemoveOutbox it.
type OutboxEntry struct {
	Name string      // file name, e.g. "0001756000000000000-000000000001.json"
	Item *OutboxItem // nil when Err != nil
	Err  error
}

// OutboxDir returns the outbox directory under baseDir (<baseDir>/a2a/outbox).
func OutboxDir(baseDir string) string { return filepath.Join(baseDir, "a2a", "outbox") }

// WriteOutbox queues item into dir (created on demand) under a fresh unique, time-ordered
// name and returns that name. dir is the outbox directory itself (see OutboxDir).
func WriteOutbox(dir string, item *OutboxItem) (string, error) {
	if item == nil || item.Card == nil || item.Env == nil {
		return "", fmt.Errorf("outbox item needs both card and env")
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	raw, err := json.Marshal(item)
	if err != nil {
		return "", err
	}
	name := uniqueName() + ".json"
	if err := os.WriteFile(filepath.Join(dir, name), raw, 0o644); err != nil {
		return "", err
	}
	return name, nil
}

// ReadOutbox lists dir in replay order (lexical file-name order). A missing directory
// yields an empty, non-nil slice. Non-.json files and subdirectories are ignored;
// unreadable or malformed files come back with Err set so callers can drop them.
func ReadOutbox(dir string) ([]OutboxEntry, error) {
	out := []OutboxEntry{}
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return out, nil
		}
		return out, err
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		names = append(names, e.Name())
	}
	sort.Strings(names)
	for _, name := range names {
		raw, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			out = append(out, OutboxEntry{Name: name, Err: err})
			continue
		}
		var it OutboxItem
		if err := json.Unmarshal(raw, &it); err != nil {
			out = append(out, OutboxEntry{Name: name, Err: fmt.Errorf("malformed outbox file: %w", err)})
			continue
		}
		if it.Card == nil || it.Env == nil {
			out = append(out, OutboxEntry{Name: name, Err: fmt.Errorf("outbox file lacks card or env")})
			continue
		}
		out = append(out, OutboxEntry{Name: name, Item: &it})
	}
	return out, nil
}

// RemoveOutbox deletes one queued file by name (as returned by WriteOutbox / ReadOutbox).
// Names containing path separators or ".." are rejected; a missing file is not an error.
func RemoveOutbox(dir, name string) error {
	if name == "" || strings.ContainsAny(name, `/\`) || strings.Contains(name, "..") {
		return fmt.Errorf("invalid outbox file name")
	}
	err := os.Remove(filepath.Join(dir, name))
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}
