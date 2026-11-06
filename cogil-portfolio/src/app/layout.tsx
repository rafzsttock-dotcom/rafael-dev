import type { Metadata, Viewport } from "next";
import { Sora, Manrope } from "next/font/google";
import "./globals.css";

const display = Sora({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const body = Manrope({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

const SITE_URL = "https://cogil.dev";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Cogil — Software Engineer & Automation Builder",
    template: "%s · Cogil",
  },
  description:
    "Full Stack Developer and Automation Builder crafting premium, high-performance digital products.",
  keywords: [
    "Software Engineer",
    "Full Stack Developer",
    "Automation",
    "Next.js",
    "Portfolio",
  ],
  authors: [{ name: "Cogil" }],
  creator: "Cogil",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE_URL,
    title: "Cogil — Software Engineer & Automation Builder",
    description:
      "Full Stack Developer and Automation Builder crafting premium digital products.",
    siteName: "Cogil Portfolio",
  },
  twitter: {
    card: "summary_large_image",
    title: "Cogil — Software Engineer & Automation Builder",
    description:
      "Full Stack Developer and Automation Builder crafting premium digital products.",
    creator: "@cogil",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
};

export const viewport: Viewport = {
  themeColor: "#070a1a",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body className="antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-full focus:bg-purple-600 focus:px-4 focus:py-2 focus:text-sm"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
