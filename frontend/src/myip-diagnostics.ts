import { IPLEAK_DNS_PROVIDERS, runIpLeakDns } from './ipleak-dns';
import { MYIP_STUN_PROVIDERS, probeMyIPRtc } from './vendor/myip-webrtc.mjs';

const bridge = {
  dnsProviders: IPLEAK_DNS_PROVIDERS,
  stunProviders: MYIP_STUN_PROVIDERS,
  probeDns: runIpLeakDns,
  probeRtc: probeMyIPRtc,
};

declare global { interface Window { RoseMyIP: typeof bridge; } }
window.RoseMyIP = bridge;
