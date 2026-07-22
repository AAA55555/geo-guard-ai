import { PACKAGE_NAME } from './config'
import { packageVersion } from './pkg'

/** User-Agent for geo providers (some reject clients without a UA). */
export const USER_AGENT = `${PACKAGE_NAME}/${packageVersion()}`
