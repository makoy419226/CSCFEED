import { z } from "zod";

const projectColors = ["blue", "orange", "green", "purple"];
const positiveId = z.coerce.number().int().positive();
const punchId = z.string().trim().regex(/^\d{3,10}$/, "Punch ID must contain 3 to 10 digits.");

export const idParamsSchema = z.object({ id: positiveId });
export const reportFileParamsSchema = z.object({ id: positiveId, fileId: positiveId });
export const punchIdParamsSchema = z.object({ punchId });

export const loginSchema = z.union([
  z.object({
    username: z.string().trim().min(1).max(64),
    password: z.string().min(1).max(72)
      .refine((value) => Buffer.byteLength(value, "utf8") <= 72, "Password is too long."),
  }).strict(),
  z.object({ employeeId: punchId }).strict(),
]);

export const projectSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).default(""),
  color: z.enum(projectColors),
});

export const manpowerSchema = z.object({
  punchId,
  name: z.string().trim().min(2).max(160),
  designation: z.string().trim().min(1).max(120),
});

export const manpowerActiveSchema = z.object({
  active: z.boolean(),
});

export const reportQuerySchema = z.object({
  projectId: positiveId.optional(),
  fromDate: z.iso.date().optional(),
  toDate: z.iso.date().optional(),
  q: z.string().trim().max(120).optional(),
}).refine(
  (query) => !query.fromDate || !query.toDate || query.fromDate <= query.toDate,
  { message: "Start date must be on or before end date." },
);

export const reportFormSchema = z.object({
  projectId: positiveId,
  reportDate: z.iso.date(),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).default(""),
});
