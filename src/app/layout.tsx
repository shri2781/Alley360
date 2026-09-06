import type { Metadata, Viewport } from "next";
import { Inter, Anton } from "next/font/google";
import { getVenue } from "../server/venue";
import "./globals.css";

// Self-hosted by next/font -- no request to Google at runtime, no layout shift.
const inter = Inter({ subsets: ["latin"], variable: "--font-body" });
const anton = Anton({ subsets: ["latin"], weight: "400", variable: "--font-display" });

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0d0817",
};

// Dynamic because the venue name is a DB value, not a compile-time constant.
// Previously this was the static staff-dashboard title ("Lane Board"), served to
// every customer landing on "/" too -- /staff/layout.tsx now sets its own title.
export async function generateMetadata(): Promise<Metadata> {
  const venue = await getVenue();
  return {
    title: {
      default: `${venue.name} — Book a Bowling Lane`,
      template: `%s · ${venue.name}`,
    },
    description: `Book a bowling lane at ${venue.name} in seconds. Real availability, no phone calls -- pick your players, your package, and a time that works.`,
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${anton.variable}`}>
      <body>{children}</body>
    </html>
  );
}
