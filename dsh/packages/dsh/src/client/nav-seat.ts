/**
 * Whether a sidebar that declares `sidebar.nav.primary` (soulnet-dsh-sidebar)
 * is installed. Set by the inject callback for that seat (it fires only once
 * the seat exists) and cleared when the registration is disposed; the footer
 * entry (`sidebar.footer.action`, the stock-dsh placement) reads it and hides
 * itself so the SoulMirror entry shows once — in the nav on our sidebar, at
 * the foot on a stock dsh.
 */
let claimed = false
const listeners = new Set<() => void>()

export const navSeatStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  },
  getSnapshot(): boolean {
    return claimed
  },
  set(value: boolean): void {
    if (claimed === value) return
    claimed = value
    for (const listener of listeners) listener()
  },
}
