// menu.js — home screen, lobby, and multiplayer coordination.
//
// Sits on top of the single-player game (app.js), which it drives through the
// window.HangmanGame hook surface. Single-player is untouched: choosing it just
// shows the game screen that was already there.
//
// Multiplayer: host fetches one puzzle and sends it so both boards match, then
// each guess relays a small status object. First to solve wins; on a tie the
// fewest misses takes it. Connection is peer-to-peer via net.js.

import { createNet } from './net.js'

// Point this at your deployed Worker. For local testing, ws://127.0.0.1:8787.
const WORKER_URL = 'wss://hangman-signal.nilayb221299.workers.dev'

const $ = (id) => document.getElementById(id)

const screens = {
    home: $('screen-home'),
    lobby: $('screen-lobby'),
    game: $('screen-game')
}

const show = (name) => {
    for (const [key, el] of Object.entries(screens)) {
        el.hidden = key !== name
    }
}

// --- multiplayer session state ---------------------------------------------

let net = null
let isHost = false
let myDone = null       // { solved, misses } when this player finishes
let oppDone = null      // same for opponent
let matchActive = false

const opponentPanel = $('opponent')
const oppStatus = $('opp-status')
const oppLeft = $('opp-left')
const oppMissed = $('opp-missed')
const resultBox = $('result')
const verdictEl = $('verdict')

// Disable New Game and the difficulty/word controls during a race, so neither
// player can change the puzzle or start a new round while the other is still
// solving. Re-enabled when both finish, or on disconnect.
const resetBtn = $('reset')
const scaleInputs = () => document.querySelectorAll('#scale input, #wordscale input')

const lockControls = (locked) => {
    resetBtn.disabled = locked
    scaleInputs().forEach((input) => { input.disabled = locked })
    document.querySelectorAll('#scale, #wordscale').forEach((el) => {
        el.classList.toggle('scale--locked', locked)
    })
}

const resetOpponentPanel = () => {
    oppStatus.textContent = 'connected'
    oppLeft.textContent = '5'
    oppMissed.textContent = '0'
}

const send = (obj) => net && net.send(obj)

// Once both players finish, decide the match and show it in the result box,
// replacing whichever interim message ("Solved..."/"Out of guesses") was there.
// The second player to finish sees this immediately, since it's the point at
// which both are done.
const settleIfDone = () => {
    if (!myDone || !oppDone) return

    let verdict
    if (myDone.solved && !oppDone.solved) verdict = 'You win!'
    else if (!myDone.solved && oppDone.solved) verdict = 'Opponent wins.'
    else if (myDone.solved && oppDone.solved) {
        if (myDone.misses < oppDone.misses) verdict = 'You win — fewer misses!'
        else if (myDone.misses > oppDone.misses) verdict = 'Opponent wins — fewer misses.'
        else verdict = 'Dead heat!'
    } else {
        verdict = 'Both out of guesses.'
    }

    resultBox.hidden = false
    verdictEl.className = 'verdict ' +
        (verdict.startsWith('You win') ? 'verdict--won' : 'verdict--lost')
    verdictEl.textContent = verdict

    // Round over: re-enable New Game and the difficulty/word controls.
    lockControls(false)
}

// Observe the local game and relay progress to the peer.
const wireGameObserver = () => {
    window.HangmanGame.setObserver((e) => {
        if (!matchActive) return

        if (e.type === 'progress') {
            send({ t: 'progress', remaining: e.remaining, missed: e.missed })

            if (e.status !== 'playing' && !myDone) {
                myDone = { solved: e.status === 'finished', misses: e.missed }
                send({ t: 'done', solved: myDone.solved, misses: myDone.misses })
                settleIfDone()
            }
        }
    })

    // Reset behaviour depends on mode. Outside a live match (single-player, or
    // multiplayer that has ended/disconnected) it must fall back to a normal
    // local restart, otherwise New Game does nothing.
    window.HangmanGame.setResetHandler(async () => {
        if (!matchActive) {
            window.HangmanGame.start()
            return
        }
        // Clear the finished board and show the waiting state at once, so it
        // doesn't linger while the shared puzzle is fetched/relayed.
        window.HangmanGame.showWaiting('Fetching a new puzzle\u2026')
        if (isHost) {
            // Tell the joiner to clear now too, before the puzzle is ready.
            send({ t: 'round-coming' })
            const puzzle = await window.HangmanGame.fetchPuzzle()
            startRound(puzzle)
            send({ t: 'round', puzzle })
        } else {
            // Only the host fetches words (to keep both boards identical), so
            // the joiner requests a round and waits for the host to send it.
            // The watchdog recovers if the host never responds.
            send({ t: 'request-round' })
            // Block a second request until this one resolves.
            resetBtn.disabled = true
            armRoundWatchdog()
        }
    })
}

// Joiner-side guard: if a requested round doesn't arrive, surface it and let
// the player retry rather than sitting on "Fetching..." indefinitely.
let roundWatchdog = null
const ROUND_WAIT = 8000

const armRoundWatchdog = () => {
    clearRoundWatchdog()
    roundWatchdog = setTimeout(() => {
        if (!matchActive) return
        window.HangmanGame.showWaiting(
            'No response from host. Tap New game to try again.'
        )
        // Leave controls usable so the player can retry or change mode.
        lockControls(false)
    }, ROUND_WAIT)
}

const clearRoundWatchdog = () => {
    if (roundWatchdog) { clearTimeout(roundWatchdog); roundWatchdog = null }
}

const startRound = async (puzzle) => {
    myDone = null
    oppDone = null
    matchActive = true
    resetOpponentPanel()
    // Lock the controls only after the game has started. startGame() re-enables
    // the reset button when it finishes, so locking beforehand would be undone.
    await window.HangmanGame.start(puzzle)
    lockControls(true)
}

