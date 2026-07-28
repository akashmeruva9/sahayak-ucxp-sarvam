import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "expo-router";
import { useAuthStore } from "@/store/useAuthStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { LANDING_CSS } from "./landingCss";

/**
 * The public marketing page — web only.
 *
 * Written with DOM elements rather than React Native primitives. The rest of the
 * app is React Native Web because it has to run on a phone; this page never
 * does, and expressing a scroll-driven marketing page (sticky nav, canvas
 * particles, CSS grid bento, keyframe choreography) through RN's layout model
 * would cost fidelity for portability we don't need. Metro resolves `.web.tsx`,
 * so nothing here reaches the native bundle.
 *
 * The stylesheet is injected as a <style> child, so it lives exactly as long as
 * this component does — enter the app and every rule goes with it.
 */

const GREETINGS = [
  "नमस्ते", "నమస్తే", "வணக்கம்", "ನಮಸ್ಕಾರ", "നമസ്കാരം",
  "নমস্কার", "નમસ્તે", "ਸਤ ਸ੍ਰੀ ਅਕਾਲ", "ନମସ୍କାର", "السلام علیکم", "Hello",
];

const INTRO_GLYPHS = ["अ", "అ", "அ", "অ", "અ", "ਅ", "ಅ", "മ", "ଅ", "ا", "A"];

/** Ring positions are polar; the SVG link lines below use the same coordinates. */
const NODES = [
  { left: "90%", top: "50%", g: "అ", nm: "Telugu" },
  { left: "84.6%", top: "70%", g: "அ", nm: "Tamil" },
  { left: "70%", top: "84.6%", g: "മ", nm: "Malayalam" },
  { left: "50%", top: "90%", g: "ಕ", nm: "Kannada" },
  { left: "30%", top: "84.6%", g: "ॐ", nm: "Sanskrit" },
  { left: "15.4%", top: "70%", g: "ଅ", nm: "Odia" },
  { left: "10%", top: "50%", g: "અ", nm: "Gujarati" },
  { left: "15.4%", top: "30%", g: "म", nm: "Marathi" },
  { left: "30%", top: "15.4%", g: "ਅ", nm: "Punjabi" },
  { left: "50%", top: "10%", g: "अ", nm: "Hindi" },
  { left: "70%", top: "15.4%", g: "অ", nm: "Bengali" },
  { left: "84.6%", top: "30%", g: "ا", nm: "Urdu" },
];

const LINKS = NODES.map((n) => ({
  x: parseFloat(n.left),
  y: parseFloat(n.top),
}));

const STATS = [
  { to: 22, suffix: "", prefix: "", t: "official languages; only ~10–20% speak English" },
  { to: 120, suffix: "", prefix: "₹", t: "cost per manually-handled support issue" },
  { to: 89, suffix: "%", prefix: "", t: "switch brands after poor or slow support" },
  { to: 400, suffix: "M", prefix: "", t: "people locked out of English-first support" },
];

/**
 * The brand mark. A raster rather than the drawn glyph it replaces: the logo is
 * artwork, not an icon, so it is used as supplied instead of being redrawn
 * approximately in SVG.
 */
/**
 * Metro hands back `{ uri }` for a required image on web; a plain <img> needs
 * the string.
 */
const LOGO_SRC: string = (() => {
  const asset = require("../../assets/logo.png") as string | { uri: string };
  return typeof asset === "string" ? asset : asset.uri;
})();

function Mark({ className = "mk" }: { className?: string }) {
  return (
    <img
      className={className}
      src={LOGO_SRC}
      alt=""
      aria-hidden="true"
      style={{ borderRadius: "28%", objectFit: "cover" }}
    />
  );
}

