import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const BREVO_SEND_URL = 'https://api.brevo.com/v3/smtp/email';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly apiKey: string | undefined;
  private readonly sender: { name: string; email: string };

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('BREVO_API_KEY')?.trim() || undefined;
    this.sender = parseSender(
      this.config.get('BREVO_SENDER_NAME'),
      this.config.get('BREVO_SENDER_EMAIL') ?? this.config.get('MAIL_FROM'),
    );
  }

  async sendOtp(email: string, code: string, purpose: string) {
    const minutes = this.config.get('OTP_EXPIRES_MINUTES') ?? 10;
    const subject =
      purpose === 'PASSWORD_RESET'
        ? 'Reset your CONSTRIQ password'
        : purpose === 'LOGIN'
          ? 'Your CONSTRIQ sign-in code'
          : 'Verify your CONSTRIQ email';
    const html = `
      <p>Your CONSTRIQ verification code is:</p>
      <p style="font-size:24px;letter-spacing:4px;font-weight:bold">${code}</p>
      <p>This code expires in ${minutes} minutes.</p>
      <p>If you did not request this, you can ignore this email.</p>
    `;

    await this.send({ to: email, subject, html });
  }

  async sendInvite(input: {
    to: string;
    name: string;
    roleName: string;
    companyName: string;
    invitedBy: string;
  }) {
    const origin = this.config.get<string>('APP_ORIGIN')?.replace(/\/$/, '') || 'http://localhost:5173';
    const link = `${origin}/accept-invite?email=${encodeURIComponent(input.to)}`;
    const html = `
      <p>Hello ${input.name},</p>
      <p>${input.invitedBy} invited you to <strong>${input.companyName}</strong> on CONSTRIQ as <strong>${input.roleName}</strong>.</p>
      <p>Your role is already assigned. Set your password here, then enter the verification code we send:</p>
      <p><a href="${link}">${link}</a></p>
      <p>If you did not expect this, you can ignore this email.</p>
    `;
    await this.send({
      to: input.to,
      subject: `You are invited to ${input.companyName} on CONSTRIQ`,
      html,
    });
  }

  private async send(input: { to: string; subject: string; html: string }) {
    if (!this.apiKey) {
      this.logger.warn(
        `BREVO_API_KEY is not set. Email to ${input.to} was not sent.`,
      );
      if (this.config.get('NODE_ENV') === 'production') {
        throw new InternalServerErrorException('Email delivery is not configured');
      }
      return;
    }

    const response = await fetch(BREVO_SEND_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'api-key': this.apiKey,
      },
      body: JSON.stringify({
        sender: this.sender,
        to: [{ email: input.to }],
        subject: input.subject,
        htmlContent: input.html,
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      this.logger.error(`Brevo send failed (${response.status}): ${detail}`);
      if (response.status === 401 && detail.includes('authorised_ips')) {
        throw new InternalServerErrorException(
          'Brevo blocked this server IP. Add it under Security → Authorised IPs, or turn off IP restriction for the API key.',
        );
      }
      if (response.status === 400 && /sender/i.test(detail)) {
        throw new InternalServerErrorException(
          'Brevo rejected the sender. Verify noreply@constriq.app (or BREVO_SENDER_EMAIL) in Brevo Senders.',
        );
      }
      throw new InternalServerErrorException('Failed to send email');
    }

    const payload = (await response.json().catch(() => null)) as { messageId?: string } | null;
    this.logger.log(`Brevo accepted email to ${input.to} messageId=${payload?.messageId ?? 'unknown'}`);
  }
}

function parseSender(
  name: string | undefined,
  from: string | undefined,
): { name: string; email: string } {
  const fallbackName = name?.trim() || 'CONSTRIQ';
  const value = from?.trim() || 'noreply@constriq.app';
  const match = value.match(/^(.*)<([^>]+)>$/);
  if (match) {
    return {
      name: match[1].trim().replace(/^"|"$/g, '') || fallbackName,
      email: match[2].trim(),
    };
  }
  return { name: fallbackName, email: value };
}
