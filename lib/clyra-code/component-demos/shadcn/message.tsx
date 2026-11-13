import { Message, MessageAvatar, MessageContent, MessageGroup, MessageHeader } from "@/registry/new-york-v4/ui/message"
import { Avatar, AvatarFallback } from "@/registry/new-york-v4/ui/avatar"

export default function MessageDemo() {
  return (
    <MessageGroup className="w-full max-w-sm gap-4">
      <Message>
        <MessageAvatar><Avatar><AvatarFallback>CL</AvatarFallback></Avatar></MessageAvatar>
        <MessageContent>
          <MessageHeader>Clyra</MessageHeader>
          <p className="rounded-2xl bg-muted px-3.5 py-2">I found three layouts that fit your brief.</p>
        </MessageContent>
      </Message>
      <Message align="end">
        <MessageContent>
          <p className="rounded-2xl bg-primary px-3.5 py-2 text-primary-foreground">Show me the second one.</p>
        </MessageContent>
      </Message>
    </MessageGroup>
  )
}
