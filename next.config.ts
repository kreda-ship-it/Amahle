import type { NextConfig } from "next";

/**
 * Next.js refuses to load images from a host you have not listed, on purpose.
 * Without that rule anyone could point our site's image optimizer at any
 * server on the internet and make us pay to resize their files.
 *
 * So Supabase Storage has to be named. It is derived from the environment
 * variable rather than typed out, because the project domain changes when the
 * production project is created — the same reason `imageUrl()` builds
 * addresses instead of the database storing them.
 *
 * The path is narrowed to the public storage endpoint. Nothing else on the
 * Supabase domain is an image, and a wildcard here would allow more than we
 * mean to allow.
 */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseHostname = supabaseUrl ? new URL(supabaseUrl).hostname : null;

const nextConfig: NextConfig = {
  images: {
    remotePatterns: supabaseHostname
      ? [
          {
            protocol: "https",
            hostname: supabaseHostname,
            pathname: "/storage/v1/object/public/**",
          },
        ]
      : [],
  },
};

export default nextConfig;
