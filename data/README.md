# data/words.json

Offline fallback used when the word service is unreachable.

## Provenance

**Words** come from `random-word-api.herokuapp.com/all` — the same 178,187-word
dictionary the live game draws from, so an offline phrase is always one the
API could also have served. Filtered to 4-9 alphabetic characters.

**Tiering** comes from [`wordfreq`](https://github.com/rspeer/wordfreq) (Robyn
Speer). `/all` carries no frequency information, so it cannot tier itself —
43% of it sits at Zipf 0, meaning a random split would make all five levels
feel identically obscure. Bands, chosen so level 1 is everyday without being
stopwords:

| Level | Zipf band | Character |
|-------|-----------|-----------|
| 1 | 4.2 – 5.6 | everyday (`adventure`, `afford`) |
| 2 | 3.4 – 4.2 | common |
| 3 | 2.6 – 3.4 | moderate |
| 4 | 1.6 – 2.6 | uncommon |
| 5 | below 1.6 | rare (`agrafe`, `adunc`) |

The 5.6 ceiling on level 1 excludes stopwords — `that`, `with`, `have` are the
most common words in English and among the worst possible puzzles.

wordfreq's code is Apache-2.0; its underlying frequency data is CC-BY-SA 4.0
and derives from Google Books Ngrams and other corpora. Only the ordering is
taken from it, but attribution is the safe course if this repo is later given
a license.

## `blocked`

`/all` contains slurs, so the live API can serve one. The `blocked` array holds
341 stems (from `better-profanity` plus the LDNOOBW list) that are matched as
**substrings**, not whole words — every off-the-shelf list contains `faggot`
but not `faggots`, and the plural is what the API actually returned in testing.

Substring matching over-blocks: `class`, `assess` and `cumin` are casualties.
That is deliberate. Each tier needs 250 words from a pool of 3,600-60,000, so a
false positive costs nothing while a false negative ships a slur.

`request.js` applies the same list to live API responses, requesting 5 words to
fill 3 and topping up from the bundled tier if filtering leaves it short.

## Rebuilding

Fetch `/all` once, filter to 4-9 alphabetic characters, drop anything matching
a blocked stem, then bin by `wordfreq.zipf_frequency(word, 'en')` using the
bands above, sampling evenly across each band.
