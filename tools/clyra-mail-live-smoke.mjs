/** Live Chromium integration for the real Clyra Mail UI.
 * Deterministic Google IPC adapter: no email is sent to a real user.
 */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
const base=(process.env.CLYRA_URL||"http://127.0.0.1:3000").replace(/\/$/,"");
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  const errors=[];
  page.on("pageerror", err => {
    const message=String(err);
    // The unrelated workspace websocket may close before its optional
    // startup handshake in standalone Chromium. Do not conflate that with
    // a Mail exception; all other uncaught errors still fail the smoke.
    if (/^Error: WebSocket closed without opened\.?$/.test(message)) return;
    errors.push(message);
  });
  await page.goto(base,{waitUntil:"domcontentloaded"});
  await page.waitForFunction(()=>document.documentElement.dataset.clyraVoiceController==="ready",{timeout:30000});
  await page.evaluate(()=>{
    const message={
      id:"18c6ed8a91def000",threadId:"18c6ed8a91def001",
      senderName:"Client Example",senderEmail:"client@example.com",
      replyTo:"client@example.com",recipientNames:["me"],subject:"Website launch",
      receivedAt:new Date().toISOString(),internalDate:String(Date.now()),isUnread:true,isStarred:false,
      labels:[],snippet:"Can you help us build a new site?",plainTextBody:"Can you help us build a new site?",
      attachments:[{id:"ABCabcdefg123",filename:"brief.txt",mimeType:"text/plain",size:10}],threadMessageCount:1
    };
    window.__mailCalls=[];
    const google={
      status:async()=>({connected:true,email:"me@example.com"}),
      signIn:async()=>({ok:true}),
      execute:async(p)=>{
        window.__mailCalls.push(p);
        if(p.service==="gmail"&&p.action==="search")return {ok:true,gmailResults:{query:p.args.query,total:1,emails:[message]},text:"Found one email"};
        if(p.service==="gmail"&&p.action==="thread")return {ok:true,gmailThread:{id:message.threadId,messages:[message]}};
        if(p.service==="gmail"&&p.action==="modify")return {ok:true,text:"Updated"};
        if(p.service==="gmail"&&p.action==="archive")return {ok:true,text:"Archived"};
        if(p.service==="gmail"&&p.action==="attachment")return {ok:true,attachment:{filename:"brief.txt",mimeType:"text/plain",base64:"aGVsbG8=",size:5}};
        if(p.service==="gmail"&&p.action==="compose"){
          if(p.args.mode==="send"&&!p.confirmed)return {ok:false,requiresConfirmation:true,text:"Approval required"};
          return {ok:true,text:p.args.mode==="send"?"Sent":"Saved",gmailMutation:{messageId:"18c7abc123",draftId:"18c7abc124"}};
        }
        if(p.service==="drive"&&p.action==="search")return {ok:true,driveFiles:[{id:"1abcDEF345XYZ",name:"Website proposal",mimeType:"application/vnd.google-apps.document"}]};
        if(p.service==="drive"&&p.action==="attachment")return {ok:true,attachment:{filename:"Website proposal.pdf",mimeType:"application/pdf",base64:"JVBERi0xLjQ=",size:8}};
        return {ok:false,text:"Unsupported mocked action "+p.service+"."+p.action};
      }
    };
    window.clyraDesktop={runtime:"electron",google};
    window.dispatchEvent(new CustomEvent("clyra:mail:open"));
  });
  const shell=page.locator(".clyra-mail-shell");
  await shell.waitFor();
  await shell.getByRole("heading",{name:"Inbox"}).waitFor();
  await page.locator(".clyra-mail-row").first().waitFor({timeout:10000});
  await mkdir("qa-screenshots/mail",{recursive:true});
  for(const width of [320,375,768,1024,1440]){
    await page.setViewportSize({width,height:900});
    await page.screenshot({path:"qa-screenshots/mail/inbox-"+width+".png"});
    const dims=await shell.evaluate(el=>({visible:el.clientWidth,total:el.scrollWidth}));
    assert.ok(dims.total<=dims.visible+3,"Mail has horizontal overflow at "+width+"px: "+JSON.stringify(dims));
  }
  await page.setViewportSize({width:1440,height:900});
  await shell.getByRole("button",{name:"New message"}).click();
  await shell.getByRole("heading",{name:"New Email"}).waitFor();
  await shell.getByPlaceholder("Recipient email address").fill("client@example.com");
  await shell.getByRole("textbox",{name:"Subject"}).fill("Here is your website proposal");
  await shell.getByRole("textbox",{name:"Email body"}).fill("Hello, here is the proposal for your review.");
  await shell.getByRole("button",{name:"Bold text"}).click();
  await shell.getByRole("button",{name:"From Drive"}).click();
  await shell.getByRole("textbox",{name:"Search Drive"}).fill("proposal");
  await shell.getByRole("button",{name:"Search",exact:true}).click();
  await shell.getByRole("button",{name:/Website proposal/}).click();
  await page.getByText("Website proposal.pdf").waitFor();
  await page.screenshot({path:"qa-screenshots/mail/compose.png"});
  assert.equal((await page.evaluate(()=>window.__mailCalls)).filter(x=>x.action==="compose"&&x.args.mode==="send").length,0,"Email cannot send while composing.");
  await shell.getByRole("button",{name:"Review send"}).click();
  await page.getByRole("heading",{name:"Review before sending"}).waitFor();
  assert.equal((await page.evaluate(()=>window.__mailCalls)).filter(x=>x.action==="compose"&&x.args.mode==="send").length,0,"Review is not a send operation.");
  await page.screenshot({path:"qa-screenshots/mail/send-review.png"});
  await page.getByRole("button",{name:"Keep editing"}).click();
  await shell.getByRole("button",{name:"Review send"}).click();
  await page.getByRole("button",{name:"Confirm and send"}).click();
  await page.getByText("Email sent and accepted by Gmail.").waitFor();
  const calls=await page.evaluate(()=>window.__mailCalls);
  const sends=calls.filter(x=>x.service==="gmail"&&x.action==="compose"&&x.args.mode==="send");
  assert.equal(sends.length,1);
  assert.equal(sends[0].confirmed,true);
  assert.equal(sends[0].args.attachments.length,1);
  assert.equal(sends[0].args.to,"client@example.com");
  await shell.locator(".clyra-mail-row").first().click();
  await shell.getByRole("button",{name:"Reply",exact:true}).waitFor();
  await shell.getByRole("button",{name:"Reply",exact:true}).click();
  await shell.getByRole("heading",{name:"Reply",exact:true}).waitFor();
  await page.screenshot({path:"qa-screenshots/mail/reply.png"});
  await shell.getByRole("button",{name:"Return to inbox"}).click();
  await shell.getByRole("button",{name:"Mail filters"}).click();
  await shell.getByRole("button",{name:"Unread",exact:true}).click();
  await shell.getByRole("button",{name:"Refresh inbox"}).click();
  await page.getByRole("button",{name:"Close mail"}).click();
  await shell.waitFor({state:"detached"});
  // The same event is used by Chat and Voice. Verify the unified AI draft
  // handoff reads Gmail for context, fills a real editor, and never sends.
  await page.route("**/api/deepseek/chat", route => route.fulfill({
    status:200, contentType:"application/json",
    body:JSON.stringify({choices:[{message:{content:JSON.stringify({
      subject:"Website proposal follow-up",
      body:"Hello,\\n\\nI have prepared a proposal for your review.",
    })}}]}),
  }));
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent("clyra:mail:open",{
    detail:{compose:true,instruction:"Draft an email to client@example.com replying about the proposal"}
  })));
  await shell.waitFor();
  await shell.getByRole("heading",{name:"New Email"}).waitFor();
  await page.waitForFunction(()=>{
    const to=document.getElementById("clyra-mail-to");
    const subject=document.getElementById("clyra-mail-subject");
    return to?.value==="client@example.com" && subject?.value==="Website proposal follow-up";
  },{timeout:12000});
  assert.equal((await page.evaluate(()=>window.__mailCalls)).filter(x=>x.action==="compose"&&x.args.mode==="send").length,1,"AI planning never sends another email");
  await page.screenshot({path:"qa-screenshots/mail/ai-draft.png"});
  await page.getByRole("button",{name:"Close mail"}).click();
  await shell.waitFor({state:"detached"});
  assert.deepEqual(errors,[], "Mail workspace must have no uncaught browser errors");
  console.log("clyra-mail-live-smoke: inbox, responsive layouts, compose, Drive attachment, approval, reply and controls passed");
}finally{await browser.close();}
