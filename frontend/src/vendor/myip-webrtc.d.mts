export interface MyIPStunProvider { readonly name: string; readonly host: string; }
export interface MyIPRtcResult {
  status: 'ready' | 'unavailable' | 'cancelled';
  address?: string;
  addresses: string[];
  candidateType?: string;
  natTypeCode?: string;
  note: string;
  sdpLogs: string[];
}
export interface MyIPRtcOptions {
  RTCPeerConnection?: typeof globalThis.RTCPeerConnection;
  performance?: Pick<Performance, 'now'>;
  setTimeout?: (callback: () => void, milliseconds: number) => unknown;
  clearTimeout?: (timer: unknown) => void;
  console?: Pick<Console, 'error'>;
}
export const MYIP_STUN_PROVIDERS: readonly MyIPStunProvider[];
export const MYIP_RTC_TIMEOUT_MS: 5000;
export function probeMyIPRtc(host: string, signal: AbortSignal, options?: MyIPRtcOptions): Promise<MyIPRtcResult>;
