import platform from '../data/platform.json';
import { industryModule } from './scoring';

/**
 * The compliance layer.
 *
 * This runs whether or not the customer remembers it exists, and it is not
 * configurable from the UI. That is the whole design: a contractor buying a
 * $9 lead list has not read the TCPA and should not have to. If the product
 * hands them a number that was on the Do Not Call registry, the $500-to-$1,500
 * per-call statutory damages land on them, and the second thing they do is
 * tell every contractor they know.
 *
 * So gates fail closed. A lead with a stale DNC scrub is withheld, not
 * flagged. A template missing its CAN-SPAM footer does not render, rather than
 * rendering with a placeholder — a placeholder that ships is a violation at
 * $53,088 per message, and it ships eventually.
 */

const rules = (platform as any).compliance as {
  dncScrubMaxAgeDays: number;
  canSpamRequiredFields: string[];
  quietHours: { startHour: number; endHour: number; channels: string[] };
  smsRequiresPriorConsent: boolean;
  fcraBoundary: { restrictedSignalsRequireAttestation: boolean; prohibitedUses: string[] };
  dataSubjectRights: { deleteOnRequest: boolean; maxResponseDays: number };
};

const templates = (platform as any).outreachTemplates as OutreachTemplate[];

export type Channel = 'email' | 'sms' | 'call' | 'voicemail' | 'mail';

export interface ContactRecord {
  phone?: string;
  phoneType?: 'landline' | 'wireless' | 'voip' | 'unknown';
  email?: string;
  /** ISO timestamp of the last DNC scrub. Absent means never scrubbed. */
  dncScrubbedAt?: string | null;
  dncListed?: boolean;
  stateDncListed?: boolean;
  litigatorFlag?: boolean;
  /** Account-level opt-out. Beats everything. */
  optedOut?: boolean;
  optedOutChannels?: Channel[];
  /** Prior express written consent, required before any cold SMS. */
  smsConsentAt?: string | null;
  /** IANA zone for quiet-hours arithmetic. Falls back to the account's. */
  timezone?: string;
  isBusiness?: boolean;
}

export interface ReleaseDecision {
  released: boolean;
  /** Channels this contact may be worked on right now. */
  allowedChannels: Channel[];
  blockedChannels: { channel: Channel; reason: string }[];
  /** Set when the whole record is withheld. */
  withheldReason?: string;
  warnings: string[];
}

const daysSince = (iso?: string | null, now = new Date()): number | null => {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  return (now.getTime() - then) / 86_400_000;
};

/**
 * Decide what may be done with a contact, per channel.
 *
 * Channel-by-channel rather than a single yes/no, because the rules genuinely
 * differ: a DNC listing stops calls and texts and has nothing to say about
 * direct mail. Withholding the whole record for a phone problem would throw
 * away a mailable lead the customer paid for.
 */
export function evaluateRelease(contact: ContactRecord, now = new Date()): ReleaseDecision {
  const blocked: { channel: Channel; reason: string }[] = [];
  const warnings: string[] = [];
  const all: Channel[] = ['email', 'sms', 'call', 'voicemail', 'mail'];

  // Opt-out is absolute and applies retroactively — a lead already exported
  // stops appearing in future pulls the moment it is recorded.
  if (contact.optedOut && !contact.optedOutChannels?.length) {
    return {
      released: false,
      allowedChannels: [],
      blockedChannels: all.map((c) => ({ channel: c, reason: 'Contact opted out' })),
      withheldReason: 'Contact opted out of all channels',
      warnings,
    };
  }

  if (contact.litigatorFlag) {
    return {
      released: false,
      allowedChannels: [],
      blockedChannels: all.map((c) => ({ channel: c, reason: 'Known serial TCPA plaintiff' })),
      withheldReason: 'Known serial TCPA plaintiff — suppressed',
      warnings,
    };
  }

  const perChannelOptOut = new Set(contact.optedOutChannels ?? []);
  const allowed: Channel[] = [];

  for (const channel of all) {
    if (perChannelOptOut.has(channel)) {
      blocked.push({ channel, reason: 'Opted out of this channel' });
      continue;
    }

    if (channel === 'call' || channel === 'sms' || channel === 'voicemail') {
      if (!contact.phone) {
        blocked.push({ channel, reason: 'No phone number' });
        continue;
      }
      const age = daysSince(contact.dncScrubbedAt, now);
      // Fail closed. An unscrubbed number is indistinguishable from a listed
      // one until it has been checked, and guessing costs $500 a call.
      if (age === null) {
        blocked.push({ channel, reason: 'Never scrubbed against DNC' });
        continue;
      }
      if (age > rules.dncScrubMaxAgeDays) {
        blocked.push({
          channel,
          reason: `DNC scrub is ${Math.floor(age)} days old (safe harbour is ${rules.dncScrubMaxAgeDays})`,
        });
        continue;
      }
      // The B2B carve-out is real but narrow, and it does not cover a
      // wireless number a sole trader also uses personally.
      const dncApplies = !contact.isBusiness || contact.phoneType === 'wireless';
      if ((contact.dncListed || contact.stateDncListed) && dncApplies) {
        blocked.push({ channel, reason: 'On the Do Not Call registry' });
        continue;
      }
      if (channel === 'sms') {
        if (rules.smsRequiresPriorConsent && !contact.smsConsentAt) {
          blocked.push({ channel, reason: 'No prior express written consent on file' });
          continue;
        }
        if (contact.phoneType === 'landline') {
          blocked.push({ channel, reason: 'Landline cannot receive SMS' });
          continue;
        }
      }
      if (!inQuietHours(now, contact.timezone)) allowed.push(channel);
      else blocked.push({ channel, reason: 'Outside permitted calling hours' });
      continue;
    }

    if (channel === 'email') {
      if (!contact.email) blocked.push({ channel, reason: 'No email address' });
      else allowed.push(channel);
      continue;
    }

    allowed.push(channel); // mail
  }

  if (contact.phoneType === 'unknown' && contact.phone) {
    warnings.push('Phone line type unknown — treat as wireless for consent purposes.');
  }

  return {
    released: allowed.length > 0,
    allowedChannels: allowed,
    blockedChannels: blocked,
    withheldReason: allowed.length ? undefined : 'No permitted channel for this contact',
    warnings,
  };
}

