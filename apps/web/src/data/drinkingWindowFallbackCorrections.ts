import type { MemberKind } from "./drinkingWindowFallbackAuthoring"

interface RpcOptions {
  rpc?: (name: string, parameters: Record<string, unknown>) => PromiseLike<{
    data?: unknown
    error: { message: string } | null
  }>
}

async function call(name: string, parameters: Record<string, unknown>, options: RpcOptions): Promise<unknown> {
  let rpc = options.rpc
  if (!rpc) {
    const { supabase } = await import("./supabase")
    rpc = supabase.rpc.bind(supabase)
  }
  const result = await rpc(name, parameters)
  if (result.error) throw new Error(result.error.message)
  return result.data
}

export type FallbackCorrectionKind = "row" | "group" | "membership"

export interface FallbackSubject {
  hash: string
  kind: FallbackCorrectionKind
  data: Record<string, unknown>
}

export async function getFallbackSubject(versionId: string, kind: FallbackCorrectionKind,
  subjectId: string, options: RpcOptions = {}): Promise<FallbackSubject> {
  const data = await call("get_drinking_window_fallback_subject", {
    p_version_id: versionId, p_kind: kind, p_subject_id: subjectId,
  }, options)
  if (!data || typeof data !== "object" || Array.isArray(data)
    || typeof (data as Record<string, unknown>).hash !== "string") {
    throw new Error("Invalid fallback subject")
  }
  return { kind, hash: (data as Record<string, unknown>).hash as string,
    data: data as Record<string, unknown> }
}

export async function correctFallbackSubject(input: {
  versionId: string
  kind: FallbackCorrectionKind
  subjectId: string
  expectedHash: string
  changes: Record<string, unknown>
}, options: RpcOptions = {}): Promise<string> {
  const result = await call("correct_drinking_window_fallback_subject", {
    p_version_id: input.versionId, p_kind: input.kind,
    p_subject_id: input.subjectId, p_expected_hash: input.expectedHash,
    p_changes: input.changes,
  }, options)
  if (typeof result !== "string" || !/^[0-9a-f]{64}$/.test(result)) throw new Error("Invalid correction result")
  return result
}

export function memberTargetId(data: Record<string, unknown>, kind: MemberKind): string {
  const value = kind === "place" ? data.member_place_id
    : kind === "product" ? data.member_product_id : data.member_release_id
  return typeof value === "string" ? value : ""
}
