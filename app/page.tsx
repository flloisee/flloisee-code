import { Suspense } from "react";

import { Chat } from "@/components/chat";
import { LOCAL_ENDPOINTS } from "@/lib/endpoints/registry";

export default function Home() {
  // A Local Endpoint opens the Conversation: it needs no Credential, so the app
  // is usable the moment a server is running. The Endpoint picker offers the rest
  // of the Registry alongside it.
  //
  // Read from LOCAL_ENDPOINTS rather than ENDPOINTS[0], which would work only
  // for as long as the Registry happened to list Local Endpoints first. Naming
  // the source says which kind of Endpoint is wanted and fails loudly if the
  // Local Endpoints are ever all removed, rather than silently opening on
  // whichever Cloud Endpoint happened to sort first.
  const endpoint = LOCAL_ENDPOINTS[0];

  return (
    <main className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-4 font-sans">
      <header className="flex flex-col gap-0.5 py-6">
        {/* The chosen Endpoint is named by the picker rather than here, since it
            changes as soon as one is chosen. */}
        <h1 className="text-lg font-semibold tracking-tight text-black dark:text-zinc-50">
          Multi-Endpoint Chat
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