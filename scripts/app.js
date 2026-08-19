let game1

const puzzleDIV    = document.querySelector('#puzzle')
const puzzleSR     = document.querySelector('#puzzle-sr')
const verdictP     = document.querySelector('#verdict')
const tallySPAN    = document.querySelector('#tally')
const remainingEL  = document.querySelector('#remaining')
const missedEL     = document.querySelector('#missed')
const keyboardDIV  = document.querySelector('#keyboard')
const resetBTN     = document.querySelector('#reset')
const scaleDIV     = document.querySelector('#scale')
const scaleNoteP   = document.querySelector('#scale-note')
const figureParts  = document.querySelectorAll('.gallows__figure > *')
const gallowsSVG   = document.querySelector('.gallows')

const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm']
const MAX_GUESSES = 5
const STORE_KEY = 'hangman-level'

let level = DEFAULT_LEVEL

/* ---------- difficulty ---------- */

// Wrapped because storage throws in some embedded contexts, and a saved
// preference is never worth breaking the game over.
const readLevel = () => {
    try {
        const saved = Number(window.localStorage.getItem(STORE_KEY))
        return LEVELS[saved] ? saved : DEFAULT_LEVEL
    } catch (e) {
        return DEFAULT_LEVEL
    }
}

const saveLevel = (value) => {
    try {
        window.localStorage.setItem(STORE_KEY, value)
    } catch (e) {
        /* preference simply won't persist */
    }
}

const buildScale = () => {
    Object.keys(LEVELS).forEach((key) => {
        const value = Number(key)

        const input = document.createElement('input')
        input.type = 'radio'
        input.name = 'level'
        input.id = `level-${value}`
        input.value = value
        input.className = 'scale__input'
        input.checked = value === level

        const label = document.createElement('label')
        label.setAttribute('for', input.id)
        label.className = 'scale__seg'
        label.textContent = value
        label.title = LEVELS[value].note

        // Changing difficulty starts a fresh phrase; a round is a few seconds
        // long, so there is nothing worth preserving.
        input.addEventListener('change', () => {
            level = value
            saveLevel(value)
            renderScaleNote()
            startGame()
        })

        scaleDIV.appendChild(input)
        scaleDIV.appendChild(label)
    })
}

const renderScaleNote = () => {
    scaleNoteP.textContent = LEVELS[level].note
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
}

// Physical keyboard. keydown gives us e.key, so Enter arrives as "Enter"
// and is rejected by the regex above instead of costing a guess.
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
                // Only letters revealed by this guess animate. Without the
                // comparison the whole phrase re-inks on every render.
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

const renderVerdict = () => {
    verdictP.className = 'verdict'
    gallowsSVG.classList.toggle('is-void', game1.status === 'finished')

    if (game1.status === 'playing') {
        verdictP.textContent = ''
    } else if (game1.status === 'failed') {
        verdictP.classList.add('verdict--lost')
        verdictP.textContent = game1.statusMessage
    } else {
        verdictP.classList.add('verdict--won')
        verdictP.textContent = game1.statusMessage
    }
}

const render = () => {
    renderPuzzle()
    renderKeyboard()
    renderBlock()
    renderVerdict()
}

/* ---------- lifecycle ---------- */

// Each startGame call takes a ticket. A response that comes back after a
// newer game has started is dropped, otherwise a slow request can overwrite
// the phrase belonging to a level the player has already moved on from.
let runId = 0

const setMessage = (text, variant) => {
    verdictP.className = `verdict verdict--${variant}`
    verdictP.textContent = text
}

const lockKeyboard = () => {
    keyButtons.forEach((btn) => {
        btn.disabled = true
        btn.classList.remove('key--hit', 'key--miss')
    })
}

const startGame = async () => {
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
        const puzzle = await getPuzzle(level)
        if (id !== runId) {
            return
        }
        game1 = new Hangman(puzzle, MAX_GUESSES)
        render()
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

level = readLevel()
buildKeyboard()
buildScale()
renderScaleNote()
resetBTN.addEventListener('click', startGame)
startGame()
