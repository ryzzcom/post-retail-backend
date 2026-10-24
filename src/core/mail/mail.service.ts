import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;
  private readonly defaultFrom: string;

  constructor(private readonly configService: ConfigService) {
    const host = this.configService.get<string>('MAIL_HOST', 'smtp.gmail.com');
    const port = Number(this.configService.get<number>('MAIL_PORT', 587));
    const user = this.configService.get<string>('MAIL_USER', '');
    const pass = this.configService.get<string>('MAIL_PASS', '');
    this.defaultFrom = this.configService.get<string>(
      'MAIL_FROM',
      '"POS Retail" <no-reply@posretail.pk>',
    );

    if (user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
      });
      this.logger.log(`Nodemailer SMTP configured for: ${host}:${port}`);
    } else {
      this.logger.warn(
        'SMTP credentials not fully provided. Emails and OTPs will be logged to the console.',
      );
    }
  }

  /**
   * Sends 6-digit email verification OTP (valid for 5 minutes).
   */
  async sendVerificationOtp(email: string, otp: string): Promise<void> {
    const subject = 'Your POS Retail Verification Code';
    const text = `Your verification code is: ${otp}. It expires in 5 minutes.`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #1e293b; text-align: center;">Welcome to POS Retail</h2>
        <p style="color: #475569; font-size: 16px;">Please use the verification code below to verify your account:</p>
        <div style="background-color: #f1f5f9; padding: 16px; border-radius: 6px; text-align: center; margin: 24px 0;">
          <span style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #0f172a;">${otp}</span>
        </div>
        <p style="color: #64748b; font-size: 14px;">This code will expire in <strong>5 minutes</strong>. If you did not request this code, you can safely ignore this email.</p>
      </div>
    `;

    await this.sendMail({ to: email, subject, text, html });
    this.logger.log(`[VERIFICATION OTP] Sent to: ${email} | Code: ${otp}`);
  }

  /**
   * Sends the auto-generated 4-digit POS PIN to the Store Owner after OTP verification.
   */
  async sendPosSecurityPin(
    email: string,
    fullName: string,
    pin: string,
  ): Promise<void> {
    const subject = 'Your POS Security Terminal PIN';
    const text = `Dear ${fullName}, your POS Terminal PIN is: ${pin}. Keep it confidential.`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #1e293b; text-align: center;">Account Verified Successfully</h2>
        <p style="color: #475569; font-size: 16px;">Dear <strong>${fullName}</strong>,</p>
        <p style="color: #475569; font-size: 16px;">Your store account is verified. Below is your auto-generated 4-digit POS Terminal PIN:</p>
        <div style="background-color: #ecfdf5; border: 1px solid #a7f3d0; padding: 16px; border-radius: 6px; text-align: center; margin: 24px 0;">
          <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #065f46;">${pin}</span>
        </div>
        <p style="color: #475569; font-size: 14px;">Use this PIN to unlock your Owner Profile at any POS terminal or counter. You can change this PIN anytime in your Settings.</p>
        <p style="color: #ef4444; font-size: 13px;"><strong>Security notice:</strong> Never share your PIN with anyone.</p>
      </div>
    `;

    await this.sendMail({ to: email, subject, text, html });
    this.logger.log(`[POS SECURITY PIN] Sent to: ${email} | PIN: ${pin}`);
  }

  /**
   * Sends 6-digit password reset OTP.
   */
  async sendPasswordResetOtp(email: string, otp: string): Promise<void> {
    const subject = 'POS Retail - Password Reset Request';
    const text = `Your password reset code is: ${otp}. It expires in 5 minutes.`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #1e293b; text-align: center;">Password Reset Request</h2>
        <p style="color: #475569; font-size: 16px;">We received a request to reset your password. Use the OTP code below:</p>
        <div style="background-color: #fef2f2; border: 1px solid #fecaca; padding: 16px; border-radius: 6px; text-align: center; margin: 24px 0;">
          <span style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #991b1b;">${otp}</span>
        </div>
        <p style="color: #64748b; font-size: 14px;">This code expires in <strong>5 minutes</strong>. If you did not initiate this request, your account is safe and no action is needed.</p>
      </div>
    `;

    await this.sendMail({ to: email, subject, text, html });
    this.logger.log(`[PASSWORD RESET OTP] Sent to: ${email} | Code: ${otp}`);
  }

  private async sendMail(options: {
    to: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<void> {
    if (!this.transporter) {
      // In dev fallback, logging to console is complete
      return;
    }

    try {
      await this.transporter.sendMail({
        from: this.defaultFrom,
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html,
      });
    } catch (error: any) {
      this.logger.error(
        `Failed to deliver email to ${options.to} via SMTP: ${error.message}. Fallback logged.`,
      );
    }
  }
}
