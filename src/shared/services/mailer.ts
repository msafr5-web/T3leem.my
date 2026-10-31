import nodemailer from 'nodemailer';
import { HttpError } from '../utils/http-error';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export interface SmtpConfig {
  host: string;
  port: number;
  /** Implicit TLS (465) vs required STARTTLS; default follows the port. */
  secure?: boolean;
  user: string;
  password: string;
  from: string;
}

/** SMTP over TLS (port 465 = implicit TLS, otherwise STARTTLS is required). */
export class SmtpMailer implements Mailer {
  private readonly transport: nodemailer.Transporter;

  constructor(private readonly config: SmtpConfig) {
    this.transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure ?? config.port === 465,
      requireTLS: !(config.secure ?? config.port === 465),
      auth: { user: config.user, pass: config.password },
      connectionTimeout: 10_000,
      socketTimeout: 15_000,
    });
  }

  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.config.from, to: message.to, subject: message.subject, text: message.text, html: message.html });
  }
}

/** Used when SMTP is not configured: sending fails loudly rather than silently skipping verification. */
export class UnconfiguredMailer implements Mailer {
  async send(): Promise<void> {
    throw new HttpError(503, 'MAIL_UNAVAILABLE', 'E-mail sending is not configured');
  }
}
