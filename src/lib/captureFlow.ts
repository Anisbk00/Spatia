// ============================================
// Guided Capture Flow — Step Engine
// ============================================
// This is NOT a free camera app. It's a structured
// step-by-step scanning workflow that guides agents
// through capturing every part of a property.
// ============================================

export type CaptureStepType =
  | "entrance"
  | "move_forward"
  | "room_sweep"
  | "transition"
  | "detail"
  | "final";

export interface CaptureStep {
  type: CaptureStepType;
  instruction: string;
  detail: string;
  buttonText: string;
  /** Minimum photos needed before this step auto-advances */
  minPhotos: number;
  /** Icon hint for the UI */
  icon: "door" | "walk" | "scan" | "arrow" | "eye" | "check";
}

// Room names for guided walkthrough
const ROOM_LABELS = [
  "Entrance & Hallway",
  "Living Room",
  "Kitchen",
  "Master Bedroom",
  "Bathroom",
  "Second Bedroom",
  "Balcony / Terrace",
  "Garage / Parking",
  "Backyard / Garden",
  "Office / Study",
  "Storage / Laundry",
  "Additional Room",
];

/**
 * Generate the capture step sequence for a property.
 * Produces a structured walkthrough path that ensures
 * sufficient overlap and coverage for SfM reconstruction.
 */
export function generateCaptureFlow(totalRooms: number = 6): CaptureStep[] {
  const steps: CaptureStep[] = [];
  const roomCount = Math.max(3, Math.min(totalRooms, 12));

  // Step 1: Start at entrance
  steps.push({
    type: "entrance",
    instruction: "Start at the entrance",
    detail: "Stand at the main entrance door facing inward. Capture the full doorway and immediate view.",
    buttonText: "Capture Entrance",
    minPhotos: 2,
    icon: "door",
  });

  // Step 2: Move forward into hallway
  steps.push({
    type: "move_forward",
    instruction: "Walk 1–2 meters forward",
    detail: "Step inside slowly. Keep the camera steady and pointed forward. Overlap with the previous shot is important.",
    buttonText: "Capture Next",
    minPhotos: 3,
    icon: "walk",
  });

  // Room-by-room capture cycle
  for (let i = 0; i < roomCount; i++) {
    const roomName = ROOM_LABELS[i] || `Room ${i + 1}`;

    // Transition to room
    steps.push({
      type: "transition",
      instruction: `Move to the ${roomName}`,
      detail: `Walk towards the ${roomName}. Capture the transition from the previous area — this overlap helps build the 3D model.`,
      buttonText: "Capture Transition",
      minPhotos: steps.length === 2 ? 4 : steps[steps.length - 1].minPhotos + 1,
      icon: "arrow",
    });

    // Room sweep — full 360° coverage
    steps.push({
      type: "room_sweep",
      instruction: `Capture full view of the ${roomName}`,
      detail: `Stand in the center of the ${roomName}. Slowly turn and capture photos every 1–2 meters, covering all walls and corners. Aim for 4–8 photos per room.`,
      buttonText: "Capture Room View",
      minPhotos: steps[steps.length - 1].minPhotos + 4,
      icon: "scan",
    });

    // Detail shot (optional but recommended)
    if (i < 3) {
      steps.push({
        type: "detail",
        instruction: `Capture details in the ${roomName}`,
        detail: "Photograph any notable features: fixtures, finishes, built-ins, views from windows. These add realism to the 3D scene.",
        buttonText: "Capture Detail",
        minPhotos: steps[steps.length - 1].minPhotos + 2,
        icon: "eye",
      });
    }
  }

  // Final step
  steps.push({
    type: "final",
    instruction: "Final walkthrough check",
    detail: "Review your captures. Make sure all rooms are covered with overlapping photos. Add any missing shots before finishing.",
    buttonText: "Capture Final",
    minPhotos: steps[steps.length - 1].minPhotos + 2,
    icon: "check",
  });

  return steps;
}

/**
 * Get the current step based on number of photos taken.
 * Returns the step that the user should be on.
 */
export function getCurrentStep(
  steps: CaptureStep[],
  photosTaken: number
): { step: CaptureStep; stepIndex: number } {
  // Find the highest step whose minPhotos has been reached or is the first step
  let currentIdx = 0;
  for (let i = 0; i < steps.length; i++) {
    if (photosTaken >= steps[i].minPhotos) {
      currentIdx = i;
    } else {
      break;
    }
  }
  return { step: steps[currentIdx], stepIndex: currentIdx };
}

/**
 * Calculate progress percentage
 */
export function getProgress(
  photosTaken: number,
  totalSteps: number,
  currentStepIndex: number
): number {
  const stepProgress = ((currentStepIndex + 1) / totalSteps) * 100;
  return Math.min(Math.round(stepProgress), 100);
}

/**
 * Estimate total photos needed
 */
export function getEstimatedTotalPhotos(steps: CaptureStep[]): number {
  if (steps.length === 0) return 30;
  return steps[steps.length - 1].minPhotos;
}

/**
 * Room count estimation from property type
 */
export function estimateRoomCount(
  propertyType: string | null | undefined
): number {
  switch (propertyType) {
    case "apartment":
      return 5;
    case "house":
      return 7;
    case "villa":
      return 9;
    case "office":
      return 4;
    case "land":
      return 3;
    default:
      return 6;
  }
}
