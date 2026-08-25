# spec/vectors —— A2A Wire v2.0 测试向量

[English](README.md) | 中文

机器可读的合规附录。每个文件都由 `a2a/vectors_test.go` 从**固定种子**生成，日常 `go test ./...` 会把当前 Go 实现的输出与这些文件逐值比对——文件和代码任一边改了而另一边没改，测试立刻红。

## 固定输入

| 身份 | Ed25519 seed（32 B hex） | X25519 私钥标量（32 B hex） | 指纹 |
|---|---|---|---|
| **A**（发件 / 付款 / 名片主人） | `01…01`（32 个 0x01） | `a1…a1` | `NHUPmL1Z_PyUbaRaqr6TOw` |
| **B**（收件 / 收款） | `02…02` | `b2…b2` | `ajgD1fBZkCocba-8m6Rykg` |

固定时间戳 `2026-08-22T01:02:03.123456789Z`；邮局列表 `["https://relay.example.org","https://relay2.example.org"]`。

重建密钥：Ed25519 私钥 = `NewKeyFromSeed(seed)`（RFC 8032 标准派生）；X25519 私钥 = 32 字节原样作标量（clamping 由 X25519 内部完成）。

## 文件清单

| 文件 | 断言什么 | 规范章节 |
|---|---|---|
| `identity.json` | 两个身份的 `ed_pub / ed_priv(64B) / x_pub / x_priv` base64 与 **指纹** | §2 |
| `card.json` | A 的名片 JSON、`signing_bytes` 精确串、`sig`、`soulmirror://card?…` URI、指纹；`ParseCard(uri)` 往返一致 | §3 |
| `request.json` | `GET /mail` 与 `POST /mail/ack` 的签名串 `a2a-req-v2\n…` 与签名值（ts 固定，已过 5 分钟窗，故只验签名不验窗口） | §6 |
| `settle.json` | `settle-v1\n…` 签名串与付款方签名 | §9 |
| `dir-unpublish.json` | `directory-unpublish:<fp>` 签名串与签名 | §8.2 |
| `profile.json` | 能力名片 `PublicCopy` 后的 JSON、**`signing_bytes`（Go encoding/json 精确字节，含 `&`/`<` 转义）**、`sig` | §8.3 |
| `convid.json` | `ConvID` 的排序规则 | §4.4 |
| `envelope.json` | A→B 的内层 `message`、`plaintext_json`（精确 JSON 字节）、**一封固定密文** `envelope.cipher`、外层签名串与 `sig`、`from_xpub` | §4 |
| `chunk.json` | `MaxArtifactBytes` / `ChunkRawBytes` / 阈值表 / 样本 sha256 / `DeliveryZipName` / `SanitizeID` / `StripControlMarkers` | §5 §10 |

## 第三方实现怎么用

1. **确定性部分**（identity / card / request / settle / dir-unpublish / profile / convid / chunk）：用同样输入跑你的实现，**输出必须逐字节相等**。Ed25519 签名是确定性的，所以连 `sig` 都要相等；不等就是签名串拼接、编码或 JSON 序列化有出入——先对 `signing_bytes` 字段，它就是被签的原始字节（UTF-8 字符串）。
2. **信封**：
   - 解密：用 B 的 `x_priv` + A 的 `x_pub`（或 `envelope.from_xpub`）按 §4.3 派生密钥，`Open(envelope.cipher)` 必须得到 `plaintext_json`（作为 JSON 语义相等即可；能逐字节相等说明你的序列化与 Go 一致）。
   - 验签：`envelope.sig` 对 `envelope_signing_bytes` 用 `envelope.from` 验证必须通过；你自己重排 `"a2a-envelope-v2\n"+to+"\n"+ts(UTC RFC3339Nano)+"\n"+cipher` 必须与 `envelope_signing_bytes` 相等。
   - 加密：你 `Seal` 出的密文（随机 nonce，不可能与文件相等）要能被 Go 实现 `Open`——最简单的办法是写个 Go 小测试调用 `a2a.Open`，或直接跑本仓库 relay + 灵镜做一次真实收发。
3. **时间窗 / 频控 / 长轮询**这类依赖时钟的行为不在向量里，按规范自测。

## 重新生成（只在协议刻意变更时）

```sh
A2A_WRITE_VECTORS=1 go test ./a2a/ -run TestVectors
```

生成后的 diff 必须与 `spec/a2a-wire-spec.md` 的文字改动在同一个 PR 里评审；向量变了而规范文字没变（或反之）都不接受。
