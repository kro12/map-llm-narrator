export function normalizeNarration(s: string) {
  // Convert CRLF, then remove indentation that appears after blank lines.
  // (This fixes the "        Visit..." style output.)
  return s
    .replace(/\r\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n') // kill leading whitespace after any newline
    .trim()
}
