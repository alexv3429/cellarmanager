import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parse } from "@babel/parser"
import { describe, expect, it } from "vitest"

const sourceRoot = fileURLToPath(new URL("../", import.meta.url))
const i18nRoot = fileURLToPath(new URL("./", import.meta.url))
const textAttributes = new Set([
  "alt",
  "aria-description",
  "aria-label",
  "aria-valuetext",
  "placeholder",
  "title",
])
const userMessageSetters = new Set([
  "setError",
  "setMessage",
  "setNotice",
  "setOperationError",
  "setOperationMessage",
  "setSuccess",
])

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      return fullPath === i18nRoot ? [] : sourceFiles(fullPath)
    }
    return /\.(tsx|ts)$/.test(entry.name) && !/\.(test|spec)\.(tsx|ts)$/.test(entry.name)
      ? [fullPath]
      : []
  })
}

function unwrap(node: any): any {
  while (node && ["TSAsExpression", "TSSatisfiesExpression"].includes(node.type)) {
    node = node.expression
  }
  return node
}

function propertiesForVariable(source: string, variableName: string): Map<string, string> {
  const ast = parse(source, { sourceType: "module", plugins: ["typescript"] })
  const properties = new Map<string, string>()
  for (const statement of ast.program.body) {
    if (statement.type !== "ExportNamedDeclaration" || statement.declaration?.type !== "VariableDeclaration") continue
    for (const declaration of statement.declaration.declarations) {
      if (declaration.id.type !== "Identifier" || declaration.id.name !== variableName) continue
      for (const property of unwrap(declaration.init)?.properties ?? []) {
        if (property.type !== "ObjectProperty") continue
        const key = property.key.type === "Identifier" ? property.key.name : property.key.value
        if (typeof key === "string" && property.value.type === "StringLiteral") properties.set(key, property.value.value)
      }
    }
  }
  return properties
}

function placeholders(message: string): string[] {
  return [...new Set([...message.matchAll(/\{(\w+)\}/g)].map((match) => match[1]))].sort()
}

function walk(node: any, visit: (node: any) => void) {
  if (!node || typeof node !== "object") return
  visit(node)
  for (const [key, value] of Object.entries(node)) {
    if (["loc", "start", "end", "comments", "tokens"].includes(key)) continue
    if (Array.isArray(value)) value.forEach((child) => walk(child, visit))
    else if (value && typeof value === "object") walk(value, visit)
  }
}

function collectRenderedText(node: any, collect: (value: string, line: number) => void) {
  if (!node) return
  if (node.type === "StringLiteral") {
    if (/[A-Za-zÀ-ÿ]/.test(node.value)) collect(node.value, node.loc.start.line)
    return
  }
  if (node.type === "TemplateLiteral") {
    const value = node.quasis.map((part: any) => part.value.cooked ?? "").join("{…}")
    if (/[A-Za-zÀ-ÿ]/.test(value)) collect(value, node.loc.start.line)
    return
  }
  if (node.type === "ConditionalExpression") {
    collectRenderedText(node.consequent, collect)
    collectRenderedText(node.alternate, collect)
  } else if (node.type === "LogicalExpression") {
    collectRenderedText(node.right, collect)
  } else if (node.type === "SequenceExpression") {
    collectRenderedText(node.expressions.at(-1), collect)
  } else if (node.type === "BinaryExpression" && node.operator === "+") {
    collectRenderedText(node.left, collect)
    collectRenderedText(node.right, collect)
  }
}

function inspectRenderedNode(node: any, visitText: (value: string, line: number) => void) {
  if (!node) return
  if (node.type === "JSXElement") {
    for (const attribute of node.openingElement.attributes ?? []) {
      if (attribute.type !== "JSXAttribute") continue
      const name = attribute.name?.name
      if (!textAttributes.has(name)) continue
      if (attribute.value?.type === "StringLiteral") {
        collectRenderedText(attribute.value, visitText)
      } else if (attribute.value?.type === "JSXExpressionContainer") {
        collectRenderedText(attribute.value.expression, visitText)
      }
    }
    for (const child of node.children ?? []) inspectRenderedNode(child, visitText)
  } else if (node.type === "JSXFragment") {
    for (const child of node.children ?? []) inspectRenderedNode(child, visitText)
  } else if (node.type === "JSXText") {
    if (/[A-Za-zÀ-ÿ]/.test(node.value)) visitText(node.value.trim().replace(/\s+/g, " "), node.loc.start.line)
  } else if (node.type === "JSXExpressionContainer") {
    collectRenderedText(node.expression, visitText)
  } else {
    for (const [key, value] of Object.entries(node)) {
      if (["loc", "start", "end", "comments", "tokens"].includes(key)) continue
      if (Array.isArray(value)) value.forEach((child) => inspectRenderedNode(child, visitText))
      else if (value && typeof value === "object") inspectRenderedNode(value, visitText)
    }
  }
}

