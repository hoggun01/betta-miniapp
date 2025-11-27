// src/app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";

const APP_URL = "https://bettahatchery.xyz";

export const metadata: Metadata = {
  title: "Betta Hatchery",
  description: "Hatch your Betta Egg using your Farcaster wallet",
  metadataBase: new URL(APP_URL),
  openGraph: {
    title: "Betta Hatchery",
    description: "Hatch your Betta Egg using your Farcaster wallet",
    url: APP_URL,
    siteName: "Betta Hatchery",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Betta Hatchery Miniapp",
      },
    ],
    type: "website",
  },
  icons: {
    icon: "/icon.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/* Basic meta */}
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#020617" />
        {/* No Farcaster embed meta for now */}
      </head>
      <body className="min-h-screen bg-slate-950 text-slate-50 antialiased">
        {children}
      </body>
    </html>
  );
}
