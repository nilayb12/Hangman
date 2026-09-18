let game1

const puzzleDIV    = document.querySelector('#puzzle')
const puzzleSR     = document.querySelector('#puzzle-sr')
const verdictP     = document.querySelector('#verdict')
const tallySPAN    = document.querySelector('#tally')
const remainingEL  = document.querySelector('#remaining')
const missedEL     = document.querySelector('#missed')
const keyboardDIV  = document.querySelector('#keyboard')
const resetBTN     = document.querySelector('#reset')
const resultCell   = document.querySelector('#result')
const scaleDIV     = document.querySelector('#scale')
const wordScaleDIV = document.querySelector('#wordscale')
const setupNoteP   = document.querySelector('#setup-note')
const figureParts  = document.querySelectorAll('.gallows__figure > *')
const gallowsSVG   = document.querySelector('.gallows')

const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm']
const MAX_GUESSES = 5
const STORE_KEY = 'hangman-level'
const WORDS_KEY = 'hangman-words'

let level = DEFAULT_LEVEL
let wordCount = DEFAULT_WORDS

/* ---------- difficulty ---------- */

// localStorage access can throw (private mode, embedded webviews). A saved
// preference is optional, so failures fall back to the default rather than
// breaking the game.
const readSetting = (key, valid, fallback) => {
    try {
        const saved = Number(window.localStorage.getItem(key))
        return valid(saved) ? saved : fallback
    } catch (e) {
        return fallback
    }
}

const saveSetting = (key, value) => {
    try {
        window.localStorage.setItem(key, value)
    } catch (e) {
        /* preference simply won't persist */
    }
}

// Difficulty and word-count use the same widget: a radio group whose change
// handler updates one setting and starts a new game. Changing either mid-game
// discards the current one, which is fine since a round is short.
const buildScale = (container, name, values, current, onPick, describe) => {
    values.forEach((value) => {
        const input = document.createElement('input')
        input.type = 'radio'
        input.name = name
        input.id = `${name}-${value}`
        input.value = value
        input.className = 'scale__input'
        input.checked = value === current

        const label = document.createElement('label')
        label.setAttribute('for', input.id)
        label.className = 'scale__seg'
        label.textContent = value
        label.title = describe(value)

        input.addEventListener('change', () => {
            onPick(value)
            renderSetupNote()
            startGame()
        })

        container.appendChild(input)
        container.appendChild(label)
    })
}

const renderSetupNote = () => {
    const plural = wordCount === 1 ? 'word' : 'words'
    setupNoteP.textContent = `${wordCount} ${LEVELS[level].note} ${plural}`
}

/* ---------- keyboard ---------- */

const keyButtons = new Map()

const buildKeyboard = () => {
    ROWS.forEach((row) => {
        const rowEl = document.createElement('div')
        rowEl.className = 'keys__row'

        row.split('').forEach((letter) => {
            const btn = document.createElement('button')
            btn.type = 'button'
            btn.className = 'key'
            btn.textContent = letter
            btn.dataset.letter = letter
            btn.setAttribute('aria-label', `Guess ${letter}`)
            btn.addEventListener('click', () => handleGuess(letter))
            keyButtons.set(letter, btn)
            rowEl.appendChild(btn)
        })

        keyboardDIV.appendChild(rowEl)
    })
}

/* ---------- input ---------- */

const handleGuess = (letter) => {
    if (!game1 || !/^[a-z]$/i.test(letter)) {
        return
    }
    game1.makeGuess(letter)
    render()
    if (onGameEvent) {
        const missed = game1.guessedLetters.filter((l) => !game1.word.includes(l))
        onGameEvent({
            type: 'progress',
            remaining: game1.remainingGuesses,
            missed: missed.length,
            status: game1.status
        })
    }
}

// keydown gives a named e.key, so Enter/Backspace/etc. arrive as words like
// "Enter" and are rejected by the single-letter regex rather than counting as
// a guess.
window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) {
        return
    }
    handleGuess(e.key)
})

/* ---------- render ---------- */

let lastPuzzle = ''

