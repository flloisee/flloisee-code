import { Suspense } from "react";

import { Chat } from "@/components/chat";
import { ENDPOINTS } from "@/lib/endpoints/registry";

export default function Home() {
  const endpoint = ENDPOINTS[0];

  return (
    <main className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-4 font-sans">
      <header className="flex flex-col gap-0.5 py-6">
        <h1 className="text-lg font-semibold tracking-tight text-black dark:text-zinc-50">
          {endpoint.name}
        </h1>
      </header>

      {/* useChat derives its id from Math.random(), which must not be evaluated
          during prerender under Cache Components. */}
      <Suspense
        fallback={<div className="flex-1" aria-busy="true" aria-label="Loading chat" />}
      >
        {/* The chosen Model is shown by the picker rather than here, since it
            changes as the user discovers and picks one. */}
        <Chat endpointId={endpoint.id} />
      </Suspense>
    </main>
  );
}