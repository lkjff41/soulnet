# soulnet-dsh-sidebar

The SoulMirror sidebar for DeepSeek Harness (dsh): a dsh bundle that takes over
the **left column** and the **brand** of the dsh web UI — and nothing else.

- Same skeleton as the stock column (brand row + fold toggle, New Session, the
  workspace/session browser, footer actions, Settings, the 56px rail when
  collapsed), so dsh works exactly as before.
- Every stock inner seat is declared again — `sidebar.brand.mark`,
  `sidebar.brand.name`, `sidebar.workspaces`, `sidebar.settings`,
  `sidebar.footer.action` — so ui-workspace, ui-settings and any footer action
  mount untouched.
- Two new seats for other plugins: **`sidebar.nav.primary`** (navigation rows
  under New Session; icon-only in the rail) and **`sidebar.header.action`**
  (icon buttons in the brand row, wide only).
- The SoulMirror icon and wordmark replace the official brand in the sidebar
  and in the new-session hero (`conversation.hero.brand.mark`).

## How it works

dsh's web UI is a roster of plugin rows (`ui-layout`, `ui-sidebar`,
`ui-brand-official`, …). This package's `cordis.patch.yml` disables the two
rows `ui-sidebar` and `ui-brand-official` and inserts itself; its browser half
registers the layout's `sidebar` seat (the whole left column) and the three
brand seats. No dsh code is forked or patched.

```sh
npx -y @deepseek-ai/dsh@0.1.1-rc.2 plugin --profile web add soulnet-dsh-sidebar
npx -y @deepseek-ai/dsh@0.1.1-rc.2 web --port 3099
```

Roll back: `dsh plugin --profile web remove soulnet-dsh-sidebar` — the stock
rows come back on their own.

## Filling the new seats (from another plugin)

```ts
ctx.slots.inject('sidebar.nav.primary', () => ctx.slots.register(
  { name: 'sidebar.nav.primary', id: 'my-entry', order: 10 },
  MyRow,   // receives { wide: boolean } (+ t when the registration has a locale)
))
```

The inject callback fires only once this sidebar has declared the seat, so a
plugin can register into a new seat *and* a stock one (say `sidebar.footer.action`)
and stay correct on a stock dsh — see how `soulnet-dsh` moves its SoulMirror entry.

Types for the two seats (`SidebarNavPrimaryOwnerProps`,
`SidebarHeaderActionOwnerProps`) come from `soulnet-dsh-sidebar/client`
(type-only import; the bundle purity gate erases it).

## Layout

```
packages/sidebar/
├── cordis.patch.yml     disables ui-sidebar + ui-brand-official, inserts soulmirror-sidebar
├── src/index.ts         host half: empty apply (Loader needs a host row)
└── src/client/
    ├── index.ts         registers the `sidebar` seat + the three brand seats
    ├── SidebarRoot.tsx  the column (stock fold state machine + the two new seats)
    ├── brand.tsx        SoulmirrorBrandMark / SoulmirrorBrandName
    ├── brand-assets.ts  the app icon, 128px PNG data URI (dsh/scripts/brand-asset.py)
    ├── slots.ts         SlotMap augmentation for sidebar.nav.primary / sidebar.header.action
    ├── locales.ts       zh/en (`soulmirror-sidebar` namespace)
    └── styles.ts        one <style>, --dsw-* tokens only
```
