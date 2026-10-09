import { Suspense } from "react";

import { Workspace } from "@/components/workspace";
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
    // One column, ruled down each side, filling the window rather than
    // centred in it. The page is an instrument panel: the Conversation is the
    // whole subject, and the shell is sized by the screen the reader has rather
    // than by a width this file decides — the previous `max-w-5xl` left a third
    // of a wide monitor empty while the conversation beside it ran out of room.
    //
    // The gutter rather than no gutter at all, so the rules have something to
    // mark the edge of. It is small and it does not grow: this is a margin, not
    // a second layout. `mx-*` with no width of its own, because the body is a
    // column flex and this stretches to whatever the margins leave.
    <main className="mx-2 flex min-h-0 flex-1 flex-col border-x border-rule font-sans sm:mx-4">
      {/* The wordmark alone: the Theme is a preference rather than part of any
          Conversation, so it sits in the Settings at the foot of the list
          instead of beside the title. */}
      <header className="flex items-center gap-3 px-4 py-5 sm:px-6">
        {/* The wordmark is the one place the display face appears in the running
            app. Small and grounded — this is a utility that opens on a Local
            Endpoint, not a product page that needs a hero. */}
        <h1 className="min-w-0 font-display text-lg font-semibold tracking-tight text-ink">
          flloisee code
        </h1>
      </header>

      {/* useChat derives its id from Math.random(), which must not be evaluated
          during prerender under Cache Components. */}
      <Suspense
        fallback={<div className="flex-1" aria-busy="true" aria-label="Loading chat" />}
      >
        {/* The chosen Model is shown by the picker rather than here, since it
            changes as soon as the user discovers and picks one. */}
        <Workspace endpointId={endpoint.id} />
      </Suspense>
    </main>
  );
}
