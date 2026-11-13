import MultipleSelector from "@/components/ui/multiselect"

const options = [{ value: "react", label: "React" }, { value: "vue", label: "Vue" }, { value: "svelte", label: "Svelte" }, { value: "solid", label: "Solid" }]
export default function MultiselectDemo() {
  return <div className="w-full max-w-sm"><MultipleSelector defaultOptions={options} placeholder="Choose frameworks" emptyIndicator={<p className="text-center text-sm">No results.</p>} /></div>
}
