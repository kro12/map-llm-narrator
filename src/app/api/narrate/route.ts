export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Keep our internal timeout budget below this.
// Vercel's Fluid compute also enabled
export const maxDuration = 60

import { reverseGeocode } from '@/lib/server/geoResolver'
import { getPoisSafe } from '@/lib/server/poiResolver'
import { buildStructuredPrompt } from '@/lib/server/llm/promptBuilder'
import { generateNarration } from '@/lib/server/llm/llmClient'
import type { NarrationOutput } from '@/lib/server/narrationSchema'
import { pickDiverseAttractions, pickDiverseFood } from '@/lib/server/llm/utils'
import { httpDebug } from '@/lib/server/httpDebug'
import { debug } from '@/lib/server/debug'

type NarrateRequest = {
  lat: number
  lon: number
}

const TIMEOUTS = {
  geoMs: 6_000,
  poisMs: 12_000,
  llmMs: 120_000,
  keepAliveMs: 5_000,
}

/**
 * Converts structured JSON output to plain text for UI compatibility.
 * We keep the exact output format the existing UI expects.
 */
function narrationToText(narration: NarrationOutput): string {
  const { introParagraph, detailParagraph, placesToVisit, activities } = narration

  const placesLine = `Places to visit: ${placesToVisit
    .map((p) => `${p.name} (${p.distanceKm.toFixed(1)} km)`)
    .join('; ')}`

  const bullets = [
    `- Walk: ${activities.walk}`,
    `- Culture: ${activities.culture}`,
    `- Food/Drink: ${activities.foodDrink}`,
  ].join('\n')

  return [introParagraph, '', detailParagraph, '', placesLine, '', bullets].join('\n')
}

class StepTimeoutError extends Error {
  constructor(
    public readonly step: string,
    public readonly timeoutMs: number,
  ) {
    super(`${step} timed out after ${timeoutMs}ms`)
    this.name = 'StepTimeoutError'
  }
}

// validate entire request payload
function isValidNarrateRequest(payload: Partial<NarrateRequest>): payload is NarrateRequest {
  const { lat, lon } = payload

  return (
    typeof lat === 'number' &&
    Number.isFinite(lat) &&
    typeof lon === 'number' &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  )
}

function errorDetails(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    }
  }

  return {
    name: 'UnknownError',
    message: String(error),
  }
}

/**
 * Gives each external step a hard deadline.
 *
 * This prevents the route from waiting forever, and supports
 * cancelation of the underlying request.
 * TODO: reverseGeocode/getPoisSafe/generateNarration
 * pass an AbortSignal through to their internal fetch calls.
 */
async function withAbortableTimeout<T>(
  step: string,
  timeoutMs: number,
  task: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController()

  const timer = setTimeout(() => {
    controller.abort(new StepTimeoutError(step, timeoutMs))
  }, timeoutMs)

  try {
    return await task(controller.signal)
  } catch (error) {
    if (controller.signal.aborted) {
      const reason = controller.signal.reason

      if (reason instanceof Error) {
        throw reason
      }

      throw new StepTimeoutError(step, timeoutMs)
    }

    throw error
  } finally {
    clearTimeout(timer)
  }
}

function fallbackGeo(point: { lat: number; lon: number }) {
  const label = `${point.lat.toFixed(4)}, ${point.lon.toFixed(4)}`

  return {
    geo: {
      label,
      shortName: label,
      fineLabel: undefined,
      displayName: label,
      context: 'Coordinates only',
      region: undefined,
      country: undefined,
    },
  } as Awaited<ReturnType<typeof reverseGeocode>>
}

function emptyPois(error: string): Awaited<ReturnType<typeof getPoisSafe>> {
  return {
    cacheHit: false,
    pois: {
      attractions: [],
      food: [],
      warnings: ['POI lookup failed or timed out.'],
      errors: [error],
    },
  }
}

