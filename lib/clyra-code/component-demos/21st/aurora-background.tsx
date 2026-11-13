import { AuroraBackground } from "@/components/ui/aurora-background"

export default function AuroraBackgroundDemo() {
  return (
    <AuroraBackground className="!h-[260px] w-full max-w-[560px] overflow-hidden rounded-2xl">
      <div className="relative z-10 flex flex-col items-center gap-2 text-center">
        <p className="text-3xl font-semibold tracking-tight text-zinc-900">Background lights</p>
        <p className="text-sm text-zinc-600">A slow, drifting aurora behind your hero.</p>
      </div>
    </AuroraBackground>
  )
}
