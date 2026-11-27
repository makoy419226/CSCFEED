import express from "express";
import path from "node:path";
import {
  and,
  desc,
  eq,
  gte,
  ilike,
  isNull,
  lte,
  or,
} from "drizzle-orm";
import { accounts, projects, reports } from "../../src/db/schema.js";
import { asyncRoute, HttpError } from "../errors.js";
import { requireAdmin, requireIdentity } from "../identity.js";
import { assertReportTransition } from "../domain/report-workflow.js";
import { notifyReportCreated } from "../notifications/email.js";
import {
  commitUpload,
  formatFileSize,
  getStoredFilePath,
  removeLocalFile,
  reportUpload,
} from "../storage/local.js";
import { idParamsSchema, reportFormSchema, reportQuerySchema } from "../schemas.js";
import { validate } from "../validation.js";

function toReport(row) {
  const fileExtension = path.extname(row.fileName).slice(1).toUpperCase();
  return {
    id: String(row.id),
    projectId: String(row.projectId),
    projectName: row.projectName,
    title: row.title,
    description: row.description,
    user: row.uploaderName,
    date: row.reportDate,
    fileName: row.fileName,
    fileSize: formatFileSize(Number(row.fileSizeBytes)),
    fileSizeBytes: Number(row.fileSizeBytes),
    type: fileExtension || "FILE",
  };
}

async function cleanupUpload(filePath) {
  if (!filePath) return;
  try {
    await removeLocalFile(filePath);
  } catch (error) {
    console.error("Could not remove an incomplete report upload:", error);
  }
}

export function createReportsRouter({ db, maxUploadBytes }) {
  const router = express.Router();
  router.use(requireIdentity(db));

  router.get("/", validate(reportQuerySchema, "query"), asyncRoute(async (req, res) => {
    const { projectId, fromDate, toDate, q } = req.validated.query;
    const filters = [isNull(reports.archivedAt), eq(projects.active, true)];
    if (projectId) filters.push(eq(reports.projectId, projectId));
    if (fromDate) filters.push(gte(reports.reportDate, fromDate));
    if (toDate) filters.push(lte(reports.reportDate, toDate));
    if (q) {
      const escapedQuery = q.replace(/[\\%_]/g, "\\$&");
      const pattern = `%${escapedQuery}%`;
      filters.push(or(
        ilike(reports.title, pattern),
        ilike(reports.description, pattern),
        ilike(accounts.fullName, pattern),
        ilike(accounts.punchId, pattern),
        ilike(reports.fileName, pattern),
      ));
    }

    const rows = await db.select({
      id: reports.id,
      projectId: reports.projectId,
      projectName: projects.name,
      title: reports.title,
      description: reports.description,
      uploaderName: accounts.fullName,
      reportDate: reports.reportDate,
      fileName: reports.fileName,
      fileSizeBytes: reports.fileSizeBytes,
    })
      .from(reports)
      .innerJoin(projects, eq(projects.id, reports.projectId))
      .innerJoin(accounts, eq(accounts.id, reports.uploadedBy))
      .where(and(...filters))
      .orderBy(desc(reports.reportDate), desc(reports.createdAt));

    return res.json({
      success: true,
      data: rows.map(toReport),
      maxUploadBytes,
    });
  }));

  router.post("/", reportUpload.single("file"), asyncRoute(async (req, res) => {
    const parsed = reportFormSchema.safeParse(req.body);
    if (!parsed.success) {
      await cleanupUpload(req.file?.path);
      throw new HttpError(400, parsed.error.issues[0]?.message || "Invalid report details.");
    }
    if (!req.file) throw new HttpError(400, "Choose a report file to upload.");

    const fileName = path.basename(req.file.originalname.replace(/\\/g, "/"))
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .trim();
    if (!fileName || fileName.length > 255) {
      await cleanupUpload(req.file.path);
      throw new HttpError(400, "The file name must contain 1 to 255 characters.");
    }

    let committedFile;
    let reportRow;
    try {
      committedFile = await commitUpload(req.file);
      reportRow = await db.transaction(async (tx) => {
        const [project] = await tx.select({
          id: projects.id,
          name: projects.name,
          active: projects.active,
        })
          .from(projects)
          .where(eq(projects.id, parsed.data.projectId))
          .for("update");

        if (!project || !project.active) {
          throw new HttpError(404, "Choose an active project.");
        }

        const [report] = await tx.insert(reports).values({
          projectId: project.id,
          uploadedBy: req.identity.id,
          reportDate: parsed.data.reportDate,
          title: parsed.data.title,
          description: parsed.data.description,
          fileName,
          storageKey: committedFile.storageKey,
          contentType: req.file.mimetype || "application/octet-stream",
          fileSizeBytes: req.file.size,
        }).returning();

        return {
          ...report,
          projectName: project.name,
          uploaderName: req.identity.name,
        };
      });
    } catch (error) {
      await cleanupUpload(committedFile?.filePath || req.file.path);
      throw error;
    }

    let notification = "skipped";
    try {
      notification = await notifyReportCreated({
        title: reportRow.title,
        projectName: reportRow.projectName,
        uploaderName: reportRow.uploaderName,
        reportDate: reportRow.reportDate,
        description: reportRow.description,
        fileName: reportRow.fileName,
      });
    } catch (error) {
      notification = "failed";
      console.error("Report was saved, but its email notification failed:", error);
    }

    return res.status(201).json({
      success: true,
      data: toReport(reportRow),
      notification,
    });
  }));

  router.get("/:id/file", validate(idParamsSchema, "params"), asyncRoute(async (req, res, next) => {
    const [report] = await db.select({
      fileName: reports.fileName,
      storageKey: reports.storageKey,
    })
      .from(reports)
      .where(and(
        eq(reports.id, req.validated.params.id),
        isNull(reports.archivedAt),
      ))
      .limit(1);

    if (!report) throw new HttpError(404, "Report file not found.");
    const filePath = getStoredFilePath(report.storageKey);
    return res.download(filePath, report.fileName, {
      headers: { "X-Content-Type-Options": "nosniff" },
    }, (error) => {
      if (!error) return;
      if (error.code === "ENOENT") {
        return next(new HttpError(404, "The stored report file is missing."));
      }
      return next(error);
    });
  }));

  router.post("/:id/archive", requireAdmin, validate(idParamsSchema, "params"), asyncRoute(async (req, res) => {
    const reportId = req.validated.params.id;
    const archived = await db.transaction(async (tx) => {
      const [current] = await tx.select({
        id: reports.id,
        archivedAt: reports.archivedAt,
      })
        .from(reports)
        .where(eq(reports.id, reportId))
        .for("update");

      if (!current) throw new HttpError(404, "Report not found.");
      assertReportTransition(current.archivedAt ? "archived" : "active", "archived", req.identity);

      const [updated] = await tx.update(reports)
        .set({ archivedAt: new Date(), archivedBy: req.identity.id })
        .where(eq(reports.id, reportId))
        .returning();
      return updated;
    });

    return res.json({ success: true, data: { id: String(archived.id), state: "archived" } });
  }));

  return router;
}
