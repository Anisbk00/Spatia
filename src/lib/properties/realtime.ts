import { createClient } from "@/lib/supabase/client";

export type PropertyRealtimeEvent =
  | { type: "property_updated"; propertyId: string; status: string }
  | { type: "property_created"; propertyId: string }
  | { type: "property_deleted"; propertyId: string };

let currentSubscription: ReturnType<NonNullable<ReturnType<typeof createClient>>["channel"]> | null = null;

/**
 * Subscribe to realtime property updates for an organization.
 * Uses the Supabase realtime Postgres Changes feature.
 *
 * @param orgId - The organization ID to watch property changes for
 * @param callback - Function called with a typed PropertyRealtimeEvent on each change
 */
export function subscribeToPropertyUpdates(
  orgId: string,
  callback: (event: PropertyRealtimeEvent) => void
): void {
  // Clean up any existing subscription first
  unsubscribeFromPropertyUpdates();

  const supabase = createClient();
  if (!supabase) return;

  const channel = supabase
    .channel(`properties:org:${orgId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "properties",
        filter: `org_id=eq.${orgId}`,
      },
      (payload) => {
        const newRecord = payload.new as Record<string, unknown> | undefined;
        const oldRecord = payload.old as Record<string, unknown> | undefined;

        switch (payload.eventType) {
          case "INSERT": {
            const propertyId = (newRecord?.id as string) ?? (oldRecord?.id as string);
            if (propertyId) {
              callback({ type: "property_created", propertyId });
            }
            break;
          }
          case "UPDATE": {
            const propertyId = (newRecord?.id as string) ?? (oldRecord?.id as string);
            const status = (newRecord?.status as string) ?? "";
            if (propertyId) {
              callback({ type: "property_updated", propertyId, status });
            }
            break;
          }
          case "DELETE": {
            const propertyId = (oldRecord?.id as string) ?? (newRecord?.id as string);
            if (propertyId) {
              callback({ type: "property_deleted", propertyId });
            }
            break;
          }
        }
      }
    )
    .subscribe();

  currentSubscription = channel;
}

/**
 * Unsubscribe from property realtime updates and clean up the channel.
 */
export function unsubscribeFromPropertyUpdates(): void {
  if (!currentSubscription) return;

  const supabase = createClient();
  if (supabase) {
    supabase.removeChannel(currentSubscription);
  }

  currentSubscription = null;
}
