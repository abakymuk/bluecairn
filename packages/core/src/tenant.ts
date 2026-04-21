/**
 * TenantContext is carried explicitly through every function that touches
 * tenant data. No ambient state, no globals, no "current tenant" magic.
 *
 * See ARCHITECTURE.md principle #8: "Tenant context is never implicit"
 * and ADR-0006: "Multi-tenant from day one".
 */

declare const TenantIdBrand: unique symbol
export type TenantId = string & { readonly [TenantIdBrand]: never }

export const TenantId = (id: string): TenantId => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error(`Invalid TenantId: ${id}`)
  }
  return id.toLowerCase() as TenantId
}

export interface TenantContext {
  readonly tenantId: TenantId
  readonly requestedByUserId?: string
  readonly correlationId: string
}

export const newTenantContext = (params: {
  tenantId: TenantId
  requestedByUserId?: string
  correlationId?: string
}): TenantContext => ({
  tenantId: params.tenantId,
  ...(params.requestedByUserId !== undefined && {
    requestedByUserId: params.requestedByUserId,
  }),
  correlationId: params.correlationId ?? crypto.randomUUID(),
})
