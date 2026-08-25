/**
 * Shared renderers of the agent PROCESS items (thinking / tool), used by the
 * agent's direct chat pane (./AgentPane.tsx) and by the group chat's live
 * work feed (./rooms/ChatRoom.tsx) — one look everywhere: a thinking item is
 * ONE collapsed line (streaming shows the moving tail, done shows the head)
 * with a disclosure toggle expanding the full reasoning; a tool call is one
 * monospace line.
 */
import type { ApiChatItem } from './api.ts'
import type { Translate } from './translate.ts'

export type ProcessItem = Extract<ApiChatItem, { kind: 'thinking' } | { kind: 'tool' }>

export function ProcessItemView({ item, t, open, onToggle }: {
  item: ProcessItem
  t: Translate
  /** The thinking item is expanded (tool lines ignore it). */
  open: boolean
  onToggle: (key: string) => void
}) {
  if (item.kind === 'tool') {
    return (
      <div className="sm-citem sm-wide" data-soulmirror-agent-item="tool">
        <div style={{ fontSize: 12, opacity: 0.7, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', padding: '1px 4px', wordBreak: 'break-all' }}>
          🔧 {item.name} <span style={{ opacity: 0.7 }}>{item.args}</span>
        </div>
      </div>
    )
  }
  const streaming = item.streaming === true
  const flat = item.text.replace(/\s+/g, ' ').trim()
  const preview = streaming ? flat.slice(-72) : flat.slice(0, 72)
  return (
    <div className="sm-citem sm-wide" data-soulmirror-agent-item="thinking" data-soulmirror-thinking={streaming ? 'streaming' : 'done'}>
      <div style={{ margin: '1px 0 1px 4px', minWidth: 0 }}>
        <button
          type="button"
          onClick={() => { onToggle(item.key) }}
          style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, opacity: 0.65, fontStyle: 'italic', maxWidth: '100%', padding: '1px 4px' }}
        >
          <span aria-hidden style={{ fontStyle: 'normal', opacity: 0.8 }}>{open ? '▾' : '▸'}</span>
          <span style={{ whiteSpace: 'nowrap' }}>💭 {streaming ? t('agent.thinking.live') : t('agent.thinking.done')}</span>
          {!open
            ? <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.85 }}>{streaming ? `…${preview}` : `${preview}${flat.length > 72 ? '…' : ''}`}</span>
            : null}
        </button>
        {open
          ? (
            <div style={{ fontSize: 12, opacity: 0.6, fontStyle: 'italic', whiteSpace: 'pre-wrap', borderLeft: '2px solid rgba(127,127,127,.4)', padding: '2px 10px', margin: '2px 0 2px 12px' }}>
              {item.text}
            </div>
          )
          : null}
      </div>
    </div>
  )
}
