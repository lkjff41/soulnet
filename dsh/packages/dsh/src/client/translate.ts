/** The translate function bound to this plugin's `soulmirror` namespace (the `t` seat of every slot registration with `locale: NS`). */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'

export type Translate = PropsLocale<typeof NS>['t']
