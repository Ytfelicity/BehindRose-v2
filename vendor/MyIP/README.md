# MyIP connectivity source

Source: https://github.com/jason5ng32/MyIP

Pinned commit: `a185d1844d28e7535ea3ec5c0277280a77435609` (2026-10-05).

`frontend/components/ConnectivityTest.vue` is the original upstream file.
The build helper `frontend/scripts/vendor-myip-connectivity.mjs` extracts its
`checkConnectivityHandler` function without editing it. The generated module is
`frontend/src/vendor/myip-connectivity.mjs`; hashes are in `provenance.json`.
Regenerate from the pinned source with:

```powershell
node scripts/vendor-myip-connectivity.mjs
```

The surrounding adapter supplies the Vue state the handler expects, connects the
existing Stop control to the fetch AbortSignal, omits cookies/referrers, and
preserves the timeout-versus-cancellation distinction. Built-in AI and default
lists are generated from the same upstream data, including the actual favicon
probe URLs (Claude uses claude.com, Cloudflare uses speed.cloudflare.com).

The application follows the pinned original's default ten samples and lowest
successful response time. The first complete pass settles before the repeating
schedule is armed; later passes start every 500 ms, with 50 ms staggering per
target. Slow passes may overlap. There is no local three-sample mode, per-host
serialization, or five/eight-second group deadline. Every scheduled request is
awaited, and scheduling waits remain outside its measured clock and timeout.
The adapter reserves the ten intended rounds at dispatch, preventing the original
async setInterval's delayed counter increments from launching extra rounds.
Sampling completion is tracked separately from a visible success. Individual retests are single
requests and reset their prior results. Reports retain each round's real result,
failures and timeouts; failed rounds do not become zero-millisecond successes.
Custom URLs are preserved exactly. No upstream telemetry or automatic startup
probes are used.

Requests preserve the upstream GET/no-cors/no-store method. The generated source
and the application retain the original 3.6-second request budget and 200 ms
fast/slow boundary. The adapter no longer raises measured zero values to one.
The UI explicitly labels HTTPS response timing, minimum versus single
request, and incomplete sampling. A successful probe can still
receive an HTTP error, sign-in or challenge response; it does not verify service
permissions or account access.

License: MIT, Copyright (c) 2026 Jason Ng. Both the original `LICENSE` and the
distributed `licenses/MyIP-LICENSE.txt` are preserved.

The same pinned source also supplies ordinary DNS and WebRTC sampling. See
`DNS-README.md` / `dns-provenance.json` and `WEBRTC-ADAPTATION.md` /
`webrtc-provenance.json`. The host uses local DB-IP country estimates instead of
the upstream MaxMind backend and does not enable the separately authenticated
enhanced DNS service.
