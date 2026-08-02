import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Network",
  description: "A private relationship operating system",
  manifest: "/manifest.webmanifest",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
