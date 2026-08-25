package a2a

import (
	"bytes"
	"testing"
)

func TestSettleSigningBytesStability(t *testing.T) {
	fromFP := "abc123"
	toFP := "def456"
	var budget int64 = 500
	missionID := "mission-001"

	want := []byte("settle-v1\nabc123\ndef456\n500\nmission-001")

	got1 := SettleSigningBytes(fromFP, toFP, budget, missionID)
	got2 := SettleSigningBytes(fromFP, toFP, budget, missionID)

	if !bytes.Equal(got1, want) {
		t.Errorf("SettleSigningBytes output mismatch:\n  got:  %q\n  want: %q", got1, want)
	}
	if !bytes.Equal(got1, got2) {
		t.Error("SettleSigningBytes is not stable: two calls with same input gave different output")
	}
}

func TestSettleSigningBytesDifferentInputs(t *testing.T) {
	// Different budget → different bytes
	b1 := SettleSigningBytes("fp1", "fp2", 100, "m1")
	b2 := SettleSigningBytes("fp1", "fp2", 200, "m1")
	if bytes.Equal(b1, b2) {
		t.Error("different budget should produce different signing bytes")
	}

	// Different missionID → different bytes
	b3 := SettleSigningBytes("fp1", "fp2", 100, "m1")
	b4 := SettleSigningBytes("fp1", "fp2", 100, "m2")
	if bytes.Equal(b3, b4) {
		t.Error("different missionID should produce different signing bytes")
	}
}
