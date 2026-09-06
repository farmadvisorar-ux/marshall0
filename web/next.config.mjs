/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  // The scoring, identity and compliance engines live at the repo root and are
  // shared with the CLI demos and the validator. Compiling them from outside
  // web/ keeps one implementation rather than a copy that drifts.
  experimental: { externalDir: true },
};
