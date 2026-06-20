const nodemailer = require('nodemailer');

function createSmtpTransporter() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = process.env.SMTP_SECURE === 'true';
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
}

function isEmailConfigured() {
  return !!createSmtpTransporter();
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

async function sendMail({ to, subject, html, text, attachments, replyTo }) {
  const transporter = createSmtpTransporter();
  if (!transporter) {
    throw new Error('Email service is not configured');
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  await transporter.sendMail({
    from: `"Virola LIMS" <${from}>`,
    to,
    subject,
    html,
    text,
    attachments,
    replyTo,
  });
}

module.exports = {
  createSmtpTransporter,
  isEmailConfigured,
  escapeHtml,
  isValidEmail,
  sendMail,
};
