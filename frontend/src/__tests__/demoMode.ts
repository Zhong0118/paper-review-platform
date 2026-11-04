import { afterEach, beforeEach, vi } from 'vitest'

// Opt in only suites that exercise the demo service; a clean checkout defaults to real mode.
beforeEach(() => { vi.stubEnv('VITE_DEMO_MODE', 'true') })
afterEach(() => { vi.unstubAllEnvs() })
