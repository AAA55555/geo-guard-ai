import type { GeoGuardConfig } from './config'
import { loadConfig } from './config'
import { USER_AGENT } from './user-agent'

export async function fetchCountry(url: string, timeoutMs: number): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: 'text/plain',
        'user-agent': USER_AGENT,
      },
      redirect: 'follow',
    })
    if (!response.ok) return null
    const raw = (await response.text()).trim()
    if (!/^[A-Za-z]{2}$/.test(raw)) return null
    return raw.toUpperCase()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** ISO country or null. Providers race: the first valid answer wins. No cache — the check is always fresh. */
export async function detectCountry(config: GeoGuardConfig = loadConfig()): Promise<string | null> {
  if (config.providers.length === 0) return null

  try {
    return await Promise.any(
      config.providers.map(url =>
        fetchCountry(url, config.timeoutMs).then(country => {
          if (!country) {
            return Promise.reject(new Error(`no country from ${url}`))
          }
          return country
        }),
      ),
    )
  } catch {
    return null
  }
}

export function isAllowed(country: string | null | undefined, config: GeoGuardConfig = loadConfig()): boolean {
  if (!country) return false
  return config.allowed.includes(country.toUpperCase())
}
