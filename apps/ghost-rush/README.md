# Ghost Rush V2

Mobile-first competitive micro-game prototype with real recorded challenge links.

## V2 features
- Deterministic daily Speed Grid course
- Swipe/tap three-lane controls
- Obstacles, boost pads and instant rematch
- Recorded lane-change ghost replay
- Supabase-backed anonymous player sessions
- Player profile, coins and rank points
- Online daily leaderboard
- Real challenge codes (`?c=...`) that load another player's run
- Web Share / clipboard challenge sharing
- Installable PWA shell + offline cache
- Local fallback mode if the backend is unavailable

## Run locally

```bash
cd apps/ghost-rush
python -m http.server 8080
```

Open `http://127.0.0.1:8080`.

## Online mode
The client is wired to the configured Supabase project in `config.js`. The database uses the isolated `ghost_profiles`, `ghost_runs`, and `ghost_challenges` tables with RLS. Anonymous Sign-Ins must be enabled in Supabase Auth for zero-friction online play. If Auth is unavailable, the game automatically remains playable in local mode.

## Controls
- Mobile: swipe left/right or tap either side of the playfield
- Desktop: Arrow Left/Right or A/D

## Current security boundary
V2 uses RLS for row ownership and database access, but gameplay scoring is still client-reported. Treat rankings and coins as beta/non-cash values until run validation becomes server-authoritative.

## V3 target
- Server-authoritative run validation / anti-cheat
- Better animated character + authored world art
- Second mini-game
- Seasons, quests and cosmetics
- Push/share deep links
- Capacitor/native packaging for Android and iOS
- Analytics + retention funnel
