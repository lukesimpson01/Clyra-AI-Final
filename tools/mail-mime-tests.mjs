import assert from "node:assert/strict";
import { buildGmailMime, parseAddresses, cleanMailHtml } from "../electron/mail-mime.mjs";
const value=buildGmailMime({
  to:"Person@Example.com",cc:"cc@example.com",bcc:"hidden@example.com",
  subject:"Proposal — ready",text:"Hello,\nHere is the document.",
  html:'<p>Hello <strong>client</strong> <img src="https://tracker/x"><script>bad()</script><a href="javascript:alert(1)">unsafe</a></p>',
  attachments:[{filename:"document.pdf",mimeType:"application/pdf",base64:Buffer.from("test-doc").toString("base64")}]
});
const raw=Buffer.from(value.raw,"base64url").toString("utf8");
assert.match(raw,/To: person@example.com/);
assert.match(raw,/Cc: cc@example.com/);
assert.match(raw,/Bcc: hidden@example.com/);
assert.match(raw,/multipart\/mixed/);
assert.match(raw,/filename="document.pdf"/);
assert.match(raw,/Subject: =\?UTF-8\?B\?/);
assert.ok(!raw.includes("bad()"));
assert.ok(!Buffer.from(raw.match(/Content-Type: text\/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n(.+?)\r\n--clyra_alt_/s)?.[1]||"","base64").toString("utf8").includes("javascript:"));
assert.deepEqual(parseAddresses("A@Example.com,a@example.com"),["a@example.com"]);
assert.throws(()=>buildGmailMime({to:"victim@example.com\nBcc: hidden@evil.com",subject:"x",text:"x"}));
assert.throws(()=>buildGmailMime({to:"x@example.com",subject:"hi\r\nCc: hacked",text:""}));
assert.equal(cleanMailHtml('<p onmouseover="evil()">ok</p>'),"<p>ok</p>");
console.log("mail-mime-tests: safe multipart, attachments, recipients and injection protection passed");
