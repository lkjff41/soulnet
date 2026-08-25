/**
 * Local `defineTool`: typed arguments + own validation over a raw dsh
 * `ToolDefinition` (JSON-Schema parameters, canonical JSON output). It mirrors
 * the shape of `@deepseek-ai/dsh-tools`' `defineTool` for the subset we need
 * but is implemented here so the host half keeps zero @deepseek-ai value
 * imports (see ../index.ts).
 */
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'

type ScalarType = 'string' | 'boolean' | 'integer' | 'number'

export interface ParamSpec {
  readonly type: ScalarType
  readonly description?: string
  readonly optional?: true
  readonly enum?: readonly string[]
}

type ValueOf<P extends ParamSpec> =
  P['type'] extends 'string' ? string
    : P['type'] extends 'boolean' ? boolean
      : number

export type ArgsOf<S extends Record<string, ParamSpec>> =
  { [K in keyof S as S[K]['optional'] extends true ? never : K]: ValueOf<S[K]> }
  & { [K in keyof S as S[K]['optional'] extends true ? K : never]?: ValueOf<S[K]> }

export interface LocalToolOptions<S extends Record<string, ParamSpec>> {
  readonly name: string
  readonly description: string
  readonly parameters: S
  /** Output JSON schema (the enforced dsh subset: object/array/scalar roots). */
  readonly output: Record<string, unknown>
  execute(args: ArgsOf<S>, exec: ToolRunContext): Promise<unknown>
}

export class ToolArgsError extends Error {
  override readonly name = 'ToolArgsError'
}

export function validateArgs<S extends Record<string, ParamSpec>>(spec: S, raw: unknown): ArgsOf<S> {
  const args = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const violations: string[] = []
  const out: Record<string, unknown> = {}
  for (const [key, p] of Object.entries(spec)) {
    const value = args[key]
    if (value === undefined || value === null) {
      if (p.optional !== true) violations.push(`${key}: required`)
      continue
    }
    switch (p.type) {
      case 'string':
        if (typeof value !== 'string') violations.push(`${key}: expected string`)
        else if (p.enum !== undefined && !p.enum.includes(value)) violations.push(`${key}: expected one of ${p.enum.join(', ')}`)
        break
      case 'boolean':
        if (typeof value !== 'boolean') violations.push(`${key}: expected boolean`)
        break
      case 'integer':
        if (typeof value !== 'number' || !Number.isInteger(value)) violations.push(`${key}: expected integer`)
        break
      case 'number':
        if (typeof value !== 'number' || !Number.isFinite(value)) violations.push(`${key}: expected number`)
        break
    }
    out[key] = value
  }
  for (const key of Object.keys(args)) if (!(key in spec)) violations.push(`${key}: unknown argument`)
  if (violations.length > 0) throw new ToolArgsError(`invalid arguments: ${violations.join('; ')}`)
  return out as ArgsOf<S>
}

export function defineTool<S extends Record<string, ParamSpec>>(options: LocalToolOptions<S>): ToolDefinition {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const [key, p] of Object.entries(options.parameters)) {
    properties[key] = {
      type: p.type,
      ...(p.description === undefined ? {} : { description: p.description }),
      ...(p.enum === undefined ? {} : { enum: [...p.enum] }),
    }
    if (p.optional !== true) required.push(key)
  }
  return {
    name: options.name,
    description: options.description,
    parameters: { type: 'object', properties, ...(required.length === 0 ? {} : { required }), additionalProperties: false },
    output: {
      schema: options.output,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(raw, exec) {
      const args = validateArgs(options.parameters, raw)
      return options.execute(args, exec)
    },
  }
}
