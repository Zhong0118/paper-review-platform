import type { RequestOptions } from './request'
export type TimeScope = 'all' | 'past_year'
export interface TimeScopeMeta { scope: TimeScope; from: string; asOf: string }
export type TimeScopeReporter = (meta: TimeScopeMeta) => void
export function scopeOptions(scope: TimeScope, report?: TimeScopeReporter): RequestOptions {
  return { params: { time_scope: scope }, onHeaders: headers => {
    const value = headers['x-time-scope'], from = headers['x-time-from'], asOf = headers['x-as-of']
    if ((value === 'all' || value === 'past_year') && typeof from === 'string' && typeof asOf === 'string') {
      report?.({ scope: value, from, asOf })
    }
  } }
}
