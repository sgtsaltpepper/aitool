import type { Metadata } from "next";
import Link from "next/link";

import "./globals.css";

export const metadata: Metadata = {
  title: "AI SEO Audit",
  description: "Auditverktøy for AI-bot-optimalisering, SEO og innholdsstruktur.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="nb" suppressHydrationWarning>
      <body>
        <div className="shell">
          <header className="topbar">
            <div className="topbar-inner">
              <Link href="/" className="brand">
                <span className="brand-mark">A</span>
                <span>
                  <strong>AI SEO Audit</strong>
                  <small>for ChatGPT, Gemini, Copilot, Perplexity og flere</small>
                </span>
              </Link>
              <nav className="global-nav" aria-label="Moduler">
                <Link href="/" className="global-nav-link">
                  Hjem
                </Link>
                <Link href="/page-audit" className="global-nav-link">
                  Sideanalyse
                </Link>
                <Link href="/opportunities" className="global-nav-link">
                  Opportunities
                </Link>
                <Link href="/integrations" className="global-nav-link">
                  Domener og integrasjoner
                </Link>
              </nav>
            </div>
          </header>
          <main className="page">{children}</main>
        </div>
      </body>
    </html>
  );
}
