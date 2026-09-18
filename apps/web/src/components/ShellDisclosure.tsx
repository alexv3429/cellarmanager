import { useEffect, useId, useRef, type ReactNode } from "react"

interface ShellDisclosureProps {
  children: ReactNode
  className?: string
  label: ReactNode
  accessibleLabel: string
  open: boolean
  onToggle: () => void
  onClose: () => void
}

// Ordinary disclosure controls, not ARIA menus: links, selects and confirmation
// forms retain native keyboard behavior. At most one is open in AppShell.
export function ShellDisclosure({ children, className = "", label, accessibleLabel, open, onToggle, onClose }: ShellDisclosureProps) {
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) onClose()
    }
    document.addEventListener("pointerdown", dismiss)
    return () => document.removeEventListener("pointerdown", dismiss)
  }, [open, onClose])

  return <div className={`shell-disclosure ${className}`} ref={root}
    onBlur={(event) => {
      if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) onClose()
    }}
    onKeyDown={(event) => {
      if (event.key === "Escape" && open && !event.defaultPrevented) {
        event.preventDefault()
        event.stopPropagation()
        onClose()
        trigger.current?.focus()
      }
    }}>
    <button id={`${id}-trigger`} ref={trigger} type="button" className="shell-disclosure__trigger"
      aria-label={accessibleLabel} aria-expanded={open} aria-controls={`${id}-panel`} onClick={onToggle}>
      {label}<span className="shell-disclosure__chevron" aria-hidden="true">⌄</span>
    </button>
    {open ? <div id={`${id}-panel`} className="shell-disclosure__panel" role="region" aria-labelledby={`${id}-trigger`}>
      {children}
    </div> : null}
  </div>
}
