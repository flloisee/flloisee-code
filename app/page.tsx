import { Suspense } from "react";

import { Chat } from "@/components/chat";
import { ThemeToggle } from "@/components/theme-toggle";
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
    // One column, ruled top and bottom, centred by width rather than by
    // content. The page is an instrument panel: the Conversation is the whole
    // subject and the shell stays out of its way.
    <main className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col border-x border-rule px-4 font-sans sm:px-6">
      {/* One row at every width. The wordmark is allowed to wrap rather than
          push the row wider than the screen, which is what `min-w-0` buys — so
          the two share a line at 320px without the wordmark being crushed into
          a single word per line. */}
      <header className="flex items-center justify-between gap-3 py-5">
        {/* The chosen Endpoint is named by the picker rather than here, since it
            changes as soon as one is chosen. */}
        {/* The wordmark is the one place the display face appears in the running
            app. Small and grounded — this is a utility that opens on a Local
            Endpoint, not a product page that needs a hero. */}
        <h1 className="min-w-0 font-display text-lg font-semibold tracking-tight text-ink">
          Multi-Endpoint Chat
        </h1>

        {/* The Theme is app chrome rather than part of a Conversation, so it
            sits above the Endpoint and Model pickers rather than beside any
            one of them. */}
        <ThemeToggle />
      </header>

      {/* useChat derives its id from Math.random(), which must not be evaluated
          during prerender under Cache Components. */}
      <Suspense
        fallback={<div className="flex-1" aria-busy="true" aria-label="Loading chat" />}
      >
        {/* The chosen Model is shown by the picker rather than here, since it
            changes as soon as the user discovers and picks one. */}
        <Chat endpointId={endpoint.id} />
      </Suspense>
    </main>
  );
}
