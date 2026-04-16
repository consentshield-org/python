// Resend client for rights request emails

function resolveFrom(): string {
  const from = process.env.RESEND_FROM
  if (!from) {
    throw new Error('RESEND_FROM must be set (e.g. noreply@consentshield.in)')
  }
  return from
}

export async function sendOtpEmail(to: string, code: string, orgName: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('RESEND_API_KEY not set — OTP email would be:', code)
    return
  }

  const from = resolveFrom()

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `ConsentShield <${from}>`,
      to: [to],
      subject: `Your verification code: ${code}`,
      html: `<p>Your verification code for the rights request to <strong>${orgName}</strong> is:</p>
             <p style="font-size:24px;font-family:monospace;letter-spacing:4px;">${code}</p>
             <p>This code expires in 15 minutes. If you did not request this, you can safely ignore this email.</p>
             <p style="color:#666;font-size:12px;margin-top:24px;">Sent by ConsentShield on behalf of ${orgName}.</p>`,
      text: `Your verification code for the rights request to ${orgName} is: ${code}\n\nThis code expires in 15 minutes.`,
    }),
  })
}

export async function sendComplianceNotification(
  to: string,
  orgName: string,
  requestType: string,
  requestorName: string,
  requestorEmail: string,
  dashboardUrl: string,
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return

  const from = resolveFrom()

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `ConsentShield <${from}>`,
      to: [to],
      subject: `New ${requestType} request from ${requestorName}`,
      html: `<p>A new <strong>${requestType}</strong> rights request has been submitted for ${orgName}.</p>
             <ul>
               <li><strong>Name:</strong> ${requestorName}</li>
               <li><strong>Email:</strong> ${requestorEmail}</li>
               <li><strong>Type:</strong> ${requestType}</li>
             </ul>
             <p>The SLA deadline is 30 days from submission. Review and respond in the dashboard:</p>
             <p><a href="${dashboardUrl}">${dashboardUrl}</a></p>`,
      text: `New ${requestType} request from ${requestorName} (${requestorEmail}). Review at ${dashboardUrl}`,
    }),
  })
}
