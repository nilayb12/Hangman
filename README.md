# Hangman

A Hangman game made using Javascript, HTML, and CSS.

Play: [nilayb12.github.io/Hangman](https://nilayb12.github.io/Hangman)

## Structure

```
index.html
manifest.webmanifest
sw.js                    service worker (must stay at root)
icon-192.png  icon-512.png  icon-maskable-512.png
styles/    styles.css  fonts.css
scripts/   hangman.js (unchanged)  request.js  app.js
fonts/     4 self-hosted woff2
data/      words.json  README.md
```

`hangman.js` is untouched. Everything else works through its existing public
surface: `puzzle`, `statusMessage`, `remainingGuesses`, `status`,
`guessedLetters`, `word`.

## PWA

Installable and playable offline. Three things matter for GitHub Pages:

- `sw.js` sits at the **repo root**. A service worker only controls pages at or
  below its own directory, so `scripts/sw.js` would control nothing.
- Every path is **relative** (`./index.html`, `register('sw.js')`), so the app
  works at `/Hangman/` without hardcoding the sub-path. `start_url: "/"` is the
  classic failure: it installs fine, then launches the wrong page.
- The cache name is **versioned** (`hangman-v1`). GitHub Pages serves assets
  with a short max-age, so bump it on release or users can be pinned to an old
  build. `activate` deletes every other cache.

The shell is 15 files, ~115KB. Calls to the word service are never cached — a
stale phrase is a spoiled game, and `request.js` already falls back to
`data/words.json` when the network is gone.

Fonts are self-hosted (latin subset, only the 4 weights the stylesheet uses)
so the installed app renders correctly with no network.

## Word source

`puzzle.mead.io` was retired and its DNS record removed. Words now come from
[random-word-api](https://random-word-api.herokuapp.com), one request per game.

Two constraints from that API shape `request.js`:

**`diff` only applies to requests of 5 words or fewer.** Above that the server
accepts the parameter and silently ignores it. So the request asks for exactly
`WORDS` (3) and never over-fetches. Raising `WORDS` past 5 disables difficulty
without any error.

**Low `diff` values are the slow path.** It appears to filter by rejection
sampling, so `diff=1` has been observed taking 29s and returning 503 at
Heroku's 30s router timeout, while the same request without `diff` answers in
under a second. `getPuzzle` therefore aborts at 9s and retries once without the
filter — a phrase at the wrong rarity beats no game at all.

## Difficulty

Five levels map directly to the API's `diff` parameter, which filters on
Wikipedia word frequency. Measured mean Zipf frequency across 30 words per
level:

| Level | `diff` | Mean Zipf | Examples |
|-------|--------|-----------|----------|
| 1 | 1 | 2.12 | become, hometown, clocked |
| 5 | 5 | 0.33 | assegai, chalcedonic, fleabane |

The selection persists in `localStorage` under `hangman-level`, wrapped in
try/catch — if storage is unavailable you lose persistence and nothing else.

Note that level 1 is less common than the API docs suggest (they promise
"water", "house"; the measured median is 1.94), and its word pool is small
enough that repeats within a session are likely.

## Tunable knobs

| What | Where |
|------|-------|
| Words per phrase | player-selectable 1-5; ceiling is the `diff` limit |
| Guesses allowed | `MAX_GUESSES` in `app.js` — the gallows has 5 parts |
| Request timeout | `REQUEST_TIMEOUT` in `request.js` |
| Palette | `:root` custom properties in `styles/styles.css` |

## Win state

A win stamps the drawing VOID -- the gallows never got built, so the sheet is
cancelled the way a drawing office cancels a superseded design. It is a class
toggle (`.gallows.is-void`) with a CSS transition rather than a keyframe
animation, so under `prefers-reduced-motion` the stamp appears instantly
instead of disappearing along with the motion.

## Accessibility

Palette values are checked against WCAG AA on the panel background: chalk
12.5:1, pale 7.5:1, oxide 4.5:1, hairlines 3.0:1. If you retune `:root`,
re-check them -- the first draft failed on three counts.

The puzzle renders as decorative spans with `aria-hidden`, and a visually
hidden live region carries the spoken form plus the guess count, since the
tally marks are the only other place that number appears.

## Input

Physical keyboard uses `keydown`, so `e.key` gives `Enter` and `Backspace` as
named keys that the `/^[a-z]$/i` guard rejects rather than spending a guess on.
The on-screen keyboard calls the same handler, which is what makes the game
playable on touch devices.

Both fire together on desktop once a key has focus. That is harmless because
`makeGuess` checks `isUnique` before decrementing — worth knowing if
`hangman.js` is ever refactored.
