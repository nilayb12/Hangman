// net.js — one WebRTC data channel between two phones, brokered by the Worker.
//
// Usage:
//   const net = createNet({ workerUrl, onState, onMessage, onError })
//   net.host()          -> returns a room code, waits for a peer
//   net.join(code)      -> joins an existing room
//   net.send(obj)       -> sends a JSON-serialisable object to the peer
//   net.close()         -> tears everything down
//
// The caller never touches WebRTC or the signalling socket. It reacts to
// onState(state) — one of: 'signalling', 'connecting', 'connected',
// 'closed', 'error' — and onMessage(obj) for peer data.
//
// Design notes:
// - The host creates the data channel and the SDP offer; the joiner answers.
//   Whoever connects to an empty room becomes host. The Worker tells each
//   side its role via the peer count.
// - ICE candidates are trickled: sent as they are discovered rather than
//   waiting for gathering to finish, which shaves seconds off connect time.
// - Every path that can fail has a timeout or an error handler. A dead
//   connection reports 'error' or 'closed' rather than hanging.

const ROLE_HOST = 'host'
const ROLE_JOIN = 'join'

// Used if the Worker's /turn endpoint is unreachable. STUN can discover a
// device's public address but cannot relay traffic, so this alone only connects
// devices on cooperative networks (no relay for restrictive NATs).
const FALLBACK_ICE = [
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.l.google.com:19302' }
]

// ICE servers are fetched from the Worker (STUN + short-lived TURN) the first
// time a connection is made, then reused for the session. TURN is what lets
// two devices behind hostile NATs connect by relaying through Cloudflare when
// no direct path exists.
const fetchIceServers = async (workerUrl) => {
    try {
        const httpUrl = workerUrl.replace(/^ws/, 'http').replace(/\/$/, '')
        const res = await fetch(`${httpUrl}/turn`, { method: 'GET' })
        if (res.ok) {
            const data = await res.json()
            if (data && Array.isArray(data.iceServers) && data.iceServers.length) {
                return data.iceServers
            }
        }
    } catch (e) {
        // fall through to STUN-only
    }
    return FALLBACK_ICE
}

const CONNECT_TIMEOUT = 20000
const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789' // no look-alikes

const randomCode = (len = 5) => {
    const a = new Uint8Array(len)
    crypto.getRandomValues(a)
    let s = ''
    for (let i = 0; i < len; i++) {
        s += CODE_ALPHABET[a[i] % CODE_ALPHABET.length]
    }
    return s
}

