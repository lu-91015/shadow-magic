// 失败通知：优先走 SMTP 邮件（需配置 NOTIFY_EMAIL + SMTP_*），否则走 Webhook。
import nodemailer from 'nodemailer';

export async function notifyFailure(subject: string, body: string): Promise<void> {
  const to = process.env.NOTIFY_EMAIL;
  const host = process.env.SMTP_HOST;
  if (to && host) {
    try {
      const transporter = nodemailer.createTransport({
        host,
        port: Number(process.env.SMTP_PORT ?? 465),
        secure: (process.env.SMTP_SECURE ?? 'true') !== 'false',
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
      });
      await transporter.sendMail({
        from: process.env.SMTP_FROM ?? to,
        to,
        subject,
        text: body,
      });
      return;
    } catch (e) {
      console.error('[notify] 邮件发送失败，回退 Webhook:', (e as Error).message);
    }
  }
  const webhook = process.env.NOTIFY_WEBHOOK;
  if (!webhook) {
    console.warn('[notify] 未配置 SMTP 与 NOTIFY_WEBHOOK，跳过通知:', subject);
    return;
  }
  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, text: body }),
    });
  } catch (e) {
    console.error('[notify] Webhook 发送失败:', (e as Error).message);
  }
}
