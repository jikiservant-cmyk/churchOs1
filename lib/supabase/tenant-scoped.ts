import { createAdminClient } from '@/lib/supabase/server';

/**
 * F-13: Tenant-Scoped Admin Client
 * 
 * Every privileged read/write must name its tenant.
 * Returning a client bound to a validated tenant ID makes "forgot the .eq('church_id', ...)"
 * impossible to write by accident.
 */
export async function tenantScopedAdmin(tenantId: string) {
  if (!tenantId || typeof tenantId !== 'string' || tenantId.trim().length === 0) {
    throw new Error('tenantScopedAdmin requires a valid, non-empty tenantId');
  }

  const cleanTenantId = tenantId.trim();
  const admin = await createAdminClient();

  return {
    tenantId: cleanTenantId,
    admin,

    /**
     * Query a table in the public schema, automatically applying tenant filter
     */
    from<T = any>(table: string) {
      const query = admin.from(table);
      return {
        select(columns = '*') {
          return query.select(columns).eq('tenant_id', cleanTenantId) as any;
        },
        insert(values: Record<string, any> | Array<Record<string, any>>) {
          const boundValues = Array.isArray(values)
            ? values.map(v => ({ ...v, tenant_id: cleanTenantId }))
            : { ...values, tenant_id: cleanTenantId };
          return query.insert(boundValues as any);
        },
        update(values: Record<string, any>) {
          return query.update(values).eq('tenant_id', cleanTenantId);
        },
        delete() {
          return query.delete().eq('tenant_id', cleanTenantId);
        },
        raw() {
          return query;
        }
      };
    },

    /**
     * Query a table in the church schema, automatically applying the correct tenant filter.
     * Tables with 'tenant_id': sms_logs, broadcasts, sms_queue.
     * Tables with 'church_id': members, events, attendance_logs, attendance_flags, visitors, new_converts, etc.
     */
    church<T = any>(table: string) {
      const TENANT_ID_TABLES = new Set(['sms_logs', 'broadcasts', 'sms_queue']);
      const tenantColumn = TENANT_ID_TABLES.has(table) ? 'tenant_id' : 'church_id';
      const query = admin.schema('church').from(table);

      return {
        select(columns = '*') {
          return query.select(columns).eq(tenantColumn, cleanTenantId) as any;
        },
        insert(values: Record<string, any> | Array<Record<string, any>>) {
          const boundValues = Array.isArray(values)
            ? values.map(v => ({ ...v, [tenantColumn]: cleanTenantId }))
            : { ...values, [tenantColumn]: cleanTenantId };
          return query.insert(boundValues as any);
        },
        update(values: Record<string, any>) {
          return query.update(values).eq(tenantColumn, cleanTenantId);
        },
        delete() {
          return query.delete().eq(tenantColumn, cleanTenantId);
        },
        raw() {
          return query;
        }
      };
    },

    /**
     * Execute an RPC with tenant ID pre-bound
     */
    rpc(fnName: string, params: Record<string, any> = {}) {
      return admin.rpc(fnName, {
        p_church_id: cleanTenantId,
        p_tenant_id: cleanTenantId,
        ...params
      });
    }
  };
}
