import type { Metadata } from "next";
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

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
