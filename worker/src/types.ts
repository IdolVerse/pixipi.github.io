export type Bindings = {
  DB: D1Database
  R2: R2Bucket
  JWT_SECRET: string
  R2_PUBLIC_URL: string
  NODE_ENV: string
}

export type Variables = {
  user: Record<string, unknown>
  member: Record<string, unknown>
}

export type HonoEnv = {
  Bindings: Bindings
  Variables: Variables
}
