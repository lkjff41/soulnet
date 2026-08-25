# P0 spike — SoulMirror on DeepSeek Harness (`@soulmirror/dsh`)

Date: 2026-08-22 · dsh `0.1.1-rc.2` (source `b150a55`) · runtime: `npx -y @deepseek-ai/dsh@0.1.1-rc.2` on Windows 11, Node 22.23.1, pnpm 11.22 · backend: in-memory fake `NetworkClient` (2 friends, 1 canned inbound mail).

Answers to the five spike questions of the architecture plan (§7, items 1–5), plus the install-path and client-bundle findings. Evidence: `spike-evidence/*.png`, the session logs quoted below, and the skeleton in `packages/dsh/`.

> 中文摘要：① 自定义会话事件**不能**成为模型可见输入——模型表面只认 `user/message`/`assistant/message`/`tool/result`，而且 `append()` 无法给自定义事件打 `ignorable` 标记，持久化读回时会**拒绝整份日志**（重启后会话无法 resume）；正路是来信写成 `user/message`（source `plugin:'soulmirror'`, `form:'relay'`），UI 侧再用自己的 Definition 渲染成气泡（会与内建"上下文注入"折叠行并存，可用 keyed slot 的 `priority` 遮蔽）。② 好友会话默认落在 Chat 视图，我们的 keyed 节点渲染器就在 Chat 里生效，不需要切标签；自己的 `conversation.view` 标签（"SoulMirror"）也能注册但不能设为默认。③ 侧边栏行**没有未读槽**；更糟的是没跑过轮次的会话是 `blank`，侧边栏根本不显示——只能借标题、设置页列表或让 Host 跑一轮。④ `conversation.composer` chain 能按 `agentPreset === 'soulmirror-chat'` / cwd 接管好友会话输入框（审批/提问优先级更高，仍会赢）。⑤ Host 插件能程序化 `workspaceRegistry.create` + `agents.create({meta:{cwd, agentPreset}, setup: mount preset})` + `attachSession` + `sessionTitle.rename`，全部跑通；注意与浏览器侧 apiproxy 的发布竞态。安装：npx 可用（首次很慢）；`dsh plugin add <目录>`（link）与 `<tgz>`（拷到 workspace 外）都顺利；client bundle 的 lazy-CJS factory + 纯净度门禁已在 `tsdown.config.ts` 复刻。

---

## 0. What was built (skeleton)

| Piece | Where | Status |
|---|---|---|
| pnpm workspace | `dsh/pnpm-workspace.yaml`, `dsh/package.json` | done |
| `@soulmirror/dsh` bundle manifest (`dsh.bundle.patch`, `dsh.client`, `exports` incl. `./client`) | `packages/dsh/package.json`, `cordis.patch.yml` | done |
| Host: `soulmirror-network` → `ctx.soulmirror` (`NetworkClient`, fake impl) + `ctx.soulmirrorHome` | `src/index.ts`, `src/network/*` | done |
| Host: `soulmirror-sessions` → workspace "SoulMirror", one Session per friend, inbound → events, preset install/mount, title, fp↔session map | `src/sessions/index.ts`, `presets/soulmirror-chat/` | done |
| Host: `soulmirror-tools` → `soulmirror_ping`, `soulmirror_friends` (raw `ToolDefinition`) | `src/tools/index.ts` | done (registered; not exercised by a model in this spike — no API key) |
| Client: `a2a-message` Node Definition + keyed Chat renderer (bubble), relay-twin Definition (spike switch) | `src/client/a2a-node.ts`, `A2ANode.tsx` | done |
| Client: `conversation.view` tab "SoulMirror" | `SoulmirrorView.tsx` | done |
| Client: `settings.section` "SoulMirror network" (+ friend-session list with Open) | `SettingsSection.tsx` | done |
| Client: `conversation.composer` chain takeover for friend sessions (placeholder bar) | `FriendComposer.tsx` | done |
| zh/en dictionaries | `src/client/locales.ts` | done |
| Build: tsc (two tsconfigs) + tsdown (node ESM + browser lazy-CJS factory, purity gate) | `tsdown.config.ts` | done |

Everything in the table was exercised live in `dsh web` (screenshots: `spike-evidence/01-chat-bubbles-and-context-row.png`, `02-soulmirror-view-tab.png`, `03-settings-section.png`).

---

## 1. Single event, dual render? — **No.** A custom session event can be a UI node but can never be model input; and it breaks persistence.

Facts (dsh source, verified live):

