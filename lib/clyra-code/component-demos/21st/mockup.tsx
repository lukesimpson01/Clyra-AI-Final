import { Mockup, MockupFrame } from "@/components/ui/mockup"

export default function MockupDemo() {
  return (
    <MockupFrame className="w-full max-w-[460px]">
      <Mockup type="responsive"><div className="flex h-[200px] items-center justify-center bg-gradient-to-br from-zinc-100 to-zinc-200 text-sm text-zinc-500">Your app screenshot</div></Mockup>
    </MockupFrame>
  )
}
