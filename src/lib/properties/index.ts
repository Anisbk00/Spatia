// Validation schemas and types
export {
  propertyCreateSchema,
  propertyUpdateSchema,
  propertyIdSchema,
  PROPERTY_TYPE_VALUES,
  PROPERTY_STATUS_VALUES,
} from "./validation";
export type {
  PropertyCreateInput,
  PropertyUpdateInput,
} from "./validation";

// Server-side mutation functions
export {
  updateProperty,
  deleteProperty,
  hardDeleteProperty,
} from "./mutations";

// Client-side draft persistence
export {
  DRAFT_KEY,
  savePropertyDraft,
  loadPropertyDraft,
  clearPropertyDraft,
} from "./drafts";

// Client-side realtime subscriptions
export {
  subscribeToPropertyUpdates,
  unsubscribeFromPropertyUpdates,
} from "./realtime";
export type {
  PropertyRealtimeEvent,
} from "./realtime";
