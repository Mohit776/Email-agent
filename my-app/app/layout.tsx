import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "LinkedIn AI Profile Finder | iGaming Talent Discovery",
  description:
    "AI-powered LinkedIn profile search for iGaming industry professionals. Find SEO heads, marketing directors, affiliate managers, and founders.",
  keywords: [
    "iGaming",
    "LinkedIn",
    "AI",
    "profile finder",
    "talent discovery",
    "SEO",
    "affiliate manager",
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-[#08090d] text-[#e4e4e7]">
        {children}
      </body>
    </html>
  );
}
