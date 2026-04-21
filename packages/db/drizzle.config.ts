import { defineConfig } from 'drizzle-kit'

const databaseUrl = process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('DATABASE_URL or DATABASE_URL_ADMIN is required for drizzle-kit')
}

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: { url: databaseUrl },
  verbose: true,
  strict: true,
  schemaFilter: ['public'],
})
