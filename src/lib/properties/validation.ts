import { z } from "zod";

export const PROPERTY_TYPE_VALUES = [
  "apartment",
  "house",
  "villa",
  "office",
  "land",
] as const;

export const PROPERTY_STATUS_VALUES = [
  "draft",
  "capturing",
  "processing",
  "ready",
  "archived",
] as const;

export const propertyCreateSchema = z.object({
  title: z
    .string()
    .min(1, "Title is required")
    .max(200, "Title must be 200 characters or fewer"),
  address: z
    .string()
    .max(300, "Address must be 300 characters or fewer")
    .optional(),
  property_type: z
    .enum(PROPERTY_TYPE_VALUES)
    .optional(),
  price: z
    .number()
    .nonnegative("Price must be non-negative")
    .optional(),
  description: z
    .string()
    .max(5000, "Description must be 5000 characters or fewer")
    .optional(),
  city: z
    .string()
    .max(100, "City must be 100 characters or fewer")
    .optional(),
  country: z
    .string()
    .max(100, "Country must be 100 characters or fewer")
    .optional(),
});

export const propertyUpdateSchema = z
  .object({
    title: z
      .string()
      .min(1, "Title cannot be empty")
      .max(200, "Title must be 200 characters or fewer")
      .optional(),
    address: z
      .string()
      .max(300, "Address must be 300 characters or fewer")
      .optional(),
    property_type: z
      .enum(PROPERTY_TYPE_VALUES)
      .optional(),
    price: z
      .number()
      .nonnegative("Price must be non-negative")
      .optional(),
    description: z
      .string()
      .max(5000, "Description must be 5000 characters or fewer")
      .optional(),
    city: z
      .string()
      .max(100, "City must be 100 characters or fewer")
      .optional(),
    country: z
      .string()
      .max(100, "Country must be 100 characters or fewer")
      .optional(),
    status: z
      .enum(PROPERTY_STATUS_VALUES)
      .optional(),
  })
  .refine(
    (data) =>
      data.title !== undefined ||
      data.address !== undefined ||
      data.property_type !== undefined ||
      data.price !== undefined ||
      data.description !== undefined ||
      data.city !== undefined ||
      data.country !== undefined ||
      data.status !== undefined,
    {
      message: "At least one field must be provided for update",
    }
  );

export const propertyIdSchema = z
  .string()
  .uuid("Invalid property ID format");

export type PropertyCreateInput = z.infer<typeof propertyCreateSchema>;
export type PropertyUpdateInput = z.infer<typeof propertyUpdateSchema>;
