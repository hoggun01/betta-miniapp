import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Betta Hatchery",
  description: "Hatch your Betta Egg using your Farcaster wallet",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
