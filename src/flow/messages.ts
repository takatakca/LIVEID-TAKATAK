export type Locale = 'fr' | 'en';

/** SMS text. The last line lets browsers fill the code only on our own site (WebOTP origin binding). */
export function smsText(locale: Locale, code: string, host: string): string {
  const body =
    locale === 'fr'
      ? `TAKATAK LIVE ID : votre code est ${code}. Il expire dans 10 minutes. Ne le donnez à personne, même pas à nous.`
      : `TAKATAK LIVE ID: your code is ${code}. It expires in 10 minutes. Never share it, not even with us.`;
  return `${body}\n\n@${host} #${code}`;
}

export function emailContent(locale: Locale, code: string): { subject: string; text: string; html: string } {
  const fr = locale === 'fr';
  const subject = fr ? 'Votre code de vérification TAKATAK LIVE ID' : 'Your TAKATAK LIVE ID verification code';
  const lead = fr ? 'Votre code de vérification :' : 'Your verification code:';
  const note = fr
    ? 'Il expire dans 10 minutes. Si vous n’avez rien demandé, ignorez ce courriel.'
    : 'It expires in 10 minutes. If you did not ask for it, ignore this email.';
  const text = `${lead} ${code}\n\n${note}\n\nGROUPE TAKATAK — takatak.ca`;
  const html = `<!doctype html><html lang="${locale}"><body style="margin:0;background:#060D1F;font-family:Inter,Arial,sans-serif;color:#F5F8FC">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:480px;background:#0B1B3D;border-radius:16px;padding:32px">
<tr><td style="font-size:12px;letter-spacing:4px;color:#B8C4D3">GROUPE TAKATAK · LIVE ID</td></tr>
<tr><td style="padding-top:16px;font-size:16px">${lead}</td></tr>
<tr><td style="padding:16px 0;font-size:36px;font-weight:800;letter-spacing:8px;color:#29C3FF">${code}</td></tr>
<tr><td style="font-size:14px;color:#B8C4D3">${note}</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, text, html };
}

/** Masks a phone number for display: +15145551234 -> +1 •••••••34 */
export function maskPhone(e164: string): string {
  return `${e164.slice(0, 2)} ${'•'.repeat(Math.max(1, e164.length - 4))}${e164.slice(-2)}`;
}

export function maskEmail(email: string): string {
  const [user = '', domain = ''] = email.split('@');
  return `${user.slice(0, 2)}${'•'.repeat(Math.max(1, user.length - 2))}@${domain}`;
}
