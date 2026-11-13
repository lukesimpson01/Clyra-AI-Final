import { HomeIcon, InboxIcon, SettingsIcon, UsersIcon } from "lucide-react"
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider } from "@/registry/new-york-v4/ui/sidebar"

const items = [["Home", HomeIcon], ["Inbox", InboxIcon], ["Team", UsersIcon], ["Settings", SettingsIcon]] as const

export default function SidebarDemo() {
  return (
    <SidebarProvider className="min-h-0 h-[260px] w-full max-w-[560px] overflow-hidden rounded-xl border">
      <Sidebar collapsible="none" className="h-full border-r">
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Workspace</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {items.map(([label, Icon], index) => (
                  <SidebarMenuItem key={label}>
                    <SidebarMenuButton isActive={index === 0}><Icon /><span>{label}</span></SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      <SidebarInset className="p-4 text-sm text-muted-foreground">Main content</SidebarInset>
    </SidebarProvider>
  )
}
