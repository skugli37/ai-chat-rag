import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#7c3aed" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1a2e" },
  ],
};

export const metadata: Metadata = {
  title: "Multi-Agent RAG - Neural AI Chat",
  description: "Multi-Agent Neural RAG with 5 AI agents for intelligent conversations. Query analysis, retrieval, reasoning, response synthesis, and self-reflection.",
  keywords: ["AI", "RAG", "Multi-Agent", "Neural Network", "Chat", "LLM", "GLM", "Next.js"],
  authors: [{ name: "AI Chat RAG Team" }],
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Multi-Agent RAG",
  },
  formatDetection: {
    telephone: false,
    date: false,
    address: false,
  },
  icons: {
    icon: "/icons/icon-192x192.png",
    shortcut: "/icons/icon-96x96.png",
    apple: [
      { url: "/icons/icon-152x152.png", sizes: "152x152", type: "image/png" },
      { url: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png" },
    ],
  },
  openGraph: {
    title: "Multi-Agent RAG - Neural AI Chat",
    description: "5 AI agents working together for intelligent conversations",
    url: "https://github.com/skugli37/ai-chat-rag",
    siteName: "Multi-Agent RAG",
    type: "website",
    images: [
      {
        url: "/screenshots/chat.png",
        width: 1280,
        height: 720,
        alt: "Multi-Agent RAG Chat Interface",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Multi-Agent RAG - Neural AI Chat",
    description: "5 AI agents working together for intelligent conversations",
    images: ["/screenshots/chat.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="msapplication-TileColor" content="#7c3aed" />
        <meta name="msapplication-tap-highlight" content="no" />
        <link rel="apple-touch-icon" href="/icons/icon-152x152.png" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
