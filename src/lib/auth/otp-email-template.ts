const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] || char);

export function renderOtpEmail(code: string, companyName: string, purpose: "reset_password" | "change_password", minutes: number) {
  const title = purpose === "reset_password" ? "Atur ulang kata sandi" : "Konfirmasi perubahan kata sandi";
  const company = escapeHtml(companyName);
  const html = `<!doctype html><html lang="id"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f5f6fb;font-family:Arial,Helvetica,sans-serif;color:#17214d">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:28px 12px;background:#f5f6fb"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fff;border:1px solid #e4e7f0;border-radius:18px;overflow:hidden">
  <tr><td style="padding:26px 32px;border-bottom:1px solid #e4e7f0"><span style="display:inline-block;background:#4f46e5;color:#fff;border-radius:12px;padding:10px 12px;font-size:17px;font-weight:700">HR</span><span style="margin-left:10px;color:#17214d;font-size:18px;font-weight:700">${company}</span></td></tr>
  <tr><td style="padding:32px"><p style="margin:0 0 9px;color:#5d6685;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase">Keamanan akun HRIS</p><h1 style="margin:0 0 16px;font-size:27px;line-height:1.25;color:#17214d">${escapeHtml(title)}</h1><p style="margin:0;color:#4c5877;font-size:15px;line-height:1.7">Masukkan kode berikut untuk melanjutkan. Kode hanya dapat dipakai sekali.</p>
  <div style="margin:28px 0 12px;padding:22px;border-radius:14px;background:#f0efff;border:1px solid #dcd9ff;text-align:center"><span style="display:block;color:#5d6685;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase">Kode verifikasi</span><strong style="display:block;margin-top:9px;color:#3123a4;font-size:36px;line-height:1.3;letter-spacing:9px;user-select:all;-webkit-user-select:all">${escapeHtml(code)}</strong></div>
  <p style="margin:0;color:#68738e;font-size:13px;line-height:1.6">Salin enam angka di atas. Kode berlaku ${minutes} menit.</p></td></tr>
  <tr><td style="padding:22px 32px;background:#fafbfe;border-top:1px solid #e4e7f0;color:#68738e;font-size:12px;line-height:1.6">Jika Anda tidak meminta kode ini, abaikan email ini; kata sandi Anda tidak berubah. Jangan bagikan kode kepada siapa pun, termasuk staf ${company}.<br><br>Email otomatis dari ${company}; mohon jangan dibalas.</td></tr></table></td></tr></table></body></html>`;
  return { subject: `[${companyName.replace(/[\r\n]/g, " ")}] ${title}`, html };
}
