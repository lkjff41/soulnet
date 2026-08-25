// Package ws is a minimal in-tree WebSocket implementation (RFC 6455), server + client sides,
// with no external modules. Just enough for terminal mirroring: text/binary frames, fragment reassembly, ping/pong, close, masking.
package ws

import (
	"bufio"
	"context"
	"crypto/rand"
	"crypto/sha1"
	"crypto/tls"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const guid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

// Opcodes
const (
	OpText   = 0x1
	OpBinary = 0x2
	opClose  = 0x8
	opPing   = 0x9
	opPong   = 0xA
	opCont   = 0x0
)

// Conn is one WebSocket connection.
type Conn struct {
	rwc         net.Conn
	br          *bufio.Reader
	isClient    bool // client-side frames must be masked
	wmu         sync.Mutex
	closed      bool
	readTimeout time.Duration // >0 sets a read deadline before each frame read, to detect half-open / zombie connections
}

// SetReadTimeout enables the read timeout: before each frame read the underlying connection's read deadline is set to now+d.
// Healthy connections keep renewing it through ping/pong (a frame arrives every few tens of seconds); a half-open/zombie
// connection with no frame within d → read error → the upper layer treats it as disconnected and cleans up. d<=0 disables
// the mechanism (default off).
func (c *Conn) SetReadTimeout(d time.Duration) { c.readTimeout = d }

// IsWebSocket reports whether an HTTP request is a WS upgrade request.
func IsWebSocket(r *http.Request) bool {
	return strings.Contains(strings.ToLower(r.Header.Get("Connection")), "upgrade") &&
		strings.EqualFold(r.Header.Get("Upgrade"), "websocket")
}

// Accept upgrades an HTTP request to WebSocket (server side).
func Accept(w http.ResponseWriter, r *http.Request) (*Conn, error) {
	if !IsWebSocket(r) {
		return nil, errors.New("非 websocket 升级请求")
	}
	key := r.Header.Get("Sec-WebSocket-Key")
	if key == "" {
		return nil, errors.New("缺 Sec-WebSocket-Key")
	}
	hj, ok := w.(http.Hijacker)
	if !ok {
		return nil, errors.New("ResponseWriter 不支持 Hijack")
	}
	conn, brw, err := hj.Hijack()
	if err != nil {
		return nil, err
	}
	resp := "HTTP/1.1 101 Switching Protocols\r\n" +
		"Upgrade: websocket\r\nConnection: Upgrade\r\n" +
		"Sec-WebSocket-Accept: " + acceptKey(key) + "\r\n\r\n"
	if _, err := conn.Write([]byte(resp)); err != nil {
		conn.Close()
		return nil, err
	}
	return &Conn{rwc: conn, br: brw.Reader, isClient: false}, nil
}

// Dial connects to a ws:// or wss:// address (client side).
func Dial(ctx context.Context, rawURL string, hdr http.Header) (*Conn, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return nil, err
	}
	host := u.Host
	var conn net.Conn
	d := &net.Dialer{Timeout: 15 * time.Second}
	switch u.Scheme {
	case "wss":
		if !strings.Contains(host, ":") {
			host += ":443"
		}
		conn, err = tls.DialWithDialer(d, "tcp", host, &tls.Config{ServerName: u.Hostname()})
	case "ws":
		if !strings.Contains(host, ":") {
			host += ":80"
		}
		conn, err = d.DialContext(ctx, "tcp", host)
	default:
		return nil, fmt.Errorf("不支持的 scheme: %s", u.Scheme)
	}
	if err != nil {
		return nil, err
	}
	keyRaw := make([]byte, 16)
	rand.Read(keyRaw)
	key := base64.StdEncoding.EncodeToString(keyRaw)
	path := u.RequestURI()
	var b strings.Builder
	fmt.Fprintf(&b, "GET %s HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n", path, u.Host)
	fmt.Fprintf(&b, "Sec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n", key)
	for k, vs := range hdr {
		for _, v := range vs {
			fmt.Fprintf(&b, "%s: %s\r\n", k, v)
		}
	}
	b.WriteString("\r\n")
	if _, err := conn.Write([]byte(b.String())); err != nil {
		conn.Close()
		return nil, err
	}
	br := bufio.NewReader(conn)
	resp, err := http.ReadResponse(br, &http.Request{Method: "GET"})
	if err != nil {
		conn.Close()
		return nil, err
	}
	if resp.StatusCode != 101 {
		conn.Close()
		return nil, fmt.Errorf("握手失败: %s", resp.Status)
	}
	if resp.Header.Get("Sec-WebSocket-Accept") != acceptKey(key) {
		conn.Close()
		return nil, errors.New("握手 Accept 校验失败")
	}
	return &Conn{rwc: conn, br: br, isClient: true}, nil
}

