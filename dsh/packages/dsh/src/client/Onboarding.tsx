/**
 * `settings.onboarding` step "soulmirror-identity": shown once while there is
 * no SoulMirror identity. Name → create → card URI + copy + backup warning →
 * Done. Completes immediately (renders nothing) when an identity exists, or
 * when the user picks "Later" (they can create it in Settings any time; the
 * step shows again on the next start while no identity exists, because the
 * only durable completion fact we keep is the identity itself).
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { api, networkStore } from './api.ts'
import type { NS } from './locales.ts'
import { CardBlock } from './SettingsSection.tsx'

export type OnboardingProps = PropsRuntime<'settings.onboarding'> & PropsLocale<typeof NS>

export function SoulmirrorOnboarding({ complete, openSection, t }: OnboardingProps) {
  const net = useSyncExternalStore(networkStore.subscribe, networkStore.getSnapshot)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [created, setCreated] = useState(false)
  const finished = useRef(false)
  const finish = (): void => {
    if (finished.current) return
    finished.current = true
    complete()
  }

  // Identity present and we did not just create it → nothing to onboard.
  useEffect(() => {
    if (net.state?.identity && !created) finish()
  })

  useEffect(() => {
    const appRoot = document.getElementById('root')
    if (appRoot === null || net.state === undefined || (net.state.identity && !created)) return
    const previous = appRoot.inert
    appRoot.inert = true
    return () => { appRoot.inert = previous }
  }, [net.state, created])

  if (net.state === undefined) return null
  if (net.state.identity && !created) return null
  const status = net.status ?? net.state.status
  const peerDown = net.state.backend === 'soulnet' && status.state !== 'ready'

  return (
    <Modal open title={t('onboard.title')} onClose={() => {}} headless>
      <div style={{ display: 'grid', gap: 12, padding: 16, maxWidth: 560 }} data-soulmirror-onboarding>
        <h2 style={{ margin: 0, fontSize: '1.1em' }}>{t('onboard.title')}</h2>
        {!created
          ? (
            <>
              <p style={{ margin: 0, opacity: 0.8 }}>{t('onboard.body')}</p>
              {peerDown ? <p style={{ margin: 0, color: 'rgb(220,120,40)' }}>{t('onboard.waiting', { state: status.state })}</p> : null}
              <input
                style={{ font: 'inherit', padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(127,127,127,.35)', background: 'transparent', color: 'inherit' }}
                placeholder={t('onboard.name')}
                value={name}
                autoFocus
                onChange={e => { setName(e.target.value) }}
              />
              {error !== undefined ? <p role="alert" style={{ margin: 0, color: 'rgb(220,80,60)' }}>{error}</p> : null}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <Button variant="ghost" onClick={() => { finish() }}>{t('onboard.later')}</Button>
                <Button
                  variant="primary"
                  disabled={busy || name.trim() === '' || peerDown}
                  onClick={() => {
                    setBusy(true)
                    setError(undefined)
                    api.createIdentity(name.trim()).then(async () => {
                      await networkStore.refresh()
                      setCreated(true)
                    }).catch((e: unknown) => {
                      setError(e instanceof Error ? e.message : String(e))
                    }).finally(() => { setBusy(false) })
                  }}
                >
                  {t('onboard.create')}
                </Button>
              </div>
            </>
          )
          : (
            <>
              <p style={{ margin: 0 }}>{t('onboard.created')}</p>
              {net.state.identity ? <CardBlock cardUri={net.state.identity.cardUri} home={net.state.home} t={t} /> : null}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <Button variant="ghost" onClick={() => { finish(); openSection('soulmirror') }}>{t('settings.nav')}</Button>
                <Button variant="primary" onClick={() => { finish() }}>{t('onboard.done')}</Button>
              </div>
            </>
          )}
      </div>
    </Modal>
  )
}
