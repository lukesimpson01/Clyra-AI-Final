import { useEffect, useState } from "react"
import { CircleProgress } from "@/components/ui/circle-progress"

export default function CircleProgressDemo() {
  const [value, setValue] = useState(0.15)
  useEffect(() => { const id = window.setInterval(() => setValue((current) => (current >= 1 ? 0.1 : current + 0.1)), 700); return () => window.clearInterval(id) }, [])
  return <div className="text-primary"><CircleProgress progress={value} size={72} strokeWidth={6} radius={30} /></div>
}