const renderPuzzle = () => {
    const current = game1.puzzle
    const failed  = game1.status === 'failed'

    // On a loss we show the answer in the slots instead of the mask.
    const display = failed ? game1.word.join('') : current

    puzzleDIV.innerHTML = ''

    // Splitting on the space keeps each word intact, so a long phrase wraps
    // between words rather than through the middle of one.
    let index = 0

    display.split(' ').forEach((word) => {
        const wordEl = document.createElement('div')
        wordEl.className = 'word'

        word.split('').forEach((letter) => {
            const slot = document.createElement('span')
            const wasHidden = current[index] === '*'
            const hidden = wasHidden && !failed

            slot.className = hidden ? 'slot slot--blank' : 'slot slot--filled'

            if (failed && wasHidden) {
                slot.classList.add('slot--revealed')
            } else if (!hidden && lastPuzzle[index] !== letter) {
                // Animate only the letters newly revealed by this guess.
                // Comparing against the previous render avoids re-animating
                // every letter each time the board redraws.
                slot.classList.add('slot--fresh')
            }

            slot.textContent = hidden ? '*' : letter
            wordEl.appendChild(slot)
            index++
        })

        index++ // the space between words
        puzzleDIV.appendChild(wordEl)
    })

    lastPuzzle = current

    // Sighted players read the tally; this is the only channel that carries
    // the same information to a screen reader.
    const spoken = current
        .split('')
        .map((c) => (c === '*' ? 'blank' : c === ' ' ? '\u2014' : c))
        .join(' ')
    puzzleSR.textContent =
        `${spoken}. ${game1.remainingGuesses} guesses left.`
}

const renderKeyboard = () => {
    const over = game1.status !== 'playing'

    keyButtons.forEach((btn, letter) => {
        const guessed = game1.guessedLetters.includes(letter)
        const inWord  = game1.word.includes(letter)

        btn.classList.toggle('key--hit',  guessed && inWord)
        btn.classList.toggle('key--miss', guessed && !inWord)
        btn.disabled = guessed || over
    })
}

const renderBlock = () => {
    const missed = game1.guessedLetters.filter((l) => !game1.word.includes(l))

    remainingEL.textContent = game1.remainingGuesses
    missedEL.textContent = missed.length ? missed.join(' ') : '\u2014'

    tallySPAN.innerHTML = ''
    for (let i = 0; i < MAX_GUESSES; i++) {
        const tick = document.createElement('i')
        if (i >= game1.remainingGuesses) {
            tick.className = 'is-spent'
        }
        tallySPAN.appendChild(tick)
    }

    // One figure part per wrong guess, counted from the letters themselves
    // so it stays correct no matter what MAX_GUESSES is set to.
    figureParts.forEach((part, i) => {
        part.classList.toggle('is-drawn', i < missed.length)
    })
}

// The end-of-game message. Composed here (rather than using the message from
// hangman.js) because the answer is several unrelated words shown in the slots,
// so there's no single "phrase" to repeat back.
const verdictText = () => {
    if (game1.status === 'failed') {
        return 'Out of guesses. The answer is above.'
    }

    // A win always leaves at least one guess: correct guesses don't decrement,
    // and a loss (zero remaining) is checked first.
    const left = game1.remainingGuesses

    if (left === MAX_GUESSES) {
        return 'Solved. Not a single wrong letter.'
    }
    return `Solved with ${left} ${left === 1 ? 'guess' : 'guesses'} to spare.`
}

const renderVerdict = () => {
    verdictP.className = 'verdict'
    gallowsSVG.classList.toggle('is-void', game1.status === 'finished')

    if (game1.status === 'playing') {
        verdictP.textContent = ''
        resultCell.hidden = true
        return
    }

    resultCell.hidden = false
    verdictP.classList.add(
        game1.status === 'failed' ? 'verdict--lost' : 'verdict--won'
    )
    verdictP.textContent = verdictText()
}

const render = () => {
    renderPuzzle()
    renderKeyboard()
    renderBlock()
    renderVerdict()
}

/* ---------- lifecycle ---------- */

