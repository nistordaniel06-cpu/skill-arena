# Ghost Rush V4

Mobile-first competitive micro-game platform built around fast skill rounds, recorded player ghosts and instant challenge links.

## V4 features
- Two playable game modes sharing one profile/economy:
  - **Speed Grid** — 30-second cyber sprint with lanes, obstacles, boosts and shards
  - **Perfect Slice** — one-tap precision duel where the smallest percentage error wins
- Game selector on Home
- Mode-specific daily leaderboards
- Challenge links (`?c=...`) that reopen the correct game mode and recorded run
- Supabase anonymous sessions
- Player profile, coins, rank points, XP and level progression
- Daily mission: play both modes
- PWA install shell, portrait layout and V4 cache refresh
- Local fallback if online mode is unavailable

## Run locally

```bash
cd apps/ghost-rush
python -m http.server 8080
```

Open:

```text
http://127.0.0.1:8080
```

`index.html` now routes to `v4.html` while preserving challenge query parameters. V2/V3 files remain in the folder as rollback/reference versions.

## Backend
V4 uses the isolated `ghost_profiles`, `ghost_runs`, and `ghost_challenges` tables. `ghost_runs.game_mode` separates leaderboards and challenges by game type. `ghost_profiles.xp` persists level progression. RLS remains enabled.

## Current beta security boundary
Run scores and rewards are still client-reported. Keep coins, XP, rank and leaderboards non-cash/beta until validation is moved server-side and anti-cheat is added.

## Next milestone
1. Server-authoritative validation and reward calculation
2. Third micro-game
3. Ghost skins, trails and unlockable cosmetics
4. Season progression + weekly quests
5. Analytics for start → finish → rematch → share → retention
6. Android packaging, then iOS/TestFlight