export async function POST(req: Request) {
  const traceId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`

  const log = (
    level: 'info' | 'warn' | 'error',
    message: string,
    data?: Record<string, unknown>,
  ) => {
    httpDebug('api/narrate', level, message, {
      traceId,
      ...data,
    })
  }

  log('info', 'request received', {
    method: req.method,
    url: new URL(req.url).pathname,
    contentType: req.headers.get('content-type'),
  })

  const encoder = new TextEncoder()

  const sseResponse = (stream: ReadableStream) =>
    new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Trace-Id': traceId,
      },
    })

  let payload: Partial<NarrateRequest>

  try {
    payload = (await req.json()) as Partial<NarrateRequest>
  } catch (error) {
    log('error', 'json parse failed', errorDetails(error))

    return sseResponse(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: Invalid JSON body.\n\n'))
          controller.enqueue(encoder.encode('data: END\n\n'))
          controller.close()
        },
      }),
    )
  }

  log('info', 'payload parsed', {
    lat: payload.lat,
    lon: payload.lon,
  })

  if (!isValidNarrateRequest(payload)) {
    return sseResponse(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: Invalid coordinates provided.\n\n'))
          controller.enqueue(encoder.encode('data: END\n\n'))
          controller.close()
        },
      }),
    )
  }

  const { lat, lon } = payload
  const point = { lat, lon }
  /**
   * Return the stream immediately.
   * All slow work now happens inside the stream, so the client gets an early
   * connection instead of waiting silently for reverse geocode / POI / LLM work.
   */
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false

      const write = (chunk: string) => {
        if (closed) return

        try {
          controller.enqueue(encoder.encode(chunk))
        } catch (error) {
          closed = true
          log('warn', 'failed to enqueue SSE chunk', errorDetails(error))
        }
      }

      const comment = (msg: string) => {
        // SSE comments are useful keep-alives and do not become normal message events.
        write(`: ${msg}\n\n`)
      }

      const send = (msg: string) => {
        for (const line of msg.split('\n')) {
          write(`data: ${line}\n`)
        }

        write('\n')
      }

      const close = () => {
        if (closed) return
        closed = true

        try {
          controller.close()
        } catch {
          // Ignore double-close races caused by client disconnects.
        }
      }

      const keepAlive = setInterval(() => {
        comment(`keepalive traceId=${traceId}`)
      }, TIMEOUTS.keepAliveMs)

      const startedAt = performance.now()

      const clientAbortHandler = () => {
        log('warn', 'client aborted request')
        clearInterval(keepAlive)
        close()
      }

      req.signal.addEventListener('abort', clientAbortHandler, { once: true })

      try {
        comment(`connected traceId=${traceId}`)

        /**
         * Step 1: resolve geo + POIs independently.
         *
         * In the old code, Promise.all meant one hung dependency blocked the whole route.
         * Here, POI failure degrades to empty POIs, and geo failure degrades to coordinates.
         */
        debug('api/narrate', 'before geo/pois', { traceId })

        const geoPromise = withAbortableTimeout('reverseGeocode', TIMEOUTS.geoMs, () =>
          reverseGeocode(point),
        ).catch((error) => {
          log('warn', 'reverseGeocode failed; using fallback geo', errorDetails(error))
          return fallbackGeo(point)
        })

        const poisPromise = withAbortableTimeout('getPoisSafe', TIMEOUTS.poisMs, () =>
          getPoisSafe(point),
        ).catch((error) => {
          log('warn', 'getPoisSafe failed; using empty POI fallback', errorDetails(error))
          const message = error instanceof Error ? error.message : String(error)
          return emptyPois(message)
        })

        const [{ geo }, { pois }] = await Promise.all([geoPromise, poisPromise])

        if (req.signal.aborted) return

        debug('api/narrate', 'after geo/pois', {
          traceId,
          attractions: pois.attractions.length,
          food: pois.food.length,
          warnings: pois.warnings ?? [],
        })

        const selectedAttractions = pickDiverseAttractions(pois.attractions)
        const selectedEateries = pickDiverseFood(pois.food)

        /**
         * Send metadata as soon as it is available.
         * This preserves your existing META: payload style.
         */
        send(
          `META:${JSON.stringify({
            traceId,
            label: geo.label ?? geo.shortName,
            context: geo.context,
            fineLabel: geo.fineLabel,
            displayName: geo.displayName,
            region: geo.region,
            country: geo.country,
            lat,
            lon,
            wikiCandidates: [
              geo.label,
              geo.fineLabel,
              geo.shortName,
              geo.region,
              geo.country,
            ].filter(Boolean),
            curatedPOIs: { selectedEateries, selectedAttractions },
            warnings: pois.warnings ?? [],
          })}`,
        )

        const prompt = buildStructuredPrompt({
          geo,
          attractions: selectedAttractions,
          food: selectedEateries,
          requiredPlacesToVisit: 3,
        })

        debug('api/narrate', 'structured prompt length', {
          traceId,
          length: prompt.length,
        })

        const allowedNames = new Set<string>([
          ...selectedAttractions.map((p) => p.name),
          ...selectedEateries.map((p) => p.name),
        ])

        // const hasSelectedPois = selectedAttractions.length > 0 || selectedEateries.length > 0
        const hasEnoughSelectedPois = allowedNames.size >= 3

        debug('api/narrate', 'validation mode', {
          traceId,
          mode: hasEnoughSelectedPois ? 'strict' : 'schema-only',
          selectedAttractions: selectedAttractions.length,
          selectedEateries: selectedEateries.length,
          totalAttractions: pois.attractions.length,
          totalFood: pois.food.length,
        })

        /**
         * Step 2: LLM generation with its own deadline.
         *
         * The old maxRetries: 3 + retryDelayMs: 1000 could silently make a slow
         * request much slower. Keep retries modest and put the whole step behind
         * a route-level timeout.
         */
        debug('api/narrate', 'before generateNarration', { traceId })
        debug('api/narrate', 'selected POI counts', {
          selectedAttractions: selectedAttractions.length,
          selectedEateries: selectedEateries.length,
          allowedNamesCount: allowedNames.size,
          allowedNames: [...allowedNames],
        })
        const llmStartedAt = performance.now()

        const narration: NarrationOutput = await withAbortableTimeout(
          'generateNarration',
          TIMEOUTS.llmMs,
          () =>
            generateNarration(prompt, {
              allowedNames: hasEnoughSelectedPois ? allowedNames : undefined,
              maxRetries: 2,
              retryDelayMs: 500,
            }),
        )

        const llmDurationMs = Math.round(performance.now() - llmStartedAt)

        debug('api/narrate', 'after generateNarration', {
          traceId,
          llmDurationMs,
          placesCount: narration.placesToVisit.length,
        })

        if (req.signal.aborted) return

        send(narrationToText(narration))
        send('END')

        log('info', 'request completed', {
          durationMs: Math.round(performance.now() - startedAt),
          llmDurationMs,
        })

        close()
      } catch (error) {
        log('error', 'stream generation failed', errorDetails(error))

        const errorMsg =
          error instanceof StepTimeoutError
            ? `Sorry - ${error.step} took too long for this location. Please try another point.`
            : error instanceof Error && error.message.toLowerCase().includes('validation')
              ? 'Could not generate a valid response after retries. Please try another location.'
              : 'Sorry - task could not be completed for this location. Please try another point.'

        send(errorMsg)
        send('END')
        close()
      } finally {
        clearInterval(keepAlive)
        req.signal.removeEventListener('abort', clientAbortHandler)
      }
    },
  })

  return sseResponse(stream)
}
