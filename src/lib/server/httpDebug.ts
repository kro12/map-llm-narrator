type DebugLevel = 'info' | 'warn' | 'error'

const DEBUG_API = process.env.DEBUG_API === '1' && process.env.NODE_ENV !== 'production'

export function httpDebug(scope: string, level: DebugLevel, ...args: unknown[]) {
  if (!DEBUG_API) return

  const prefix = `[${scope}]`

  switch (level) {
    case 'info':
      console.log(prefix, ...args)
      break
    case 'warn':
      console.warn(prefix, ...args)
      break
    case 'error':
      console.error(prefix, ...args)
      break
  }
}
