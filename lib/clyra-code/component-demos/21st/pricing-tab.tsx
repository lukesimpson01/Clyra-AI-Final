import { useState } from "react"
import { Tab } from "@/components/ui/pricing-tab"

export default function PricingTabDemo() {
  const [selected, setSelected] = useState("Monthly")
  return (
    <div className="relative mx-auto flex w-fit rounded-full border bg-muted p-1">
      {["Monthly", "Yearly"].map((text) => <Tab key={text} text={text} selected={selected === text} setSelected={setSelected} discount={text === "Yearly"} />)}
    </div>
  )
}
