import type { Metadata } from "next";
import { Fraunces, Geist } from "next/font/google";
import "./globals.css";

/**
 * Geist for reading, Fraunces for headings. Two faces is the limit — a third
 * costs another download on a phone and buys nothing.
 *
 * `next/font` downloads both at build time and serves them from our own
 * domain, so no request ever reaches Google from a visitor's browser.
 */
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
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
      className={`${geistSans.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
