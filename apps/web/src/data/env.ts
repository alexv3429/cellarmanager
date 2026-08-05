function requireEnvironmentVariable(name: string): string {
  const value = import.meta.env[name] as string | undefined

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }

  return value
}

export const environment = {
  supabaseUrl: requireEnvironmentVariable("VITE_SUPABASE_URL"),
  supabasePublishableKey: requireEnvironmentVariable(
    "VITE_SUPABASE_PUBLISHABLE_KEY",
  ),
  powerSyncUrl: requireEnvironmentVariable("VITE_POWERSYNC_URL"),
} as const
