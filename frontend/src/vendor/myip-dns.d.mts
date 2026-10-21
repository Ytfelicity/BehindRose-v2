export const MYIP_DNS_PROVIDERS: readonly Readonly<{ id: string; name: string }>[];
export type MyIPDnsSourceResult = {
  slot: number;
  sourceId: string;
  sourceName: string;
  status: 'running' | 'ready' | 'unavailable' | 'cancelled';
  address?: string;
  note: string;
  attemptedSources?: string[];
};
export function runMyIPDns(signal: AbortSignal, onSource?: (source: MyIPDnsSourceResult) => void): Promise<MyIPDnsSourceResult[]>;
