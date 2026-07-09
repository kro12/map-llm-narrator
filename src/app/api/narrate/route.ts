export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The Hetzner-hosted local LLM can legitimately take 90–150s.
// Keep maxDuration above TIMEOUTS.llmMs plus resolver overhead.
// Vercel Fluid Compute should be enabled for this route.
export const maxDuration = 180

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

const REQUIRED_PLACES_TO_VISIT = 3

const TIMEOUTS = {
  geoMs: 6_000,
  poisMs: 12_000,
  // The Hetzner-hosted LLM can be slow, especially on cold starts or retries.
  // Keep this below maxDuration after allowing ~20–30s for geo/POI work and overhead.
  llmMs: 150_000,
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

// Validate the entire request payload so TypeScript narrows both lat and lon.
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
 * Runs an async step with a hard deadline and an AbortSignal.
 *
 * The timeout rejects the wrapper promise even if the underlying task does not
 * yet honour AbortSignal. If the task does pass the signal into fetch(), the
 * upstream request is also cancelled rather than continuing in the background.
 */
async function withAbortableTimeout<T>(
  step: string,
  timeoutMs: number,
  task: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController()

  let timer: ReturnType<typeof setTimeout> | undefined

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new StepTimeoutError(step, timeoutMs)
      controller.abort(error)
      reject(error)
    }, timeoutMs)
  })

  try {
    return await Promise.race([task(controller.signal), timeoutPromise])
  } finally {
    if (timer) clearTimeout(timer)
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
         * Promise.all is still fine because each resolver is wrapped in its own
         * timeout and fallback. One failed resolver no longer blocks the whole route.
         */
        debug('api/narrate', 'before geo/pois', { traceId })

        const resolverWarnings: string[] = []
        const resolverErrors: string[] = []

        const geoPromise = withAbortableTimeout('reverseGeocode', TIMEOUTS.geoMs, () =>
          reverseGeocode(point),
        ).catch((error) => {
          const message = error instanceof Error ? error.message : String(error)

          resolverWarnings.push('Reverse geocode failed; using coordinates only.')
          resolverErrors.push(`reverseGeocode: ${message}`)

          log('warn', 'reverseGeocode failed; using fallback geo', errorDetails(error))

          return fallbackGeo(point)
        })

        const poisPromise = withAbortableTimeout('getPoisSafe', TIMEOUTS.poisMs, (signal) =>
          getPoisSafe(point, { signal }),
        ).catch((error) => {
          const message = error instanceof Error ? error.message : String(error)

          resolverWarnings.push('POI lookup failed; continuing without nearby places.')
          resolverErrors.push(`getPoisSafe: ${message}`)

          log('warn', 'getPoisSafe failed; using empty POI fallback', errorDetails(error))

          return emptyPois(message)
        })

        const [geoResult, poiResult] = await Promise.all([geoPromise, poisPromise])

        if (req.signal.aborted) return

        const { geo } = geoResult
        const { pois, cacheHit: poiCacheHit } = poiResult

        debug('api/narrate', 'after geo/pois', {
          traceId,
          geoLabel: geo.label,
          geoContext: geo.context,
          poiCacheHit,
          attractions: pois.attractions.length,
          food: pois.food.length,
          warnings: [...resolverWarnings, ...(pois.warnings ?? [])],
          errors: [...resolverErrors, ...(pois.errors ?? [])],
        })

        const selectedAttractions = pickDiverseAttractions(pois.attractions)
        const selectedEateries = pickDiverseFood(pois.food)

        const hasResolvedGeo = geo.context !== 'Coordinates only'
        const hasAnyPois = pois.attractions.length > 0 || pois.food.length > 0
        const hasSelectedPois = selectedAttractions.length > 0 || selectedEateries.length > 0

        const warnings = [...resolverWarnings, ...(pois.warnings ?? [])]
        const errors = [...resolverErrors, ...(pois.errors ?? [])]

        debug('api/narrate', 'data quality', {
          traceId,
          hasResolvedGeo,
          hasAnyPois,
          hasSelectedPois,
          geoLabel: geo.label,
          geoContext: geo.context,
          poiCacheHit,
          attractions: pois.attractions.length,
          food: pois.food.length,
          selectedAttractions: selectedAttractions.length,
          selectedEateries: selectedEateries.length,
          warnings,
          errors,
        })

        /**
         * Send metadata as soon as resolver work has completed.
         * This preserves your existing META: payload style while exposing enough
         * debug information to identify geo/POI failures from the client stream.
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
            warnings,
            debug: {
              geoResolved: hasResolvedGeo,
              poiCacheHit,
              poiCounts: {
                attractions: pois.attractions.length,
                food: pois.food.length,
                selectedAttractions: selectedAttractions.length,
                selectedEateries: selectedEateries.length,
              },
              resolverErrors: errors,
            },
          })}`,
        )

        /**
         * If both resolvers failed/degraded, do not send weak empty data to the LLM.
         * This makes it clear that the failure is in the location-data layer rather
         * than the narration/model layer.
         */
        if (!hasResolvedGeo && !hasAnyPois) {
          send(
            `I could not resolve this location or find nearby places. This looks like a location-data issue rather than a narration issue. Please try again shortly. Trace ID: ${traceId}`,
          )
          send('END')
          close()
          return
        }

        const prompt = buildStructuredPrompt({
          geo,
          attractions: selectedAttractions,
          food: selectedEateries,
          requiredPlacesToVisit: REQUIRED_PLACES_TO_VISIT,
        })

        debug('api/narrate', 'structured prompt length', {
          traceId,
          length: prompt.length,
        })

        const allowedNames = new Set<string>([
          ...selectedAttractions.map((p) => p.name),
          ...selectedEateries.map((p) => p.name),
        ])

        const hasEnoughSelectedPois = allowedNames.size >= REQUIRED_PLACES_TO_VISIT

        debug('api/narrate', 'validation mode', {
          traceId,
          mode: hasEnoughSelectedPois ? 'strict' : 'schema-only',
          selectedAttractions: selectedAttractions.length,
          selectedEateries: selectedEateries.length,
          totalAttractions: pois.attractions.length,
          totalFood: pois.food.length,
        })

        debug('api/narrate', 'selected POI counts', {
          traceId,
          selectedAttractions: selectedAttractions.length,
          selectedEateries: selectedEateries.length,
          allowedNamesCount: allowedNames.size,
          allowedNames: [...allowedNames],
        })

        /**
         * Step 2: LLM generation with its own deadline.
         *
         * The LLM client should pass this AbortSignal into its internal fetch(), so
         * a timed-out generation does not keep running after the route has failed.
         */
        debug('api/narrate', 'before generateNarration', { traceId })

        const llmStartedAt = performance.now()

        const narration: NarrationOutput = await withAbortableTimeout(
          'generateNarration',
          TIMEOUTS.llmMs,
          (signal) =>
            generateNarration(prompt, {
              allowedNames: hasEnoughSelectedPois ? allowedNames : undefined,
              maxRetries: 2,
              retryDelayMs: 500,
              signal,
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

        let errorMsg =
          'Sorry - task could not be completed for this location. Please try another point.'

        if (error instanceof StepTimeoutError) {
          errorMsg = `Sorry - ${error.step} took too long for this location. Please try again shortly.`
        } else if (error instanceof Error && error.message.includes('HTTP 401')) {
          errorMsg = 'The narration model rejected the request due to an authentication issue.'
        } else if (error instanceof Error && error.message.toLowerCase().includes('validation')) {
          errorMsg = 'The narration model returned an invalid response. Please try again.'
        } else if (error instanceof Error && error.message.toLowerCase().includes('aborted')) {
          errorMsg = 'The narration request was cancelled before it completed.'
        }

        send(`${errorMsg} Trace ID: ${traceId}`)
        if (process.env.NARRATE_DEBUG_CLIENT === '1') {
          const internalError =
            error instanceof Error ? `${error.name}: ${error.message}` : String(error)

          send(`DEBUG:${internalError}`)
        }

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
