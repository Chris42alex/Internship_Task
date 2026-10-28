import type { Metadata } from "next";
import { Inter, Noto_Sans_Malayalam } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
// Bundled so Malayalam conjuncts render correctly on machines without a Malayalam font.
const malayalam = Noto_Sans_Malayalam({ variable: "--font-ml", subsets: ["malayalam", "latin"] });

export const metadata: Metadata = {
  title: "Ticker Desk",
  description: "Turn press releases into faithful, broadcast-style news tickers. Review, edit, approve and export.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${malayalam.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
