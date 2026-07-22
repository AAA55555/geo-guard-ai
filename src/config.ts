import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { msg } from './i18n'

export const PACKAGE_NAME = 'geo-guard-ai'
export const BEGIN_MARKER = `# >>> ${PACKAGE_NAME} begin >>>`
export const END_MARKER = `# <<< ${PACKAGE_NAME} end <<<`

export type GeoGuardConfig = Readonly<{
  allowed: string[]
  timeoutMs: number
  providers: string[]
}>

export type GeoGuardConfigFile = Partial<{
  allowed: string[] | string
  timeoutMs: number
  providers: string[]
}>

export const DEFAULT_CONFIG: GeoGuardConfig = Object.freeze({
  allowed: ['ES'],
  timeoutMs: 5000,
  providers: ['https://ifconfig.co/country-iso', 'https://ipinfo.io/country'],
})

export function configDir(): string {
  if (process.env.GEO_GUARD_CONFIG_DIR) {
    return process.env.GEO_GUARD_CONFIG_DIR
  }
  if (process.platform === 'win32') {
    const base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
    return path.join(base, PACKAGE_NAME)
  }
  const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
  return path.join(xdg, PACKAGE_NAME)
}

export function configPath(): string {
  if (process.env.GEO_GUARD_CONFIG_FILE) {
    return process.env.GEO_GUARD_CONFIG_FILE
  }
  return path.join(configDir(), 'config.json')
}

/** ISO 3166-1 alpha-2 (matches what geo providers return). */
const ISO2 = /^[A-Z]{2}$/

/** Raw country tokens uppercased; does not validate ISO shape. */
export function countryTokens(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(v => String(v).trim().toUpperCase()).filter(Boolean)
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map(v => v.trim().toUpperCase())
      .filter(Boolean)
  }
  return [...DEFAULT_CONFIG.allowed]
}

/** Tokens that are not ISO alpha-2 (e.g. SPAIN, ESP, empty junk). */
export function invalidCountryTokens(value: unknown): string[] {
  return countryTokens(value).filter(code => !ISO2.test(code))
}

/** Valid ISO alpha-2 codes only, deduped. */
export function parseAllowed(value: unknown): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const code of countryTokens(value)) {
    if (!ISO2.test(code) || seen.has(code)) continue
    seen.add(code)
    out.push(code)
  }
  return out
}

export function readConfigFile(): GeoGuardConfigFile {
  const file = configPath()
  if (!fs.existsSync(file)) return {}
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as GeoGuardConfigFile
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(msg().invalidConfig(file, message))
  }
}

/** GEO_GUARD_TIMEOUT is always in seconds → ms. */
export function parseTimeoutSeconds(raw: string): number {
  const seconds = Number(raw)
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return DEFAULT_CONFIG.timeoutMs
  }
  return seconds * 1000
}

/** Normalizes the provider list: to strings, trim, drop empties. */
function normalizeProviders(value: readonly unknown[]): string[] {
  return value.map(v => String(v).trim()).filter(Boolean)
}

/** Priority: env > config.json > defaults. */
export function loadConfig(): GeoGuardConfig {
  const file = readConfigFile()

  // Deliberately !== undefined, not truthy: an empty GEO_GUARD_ALLOWED='' is a
  // conscious "nothing allowed" → allowed=[] → block. A truthy check would
  // silently fall back to the default (fail-open).
  const allowed = process.env.GEO_GUARD_ALLOWED !== undefined
    ? parseAllowed(process.env.GEO_GUARD_ALLOWED)
    : parseAllowed(file.allowed ?? DEFAULT_CONFIG.allowed)

  const timeoutMs = process.env.GEO_GUARD_TIMEOUT
    ? parseTimeoutSeconds(process.env.GEO_GUARD_TIMEOUT)
    : Number(file.timeoutMs ?? DEFAULT_CONFIG.timeoutMs)

  // An empty providers list ([] or empty env) is honored as "no providers" → detect returns null → block.
  let providers: string[]
  if (process.env.GEO_GUARD_PROVIDERS !== undefined) {
    providers = normalizeProviders(process.env.GEO_GUARD_PROVIDERS.trim().split(/\s+/))
  } else if (Array.isArray(file.providers)) {
    providers = normalizeProviders(file.providers)
  } else {
    providers = [...DEFAULT_CONFIG.providers]
  }

  return {
    allowed,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_CONFIG.timeoutMs,
    providers,
  }
}

/**
 * Writes the config, merging with an already existing file.
 * Fields not passed (timeoutMs/providers) are preserved.
 */
export function writeConfig(
  partial: {
    allowed?: string[] | string
    timeoutMs?: number
    providers?: string[]
  } = {},
): { file: string; config: GeoGuardConfig } {
  const dir = configDir()
  fs.mkdirSync(dir, { recursive: true })

  const existing = readConfigFile()

  const next: GeoGuardConfig = {
    allowed:
      partial.allowed !== undefined
        ? parseAllowed(partial.allowed)
        : parseAllowed(existing.allowed ?? DEFAULT_CONFIG.allowed),
    timeoutMs:
      partial.timeoutMs ??
      (typeof existing.timeoutMs === 'number' ? existing.timeoutMs : DEFAULT_CONFIG.timeoutMs),
    providers:
      partial.providers ??
      (Array.isArray(existing.providers) ? existing.providers : [...DEFAULT_CONFIG.providers]),
  }

  const file = configPath()
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`)
  return { file, config: next }
}
