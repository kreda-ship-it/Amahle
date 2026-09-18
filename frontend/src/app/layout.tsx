import type { Metadata } from "next";
import { Cormorant_Garamond, Jost } from "next/font/google";
import "./globals.css";

/**
 * Jost for reading, Cormorant Garamond for headings. Two faces is the limit —
 * a third costs another download on a phone and buys nothing.
 *
 * Cormorant is a Garamond: old-style, high stroke contrast, and unusually
 * light for a serif. Set large and at weight 300 it is where nearly all of
 * the elegance in this design comes from — the same words in a heavy sans
 * read as confident, which is a different thing.
 *
 * Jost underneath it is a geometric sans in the Futura line: circular bowls,
 * even strokes, no personality of its own to argue with the headings.
 *
 * Cormorant is optically small — a 48px Cormorant looks nearer 36px — so
 * every heading in the site is set a size or two larger than it would be in
 * a sans. That is a property of the face, not a mistake to correct.
 *
 * `next/font` downloads both at build time and serves them from our own
 * domain, so no request ever reaches Google from a visitor's browser.
 */
const jost = Jost({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

/*
 * Cormorant Garamond is not a variable font, so the weights have to be named.
 * Three of them: 300 for the big headings, 400 for smaller ones, 500 where a
 * heading sits directly on a hairline and needs the extra weight to hold.
 */
const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  weight: ["300", "400", "500"],
  subsets: ["latin"],
});

/**
 * The fallback title, used by pages outside the public site — /login and
 * /staff. The salon's own name is set by the public layout, from the
 * database, because this file must not know which salon it is serving.
 */
export const metadata: Metadata = {
  title: "Amahle",
  description:
    "Amahle — online booking and business management for beauty businesses.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${jost.variable} ${cormorant.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
