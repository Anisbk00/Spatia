import type { User } from "@supabase/supabase-js";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getPublicProperties } from "@/lib/supabase/property";
import type { Property } from "@/lib/types";
import { ExploreContent } from "./ExploreContent";

export default async function ExplorePage() {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    console.error("[Explore] Failed to create Supabase client:", err);
  }

  let user: User | null = null;
  let profile: { role: string; email: string; full_name: string | null } | null = null;

  if (supabase) {
    try {
      const { data, error } = await supabase.auth.getUser();
      if (!error) {
        user = data.user;
      }
    } catch (err) {
      console.error("[Explore] Auth error:", err);
    }

    if (user) {
      try {
        // Use admin client to bypass RLS for profile reads
        const adminClient = createAdminClient();
        const readClient = adminClient || supabase;
        const { data, error } = await readClient
          .from("users")
          .select("id, role, email, full_name")
          .eq("id", user.id)
          .single();
        if (!error) {
          profile = data;
        }
      } catch (err) {
        // User may not have a profile row yet (pre-onboarding)
        console.error("[Explore] Profile query error:", err);
      }
    }
  }

  // Fetch real public properties with scene data
  let properties: Property[] = [];
  try {
    properties = await getPublicProperties(20);
  } catch (err) {
    console.error("[Explore] Failed to fetch properties:", err);
  }

  // For each property, check if it has a ready scene (for the "3D Available" badge)
  const propertiesWithScene: Record<string, boolean> = {};
  if (properties.length > 0) {
    try {
      // Use admin client to bypass RLS for scene reads
      const adminClient = createAdminClient();
      const readClient = adminClient || supabase;
      if (readClient) {
        const propertyIds = properties.map((p) => p.id);
        const { data: scenes } = await readClient
          .from("scenes")
          .select("property_id, status")
          .in("property_id", propertyIds)
          .eq("status", "ready");
        if (scenes) {
          for (const s of scenes) {
            propertiesWithScene[s.property_id] = true;
          }
        }
      }
    } catch (err) {
      console.error("[Explore] Scenes query error:", err);
    }
  }

  return (
    <ExploreContent
      user={user}
      profile={profile}
      properties={properties}
      propertiesWithScene={propertiesWithScene}
    />
  );
}