// --- peer message handling --------------------------------------------------

const onPeerMessage = (msg) => {
    switch (msg.t) {
        case 'round-coming':
            // Host is fetching the next puzzle; clear our board so the finished
            // one doesn't linger until the words arrive.
            window.HangmanGame.showWaiting('Fetching a new puzzle\u2026')
            break
        case 'round':
            // Host sent the shared words; begin the round on this side.
            clearRoundWatchdog()
            startRound(msg.puzzle)
            break
        case 'request-round':
            // Joiner asked for a new round; only the host fetches.
            if (isHost) {
                window.HangmanGame.showWaiting('Fetching a new puzzle\u2026')
                send({ t: 'round-coming' })
                window.HangmanGame.fetchPuzzle().then((puzzle) => {
                    startRound(puzzle)
                    send({ t: 'round', puzzle })
                })
            }
            break
        case 'progress':
            oppLeft.textContent = msg.remaining
            oppMissed.textContent = msg.missed
            break
        case 'done':
            oppDone = { solved: msg.solved, misses: msg.misses }
            oppStatus.textContent = msg.solved ? 'solved' : 'out of guesses'
            settleIfDone()
            break
    }
}

// --- lobby flow -------------------------------------------------------------

const lobbyChoose = $('lobby-choose')
const hostView = $('lobby-host-view')
const joinView = $('lobby-join-view')
const codeEl = $('lobby-code')
const hostStatus = $('lobby-host-status')
const joinStatus = $('lobby-join-status')
const joinInput = $('join-code')

const resetLobby = () => {
    lobbyChoose.hidden = false
    hostView.hidden = true
    joinView.hidden = true
    hostStatus.textContent = 'Waiting for a player to join\u2026'
    hostStatus.className = 'lobby__status'
    joinStatus.textContent = ''
    joinStatus.className = 'lobby__status'
    joinInput.value = ''
}

const teardownNet = () => {
    if (net) { net.close(); net = null }
    matchActive = false
    clearRoundWatchdog()
    opponentPanel.hidden = true
}

// Begin a multiplayer match once the data channel is open. Host fetches the
// first puzzle and sends it; joiner waits for it.
const beginMatch = async () => {
    opponentPanel.hidden = false
    oppStatus.textContent = 'connected'
    show('game')

    if (isHost) {
        const puzzle = await window.HangmanGame.fetchPuzzle()
        startRound(puzzle)
        send({ t: 'round', puzzle })
    } else {
        // Clear the leftover single-player board and show a waiting message
        // until the host's words arrive, so the joiner never briefly sees a
        // different puzzle.
        window.HangmanGame.showWaiting('Waiting for the host\u2026')
    }
}

// Uses the real WebRTC transport, or a test-injected one if present.
const netFactory = window.__netFactory || createNet
const makeNet = () => netFactory({
    workerUrl: WORKER_URL,
    onState: (state) => {
        if (state === 'connected') {
            beginMatch()
        } else if (state === 'error' || state === 'closed') {
            if (matchActive) {
                // Lost the peer mid-match.
                oppStatus.textContent = 'disconnected'
                matchActive = false
                clearRoundWatchdog()
                // The lock existed to keep the race fair; with no opponent left
                // it only gets in the way, so hand the controls back.
                lockControls(false)
            } else {
                // Failed during the lobby handshake.
                const target = isHost ? hostStatus : joinStatus
                target.textContent = 'Connection lost. Try again.'
                target.className = 'lobby__status lobby__status--error'
            }
        }
    },
    onMessage: onPeerMessage,
    onError: () => { /* surfaced via onState('error') */ }
})

// --- wiring -----------------------------------------------------------------

const goHome = () => {
    teardownNet()
    resetLobby()
    show('home')
}

// Back from the lobby: if we're in the host or join sub-view, return to the
// two-option choose screen (and drop any half-open connection). Only go all the
// way home when already on the choose screen.
const lobbyBack = () => {
    const inSubView = !hostView.hidden || !joinView.hidden
    if (inSubView) {
        teardownNet()      // cancel a pending host/join handshake
        resetLobby()       // back to the two buttons
    } else {
        goHome()
    }
}

$('go-single').addEventListener('click', () => {
    teardownNet()
    matchActive = false
    show('game')
    window.HangmanGame.start()   // fresh single-player round
})

$('go-multi').addEventListener('click', () => {
    resetLobby()
    show('lobby')
})

document.querySelectorAll('[data-home]').forEach((btn) => {
    btn.addEventListener('click', lobbyBack)
})

$('lobby-host').addEventListener('click', () => {
    isHost = true
    lobbyChoose.hidden = true
    hostView.hidden = false
    net = makeNet()
    const code = net.host()
    codeEl.textContent = code
})

$('lobby-join').addEventListener('click', () => {
    isHost = false
    lobbyChoose.hidden = true
    joinView.hidden = false
    joinInput.focus()
})

$('join-go').addEventListener('click', () => {
    const code = joinInput.value.trim().toLowerCase()
    if (!/^[a-z0-9]{4,12}$/.test(code)) {
        joinStatus.textContent = 'Enter the code your host shared.'
        joinStatus.className = 'lobby__status lobby__status--error'
        return
    }
    joinStatus.textContent = 'Connecting\u2026'
    joinStatus.className = 'lobby__status'
    net = makeNet()
    net.join(code)
})

joinInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('join-go').click()
})

wireGameObserver()

// Exposes match state for automated tests.
window.__mpState = () => ({
    isHost, matchActive, myDone, oppDone,
    connected: !!(net && net.state === 'connected')
})

// Show the home screen first. app.js has already started a single-player game,
// but it stays hidden until the player chooses "Single player".
show('home')
