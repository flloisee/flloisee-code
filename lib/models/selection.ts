/**
 * Which Model is chosen in each Endpoint.
 *
 * Keyed by Endpoint rather than held as one value, so switching back and forth
 * does not reset the choice — the difference between comparing two Models on
 * the same question and being unable to.
 *
 * Pure and immutable so the interface can hold it in state and so each
 * Endpoint's choice is exercised without rendering anything.
 */

/** Endpoint id to chosen Model identifier. Endpoints with no entry use their declared default. */
export type ModelSelection = Readonly<Record<string, string>>;

/** Records the Model chosen in one Endpoint, leaving the others untouched. */
export function rememberModel(
  selection: ModelSelection,
  endpointId: string,
  modelId: string,
): ModelSelection {
  const identifier = modelId.trim();

  // An empty Model would be sent to the Endpoint and rejected there, losing the
  // identifier already chosen.
  if (identifier.length === 0) return selection;

  return { ...selection, [endpointId]: identifier };
}

/** The Model to use for an Endpoint: the one chosen, or the one it declares. */
export function selectedModel(
  selection: ModelSelection,
  endpointId: string,
  defaultModelId: string,
): string {
  return selection[endpointId] ?? defaultModelId;
}