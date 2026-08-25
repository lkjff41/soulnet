// Package wsmux is the minimal multiplexing frame on the relay↔daemon data-plane WebSocket.
// One daemon↔relay WS carries multiple browser terminal streams, one sid per stream.
//
// Frame format (binary): [1B type][4B sid big-endian][payload]
// type=Open  payload=local path (e.g. /api/agent/term?id=...)
// type=Data  payload=[1B ws-opcode][raw data]   ← keeps the text/binary distinction (resize is text)
// type=Close payload empty
package wsmux

import "encoding/binary"

const (
	Open  byte = 1
	Data  byte = 2
	Close byte = 3
)

func Encode(typ byte, sid uint32, payload []byte) []byte {
	b := make([]byte, 5+len(payload))
	b[0] = typ
	binary.BigEndian.PutUint32(b[1:5], sid)
	copy(b[5:], payload)
	return b
}

func Decode(b []byte) (typ byte, sid uint32, payload []byte, ok bool) {
	if len(b) < 5 {
		return 0, 0, nil, false
	}
	return b[0], binary.BigEndian.Uint32(b[1:5]), b[5:], true
}
