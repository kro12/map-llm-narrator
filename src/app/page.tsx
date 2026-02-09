"use client";

import { useState } from "react";
import { streamNarration } from "@/lib/client/sse";

export default function Home() {
  const [text, setText] = useState("");

  async function start() {
    setText("");
    await streamNarration((chunk) => {
      if (chunk === "END") return;
      setText((t) => t + " " + chunk);
    });
  }

  return (
    <main className="p-8 space-y-4">
      <button onClick={start} className="px-4 py-2 bg-black text-white rounded">
        Start Narration
      </button>

      <div className="border p-4 min-h-[120px]">{text}</div>
    </main>
  );
}
