import { Banner } from "@/components/ui/banner"

export default function BannerDemo() {
  return (
    <div className="w-full max-w-md space-y-3">
      <Banner variant="muted" rounded="default">Version 2.0 is live — see what changed.</Banner>
      <Banner variant="default" rounded="default" size="sm">Scheduled maintenance tonight at 22:00 UTC.</Banner>
    </div>
  )
}