describe("French interface coverage", () => {
  it("preserves interpolation placeholders in translated messages", () => {
    const messagesSource = fs.readFileSync(path.join(i18nRoot, "messages.ts"), "utf8")
    const english = propertiesForVariable(messagesSource, "englishMessages")
    const french = propertiesForVariable(messagesSource, "frenchMessages")
    for (const [key, translation] of french) {
      expect(placeholders(translation), `French message ${key}`).toEqual(placeholders(english.get(key) ?? key))
    }

    for (const [filename, variableName] of [
      ["frenchText.ts", "frenchText"],
      ["frenchTextExtended.ts", "frenchTextExtended"],
      ["frenchTextRuntime.ts", "frenchTextRuntime"],
    ]) {
      const source = fs.readFileSync(path.join(i18nRoot, filename), "utf8")
      for (const [key, translation] of propertiesForVariable(source, variableName)) {
        expect(placeholders(translation), `${filename} message ${key}`).toEqual(placeholders(key))
      }
    }
  })

  it("translates every literal message used by the app", () => {
    const messagesSource = fs.readFileSync(path.join(i18nRoot, "messages.ts"), "utf8")
    const english = propertiesForVariable(messagesSource, "englishMessages")
    const french = propertiesForVariable(messagesSource, "frenchMessages")
    const sourceText = new Map<string, string>()
    for (const filename of ["frenchText.ts", "frenchTextExtended.ts", "frenchTextRuntime.ts"]) {
      const source = fs.readFileSync(path.join(i18nRoot, filename), "utf8")
      const variableName = filename === "frenchText.ts"
        ? "frenchText"
        : filename === "frenchTextExtended.ts"
          ? "frenchTextExtended"
          : "frenchTextRuntime"
      for (const [key, value] of propertiesForVariable(source, variableName)) {
        sourceText.set(key, value)
      }
    }

    const missing = new Set<string>()
    const untranslated = new Set<string>()
    for (const filename of sourceFiles(sourceRoot)) {
      const source = fs.readFileSync(filename, "utf8")
      const ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] })
      inspectRenderedNode(ast.program, (value, line) => {
        untranslated.add(`${path.relative(sourceRoot, filename)}:${line}: ${value}`)
      })
      walk(ast.program, (node) => {
        if (
          node.type === "CallExpression" &&
          node.callee?.type === "Identifier" &&
          userMessageSetters.has(node.callee.name) &&
          node.arguments[0]?.type === "StringLiteral" &&
          /[A-Za-zÀ-ÿ]/.test(node.arguments[0].value)
        ) {
          untranslated.add(`${path.relative(sourceRoot, filename)}: unlocalized ${node.callee.name} message: ${node.arguments[0].value}`)
        }
        if (
          node.type === "CallExpression" &&
          node.callee?.type === "Identifier" &&
          node.callee.name === "t" &&
          node.arguments[0]?.type === "StringLiteral"
        ) {
          const key = node.arguments[0].value
          const sourceMessage = english.get(key) ?? key
          if (!french.has(key) && /[A-Za-zÀ-ÿ]/.test(sourceMessage) && !sourceText.has(sourceMessage)) {
            missing.add(`${path.relative(sourceRoot, filename)}: ${key}`)
          }
        }
      })
    }

    expect([...untranslated].sort(), "Raw app-owned JSX text or accessible labels must use t() and be translated").toEqual([])
    expect([...missing].sort(), "Every literal t() message must have French copy").toEqual([])
  })
})
