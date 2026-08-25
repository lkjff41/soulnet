/** `soulmirror-sidebar` namespace dictionaries: shell controls (brand row, New Session, fold toggle). */

export const NS = 'soulmirror-sidebar'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'session.new': '新会话',
  'session.new.label': '新建会话',
  'toggle.open': '打开侧边栏',
  'toggle.collapse': '收起侧边栏',
  'brand.name': '灵镜',
  'brand.sub': 'SoulMirror',
} as const

/** English dictionary, checked complete against the zh key set. */
export const en: Record<keyof typeof zh, string> = {
  'session.new': 'New Session',
  'session.new.label': 'New session',
  'toggle.open': 'Open sidebar',
  'toggle.collapse': 'Collapse sidebar',
  'brand.name': 'SoulMirror',
  'brand.sub': '灵镜',
}

export type SidebarKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'soulmirror-sidebar': SidebarKey
  }
}
