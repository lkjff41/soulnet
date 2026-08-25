/** Keyed Chat renderer for `a2a-message` nodes in the native alter session: a friend bubble, or a system line for a plugin note. */
import type { CSSProperties } from 'react'
// Type-only: the 'conversation.chat.node' SlotMap row + our ChatNodeDataMap merge.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { A2AChatData } from './a2a-node.ts'
import type { NS } from './locales.ts'

export type A2ANodeProps = PropsRuntime<'conversation.chat.node', 'a2a-message'> & PropsLocale<typeof NS>

const row = (dir: 'in' | 'out'): CSSProperties => ({
  display: 'flex',
  justifyContent: dir === 'in' ? 'flex-start' : 'flex-end',
  padding: '4px 0',
})

const bubble = (dir: 'in' | 'out'): CSSProperties => ({
  maxWidth: '72%',
  padding: '8px 12px',
  borderRadius: dir === 'in' ? '4px 14px 14px 14px' : '14px 4px 14px 14px',
  background: dir === 'in' ? 'var(--dsw-specific-bubble, var(--dsw-alias-interactive-bg-hover))' : 'var(--dsw-alias-brand-primary)',
  color: dir === 'in' ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-primary-inverted)',
  border: dir === 'in' ? '1px solid var(--dsw-alias-border-l2)' : 'none',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  fontSize: '0.95em',
  lineHeight: 1.45,
})

const meta: CSSProperties = {
  fontSize: '0.75em',
  color: 'var(--dsw-alias-label-tertiary)',
  marginBottom: 2,
  display: 'flex',
  gap: 8,
}

const noteLine: CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  padding: '4px 0',
  fontSize: '0.78em',
  color: 'var(--dsw-alias-label-tertiary)',
  textAlign: 'center',
}

function time(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function A2ANode({ node, t }: A2ANodeProps) {
  const data: A2AChatData = node.data
  if (data.note !== undefined) {
    return (
      <div style={noteLine} data-soulmirror-a2a-note={data.note}>
        <span>{t('bubble.note')} · {data.body} · {time(data.ts)}</span>
      </div>
    )
  }
  return (
    <div style={row(data.dir)} data-soulmirror-a2a={data.id}>
      <div>
        <div style={meta}>
          <span>{t(data.dir === 'in' ? 'bubble.in' : 'bubble.out', { name: data.name })}</span>
          <span>{time(data.ts)}</span>
          {data.auto ? <span>· {t('bubble.auto')}</span> : null}
          {data.type !== undefined ? <span>· {data.type}</span> : null}
          {data.delivery !== undefined ? <span>· {data.delivery}</span> : null}
        </div>
        <div style={bubble(data.dir)}>{data.body}</div>
      </div>
    </div>
  )
}
