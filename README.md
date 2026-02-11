# Map LLM Guide

[![Next.js](https://img.shields.io/badge/Next.js-14-black)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue)](https://www.typescriptlang.org/)
[![Zustand](https://img.shields.io/badge/State-Zustand-orange)](https://github.com/pmndrs/zustand)
[![MapLibre](https://img.shields.io/badge/Map-MapLibre-green)](https://maplibre.org/)
[![LLM-Qwen](https://img.shields.io/badge/LLM-Qwen2.5--3b--instruct-purple)](https://ollama.com/)

An interactive, streaming, map-based AI guide that generates structured, location-aware narration using a self-hosted LLM and public geospatial APIs.

Live demo:  
https://map-llm-narrator.vercel.app/

---

## Overview

Map LLM Guide is a full-stack application that:

1. Accepts a coordinate from a map interaction (right-click or long-press).
2. Reverse geocodes the location via Nominatim.
3. Queries OpenStreetMap (Overpass API) for nearby POIs.
4. Builds a strict, structured prompt (“DATA (facts only)”).
5. Streams a response from a self-hosted Qwen model.
6. Renders narration incrementally via Server-Sent Events.
7. Enhances the UI with Wikipedia image lookup and fallbacks.

The project focuses on architectural clarity, deterministic prompt design, streaming UX, resilience to failure, and clear separation of server/client responsibilities.

---

## Architecture Overview

High-level request flow:

User  
→ React (MapClient)  
→ Next.js Route `/api/narrate`  
→ reverseGeocode (Nominatim)  
→ getPoisSafe (Overpass)  
→ buildFactPacketPrompt  
→ Qwen (via Ollama, Ubuntu VM)  
→ Stream back via SSE  
→ Zustand store parses stream  
→ Drawer renders incrementally

The LLM is hosted on a dedicated Ubuntu VM behind Nginx (TLS, rate limiting, bearer token auth), exposed via a secure HTTPS endpoint consumed only by the backend.

Frontend never communicates directly with the LLM gateway.

---

## Technology Stack

### Frontend

- Next.js (App Router)
- React 18
- TypeScript (strict mode)
- Zustand (state management)
- MapLibre GL
- MUI (lightweight UI components)

### Backend

- Next.js Route Handlers
- Ollama (self-hosted)
- Qwen2.5:7b-instruct
- Nominatim (reverse geocoding)
- Overpass API (POI retrieval)
- Wikipedia REST API (image summaries)

---

## LLM Hosting

The LLM endpoint for this demo was provisioned and configured from scratch:

- Ubuntu VM (Hetzner)
- Ollama installed and configured
- Qwen model pulled locally
- Nginx reverse proxy configured
- TLS via Let’s Encrypt
- Bearer-token authentication enforced at the proxy
- Request rate limiting configured
- Firewall hardened
- Daily model warm-up cron to reduce cold-start latency
- Log rotation configured for operational hygiene

The environment is intentionally low-spec and GPU-free.  
Slower inference is expected and acceptable for demonstration purposes.

---

## Prompt Engineering Strategy

The system enforces structure through:

- A strict “DATA (facts only)” block.
- Explicit formatting rules.
- Explicit prohibition of headings (e.g., “First paragraph”).
- Deterministic output constraints.

Rather than post-processing model output heavily, structure is enforced at prompt time.

This reduces hallucination risk and improves structural consistency.

---

## Streaming Design

Server-Sent Events (SSE) were chosen over EventSource or WebSockets because:

- We require POST-based streaming.
- We emit structured control messages (META payload).
- We need fine-grained buffering control.

Each stream emits:

- `META:{...}` (structured metadata for UI)
- Incremental text chunks
- `END` sentinel

Zustand processes these events and updates the UI incrementally.

---

## Failure Handling & Resilience

Public APIs are free-tier and occasionally flaky.

Mitigations include:

- Safe wrappers around Overpass (never throw upstream).
- Timeout protection.
- Fallback Wikipedia title candidates.
- Graceful SSE error fallback messages.
- AbortController integration.
- Defensive SSE parsing.
- Map image snapshot fallback if Wikipedia image fails.

The system remains stable even when upstream APIs degrade.

---

## Observability & Debugging

Instrumentation includes:

- Timing wrappers for external API calls.
- Prompt length logging.
- Cache hit/miss visibility.
- Stream lifecycle logging.
- Overpass failure tracing.
- Warm-up logging for Ollama.

This enables analysis of latency contributions from:

- Reverse geocoding
- POI retrieval
- LLM inference
- Streaming duration

---

## Code Organization

/api/narrate

- Orchestrates reverse geocode + POI retrieval
- Builds prompt
- Streams LLM response via SSE
- Emits structured META payload

/api/image/wiki

- Attempts ordered title candidates
- Returns image or null
- 24h revalidation

/lib/server

- geoResolver
- poiResolver
- promptBuilder
- qwenClient
- debug utilities

/lib/store

- Zustand store
- SSE parsing
- Abort lifecycle management
- Run lifecycle tracking

/components

- MapClient
- Drawer UI
- Streaming animation

---

## Design Tradeoffs

### SSE vs WebSockets

SSE chosen for simplicity and HTTP semantics.  
WebSockets could provide:

- Bi-directional control
- Token-level streaming
- Multi-user coordination

### Strict Prompt vs Output Sanitization

Prompt-level enforcement chosen over heavy regex cleanup for determinism.

### Free APIs vs Paid Services

Free APIs were intentionally used for demo transparency.  
In production, paid providers would increase stability.

---

## Mobile Support

- Long-press to generate narration.
- Responsive drawer.
- Automatic map pan adjustment.
- No hover-based interaction dependencies.

---

## Performance Notes

- CPU-only inference means noticeable cold-start latency.
- Warm-up cron keeps model loaded for 24h.
- Overpass occasionally returns 504.
- Wikipedia image API sometimes returns null.

All failure cases are handled gracefully.

---

## Initial POC

Early experimentation and prompt iteration were conducted in CodeSandbox before moving to a full self-hosted infrastructure setup.

---

## Running Locally

1. Install dependencies
2. Ensure Ollama is running
3. Pull model:  
   `ollama pull qwen2.5:7b-instruct`
4. Configure environment variables
5. Run:  
   `npm run dev`

---

## Future Improvements

- GPU-backed inference
- Structured JSON schema enforcement
- Replace free APIs with stable providers
- Token-level streaming telemetry
- Deterministic function-calling outputs

---

## License

MIT