1. **The model surface is a closed set.** `packages/core/session/src/surface.ts`: only `user/message`, `assistant/message`, `tool/result` are surface-eligible; `Session.deriveMessages` folds exactly those into the request. A custom `a2a/message` can never reach the model, and `agent/pre-step` does not help: every message a pre-step listener adds to `{kind:'enter', messages}` is appended by the loop as a `user/message` (`agent-loop/src/agent.ts` `turn()`), i.e. "model-visible ⟺ logged as user/message" is structural.
2. **Custom event types make the log unloadable.** `KNOWN_SESSION_EVENT_TYPES` (generated) is closed; `session-persistence/src/coordinator.ts#assertEventsSupported` throws `SessionFormatUnsupportedError` for any other type unless the envelope carries `ignorable: true` — and `Session.append()` has no way to set `ignorable` (only the sqlite compression path ever writes it). The file even says: *"Downstream (out-of-repo) plugin events are outside this list by construction; a registration surface for them is deferred until such a consumer exists."* We are that consumer → upstream ask.
   - Live evidence: run 1 wrote `a2a/message` into Alice's session (`session-bd5f434d…`, seq 4 in `session.jsonl.zstd`); on restart (run 2) the host-side `ctx.agents.resume` of that id failed and the plugin had to mint a new session (`dsh-sessions.json` now maps Alice → `session-89dcd34f…`); the dead session still shows in the sidebar because apiproxy's cold "blank probe" fails on an unreadable log and *"serves it as visible"* — clicking it errors. Run 3 reproduces it with the error text captured in `<home>/a2a/dsh-sessions.log` (see §7 transcript).
