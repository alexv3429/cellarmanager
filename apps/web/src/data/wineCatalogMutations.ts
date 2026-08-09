import { supabase } from "./supabase"
import type { WineIdentityEdit } from "./wineCatalogEdit"

export async function updateWineIdentity(
  wineId: string,
  identity: WineIdentityEdit,
): Promise<void> {
  const { error } = await supabase.rpc(
    "update_wine_identity",
    {
      p_wine_id: wineId,
      p_producer: identity.producer,
      p_cuvee: identity.cuvee,
      p_vintage: identity.vintage,
      p_color: identity.color,
    },
  )

  if (error) {
    throw new Error(error.message)
  }
}
