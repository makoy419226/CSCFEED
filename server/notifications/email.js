import nodemailer from "nodemailer";

function getEmailConfig() {
  const host = process.env.SMTP_HOST?.trim();
  const recipients = process.env.REPORT_NOTIFICATION_EMAILS
    ?.split(",")
    .map((address) => address.trim())
    .filter(Boolean) || [];
  const from = process.env.SMTP_FROM?.trim();
  const username = process.env.SMTP_USER?.trim();
  const password = process.env.SMTP_PASSWORD;
  const port = Number(process.env.SMTP_PORT || 587);

  if (!host && recipients.length === 0 && !from && !username && !password) return null;
  if (!host || !from || recipients.length === 0 || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Email notifications require SMTP_HOST, SMTP_FROM, SMTP_PORT, and REPORT_NOTIFICATION_EMAILS.");
  }
  if (Boolean(username) !== Boolean(password)) {
    throw new Error("SMTP_USER and SMTP_PASSWORD must be configured together.");
  }

  return {
    host,
    port,
    secure: process.env.SMTP_SECURE === "true",
    auth: username ? { user: username, pass: password } : undefined,
    from,
    recipients,
  };
}

export async function notifyReportCreated(report) {
  const config = getEmailConfig();
  if (!config) return "skipped";

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.auth,
  });
  await transporter.sendMail({
    from: config.from,
    to: config.recipients,
    subject: `New project report: ${report.title}`,
    text: [
      `Project: ${report.projectName}`,
      `Uploaded by: ${report.uploaderName}`,
      `Report date: ${report.reportDate}`,
      `Description: ${report.description || "(none)"}`,
      `Files:\n${report.fileNames.map((fileName) => `- ${fileName}`).join("\n")}`,
    ].join("\n"),
  });
  return "sent";
}
