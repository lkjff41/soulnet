/**
 * The SoulMirror brand occupants: the app icon for `sidebar.brand.mark` and
 * `conversation.hero.brand.mark` (the new-session hero), the wordmark for
 * `sidebar.brand.name`. Same owner props as the official occupants
 * (`{ size, className }` for marks, none for the name), so the stock shells
 * that render these seats need no change.
 */
import type { SidebarBrandMarkOwnerProps, SidebarBrandNameOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { SOULMIRROR_ICON_128 } from './brand-assets.ts'
import type { NS } from './locales.ts'

export type BrandMarkProps = SidebarBrandMarkOwnerProps & { className?: string | undefined }

/** The SoulMirror app icon at the requested square edge. */
export function SoulmirrorBrandMark({ size, className }: BrandMarkProps) {
  return (
    <img
      src={SOULMIRROR_ICON_128}
      width={size}
      height={size}
      alt=""
      aria-hidden
      draggable={false}
      className={className === undefined ? 'sn-logoImg' : `sn-logoImg ${className}`}
    />
  )
}

export type BrandNameProps = SidebarBrandNameOwnerProps & PropsLocale<typeof NS>

/** The wordmark beside the expanded mark: product name + the other-language name, small. */
export function SoulmirrorBrandName({ t }: BrandNameProps) {
  return (
    <>
      <span>{t('brand.name')}</span>
      <span className="sn-brandSub">{t('brand.sub')}</span>
    </>
  )
}
