// puzzle.mead.io was retired, so words now come from random-word-api.
//
// Difficulty rides on the endpoint's own `diff` parameter, which filters by
// Wikipedia word frequency. Measured over 30 words per level, mean Zipf
// frequency runs 2.12 at diff=1 (become, hometown, clocked) down to 0.33 at
// diff=5 (assegai, chalcedonic, bourgeoisifies).
//
// Two constraints shape the request:
//
//   1. `diff` is only honoured for 5 or fewer words. Above that the server
//      silently ignores it, so we ask for exactly as many words as the phrase
//      needs and never over-fetch. That also keeps the load on a free dyno to
//      a handful of words per game.
//
//   2. `diff` appears to filter by rejection sampling, so low values are the
//      slow path: diff=1 has been observed taking 29s and returning 503 at
//      Heroku's 30s router timeout, while the same request without `diff`
//      answers in under a second. Hence the timeout and the fallback below.

const ENDPOINT = 'https://random-word-api.herokuapp.com/word'
const REQUEST_TIMEOUT = 9000

// The dictionary behind /all contains slurs, so the live API can serve one.
// We over-request slightly and filter, keeping within the 5-word `diff`
// ceiling. Blocklist ships in data/words.json.
const FETCH_COUNT = 5

// Phrase length is player-selectable from 1 to 5. The ceiling is not a design
// choice: `diff` stops applying above 5 words, so asking for 6 would silently
// disable difficulty.
const WORD_CHOICES = [1, 2, 3, 4, 5]
const DEFAULT_WORDS = 3

const LEVELS = {
    1: { diff: 1, note: 'common'            },
    2: { diff: 2, note: 'fairly common'     },
    3: { diff: 3, note: 'moderately common' },
    4: { diff: 4, note: 'uncommon'          },
    5: { diff: 5, note: 'rare'              }
}

const DEFAULT_LEVEL = 3

const fetchWords = async (count, diff) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)
    const query = diff === null
        ? `number=${count}`
        : `number=${count}&diff=${diff}`

    try {
        const response = await fetch(`${ENDPOINT}?${query}`, {
            signal: controller.signal
        })
        if (response.status !== 200) {
            throw new Error(`Word service returned ${response.status}`)
        }
        return await response.json()
    } finally {
        clearTimeout(timer)
    }
}

// Offline fallback. Words come from the same dictionary the API serves
// (its /all dump), binned into the five levels by Wikipedia/Google-Ngrams
// word frequency. See data/README.md for provenance.
let wordData = null

const getWordData = async () => {
    if (!wordData) {
        const response = await fetch('./data/words.json')
        wordData = await response.json()
    }
    return wordData
}

// Substring match, not whole-word: "faggot" is on every blocklist but
// "faggots" is not, and the plural is what the API actually served.
const isAllowed = (word, blocked) =>
    /^[a-z]+$/i.test(word) && !blocked.some((stem) => word.includes(stem))

const pickOffline = async (level, count, exclude = []) => {
    const { tiers } = await getWordData()
    const pool = tiers[String(level)] || tiers[String(DEFAULT_LEVEL)]
    const picked = []

    while (picked.length < count) {
        const word = pool[Math.floor(Math.random() * pool.length)]
        if (!picked.includes(word) && !exclude.includes(word)) {
            picked.push(word)
        }
    }
    return picked
}

const getPuzzle = async (level, wordCount) => {
    const key = LEVELS[level] ? level : DEFAULT_LEVEL
    const spec = LEVELS[key]
    const count = WORD_CHOICES.includes(Number(wordCount))
        ? Number(wordCount)
        : DEFAULT_WORDS

    const { blocked } = await getWordData()

    let words
    try {
        words = await fetchWords(FETCH_COUNT, spec.diff)
    } catch (e) {
        try {
            // The difficulty filter is the fragile path. A phrase at the
            // wrong rarity beats no game at all, so retry once without it.
            words = await fetchWords(FETCH_COUNT, null)
        } catch (e2) {
            // No network at all. The bundled list keeps the level meaningful,
            // which the unfiltered retry above cannot.
            words = await pickOffline(key, count)
        }
    }

    const pool = words
        .filter((word) => isAllowed(word, blocked))
        .map((word) => word.toLowerCase())
        .slice(0, count)

    // Filtering can leave us short, and at 5 words there is no slack at all
    // since FETCH_COUNT is capped by the `diff` ceiling. Top up from the
    // bundled tier rather than spending another request on a free dyno.
    if (pool.length < count) {
        pool.push(...await pickOffline(key, count - pool.length, pool))
    }

    return pool.join(' ')
}
