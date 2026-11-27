import { z } from "zod";

const projectColors = ["blue", "orange", "green", "purple"];
const positiveId = z.coerce.number().int().positive();
const punchId = z.string().trim().regex(/^\d{3,10}$/, "Punch ID must contain 3 to 10 digits.");
const employeePunchId = punchId.refine((value) => value !== "0000", "Punch ID 0000 is reserved for the Super User.");

export const idParamsSchema = z.object({ id: positiveId });
export const projectIdParamsSchema = z.object({ projectId: positiveId });
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

const passwordSchema = z.string().min(1).max(72)
  .refine((value) => Buffer.byteLength(value, "utf8") <= 72, "Password is too long.");

export const adminProfileUpdateSchema = z.object({
  displayName: z.string().trim().min(2).max(160),
  currentPassword: passwordSchema,
  newPassword: z.union([
    z.literal(""),
    z.string().min(12).max(72)
      .refine((value) => Buffer.byteLength(value, "utf8") <= 72, "Password is too long."),
  ]).optional(),
}).strict();

export const projectSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).default(""),
  color: z.enum(projectColors),
});

export const manpowerSchema = z.object({
  punchId: employeePunchId,
  name: z.string().trim().min(2).max(160),
  designation: z.string().trim().min(1).max(120),
});

export const manpowerAdminAccessSchema = z.object({
  adminAccess: z.boolean(),
}).strict();

export const manpowerProjectManagerAccessSchema = z.object({
  projectManagerAccess: z.boolean(),
}).strict();

export const manpowerActiveSchema = z.object({
  active: z.boolean(),
});

export const projectManagerAppointmentSchema = z.object({
  punchId: employeePunchId.nullable(),
}).strict();

export const projectMembershipSchema = z.object({
  projectId: positiveId.nullable(),
}).strict();

export const projectManagerAssignmentSchema = projectMembershipSchema;

export const projectManagerAssignmentsSchema = z.object({
  projectIds: z.array(positiveId).refine(
    (projectIds) => new Set(projectIds).size === projectIds.length,
    "Project IDs must be unique.",
  ),
}).strict();

export const reportQuerySchema = z.object({
  projectId: positiveId.optional(),
  fromDate: z.iso.date().optional(),
  toDate: z.iso.date().optional(),
  q: z.string().trim().max(120).optional(),
}).refine(
  (query) => !query.fromDate || !query.toDate || query.fromDate <= query.toDate,
  { message: "Start date must be on or before end date." },
);

export const reportBulkDeleteSchema = z.object({
  ids: z.array(positiveId).min(1).max(100)
    .refine((ids) => new Set(ids).size === ids.length, "Report IDs must be unique."),
}).strict();

export const reportEditSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).default(""),
  reportDate: z.iso.date(),
  removeFileIds: z.array(positiveId).max(100)
    .refine((ids) => new Set(ids).size === ids.length, "Attachment IDs must be unique."),
  removeLegacyFile: z.boolean().default(false),
}).strict();

export const reportFormSchema = z.object({
  projectId: positiveId,
  reportDate: z.iso.date(),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).default(""),
});
