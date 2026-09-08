import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "Travels", template: "%s · Travels" },
  description: "Films from the road.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* Fixed so it floats above the full-bleed map. Blurred pills keep the
            links legible over whatever is behind them. */}
        <nav className="fixed top-6 left-6 z-30 flex gap-1.5 text-[13px]">
          {[
            ["Map", "/"],
            ["Films", "/films/"],
          ].map(([label, href]) => (
            <a
              key={href}
              href={href}
              className="rounded-full border border-black/10 bg-white/70 px-3 py-1.5 opacity-70 backdrop-blur transition hover:opacity-100 dark:border-white/15 dark:bg-black/50"
            >
              {label}
            </a>
          ))}
        </nav>
        {children}
      </body>
    </html>
  );
}
