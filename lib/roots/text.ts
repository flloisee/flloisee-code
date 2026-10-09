/**
 * Telling text from bytes, and giving text the line numbers a reader needs.
 *
 * `read_file` shows a file and `search_files` looks through one, so both have to
 * answer the same two questions first — or answer them differently. They live
 * here so there is one answer, and so the walk that offers files to both of them
 * can rule out the bytes it will not hand over rather than each caller ruling
 * them out again after they have been opened.
 */

/**
 * Whether these bytes are something other than text.
 *
 * The whole file is judged rather than a prefix of it, which a short sample
 * would be quicker for. The read cap bounds the work, and a file whose first few
 * kilobytes are clean and whose middle is not is a file that would put mangled
 * content in the transcript — the exact failure this check exists to prevent.
 *
 * Two tests, both of which git also uses, and both of which catch a different
 * thing. A null byte is how every binary format this app will meet encodes its
 * structure — a UTF-16 file is full of them — and it cannot appear in text by
 * accident. Bytes that will not decode as UTF-8 are a second encoding entirely,
 * such as the Latin-1 a machine with older files still has.
 *
 * Decoding is strict, and that is the half that matters: a lenient decoder
 * replaces an undecodable byte with `�` and hands back a string that looks like
 * text. That string is what would end up quoted back to the reader.
 */
export function looksBinary(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return true;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return false;
  } catch {
    return true;
  }
}

/** The bytes as a string. Only ever called on bytes `looksBinary` has cleared. */
export function asText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/**
 * The text as lines, the way a text editor counts them.
 *
 * Split on a line feed, then drop the empty piece a file's final newline leaves
 * behind — a file ending in a newline has as many lines as it has newline
 * characters, not one more. A carriage return at the end of a line is dropped,
 * so a file written on Windows does not show one at the end of every line.
 *
 * A file of nothing at all is zero lines, which is what makes an empty file an
 * empty answer rather than one line of nothing.
 */
export function toLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
}

/**
 * The lines with the number each has in the file, as `12: the text`.
 *
 * A colon rather than a tab, because that is what `grep -n` prints and a Model
 * has read a great many of them: the number is unambiguously the first thing on
 * the line and it is never confused with the file's own punctuation. Not padded,
 * either — padding is for a column a reader is looking down, and here the number
 * is something to be quoted back in an answer rather than something to line up.
 *
 * The number is taken from `startLine` rather than counted from one, which is the
 * whole point of an offset: a Model that read lines 2000 to 2002 has to be able
 * to say "line 2001", and a reader then has to be able to find it in the file
 * rather than in the transcript.
 */
export function withLineNumbers(lines: string[], startLine: number): string[] {
  return lines.map((line, index) => `${startLine + index}: ${line}`);
}
