import { supabase } from "./supabase"
import type { WineCatalogEdit } from "./wineCatalogEdit"

export async function updateWineCatalog(
  wineId: string,
  edit: WineCatalogEdit,
): Promise<void> {
  const { error } = await supabase.rpc(
    "update_wine_catalog",
    {
      p_wine_id: wineId,
      p_producer: edit.producer,
      p_cuvee: edit.cuvee,
      p_vintage: edit.vintage,
      p_color: edit.color,
      p_appellation: edit.appellation,
      p_area: edit.area,
    },
  )

  if (error) {
    throw new Error(error.message)
  }
}
