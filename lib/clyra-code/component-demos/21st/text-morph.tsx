import { useEffect, useState } from "react"
import { TextMorph } from "@/components/ui/text-morph"

const words = ["Design", "Build", "Ship"]
export default function TextMorphDemo() {
  const [index, setIndex] = useState(0)
  useEffect(() => { const id = window.setInterval(() => setIndex((value) => (value + 1) % words.length), 1800); return () => window.clearInterval(id) }, [])
  return <TextMorph as="p" className="text-4xl font-semibold tracking-tight">{words[index]}</TextMorph>
}
