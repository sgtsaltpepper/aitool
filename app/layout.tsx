import type { Metadata } from "next";
import Link from "next/link";

import "./globals.css";

export const metadata: Metadata = {
  title: "AI SEO Audit",
  description: "Auditverktøy for AI-bot-optimalisering, SEO og innholdsstruktur.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="nb">
      <body>
        <div className="shell">
          <header className="topbar">
            <Link href="/" className="brand">
              <span className="brand-mark">A</span>
              <span>
                <strong>AI SEO Audit</strong>
                <small>for ChatGPT, Gemini, Copilot, Perplexity og flere</small>
              </span>
            </Link>
          </header>
          <main className="page">{children}</main>
        </div>
      </body>
    </html>
  );
}
