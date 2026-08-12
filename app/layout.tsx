import type {Metadata} from 'next';
import './globals.css'; // Global styles
import { Navigation } from '@/components/navigation';
import { MapImagesUrlProvider } from '@/lib/MapImagesUrlContext';
import { ThemeProvider } from '@/lib/theme-context';
import { generateThemeStyles } from '@/lib/theme-config';
import { getSiteUrl } from '@/lib/site-url';
import { getMapImagesUrl } from '@/lib/utils';

// Startup work lives in instrumentation.ts -> lib/startup.ts; a layout module is
// not a startup hook (it can be evaluated more than once per process).

// Force dynamic rendering to read environment variables at runtime, not build time
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const siteUrl = await getSiteUrl();
  const siteName = process.env.NEXT_PUBLIC_SITE_NAME || 'SurfStats';
  const title = process.env.NEXT_PUBLIC_SITE_TITLE || 'SurfStats - CS:GO Surf Community';
  const description =
    process.env.NEXT_PUBLIC_SITE_DESCRIPTION ||
    'Statistics, leaderboards, and server information for our CS:GO surf community.';

  return {
    metadataBase: new URL(siteUrl),
    title: {
      default: title,
      template: `%s - ${siteName}`,
    },
    description,
    openGraph: {
      type: 'website',
      siteName,
      title,
      description,
      url: siteUrl,
    },
    twitter: {
      card: 'summary',
      title,
      description,
    },
  };
}

export default function RootLayout({children}: {children: React.ReactNode}) {
  const mapImagesUrl = getMapImagesUrl();
  const siteName = process.env.NEXT_PUBLIC_SITE_NAME || 'SurfStats';
  const themeStyles = generateThemeStyles();
  
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <style dangerouslySetInnerHTML={{ __html: themeStyles }} />
        <script
          dangerouslySetInnerHTML={{
            __html: `
(function() {
  try {
    var stored = localStorage.getItem('theme');
    var theme = stored || 'system';
    
    if (theme === 'system') {
      var isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.classList.add(isDark ? 'dark' : 'light');
    } else {
      document.documentElement.classList.add(theme);
    }
  } catch (e) {
    document.documentElement.classList.add('dark');
  }
})();
            `.trim(),
          }}
        />
      </head>
      <body className="bg-gradient-radial grid-pattern bg-background text-text min-h-screen flex flex-col antialiased" suppressHydrationWarning>
        <ThemeProvider>
          <MapImagesUrlProvider url={mapImagesUrl}>
            <Navigation siteName={siteName} />
            <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 glow-effect">
              {children}
            </main>
          <footer className="bg-background-secondary border-t border-border mt-auto relative">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 text-center text-text-muted text-sm">
              <a href={process.env.NEXT_PUBLIC_MAIN_SITE_URL || 'https://snksrv.com'} className="hover:text-primary transition-colors">{process.env.NEXT_PUBLIC_MAIN_SITE_NAME || 'Main Site'}</a>
              {process.env.NEXT_PUBLIC_FOOTER_LINK_URL && (
                <>
                  <span className="mx-2">|</span>
                  <a href={process.env.NEXT_PUBLIC_FOOTER_LINK_URL} className="hover:text-primary transition-colors">{process.env.NEXT_PUBLIC_FOOTER_LINK_TEXT || 'Link'}</a>
                </>
              )}
            </div>
            <a href="https://github.com/Sneaks-Community/surfstats-web-next" target="_blank" rel="noopener noreferrer" className="absolute bottom-4 right-4 hover:text-primary transition-colors" title="GitHub">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
              </svg>
            </a>
          </footer>
          </MapImagesUrlProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}