# MyIP WebRTC source and adapter

Upstream: https://github.com/jason5ng32/MyIP

Pinned commit: `a185d1844d28e7535ea3ec5c0277280a77435609`.

`frontend/components/WebRtcTest.vue` is the unchanged upstream component.
`frontend/composables/use-maxmind.js` is retained for inspection of the original
country/ISP enrichment dependency; it is not loaded by the adapter.

Run `node scripts/vendor-myip-webrtc.mjs` from the project frontend directory to
regenerate `frontend/src/vendor/myip-webrtc.mjs` and its TypeScript declaration.
The generator verifies the pinned component's SHA256 before extracting the
candidate regex, `checkSTUNServer`, `determineNATType`, and `natTypeCodeOf`
without editing their text. Source and extraction hashes are recorded separately
in `webrtc-provenance.json`.

The four STUN URLs and their order come from the upstream reactive server list:
Google, BlackBerry, Twilio, and Cloudflare. The sampler waits at most five seconds
per source and accepts the first `srflx` or `prflx` ICE candidate that contains an
IP. Host candidates do not count as evidence that a STUN server answered.
Candidate event/SDP logs are retained. The adapter returns candidate type; this
is not a classification of symmetric NAT, full cone NAT, or other NAT topology.

The surrounding module supplies Vue-free state and translation labels, and
adds AbortSignal cancellation. Every call owns its result object, connections,
and timers. Cancellation closes connections, removes their callbacks, clears
timers, and returns immediately; late upstream work cannot overwrite another
call's result. The host can continue to enrich the returned IP with its local
country database. The adapter's `lookupMaxmind` returns null, so it adds no
online geolocation request, telemetry, camera access, or microphone access.

Optional platform injection allows deterministic tests with a fake peer
connection and fake timers. The production sampler retains the original 5000 ms
timeout; there is no production timeout override.

License: MIT, Copyright (c) 2026 Jason Ng. The original `LICENSE` and distributed
`licenses/MyIP-LICENSE.txt` remain available.
