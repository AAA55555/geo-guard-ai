import fs from 'node:fs'
import path from 'node:path'

/** Version from package.json (in dist/ it sits one level up). */
export function packageVersion(): string {
  try {
    const pkgPath = path.join(__dirname, '..', 'package.json')
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string }
    return pkg.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}
