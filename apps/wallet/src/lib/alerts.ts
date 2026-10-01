/**
 * Alert delivery for Sentinel (Phase 1 of the Bounty #1 build).
 *
 * Two delivery paths, one promise: whatever the browser allows, the user
 * hears about their vault. Browser notifications when permission is
 * granted; in-app toasts otherwise. Never blocks, never crashes, never
 * asks twice in a session after a denial.
 */
import { pushToast } from './toasts';

export type AlertPermission = 'default' | 'granted' | 'denied' | 'unsupported';

const SENT_ALERTS_KEY = 'ripcord:sentinel-alerts';
const ENABLED_KEY = 'ripcord:sentinel-alerts-enabled';
// In-memory mirror: if sessionStorage is unavailable (private browsing,
// quota), we must still never announce the same finding twice.
const sentMemory = new Set<string>();

export function notificationPermission(): AlertPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return (Notification.permission as AlertPermission) ?? 'default';
}

export async function requestNotificationPermission(): Promise<AlertPermission> {
  if (notificationPermission() === 'unsupported') return 'unsupported';
  try {
    const result = await Notification.requestPermission();
    return (result as AlertPermission) ?? 'default';
  } catch {
    return notificationPermission();
  }
}

/** User-facing toggle for alerts (public preference, no secrets). */
export function alertsEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(ENABLED_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setAlertsEnabled(on: boolean): void {
  try {
    window.localStorage.setItem(ENABLED_KEY, on ? 'on' : 'off');
  } catch {
    // storage unavailable: alerts default to on; nothing to persist
  }
}

/**
 * Announce a finding at most once per session (keyed by code+title) so the
 * 60-second poll never spams. Returns true when this call delivered it.
 */
export function announceOnce(key: string, title: string, body?: string): boolean {
  if (typeof window === 'undefined') return false;
  if (sentMemory.has(key)) return false;
  let sent: string[] = [];
  try {
    sent = JSON.parse(window.sessionStorage.getItem(SENT_ALERTS_KEY) ?? '[]') as string[];
  } catch {
    sent = [];
  }
  if (sent.includes(key)) return false;
  sent.push(key);
  sentMemory.add(key);
  try {
    window.sessionStorage.setItem(SENT_ALERTS_KEY, JSON.stringify(sent));
  } catch {
    // storage unavailable: the in-memory Set still prevents repeats
  }

  if (!alertsEnabled()) return false;

  const permission = notificationPermission();
  if (permission === 'granted') {
    try {
      // A plain notification: no service worker, no remote push, nothing to opt out of later.
      new Notification(title, { body: body ?? 'Open Ripcord to see the details.', tag: key });
      return true;
    } catch {
      // fall through to toast
    }
  }
  if (permission === 'denied') {
    // Browser notifications are blocked: say so once via toast so the
    // promise stays honest ("we will alert you in-app").
    pushToast({ title, body: body ?? 'Notifications are off for this site, so alerts show here.', tone: 'error' });
    return true;
  }
  pushToast({ title, body, tone: 'error' });
  return true;
}

/** Test/ops helper: forget which alerts were announced this session. */
export function resetAnnounced(): void {
  sentMemory.clear();
  try {
    window.sessionStorage.removeItem(SENT_ALERTS_KEY);
  } catch {
    // ignore
  }
}
