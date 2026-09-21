# Ghost Rush V3

Mobile-first competitive micro-game prototype focused on fast replayable cyber sprints against recorded player ghosts.

## V3 features
- Deterministic daily Speed Grid course
- 3-lane swipe/tap controls
- Real recorded ghost replay
- Challenge links (`?c=...`) that load another player's run
- Supabase anonymous player sessions
- Online daily leaderboard
- Player profiles, rank points and coins
- Countdown + synthesized game audio + mobile haptics
- Cyber-city canvas art, speed lines, screen shake and impact feedback
- Obstacles, boost gates and collectible shards
- Combo system and per-run rewards
- Daily mission: collect 8 shards for a bonus
- Installable portrait PWA with V3 cache refresh
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

`index.html` automatically routes to `v3.html` and preserves challenge query parameters. V2 source remains in `app.js` for fallback/reference; the active V3 engine is `v3.js`.

## Online mode
The client uses the configured Supabase project in `config.js` and the isolated `ghost_profiles`, `ghost_runs`, and `ghost_challenges` tables. RLS is enabled. Anonymous Sign-Ins must be enabled in Supabase Auth for zero-friction online play.

## Controls
- Mobile: swipe left/right or tap either side of the playfield
- Desktop: Arrow Left/Right or A/D

## Security boundary
Rankings, rewards and run times are still client-reported in this beta. Before any cash-value economy, paid competitive entry, or meaningful prizes, move run validation and rewards server-side and add anti-cheat validation.

## Next milestone
1. Server-authoritative run validation / anti-cheat
2. Second mini-game sharing the same profile/season economy
3. Cosmetics and unlockable ghost bodies/trails
4. Analytics for start -> finish -> rematch -> share -> D1 retention
5. Native packaging for Android/iOS
6. Store assets, onboarding, privacy policy and closed beta