function Tick() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function Arrow() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function LandingPage() {
  const router = useRouter();
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const user = useAuthStore((s) => s.user);
  const signedIn = Boolean(user);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const progRef = useRef<HTMLDivElement | null>(null);
  const navRef = useRef<HTMLElement | null>(null);

  // The intro is a first-impression, not a toll gate: replaying it every time
  // someone comes back from the app would be a tax on the people using it most.
  const [introDone, setIntroDone] = useState(() => {
    try {
      return sessionStorage.getItem("sahayak.introSeen") === "1";
    } catch {
      return false;
    }
  });
  const [introHiding, setIntroHiding] = useState(false);
  const [glyph, setGlyph] = useState(INTRO_GLYPHS[0]);

  const dark = theme === "dark";

  /** Entering the app: straight in when signed in, via sign-in when not. */
  const enterApp = useCallback(() => {
    router.push(signedIn ? "/home" : "/sign-in");
  }, [router, signedIn]);

  /**
   * Merchant onboarding — the dashboard, where a business connects its store
   * and publishes a manifest.
   *
   * A full page load, not `router.push`: /dashboard is a separate Vite app
   * served as a static folder on the same origin, so Expo Router has no route
   * for it and pushing would land on the not-found screen.
   */
  const openDashboard = useCallback(() => {
    window.location.href = "/dashboard";
  }, []);

  /**
   * Keep `html.dark` in sync with the store.
   *
   * NativeWind's ThemeSync already does this for the app's own classes, but the
   * landing's CSS variables key off `html.dark` directly and must not depend on
   * NativeWind's internals to be correct.
   */
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  // ---- intro: cycle the "a" across scripts, then dissolve -------------- //
  useEffect(() => {
    if (introDone) return;
    let i = 0;
    const cycle = setInterval(() => {
      i = (i + 1) % INTRO_GLYPHS.length;
      setGlyph(INTRO_GLYPHS[i]);
    }, 150);
    const fade = setTimeout(() => setIntroHiding(true), 2200);
    const done = setTimeout(() => {
      setIntroDone(true);
      try {
        sessionStorage.setItem("sahayak.introSeen", "1");
      } catch {
        /* private mode — the intro simply plays again */
      }
    }, 2960);
    return () => {
      clearInterval(cycle);
      clearTimeout(fade);
      clearTimeout(done);
    };
  }, [introDone]);

  // ---- nav shadow + reading progress ---------------------------------- //
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onScroll = () => {
      navRef.current?.classList.toggle("scrolled", root.scrollTop > 8);
      const max = root.scrollHeight - root.clientHeight || 1;
      if (progRef.current) {
        progRef.current.style.width = `${(root.scrollTop / max) * 100}%`;
      }
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => root.removeEventListener("scroll", onScroll);
  }, []);

  // ---- reveal on scroll, staggered within each grid -------------------- //
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const selector = [
      ".eyebrow", ".grid-head", "h2", "section .lead", ".card", ".step",
      ".sb", ".row", ".persona", ".honest", ".ctaband", ".logos", ".constel",
    ].join(",");
    const els = Array.from(root.querySelectorAll<HTMLElement>(selector));
    els.forEach((e) => e.classList.add("reveal"));
    root.querySelectorAll<HTMLElement>(".bento,.statband,.pipe").forEach((grid) => {
      let k = 0;
      Array.from(grid.children).forEach((child) => {
        const el = child as HTMLElement;
        if (el.classList.contains("reveal")) {
          el.style.transitionDelay = `${k * 60}ms`;
          k++;
        }
      });
    });
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            io.unobserve(entry.target);
          }
        });
      },
      { root, threshold: 0.12, rootMargin: "0px 0px -6% 0px" }
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);

  // ---- count-up on the stat band --------------------------------------- //
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const el = entry.target as HTMLElement;
          const to = Number(el.dataset.to ?? 0);
          const duration = 1200;
          let start: number | null = null;
          const tick = (ts: number) => {
            if (start === null) start = ts;
            const p = Math.min((ts - start) / duration, 1);
            el.textContent = String(Math.floor((1 - Math.pow(1 - p, 3)) * to));
            if (p < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
          io.unobserve(el);
        });
      },
      { root, threshold: 0.6 }
    );
    root.querySelectorAll<HTMLElement>(".count").forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);

  // ---- brand-tinted particle constellation ----------------------------- //
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (matchMedia("(prefers-reduced-motion:reduce)").matches) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    const COLORS: [number, number, number][] = [
      [47, 93, 255], [178, 75, 196], [255, 106, 44],
    ];
    let pts: { x: number; y: number; vx: number; vy: number; c: [number, number, number] }[] = [];
    let raf = 0;

    const size = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = w * DPR;
      canvas.height = h * DPR;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    };
    const seed = () => {
      const n = Math.max(32, Math.min(84, Math.floor(window.innerWidth / 22)));
      pts = Array.from({ length: n }, (_, i) => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.2 * DPR,
        vy: (Math.random() - 0.5) * 0.2 * DPR,
        c: COLORS[i % 3],
      }));
    };
    const frame = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const isDark = document.documentElement.classList.contains("dark");
      const max = 150 * DPR;
      const dotA = isDark ? 0.6 : 0.46;
      const lineA = isDark ? 0.26 : 0.15;

      for (const p of pts) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
        if (p.y < 0 || p.y > canvas.height) p.vy *= -1;
      }
      for (let a = 0; a < pts.length; a++) {
        for (let b = a + 1; b < pts.length; b++) {
          const dx = pts[a].x - pts[b].x;
          const dy = pts[a].y - pts[b].y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d >= max) continue;
          const [r, g, bl] = pts[a].c;
          ctx.strokeStyle = `rgba(${r},${g},${bl},${(1 - d / max) * lineA})`;
          ctx.lineWidth = DPR;
          ctx.beginPath();
          ctx.moveTo(pts[a].x, pts[a].y);
          ctx.lineTo(pts[b].x, pts[b].y);
          ctx.stroke();
        }
      }
      for (const p of pts) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.6 * DPR, 0, 7);
        ctx.fillStyle = `rgba(${p.c[0]},${p.c[1]},${p.c[2]},${dotA})`;
        ctx.fill();
      }
      raf = requestAnimationFrame(frame);
    };

    size();
    seed();
    frame();

    let resizeTimer: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        size();
        seed();
      }, 180);
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(resizeTimer);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  /** In-page anchors: the scroll container is `.lp`, not the window. */
  const jump = useCallback((id: string) => (e: { preventDefault: () => void }) => {
    e.preventDefault();
    const root = rootRef.current;
    const target = root?.querySelector<HTMLElement>(`#${id}`);
    if (!root || !target) return;
    root.scrollTo({ top: target.offsetTop - 64, behavior: "smooth" });
  }, []);

  // One label in both states and in all three places. The page previously said
  // "Open the app", "Try Sahayak" and "Try it yourself" depending on where you
  // looked, which reads as three different destinations rather than one.
  const ctaLabel = "Try it out";

  return (
    <div className="lp" ref={rootRef}>
      <style dangerouslySetInnerHTML={{ __html: LANDING_CSS }} />

      <div className="page-aurora" aria-hidden="true">
        <i className="p1" /><i className="p2" /><i className="p3" />
      </div>
      <canvas id="lp-net" ref={canvasRef} aria-hidden="true" />
      <div id="lp-prog" ref={progRef} />

      {!introDone ? (
        <div id="lp-intro" className={introHiding ? "hide" : undefined} aria-hidden="true">
          <div className="glyph">{glyph}</div>
          <div className="cap">one voice · every Indian language</div>
        </div>
      ) : null}

      {/* ================= NAV ================= */}
      <nav ref={navRef}>
        <div className="wrap">
          <a className="brand" href="#" onClick={jump("lp-top")} aria-label="Sahayak home">
            <Mark />
            Sahayak
          </a>
          <div className="navlinks">
            <a href="#why" onClick={jump("why")}>Why</a>
            <a href="#how" onClick={jump("how")}>How</a>
            <a href="#protocol" onClick={jump("protocol")}>UCXP</a>
            <a href="#demo" onClick={jump("demo")}>Demo</a>
            <a href="#roadmap" onClick={jump("roadmap")}>Roadmap</a>
            <a href="/dashboard">For businesses</a>
          </div>
          <div className="navright">
            <button
              className="iconbtn"
              onClick={() => setTheme(dark ? "light" : "dark")}
              aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
              title="Toggle theme"
            >
              {dark ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
                </svg>
              )}
            </button>
            <button className="btn primary sm" onClick={enterApp}>{ctaLabel}</button>
          </div>
        </div>
      </nav>

      {/* ================= LANGUAGE MARQUEE ================= */}
      <div className="langband" aria-hidden="true">
        <div className="marq">
          {[...GREETINGS, ...GREETINGS].map((g, i) => (
            <span key={`${g}-${i}`}>{g}</span>
          ))}
        </div>
      </div>

      <main id="lp-top">
        {/* ================= HERO ================= */}
        <header className="hero">
          <div className="dotgrid" />
          <div className="glow a" />
          <div className="glow b" />
          <div className="wrap">
            <div className="hero-grid">
              <div>
                <h1>Customer support that <span className="flow">speaks every Indian language</span>.</h1>
                <p className="sub">
                  <b>Sahayak</b> is the UPI movement for customer support — the customer just
                  speaks, in their language, and the job actually gets done. Powered by{" "}
                  <b>UCXP</b> &amp; <b>Sarvam AI</b>.
                </p>
                <div className="cta-row">
                  <button className="btn primary arrow" onClick={enterApp}>
                    {ctaLabel} <Arrow />
                  </button>
                  <a className="btn ghost" href="#how" onClick={jump("how")}>How it works</a>
                </div>
                <div className="proof">
                  <div className="avatars"><span>अ</span><span>த</span><span>ম</span><span>ಕ</span></div>
                  <span>Understood in <b style={{ color: "var(--ink)" }}>22 languages</b> — resolved in the same voice</span>
                </div>
              </div>

              <div className="stage">
                <div className="floatchip fc1">🎙️ Speaking Telugu…</div>
                <div className="device">
                  <div className="top">
                    <Mark />
                    <b>Sahayak</b>
                    <span className="st"><span className="pdot" style={{ width: 7, height: 7 }} />Live · te-IN</span>
                  </div>
                  <div className="msg a">నమస్తే! ఎలా సహాయం చేయగలను?</div>
                  <div className="msg u">Where is my order? — #1001</div>
                  <div className="msg a">
                    Packed — arrives Tue 28 Jul.<br />
                    <span className="receipt">✓ Arriving Tuesday</span>
                  </div>
                  <div className="msg u">Actually, cancel it</div>
                  <div className="msg a">
                    Done — ₹1,299 refunded in 5–7 days.<br />
                    <span className="receipt">✓ RFND600322</span>
                  </div>
                  <div className="msg a" style={{ width: "fit-content", padding: "6px 8px" }} aria-label="Sahayak is responding">
                    <span className="typing"><i /><i /><i /></span>
                  </div>
                </div>
                <div className="floatchip fc2">✅ Job completed</div>
              </div>
            </div>
          </div>
        </header>

        {/* ================= TRUST ================= */}
        <section className="trust">
          <div className="wrap">
            <span className="cap">Built on the Sarvam stack</span>
            <div className="logos">
              {["Sarvam · Saaras STT", "Sarvam · 105B LLM", "Sarvam · Bulbul TTS", "Shopify", "WhatsApp", "Twilio Voice"].map((l) => (
                <span className="lg" key={l}>{l}</span>
              ))}
            </div>
          </div>
        </section>

        {/* ================= WHY / BENTO ================= */}
        <section id="why">
          <div className="wrap">
            <div className="grid-head">
              <div>
                <div className="eyebrow">Why Sahayak</div>
                <h2>We complete the job —<br />we don&apos;t just answer</h2>
              </div>
              <p className="lead">Chatbots quote the policy. Sahayak files the refund, tracks the order, cancels the plan — with a receipt.</p>
            </div>
            <div className="bento">
              <div className="card feat">
                <div className="ic">🎯</div>
                <h3>Resolution, not conversation</h3>
                <p>Track, refund, cancel, book — real actions against real business APIs, ending in a receipt the customer can trust.</p>
              </div>
              <div className="card c3"><div className="ic">🗣️</div><h3>Voice-first &amp; vernacular</h3><p>Speak Telugu, get Telugu back. Switch to Hindi mid-call — no menus, no “press 1”.</p></div>
              <div className="card c2"><div className="stat accent">1</div><h3>manifest to onboard</h3><p>Publish one file. That&apos;s the integration.</p></div>
              <div className="card c2"><div className="stat accent">24×7</div><h3>always on</h3><p>Every hour, every language.</p></div>
              <div className="card c2"><div className="ic">🧠</div><h3>Memory across the call</h3><p>“Cancel that order” just works.</p></div>
            </div>
          </div>
        </section>

        {/* ================= HOW ================= */}
        <section id="how">
          <div className="wrap">
            <div className="eyebrow">How it works</div>
            <h2>Speak → understand → <span className="accent">do the job</span> → speak back</h2>
            <p className="lead" style={{ marginBottom: 40 }}>
              A generic runtime with zero hardcoded businesses. Behaviour enters only through manifests; Sarvam is the ears, brain and voice.
            </p>
            <div className="pipe">
              {[
                { n: 1, h: "Understand", p: "Sarvam STT transcribes & detects the language." },
                { n: 2, h: "Route & classify", p: "Which business, which job to run." },
                { n: 3, h: "Gather & act", p: "Fill inputs, call the real API, get a result." },
                { n: 4, h: "Compose & localize", p: "Answer in the caller's language, via Bulbul TTS." },
              ].map((s) => (
                <div className="step" key={s.n}>
                  <div className="n">{s.n}</div>
                  <h4>{s.h}</h4>
                  <p>{s.p}</p>
                  <div className="sweep" />
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ================= PROTOCOL ================= */}
        <section id="protocol">
          <div className="wrap">
            <div className="eyebrow">The three pillars</div>
            <h2>One agent. One protocol. One dashboard.</h2>
            <p className="lead" style={{ marginBottom: 48 }}>
              Everything a merchant needs to go live in an afternoon — and everything a customer needs to be understood.
            </p>

            <div className="row">
              <div className="rtext">
                <h3>The Sahayak agent</h3>
                <p>A multi-modal support agent on the Sarvam stack — in the app, on WhatsApp and on a phone call. One engine, every channel.</p>
                <ul className="checklist">
                  <li><Tick />Voice notes, PDFs, photos — all accepted</li>
                  <li><Tick />Confirms before any destructive action</li>
                  <li><Tick />Every Sarvam language, out of the box</li>
                </ul>
              </div>
              <div className="visual">
                <div className="msg a">నా Airtel Fiber రద్దు చేయి</div>
                <div className="msg a">Confirm — cancel Airtel Fiber (₹599/mo)?</div>
                <div className="msg u">Yes</div>
                <div className="msg a">Done — cancelled. Ticket AIR-40218.<br /><span className="receipt">✓ Cancellation submitted</span></div>
              </div>
            </div>

            <div className="row rev">
              <div className="rtext">
                <h3>UCXP — the protocol</h3>
                <p>
                  Onboarding a business is publishing one file. OpenAPI standardized APIs. MCP standardized AI tools.{" "}
                  <b style={{ color: "var(--ink)" }}>UCXP standardizes getting the customer&apos;s job done.</b>
                </p>
                <ul className="checklist">
                  <li><Tick />Capabilities, inputs, rules, endpoints</li>
                  <li><Tick />Onboarding cost approaches zero</li>
                  <li><Tick />One manifest, every language</li>
                </ul>
              </div>
              <div className="visual">
                <div className="code">{`{
  `}<span className="k">&quot;ucxp_version&quot;</span>{`: `}<span className="s">&quot;0.1&quot;</span>{`,
  `}<span className="k">&quot;business&quot;</span>{`: `}<span className="s">&quot;Ravi Electronics&quot;</span>{`,
  `}<span className="k">&quot;languages&quot;</span>{`: [`}<span className="s">&quot;en-IN&quot;,&quot;hi-IN&quot;,&quot;te-IN&quot;,&quot;ta-IN&quot;</span>{`…],
  `}<span className="k">&quot;data_source&quot;</span>{`: { `}<span className="k">&quot;type&quot;</span>{`: `}<span className="s">&quot;shopify&quot;</span>{` },
  `}<span className="k">&quot;capabilities&quot;</span>{`: [{
    `}<span className="k">&quot;name&quot;</span>{`: `}<span className="s">&quot;track_order&quot;</span>{`,
    `}<span className="k">&quot;endpoint&quot;</span>{`: `}<span className="s">&quot;/orders/&#123;id&#125;&quot;</span>{`,
    `}<span className="k">&quot;method&quot;</span>{`: `}<span className="m">&quot;GET&quot;</span>{`
  }]
}`}</div>
              </div>
            </div>

            <div className="row">
              <div className="rtext">
                <h3>The enterprise dashboard</h3>
                <p>Go live with no developer. Connect the store, define policies &amp; capabilities, publish the validated manifest — and watch resolutions roll in.</p>
                <ul className="checklist">
                  <li><Tick />No integration call, no code</li>
                  <li><Tick />Validated before publish</li>
                  <li><Tick />Live on real merchant data</li>
                </ul>
                <div className="cta-row">
                  <button className="btn primary arrow" onClick={openDashboard}>
                    Merchant onboarding <Arrow />
                  </button>
                </div>
              </div>
              <div className="visual dash">
                <h4>Resolutions this week</h4>
                <div className="sm">Ravi Electronics · auto-resolved by Sahayak</div>
                <div className="barrow">
                  {[55, 72, 48, 88, 66, 96].map((h, i) => (
                    <div className="bcol" key={h} style={{ height: `${h}%`, animationDelay: `${0.05 + i * 0.08}s` }} />
                  ))}
                </div>
                <div className="barcap">
                  {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <span key={d}>{d}</span>)}
                </div>
                <div className="emptystate" style={{ marginTop: 16, padding: "14px 16px", display: "flex", alignItems: "center", gap: 12, textAlign: "left" }}>
                  <div className="eic" style={{ width: 38, height: 38, margin: 0, flex: "0 0 auto", fontSize: 18 }}>🎉</div>
                  <div>
                    <b style={{ fontSize: 13.5 }}>Human inbox: zero</b>
                    <span>0 tickets waiting on a person — Sahayak cleared the queue</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ================= CONSTELLATION ================= */}
        <section style={{ paddingLeft: 0, paddingRight: 0 }}>
          <div className="constel-sec">
            <div className="glow c" />
            <div className="constel-in">
              <div>
                <div className="eyebrow">Every Indian language</div>
                <h2>One agent at the<br />centre of them all</h2>
                <p className="lead" style={{ marginBottom: 22 }}>
                  From Kashmir to Kanyakumari — <b className="accent" style={{ fontWeight: 800 }}>22 official languages</b>,
                  every dialect in between. The customer speaks the tongue they think in; Sahayak answers in the same voice.
                </p>
                <div className="bignum accent">1.4B</div>
                <div style={{ color: "var(--ink-muted)", fontSize: 14, marginTop: 4 }}>people · one protocol · every language</div>
              </div>
              <div className="constel">
                <div className="ring r1" /><div className="ring r2" /><div className="ring r3" />
                <svg className="links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                  <defs>
                    <linearGradient id="lp-cl" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0" stopColor="#2F5DFF" />
                      <stop offset=".5" stopColor="#B24BC4" />
                      <stop offset="1" stopColor="#FF6A2C" />
                    </linearGradient>
                  </defs>
                  {LINKS.map((l, i) => (
                    <line key={i} x1="50" y1="50" x2={l.x} y2={l.y} />
                  ))}
                </svg>
                <div className="core"><div><b>अ</b><span>SAHAYAK</span></div></div>
                {NODES.map((n, i) => (
                  <div className="node" key={n.nm} style={{ left: n.left, top: n.top, animationDelay: `${0.08 + i * 0.06}s` }}>
                    <span className="g">{n.g}</span>
                    <span className="nm">{n.nm}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ================= STATS ================= */}
        <section id="stats">
          <div className="wrap">
            <div className="eyebrow">Why now</div>
            <h2>India can&apos;t be served in English alone</h2>
            <p className="lead" style={{ marginBottom: 40 }}>
              The market everyone ignored because it was too expensive to reach — until voice AI made onboarding cost approach zero.
            </p>
            <div className="statband">
              {STATS.map((s) => (
                <div className="sb" key={s.t}>
                  <div className="n">{s.prefix}<span className="count" data-to={s.to}>0</span>{s.suffix}</div>
                  <div className="t">{s.t}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ================= PERSONA ================= */}
        <section id="demo">
          <div className="wrap">
            <div className="eyebrow">Who it&apos;s for</div>
            <h2>A person, not a market</h2>
            <div className="persona" style={{ marginTop: 10 }}>
              <div className="persona-in">
                <div className="q">
                  “<b>Lakshmi, 54</b>, runs a tailoring shop in Karimnagar. Her order&apos;s late, she speaks
                  Telugu, and she hangs up on English-only phone menus — so she waits till evening for her
                  son to call for her, or eats the loss.”
                </div>
                <div className="attr">
                  She <b style={{ color: "var(--ink-soft)" }}>uses</b> Sahayak.{" "}
                  <b style={{ color: "var(--ink-soft)" }}>Anil</b> — her 30-person supplier who can&apos;t
                  afford a call centre — <b style={{ color: "var(--ink-soft)" }}>pays</b> for it. There are
                  400 million Lakshmis, and no one builds support for them.
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ================= HONEST ================= */}
        <section>
          <div className="wrap">
            <div className="eyebrow">Honestly</div>
            <h2>What it does — and doesn&apos;t — do yet</h2>
            <div className="honest" style={{ marginTop: 10 }}>
              <ul>
                <li><span className="mk2">✅</span> Live-verified with Sarvam: voice in/out, multilingual, multi-turn (ask ID → resolve), memory, confirmation before destructive actions.</li>
                <li><span className="mk2">⚠️</span> Speech isn&apos;t perfect on IDs, so we <b style={{ color: "var(--ink)" }}>confirm before cancelling</b> — safer, one extra step.</li>
                <li><span className="mk2">⚠️</span> In-app it&apos;s turn-based; true mid-sentence barge-in works on the phone-call path.</li>
                <li><span className="mk2">⚠️</span> Single-step jobs today; multi-step workflows are on the roadmap. A working reference implementation — full deploy next.</li>
              </ul>
            </div>
          </div>
        </section>

        {/* ================= ROADMAP ================= */}
        <section id="roadmap">
          <div className="wrap">
            <div className="eyebrow">What&apos;s next</div>
            <h2>From working demo to platform</h2>
            <div className="bento" style={{ gridTemplateColumns: "repeat(2,1fr)", gridAutoRows: "auto", marginTop: 40 }}>
              {[
                { h: "01 · OTP-based identity", p: "Secure customer verification before sensitive orders, subscriptions or support history." },
                { h: "02 · Productionize streaming voice", p: "Full real-time, interruptible voice on every channel (already working as a reference)." },
                { h: "03 · MCP + A2A integration", p: "Interact with external tools & enterprise systems via Model Context Protocol and Agent-to-Agent." },
                { h: "04 · More agentic + evals", p: "Beyond answers — completing tasks while measuring quality, safety & business outcomes." },
              ].map((c) => (
                <div className="card" key={c.h}><h3>{c.h}</h3><p>{c.p}</p></div>
              ))}
            </div>
          </div>
        </section>

        {/* ================= CTA ================= */}
        <section>
          <div className="wrap">
            <div className="ctaband">
              <h2>Businesses integrate once.<br />Every AI serves every Indian.</h2>
              <p>UPI unified payments. Sahayak unifies customer experience — by voice, in every language.</p>
              <div className="cta-row" style={{ justifyContent: "center" }}>
                <button className="btn white arrow" onClick={enterApp}>{ctaLabel} <Arrow /></button>
                <a className="btn ghost" href="/dashboard">Merchant onboarding</a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <div className="wrap">
          <div className="foot">
            <div>
              <a className="brand big" href="#" onClick={jump("lp-top")} aria-label="Sahayak home">
                <Mark />
                Sahayak
              </a>
              <p className="tag">The UPI movement for customer support in India — by voice, in every language.</p>
            </div>
            <div className="fchips">
              {["Sarvam Saaras · STT", "Sarvam 105B · LLM", "Sarvam Bulbul · TTS", "UCXP · LangGraph", "React Native", "WhatsApp · Twilio", "Shopify"].map((c) => (
                <span className="chip" key={c}>{c}</span>
              ))}
            </div>
          </div>
          <div className="fcredit">
            <span>Built by <b>Team Sahayak</b> — Akash Meruva · Manideep Karlapati · Pranav Krishna</span>
            <span>Sarvam Epoch Buildathon, Bengaluru · <span style={{ opacity: 0.7 }}>sahayak — “the helper”</span></span>
          </div>
        </div>
      </footer>
    </div>
  );
}
