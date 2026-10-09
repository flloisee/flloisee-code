/**
 * What the Model is told about reading, and only when there is a Root to read.
 *
 * Sent on the same condition as the Tools themselves. A reader who has declared
 * no Root gets a Turn that is exactly the v1 Turn, and a Conversation that
 * carries no talk of files it cannot reach — which is also what keeps the cost
 * of this feature at zero for someone who never uses it, and what keeps the v1
 * tests testing v1.
 *
 * The tools' own descriptions say what each call takes. These instructions say
 * the two things descriptions cannot:
 *
 *   - **that a refusal is an answer.** `ok: false` comes back as an ordinary
 *     result with a sentence in it, and a Model that reads it as a failure will
 *     try the next thing. It is told to say what it could not read and move on.
 *   - **that a refusal is final.** Nothing prompts the Model to try again, so
 *     without being told, a small local Model that has just been refused tends
 *     to reach for `search_files`, then for an absolute path, then for the
 *     original call again — burning the step limit on a decision the reader
 *     already made. So it is told plainly: never again for that path, and never
 *     by another route.
 *
 * Kept short on purpose. Every Turn pays for this twice over — once in the
 * prompt and once in the answer — and a small local Model reads a paragraph
 * about its tools less well than it reads a line about one.
 */
export const READING_INSTRUCTIONS = [
  "You can read files on this machine through three tools: `list_files` for what is in a folder, `read_file` for the contents of one file, and `search_files` for which files and lines hold some text. Use them rather than asking the reader to paste something, and say which files your answer is based on.",
  "Paths are relative to the folder the reader shared. `read_file` returns at most 2000 lines at a time and tells you which line to pass as `offset` for the rest, so read a long file in pieces rather than once.",
  "These tools only read. They cannot change, move or delete anything, and they will not read outside the folder the reader shared.",
  "A result saying `ok: false` is an answer rather than a failure. Say what you could not read and carry on. Never call a tool again for a path that was refused or denied, and never look for that file another way: the refusal is the reader's decision.",
].join("\n\n");
