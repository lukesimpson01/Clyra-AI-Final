import { Bubble, BubbleContent, BubbleGroup } from "@/registry/new-york-v4/ui/bubble"

export default function BubbleDemo() {
  return (
    <BubbleGroup className="w-full max-w-sm">
      <Bubble variant="muted"><BubbleContent className="rounded-2xl px-3.5 py-2 text-sm">Can you make the pricing table responsive?</BubbleContent></Bubble>
      <Bubble align="end"><BubbleContent className="rounded-2xl px-3.5 py-2 text-sm">Done — it stacks below 640px.</BubbleContent></Bubble>
      <Bubble variant="tinted" align="end"><BubbleContent className="rounded-2xl px-3.5 py-2 text-sm">Want me to add a toggle for yearly billing?</BubbleContent></Bubble>
    </BubbleGroup>
  )
}
