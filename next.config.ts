import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: [
    "preview-chat-570850f3-d454-45a6-8c1c-4905088054cf.space-z.ai",
    ".space-z.ai",
  ],
};

export default withNextIntl(nextConfig);
