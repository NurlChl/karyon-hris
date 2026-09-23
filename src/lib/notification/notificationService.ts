import nodemailer from "nodemailer";

export interface SendEmailPayload {
  to: string;
  subject: string;
  html: string;
}

export interface SendWhatsappPayload {
  to: string;
  message: string;
}

/**
 * Sends a generic notification payload to a webhook URL in JSON format.
 * Useful for n8n, GHL, or custom automations.
 */
async function triggerWebhook(payload: Record<string, unknown>): Promise<boolean> {
  const webhookUrl = process.env.NOTIFICATION_WEBHOOK_URL;
  if (!webhookUrl) return false;

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...payload,
        timestamp: new Date().toISOString()
      })
    });
    return res.ok;
  } catch (err) {
    console.error("Notification Webhook trigger failed:", err);
    return false;
  }
}

/**
 * Sends email notifications using configured provider (SMTP / Resend / Webhook)
 */
export async function sendEmail({ to, subject, html }: SendEmailPayload): Promise<boolean> {
  const provider = process.env.EMAIL_PROVIDER || "smtp";
  
  // Try sending via Webhook if configured or explicitly requested
  if (provider === "webhook") {
    return await triggerWebhook({ type: "email", to, subject, html });
  } else if (process.env.NOTIFICATION_WEBHOOK_URL) {
    // Trigger webhook asynchronously in background so we do not block primary email sending
    triggerWebhook({ type: "email", to, subject, html }).catch(err => 
      console.error("Background webhook trigger failed for email:", err)
    );
  }

  if (provider === "resend" && process.env.RESEND_API_KEY) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.RESEND_API_KEY}`
        },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM || "noreply@hris.com",
          to: [to],
          subject,
          html
        })
      });
      const data = await res.json();
      return res.ok;
    } catch (err) {
      console.error("Resend email delivery failed:", err);
      return false;
    }
  }

  // Default SMTP provider using nodemailer
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "587");
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    console.warn("SMTP credentials not fully configured. Email delivery bypassed.");
    return false;
  }

  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass }
    });

    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM || "noreply@hris.com",
      to,
      subject,
      html
    });

    return !!info.messageId;
  } catch (err) {
    console.error("SMTP email delivery failed:", err);
    return false;
  }
}

/**
 * Sends WhatsApp notifications using configured provider (Fonnte / Twilio / Webhook)
 */
export async function sendWhatsapp({ to, message }: SendWhatsappPayload): Promise<boolean> {
  const provider = process.env.WA_PROVIDER || "none";

  // Try sending via Webhook if configured or explicitly requested
  if (provider === "webhook") {
    return await triggerWebhook({ type: "whatsapp", to, message });
  } else if (process.env.NOTIFICATION_WEBHOOK_URL) {
    // Trigger webhook asynchronously in background so we do not block primary whatsapp sending
    triggerWebhook({ type: "whatsapp", to, message }).catch(err => 
      console.error("Background webhook trigger failed for whatsapp:", err)
    );
  }

  if (provider === "fonnte" && process.env.FONNTE_TOKEN) {
    try {
      const res = await fetch("https://api.fonnte.com/send", {
        method: "POST",
        headers: {
          "Authorization": process.env.FONNTE_TOKEN
        },
        body: new URLSearchParams({
          target: to,
          message: message
        })
      });
      const data = await res.json();
      return !!data.status;
    } catch (err) {
      console.error("Fonnte WhatsApp sending failed:", err);
      return false;
    }
  }

  if (provider === "twilio" && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    try {
      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      const fromNumber = process.env.TWILIO_FROM_NUMBER || "";

      // Format recipient to WhatsApp twilio style: "whatsapp:+62xxxxxxxx"
      const formattedTo = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;
      const formattedFrom = fromNumber.startsWith("whatsapp:") ? fromNumber : `whatsapp:${fromNumber}`;

      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
        method: "POST",
        headers: {
          "Authorization": "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          To: formattedTo,
          From: formattedFrom,
          Body: message
        })
      });

      return res.ok;
    } catch (err) {
      console.error("Twilio WhatsApp sending failed:", err);
      return false;
    }
  }

  if (provider === "qontak" && process.env.QONTAK_API_TOKEN) {
    try {
      const apiToken = process.env.QONTAK_API_TOKEN;
      const channelIntegrationId = process.env.QONTAK_CHANNEL_INTEGRATION_ID || "";
      const templateId = process.env.QONTAK_TEMPLATE_ID || "";
      const baseUrl = process.env.QONTAK_BASE_URL || "https://service-chat.qontak.com";
      const defaultToName = process.env.QONTAK_DEFAULT_TO_NAME || "Karyawan";
      const languageCode = process.env.QONTAK_LANGUAGE_CODE || "id";

      // Qontak expects international format: e.g. 628123456789 (no "+" sign, no leading "0")
      let formattedTo = to.replace(/[^0-9]/g, "");
      if (formattedTo.startsWith("0")) {
        formattedTo = "62" + formattedTo.slice(1);
      } else if (formattedTo.length > 0 && !formattedTo.startsWith("62")) {
        formattedTo = "62" + formattedTo;
      }

      const res = await fetch(`${baseUrl}/api/open/v1/broadcasts/whatsapp/direct`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          to_number: formattedTo,
          to_name: defaultToName,
          message_template_id: templateId,
          channel_integration_id: channelIntegrationId,
          language: {
            code: languageCode
          },
          parameters: {
            body: [
              {
                key: "1",
                value: "message",
                value_text: message
              }
            ]
          }
        })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        console.error("Qontak WhatsApp sending failed with status:", res.status, data);
        return false;
      }
      return true;
    } catch (err) {
      console.error("Qontak WhatsApp sending failed with error:", err);
      return false;
    }
  }

  console.info("WhatsApp provider set to none or credentials missing. Message bypassed:", message);
  return false;
}
