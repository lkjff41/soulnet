package a2a

import "fmt"

// SettleSigningBytes returns the canonical bytes of the settlement signature, identical on the relay and client sides.
// Format: settle-v1\n{fromFP}\n{toFP}\n{budget}\n{missionID}
// Depends on neither network nor time; the same inputs must always produce the same output (idempotent/stable).
func SettleSigningBytes(fromFP, toFP string, budget int64, missionID string) []byte {
	return []byte(fmt.Sprintf("settle-v1\n%s\n%s\n%d\n%s", fromFP, toFP, budget, missionID))
}
