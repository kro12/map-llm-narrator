"use client";

import { useNarrationStore } from "@/lib/store/narrationStore";

export default function Home() {
  const { status, text, error, startNarration, cancelNarration, reset } =
    useNarrationStore();

  return (
    <main className="p-8 space-y-4 max-w-2xl">
      <h1 className="text-2xl font-semibold">Map-based LLM Narration Demo</h1>

      <div className="flex gap-2">
        <button
          onClick={() => void startNarration()}
          className="px-4 py-2 bg-black text-white rounded disabled:opacity-50"
          disabled={status === "streaming"}
        >
          {status === "streaming" ? "Streaming…" : "Start Narration"}
        </button>

        <button
          onClick={cancelNarration}
          className="px-4 py-2 border rounded disabled:opacity-50"
          disabled={status !== "streaming"}
        >
          Cancel
        </button>

        <button onClick={reset} className="px-4 py-2 border rounded">
          Reset
        </button>
      </div>

      <div className="border rounded p-4 min-h-[140px] whitespace-pre-wrap">
        {error
          ? `Error: ${error}`
          : text || "Click Start Narration to test SSE."}
      </div>

      <div className="text-sm opacity-70">Status: {status}</div>
    </main>
  );
}
