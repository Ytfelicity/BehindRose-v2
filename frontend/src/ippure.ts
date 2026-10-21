// Public API documented at https://ippure.com/MyIP-Info-API.
export const IPPURE_ENDPOINT = 'https://my.ippure.com/v1/info';
export type IpPureInfo = {
  ip: string; asn?: number | null; asOrganization?: string | null;
  country?: string | null; countryCode?: string | null; region?: string | null;
  regionCode?: string | null; city?: string | null; timezone?: string | null;
  longitude?: string | number | null; latitude?: string | number | null;
  postalCode?: string | null; fraudScore?: number | null;
  isResidential?: boolean | null; isBroadcast?: boolean | null; userAgent?: string | null;
};
export function ipFamily(ip: unknown): 4 | 6 | null {
  if (typeof ip !== 'string' || ip.length > 80) return null;
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip) && ip.split('.').every(n => Number(n) <= 255)) return 4;
  if (!ip.includes(':') || !/^[\da-f:.]+$/i.test(ip)) return null;
  try { new URL(`http://[${ip}]/`); return 6; } catch { return null; }
}
export function parseIpPureInfo(value: unknown): IpPureInfo {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('IPPure 返回的数据格式不匹配');
  const data = value as Record<string, unknown>;
  if (!ipFamily(data.ip)) throw Error('IPPure 未返回有效的出口 IP');
  for (const key of ['asOrganization', 'country', 'countryCode', 'region', 'regionCode', 'city', 'timezone', 'postalCode', 'userAgent']) {
    if (data[key] != null && (typeof data[key] !== 'string' || (data[key] as string).length > 2048)) throw Error('IPPure 返回的数据格式不匹配');
  }
  if (data.asn != null && (typeof data.asn !== 'number' || !Number.isSafeInteger(data.asn) || data.asn < 0)) throw Error('IPPure ASN 格式不匹配');
  if (data.fraudScore != null && (typeof data.fraudScore !== 'number' || !Number.isFinite(data.fraudScore) || data.fraudScore < 0 || data.fraudScore > 100)) throw Error('IPPure 风险系数格式不匹配');
  for (const key of ['isResidential', 'isBroadcast']) if (data[key] != null && typeof data[key] !== 'boolean') throw Error('IPPure IP 类型格式不匹配');
  for (const key of ['longitude', 'latitude']) if (data[key] != null && (typeof data[key] !== 'string' && typeof data[key] !== 'number' || String(data[key]).length > 80)) throw Error('IPPure 坐标格式不匹配');
  return data as IpPureInfo;
}
// Match the official homepage ColorMap, including its inclusive upper bounds.
// Source snapshot: artifacts/ippure-reference/IPDataTable.BZ02Asml.js.
export const IPPURE_RISK_BANDS = [
  { end: 15, label: '极度纯净', color: '#166534' },
  { end: 25, label: '纯净', color: '#22c55e' },
  { end: 40, label: '中性', color: '#84cc16' },
  { end: 50, label: '轻度风险', color: '#eab308' },
  { end: 70, label: '中度风险', color: '#f97316' },
  { end: 100, label: '极度风险', color: '#dc2626' },
] as const;
export function ipPureRisk(data: IpPureInfo) {
  // IPPure FAQ explicitly excludes IPv6 from its fraud coefficient.
  if (ipFamily(data.ip) === 6 || typeof data.fraudScore !== 'number') return null;
  return IPPURE_RISK_BANDS.find(band => data.fraudScore! <= band.end) ?? null;
}
