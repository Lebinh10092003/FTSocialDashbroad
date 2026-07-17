import { createHash } from 'crypto';

export const TOKEN_LIFETIME_DAYS = 60;
export const TOKEN_REMINDER_DAY = 55;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ManagedTokenInput {
  platform: string;
  pageId: string;
  pageName?: string;
  accessToken: string;
}

export interface TokenLifecycleRecord {
  fingerprint: string;
  platform: string;
  pageIds: string[];
  pageNames: string[];
  issuedAt: string;
  expiresAt: string;
  firstReminderAt?: string;
}

function toIsoDate(value: string | undefined, fallback: string): string {
  const date = value ? new Date(value) : new Date(fallback);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function expiresAt(issuedAt: string): string {
  return new Date(new Date(issuedAt).getTime() + TOKEN_LIFETIME_DAYS * DAY_MS).toISOString();
}

export function fingerprintToken(token: string): string {
  return createHash('sha256').update(token.trim()).digest('hex');
}

/** Groups pages sharing a token and preserves its issue date when the token is unchanged. */
export function buildTokenRegistry(
  tokens: ManagedTokenInput[],
  previous: TokenLifecycleRecord[] = [],
  fallbackIssuedAt = new Date().toISOString(),
): TokenLifecycleRecord[] {
  const previousByFingerprint = new Map(previous.map(record => [record.fingerprint, record]));
  const groups = new Map<string, { fingerprint: string; platform: string; pageIds: string[]; pageNames: string[] }>();

  tokens.forEach(token => {
    const accessToken = String(token.accessToken || '').trim();
    if (!accessToken || !token.pageId) return;
    const fingerprint = fingerprintToken(accessToken);
    const key = `${token.platform}:${fingerprint}`;
    const group = groups.get(key) || { fingerprint, platform: token.platform, pageIds: [], pageNames: [] };
    group.pageIds.push(String(token.pageId));
    group.pageNames.push(token.pageName || `${token.platform} ${token.pageId}`);
    groups.set(key, group);
  });

  return Array.from(groups.values()).map(group => {
    const previousRecord = previousByFingerprint.get(group.fingerprint);
    const issuedAt = toIsoDate(previousRecord?.issuedAt, fallbackIssuedAt);
    return {
      ...group,
      issuedAt,
      expiresAt: expiresAt(issuedAt),
      ...(previousRecord?.firstReminderAt ? { firstReminderAt: previousRecord.firstReminderAt } : {}),
    };
  });
}

export function getDueTokenNotifications(records: TokenLifecycleRecord[], now = new Date()) {
  return records
    .map(record => {
      const ageDays = Math.floor((now.getTime() - new Date(record.issuedAt).getTime()) / DAY_MS);
      const daysRemaining = Math.ceil((new Date(record.expiresAt).getTime() - now.getTime()) / DAY_MS);
      return { ...record, ageDays, daysRemaining };
    })
    .filter(record => record.ageDays >= TOKEN_REMINDER_DAY);
}

export function getSharedTokenGroups(records: TokenLifecycleRecord[]) {
  return records.filter(record => record.pageIds.length > 1);
}