/**
 * Tab strip for the third column (the content area). Which tabs are offered
 * depends on the selection kind (see `tabsFor` in ./page-state.ts); this just
 * renders the strip and reports the active one. Styled with dsh `--dsw-*`
 * tokens, one `<style>` from ./styles.ts.
 */
import type { PaneTab } from './page-state.ts'
import type { Translate } from './translate.ts'

export interface ContentTabsProps {
  /** The tabs this content area offers (order matters). */
  tabs: readonly PaneTab[]
  /** The active tab. */
  active: PaneTab
  onChange: (tab: PaneTab) => void
  t: Translate
}

export function ContentTabs({ tabs, active, onChange, t }: ContentTabsProps) {
  return (
    <div className="sm-pane-tabs" data-soulmirror-pane-tabs role="tablist">
      {tabs.map(tab => (
        <button
          key={tab}
          type="button"
          role="tab"
          className={`sm-pane-tab${active === tab ? ' sm-active' : ''}`}
          onClick={() => { onChange(tab) }}
          aria-pressed={active === tab}
          aria-selected={active === tab}
          data-soulmirror-pane-tab={tab}
        >
          {t(`pane.${tab}`)}
        </button>
      ))}
    </div>
  )
}
