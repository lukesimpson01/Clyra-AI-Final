import { Tag } from "@/components/ui/tag"

export default function TagDemo() {
  return <div className="flex flex-wrap gap-2 text-sm"><Tag slug="hero" name="hero" /><Tag slug="pricing" name="pricing" /><Tag slug="animation" name="animation" /></div>
}
