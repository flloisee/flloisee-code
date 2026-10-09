import type { Metadata } from "next";
import { Geist, Geist_Mono, Space_Grotesk } from "next/font/google";

import { THEME_STORAGE_KEY } from "@/lib/theme";

import "./globals.css";

/**
 * Three faces, which is the ceiling: a display, a body, and a mono register.
 *
 * Space Grotesk carries the display moments only — the wordmark and the
 * Credential dialog's heading. Its slightly mechanical geometry is what makes
 * the interface read as an instrument panel rather than a chat toy, and it
 * would be wrong everywhere else: this app's dominant text is a Conversation
 * being read, and a display face is the wrong face for that job.
 *
 * Geist stays the body. It was already loaded, it is the better reading face
 * of the two candidates Cobalt allows, and keeping it means the app ships one
 * fewer font file than swapping it for Inter would have.
 *
 * Geist Mono stays the outlier: field names, Model identifiers, and the
 * environment-variable names Key Entry reports. It is a register, not a third
 * body — it never appears in running prose.
 */
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

/**
 * Puts the stored Theme in force before the first paint.
 *
 * Without this the page renders in the system Theme, then React mounts and
 * corrects it — a visible flash of the wrong colours for anyone who has chosen
 * a Theme that differs from their system setting, which is precisely the
 * reader who chose one. The Theme is held in a custom property the stylesheet
 * reads, so all this has to do is set one attribute on the root element.
 *
 * It has to be inline and it has to be here, at the top of the body: an
 * external script would be fetched and run after the first paint, and one
 * placed later in the document would run after the elements above it have
 * already been painted. Inlining is what makes it synchronous and immediate.
 *
 * Every step is defensive, because this runs before anything else exists to
 * catch a mistake in it: storage access throws in a browser that has blocked
 * it, and a stored value may have been written by a version of the app that
 * offered other Themes — one that followed the system, say. Anything not
 * recognised falls through to light, which is also what the stylesheet does
 * when the attribute is absent.
 *
 * The two accepted values are written out rather than read from `THEMES`,
 * because serialising the array into the page would ship the list to the
 * browser to check two strings against. `isTheme` is the same rule for the
 * TypeScript side; this is the same rule for the other one.
 */
const APPLY_STORED_THEME = `(function(){var t="light";try{var s=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(s==="light"||s==="dark"){t=s;}}catch(e){}document.documentElement.setAttribute("data-theme",t);})();`;

export const metadata: Metadata = {
  title: "flloisee code",
  description: "Hold a Conversation with whichever AI Endpoint you point it at.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // `suppressHydrationWarning` because the script above adds `data-theme` to
    // this element before React hydrates and reads it. React did not render
    // that attribute and is not going to, so the mismatch is expected rather
    // than a fault — and it is confined to this one element.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${spaceGrotesk.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <script dangerouslySetInnerHTML={{ __html: APPLY_STORED_THEME }} />
        {children}
      </body>
    </html>
  );
}
