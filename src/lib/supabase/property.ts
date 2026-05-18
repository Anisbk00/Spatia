import { createClient, createAdminClient } from "@/lib/supabase/server";
import type { Property, Scene, Media, PropertyWithScene } from "@/lib/types";

/**
 * Get a Supabase admin client for read operations (bypasses RLS).
 * Only use when you explicitly need to bypass row-level security.
 */
async function getReadClient() {
  const adminClient = createAdminClient();
  if (adminClient) return adminClient;

  const userClient = await createClient();
  return userClient;
}

/**
 * Get a Supabase client for public read operations (respects RLS).
 * Use this for public-facing queries where RLS should control access.
 */
async function getPublicReadClient() {
  const userClient = await createClient();
  return userClient;
}

/**
 * Fetch a single property by ID (public read — RLS handles access control)
 */
export async function getProperty(propertyId: string): Promise<Property | null> {
  const supabase = await getPublicReadClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("properties")
    .select("*")
    .eq("id", propertyId)
    .eq("status", "ready")
    .maybeSingle();

  if (error || !data) return null;
  return data as Property;
}

/**
 * Fetch the ready scene for a property
 */
export async function getPropertyScene(propertyId: string): Promise<Scene | null> {
  const supabase = await getPublicReadClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("scenes")
    .select("*")
    .eq("property_id", propertyId)
    .eq("status", "ready")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return data as Scene;
}

/**
 * Fetch the most recent scene for a property regardless of status.
 * Use this to show processing/queued/failed states on public pages.
 */
export async function getPropertySceneAnyStatus(propertyId: string): Promise<Scene | null> {
  const supabase = await getPublicReadClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("scenes")
    .select("*")
    .eq("property_id", propertyId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return data as Scene;
}

/**
 * Fetch media for a property (images only, ordered by order_index)
 */
export async function getPropertyMedia(propertyId: string): Promise<Media[]> {
  const supabase = await getPublicReadClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("media")
    .select("*")
    .eq("property_id", propertyId)
    .eq("type", "image")
    .order("order_index", { ascending: true, nullsFirst: false });

  if (error || !data) return [];
  return data as Media[];
}

/**
 * Fetch property with scene and media (combined query for listing page)
 */
export async function getPropertyWithScene(propertyId: string): Promise<PropertyWithScene | null> {
  const [property, scene, media] = await Promise.all([
    getProperty(propertyId),
    getPropertyScene(propertyId),
    getPropertyMedia(propertyId),
  ]);

  if (!property) return null;

  return {
    ...property,
    scene,
    media,
  };
}

/**
 * Fetch multiple properties that are ready for public viewing
 */
export async function getPublicProperties(limit = 20): Promise<Property[]> {
  const supabase = await getPublicReadClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("properties")
    .select("*")
    .eq("status", "ready")
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  return data as Property[];
}

/**
 * Increment property view count (analytics)
 */
export async function trackPropertyView(propertyId: string, deviceType?: string): Promise<void> {
  const supabase = await getReadClient();
  if (!supabase) return;

  await supabase.from("property_views").insert({
    property_id: propertyId,
    device_type: deviceType || "unknown",
    viewed_at: new Date().toISOString(),
  });
}
