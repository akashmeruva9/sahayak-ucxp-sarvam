# OneSupport

**One Place. Every Business. Every Language.**

The reference client for the **Unified Customer Experience Protocol (UCXP)** — a single, premium mobile surface for completing customer jobs (track an order, cancel a service, book an appointment, raise a complaint) across any business, by text or voice.

> This is the **frontend only**. Every network call is mocked behind a clean API layer so the app is fully demo-ready today and drops onto a real backend with a one-file change per endpoint.

---

## Tech stack

| Concern            | Choice                                  |
| ------------------ | --------------------------------------- |
| Framework          | Expo SDK 57 · React Native 0.86 · React 19 |
| Language           | TypeScript (strict)                     |
| Navigation         | Expo Router (typed routes)              |
| Styling            | NativeWind 4 (Tailwind) · light + dark  |
| State              | Zustand                                 |
| Server state       | React Query                             |
| Forms              | React Hook Form                         |
| Animation          | Reanimated 4                            |
| Audio              | expo-audio (mic capture)                |
| Icons              | lucide-react-native                     |
| Fonts              | Inter (via @expo-google-fonts)          |

## Run it

```bash
cd frontend
npm install
npx expo start        # then press i (iOS), a (Android), or w (web)
```

Type-check and bundle checks:

```bash
npx tsc --noEmit
npx expo export --platform ios --output-dir /tmp/os-export
```

## Screen flow

```
Splash → Home → Conversation → Voice → History → Settings
```

- **Splash** — branded logo, loading dots, auto-advances to Home.
- **Home** — greeting, recent conversations, suggested actions grid, hero mic button, pinned composer.
- **Conversation** — ChatGPT-style thread with per-message business badges, structured outcome cards, typing animation, auto-scroll.
- **Voice** — full-screen overlay: animated waveform, live timer, mock transcription → feeds the chat pipeline.
- **History** — grouped by Today / Yesterday / Earlier (React Query over the mocked `GET /history`).
- **Settings** — theme (System/Light/Dark), language, About UCXP, app version.

## Folder structure

```
frontend/
├─ app/                       # Expo Router routes (thin — delegate to src/screens)
│  ├─ _layout.tsx             # providers, fonts, splash control, theme sync
│  ├─ index.tsx              # Splash
│  ├─ (tabs)/                 # Home · History · Settings + custom Navbar
│  └─ conversation/[id].tsx
└─ src/
   ├─ api/                    # chat.ts · voice.ts · history.ts · client.ts (all mocked)
   ├─ components/             # Button, Card, ChatBubble, VoiceButton, Waveform, …
   ├─ screens/                # Splash/Home/Conversation/History/Settings implementations
   ├─ hooks/                  # useChat, useHistory, useVoiceRecorder, useThemeColors
   ├─ store/                  # Zustand: conversations + settings
   ├─ constants/              # theme tokens, businesses, suggestions
   ├─ types/                  # shared domain types
   └─ utils/                  # time + id helpers
```

## Connecting the real backend

All I/O lives in `src/api`. The UI never calls the network directly. To go live:

1. `src/api/client.ts` — replace `networkDelay()` with a `fetch` wrapper pointed at `API_BASE_URL`.
2. `src/api/chat.ts` → `POST /chat`
3. `src/api/voice.ts` → `POST /voice` (upload the recorded blob URI from `useVoiceRecorder`)
4. `src/api/history.ts` → `GET /history`

Return the same typed shapes (`src/types`) and **no component changes are required**.
```
