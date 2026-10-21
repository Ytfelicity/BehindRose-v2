export const MYIP_TIMEOUT_MS: number;
export const MYIP_FAST_MS: number;
export const MYIP_MULTI_ROUNDS: number;
export const MYIP_INTERVAL_MS: number;
export const MYIP_STAGGER_MS: number;
export type MyIPProbeResult = {
  reachable: boolean;
  roundReachable: boolean;
  roundMs?: number;
  ms?: number;
  timedOut: boolean;
  responseType?: ResponseType;
  status?: number;
};
export function createMyIPProbe(url: string, signal: AbortSignal, timeout?: number, multi?: boolean): () => Promise<MyIPProbeResult>;
export function probeMyIP(url: string, signal: AbortSignal, timeout?: number): Promise<MyIPProbeResult>;
