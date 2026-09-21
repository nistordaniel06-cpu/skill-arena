# Ghost Rush MVP

Playable mobile-first vertical slice for the Ghost Rush concept.

## Current gameplay
- 30-second skill run
- Three-lane swipe/tap controls
- Deterministic daily course
- Blocks slow the player; green pads boost progress
- Ghost opponent target: 21.43s
- Local personal best and replay inputs
- Instant rematch
- Web Share / clipboard challenge flow
- Mobile-first neon UI

## Run locally

From this folder:

```bash
python -m http.server 8080
```

Open `http://localhost:8080`.

You can also open `index.html` directly in a browser, though serving it locally is preferred.

## Controls
- Mobile: swipe left/right or tap the left/right side of the game
- Desktop: left/right arrow keys or A/D

## Next build steps
1. Replace the placeholder runner/ghost shapes with authored art and animation.
2. Store ghost run data and leaderboard results in Supabase.
3. Generate challenge IDs so another device can race the exact recorded run.
4. Add authentication and profiles.
5. Add a second micro-game and shared season progression.
6. Add analytics events for start, completion, rematch, share, and retention.
7. Package the validated core loop for Android/iOS.

The MVP intentionally keeps monetization out of the first gameplay test. Validate repeat play and challenge sharing first, then add rewarded ads/cosmetics.
