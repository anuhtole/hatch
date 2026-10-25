import type { Metadata } from 'next';
import { Inter, Inter_Tight, JetBrains_Mono, Fraunces } from 'next/font/google';
import './globals.css';
import Providers from './providers';

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
});

const interTight = Inter_Tight({
  variable: '--font-inter-tight',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
});

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-jetbrains-mono',
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
});

const fraunces = Fraunces({
  variable: '--font-fraunces',
  subsets: ['latin'],
  weight: ['300', '400', '500'],
  style: ['normal', 'italic'],
});

export const metadata: Metadata = {
  title: 'Hatch',
  description: 'Secretary of Sorts',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${interTight.variable} ${jetbrainsMono.variable} ${fraunces.variable} h-full`}
    >
      <body className="h-full font-sans antialiased"><Providers>{children}</Providers></body>
    </html>
  );
}
