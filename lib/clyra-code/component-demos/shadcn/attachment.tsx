import { FileTextIcon, XIcon } from "lucide-react"
import { Attachment, AttachmentAction, AttachmentActions, AttachmentContent, AttachmentDescription, AttachmentGroup, AttachmentMedia, AttachmentTitle } from "@/registry/new-york-v4/ui/attachment"

export default function AttachmentDemo() {
  return (
    <AttachmentGroup className="w-full max-w-sm">
      {[["brief.pdf", "PDF · 2.4 MB"], ["moodboard.fig", "Figma · 18 MB"]].map(([name, meta]) => (
        <Attachment key={name}>
          <AttachmentMedia><FileTextIcon /></AttachmentMedia>
          <AttachmentContent>
            <AttachmentTitle>{name}</AttachmentTitle>
            <AttachmentDescription>{meta}</AttachmentDescription>
          </AttachmentContent>
          <AttachmentActions><AttachmentAction aria-label={"Remove " + name}><XIcon /></AttachmentAction></AttachmentActions>
        </Attachment>
      ))}
    </AttachmentGroup>
  )
}
