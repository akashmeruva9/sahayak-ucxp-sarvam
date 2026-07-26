/** Sarvam monochrome theme.
 *
 * Every colour in the app comes from this file. The approved design used an
 * indigo palette; each role below maps one-to-one onto the design token it
 * replaces, so layout work can be copied across without re-deciding colour.
 *
 *   design #4C3F86 primary        -> ink.DEFAULT #0A0A0A
 *   design #3E3370 primary hover  -> ink.hover   #000000
 *   design #FBFBFD page canvas    -> canvas      #FFFFFF
 *   design #F6F6F9 …  surfaces    -> surface     #FAFAFA   (one step, no more)
 *   design #E7E7EE border         -> line        #E8E8E8
 *   design #F0F0F4 inner divider  -> line.soft   #F0F0F0
 *   design #17171C text           -> ink         #0A0A0A
 *   design #71717F muted          -> muted       #6B6B6B
 *   design #A9A9B8 faint          -> faint       #9B9B9B
 *   design #16A34A success        -> ok          #14A05A
 *   design #DC2626 error          -> err         #D93025
 *   design #232236 dark pane      -> pane.*      #0A0A0A / #E8E8E8
 */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#FFFFFF',
        surface: {
          DEFAULT: '#FAFAFA',
          deep: '#F0F0F0',
        },
        line: {
          DEFAULT: '#E8E8E8',
          soft: '#F0F0F0',
          dashed: '#DDDDDD',
        },
        ink: {
          DEFAULT: '#0A0A0A',
          hover: '#000000',
          muted: '#6B6B6B',
          faint: '#9B9B9B',
        },
        ok: {
          DEFAULT: '#14A05A',
          tint: '#F0FAF4',
          line: '#CDEBDA',
          deep: '#0E7A43',
        },
        err: {
          DEFAULT: '#D93025',
          tint: '#FDF3F2',
          line: '#F2D5D2',
          deep: '#A3241C',
        },
        warn: {
          DEFAULT: '#B45309',
          tint: '#FDF7EE',
        },
        pane: {
          bg: '#0A0A0A',
          bar: '#121212',
          border: '#242424',
          text: '#E8E8E8',
          dim: '#6B6B6B',
          gutter: '#3A3A3A',
          hover: '#1C1C1C',
        },
        // JSON syntax tokens, tuned for contrast on #0A0A0A.
        code: {
          key: '#E8E8E8',
          punct: '#6B6B6B',
          string: '#8FCFAA',
          number: '#D8B57A',
          bool: '#C2A5D8',
        },
      },
      borderRadius: {
        card: '10px',
        input: '8px',
        btn: '6px',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
        indic: [
          'Inter', 'Noto Sans Telugu', 'Noto Sans Devanagari', 'Noto Sans Tamil',
          'Noto Sans Kannada', 'Noto Sans Malayalam', 'Noto Sans Bengali',
          'Noto Sans Gujarati', 'Noto Sans Gurmukhi', 'Noto Sans Oriya',
          'Noto Nastaliq Urdu', 'sans-serif',
        ],
      },
      letterSpacing: {
        tight: '-0.02em',
      },
      boxShadow: {
        focus: '0 0 0 3px rgba(10,10,10,0.08)',
      },
      keyframes: {
        rise: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'none' },
        },
        spin: { to: { transform: 'rotate(360deg)' } },
        marquee: {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(-50%)' },
        },
      },
      animation: {
        rise: 'rise 250ms ease-out',
        spin: 'spin 0.7s linear infinite',
        marquee: 'marquee 60s linear infinite',
      },
    },
  },
  plugins: [],
};
