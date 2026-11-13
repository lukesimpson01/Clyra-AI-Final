/** Strict MIME builder for Clyra's already authenticated Gmail transport.
 * Pure module: no OAuth tokens, no network, no UI.
 */
import crypto from "node:crypto";

const MAILBOX = /^[A-Z0-9.!#$%&'*+/=?^_\x60{|}~-]+@[A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?\.[A-Z]{2,}$/i;
const lineSafe = (text, max) => String(text ?? "").replace(/[\r\n\x00-\x1f\x7f]+/g, " ").trim().slice(0,max);
export function parseAddresses(value) {
  const parts = String(value ?? "").split(/[;,]/).map(s => s.trim()).filter(Boolean);
  if (parts.length > 30 || parts.some(part => !MAILBOX.test(part))) throw new Error("Enter valid email addresses separated by commas.");
  return [...new Set(parts.map(part=>part.toLowerCase()))];
}
export function escapeMailHtml(value) {
  return String(value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
export function cleanMailHtml(value) {
  const html = String(value || "").slice(0,180_000)
    .replace(/<!--[\s\S]*?-->/g,"")
    .replace(/<(script|style|iframe|object|embed|form|svg|math|video|audio)[^>]*>[\s\S]*?<\/\1\s*>/gi,"")
    .replace(/<\/?(?:img|input|button|video|audio|meta|link)[^>]*>/gi,"");
  return html.replace(/<([^>]+)>/g, (raw, inside) => {
    const name = inside.match(/^\/?\s*([a-z][a-z0-9]*)\b/i)?.[1]?.toLowerCase();
    if (!name || !["p","div","br","strong","b","em","i","u","s","strike","ul","ol","li","blockquote","pre","code","h1","h2","h3","a","span"].includes(name)) return "";
    if (/^\s*\//.test(inside)) return name === "br" ? "" : "</"+name+">";
    if (name === "a") {
      const href = inside.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i)?.slice(1).find(Boolean) || "";
      const safe = /^(https:\/\/|mailto:)/i.test(href) && !/[\s"<>]/.test(href);
      return safe ? '<a href="'+escapeMailHtml(href)+'" rel="noopener noreferrer">' : "<a>";
    }
    return "<"+name+">";
  });
}
function quoteText(text) { return String(text ?? "").replace(/\r\n?/g,"\n").replace(/\x00/g,"").slice(0,160_000); }
function encodedHeader(input) { const text=lineSafe(input,500); return /[^\x20-\x7e]/.test(text) ? "=?UTF-8?B?"+Buffer.from(text).toString("base64")+"?=" : text; }
function cleanFilename(value) { return lineSafe(value,180).replace(/[\\/:*?"<>|]/g,"_") || "attachment"; }
export function buildGmailMime(input) {
  const to = parseAddresses(input.to);
  const cc = parseAddresses(input.cc);
  const bcc = parseAddresses(input.bcc);
  if (!to.length) throw new Error("An email recipient is required.");
  const subject=lineSafe(input.subject,300);
  if (!subject) throw new Error("An email subject is required.");
  const plain=quoteText(input.text);
  const html=cleanMailHtml(input.html);
  if (!plain.trim() && !html.trim()) throw new Error("An email message is required.");
  const files=Array.isArray(input.attachments) ? input.attachments : [];
  if (files.length > 8) throw new Error("Attach no more than eight files.");
  let total=0;
  const attachments=files.map(item=>{
    const encoded=String(item.base64 || "").replace(/\s/g,"");
    if (!encoded || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error("An attachment is not valid base64.");
    const bytes=Buffer.from(encoded,"base64");
    if (bytes.length > 9_000_000) throw new Error("An attachment exceeds the 9 MB limit.");
    total+=bytes.length;
    const name=cleanFilename(item.filename);
    const mime=String(item.mimeType||"application/octet-stream");
    if (!/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/i.test(mime)) throw new Error("Invalid attachment MIME type.");
    return {name,mime,encoded:bytes.toString("base64").replace(/.{1,76}/g,"$&\r\n").trim()};
  });
  if(total>12_000_000) throw new Error("Total attachments must be under 12 MB.");
  const boundary="clyra_"+crypto.randomUUID().replace(/-/g,"");
  const alt="clyra_alt_"+crypto.randomUUID().replace(/-/g,"");
  const head=[
    "To: "+to.join(", "),
    ...(cc.length ? ["Cc: "+cc.join(", ")] : []),
    ...(bcc.length ? ["Bcc: "+bcc.join(", ")] : []),
    "Subject: "+encodedHeader(subject),
    ...(input.inReplyTo && /^[\x20-\x7e]{1,500}$/.test(input.inReplyTo) ? ["In-Reply-To: "+input.inReplyTo, "References: "+input.inReplyTo] : []),
    "MIME-Version: 1.0",
    "Content-Type: multipart/mixed; boundary=\""+boundary+"\""
  ];
  const normalizedHtml=html||"<p>"+escapeMailHtml(plain).replace(/\n/g,"<br>")+"</p>";
  const sections=[
    "--"+boundary,
    "Content-Type: multipart/alternative; boundary=\""+alt+"\"",
    "",
    "--"+alt,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(plain).toString("base64"),
    "--"+alt,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(normalizedHtml).toString("base64"),
    "--"+alt+"--",
  ];
  for(const f of attachments) sections.push(
    "--"+boundary,
    'Content-Type: '+f.mime+'; name="'+f.name+'"',
    "Content-Transfer-Encoding: base64",
    'Content-Disposition: attachment; filename="'+f.name+'"',
    "",
    f.encoded,
  );
  sections.push("--"+boundary+"--");
  const raw=Buffer.from(head.join("\r\n")+"\r\n\r\n"+sections.join("\r\n")).toString("base64url");
  return { raw, recipients: { to,cc,bcc }, subject, attachmentCount:attachments.length };
}
