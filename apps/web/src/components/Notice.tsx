import type { ReactNode } from "react"

export type NoticeTone =
  | "info"
  | "success"
  | "warning"
  | "error"

interface NoticeProps {
  children: ReactNode
  role?: "alert" | "status"
  tone?: NoticeTone
}

export function Notice({
  children,
  role,
  tone = "info",
}: NoticeProps) {
  return (
    <div
      className={`notice notice--${tone}`}
      role={role}
    >
      {children}
    </div>
  )
}
