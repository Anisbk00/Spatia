"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { GaussianSplatRenderer } from "@/lib/renderer/gaussianSplatRenderer";
import { loadSceneProgressive } from "@/lib/sceneLoader";
import type { ViewerState, RenderQuality } from "@/lib/types";

interface ViewerCanvasProps {
  modelUrl: string | null;
  onStateChange: (state: ViewerState) => void;
}

export function ViewerCanvas({ modelUrl, onStateChange }: ViewerCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<GaussianSplatRenderer | null>(null);
  const [state, setState] = useState<ViewerState>({
    isLoading: true,
    isReady: false,
    error: null,
    splatCount: 0,
    fps: 0,
    loadProgress: 0,
    quality: "high",
  });

  const updateState = useCallback((partial: Partial<ViewerState>) => {
    setState((prev) => {
      const next = { ...prev, ...partial };
      onStateChange(next);
      return next;
    });
  }, [onStateChange]);

  // Initialize renderer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let disposed = false;
    const abortController = new AbortController();

    const initAndLoad = async () => {
      let renderer: GaussianSplatRenderer;
      try {
        renderer = new GaussianSplatRenderer(canvas);
        renderer.init();
        rendererRef.current = renderer;

        // Start the render loop
        renderer.startLoop();

        // FPS callback
        renderer.onFrame((fps) => {
          updateState({ fps });
        });
      } catch (err) {
        console.error("Failed to initialize renderer:", err);
        if (!disposed) {
          updateState({
            isLoading: false,
            isReady: false,
            error: err instanceof Error ? err.message : "WebGL2 not supported",
          });
        }
        return;
      }

      // Must have a model URL to load
      if (!modelUrl) {
        if (!disposed) {
          updateState({
            isLoading: false,
            isReady: false,
            error: "No 3D model available for this property",
          });
        }
        return;
      }

      // Load scene data
      try {
        const splatData = await loadSceneProgressive(modelUrl, (loaded, total) => {
          updateState({ loadProgress: Math.round((loaded / total) * 100) });
        }, abortController.signal);

        if (disposed) return;

        renderer.loadSplatData(splatData);
        updateState({
          isLoading: false,
          isReady: true,
          splatCount: splatData.count,
          loadProgress: 100,
          quality: "high",
        });
      } catch (err) {
        if ((err as DOMException).name === "AbortError") return;
        console.error("Failed to load 3D scene:", err);
        if (disposed) return;
        updateState({
          isLoading: false,
          isReady: false,
          error: err instanceof Error ? err.message : "Failed to load 3D scene",
        });
      }
    };

    initAndLoad();

    return () => {
      disposed = true;
      abortController.abort();
      if (rendererRef.current) {
        rendererRef.current.dispose();
        rendererRef.current = null;
      }
    };
  }, [modelUrl, updateState]);

  // Expose quality toggle and camera reset via custom events
  // Always attach listeners (rendererRef may not be ready yet — read inside handler)
  useEffect(() => {
    const handleQualityChange = (e: CustomEvent) => {
      rendererRef.current?.setQuality(e.detail as RenderQuality);
      updateState({ quality: e.detail as RenderQuality });
    };
    const handleResetCamera = () => {
      rendererRef.current?.resetCamera();
    };

    window.addEventListener("viewer-quality-change", handleQualityChange as EventListener);
    window.addEventListener("viewer-reset-camera", handleResetCamera);
    return () => {
      window.removeEventListener("viewer-quality-change", handleQualityChange as EventListener);
      window.removeEventListener("viewer-reset-camera", handleResetCamera);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 h-full w-full touch-none"
      style={{ cursor: "grab" }}
    />
  );
}
