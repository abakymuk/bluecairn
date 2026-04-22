import type { NextConfig } from 'next'

/**
 * ops-web — Next.js 15 App Router config.
 *
 * `transpilePackages` lets us consume workspace packages (@bluecairn/core,
 * @bluecairn/db) without pre-building them. They ship as `.ts` with
 * `main`/`types` pointing to `src/index.ts`, and Next.js will transpile
 * them as part of the ops-web build.
 *
 * The `webpack.resolve.extensionAlias` override teaches webpack the
 * TypeScript ESM convention where `./foo.js` in source resolves to
 * `./foo.ts` on disk — this is what `verbatimModuleSyntax: true` in
 * the monorepo's tsconfig.base.json emits, but webpack doesn't honour
 * it out of the box. Without this, the build fails to resolve
 * `@bluecairn/db/src/schema/index.js`.
 */
const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@bluecairn/core', '@bluecairn/db'],

  webpack: (webpackConfig) => {
    webpackConfig.resolve ??= {}
    webpackConfig.resolve.extensionAlias = {
      ...(webpackConfig.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    }
    return webpackConfig
  },

  // Avoid leaking build-time secrets into client bundles. `env.ts` uses
  // `NEXT_PUBLIC_*` only for the OAuth base URL; everything else is
  // server-only.
  productionBrowserSourceMaps: false,

  // Skip TypeScript and ESLint in `next build` — they run as dedicated
  // turbo tasks (`typecheck`, `lint`) already. Re-enable per-env if CI
  // ever wants belt-and-suspenders.
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
}

export default config
