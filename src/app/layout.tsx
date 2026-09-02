import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lane Board",
  description: "Staff lane dashboard for the bowling scheduler",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