3. **The dual-event fallback works and is the only viable path today**, and it is better than the plan feared:
   - Inbound mail → `user/message` with `source: { kind:'plugin', plugin:'soulmirror', form:'relay', senderSessionId:<friend display name>, a2a:{id,fp,ts,auto} }`. dsh already has a **`relay` context form** ("a message another agent addressed to this one"), so the built-in chat renders it as a collapsed "Context injection · soulmirror" row whose body says *"From session college friend"* + the text (screenshot 01). The model sees the full text on the next request.
   - Our own `ConversationNodeDefinition` (`a2a-relay`, spike switch `RENDER_RELAY_TWIN`) matches that same `user/message` and renders it as a SoulMirror bubble in the same Chat view — proven on screen. Cost: the built-in `input-message` Definition also renders it, so there are two rows per mail. To hide the built-in row without forking ui-conversation: register our own keyed `conversation.chat.node` renderer for key `context` at `priority: -1` (lower priority shadows; same-priority throws — `ui-slots` `SlotCore.register`), render our bubble when `source.plugin === 'soulmirror'` and a minimal disclosure otherwise. Not done in P0; it is the P2 task.
   - Outbound (our side's sent mail) can ride the same channel as a `user/message` with `form:'notice'` (one-line summary) or be left as UI-only until upstream offers a registration surface for plugin event types.

**Decision for P1**: drop the custom `a2a/message` type from the durable log (keep it only as a transient projection if needed); inbound = `user/message` relay form; file an upstream issue/PR for `SessionEventMap` extension registration (or an `append()` option to mark `ignorable`).

## 2. Which view do friend sessions land in? — **Chat (fixed default); our renderer lives inside it, so no tab switch is needed.**

- `ConversationSession.tsx`: `DEFAULT_VIEW_ID = 'chat'`; the active view is store state per session (`view: null` → chat). There is no API for a plugin to change the default view, and a friend session must not need one: keyed Chat node renderers (`conversation.chat.node`) render in the Chat view by construction (screenshot 01).
- A plugin-owned `conversation.view` tab is trivial (`ui-trajectory` pattern) — ours is the third tab "SoulMirror" (screenshot 02: lists the `a2a-message` nodes of the session, read from `useSession(s => s.chat)`). Useful for the P2 "card & protocol" tab; not needed for the transcript.

## 3. Sidebar unread? — **No unread slot, and worse: sessions without a turn are hidden.**

- `ui-workspace` rows show only `pendingInteraction` (amber) / running (blue) / completed-unviewed (green) states; no count/badge seat (README "已知限制").
- `SessionSummary.blank` = "no `turn/start` in the log" (`apiproxy`). `ui-workspace` hides blank sessions except the currently selected one (`tree.ts#sessionVisible`). Our friend sessions (created + mail delivered, but no model turn) are therefore **invisible in the sidebar** — run 1 sidebar showed only `SoulMirror / New Session` although two friend sessions existed and one had mail. With `nudgeTurn: true` (run 2: one queued notice → a turn that fails for lack of a model key) the row appears ("college friend · now").
- Acceptable forms for P1/P2: (a) the settings/section list with Open buttons (built, screenshot 03); (b) a real first turn per friend session (costs one model call, or a cheap failed/blocked turn — ugly: "This turn failed" row); (c) title suffix `(n)` via `ctx.sessionTitle.rename` for unread counts (rename works — titles "Bob" / "college friend" came from our plugin); (d) a `conversation.session.header.actions` badge for the open session; (e) upstream ask: a `SessionSummary` badge/unread seat, or let plugins mark a session non-blank.

## 4. Composer chain selector — **Yes: per-session takeover by preset or cwd works.**

- `conversation.composer` is a `chain` slot; the owner currency is `{ interactions, session: ConversationSnapshot }`. The snapshot has no cwd/preset, but the selector is a closure, so it reads `ctx.sessions.list.getSnapshot().byId[session.sessionId]` → `agentPreset` / `cwd`. Our entry registers `priority: 5` so approvals (1) and questions (0) still win the editor. Result on screen: "SoulMirror friend session · college friend · matched by preset" replacing the InputBar (screenshot 01).
- Caveat: the selector is not re-run when the list store changes; in practice the summary is there before a session renders. If a friend session is created while open (not our flow) the takeover appears on the next render.

## 5. Programmatic workspace + sessions from a host plugin — **Yes, end to end.**

Run log (`<home>/a2a/dsh-sessions.log`, run 3) and `$DSH_HOME/sessions/**/session.jsonl.zstd` show: `ctx.workspaceRegistry.create(<home>/a2a, 'SoulMirror')` → per friend `ctx.agents.create({ sessionId, meta: { cwd, agentPreset: 'soulmirror-chat' }, setup: agentCtx => presets.mount(agentCtx, 'soulmirror-chat') })` → `workspace.attachSession(id)` → `ctx.sessionTitle.rename(session, name)`. The header on disk records `"agentPreset":"soulmirror-chat"`, the header shows "SoulMirror assistant", and `session/title` is seq 3. Details that mattered:

- `inject` must include `agentLoop` (the factory provider), not only `agents`, or `create()` can race the loop's `setFactory`.
- The preset must exist in a roster root. P0 copies `presets/soulmirror-chat/` into `$DSH_HOME/.agent-presets/` on first run (user root, authorable); a bundle cannot add a root without restating the whole `agent-presets` row config (patch replaces `config`). P1: ship the preset as a bundle-owned root via a `!!js` path expression or keep the copy.
- `workspace.attachSession` validates the session cwd against the workspace path → create sessions with `meta.cwd` = workspace path.
- Races: the browser re-opens the last session through apiproxy on reconnect; if our plugin is resuming the same id at the same moment, only one `enter()` wins. Handle "resume failed but `ctx.agents.get(id)` is live" as reuse (done in `ensureFriendSession`; this is apiproxy's own pattern).
- Session logs are written behind (flushed on a timer / request checkpoints); reading them requires multi-frame zstd decoding (`dump-sessions.cjs` pattern: split on the zstd magic, `zlib.zstdDecompressSync` per frame).
- `ctx.logger` output of host plugins is not surfaced on the `dsh web` console by default; the spike writes its own file log.

---

## 6. Install path, `dsh plugin add`, client bundle outside the repo

- **npx works**: `npx -y @deepseek-ai/dsh@0.1.1-rc.2 --version` → `0.1.1-rc.2` (first run downloaded for ~25 min on this machine; later runs are instant). No source build was needed. `dsh web` bundles `@deepseek-ai/dsh-base` + `dsh-web-app` and auto-initializes `$DSH_HOME/profiles/web`.
- **Pin versions**: dsh packages are published under the `next` dist-tag; `latest` resolves to stale `0.0.1-rc.1` for many packages. All `@deepseek-ai/*` devDependencies are pinned to `0.1.1-rc.2`.
- **`dsh plugin --profile web add ./packages/dsh`** (link) — works; `--dump-config` shows the `# == @soulmirror/dsh` layer with the three rows; `/plugins/@soulmirror/dsh/client.js` is served and listed in `window.__DSH_BOOT__`.
- **`dsh plugin --profile web add <tgz>`** (`pnpm pack`) — works **when the tgz is outside the pnpm workspace**. Adding a tarball that sits inside `dsh/dist/` made pnpm treat it as an injected workspace package and try to symlink `@types/node` from the workspace's virtual store → `EPERM: symlink` on Windows. Copy the tarball elsewhere first (README says so). Removal: `dsh plugin --profile web remove @soulmirror/dsh`.
- **Module resolution rule** (why the host half has zero `@deepseek-ai/*` value imports): a linked package resolves bare specifiers from its own real path, where the harness is not installed; a published/tarball install would resolve peers from the profile, but a second copy of cordis/dsh-tools would still be a different runtime instance. Type-only imports + raw `ToolDefinition` objects + hand-rolled `UserMessage`/home-path helpers keep both install paths working from the same build.
- **Client bundle format replicated out of repo** (`packages/dsh/tsdown.config.ts`): CJS, browser platform, `banner`/`intro`/`footer` producing `window.__ModuleLoader__.load({ id, factory: (require) => { var module={exports:{}}; …; return module.exports } })`; externals = `PLATFORM_MODULES` (`react`, `react/jsx-runtime`, `react-dom`, `react-dom/client`, `@deepseek-ai/cordis`, `@deepseek-ai/dsh-client-ui-slots`, `@deepseek-ai/dsh-client-ui-primitives`) + `@deepseek-ai/dsh-client-runtime/client` + `dsh.client.external`; everything else inlined; a purity plugin throws on any other `@deepseek-ai/*` value import. The built bundle `require`s only `react` and `react/jsx-runtime` (it uses services for everything else) and loaded without a single console error. CSS: the repo preset compiles `.module.css` with lightningcss; the spike uses inline styles — P2 decides whether to replicate the CSS plugins or keep a tiny style injector.
- **Multiple host rows from one package**: only the bare package-name row is scanned for `dsh.client`; subpath rows (`@soulmirror/dsh/sessions`, `/tools`) are "permanently not a client row" (`client/modules/src/index.ts`). Hence the root entry is the network plugin and the bundle declaration lives on it.
- **One tsc program per half**: host and client merge different types into cordis `Context.sessions` (host `SessionStore` vs client `ISessions`); compiling both in one program errors. Two tsconfigs (`tsconfig.json` host, `tsconfig.client.json` client) emit into `lib/types`.
- turtle-ui (the doc's out-of-repo example) returned 404 on GitHub at spike time; this config is the working reference now.

## 7. Run transcript (abridged)

```
run 1  (link install, inboundEvent: both)
  sidebar: SoulMirror / New Session                       ← friend sessions hidden (blank)
  settings → SoulMirror network: "Bob · blank · preset soulmirror-chat", "college friend · blank · preset soulmirror-chat"
  open "college friend": tabs Chat | Trajectory | SoulMirror; bubble (a2a/message); "Context injection · soulmirror"
        (expanded: "From session college friend … [SoulMirror A2A inbound] …"); bubble (user/message twin); composer takeover
  on disk (after write-behind flush): session-bd5f… seq 4 a2a/message, seq 5 user/message
run 2  (profile patch nudgeTurn: true)
  resume of session-bd5f… (Alice) failed → fresh session-89dc… created; Bob's (no custom event) resumed fine
  sidebar: "college friend · now" (has turns: turn 1 failed "has no provider/model") + stale "college friend · 9min"
run 3  (tarball install from outside the workspace; <home>/a2a/dsh-sessions.log, copied to spike-evidence/dsh-sessions.log.txt)
  INFO  workspace "SoulMirror" id=fa6045bc-… path=…\dsh-home\soulmirror\a2a
  ERROR resume of session-89dcd34f-… (Alice) failed; creating a fresh session. Cause: SessionFormatUnsupportedError:
        session "session-89dcd34f-…" contains event type "a2a/message" (seq 11) unknown to this harness and not marked
        ignorable; refusing to interpret the log — it was likely written by a newer harness (raw log: …\session.jsonl.zstd)
  INFO  created session session-294ccd9a-… for Alice (preset=soulmirror-chat)
  INFO  resumed session session-43757354-… for Bob                       ← no custom event in its log → resume OK
  INFO  inbound a2a-d87128ed-… from Alice → session session-294ccd9a-… (both)
  sidebar now lists three "college friend" rows (one live + two dead unreadable ones served "as visible" by the blank probe)
```

## 8. Open items for P1 (carry into the plan)

1. Upstream asks to dsh: (a) plugin session-event registration / `ignorable` on append; (b) sidebar badge or non-blank marking; (c) a CSS-capable published client-bundle preset (or keep our replica).
2. Decide inbound encoding: `user/message` relay form (recommended) and the `priority:-1` context-row shadowing for a clean transcript.
3. `soulnet` light peer backend behind `NetworkClient` (stdio JSON-RPC), replacing `fake.ts`; identity/home files in `<home>/a2a/` same layout as `~/.soulmirror/a2a/`.
4. Sidebar visibility policy for friend sessions (first turn vs settings list vs title badges).
5. Composer: real send path (`@Remote` on the host) and the "ask assistant" path through approval.