/** Quiet hours in the recipient's local time, not the sender's. */
export function inQuietHours(now: Date, timezone?: string): boolean {
  const { startHour, endHour } = rules.quietHours;
  let hour: number;
  try {
    hour = timezone
      ? Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: timezone }).format(now))
      : now.getHours();
  } catch {
    // An unknown zone must not silently become the sender's. Treating it as
    // quiet costs a few hours of dialling; guessing costs a violation.
    return true;
  }
  if (hour === 24) hour = 0;
  return startHour > endHour ? hour >= startHour || hour < endHour : hour >= startHour && hour < endHour;
}

// ---------------------------------------------------------------------------
// Outreach rendering
// ---------------------------------------------------------------------------

export interface OutreachTemplate {
  id: string;
  industry: string;
  channel: Channel;
  subject?: string;
  body: string;
  requires?: string[];
  note?: string;
}

export interface RenderContext {
  lead: Record<string, unknown>;
  signal?: Record<string, unknown>;
  business: {
    name: string;
    senderName: string;
    senderPostalAddress: string;
    phone?: string;
    [key: string]: unknown;
  };
  unsubscribeUrl: string;
}

export class ComplianceError extends Error {
  constructor(message: string, readonly missing: string[]) {
    super(message);
    this.name = 'ComplianceError';
  }
}

const TOKEN = /\{\{\s*([\w.]+)\s*\}\}/g;

const lookup = (path: string, ctx: RenderContext): unknown =>
  path.split('.').reduce<any>((acc, part) => (acc == null ? undefined : acc[part]), ctx as any);

/**
 * Render an outreach template, or refuse.
 *
 * Refusing is the feature. Every other templating system in this category
 * renders `{{unsubscribeUrl}}` as an empty string when it is missing and sends
 * the email anyway. That is a strict-liability CAN-SPAM violation per message,
 * and it is silent — you find out from a complaint, thousands of sends later.
 */
export function renderOutreach(
  templateId: string,
  ctx: RenderContext
): { subject?: string; body: string; channel: Channel } {
  const template = templates.find((t) => t.id === templateId);
  if (!template) throw new Error(`unknown template: ${templateId}`);

  const missing: string[] = [];

  if (template.channel === 'email') {
    for (const field of rules.canSpamRequiredFields) {
      const value = field === 'unsubscribeUrl' ? ctx.unsubscribeUrl : (ctx.business as any)[field];
      if (typeof value !== 'string' || !value.trim()) missing.push(field);
      // The token has to actually be in the body — a value in the context that
      // the template never prints is not a footer.
      const token = field === 'unsubscribeUrl' ? '{{unsubscribeUrl}}' : `{{business.${field}}}`;
      if (!template.body.includes(token)) missing.push(`${field} (token absent from template)`);
    }
  }

  for (const required of template.requires ?? []) {
    const value = lookup(required, ctx);
    if (value === undefined || value === null || value === '') missing.push(required);
  }

  if (missing.length) {
    throw new ComplianceError(
      `Template "${templateId}" cannot be sent — missing: ${missing.join(', ')}`,
      missing
    );
  }

  const fill = (text: string): string =>
    text.replace(TOKEN, (whole, path: string) => {
      const value = lookup(path, ctx);
      // Any surviving unresolved token would ship as literal braces in a real
      // email. Loud failure beats that.
      if (value === undefined || value === null || value === '') {
        throw new ComplianceError(`Unresolved token ${whole} in "${templateId}"`, [path]);
      }
      return String(value);
    });

  return {
    subject: template.subject ? fill(template.subject) : undefined,
    body: fill(template.body),
    channel: template.channel,
  };
}

/** Templates available for an industry, plus the channel-agnostic ones. */
export const templatesFor = (industrySlug: string): OutreachTemplate[] =>
  templates.filter((t) => t.industry === industrySlug || t.industry === '*');

// ---------------------------------------------------------------------------
// FCRA boundary
// ---------------------------------------------------------------------------

export interface AttestationState {
  fcraAttestedAt?: string | null;
  attestedBy?: string;
}

/**
 * Whether restricted signals may be shown.
 *
 * Income brackets, equity estimates and the rest are modelled from public and
 * aggregate data. Shown to a contractor picking who to mail, that is
 * marketing. Used to decide who gets a policy, a loan, a job or a lease, the
 * same numbers make the output a consumer report and the seller a consumer
 * reporting agency — with the audit, dispute and accuracy obligations that
 * carries. The attestation is the line, and it is recorded with a timestamp
 * so there is a record of who drew it.
 */
export function restrictedSignalsAllowed(account: AttestationState): boolean {
  if (!rules.fcraBoundary.restrictedSignalsRequireAttestation) return true;
  return typeof account.fcraAttestedAt === 'string' && !Number.isNaN(Date.parse(account.fcraAttestedAt));
}

export const prohibitedUses = (): string[] => [...rules.fcraBoundary.prohibitedUses];

/** Restricted signal ids in a module, for the attestation prompt. */
export function restrictedSignalsIn(industrySlug: string): string[] {
  return industryModule(industrySlug).signals.filter((s) => s.restricted).map((s) => s.id);
}

export const dataSubjectRights = () => ({ ...rules.dataSubjectRights });
