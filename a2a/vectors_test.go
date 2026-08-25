package a2a

// 协议测试向量（spec/vectors/*.json）的生成器 + 回归校验。
//
// 这些向量是 A2A Wire v2.0 规范（spec/a2a-wire-spec.md）的机器可读附录：
// 固定种子派生的密钥 → 指纹 / 名片签名与 URI / 请求签名 / 结算签名 / 目录下架签名 /
// 能力名片签名 / 会话 ID / 一封固定密文的信封。第三方实现用同样的输入跑一遍，
// 逐字节对得上即与 Go 参考实现兼容。
//
// 日常 `go test` 只读文件比对；要重新生成（只有协议本身刻意变更时才允许）：
//
//	A2A_WRITE_VECTORS=1 go test ./a2a/ -run TestVectors
//
// 重新生成后 spec/vectors/*.json 的 diff 必须在同一个 PR 里和规范文字一起评审。

import (
	"crypto/ecdh"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

const vectorsDir = "../spec/vectors"

// 固定种子：A 是发件方 / 付款方 / 名片主人，B 是收件方。
// 任何语言都能由这 32 字节 ed25519 seed 与 32 字节 X25519 私钥标量重建同一对身份。
const (
	vecASeedHex  = "0101010101010101010101010101010101010101010101010101010101010101"
	vecAXPrivHex = "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1"
	vecBSeedHex  = "0202020202020202020202020202020202020202020202020202020202020202"
	vecBXPrivHex = "b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2"
)

// 固定时间戳：信封 / 消息 / 能力名片都用它，签名才可复现。
var vecTS = time.Date(2026, 8, 22, 1, 2, 3, 123456789, time.UTC)

type vecIdentity struct {
	EdSeedHex   string `json:"ed_seed_hex"`
	XPrivHex    string `json:"x_priv_hex"`
	EdPub       string `json:"ed_pub"`
	EdPriv      string `json:"ed_priv"`
	XPub        string `json:"x_pub"`
	XPriv       string `json:"x_priv"`
	Fingerprint string `json:"fingerprint"`
}

type vecKeys struct {
	edPub  ed25519.PublicKey
	edPriv ed25519.PrivateKey
	x      *ecdh.PrivateKey
}

func vecKeysFrom(t *testing.T, seedHex, xHex string) vecKeys {
	t.Helper()
	seed, err := hex.DecodeString(seedHex)
	if err != nil || len(seed) != ed25519.SeedSize {
		t.Fatalf("bad seed %q", seedHex)
	}
	xraw, err := hex.DecodeString(xHex)
	if err != nil || len(xraw) != 32 {
		t.Fatalf("bad x priv %q", xHex)
	}
	priv := ed25519.NewKeyFromSeed(seed)
	x, err := ecdh.X25519().NewPrivateKey(xraw)
	if err != nil {
		t.Fatal(err)
	}
	return vecKeys{edPub: priv.Public().(ed25519.PublicKey), edPriv: priv, x: x}
}

func (k vecKeys) identity(name string, proxies []string) *Identity {
	return &Identity{
		Name:    name,
		EdPub:   EncodeKey(k.edPub),
		EdPriv:  EncodeKey(k.edPriv),
		XPub:    EncodeKey(k.x.PublicKey().Bytes()),
		XPriv:   EncodeKey(k.x.Bytes()),
		Proxies: proxies,
	}
}

func (k vecKeys) toVec(seedHex, xHex string) vecIdentity {
	return vecIdentity{
		EdSeedHex:   seedHex,
		XPrivHex:    xHex,
		EdPub:       EncodeKey(k.edPub),
		EdPriv:      EncodeKey(k.edPriv),
		XPub:        EncodeKey(k.x.PublicKey().Bytes()),
		XPriv:       EncodeKey(k.x.Bytes()),
		Fingerprint: Fingerprint(k.edPub),
	}
}

func writeVectors() bool { return os.Getenv("A2A_WRITE_VECTORS") == "1" }

// checkVector 把 got 与 spec/vectors/<name>.json 比对；A2A_WRITE_VECTORS=1 时改为写入。
// 比对按「JSON 规范化后的值」进行（两边都经 json.Marshal→Unmarshal 成 any），
// 这样字段顺序/缩进无关，只认内容。
func checkVector(t *testing.T, name string, got any) {
	t.Helper()
	p := filepath.Join(vectorsDir, name+".json")
	if writeVectors() {
		raw, err := json.MarshalIndent(got, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err := os.MkdirAll(vectorsDir, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, append(raw, '\n'), 0o644); err != nil {
			t.Fatal(err)
		}
		t.Logf("wrote %s", p)
		return
	}
	raw, err := os.ReadFile(p)
	if err != nil {
		t.Fatalf("读向量 %s 失败: %v（若是刻意改协议，用 A2A_WRITE_VECTORS=1 重新生成）", p, err)
	}
	var want, gotNorm any
	if err := json.Unmarshal(raw, &want); err != nil {
		t.Fatalf("向量 %s 非法 JSON: %v", p, err)
	}
	gb, _ := json.Marshal(got)
	_ = json.Unmarshal(gb, &gotNorm)
	if !reflect.DeepEqual(want, gotNorm) {
		t.Fatalf("向量 %s 与当前实现不符（协议被改动？）\n want: %s\n  got: %s", name, raw, gb)
	}
}

// loadVector 读一份向量到 v（只读模式下用于拿固定的密文/签名再做反向校验）。
func loadVector(t *testing.T, name string, v any) bool {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(vectorsDir, name+".json"))
	if err != nil {
		return false
	}
	if err := json.Unmarshal(raw, v); err != nil {
		t.Fatalf("向量 %s 非法 JSON: %v", name, err)
	}
	return true
}

var vecProxies = []string{"https://relay.example.org", "https://relay2.example.org"}

// ——— 1. 身份与指纹 ———

func TestVectorsIdentity(t *testing.T) {
	a := vecKeysFrom(t, vecASeedHex, vecAXPrivHex)
	b := vecKeysFrom(t, vecBSeedHex, vecBXPrivHex)
	out := map[string]vecIdentity{
		"a": a.toVec(vecASeedHex, vecAXPrivHex),
		"b": b.toVec(vecBSeedHex, vecBXPrivHex),
	}
	// 指纹固定 22 字符、URL 安全。
	for k, v := range out {
		if len(v.Fingerprint) != 22 {
			t.Errorf("%s 指纹长度 %d != 22", k, len(v.Fingerprint))
		}
		if _, err := base64.RawURLEncoding.DecodeString(v.Fingerprint); err != nil {
			t.Errorf("%s 指纹非 base64url: %v", k, err)
		}
	}
	// Identity 结构体的 Fingerprint() 与裸函数一致。
	if got := a.identity("A", vecProxies).Fingerprint(); got != out["a"].Fingerprint {
		t.Errorf("Identity.Fingerprint 不一致: %s", got)
	}
	checkVector(t, "identity", out)
}

// ——— 2. 名片 ———

type vecCard struct {
	Card         *Card  `json:"card"`
	SigningBytes string `json:"signing_bytes"`
	URI          string `json:"uri"`
	Fingerprint  string `json:"fingerprint"`
}

func vecCardA(t *testing.T) (vecKeys, *Card) {
	a := vecKeysFrom(t, vecASeedHex, vecAXPrivHex)
	c := &Card{V: 2, EdPub: EncodeKey(a.edPub), XPub: EncodeKey(a.x.PublicKey().Bytes()),
		Proxies: vecProxies, Name: "灵镜 A", DescURL: "https://a.example.org/profile.json"}
	c.Sign(a.edPriv)
	return a, c
}

func TestVectorsCard(t *testing.T) {
	_, c := vecCardA(t)
	fp, err := c.Fingerprint()
	if err != nil {
		t.Fatal(err)
	}
	if err := c.Verify(); err != nil {
		t.Fatal(err)
	}
	uri := c.EncodeURI()
	parsed, err := ParseCard(uri)
	if err != nil {
		t.Fatalf("ParseCard: %v", err)
	}
	if !reflect.DeepEqual(parsed, c) {
		t.Errorf("名片 URI 往返不一致:\n%+v\n%+v", parsed, c)
	}
	checkVector(t, "card", vecCard{Card: c, SigningBytes: string(c.signingBytes()), URI: uri, Fingerprint: fp})
}

// ——— 3. 请求签名 ———

type vecReq struct {
	Pub          string `json:"pub"`
	Method       string `json:"method"`
	Path         string `json:"path"`
	TS           string `json:"ts"`
	SigningBytes string `json:"signing_bytes"`
	Sig          string `json:"sig"`
	Fingerprint  string `json:"fingerprint"`
}

func TestVectorsRequestSignature(t *testing.T) {
	a := vecKeysFrom(t, vecASeedHex, vecAXPrivHex)
	ts := vecTS.Format(time.RFC3339) // 头里是秒级 RFC3339
	var out []vecReq
	for _, mp := range [][2]string{{"GET", "/mail"}, {"POST", "/mail/ack"}} {
		sig := SignReq(a.edPriv, mp[0], mp[1], ts)
		// 固定 ts 超出 5 分钟窗口，VerifyReq 会拒；这里直接用裸 ed25519 验签证明签名串正确。
		raw, _ := DecodeKey(sig)
		if !ed25519.Verify(a.edPub, reqSigningBytes(mp[0], mp[1], ts), raw) {
			t.Fatalf("%s %s 签名自检失败", mp[0], mp[1])
		}
		out = append(out, vecReq{Pub: EncodeKey(a.edPub), Method: mp[0], Path: mp[1], TS: ts,
			SigningBytes: string(reqSigningBytes(mp[0], mp[1], ts)), Sig: sig, Fingerprint: Fingerprint(a.edPub)})
	}
	// 时间窗行为：新鲜 ts 通过、过期 ts 拒绝。
	fresh := time.Now().UTC().Format(time.RFC3339)
	if _, err := VerifyReq(EncodeKey(a.edPub), "GET", "/mail", fresh, SignReq(a.edPriv, "GET", "/mail", fresh)); err != nil {
		t.Errorf("新鲜时间戳应通过: %v", err)
	}
	if _, err := VerifyReq(EncodeKey(a.edPub), "GET", "/mail", ts, out[0].Sig); err == nil {
		t.Error("过期时间戳应被拒")
	}
	checkVector(t, "request", out)
}

// ——— 4. 结算签名 ———

type vecSettle struct {
	FromFP       string `json:"from_fp"`
	ToFP         string `json:"to_fp"`
	Budget       int64  `json:"budget"`
	MissionID    string `json:"mission_id"`
	SigningBytes string `json:"signing_bytes"`
	FromPub      string `json:"from_pub"`
	Signature    string `json:"signature"`
}

func TestVectorsSettle(t *testing.T) {
	a := vecKeysFrom(t, vecASeedHex, vecAXPrivHex)
	b := vecKeysFrom(t, vecBSeedHex, vecBXPrivHex)
	v := vecSettle{FromFP: Fingerprint(a.edPub), ToFP: Fingerprint(b.edPub), Budget: 150, MissionID: "m-20260822-0001"}
	sb := SettleSigningBytes(v.FromFP, v.ToFP, v.Budget, v.MissionID)
	v.SigningBytes = string(sb)
	v.FromPub = EncodeKey(a.edPub)
	v.Signature = EncodeKey(ed25519.Sign(a.edPriv, sb))
	checkVector(t, "settle", v)
}

// ——— 5. 会话 ID ———

func TestVectorsConvID(t *testing.T) {
	a := vecKeysFrom(t, vecASeedHex, vecAXPrivHex)
	b := vecKeysFrom(t, vecBSeedHex, vecBXPrivHex)
	fa, fb := Fingerprint(a.edPub), Fingerprint(b.edPub)
	if ConvID(fa, fb) != ConvID(fb, fa) {
		t.Fatal("ConvID 应与参数顺序无关")
	}
	checkVector(t, "convid", []map[string]string{
		{"a": fa, "b": fb, "conv_id": ConvID(fa, fb)},
		{"a": "zzz", "b": "aaa", "conv_id": ConvID("zzz", "aaa")},
		{"a": "same", "b": "same", "conv_id": ConvID("same", "same")},
	})
}

// ——— 6. 信封（固定密文）———

type vecEnvelope struct {
	Message              *Message  `json:"message"`
	PlaintextJSON        string    `json:"plaintext_json"`
	Envelope             *Envelope `json:"envelope"`
	EnvelopeSigningBytes string    `json:"envelope_signing_bytes"`
	KeyDerivationInfo    string    `json:"key_derivation_info"`
}

func vecMessage(a, b vecKeys) *Message {
	return &Message{
		ID: "msg-vector-0001", From: Fingerprint(a.edPub), To: Fingerprint(b.edPub),
		ConvID: ConvID(Fingerprint(a.edPub), Fingerprint(b.edPub)), TS: vecTS,
		Type: TypeText, Body: "你主人周四有空吗？<test> & done",
	}
}

func TestVectorsEnvelope(t *testing.T) {
	a := vecKeysFrom(t, vecASeedHex, vecAXPrivHex)
	b := vecKeysFrom(t, vecBSeedHex, vecBXPrivHex)
	msg := vecMessage(a, b)
	plain, _ := json.Marshal(msg)

	var cipherB64 string
	var stored vecEnvelope
	if !writeVectors() && loadVector(t, "envelope", &stored) {
		cipherB64 = stored.Envelope.Cipher // 固定密文：nonce 随机，故只能由文件提供
	} else {
		c, err := Seal(a.x, b.x.PublicKey(), msg)
		if err != nil {
			t.Fatal(err)
		}
		cipherB64 = c
	}
	env := &Envelope{V: 2, To: Fingerprint(b.edPub), From: EncodeKey(a.edPub), TS: vecTS, Cipher: cipherB64,
		FromXPub: EncodeKey(a.x.PublicKey().Bytes())}
	env.Sig = EncodeKey(ed25519.Sign(a.edPriv, envelopeSigningBytes(env.To, env.TS, env.Cipher)))

	// 收件方能解出已知明文；第三方解不开。
	got, err := Open(b.x, a.x.PublicKey(), cipherB64)
	if err != nil {
		t.Fatalf("Open 固定密文: %v", err)
	}
	gb, _ := json.Marshal(got)
	if string(gb) != string(plain) {
		t.Fatalf("解出明文不符:\n%s\n%s", gb, plain)
	}
	if err := env.VerifyEnvelope(); err != nil {
		t.Fatalf("固定信封验签: %v", err)
	}
	// 现场 Seal 一次（随机 nonce）也要能被 Open。
	fresh, err := Seal(a.x, b.x.PublicKey(), msg)
	if err != nil {
		t.Fatal(err)
	}
	if got2, err := Open(b.x, a.x.PublicKey(), fresh); err != nil || got2.Body != msg.Body {
		t.Fatalf("现场 Seal→Open 失败: %v", err)
	}
	checkVector(t, "envelope", vecEnvelope{
		Message: msg, PlaintextJSON: string(plain), Envelope: env,
		EnvelopeSigningBytes: string(envelopeSigningBytes(env.To, env.TS, env.Cipher)),
		KeyDerivationInfo:    "key = SHA-256(\"soulmirror-a2a-v2-aead\\n\" || X25519(my_priv, their_pub)); AES-256-GCM, nonce = first 12 bytes of base64-decoded cipher, no AAD",
	})
}

// ——— 7. 目录下架签名 ———

func TestVectorsDirUnpublish(t *testing.T) {
	a := vecKeysFrom(t, vecASeedHex, vecAXPrivHex)
	fp := Fingerprint(a.edPub)
	sb := DirUnpublishSigningBytes(fp)
	checkVector(t, "dir-unpublish", map[string]string{
		"fingerprint":   fp,
		"ed_pub":        EncodeKey(a.edPub),
		"signing_bytes": string(sb),
		"sig":           EncodeKey(ed25519.Sign(a.edPriv, sb)),
	})
}

// ——— 8. 能力名片（Profile）签名 ———

type vecProfile struct {
	Profile      *Profile `json:"profile"`
	EdPub        string   `json:"ed_pub"`
	SigningBytes string   `json:"signing_bytes"`
}

func TestVectorsProfile(t *testing.T) {
	a := vecKeysFrom(t, vecASeedHex, vecAXPrivHex)
	p := &Profile{
		V: 1, Fingerprint: Fingerprint(a.edPub), Tags: []string{"创业", "AI"},
		Summary: "能接 BP 写作 & 市场分析", DistillScore: 42,
		Skills: []Skill{{ID: "bp", Title: "BP 写作", Tags: []string{"融资", "写作"}, Desc: "写商业计划书", Type: "private"},
			{ID: "hidden-one", Title: "不对外", Tags: []string{"x"}, Desc: "should be filtered", Hidden: true}},
		Contexts:  []Context{{Title: "行业人脉", Desc: "<redacted>"}},
		Services:  []Offering{{Name: "咨询", Desc: "1 小时"}},
		Intro:     "A 的分身",
		Accepting: true,
		UpdatedAt: vecTS,
	}
	pub := p.PublicCopy()
	if len(pub.Skills) != 1 {
		t.Fatalf("PublicCopy 应过滤 Hidden skill, got %d", len(pub.Skills))
	}
	pub.Sign(a.edPriv)
	if err := pub.Verify(EncodeKey(a.edPub)); err != nil {
		t.Fatal(err)
	}
	checkVector(t, "profile", vecProfile{Profile: pub, EdPub: EncodeKey(a.edPub), SigningBytes: string(pub.signingBytes())})
}

// ——— 9. 附件分块常量与 sha256 ———

func TestVectorsChunk(t *testing.T) {
	sample := []byte("soulnet artifact sample\n")
	type sz struct {
		Size        int  `json:"size"`
		ShouldChunk bool `json:"should_chunk"`
		ChunkTotal  int  `json:"chunk_total"`
	}
	var sizes []sz
	for _, n := range []int{0, 1, MaxArtifactBytes, MaxArtifactBytes + 1, ChunkRawBytes, ChunkRawBytes + 1, 3 * ChunkRawBytes, 3*ChunkRawBytes + 1} {
		sizes = append(sizes, sz{Size: n, ShouldChunk: ShouldChunk(n), ChunkTotal: ChunkTotal(n)})
	}
	checkVector(t, "chunk", map[string]any{
		"max_artifact_bytes": MaxArtifactBytes,
		"chunk_raw_bytes":    ChunkRawBytes,
		"sizes":              sizes,
		"sample_plain":       string(sample),
		"sample_sha256":      SHA256Hex(sample),
		"delivery_zip_name":  map[string]string{"m-1/../x": DeliveryZipName("m-1/../x"), "": DeliveryZipName(""), "m-20260822-0001": DeliveryZipName("m-20260822-0001")},
		"sanitize_id":        map[string]string{"a b/c\\d..e": SanitizeID("a b/c\\d..e")},
		"strip_control":      StripControlMarkers("好的，办完了。 END_OF_CONVERSATION  \n\nend of conversation\n"),
	})
}
