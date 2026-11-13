import { CheckCircle2Icon, SparklesIcon } from "lucide-react"
import { Marker, MarkerContent, MarkerIcon } from "@/registry/new-york-v4/ui/marker"

export default function MarkerDemo() {
  return (
    <div className="flex flex-col items-center gap-3">
      <Marker><MarkerIcon><SparklesIcon /></MarkerIcon><MarkerContent>Clyra started working</MarkerContent></Marker>
      <Marker><MarkerIcon><CheckCircle2Icon /></MarkerIcon><MarkerContent>Preview ready</MarkerContent></Marker>
    </div>
  )
}
