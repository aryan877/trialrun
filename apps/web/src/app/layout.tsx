import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Instrument_Sans } from "next/font/google";

import "./globals.css";

import { cn } from "@/lib/utils";

const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  variable: "--font-trialrun-sans",
  display: "swap",
});
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-trialrun-mono",
  display: "swap",
});
const publicSans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-trialrun-public",
  display: "swap",
});

export const metadata: Metadata = {
  title: "TrialRun — Test the change, not the claim",
  description: "Evidence-backed pull request reviews in disposable Zerops environments.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={cn("dark font-sans", sans.variable, mono.variable, publicSans.variable)}
    >
      <body>{children}</body>
    </html>
  );
}
