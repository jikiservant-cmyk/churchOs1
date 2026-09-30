import type {Metadata} from 'next';
// Self-hosted brand fonts (Fontsource). Previously these came from
// next/font/google, which fetches from fonts.googleapis.com at build time
// and hard-fails the build in network-restricted environments (CI, Cloud
// Build, sandboxes). Bundling them keeps builds hermetic and works offline.
import '@fontsource/outfit/400.css';
import '@fontsource/outfit/500.css';
import '@fontsource/outfit/600.css';
import '@fontsource/outfit/700.css';
import '@fontsource/outfit/800.css';
import '@fontsource/playfair-display/400.css';
import '@fontsource/playfair-display/500.css';
import '@fontsource/playfair-display/600.css';
import '@fontsource/playfair-display/700.css';
import '@fontsource/playfair-display/800.css';
import './globals.css';
import GlobalClientWrapper from "@/components/GlobalClientWrapper";

export const metadata: Metadata = {
  title: 'churchOs - Multi-tenant SaaS for churches with MoMo giving and admin dashboard.',
  description: 'Multi-tenant SaaS for churches with MoMo giving and admin dashboard.',
  openGraph: {
    title: 'churchOs - Multi-tenant SaaS for churches with MoMo giving and admin dashboard.',
    description: 'Multi-tenant SaaS for churches with MoMo giving and admin dashboard.',
  },
};

export const viewport = {
  themeColor: '#1E1208',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>
        <GlobalClientWrapper>
          {children}
        </GlobalClientWrapper>
      </body>
    </html>
  );
}
