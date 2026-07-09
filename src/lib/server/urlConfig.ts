export function resolveUrl(name: string, fallback: string): string {
  const raw = process.env[name] ?? fallback

  try {
    return new URL(raw).toString()
  } catch {
    throw new Error(`Invalid URL for ${name}: ${raw}`)
  }
}

export function resolveUrlList(name: string, fallbacks: string[]): string[] {
  const raw = process.env[name]

  const candidates = raw
    ? raw
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
    : fallbacks

  const valid: string[] = []

  for (const candidate of candidates) {
    try {
      valid.push(new URL(candidate).toString())
    } catch {
      throw new Error(`Invalid URL in ${name}: ${candidate}`)
    }
  }

  if (valid.length === 0) {
    throw new Error(`No valid URLs configured for ${name}`)
  }

  return valid
}
