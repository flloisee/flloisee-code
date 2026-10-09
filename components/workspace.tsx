"use client";

import { Chat } from "@/components/chat";
import { ConversationList } from "@/components/conversation-list";
import { Settings } from "@/components/settings";
import {
  useConversations,
  type ConversationBackend,
} from "@/lib/conversations/use-conversations";
import { findEndpoint } from "@/lib/endpoints/registry";
import { selectedModel } from "@/lib/models/selection";
import { useSelection } from "@/lib/selection/use-selection";

/**
 * The saved Conversations beside the chat.
 *
 * This is where the store and the chat meet. The list is on the left and the
 * Conversation on the right, stacked at a narrow width so neither is squeezed
 * into uselessness on a phone.
 *
 * The chat is rendered here rather than passed in as an element or a render
 * function: a function cannot cross the server/client boundary under Cache
 * Components.
 *
 * It is also where the Endpoint and Model are resolved, because both halves of
 * the interface need them and neither owns them: the chat names them in every
 * Request it makes, and the Settings dialog edits them. They were held here
 * rather than in `Chat` because the chat below is remounted on every Conversation
 * switch — that remount is what makes `useChat` adopt a saved Conversation's Turns
 * — and state inside it would be thrown away each time. A reader who chose a
 * Cloud Endpoint and then started a new Conversation would be handed Ollama back.
 *
 * The Model choice stays keyed by Endpoint, so switching back to an Endpoint
 * restores the Model chosen there — that is `ModelSelection`'s own reason for
 * existing, and this is the second place it is needed.
 *
 * Both choices are kept between visits by `useSelection`, which reads them back
 * out of the reader's own storage. They are not held in state here, and that is
 * the whole point: setting an Endpoint up is work, and a reader who has already
 * done it should find it done rather than be handed Ollama again on every visit.
 */
export function Workspace({
  endpointId,
  backend,
}: {
  /** The Endpoint the Conversation opens on, unless one was remembered. */
  endpointId: string;
  /**
   * The store to use, defaulting to the browser's own.
   *
   * Taken as a prop so a test can point the whole path — list, save, reopen —
   * at a database it controls, rather than asserting against jsdom's.
   */
  backend?: ConversationBackend | null;
}) {
  const { conversations, current, ready, available, startNew, open, save, rename, remove } =
    useConversations(backend);

  const {
    endpointId: chosenEndpoint,
    models: selection,
    chooseEndpoint,
    chooseModel: rememberInEndpoint,
  } = useSelection(endpointId);

  const endpoint = findEndpoint(chosenEndpoint);
  const endpointName = endpoint?.name ?? chosenEndpoint;
  const modelId = selectedModel(selection, chosenEndpoint, endpoint?.defaultModelId ?? "");

  function chooseModel(identifier: string) {
    rememberInEndpoint(chosenEndpoint, identifier);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <ConversationList
        conversations={conversations}
        currentId={current.id}
        ready={ready}
        available={available}
        onOpen={(id) => void open(id)}
        onNew={startNew}
        onRename={(id, title) => void rename(id, title)}
        onDelete={(id) => void remove(id)}
        // Rendered here and handed down as the list's footer, because the dialog
        // edits the choice this component resolves for the chat. The list still
        // decides where it sits.
        footer={
          <Settings
            endpointId={chosenEndpoint}
            endpointName={endpointName}
            modelId={modelId}
            onSelectEndpoint={chooseEndpoint}
            onSelectModel={chooseModel}
          />
        }
      />

      {/*
        Keyed on the Conversation id, so opening another one remounts the chat
        and `useChat` adopts the new id and Turns at mount — which is the only
        point at which it reads them. Remounting is also what stops a Response
        streaming into the Conversation the reader just left.

        The id is stable from when the Conversation is started, not minted on
        first write, so saving — including a save that lands while a Response is
        still streaming in — does not change the key and does not disturb the
        stream. Only starting, opening, or deleting changes it.
      */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col" key={current.id}>
        <Chat
          endpointId={chosenEndpoint}
          endpointName={endpointName}
          modelId={modelId}
          conversation={current}
          onSave={save}
          onStartNew={startNew}
        />
      </div>
    </div>
  );
}