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
const oppDoneEl = $('opp-done')

const resetOpponentPanel = () => {
    oppStatus.textContent = 'connected'
    oppLeft.textContent = '5'
    oppMissed.textContent = '0'
    oppDoneEl.textContent = ''
    oppDoneEl.className = 'opponent__done'
}

const send = (obj) => net && net.send(obj)

// Decide and announce the outcome once both players have finished.
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
    oppDoneEl.textContent = verdict
    oppDoneEl.classList.add(
        verdict.startsWith('You win') ? 'opponent__done--won' : 'opponent__done--lost'
    )
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
        if (isHost) {
            const puzzle = await window.HangmanGame.fetchPuzzle()
            startRound(puzzle)
            send({ t: 'round', puzzle })
        } else {
            send({ t: 'request-round' })
        }
    })
}

const startRound = (puzzle) => {
    myDone = null
    oppDone = null
    matchActive = true
    resetOpponentPanel()
    window.HangmanGame.start(puzzle)
}

// --- peer message handling --------------------------------------------------

const onPeerMessage = (msg) => {
    switch (msg.t) {
        case 'round':
            // Host sent the shared words; begin the round on this side.
            startRound(msg.puzzle)
            break
        case 'request-round':
            // Joiner asked for a new round; only the host fetches.
            if (isHost) {
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
    }
    // Joiner's startRound fires when the 'round' message arrives.
}

// Injectable so tests can supply a loopback transport. Defaults to real WebRTC.
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
    btn.addEventListener('click', goHome)
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

// Minimal test seam: lets a harness read match state without scraping the DOM.
window.__mpState = () => ({
    isHost, matchActive, myDone, oppDone,
    connected: !!(net && net.state === 'connected')
})

// Start on the home screen. app.js has already booted a single-player game
// underneath; it simply isn't visible until "Single player" is chosen.
show('home')
