import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Novel Translator - Immersive Chinese Novel Translator',
  description: 'Clean, ad-free, high-performance translator and reader for Chinese web novels.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body>{children}</body>
    </html>
  );
}
