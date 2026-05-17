import { createClient, createAdminClient } from "@/lib/supabase/server";
import { RecoveryService, DataIntegrityChecker, OrphanDetector } from "@/lib/pipeline-recovery";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/recovery
 * Run recovery for a specific entity or auto-recover all.
 *
 * Body: { type: 'session'|'property'|'scene'|'upload'|'auto'|'integrity', id?: string }
 *
 * Must be authenticated agent/admin.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  if (!supabase) {
    return NextResponse.json({ error: "Service not configured" }, { status: 503 });
  }

  // Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const adminClient = createAdminClient();
  const dataClient = adminClient || supabase;

  // Verify agent/admin role
  const { data: profile } = await dataClient
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || (profile.role !== "agent" && profile.role !== "admin")) {
    return NextResponse.json({ error: "Forbidden — agent/admin required" }, { status: 403 });
  }

  // Parse body
  let body: { type?: string; id?: string };
  try {
    body = await request.json();
  } catch (err) {
    console.error("[RecoveryAPI] JSON parse failed:", err);
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { type, id } = body;

  if (!type) {
    return NextResponse.json(
      { error: "type is required (session|property|scene|upload|auto|integrity)" },
      { status: 400 }
    );
  }

  const recoveryService = new RecoveryService();
  const detector = new OrphanDetector();
  const integrityChecker = new DataIntegrityChecker();

  try {
    switch (type) {
      case "session": {
        if (!id) {
          return NextResponse.json({ error: "id is required for session recovery" }, { status: 400 });
        }
        const result = await recoveryService.recoverSession(id);
        return NextResponse.json({ type: "session", id, result });
      }

      case "property": {
        if (!id) {
          return NextResponse.json({ error: "id is required for property recovery" }, { status: 400 });
        }
        const result = await recoveryService.recoverProperty(id);
        return NextResponse.json({ type: "property", id, result });
      }

      case "scene": {
        if (!id) {
          return NextResponse.json({ error: "id is required for scene recovery" }, { status: 400 });
        }
        const result = await recoveryService.recoverScene(id);
        return NextResponse.json({ type: "scene", id, result });
      }

      case "upload": {
        if (!id) {
          return NextResponse.json({ error: "id is required for upload recovery" }, { status: 400 });
        }
        const result = await recoveryService.recoverUpload(id);
        return NextResponse.json({ type: "upload", id, result });
      }

      case "auto": {
        const report = await recoveryService.autoRecover();
        return NextResponse.json({ type: "auto", report });
      }

      case "integrity": {
        if (!id) {
          // Run detection only (no recovery)
          const [orphanSessions, orphanProperties, orphanScenes, stuckJobs, missingMedia] =
            await Promise.all([
              detector.findOrphanSessions(),
              detector.findOrphanProperties(),
              detector.findOrphanScenes(),
              detector.findStuckJobs(),
              detector.findMissingMedia(),
            ]);

          return NextResponse.json({
            type: "detection",
            orphanSessions,
            orphanProperties,
            orphanScenes,
            stuckJobs,
            missingMedia,
            summary: {
              orphanSessions: orphanSessions.length,
              orphanProperties: orphanProperties.length,
              orphanScenes: orphanScenes.length,
              stuckJobs: stuckJobs.length,
              missingMedia: missingMedia.length,
              totalIssues:
                orphanSessions.length +
                orphanProperties.length +
                orphanScenes.length +
                stuckJobs.length +
                missingMedia.length,
            },
          });
        }

        // Run integrity check on a specific entity — detect the entity type
        // Try property first, then session, then scene
        const propCheck = await integrityChecker.checkPropertyIntegrity(id);
        if (propCheck.issues.length === 1 && propCheck.issues[0].includes("not found")) {
          const sessionCheck = await integrityChecker.checkSessionIntegrity(id);
          if (sessionCheck.issues.length === 1 && sessionCheck.issues[0].includes("not found")) {
            const sceneCheck = await integrityChecker.checkSceneIntegrity(id);
            if (sceneCheck.issues.length === 1 && sceneCheck.issues[0].includes("not found")) {
              return NextResponse.json(
                { error: "Entity not found as property, session, or scene" },
                { status: 404 }
              );
            }
            return NextResponse.json({ type: "scene", id, integrity: sceneCheck });
          }
          return NextResponse.json({ type: "session", id, integrity: sessionCheck });
        }
        return NextResponse.json({ type: "property", id, integrity: propCheck });
      }

      default:
        return NextResponse.json(
          { error: "Invalid type. Use: session|property|scene|upload|auto|integrity" },
          { status: 400 }
        );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: "Recovery failed", details: message }, { status: 500 });
  }
}
