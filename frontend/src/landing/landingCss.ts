/**
 * Landing page stylesheet — web only.
 *
 * Injected as a <style> element by <LandingPage />, so it exists only while the
 * landing is mounted and disappears the moment the customer enters the app.
 *
 * **Every rule is scoped under `.lp`.** The app is React Native Web: bare
 * element selectors (`section`, `h2`, `a`) and a global `*` reset would reach
 * straight into the rendered app tree. The one deliberate exception is the
 * `html.dark` prefix, which is the theme flag NativeWind and this page share.
 *
 * Tokens mirror `src/constants/theme.ts` exactly — including the app's darker
 * charcoal (#12100C), not the lighter one the standalone mockup used, so
 * crossing from the landing into the app is seamless rather than a jump.
 */

export const LANDING_CSS = `
.lp{
  /* warm paper (light) — palette.light */
  --canvas:#FAF6EF; --surface:#F2EBDF; --elevated:#FFFCF7; --hairline:#E8E0D2;
  --ink:#1A1712; --ink-soft:#4A423A; --ink-muted:#857B6D; --ink-faint:#B3A897;
  /* brand — palette.accent + GRADIENT */
  --accent:#EA580C; --accent-soft:#F97316; --accent-muted:#FCE7D6;
  --g-blue:#2F5DFF; --g-violet:#B24BC4; --g-orange:#FF6A2C;
  --grad:linear-gradient(120deg,#2F5DFF,#B24BC4 52%,#FF6A2C);
  --grad-soft:linear-gradient(120deg,rgba(47,93,255,.14),rgba(178,75,196,.12) 52%,rgba(255,106,44,.14));
  --r-sm:12px; --r-card:16px; --r-lg:20px; --r-xl:28px; --r-pill:999px;
  --sh-1:0 1px 2px rgba(26,23,18,.04),0 2px 8px -3px rgba(26,23,18,.10);
  --sh-2:0 8px 24px -12px rgba(26,23,18,.20),0 2px 6px -3px rgba(26,23,18,.10);
  --sh-3:0 30px 70px -34px rgba(26,23,18,.34);
  --sh-glow:0 20px 60px -24px rgba(47,93,255,.40);
  --ring:0 0 0 3px rgba(47,93,255,.35);
  --nav-bg:rgba(250,246,239,.72);
  --dot:rgba(26,23,18,.06);
  --content:1140px;

  background:var(--canvas);
  color:var(--ink);
  font-family:"Inter",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  line-height:1.6;letter-spacing:-.011em;-webkit-font-smoothing:antialiased;
  transition:background .35s ease,color .35s ease;

  /* The app root is a React Native Web flex box with overflow hidden, so a tall
     child would simply be clipped — the window never scrolls. Filling the
     screen container and scrolling internally is what makes this a real page.
     position:fixed children (nav progress, particles, aurora) still anchor to
     the viewport, and the sticky nav sticks to this scroll container. */
  position:absolute;inset:0;
  overflow-y:auto;overflow-x:hidden;
  -webkit-overflow-scrolling:touch;
  scroll-behavior:smooth;
}
@media(prefers-reduced-motion:reduce){.lp{scroll-behavior:auto}}
/* Dark tokens — palette.dark, so the landing and the app are the same surface. */
html.dark .lp{
  --canvas:#12100C; --surface:#1A1712; --elevated:#221D17; --hairline:#332C22;
  --ink:#F7F2EA; --ink-soft:#D9D0C3; --ink-muted:#A99E8D; --ink-faint:#6F6553;
  --accent:#F97316; --accent-muted:rgba(249,115,22,.16);
  --sh-1:0 1px 2px rgba(0,0,0,.34),0 2px 10px -4px rgba(0,0,0,.42);
  --sh-2:0 10px 30px -14px rgba(0,0,0,.58),0 2px 8px -4px rgba(0,0,0,.42);
  --sh-3:0 40px 90px -40px rgba(0,0,0,.72);
  --sh-glow:0 24px 70px -26px rgba(47,93,255,.5);
  --ring:0 0 0 3px rgba(120,150,255,.45);
  --nav-bg:rgba(18,16,12,.72);
  --dot:rgba(247,242,234,.06);
}

/* reset — scoped, never global */
.lp *{box-sizing:border-box;margin:0;padding:0}
.lp a{color:inherit;text-decoration:none}
.lp button{font:inherit;color:inherit;background:none;border:none}
.lp ::selection{background:rgba(178,75,196,.24)}
.lp :focus-visible{outline:none;box-shadow:var(--ring);border-radius:8px}
.lp .wrap{max-width:var(--content);margin:0 auto;padding:0 24px;position:relative;z-index:2}
.lp .skip{position:fixed;left:16px;top:12px;z-index:100;background:var(--elevated);color:var(--ink);
  padding:10px 16px;border-radius:var(--r-pill);border:1px solid var(--hairline);font-weight:600;
  transform:translateY(-200%);transition:transform .2s}
.lp .skip:focus-visible{transform:none;box-shadow:var(--ring)}

.lp section{padding:clamp(64px,9vw,116px) 0;position:relative}
.lp .eyebrow{display:inline-flex;align-items:center;gap:8px;font-size:12.5px;font-weight:700;
  letter-spacing:.14em;text-transform:uppercase;color:var(--accent);margin-bottom:18px}
.lp .eyebrow::before{content:"";width:16px;height:2px;border-radius:2px;background:var(--grad)}
.lp h1,.lp h2,.lp h3,.lp h4{letter-spacing:-.03em;line-height:1.05;font-weight:800}
.lp h2{font-size:clamp(30px,4.3vw,50px);margin-bottom:16px}
.lp .lead{color:var(--ink-soft);font-size:clamp(16px,1.7vw,19.5px);max-width:60ch;line-height:1.55}
.lp .accent{background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
.lp .flow{background:var(--grad);background-size:200% 100%;-webkit-background-clip:text;background-clip:text;
  color:transparent;animation:lpflow 9s ease-in-out infinite alternate}
@keyframes lpflow{to{background-position:100% 0}}

/* progress + nav */
.lp #lp-prog{position:fixed;top:0;left:0;height:2px;width:0;z-index:70;background:var(--grad)}
.lp nav{position:sticky;top:0;z-index:60;background:var(--nav-bg);backdrop-filter:blur(20px) saturate(1.4);
  -webkit-backdrop-filter:blur(20px) saturate(1.4);border-bottom:1px solid transparent;transition:border-color .3s,box-shadow .3s}
.lp nav.scrolled{border-color:var(--hairline);box-shadow:var(--sh-1)}
.lp nav .wrap{display:flex;align-items:center;gap:20px;height:64px}
.lp .brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:19px;letter-spacing:-.03em;cursor:pointer}
.lp .mk{width:30px;height:30px;display:block;filter:drop-shadow(0 4px 10px rgba(47,93,255,.28))}
.lp .brand.big .mk{width:34px;height:34px}
.lp .navlinks{display:flex;gap:6px;margin-left:14px}
.lp .navlinks a{position:relative;font-size:14.5px;font-weight:550;color:var(--ink-muted);padding:8px 12px;border-radius:10px;transition:color .2s,background .2s}
.lp .navlinks a:hover{color:var(--ink);background:var(--surface)}
.lp .navright{margin-left:auto;display:flex;align-items:center;gap:10px}
.lp .iconbtn{width:40px;height:40px;border-radius:12px;border:1px solid var(--hairline);background:var(--elevated);
  display:grid;place-items:center;cursor:pointer;color:var(--ink-soft);transition:transform .2s,box-shadow .2s,border-color .2s,color .2s}
.lp .iconbtn:hover{transform:translateY(-1px);box-shadow:var(--sh-1);color:var(--ink);border-color:var(--ink-faint)}
.lp .iconbtn svg{width:19px;height:19px}

/* buttons
   Only transform / box-shadow / filter are animated — all compositor-friendly.
   The earlier version slid background-position across a 160%-wide gradient on
   hover, which reads as the fill smearing under a stationary button rather than
   the button responding, and paired it with a 60px shadow repaint on the same
   frame. That combination is what felt sticky. The press is faster than the
   release (.09s vs .19s), which is what makes a button feel physical: it
   answers instantly and settles back gently. */
.lp .btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;font-weight:650;font-size:15px;
  padding:12px 20px;border-radius:var(--r-pill);cursor:pointer;border:1px solid transparent;white-space:nowrap;
  transform:translateY(0);
  transition:transform .19s cubic-bezier(.2,.8,.25,1),box-shadow .19s cubic-bezier(.2,.8,.25,1),
             filter .19s ease,border-color .19s ease,background-color .19s ease}
.lp .btn:hover{transform:translateY(-1.5px)}
.lp .btn:active{transform:translateY(0) scale(.982);transition-duration:.09s}
.lp .btn.primary{background:var(--grad);color:#fff;box-shadow:var(--sh-glow)}
.lp .btn.primary:hover{filter:brightness(1.06) saturate(1.04);box-shadow:0 22px 48px -22px rgba(47,93,255,.55)}
.lp .btn.ghost{background:var(--elevated);border-color:var(--hairline);color:var(--ink)}
.lp .btn.ghost:hover{box-shadow:var(--sh-2);border-color:var(--ink-faint)}
.lp .btn.white:hover{filter:brightness(.97)}
.lp .btn.sm{padding:9px 16px;font-size:14px}
.lp .btn.arrow svg{transition:transform .19s cubic-bezier(.2,.8,.25,1)}
.lp .btn.arrow:hover svg{transform:translateX(3px)}
/* A hover lift on a touch screen sticks after the tap — there is no pointer to
   leave, so the button stays raised until something else is touched. */
@media(hover:none){
  .lp .btn:hover{transform:none;filter:none}
  .lp .btn.arrow:hover svg{transform:none}
}

/* pills */
.lp .pill{display:inline-flex;align-items:center;gap:9px;font-size:13px;font-weight:550;color:var(--ink-soft);
  background:var(--elevated);border:1px solid var(--hairline);padding:6px 14px 6px 10px;border-radius:var(--r-pill);box-shadow:var(--sh-1)}
.lp .pdot{width:8px;height:8px;border-radius:50%;background:#22c55e;position:relative;animation:lppulse 2s ease-in-out infinite}
@keyframes lppulse{0%,100%{box-shadow:0 0 0 3px rgba(34,197,94,.22)}50%{box-shadow:0 0 0 7px rgba(34,197,94,0)}}

/* backgrounds */
.lp .dotgrid{position:absolute;inset:0;z-index:0;pointer-events:none;
  background-image:radial-gradient(var(--dot) 1.1px,transparent 1.1px);background-size:26px 26px;
  -webkit-mask-image:radial-gradient(ellipse 80% 62% at 50% 30%,#000 40%,transparent 78%);
          mask-image:radial-gradient(ellipse 80% 62% at 50% 30%,#000 40%,transparent 78%)}
.lp .glow{position:absolute;z-index:0;pointer-events:none;border-radius:50%;filter:blur(60px);opacity:.42}
html.dark .lp .glow{opacity:.30}
.lp .glow.a{width:520px;height:520px;top:-160px;right:-120px;background:radial-gradient(circle,rgba(47,93,255,.5),transparent 62%);animation:lpdrift 22s ease-in-out infinite alternate}
.lp .glow.b{width:460px;height:460px;top:40px;left:-140px;background:radial-gradient(circle,rgba(255,106,44,.42),transparent 62%);animation:lpdrift 26s ease-in-out infinite alternate-reverse}
.lp .glow.c{width:420px;height:420px;bottom:-160px;left:40%;background:radial-gradient(circle,rgba(178,75,196,.36),transparent 62%);animation:lpdrift 30s ease-in-out infinite alternate}
@keyframes lpdrift{to{transform:translate3d(4%,3%,0) scale(1.12)}}
.lp #lp-net{position:fixed;inset:0;z-index:0;pointer-events:none;opacity:.85}
.lp .page-aurora{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden}
/* Deliberately fainter than the standalone mockup. That page sat on a lighter
   charcoal (#232019); against the app's true canvas (#12100C) the same blobs
   read as a saturated wash rather than depth, and washed the type. */
.lp .page-aurora i{position:absolute;display:block;border-radius:50%;filter:blur(90px);opacity:.20;will-change:transform}
html.dark .lp .page-aurora i{opacity:.13}
.lp .page-aurora .p1{width:52vw;height:52vw;top:4%;left:-12%;background:radial-gradient(circle,var(--g-blue),transparent 60%);animation:lpAurA 30s ease-in-out infinite alternate}
.lp .page-aurora .p2{width:46vw;height:46vw;top:48%;right:-14%;background:radial-gradient(circle,var(--g-orange),transparent 60%);animation:lpAurB 36s ease-in-out infinite alternate}
.lp .page-aurora .p3{width:50vw;height:50vw;bottom:-12%;left:28%;background:radial-gradient(circle,var(--g-violet),transparent 60%);animation:lpAurA 42s ease-in-out infinite alternate-reverse}
@keyframes lpAurA{to{transform:translate3d(10%,-8%,0) scale(1.2)}}
@keyframes lpAurB{to{transform:translate3d(-9%,9%,0) scale(1.16)}}

/* hero */
.lp .hero{padding-top:clamp(40px,7vw,84px);position:relative;overflow-x:clip}
.lp .hero-grid{display:grid;grid-template-columns:1.05fr .95fr;gap:52px;align-items:center}
.lp h1{font-size:clamp(40px,6vw,74px);font-weight:900;letter-spacing:-.045em;line-height:.98}
.lp .hero .sub{margin-top:22px;color:var(--ink-soft);font-size:clamp(16.5px,1.9vw,20px);max-width:52ch;line-height:1.5}
.lp .hero .sub b{color:var(--ink);font-weight:650}
.lp .cta-row{display:flex;gap:12px;flex-wrap:wrap;margin-top:30px}
.lp .proof{margin-top:30px;display:flex;align-items:center;gap:14px;color:var(--ink-muted);font-size:13.5px}
.lp .avatars{display:flex}
.lp .avatars span{width:30px;height:30px;border-radius:50%;border:2px solid var(--canvas);margin-left:-9px;
  background:var(--grad);display:grid;place-items:center;color:#fff;font-size:12px;font-weight:700}
.lp .avatars span:first-child{margin-left:0}

/* device */
.lp .stage{position:relative;min-height:440px;display:flex;justify-content:center;align-items:flex-start}
.lp .device{width:min(340px,100%);background:var(--elevated);border:1px solid var(--hairline);border-radius:var(--r-xl);
  padding:16px;box-shadow:var(--sh-3);position:relative;z-index:2}
.lp .device .top{display:flex;align-items:center;gap:9px;padding:4px 4px 13px;border-bottom:1px solid var(--hairline);margin-bottom:14px}
.lp .device .top .mk{width:24px;height:24px}
.lp .device .top b{font-size:14px;font-weight:700}
.lp .device .top .st{margin-left:auto;font-size:11.5px;color:var(--ink-muted);display:flex;align-items:center;gap:6px}
.lp .msg{max-width:85%;padding:10px 14px;border-radius:16px;font-size:13.5px;line-height:1.45;margin-bottom:9px;
  opacity:0;transform:translateY(8px);animation:lpmsgin .5s cubic-bezier(.3,.7,.3,1) forwards}
.lp .msg.a{background:var(--surface);border:1px solid var(--hairline);border-bottom-left-radius:5px}
.lp .msg.u{background:var(--grad);color:#fff;margin-left:auto;border-bottom-right-radius:5px;box-shadow:var(--sh-glow)}
.lp .visual .msg{opacity:1;transform:none;animation:none}
@keyframes lpmsgin{to{opacity:1;transform:none}}
.lp .device .msg:nth-child(2){animation-delay:.2s}.lp .device .msg:nth-child(3){animation-delay:1.4s}
.lp .device .msg:nth-child(4){animation-delay:2.2s}.lp .device .msg:nth-child(5){animation-delay:3s}
.lp .device .msg:nth-child(6){animation-delay:3.7s}.lp .device .msg:nth-child(7){animation-delay:4.4s}
.lp .receipt{display:inline-flex;align-items:center;gap:6px;margin-top:5px;font-size:10.5px;font-weight:700;color:#0a8f6f;
  background:rgba(16,185,129,.12);border:1px solid rgba(16,185,129,.3);padding:2px 8px;border-radius:7px}
html.dark .lp .receipt{color:#34d399}
.lp .typing{display:inline-flex;gap:4px;align-items:center;padding:12px 15px}
.lp .typing i{width:7px;height:7px;border-radius:50%;background:var(--ink-faint);animation:lptype 1.2s ease-in-out infinite}
.lp .typing i:nth-child(2){animation-delay:.18s}.lp .typing i:nth-child(3){animation-delay:.36s}
@keyframes lptype{0%,60%,100%{transform:translateY(0);opacity:.5}30%{transform:translateY(-5px);opacity:1}}
.lp .floatchip{position:absolute;background:var(--elevated);border:1px solid var(--hairline);border-radius:14px;
  padding:10px 14px;box-shadow:var(--sh-2);font-size:12.5px;font-weight:650;display:flex;align-items:center;gap:8px;z-index:3}
.lp .fc1{top:-16px;left:-14px;animation:lpbob 5s ease-in-out infinite}
.lp .fc2{bottom:40px;right:-10px;animation:lpbob 5.6s ease-in-out .8s infinite}
@keyframes lpbob{0%,100%{transform:translateY(0)}50%{transform:translateY(-9px)}}

/* language marquee */
.lp .langband{border-top:1px solid var(--hairline);border-bottom:1px solid var(--hairline);
  background:var(--surface);padding:20px 0;overflow:hidden;position:relative}
.lp .langband::before,.lp .langband::after{content:"";position:absolute;top:0;bottom:0;width:14%;z-index:2;pointer-events:none}
.lp .langband::before{left:0;background:linear-gradient(90deg,var(--surface),transparent)}
.lp .langband::after{right:0;background:linear-gradient(270deg,var(--surface),transparent)}
.lp .marq{display:flex;gap:40px;width:max-content;animation:lpscroll 32s linear infinite}
.lp .langband:hover .marq{animation-play-state:paused}
.lp .marq span{font-size:22px;font-weight:650;color:var(--ink-muted);white-space:nowrap;display:flex;gap:12px;align-items:center}
.lp .marq span::after{content:"·";color:var(--ink-faint)}
@keyframes lpscroll{to{transform:translateX(-50%)}}

/* trust */
.lp .trust{padding:clamp(40px,6vw,64px) 0}
.lp .trust .cap{text-align:center;color:var(--ink-muted);font-size:12.5px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;margin-bottom:22px;display:block}
.lp .logos{display:flex;flex-wrap:wrap;gap:12px;justify-content:center}
.lp .logos .lg{background:var(--elevated);border:1px solid var(--hairline);border-radius:var(--r-pill);
  padding:9px 18px;font-weight:600;font-size:13.5px;color:var(--ink-muted);transition:.2s;box-shadow:var(--sh-1)}
.lp .logos .lg:hover{color:var(--ink);transform:translateY(-2px);box-shadow:var(--sh-2);border-color:var(--ink-faint)}

/* bento */
.lp .grid-head{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;margin-bottom:40px;flex-wrap:wrap}
.lp .bento{display:grid;grid-template-columns:repeat(6,1fr);grid-auto-rows:minmax(168px,auto);gap:18px}
.lp .card{background:var(--elevated);border:1px solid var(--hairline);border-radius:var(--r-lg);padding:26px;
  box-shadow:var(--sh-1);position:relative;overflow:hidden;transition:transform .28s cubic-bezier(.3,.7,.3,1),box-shadow .28s,border-color .28s}
.lp .card:hover{transform:translateY(-4px);box-shadow:var(--sh-2);border-color:var(--ink-faint)}
.lp .card .ic{width:44px;height:44px;border-radius:12px;display:grid;place-items:center;font-size:22px;margin-bottom:16px;
  background:var(--grad-soft);border:1px solid var(--hairline)}
.lp .card h3{font-size:18px;margin-bottom:7px}
.lp .card p{color:var(--ink-muted);font-size:14.5px;line-height:1.5}
.lp .card.c3{grid-column:span 3}.lp .card.c2{grid-column:span 2}.lp .card.c4{grid-column:span 4}
.lp .card.feat{grid-column:span 3;grid-row:span 2;background:var(--grad);background-size:180% 180%;color:#fff;border:0;
  display:flex;flex-direction:column;justify-content:flex-end;animation:lpfeat 14s ease-in-out infinite alternate;box-shadow:var(--sh-glow)}
@keyframes lpfeat{to{background-position:100% 100%}}
.lp .card.feat .ic{background:rgba(255,255,255,.16);border-color:rgba(255,255,255,.24)}
.lp .card.feat h3{font-size:clamp(22px,2.4vw,30px)}
.lp .card.feat p{color:rgba(255,255,255,.9);font-size:15px;max-width:34ch}
.lp .card .stat{font-size:40px;font-weight:900;letter-spacing:-.03em;line-height:1;margin-bottom:2px}

/* pipeline */
.lp .pipe{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
.lp .step{background:var(--elevated);border:1px solid var(--hairline);border-radius:var(--r-card);padding:22px 20px;position:relative;
  overflow:hidden;transition:transform .25s,box-shadow .25s,border-color .25s}
.lp .step:hover{transform:translateY(-3px);box-shadow:var(--sh-2);border-color:var(--ink-faint)}
.lp .step .n{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;font-size:13px;font-weight:800;color:#fff;background:var(--grad);margin-bottom:14px}
.lp .step h4{font-size:15.5px;margin-bottom:5px}
.lp .step p{font-size:13px;color:var(--ink-muted);line-height:1.45}
.lp .step .sweep{position:absolute;left:0;right:0;bottom:0;height:2px;background:var(--grad);transform:scaleX(0);transform-origin:left;transition:transform .4s}
.lp .step:hover .sweep{transform:scaleX(1)}

/* split rows */
.lp .row{display:grid;grid-template-columns:1fr 1fr;gap:56px;align-items:center;margin-bottom:34px}
.lp .row.rev .rtext{order:2}
.lp .row .rtext h3{font-size:clamp(22px,2.5vw,32px);margin-bottom:14px}
.lp .row .rtext p{color:var(--ink-soft);font-size:16px;margin-bottom:16px;line-height:1.55}
.lp .checklist{list-style:none;display:grid;gap:11px}
.lp .checklist li{position:relative;padding-left:30px;color:var(--ink-soft);font-size:15px}
.lp .checklist li svg{position:absolute;left:0;top:2px;width:20px;height:20px;color:var(--accent)}
.lp .visual{background:var(--elevated);border:1px solid var(--hairline);border-radius:var(--r-lg);padding:24px;box-shadow:var(--sh-2);min-height:250px;position:relative;overflow:hidden}
.lp .code{background:#0e0c08;border:1px solid #241f18;border-radius:var(--r-card);padding:20px;
  font-family:"SF Mono",ui-monospace,Menlo,monospace;font-size:12.5px;line-height:1.7;color:#d9d3c7;overflow-x:auto;white-space:pre}
.lp .code .k{color:#f0a15a}.lp .code .s{color:#7fd6c2}.lp .code .m{color:#8fb0ff}
.lp .dash h4{font-size:14px;margin-bottom:4px}
.lp .dash .sm{font-size:12px;color:var(--ink-muted);margin-bottom:16px}
.lp .emptystate{border:1.5px dashed var(--hairline);border-radius:var(--r-card);padding:26px;text-align:center;background:var(--surface)}
.lp .emptystate .eic{width:46px;height:46px;border-radius:50%;margin:0 auto 12px;display:grid;place-items:center;background:var(--grad-soft);color:var(--accent)}
.lp .emptystate b{display:block;font-size:14.5px;margin-bottom:4px}
.lp .emptystate span{font-size:12.5px;color:var(--ink-muted)}
.lp .barrow{display:flex;align-items:flex-end;gap:9px;height:118px;margin-top:14px}
.lp .bcol{flex:1;background:var(--grad);border-radius:7px 7px 0 0;animation:lpgrow 1s cubic-bezier(.2,.8,.2,1) both}
@keyframes lpgrow{from{height:0}}
.lp .barcap{display:flex;justify-content:space-between;color:var(--ink-faint);font-size:11.5px;margin-top:8px}

/* constellation */
.lp .constel-sec{background:var(--surface);border-radius:var(--r-xl);margin:0 24px;overflow:hidden;position:relative}
.lp .constel-in{display:grid;grid-template-columns:.92fr 1.08fr;gap:48px;align-items:center;max-width:var(--content);margin:0 auto;padding:clamp(48px,7vw,88px) 24px}
.lp .bignum{font-size:clamp(40px,5.4vw,66px);font-weight:900;letter-spacing:-.04em;line-height:1}
.lp .constel{position:relative;width:100%;max-width:440px;margin:0 auto;aspect-ratio:1/1}
.lp .ring{position:absolute;border-radius:50%;border:1px dashed rgba(178,75,196,.34)}
.lp .ring.r1{inset:3%;animation:lpspin 48s linear infinite}
.lp .ring.r2{inset:20%;border-color:rgba(47,93,255,.3);animation:lpspin 36s linear infinite reverse}
.lp .ring.r3{inset:37%;border-color:rgba(255,106,44,.3);animation:lpspin 28s linear infinite}
@keyframes lpspin{to{transform:rotate(360deg)}}
.lp .links{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.lp .links line{stroke:url(#lp-cl);stroke-width:.5;stroke-dasharray:2.5 4;animation:lpdash 3.6s linear infinite;opacity:.6}
@keyframes lpdash{to{stroke-dashoffset:-13}}
.lp .core{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:112px;height:112px;border-radius:50%;
  background:var(--grad);background-size:180% 180%;display:grid;place-items:center;color:#fff;box-shadow:var(--sh-glow);z-index:3;
  animation:lpfeat 12s ease-in-out infinite alternate,lpbreathe 4s ease-in-out infinite}
@keyframes lpbreathe{0%,100%{transform:translate(-50%,-50%) scale(1)}50%{transform:translate(-50%,-50%) scale(1.05)}}
.lp .core b{font-size:40px;font-weight:900;line-height:1;display:block}
.lp .core span{display:block;font-size:9.5px;font-weight:800;letter-spacing:.14em;margin-top:3px;opacity:.95}
.lp .node{position:absolute;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:4px;z-index:4;opacity:0;animation:lpnodein .6s ease forwards}
@keyframes lpnodein{to{opacity:1}}
.lp .node .g{width:46px;height:46px;border-radius:50%;background:var(--elevated);border:1px solid var(--hairline);
  display:grid;place-items:center;font-size:22px;font-weight:700;box-shadow:var(--sh-1);animation:lpnpulse 3s ease-in-out infinite;transition:transform .25s,border-color .25s,color .25s}
.lp .node:hover .g{transform:scale(1.14);border-color:var(--accent);color:var(--accent)}
.lp .node .nm{font-size:11px;font-weight:600;color:var(--ink-muted)}
@keyframes lpnpulse{0%,100%{box-shadow:0 0 0 2px rgba(178,75,196,.22)}50%{box-shadow:0 0 0 10px transparent}}

/* stats */
.lp .statband{display:grid;grid-template-columns:repeat(4,1fr);gap:18px}
.lp .sb{background:var(--elevated);border:1px solid var(--hairline);border-radius:var(--r-lg);padding:26px;box-shadow:var(--sh-1);transition:transform .25s,box-shadow .25s}
.lp .sb:hover{transform:translateY(-3px);box-shadow:var(--sh-2)}
.lp .sb .n{font-size:clamp(30px,3.6vw,44px);font-weight:900;letter-spacing:-.03em;line-height:1;background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
.lp .sb .t{color:var(--ink-muted);font-size:13.5px;margin-top:9px;line-height:1.45}

/* persona / honest */
.lp .persona{background:var(--grad);border-radius:var(--r-xl);padding:2px;box-shadow:var(--sh-glow)}
.lp .persona-in{background:var(--elevated);border-radius:calc(var(--r-xl) - 2px);padding:clamp(30px,4vw,48px)}
.lp .persona .q{font-size:clamp(21px,2.6vw,32px);font-weight:600;line-height:1.42;letter-spacing:-.02em;max-width:28ch}
.lp .persona .q b{font-weight:800}
.lp .persona .attr{color:var(--ink-muted);margin-top:20px;font-size:15.5px;max-width:64ch;line-height:1.5}
.lp .honest{background:var(--elevated);border:1px solid var(--hairline);border-radius:var(--r-lg);padding:30px;box-shadow:var(--sh-1)}
.lp .honest ul{list-style:none;display:grid;gap:13px}
.lp .honest li{color:var(--ink-soft);font-size:15px;padding-left:32px;position:relative;line-height:1.5}
.lp .honest li .mk2{position:absolute;left:0;top:1px;font-size:16px}

/* CTA + footer */
.lp .ctaband{position:relative;border-radius:var(--r-xl);padding:clamp(44px,6vw,72px);text-align:center;overflow:hidden;
  background:var(--grad);background-size:180% 180%;animation:lpfeat 16s ease-in-out infinite alternate;box-shadow:var(--sh-glow)}
.lp .ctaband h2{color:#fff}
.lp .ctaband p{color:rgba(255,255,255,.9);max-width:52ch;margin:14px auto 28px}
.lp .ctaband .btn.ghost{background:rgba(255,255,255,.14);border-color:rgba(255,255,255,.3);color:#fff}
.lp .ctaband .btn.ghost:hover{background:rgba(255,255,255,.22)}
.lp .ctaband .btn.white{background:#fff;color:#171310}
.lp footer{padding:56px 0 60px;border-top:1px solid var(--hairline);margin-top:8px}
.lp .foot{display:flex;justify-content:space-between;gap:28px;flex-wrap:wrap;align-items:flex-start}
.lp .foot .tag{color:var(--ink-muted);font-size:14px;margin-top:12px;max-width:34ch;line-height:1.5}
.lp .fchips{display:flex;gap:8px;flex-wrap:wrap;max-width:420px}
.lp .chip{font-size:12.5px;color:var(--ink-muted);border:1px solid var(--hairline);background:var(--elevated);padding:6px 12px;border-radius:var(--r-pill)}
.lp .fcredit{margin-top:34px;padding-top:22px;border-top:1px solid var(--hairline);color:var(--ink-faint);font-size:13px;display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}
.lp .fcredit b{color:var(--ink-soft)}

/* reveal */
.lp .reveal{opacity:0;transform:translateY(30px);transition:opacity .7s cubic-bezier(.22,.7,.2,1),transform .7s cubic-bezier(.22,.7,.2,1)}
.lp .reveal.in{opacity:1;transform:none}

/* intro */
.lp #lp-intro{position:fixed;inset:0;z-index:90;background:var(--canvas);display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:26px;transition:opacity .7s ease,transform .7s ease}
.lp #lp-intro.hide{opacity:0;transform:scale(1.04);pointer-events:none}
.lp #lp-intro .glyph{font-size:clamp(120px,20vw,200px);font-weight:900;line-height:1;min-width:1.1em;text-align:center;
  background:var(--grad);background-size:200% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;
  animation:lpbreathe2 1.5s ease-in-out infinite,lpflow 5s ease-in-out infinite alternate}
@keyframes lpbreathe2{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}
.lp #lp-intro .cap{color:var(--ink-muted);font-size:13px;letter-spacing:.2em;text-transform:uppercase;font-weight:700}

/* responsive */
@media(max-width:1000px){
  .lp .bento{grid-template-columns:repeat(4,1fr)}
  .lp .card.feat{grid-column:span 4;grid-row:auto;min-height:230px}
  .lp .card.c4,.lp .card.c3{grid-column:span 4}.lp .card.c2{grid-column:span 2}
  .lp .pipe{grid-template-columns:repeat(2,1fr)}
  .lp .statband{grid-template-columns:repeat(2,1fr)}
  .lp .constel-in{grid-template-columns:1fr;gap:36px}
}
@media(max-width:860px){
  .lp .navlinks{display:none}
  .lp .hero-grid,.lp .row{grid-template-columns:1fr;gap:36px}
  .lp .row.rev .rtext{order:0}
  .lp .stage{min-height:auto}
  .lp .foot{flex-direction:column;gap:20px}
}
@media(max-width:560px){
  .lp .wrap{padding:0 18px}
  .lp h1{font-size:clamp(34px,10vw,46px)}
  .lp .bento{grid-template-columns:1fr}
  .lp .card.feat,.lp .card.c4,.lp .card.c3,.lp .card.c2{grid-column:auto}
  .lp .pipe{grid-template-columns:1fr}.lp .statband{grid-template-columns:1fr}
  .lp .constel-sec{margin:0 12px}.lp .constel{max-width:300px}
  .lp .node .nm{display:none}.lp .node .g{width:40px;height:40px;font-size:19px}
  .lp .cta-row .btn{flex:1}
  .lp .btn{padding:12px 16px}
}
@media(prefers-reduced-motion:reduce){
  .lp *{animation:none!important}
  /* Transitions are not animations — the hover lift survives the rule above. */
  .lp .btn,.lp .btn.arrow svg{transition:none}
  .lp .btn:hover{transform:none}
  .lp .reveal{opacity:1;transform:none;transition:none}
  .lp .msg{opacity:1;transform:none}
  .lp .node{opacity:1}
}
`;
