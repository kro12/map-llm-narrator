# Map LLM Guide

[![Next.js](https://img.shields.io/badge/Next.js-14-black)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue)](https://www.typescriptlang.org/)
[![Zustand](https://img.shields.io/badge/State-Zustand-orange)](https://github.com/pmndrs/zustand)
[![MapLibre](https://img.shields.io/badge/Map-MapLibre-green)](https://maplibre.org/)
[![LLM-Qwen](https://img.shields.io/badge/LLM-Qwen2.5--3b--instruct-purple)](https://ollama.com/)

<p align="center">
  <img src="https://github.com/user-attachments/assets/13801969-99db-4b9b-8dc1-6f0e4e660749"
       alt="Map LLM Guide Screenshot"
       width="1100" />
</p>

<br/>

<p align="center">
  <a href="https://map-llm-narrator.vercel.app/">
    <img src="https://img.shields.io/badge/📍_Live_Demo-Open_App-2ea44f?style=for-the-badge" />
  </a>
</p>

<p align="center">
  <sub><i>Try the interactive AI map guide in your browser</i></sub>
</p>

---

## Overview

Map LLM Guide is a full-stack application that:

1. Requires users to zoom in (≥ 13) before interaction is enabled.
2. Allows users to place a marker once sufficiently zoomed.
3. Reverse geocodes the location via Nominatim.
4. Queries OpenStreetMap (Overpass API) for nearby POIs.
5. Curates a diverse subset of high-quality attractions and eateries server-side.
6. Emits curated POIs immediately to the client (META SSE event).
7. Displays animated map markers while inference runs.
8. Builds a strict, structured **facts-only JSON prompt**.
9. Generates validated structured output from a self-hosted Qwen model.
10. Streams results via Server-Sent Events (SSE).
11. Enhances the UI with Wikipedia image lookup and fallback preview snapshots.

This project emphasizes deterministic prompt design, schema validation, hybrid streaming UX, performance tuning on constrained hardware, and clean separation of concerns.

---

## Architecture Overview

High-level request flow:

User  
→ React (MapClient)  
→ Next.js Route `/api/narrate`  
→ reverseGeocode (Nominatim)  
→ getPoisSafe (Overpass + caching + time budgets)  
→ Curate diverse POIs  
→ Emit META (curated POIs)  
→ buildStructuredPrompt (facts-only JSON template)  
→ Qwen (via Ollama, Ubuntu VM)  
→ Extract + Validate JSON (Zod + allowed-name guard)  
→ Retry on failure (max 3 attempts)  
→ Stream back via SSE  
→ Zustand parses stream  
→ Drawer renders structured narration  
→ Map animates curated POI markers

The LLM is hosted on a dedicated Ubuntu VM behind Nginx (TLS, rate limiting, bearer token auth), exposed via a secure HTTPS endpoint consumed only by the backend.

The frontend never communicates directly with the LLM gateway.

---

## Hybrid Streaming + Validation

The system uses SSE for transport but enforces validation server-side.

Under the hood:

- Ollama `/generate` runs with `stream: true`
- The backend collects streamed chunks
- JSON is extracted (supports raw, fenced, or embedded formats)
- Output is validated against a strict Zod schema
- Allowed-name validation prevents hallucinated POIs
- Automatic retry occurs if validation fails

Each SSE run emits:

- `META:{...}` (location metadata + curated POIs)
- Structured narration JSON
- `END` sentinel

This architecture combines streaming UX with deterministic structure.

---

## Prompt Engineering Strategy (Structured JSON)

PromptBuilder constructs a valid JSON template (not pseudo-types):

```json
{
  "introParagraph": "",
  "detailParagraph": "",
  "placesToVisit": [
    { "name": "", "distanceKm": 0 },
    { "name": "", "distanceKm": 0 },
    { "name": "", "distanceKm": 0 }
  ],
  "activities": {
    "walk": "",
    "culture": "",
    "foodDrink": ""
  }
}
```

Rules enforced:

- Output ONLY JSON.
- Use exact place names from DATA block.
- Exactly 3 placesToVisit.
- detailParagraph must reference at least 2 places.
- activities.walk and culture must be generic (no place names).
- activities.foodDrink must reference allowed food POIs or use sentinel fallback.

Validation happens via Zod + additional semantic checks.

---

## Anti-Hallucination Safeguards

The system validates:

- Strict schema structure and length bounds.
- Exactly 3 places to visit.
- Numeric non-negative distances.
- Only allowed place names appear.
- foodDrink references real POIs (or sentinel).
- Generic fallback mode when no POIs exist.

If validation fails → retry up to 3 times.

This prevents structural drift, hallucinated locations, and markdown leakage.

---

## LLM Hosting & Optimization

Hosted on:

- Ubuntu VM (low-resource environment)
- Ollama runtime
- Qwen2.5:3b-instruct-q4_K_M
- Nginx reverse proxy
- TLS (Let's Encrypt)
- Bearer token authentication
- Rate limiting + firewall hardening

CPU-only inference by design.

### Tuned Configuration (Demo Winner)

```bash
LLM_MODEL=qwen2.5:3b-instruct-q4_K_M
LLM_TEMPERATURE=0.15
LLM_NUM_PREDICT=380
LLM_NUM_CTX=3072
LLM_KEEP_ALIVE=30s
LLM_TOP_P=0.9
LLM_REPEAT_PENALTY=1.05
```

Results:

- ~2GB RAM footprint
- 30–45 tokens/sec CPU
- ~53s full demo latency
- Stable JSON without truncation
- Minimal hallucination risk

---

## Performance & Resilience

Improvements include:

- Zoom gating prevents wide-area Overpass queries.
- POI cache with rounded lat/lon (~100m buckets).
- Parallel attraction + food queries with time budgets.
- POIS_BUDGET_MS guard.
- Graceful partial POI fallback.
- Wikipedia image waterfall with preview fallback.
- Defensive SSE parsing and abort handling.

The UI remains stable even if upstream APIs degrade.

---

## Code Organization (Separation of Concerns)

- `app/api/narrate` — orchestration endpoint (META + LLM + SSE)
- `app/api/image/wiki` — image lookup + caching
- `components/MapClient/*` — isolated MapLibre layer (handlers + markers)
- `components/ui/*` — presentation components
- `lib/server/llm/*` — LLM client + prompt builder + utilities
- `lib/server/narrationSchema.ts` — Zod schema + allowed-name validation
- `lib/server/poiResolver.ts` — POI retrieval + strategy + caching
- `store/*` — Zustand SSE lifecycle management
- `shared/*` — shared types
- `utils/*` — UI helpers (highlighting, normalization)

Clear boundaries exist between UI, orchestration, domain logic, and infrastructure.

---

## Running Locally

1. Install dependencies
2. Ensure Ollama is running
3. Pull model:  
   `ollama pull qwen2.5:3b-instruct-q4_K_M`
4. Configure `.env.local`
5. Run:  
   `npm run dev`

Required environment variables:

```bash
LLM_URL=http://localhost:11434/api/generate
TOKEN=your_token
LLM_MODEL=qwen2.5:3b-instruct-q4_K_M
LLM_TEMPERATURE=0.15
LLM_NUM_PREDICT=380
LLM_NUM_CTX=3072
POIS_BUDGET_MS=19000
```

---

## Future Improvements

- GPU-backed inference
- Native JSON schema function calling
- Replace public APIs with production-grade providers
- Token-level telemetry
- Map clustering for dense POI sets
- Richer POI popups

---

## License

MIT
