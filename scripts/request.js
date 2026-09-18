// puzzle.mead.io was retired, so words now come from random-word-api.
//
// Difficulty rides on the endpoint's own `diff` parameter, which filters by
// Wikipedia word frequency. Measured over 30 words per level, mean Zipf
// frequency runs 2.12 at diff=1 (become, hometown, clocked) down to 0.33 at
// diff=5 (assegai, chalcedonic, bourgeoisifies).
//
// Two constraints shape the request:
//
//   1. `diff` is only honoured for requests of 5 or fewer words. Above that the
//      server ignores it, so we request exactly the number of words needed.
//
//   2. Low `diff` values can be very slow (occasionally timing out with a 503),
//      while a request without `diff` returns quickly. Hence the request
//      timeout and the fallback below.

const ENDPOINT = 'https://random-word-api.herokuapp.com/word'
const REQUEST_TIMEOUT = 9000

// The API's dictionary contains offensive words, so results are filtered against
// a blocklist (shipped in data/words.json). We request a few extra words to
// allow for removals, staying within the 5-word `diff` ceiling.
const FETCH_COUNT = 5

// Phrase length is player-selectable from 1 to 5 words. The maximum is 5
// because `diff` (difficulty) stops applying to larger requests.
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
            // Retry without the difficulty filter, which is the part most
            // likely to be slow or fail.
            words = await fetchWords(FETCH_COUNT, null)
        } catch (e2) {
            // Offline: use the bundled word list, which is organised by
            // difficulty level.
            words = await pickOffline(key, count)
        }
    }

    const pool = words
        .filter((word) => isAllowed(word, blocked))
        .map((word) => word.toLowerCase())
        .slice(0, count)

    // If filtering left too few words, top up from the bundled list rather than
    // making another network request.
    if (pool.length < count) {
        pool.push(...await pickOffline(key, count - pool.length, pool))
    }

    return pool.join(' ')
}
