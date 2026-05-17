import { createClient, createAdminClient } from "@/lib/supabase/server";
import type { Property } from "@/lib/types";
import {
  propertyUpdateSchema,
  propertyIdSchema,
} from "./validation";
import type { PropertyUpdateInput } from "./validation";

type MutationResult<T> = {
  data: T | null;
  error: string | null;
};

/**
 * Get the appropriate write client.
 * Prefers admin client (bypasses RLS) for write operations,
 * falls back to user-context client if admin is unavailable.
 */
async function getWriteClient() {
  const adminClient = createAdminClient();
  if (adminClient) return adminClient;

  const userClient = await createClient();
  return userClient;
}

/**
 * Update a property. Verifies org_id matches before updating (security).
 */
export async function updateProperty(
  propertyId: string,
  orgId: string,
  data: PropertyUpdateInput
): Promise<MutationResult<Property>> {
  // Validate property ID
  const idResult = propertyIdSchema.safeParse(propertyId);
  if (!idResult.success) {
    return { data: null, error: "Invalid property ID format" };
  }

  // Validate update data
  const dataResult = propertyUpdateSchema.safeParse(data);
  if (!dataResult.success) {
    const firstError = dataResult.error.issues[0];
    return {
      data: null,
      error: firstError?.message ?? "Invalid update data",
    };
  }

  const writeClient = await getWriteClient();
  if (!writeClient) {
    return { data: null, error: "Database not configured" };
  }

  // Verify org ownership before mutation
  const { data: existing, error: fetchError } = await writeClient
    .from("properties")
    .select("id, org_id, status")
    .eq("id", propertyId)
    .single();

  if (fetchError || !existing) {
    return { data: null, error: "Property not found" };
  }

  if (existing.org_id !== orgId) {
    return { data: null, error: "Unauthorized: property does not belong to this organization" };
  }

  // Perform the update
  const updatePayload: Record<string, unknown> = {
    ...dataResult.data,
    updated_at: new Date().toISOString(),
  };

  const { data: updated, error: updateError } = await writeClient
    .from("properties")
    .update(updatePayload)
    .eq("id", propertyId)
    .select("*")
    .single();

  if (updateError) {
    return { data: null, error: updateError.message };
  }

  return { data: updated as Property, error: null };
}

/**
 * Soft delete a property (sets status to 'archived').
 * Verifies org_id before mutation.
 */
export async function deleteProperty(
  propertyId: string,
  orgId: string
): Promise<MutationResult<boolean>> {
  // Validate property ID
  const idResult = propertyIdSchema.safeParse(propertyId);
  if (!idResult.success) {
    return { data: null, error: "Invalid property ID format" };
  }

  const writeClient = await getWriteClient();
  if (!writeClient) {
    return { data: null, error: "Database not configured" };
  }

  // Verify org ownership before mutation
  const { data: existing, error: fetchError } = await writeClient
    .from("properties")
    .select("id, org_id")
    .eq("id", propertyId)
    .single();

  if (fetchError || !existing) {
    return { data: null, error: "Property not found" };
  }

  if (existing.org_id !== orgId) {
    return { data: null, error: "Unauthorized: property does not belong to this organization" };
  }

  // Soft delete: set status to 'archived'
  const { error: updateError } = await writeClient
    .from("properties")
    .update({
      status: "archived",
      updated_at: new Date().toISOString(),
    })
    .eq("id", propertyId);

  if (updateError) {
    return { data: null, error: updateError.message };
  }

  return { data: true, error: null };
}

/**
 * Hard delete a property. Only allowed if status is 'draft' or 'archived'.
 * Verifies org_id before mutation.
 */
export async function hardDeleteProperty(
  propertyId: string,
  orgId: string
): Promise<MutationResult<boolean>> {
  // Validate property ID
  const idResult = propertyIdSchema.safeParse(propertyId);
  if (!idResult.success) {
    return { data: null, error: "Invalid property ID format" };
  }

  const writeClient = await getWriteClient();
  if (!writeClient) {
    return { data: null, error: "Database not configured" };
  }

  // Verify org ownership and status before mutation
  const { data: existing, error: fetchError } = await writeClient
    .from("properties")
    .select("id, org_id, status")
    .eq("id", propertyId)
    .single();

  if (fetchError || !existing) {
    return { data: null, error: "Property not found" };
  }

  if (existing.org_id !== orgId) {
    return { data: null, error: "Unauthorized: property does not belong to this organization" };
  }

  // Only allow hard delete for draft or archived properties
  if (existing.status !== "draft" && existing.status !== "archived") {
    return {
      data: null,
      error: "Hard delete is only allowed for properties with 'draft' or 'archived' status",
    };
  }

  // Perform the actual delete
  const { error: deleteError } = await writeClient
    .from("properties")
    .delete()
    .eq("id", propertyId);

  if (deleteError) {
    return { data: null, error: deleteError.message };
  }

  return { data: true, error: null };
}
