import { hasSupabaseEnv } from '../supabaseClient'

export const useSupabaseData =
  String(import.meta.env.VITE_USE_SUPABASE_DATA ?? 'false').toLowerCase() === 'true'

export const shouldUseSupabase = () => useSupabaseData && hasSupabaseEnv

export const isDev = Boolean(import.meta.env.DEV)

export type AnyRecord = Record<string, unknown>

export const getFirst = (row: AnyRecord, keys: string[]): unknown => {
  for (const key of keys) {
    if (key in row && row[key] !== undefined && row[key] !== null) {
      return row[key]
    }
  }
  return null
}

export const asString = (value: unknown, fallback = ''): string => {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return fallback
}

export const asNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
  }
  return fallback
}

export const asBoolean = (value: unknown, fallback = false): boolean => {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const normalized = value.toLowerCase()
    if (['true', '1', 'yes', 'y'].includes(normalized)) return true
    if (['false', '0', 'no', 'n'].includes(normalized)) return false
  }
  return fallback
}

export const asIso = (value: unknown): string | null => {
  if (value === null || value === undefined) return null
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export const safeArray = <T>(value: T[] | null | undefined): T[] => (Array.isArray(value) ? value : [])

export const normalizeStatus = (value: unknown): string =>
  asString(value, 'unknown').trim().toLowerCase().replace(/\s+/g, '_')

export const mapErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'Unknown Supabase error'
