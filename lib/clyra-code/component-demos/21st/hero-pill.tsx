import { HeroPill, StarIcon } from "@/components/ui/hero-pill"

export default function HeroPillDemo() {
  return <div className="rounded-xl bg-zinc-900 p-8"><HeroPill className="!mb-0" icon={<StarIcon />} text="New releases every week" /></div>
}
