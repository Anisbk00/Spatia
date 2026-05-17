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
        });

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
      if (rendererRef.current) {
        rendererRef.current.dispose();
        rendererRef.current = null;
      }
    };
  }, [modelUrl, updateState]);

  // Expose quality toggle to parent via ref
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    // Set up a custom event listener for quality changes
    const handleQualityChange = (e: CustomEvent) => {
      const quality = e.detail as RenderQuality;
      renderer.setQuality(quality);
      updateState({ quality });
    };

    window.addEventListener("viewer-quality-change" as string, handleQualityChange as EventListener);
    return () => {
      window.removeEventListener("viewer-quality-change" as string, handleQualityChange as EventListener);
    };
  }, [updateState]);

  // Expose camera reset to parent via ref
  useEffect(() => {
    const handleResetCamera = () => {
      rendererRef.current?.resetCamera();
    };

    window.addEventListener("viewer-reset-camera" as string, handleResetCamera);
    return () => {
      window.removeEventListener("viewer-reset-camera" as string, handleResetCamera);
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
