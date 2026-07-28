#!/usr/bin/env node
/**
 * Inject the document head Expo's SPA template doesn't let us write.
 *
 * `app/+html.tsx` is the documented way to own the HTML shell, but it only
 * applies to static rendering. Web is pinned to `output: "single"` (PLAN.md §7
 * #36 — an SPA plus a Vercel catch-all rewrite, so Expo Router deep links work
 * on a static host), and in that mode Expo emits its own fixed template. So the
 * head is finished here, after export, rather than by changing the output mode
 * and the shape of the deploy.
 *
 * What this adds and why:
 *   - a real <title> and description: the landing page is the shareable surface
 *     of the product, and "Sahayak" alone says nothing in a search result
 *   - Open Graph tags: what renders when the link is pasted into a chat
 *   - theme-color: the browser chrome matches the canvas instead of framing a
 *     dark page in white
 *   - a no-flash script: the settings store defaults to dark, so without this
 *     the first paint is white and visibly flips
 *
 * Per-page titles are still set at runtime from the route (WebPageTitle in
 * app/_layout.tsx). This is the default for first paint and for anything
 * reading the page without running JavaScript.
 *
 * Idempotent: running it twice does not double-inject.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(root, process.argv[2] ?? "dist/index.html");

const MARKER = "sahayak-head";

const TITLE = "Sahayak — Customer support that speaks every Indian language";
const DESCRIPTION =
  "Sahayak is the UPI movement for customer support — the customer speaks in their own " +
  "language and the job actually gets done, with a receipt. Powered by UCXP and Sarvam AI.";
const SHORT =
  "Voice-first customer resolution in 22 Indian languages. One manifest to onboard a " +
  "business; real actions, real receipts.";

const HEAD = `
    <!-- ${MARKER} -->
    <meta name="description" content="${DESCRIPTION}" />
    <meta property="og:title" content="${TITLE}" />
    <meta property="og:description" content="${SHORT}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Sahayak" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${TITLE}" />
    <meta name="twitter:description" content="${SHORT}" />
    <meta name="theme-color" content="#FAF6EF" media="(prefers-color-scheme: light)" />
    <meta name="theme-color" content="#12100C" media="(prefers-color-scheme: dark)" />
    <script>
      /* Paint the dark canvas before React mounts — the store defaults to dark,
         so the alternative is a white flash on every cold load. */
      document.documentElement.classList.add('dark');
      document.documentElement.style.backgroundColor = '#12100C';
    </script>
`;

if (!existsSync(target)) {
  console.error(`finalize-web-head: ${target} not found — run \`expo export -p web\` first.`);
  process.exit(1);
}

let html = readFileSync(target, "utf8");

if (html.includes(MARKER)) {
  console.log("finalize-web-head: already applied, nothing to do");
  process.exit(0);
}

// Expo writes <title>Sahayak</title> from app.json's `name`. Replace it rather
// than adding a second one, which browsers resolve by taking the first.
const before = html;
html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${TITLE}</title>`);
if (html === before) {
  console.warn("finalize-web-head: no <title> found to replace — Expo's template may have changed");
}

if (!html.includes("</head>")) {
  console.error("finalize-web-head: no </head> in the exported shell; refusing to guess");
  process.exit(1);
}
html = html.replace("</head>", `${HEAD}  </head>`);

writeFileSync(target, html);
console.log(`finalize-web-head: head written to ${target}`);
