/** The Sahayak mark.
 *
 * A speech bubble with a voice waveform inside it: the product listens to a
 * customer and answers, in their language. Those are the two things it does, so
 * they are the two things in the mark.
 *
 * Drawn inline rather than shipped as an asset so it cannot 404, needs no build
 * step, and inherits the theme. Colour comes from Tailwind classes resolving
 * through `currentColor` on each element -- no hex is written here, per the
 * project rule that every colour lives in tailwind.config.js.
 *
 * It is built on a 24-unit grid and reads correctly down to 20px, which is the
 * smallest it is used at.
 */
export default function Logo({ className = 'h-7 w-7', title }) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-input bg-ink ${className}`}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : 'true'}
    >
      <svg viewBox="0 0 24 24" className="h-[68%] w-[68%]" fill="none">
        {/* The bubble, filled in the canvas colour so the mark reads as a
            cut-out of the tile rather than an outline drawn on top of it. */}
        <path
          className="text-canvas"
          fill="currentColor"
          d="M7 3.75h10A4.25 4.25 0 0 1 21.25 8v4.5A4.25 4.25 0 0 1 17 16.75h-4.28l-3.3
             2.86a.85.85 0 0 1-1.42-.64V16.7A4.25 4.25 0 0 1 2.75 12.5V8A4.25 4.25 0 0 1 7 3.75Z"
        />
        {/* Three strokes, short-tall-medium: a voice, not a bar chart. */}
        <path
          className="text-ink"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          d="M9 8.9v2.9M12 7.2v6.3M15 8.4v3.9"
        />
      </svg>
    </span>
  );
}
