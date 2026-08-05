import {
  PowerSyncDatabase,
  WASQLiteVFS,
} from "@powersync/web"

import { AppSchema } from "./AppSchema"

export const powerSyncDatabase = new PowerSyncDatabase({
  schema: AppSchema,
  database: {
    dbFilename: "cellarmanager-v02.db",
    vfs: WASQLiteVFS.OPFSCoopSyncVFS,
  },
})
