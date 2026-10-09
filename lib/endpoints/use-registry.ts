"use client";

import { useEffect, useState } from "react";

import { requestEndpoints, type EndpointAnswer } from "@/lib/endpoints/request";
import { REGISTRY_CHANGED_KEY } from "@/lib/selection/store";

/**
 * The Registry, kept current while the interface is open.
 *
 * Asked once on mount and again whenever anything announces that the Registry has
 * changed — a Credential stored, an Endpoint declared, one forgotten. That
 * broadcast matters more than it looks: without it, adding an Endpoint updates
 * the picker and leaves everything else showing the last answer the server gave,
 * so a reader who picks their new Endpoint sees the old one's name and Model in
 * the header and is told the Conversation is going somewhere it is not.
 *
 * One request shared by the picker and `Workspace` rather than one each. They
 * need the same answer and the two were free to disagree about it, which is the
 * failure the Registry route's own grouping field exists to prevent.
 */

/** What the hook hands back before the first answer arrives. */
const NOT_YET: EndpointAnswer = { statuses: [], trouble: null, declaredTrouble: null };

export function useRegistry(): EndpointAnswer {
  const [answer, setAnswer] = useState<EndpointAnswer>(NOT_YET);

  useEffect(() => {
    let current = true;

    async function read() {
      const next = await requestEndpoints();
      // Guarded rather than awaited in the effect body: an answer that arrives
      // after this component has unmounted is not one to set state with.
      if (current) setAnswer(next);
    }

    void read();

    function changed(event: StorageEvent) {
      // A null key is another window clearing storage outright, which changes
      // the Registry too — the Endpoint that was chosen is no longer offered.
      if (event.key === null || event.key === REGISTRY_CHANGED_KEY) void read();
    }

    window.addEventListener("storage", changed);
    return () => {
      current = false;
      window.removeEventListener("storage", changed);
    };
  }, []);

  return answer;
}
