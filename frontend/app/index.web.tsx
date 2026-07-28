import { LandingPage } from "@/landing/LandingPage.web";

/**
 * `/` on the web is the public landing page.
 *
 * Native keeps `index.tsx` (the animated splash that hands off to /home) — a
 * marketing page inside an installed app would be dead weight, and someone who
 * downloaded the app has already been sold.
 */
export default LandingPage;