func acceptKey(key string) string {
	h := sha1.Sum([]byte(key + guid))
	return base64.StdEncoding.EncodeToString(h[:])
}

// ReadMessage reads one complete message (reassembles fragments, answers pings automatically, close returns io.EOF).
func (c *Conn) ReadMessage() (opcode int, payload []byte, err error) {
	var msg []byte
	msgOp := 0
	for {
		fin, op, data, err := c.readFrame()
		if err != nil {
			return 0, nil, err
		}
		switch op {
		case opPing:
			c.writeFrame(opPong, data)
			continue
		case opPong:
			continue
		case opClose:
			c.WriteClose()
			return 0, nil, io.EOF
		case opCont:
			msg = append(msg, data...)
		default: // text / binary
			msgOp = op
			msg = data
		}
		if fin {
			return msgOp, msg, nil
		}
	}
}

func (c *Conn) readFrame() (fin bool, opcode int, payload []byte, err error) {
	if c.readTimeout > 0 {
		_ = c.rwc.SetReadDeadline(time.Now().Add(c.readTimeout))
	}
	hdr := make([]byte, 2)
	if _, err = io.ReadFull(c.br, hdr); err != nil {
		return
	}
	fin = hdr[0]&0x80 != 0
	opcode = int(hdr[0] & 0x0f)
	masked := hdr[1]&0x80 != 0
	n := uint64(hdr[1] & 0x7f)
	switch n {
	case 126:
		ext := make([]byte, 2)
		if _, err = io.ReadFull(c.br, ext); err != nil {
			return
		}
		n = uint64(binary.BigEndian.Uint16(ext))
	case 127:
		ext := make([]byte, 8)
		if _, err = io.ReadFull(c.br, ext); err != nil {
			return
		}
		n = binary.BigEndian.Uint64(ext)
	}
	if n > 64<<20 { // per-frame cap 64MB, against abuse
		return false, 0, nil, errors.New("帧过大")
	}
	var maskKey [4]byte
	if masked {
		if _, err = io.ReadFull(c.br, maskKey[:]); err != nil {
			return
		}
	}
	payload = make([]byte, n)
	if _, err = io.ReadFull(c.br, payload); err != nil {
		return
	}
	if masked {
		for i := range payload {
			payload[i] ^= maskKey[i&3]
		}
	}
	return fin, opcode, payload, nil
}

// Ping sends a WebSocket ping frame (keep-alive). Per RFC 6455 the peer answers with a pong automatically,
// so data flows in both directions and NAT/firewalls do not silently cut the connection as idle.
func (c *Conn) Ping() error { return c.writeFrame(opPing, nil) }

// WriteText / WriteBinary / WriteMessage send one message.
func (c *Conn) WriteText(s string) error            { return c.writeFrame(OpText, []byte(s)) }
func (c *Conn) WriteBinary(b []byte) error          { return c.writeFrame(OpBinary, b) }
func (c *Conn) WriteMessage(op int, b []byte) error { return c.writeFrame(op, b) }

func (c *Conn) writeFrame(opcode int, payload []byte) error {
	c.wmu.Lock()
	defer c.wmu.Unlock()
	if c.closed {
		return errors.New("连接已关闭")
	}
	var hdr []byte
	b0 := byte(0x80 | opcode)
	n := len(payload)
	switch {
	case n < 126:
		hdr = []byte{b0, byte(n)}
	case n < 65536:
		hdr = []byte{b0, 126, byte(n >> 8), byte(n)}
	default:
		hdr = make([]byte, 10)
		hdr[0] = b0
		hdr[1] = 127
		binary.BigEndian.PutUint64(hdr[2:], uint64(n))
	}
	if c.isClient {
		hdr[1] |= 0x80
		var mk [4]byte
		rand.Read(mk[:])
		hdr = append(hdr, mk[:]...)
		masked := make([]byte, n)
		for i := 0; i < n; i++ {
			masked[i] = payload[i] ^ mk[i&3]
		}
		if _, err := c.rwc.Write(hdr); err != nil {
			return err
		}
		_, err := c.rwc.Write(masked)
		return err
	}
	if _, err := c.rwc.Write(hdr); err != nil {
		return err
	}
	_, err := c.rwc.Write(payload)
	return err
}

// WriteClose sends a close frame (idempotent).
func (c *Conn) WriteClose() {
	c.wmu.Lock()
	if c.closed {
		c.wmu.Unlock()
		return
	}
	c.closed = true
	c.wmu.Unlock()
	c.writeRaw([]byte{0x88, 0x00}) // server close, no payload (also usable by the client: an unmasked close is widely accepted, keeps things simple)
}

func (c *Conn) writeRaw(b []byte) { c.rwc.Write(b) }

// Close closes the underlying connection.
func (c *Conn) Close() error {
	c.WriteClose()
	return c.rwc.Close()
}