// Guards against overlapping starts: each call claims a new id, and a fetch
// that resolves after a newer start began is discarded. Without this, a slow
// word fetch could overwrite a game the player has already restarted.
let runId = 0

const setMessage = (text, variant) => {
    verdictP.className = `verdict verdict--${variant}`
    verdictP.textContent = text
    resultCell.hidden = false
}

const lockKeyboard = () => {
    keyButtons.forEach((btn) => {
        btn.disabled = true
        btn.classList.remove('key--hit', 'key--miss')
    })
}

// Multiplayer passes a preset puzzle so both players get identical words;
// single-player leaves it undefined and fetches a new one.
let onGameEvent = null   // set by multiplayer to observe each guess
const startGame = async (presetPuzzle) => {
    const id = ++runId
    game1 = undefined
    lastPuzzle = ''
    puzzleDIV.innerHTML = ''
    puzzleSR.textContent = ''
    missedEL.textContent = '\u2014'
    remainingEL.textContent = ''
    tallySPAN.innerHTML = ''
    figureParts.forEach((part) => part.classList.remove('is-drawn'))
    gallowsSVG.classList.remove('is-void')
    lockKeyboard()
    resetBTN.disabled = true
    setMessage('Fetching a new puzzle\u2026', 'wait')

    try {
        const puzzle = presetPuzzle || await getPuzzle(level, wordCount)
        if (id !== runId) {
            return
        }
        game1 = new Hangman(puzzle, MAX_GUESSES)
        render()
        if (onGameEvent) onGameEvent({ type: 'start', puzzle })
    } catch (e) {
        if (id !== runId) {
            return
        }
        setMessage(
            'Could not reach the word service. Check your connection, then choose New game.',
            'error'
        )
    } finally {
        if (id === runId) {
            resetBTN.disabled = false
        }
    }
}

level = readSetting(STORE_KEY, (v) => !!LEVELS[v], DEFAULT_LEVEL)
wordCount = readSetting(WORDS_KEY, (v) => WORD_CHOICES.includes(v), DEFAULT_WORDS)

buildKeyboard()

buildScale(
    scaleDIV, 'level', Object.keys(LEVELS).map(Number), level,
    (v) => { level = v; saveSetting(STORE_KEY, v) },
    (v) => `${LEVELS[v].note} words`
)

buildScale(
    wordScaleDIV, 'words', WORD_CHOICES, wordCount,
    (v) => { wordCount = v; saveSetting(WORDS_KEY, v) },
    (v) => `${v} ${v === 1 ? 'word' : 'words'}`
)

renderSetupNote()

// Reset button. In single-player it starts a new local game; multiplayer
// replaces this handler so the host can drive rounds for both players.
let onResetClick = () => startGame()
resetBTN.addEventListener('click', () => onResetClick())

// Interface used by the multiplayer layer (menu.js). Single-player ignores it.
window.HangmanGame = {
    _word: () => game1 ? game1.word.join('') : null,
    start: (puzzle) => startGame(puzzle),
    setObserver: (fn) => { onGameEvent = fn },
    setResetHandler: (fn) => { onResetClick = fn },
    getWordConfig: () => ({ level, wordCount }),
    fetchPuzzle: () => getPuzzle(level, wordCount),
    // Clear the board and show a waiting message without fetching. Multiplayer
    // uses this so the finished board clears the moment New Game is pressed,
    // rather than lingering until the shared puzzle arrives over the network.
    showWaiting: (text) => {
        runId++   // discard any in-flight start so it can't render over this
        game1 = undefined
        lastPuzzle = ''
        puzzleDIV.innerHTML = ''
        puzzleSR.textContent = ''
        missedEL.textContent = '\u2014'
        remainingEL.textContent = ''
        tallySPAN.innerHTML = ''
        figureParts.forEach((part) => part.classList.remove('is-drawn'))
        gallowsSVG.classList.remove('is-void')
        resultCell.hidden = true
        lockKeyboard()
        setMessage(text || 'Waiting for the next round\u2026', 'wait')
    }
}

startGame()
