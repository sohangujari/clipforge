import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ClipForge — Turn long-form video into viral clips",
  description:
    "Paste a YouTube link, get vertical clips with burned-in captions, face-tracked cropping, and SEO-ready metadata. 100% local, self-hosted.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Anton&family=Bebas+Neue&family=Courier+Prime:wght@700&family=Inter:wght@400;600;700;800;900&family=Montserrat:ital,wght@0,700;0,800;0,900;1,800&family=Oswald:wght@600;700&family=Playfair+Display:ital,wght@1,700;1,900&family=Plus+Jakarta+Sans:wght@700;800;900&family=Rubik:wght@700;800;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
