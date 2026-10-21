# MyIP DNS source reuse

Repository: https://github.com/jason5ng32/MyIP

Pinned commit: `a185d1844d28e7535ea3ec5c0277280a77435609`.

`frontend/components/DnsLeaksTest.vue` supplies the exact default provider order
and four-slot count. Its stateless DNS modules under `frontend/utils/dnsleaks/`
are embedded by `frontend/scripts/vendor-myip-dns.mjs` in individual closures;
the source function bodies are unchanged. The original shared retry/fallback
runner, IP validator and five-second fetch timeout helper are reused too. The
generator removes only static module import/export syntax for lexical embedding.
Original files remain unchanged here; `dns-provenance.json` records both source
and extracted-code SHA256 hashes, plus the generated module hash.

Regenerate from the pinned files, from `frontend/`:

```powershell
node scripts/vendor-myip-dns.mjs
```

Generated API: `MYIP_DNS_PROVIDERS` describes the four default sources;
`runMyIPDns(signal, onSource?)` returns four slot results in slot order and reports
each running/completed slot through the optional callback. A completed slot names
the actual answering provider, including fallback. Each provider has two attempts,
new randomized subdomains per attempt, and one shared per-run promise across
slots. Slot startup is staggered by 200 ms, as upstream. Standbys are bash.ws,
browserleaks.net and ipleak.net before the other slots' sources.

The host's local fetch adapter merges the caller's Stop signal with each upstream
request timeout, omits credentials and referrers, and disables HTTP caching. A
stopped run cancels pending slot startup and fetches. It never modifies global
fetch and never moves DNS probes to a native/server-side network path. Every
run has its own timers and shared-probe cache, with timer cleanup on completion.
The upstream component's six-second report-only race is not copied; the API waits
until the actual provider chains settle instead of returning unfinished results.

Only public ordinary DNS probes are included. There is no authenticated enhanced
DNS endpoint, Firebase requirement, private API key, analytics or MyIP MaxMind
request. Country/ASN enrichment is a separate responsibility of the host.

These sources return one representative resolver IP per source, as upstream:
bash.ws chooses its first DNS result, browserleaks sorts result keys and chooses
the first, and ipleak chooses the highest-count IP. Repeated resolver addresses
or shared fallback sources are valid; four slots are not a count of all DNS
resolvers used by the operating system. Missing observations do not prove that
DNS does not leak. The fetch timeout helper follows upstream semantics: its timer
ends when fetch resolves, while the response's original JSON/text parser runs
afterwards. The caller's Stop signal remains attached to the fetch body stream.

The saved upstream tests document provider parsing and fallback behavior; host
integration has additionally been exercised with pure mock requests for four
primary sources, invalid-IP retries, shared fallbacks, full failure, timeout,
pre-cancellation, cancellation during a request and fresh per-run results.

License: MIT, Copyright (c) 2026 Jason Ng. The original `LICENSE` and distributed
`licenses/MyIP-LICENSE.txt` are retained.
