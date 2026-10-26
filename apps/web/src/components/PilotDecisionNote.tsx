import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"

import decisionNote from "../../../../docs/drinking-window-first-shared-draft.md?raw"

const originalDocsBase = "https://github.com/alexv3429/cellarmanager/blob/main/docs/"

function sourceHref(href?: string) {
  if (!href) return undefined
  try {
    const url = new URL(href, originalDocsBase)
    return url.protocol === "https:" ? url.href : undefined
  } catch {
    return undefined
  }
}

export default function PilotDecisionNote() {
  return <div className="drinking-window-source-note__document">
    <Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
      h1: ({ children }) => <h5>{children}</h5>,
      h2: ({ children }) => <h6>{children}</h6>,
      a: ({ href, children }) => sourceHref(href)
        ? <a href={sourceHref(href)} target="_self">{children}</a>
        : <span>{children}</span>,
    }}>{decisionNote}</Markdown>
  </div>
}
