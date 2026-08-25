/**
 * Built-in `alter.card` occupant — the alter's own settings (default reply
 * tier, auto-replies per hour, capability mode). These used to live in the
 * "SoulMirror network" settings section; they belong on the alter's page, and
 * this card is the built-in example of how a card plugin reads/writes the
 * `soulmirror` settings namespace through `scope`.
 */
import { useCallback, useSyncExternalStore } from 'react'
import { ProtocolEditor, TIERS, tierLabel } from './alter-ui.tsx'
import type { AlterCardOwnerProps } from './alter-card.ts'
import type { ReplyTier } from './api.ts'
import type { Translate } from './translate.ts'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="sm-field" style={{ margin: 0 }}>
      <span style={{ fontSize: 12, color: 'var(--dsw-alias-label-secondary)' }}>{label}</span>
      {children}
    </label>
  )
}

export function AlterSettingsCard({ scope, t }: AlterCardOwnerProps & { t: Translate }) {
  const subscribe = useCallback((cb: () => void) => scope.subscribe(cb), [scope])
  const read = useCallback(() => scope.getSnapshot(), [scope])
  const snap = useSyncExternalStore(subscribe, read)
  const values = snap.value
  const tier = values?.defaultTier as ReplyTier | undefined
  const perHour = typeof values?.autoReplyPerHour === 'number' ? values.autoReplyPerHour : 20
  const alterMode = values?.alterMode === 'full' ? 'full' : 'comms'

  return (
    <div className="sm-home-card" data-soulmirror-alter-card="settings">
      <div className="sm-home-title"><span>{t('alter.card.settings')}</span></div>
      <div style={{ display: 'grid', gap: 10 }}>
        <Field label={t('settings.alter.defaultTier')}>
          <select
            className="sm-select"
            value={tier ?? 'draft'}
            onChange={(e) => { void scope.set('defaultTier', e.target.value).catch(() => {}) }}
          >
            {TIERS.map((o) => <option key={o} value={o}>{tierLabel(t, o)}</option>)}
          </select>
        </Field>
        <Field label={t('settings.alter.perHour')}>
          <input
            className="sm-input"
            type="number"
            min={0}
            value={perHour}
            onChange={(e) => { void scope.set('autoReplyPerHour', Number(e.target.value)).catch(() => {}) }}
          />
        </Field>
        <Field label={t('settings.alter.alterMode')}>
          <select
            className="sm-select"
            value={alterMode}
            onChange={(e) => { void scope.set('alterMode', e.target.value).catch(() => {}) }}
          >
            <option value="comms">{t('settings.alter.alterMode.comms')}</option>
            <option value="full">{t('settings.alter.alterMode.full')}</option>
          </select>
        </Field>
        <span style={{ fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' }}>{t('settings.alter.alterMode.hint')}</span>
        <ProtocolEditor t={t} />
      </div>
    </div>
  )
}
