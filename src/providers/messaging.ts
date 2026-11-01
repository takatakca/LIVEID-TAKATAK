import nodemailer, { type Transporter } from 'nodemailer';
import type { Config } from '../config.js';

export interface OutboxMessage {
  channel: 'sms' | 'email';
  to: string;
  subject?: string;
  text: string;
  at: string;
}

/** In-memory copy of console messages, for local development and automated tests only. */
export class DevOutbox {
  private readonly items: OutboxMessage[] = [];
  push(m: Omit<OutboxMessage, 'at'>): void {
    this.items.push({ ...m, at: new Date().toISOString() });
    if (this.items.length > 200) this.items.shift();
  }
  list(): OutboxMessage[] {
    return [...this.items];
  }
  /** Latest 6-digit code sent to `to`, or undefined. */
  latestCode(to: string): string | undefined {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const m = this.items[i]!;
      if (m.to === to) return /\b(\d{6})\b/.exec(m.text)?.[1];
    }
    return undefined;
  }
}

export interface SmsSender {
  send(toE164: string, body: string): Promise<void>;
  /** Optional line-type check. Returns 'mobile', 'voip', 'landline' or 'unknown'. */
  lineType?(toE164: string): Promise<string>;
}

export interface EmailSender {
  send(to: string, subject: string, text: string, html: string): Promise<void>;
}

export class ConsoleSms implements SmsSender {
  constructor(private readonly outbox: DevOutbox, private readonly log: (msg: string) => void) {}
  async send(to: string, body: string): Promise<void> {
    this.outbox.push({ channel: 'sms', to, text: body });
    this.log(`[console sms] to ${to}: ${body}`);
  }
}

export class TwilioSms implements SmsSender {
  constructor(
    private readonly cfg: NonNullable<Config['sms']['twilio']>,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private auth(): string {
    return 'Basic ' + Buffer.from(`${this.cfg.accountSid}:${this.cfg.authToken}`).toString('base64');
  }

  async send(to: string, body: string): Promise<void> {
    const form = new URLSearchParams({ To: to, Body: body });
    if (this.cfg.messagingServiceSid) form.set('MessagingServiceSid', this.cfg.messagingServiceSid);
    else if (this.cfg.from) form.set('From', this.cfg.from);
    const res = await this.fetchImpl(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.cfg.accountSid)}/Messages.json`,
      {
        method: 'POST',
        headers: { Authorization: this.auth(), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form,
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Twilio send failed: HTTP ${res.status} ${detail.slice(0, 200)}`);
    }
  }

  async lineType(to: string): Promise<string> {
    const res = await this.fetchImpl(
      `https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(to)}?Fields=line_type_intelligence`,
      { headers: { Authorization: this.auth() }, signal: AbortSignal.timeout(8_000) },
    );
    if (!res.ok) return 'unknown';
    const json = (await res.json()) as { line_type_intelligence?: { type?: string } };
    const t = json.line_type_intelligence?.type ?? 'unknown';
    if (t === 'mobile') return 'mobile';
    if (t.includes('voip')) return 'voip';
    if (t === 'landline' || t === 'fixedVoip') return t === 'landline' ? 'landline' : 'voip';
    return 'unknown';
  }
}

export class ConsoleEmail implements EmailSender {
  constructor(private readonly outbox: DevOutbox, private readonly log: (msg: string) => void) {}
  async send(to: string, subject: string, text: string): Promise<void> {
    this.outbox.push({ channel: 'email', to, subject, text });
    this.log(`[console email] to ${to}: ${subject} — ${text.split('\n')[0]}`);
  }
}

export class SmtpEmail implements EmailSender {
  private readonly transport: Transporter;
  constructor(smtpUrl: string, private readonly from: string) {
    this.transport = nodemailer.createTransport(smtpUrl);
  }
  async send(to: string, subject: string, text: string, html: string): Promise<void> {
    await this.transport.sendMail({ from: this.from, to, subject, text, html });
  }
}

export function createMessaging(cfg: Config, log: (msg: string) => void): { sms: SmsSender; email: EmailSender; outbox: DevOutbox } {
  const outbox = new DevOutbox();
  const sms: SmsSender = cfg.sms.provider === 'twilio' && cfg.sms.twilio ? new TwilioSms(cfg.sms.twilio) : new ConsoleSms(outbox, log);
  const email: EmailSender =
    cfg.email.provider === 'smtp' && cfg.email.smtpUrl ? new SmtpEmail(cfg.email.smtpUrl, cfg.email.from) : new ConsoleEmail(outbox, log);
  return { sms, email, outbox };
}
