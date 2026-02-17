import type { StoreApi } from 'zustand'

// example usage:
// snap = __narrationRecorder__.export()
// __narrationRecorder__.import(snap)
export function attachZustandRecorder<T extends object, S extends object>(
  store: StoreApi<T>,
  pick: (state: T) => S,
  opts?: { max?: number; key?: string },
) {
  const max = opts?.max ?? 200
  const key = opts?.key ?? '__zustand_snapshots__'

  const snapshots: S[] = []

  const safeClone = (v: S): S => JSON.parse(JSON.stringify(v)) as S

  const unsub = store.subscribe((state) => {
    const slice = pick(state)
    snapshots.push(safeClone(slice))
    if (snapshots.length > max) snapshots.shift()
    ;(globalThis as unknown as Record<string, unknown>)[key] = snapshots
  })

  return {
    export(): string {
      return JSON.stringify(snapshots[snapshots.length - 1] ?? null, null, 2)
    },
    exportAll(): string {
      return JSON.stringify(snapshots, null, 2)
    },
    import(json: string) {
      const next = JSON.parse(json) as S
      // Merge slice back into store; doesn't touch actions.
      store.setState(next as unknown as Partial<T>, false)
    },
    resetTo(indexFromEnd: number) {
      const idx = snapshots.length - 1 - indexFromEnd
      const snap = snapshots[idx]
      if (!snap) return
      store.setState(snap as unknown as Partial<T>, false)
    },
    stop() {
      unsub()
    },
  }
}
