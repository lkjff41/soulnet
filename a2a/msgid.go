package a2a

import (
	"fmt"
	"sync/atomic"
	"time"
)

// uniqSeq numbers names generated within the same nanosecond tick (monotonic per process).
//
// Why: the Windows wall clock ticks at ~0.5ms, so consecutive time.Now().UnixNano()
// calls collide constantly. A pure-timestamp name therefore collides under bursts, and a
// collision here is *silent data loss*: receivers dedupe on msg.ID (ConvStore.Seen), so
// the second message with a duplicate ID is dropped as a replay; outbox files with the
// same name overwrite each other.
//
// Fixed-width zero padding is required: the outbox replays files in os.ReadDir (lexical)
// order, and "10" < "9" lexically — padding makes lexical order == numeric order. The
// nanosecond part stays 19 digits until the year 2262, so it sorts the same way. The
// timestamp remains the primary key so names stay time-ordered across process restarts
// (which reset the counter).
var uniqSeq atomic.Uint64

// NewMessageID returns a message ID in the canonical form shared by every SoulMirror
// implementation: "<first 6 chars of fp>-<19-digit unix nanos>-<12-digit per-process
// sequence>". It is unique within a process even under bursts (see uniqSeq) and sorts
// chronologically. An fp shorter than 6 characters is used whole.
func NewMessageID(fp string) string {
	if len(fp) > 6 {
		fp = fp[:6]
	}
	return fmt.Sprintf("%s-%019d-%012d", fp, time.Now().UnixNano(), uniqSeq.Add(1))
}

// uniqueName returns "<19-digit unix nanos>-<12-digit sequence>" for file names that must
// be unique and lexically time-ordered (outbox); see uniqSeq.
func uniqueName() string {
	return fmt.Sprintf("%019d-%012d", time.Now().UnixNano(), uniqSeq.Add(1))
}