export const createNet = ({ workerUrl, onState, onMessage, onError }) => {
    let ws = null
    let pc = null
    let channel = null
    let role = null
    let state = 'idle'
    let timer = null
    let closed = false
    let iceServers = FALLBACK_ICE   // replaced with fetched STUN+TURN on connect
    let icePromise = null           // resolves once servers are fetched

    const setState = (next) => {
        if (state === next || closed) return
        state = next
        onState && onState(next)
    }

    const fail = (reason) => {
        if (closed) return
        onError && onError(reason)
        setState('error')
        teardown()
    }

    const teardown = () => {
        closed = true
        clearTimeout(timer)
        if (channel) { try { channel.close() } catch (e) {} channel = null }
        if (pc) { try { pc.close() } catch (e) {} pc = null }
        if (ws) {
            try {
                ws.onclose = null // don't fire our own handler during teardown
                ws.close()
            } catch (e) {}
            ws = null
        }
    }

    // --- signalling socket ---------------------------------------------------

    const openSocket = (code) => new Promise((resolve, reject) => {
        const url = `${workerUrl.replace(/\/$/, '')}/room?code=${encodeURIComponent(code)}`
        let socket
        try {
            socket = new WebSocket(url)
        } catch (e) {
            reject(new Error('bad worker url'))
            return
        }

        const onOpenErr = (e) => reject(new Error('signalling unreachable'))
        socket.addEventListener('error', onOpenErr, { once: true })
        socket.addEventListener('open', () => {
            socket.removeEventListener('error', onOpenErr)
            resolve(socket)
        }, { once: true })
    })

    const sendSignal = (obj) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(obj))
        }
    }

    // --- peer connection -----------------------------------------------------

    const makePeer = async () => {
        // Ensure fetched STUN+TURN are in place before building the connection.
        if (icePromise) { try { await icePromise } catch (e) {} }
        const peer = new RTCPeerConnection({ iceServers })

        peer.onicecandidate = (e) => {
            if (e.candidate) {
                sendSignal({ t: 'ice', candidate: e.candidate })
            }
        }

        peer.onconnectionstatechange = () => {
            const s = peer.connectionState
            if (s === 'failed') {
                fail('connection failed')
            } else if (s === 'disconnected' || s === 'closed') {
                if (!closed) {
                    setState('closed')
                    teardown()
                }
            }
        }

        return peer
    }

    const wireChannel = (ch) => {
        channel = ch
        ch.onopen = () => {
            clearTimeout(timer)
            // Handshake complete: close the signalling socket to free the room
            // slot. Gameplay runs entirely peer-to-peer from here.
            if (ws) { try { ws.close() } catch (e) {} ws = null }
            setState('connected')
        }
        ch.onmessage = (e) => {
            let obj
            try { obj = JSON.parse(e.data) } catch (err) { return }
            onMessage && onMessage(obj)
        }
        ch.onclose = () => {
            if (!closed) { setState('closed'); teardown() }
        }
        ch.onerror = () => fail('channel error')
    }

    // --- signalling message handling -----------------------------------------

    const handleSignal = async (msg) => {
        try {
            if (msg.t === 'full') {
                fail('room full')
                return
            }

            if (msg.t === 'joined') {
                // Role is decided by arrival order: first peer in the room is
                // the host, second is the joiner.
                role = msg.peers === 1 ? ROLE_HOST : ROLE_JOIN
                if (role === ROLE_HOST) {
                    // Wait for a peer before building the offer.
                    setState('signalling')
                }
                return
            }

            if (msg.t === 'peer-joined' && role === ROLE_HOST) {
                // A joiner arrived. Host creates the channel and the offer.
                setState('connecting')
                pc = await makePeer()
                wireChannel(pc.createDataChannel('game', { ordered: true }))
                const offer = await pc.createOffer()
                await pc.setLocalDescription(offer)
                sendSignal({ t: 'offer', sdp: pc.localDescription })
                return
            }

            if (msg.t === 'offer' && role === ROLE_JOIN) {
                setState('connecting')
                pc = await makePeer()
                pc.ondatachannel = (e) => wireChannel(e.channel)
                await pc.setRemoteDescription(msg.sdp)
                const answer = await pc.createAnswer()
                await pc.setLocalDescription(answer)
                sendSignal({ t: 'answer', sdp: pc.localDescription })
                return
            }

            if (msg.t === 'answer' && role === ROLE_HOST) {
                await pc.setRemoteDescription(msg.sdp)
                return
            }

            if (msg.t === 'ice' && pc) {
                try {
                    await pc.addIceCandidate(msg.candidate)
                } catch (e) {
                    // A candidate can arrive before the remote description is
                    // set; browsers queue or reject harmlessly. Not fatal.
                }
                return
            }

            if (msg.t === 'peer-left') {
                if (state !== 'connected') {
                    // Peer vanished mid-handshake; nothing to fall back to.
                    fail('peer left')
                }
                // If already connected, the channel's own onclose handles it.
                return
            }
        } catch (e) {
            fail('handshake error')
        }
    }

    const beginSignalling = (code) => {
        setState('signalling')
        clearTimeout(timer)
        timer = setTimeout(() => {
            if (state !== 'connected') fail('timed out')
        }, CONNECT_TIMEOUT)

        // Fetch ICE servers (STUN + TURN) before building the connection.
        // makePeer awaits this, so the peer connection is never created before
        // the servers are ready. On failure, falls back to STUN only.
        icePromise = fetchIceServers(workerUrl).then((servers) => {
            if (!closed) iceServers = servers
        })

        openSocket(code).then((socket) => {
            if (closed) { try { socket.close() } catch (e) {} return }
            ws = socket
            ws.onmessage = (e) => {
                let msg
                try { msg = JSON.parse(e.data) } catch (err) { return }
                handleSignal(msg)
            }
            ws.onclose = () => {
                // Socket dropping before the channel opens is fatal; after, it
                // is expected (we close it ourselves on channel open).
                if (state !== 'connected' && !closed && channel === null) {
                    fail('signalling closed')
                }
            }
            ws.onerror = () => {
                if (state !== 'connected') fail('signalling error')
            }
        }).catch((e) => fail(e.message || 'signalling failed'))
    }

    // --- public API ----------------------------------------------------------

    return {
        host() {
            const code = randomCode()
            beginSignalling(code)
            return code
        },
        join(code) {
            const clean = String(code || '').trim().toLowerCase()
            beginSignalling(clean)
        },
        send(obj) {
            if (channel && channel.readyState === 'open') {
                channel.send(JSON.stringify(obj))
                return true
            }
            return false
        },
        get state() { return state },
        get role() { return role },
        close() {
            if (!closed) { setState('closed'); teardown() }
        }
    }
}
