import express from "express";
import PDFDocument from "pdfkit";
import path from "node:path";
import { access } from "node:fs/promises";
import yazl from "yazl";
import {
  asc,
  and,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  or,
} from "drizzle-orm";
import { accounts, projects, reportFiles, reports } from "../../src/db/schema.js";
import { asyncRoute, HttpError } from "../errors.js";
import {
  canManageProjectReports,
  canEditProjectReports,
  hasAdminAccess,
  hasProjectManagerAccess,
  requireAdmin,
  requireIdentity,
  requireProjectManager,
  requireProjectReportManager,
  requireSuperUser,
} from "../identity.js";
import { assertReportTransition } from "../domain/report-workflow.js";
import { notifyReportCreated } from "../notifications/email.js";
import {
  commitUpload,
  formatFileSize,
  getStoredFilePath,
  removeLocalFile,
  reportUpload,
} from "../storage/local.js";
import { isSupportedReportFile, sanitizeUploadFileName } from "../report-files.js";
import {
  idParamsSchema,
  projectIdParamsSchema,
  punchIdParamsSchema,
  reportBulkDeleteSchema,
  reportEditSchema,
  reportFileParamsSchema,
  reportFormSchema,
  reportQuerySchema,
} from "../schemas.js";
import { validate } from "../validation.js";

function toAttachment(file) {
  const fileExtension = path.extname(file.fileName).slice(1).toUpperCase();
  return {
    id: file.id === null || file.id === undefined ? null : String(file.id),
    fileName: file.fileName,
    fileSize: formatFileSize(Number(file.fileSizeBytes)),
    fileSizeBytes: Number(file.fileSizeBytes),
    type: fileExtension || "FILE",
  };
}

function toReport(row, attachments = []) {
  const files = attachments.length
    ? attachments.map(toAttachment)
    : [toAttachment({ ...row, id: null })];
  return {
    id: String(row.id),
    projectId: String(row.projectId),
    projectName: row.projectName,
    title: row.title,
    description: row.description,
    user: row.uploaderName,
    date: row.reportDate,
    fileName: files[0].fileName,
    fileSize: files[0].fileSize,
    fileSizeBytes: files[0].fileSizeBytes,
    type: files[0].type,
    files,
  };
}

function createReportPdf(report, attachments) {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({
      size: "A4",
      margin: 54,
      info: {
        Title: report.title,
        Author: report.uploaderName,
        Subject: "CSC Feed report summary",
      },
    });
    const chunks = [];
    document.on("data", (chunk) => chunks.push(chunk));
    document.once("end", () => resolve(Buffer.concat(chunks)));
    document.once("error", reject);

    document.fillColor("#202b3d").fontSize(22).text(report.title);
    document.moveDown(0.7);
    document.fillColor("#536177").fontSize(10)
      .text(`Report ID: ${report.id}`)
      .text(`Project: ${report.projectName}`)
      .text(`Report date: ${report.reportDate}`)
      .text(`Uploaded by: ${report.uploaderName}`);
    document.moveDown(1);
    document.fillColor("#202b3d").fontSize(13).text("Description");
    document.moveDown(0.35);
    document.fillColor("#455369").fontSize(10)
      .text(report.description || "No description provided.", { lineGap: 3 });
    document.moveDown(1);
    document.fillColor("#202b3d").fontSize(13).text("Evidence");
    document.moveDown(0.35);
    document.fillColor("#455369").fontSize(10)
      .text(`${attachments.length} file${attachments.length === 1 ? "" : "s"} included in the evidence folder.`);
    document.end();
  });
}

function packageFileName(title, reportId) {
  const safeTitle = title.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._-]+/, "").slice(0, 80) || "report";
  return `${safeTitle}-${reportId}-package.zip`;
}

function projectArchiveFileName(projectName) {
  const safeName = projectName.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._-]+/, "").slice(0, 80) || "project";
  return `${safeName}-reports.zip`;
}

function projectArchiveFolder(report) {
  const safeName = report.projectName.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._-]+/, "").slice(0, 80) || "project";
  return `${report.projectId}-${safeName}`;
}

function reportArchiveFolder(report) {
  const safeTitle = report.title.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._-]+/, "").slice(0, 80) || "report";
  return `${report.id}-${safeTitle}`;
}

function streamZipFile(zipFile, res, next) {
  let packageFailed = false;
  const failPackage = (error) => {
    if (packageFailed) return;
    packageFailed = true;
    zipFile.outputStream.unpipe(res);
    if (!zipFile.outputStream.destroyed) zipFile.outputStream.destroy();
    if (res.headersSent) res.destroy(error);
    else next(error);
  };
  zipFile.on("error", failPackage);
  zipFile.outputStream.on("error", failPackage);
  res.on("close", () => {
    if (!res.writableEnded) zipFile.outputStream.destroy();
  });
  zipFile.outputStream.pipe(res);
  zipFile.end();
}

function uniqueEvidencePath(fileName, index, usedNames) {
  const safeName = sanitizeUploadFileName(fileName) || `evidence-${index + 1}`;
  const extension = path.extname(safeName);
  const baseName = safeName.slice(0, safeName.length - extension.length) || `evidence-${index + 1}`;
  let candidate = safeName;
  let suffix = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${baseName}-${suffix}${extension}`;
    suffix += 1;
  }
  usedNames.add(candidate.toLowerCase());
  return `evidence/${candidate}`;
}

async function addReportEntries(zipFile, reportRows, attachmentRows, includeProjectFolders = false) {
  const attachmentsByReport = new Map();
  for (const attachment of attachmentRows) {
    const reportId = String(attachment.reportId);
    const files = attachmentsByReport.get(reportId) || [];
    files.push(attachment);
    attachmentsByReport.set(reportId, files);
  }

  for (const report of reportRows) {
    const attachments = attachmentsByReport.get(String(report.id));
    const files = attachments?.length ? attachments : [{
      fileName: report.fileName,
      storageKey: report.storageKey,
      fileSizeBytes: report.fileSizeBytes,
    }];
    const usedEvidenceNames = new Set();
    const folderParts = includeProjectFolders ? [projectArchiveFolder(report)] : [];
    folderParts.push(reportArchiveFolder(report));
    const folder = folderParts.join("/");
    for (const [index, file] of files.entries()) {
      const filePath = getStoredFilePath(file.storageKey);
      try {
        await access(filePath);
      } catch (error) {
        if (error.code === "ENOENT") throw new HttpError(404, `An attachment for report ${report.id} is missing.`);
        throw error;
      }
      zipFile.addFile(filePath, `${folder}/${uniqueEvidencePath(file.fileName, index, usedEvidenceNames)}`);
    }

    const pdf = await createReportPdf(report, files);
    zipFile.addBuffer(pdf, `${folder}/report.pdf`);
  }
}

async function cleanupUpload(filePath) {
  if (!filePath) return;
  try {
    await removeLocalFile(filePath);
  } catch (error) {
    console.error("Could not remove an incomplete report upload:", error);
  }
}

async function cleanupUploads(filePaths) {
  for (const filePath of filePaths) await cleanupUpload(filePath);
}

async function listReports(db, identity, query, maxUploadBytes, ownerId = null) {
  const { projectId, fromDate, toDate, q } = query;
  const filters = [isNull(reports.archivedAt), eq(projects.active, true)];
  if (ownerId !== null) filters.push(eq(reports.uploadedBy, ownerId));
  else if (!hasAdminAccess(identity.role)) {
    filters.push(identity.projectManagerProjectIds?.length
      ? inArray(reports.projectId, identity.projectManagerProjectIds.map(Number))
      : eq(reports.uploadedBy, identity.id));
  }
  if (projectId) filters.push(eq(reports.projectId, projectId));
  if (fromDate) filters.push(gte(reports.reportDate, fromDate));
  if (toDate) filters.push(lte(reports.reportDate, toDate));
  if (q) {
    const escapedQuery = q.replace(/[\\%_]/g, "\\$&");
    const pattern = `%${escapedQuery}%`;
    filters.push(or(
      ilike(reports.title, pattern),
      ilike(reports.description, pattern),
      ilike(reports.uploaderName, pattern),
      ilike(reports.uploaderPunchId, pattern),
      ilike(reports.fileName, pattern),
    ));
  }

  const rows = await db.select({
    id: reports.id,
    projectId: reports.projectId,
    projectName: projects.name,
    title: reports.title,
    description: reports.description,
    uploaderName: reports.uploaderName,
    reportDate: reports.reportDate,
    fileName: reports.fileName,
    fileSizeBytes: reports.fileSizeBytes,
  })
    .from(reports)
    .innerJoin(projects, eq(projects.id, reports.projectId))
    .where(and(...filters))
    .orderBy(desc(reports.reportDate), desc(reports.createdAt));

  const attachmentRows = rows.length
    ? await db.select({
      id: reportFiles.id,
      reportId: reportFiles.reportId,
      fileName: reportFiles.fileName,
      fileSizeBytes: reportFiles.fileSizeBytes,
    })
      .from(reportFiles)
      .where(inArray(reportFiles.reportId, rows.map((row) => row.id)))
      .orderBy(asc(reportFiles.id))
    : [];
  const attachmentsByReport = new Map();
  for (const attachment of attachmentRows) {
    const reportId = String(attachment.reportId);
    const files = attachmentsByReport.get(reportId) || [];
    files.push(attachment);
    attachmentsByReport.set(reportId, files);
  }

  return {
    success: true,
    data: rows.map((row) => toReport(row, attachmentsByReport.get(String(row.id)))),
    maxUploadBytes,
  };
}

function reportOwnerFilters(identity) {
  if (hasAdminAccess(identity.role)) return [];
  if (hasProjectManagerAccess(identity)) {
    return [inArray(reports.projectId, identity.projectManagerProjectIds.map(Number))];
  }
  return [eq(reports.uploadedBy, identity.id)];
}

export function createReportsRouter({ db, maxUploadBytes }) {
  const router = express.Router();
  router.use(requireIdentity(db));

  router.delete("/selected", requireSuperUser, validate(reportBulkDeleteSchema), asyncRoute(async (req, res) => {
    const reportIds = req.validated.body.ids;
    const filePaths = await db.transaction(async (tx) => {
      const reportRows = await tx.select({
        id: reports.id,
        storageKey: reports.storageKey,
      })
        .from(reports)
        .where(inArray(reports.id, reportIds))
        .for("update");

      if (reportRows.length !== reportIds.length) {
        throw new HttpError(404, "One or more selected reports were not found.");
      }

      const attachmentRows = await tx.select({ storageKey: reportFiles.storageKey })
        .from(reportFiles)
        .where(inArray(reportFiles.reportId, reportIds));
      const storageKeys = new Set([
        ...reportRows.map((report) => report.storageKey),
        ...attachmentRows.map((file) => file.storageKey),
      ]);
      const paths = [...storageKeys].map((storageKey) => getStoredFilePath(storageKey));

      const deleted = await tx.delete(reports)
        .where(inArray(reports.id, reportIds))
        .returning({ id: reports.id });
      if (deleted.length !== reportIds.length) {
        throw new HttpError(409, "A selected report changed while the request was being processed.");
      }
      return paths;
    });

    let cleanupPendingCount = 0;
    for (const filePath of filePaths) {
      try {
        await removeLocalFile(filePath);
      } catch (error) {
        cleanupPendingCount += 1;
        console.error("A report was deleted, but its stored evidence file could not be removed:", error);
      }
    }

    return res.json({
      success: true,
      data: { deletedCount: reportIds.length, cleanupPendingCount },
    });
  }));

  router.get("/", requireAdmin, validate(reportQuerySchema, "query"), asyncRoute(async (req, res) => {
    return res.json(await listReports(db, req.identity, req.validated.query, maxUploadBytes));
  }));

  router.get("/managed", requireProjectManager, validate(reportQuerySchema, "query"), asyncRoute(async (req, res) => {
    return res.json(await listReports(db, req.identity, req.validated.query, maxUploadBytes));
  }));

  router.get("/mine", validate(reportQuerySchema, "query"), asyncRoute(async (req, res) => {
    return res.json(await listReports(db, req.identity, req.validated.query, maxUploadBytes, req.identity.id));
  }));

  router.get("/by-uploader/:punchId", requireAdmin, validate(punchIdParamsSchema, "params"), validate(reportQuerySchema, "query"), asyncRoute(async (req, res) => {
    const [account] = await db.select({ id: accounts.id })
      .from(accounts)
      .where(and(
        eq(accounts.punchId, req.validated.params.punchId),
        inArray(accounts.accountRole, ["employee", "admin", "project_manager"]),
      ))
      .limit(1);
    if (!account) throw new HttpError(404, "Employee account not found.");

    return res.json(await listReports(
      db,
      req.identity,
      req.validated.query,
      maxUploadBytes,
      Number(account.id),
    ));
  }));

  router.get("/projects/export", requireProjectReportManager, asyncRoute(async (req, res, next) => {
    const projectFilters = [eq(projects.active, true)];
    if (!hasAdminAccess(req.identity.role)) {
      projectFilters.push(inArray(projects.id, req.identity.projectManagerProjectIds.map(Number)));
    }

    const projectRows = await db.select({
      id: projects.id,
      name: projects.name,
    })
      .from(projects)
      .where(and(...projectFilters))
      .orderBy(asc(projects.name));

    if (projectRows.length === 0) throw new HttpError(404, "There are no active projects available to export.");

    const projectIds = projectRows.map((project) => project.id);
    const reportRows = await db.select({
      id: reports.id,
      projectId: reports.projectId,
      projectName: projects.name,
      title: reports.title,
      description: reports.description,
      uploaderName: reports.uploaderName,
      reportDate: reports.reportDate,
      fileName: reports.fileName,
      storageKey: reports.storageKey,
      fileSizeBytes: reports.fileSizeBytes,
    })
      .from(reports)
      .innerJoin(projects, eq(projects.id, reports.projectId))
      .where(and(
        inArray(reports.projectId, projectIds),
        eq(projects.active, true),
        isNull(reports.archivedAt),
      ))
      .orderBy(asc(projects.name), desc(reports.reportDate), desc(reports.createdAt));

    if (reportRows.length === 0) throw new HttpError(404, "There are no active reports to export.");

    const attachmentRows = await db.select({
      id: reportFiles.id,
      reportId: reportFiles.reportId,
      fileName: reportFiles.fileName,
      storageKey: reportFiles.storageKey,
      fileSizeBytes: reportFiles.fileSizeBytes,
    })
      .from(reportFiles)
      .where(inArray(reportFiles.reportId, reportRows.map((report) => report.id)))
      .orderBy(asc(reportFiles.id));

    const zipFile = new yazl.ZipFile();
    await addReportEntries(zipFile, reportRows, attachmentRows, true);

    res.attachment(hasAdminAccess(req.identity.role) ? "all-projects-reports.zip" : "assigned-projects-reports.zip");
    res.setHeader("X-Content-Type-Options", "nosniff");
    streamZipFile(zipFile, res, next);
  }));

  router.get("/project/:projectId/export", requireProjectReportManager, validate(projectIdParamsSchema, "params"), asyncRoute(async (req, res, next) => {
    const projectId = req.validated.params.projectId;
    if (!canManageProjectReports(req.identity, projectId)) {
      throw new HttpError(403, "You can only export reports from your assigned projects.");
    }

    const reportRows = await db.select({
      id: reports.id,
      projectId: reports.projectId,
      projectName: projects.name,
      title: reports.title,
      description: reports.description,
      uploaderName: reports.uploaderName,
      reportDate: reports.reportDate,
      fileName: reports.fileName,
      storageKey: reports.storageKey,
      fileSizeBytes: reports.fileSizeBytes,
    })
      .from(reports)
      .innerJoin(projects, eq(projects.id, reports.projectId))
      .where(and(
        eq(projects.id, projectId),
        eq(projects.active, true),
        isNull(reports.archivedAt),
      ))
      .orderBy(desc(reports.reportDate), desc(reports.createdAt));

    if (reportRows.length === 0) throw new HttpError(404, "This project has no active reports to export.");

    const attachmentRows = await db.select({
      id: reportFiles.id,
      reportId: reportFiles.reportId,
      fileName: reportFiles.fileName,
      storageKey: reportFiles.storageKey,
      fileSizeBytes: reportFiles.fileSizeBytes,
    })
      .from(reportFiles)
      .where(inArray(reportFiles.reportId, reportRows.map((report) => report.id)))
      .orderBy(asc(reportFiles.id));
    const zipFile = new yazl.ZipFile();
    await addReportEntries(zipFile, reportRows, attachmentRows);

    res.attachment(projectArchiveFileName(reportRows[0].projectName));
    res.setHeader("X-Content-Type-Options", "nosniff");
    streamZipFile(zipFile, res, next);
  }));

  router.get("/:id/download", validate(idParamsSchema, "params"), asyncRoute(async (req, res, next) => {
    const [report] = await db.select({
      id: reports.id,
      projectName: projects.name,
      title: reports.title,
      description: reports.description,
      uploaderName: reports.uploaderName,
      reportDate: reports.reportDate,
      fileName: reports.fileName,
      storageKey: reports.storageKey,
      fileSizeBytes: reports.fileSizeBytes,
    })
      .from(reports)
      .innerJoin(projects, eq(projects.id, reports.projectId))
      .where(and(
        eq(reports.id, req.validated.params.id),
        isNull(reports.archivedAt),
        ...reportOwnerFilters(req.identity),
      ))
      .limit(1);

    if (!report) throw new HttpError(404, "Report not found.");

    const attachments = await db.select({
      fileName: reportFiles.fileName,
      storageKey: reportFiles.storageKey,
      fileSizeBytes: reportFiles.fileSizeBytes,
    })
      .from(reportFiles)
      .where(eq(reportFiles.reportId, report.id))
      .orderBy(asc(reportFiles.id));
    const files = attachments.length ? attachments : [{
      fileName: report.fileName,
      storageKey: report.storageKey,
      fileSizeBytes: report.fileSizeBytes,
    }];
    const storedFiles = [];
    const usedEvidenceNames = new Set();
    for (const [index, file] of files.entries()) {
      const filePath = getStoredFilePath(file.storageKey);
      try {
        await access(filePath);
      } catch (error) {
        if (error.code === "ENOENT") throw new HttpError(404, "A stored report attachment is missing.");
        throw error;
      }
      storedFiles.push({
        filePath,
        archivePath: uniqueEvidencePath(file.fileName, index, usedEvidenceNames),
      });
    }

    const pdf = await createReportPdf(report, files);
    const zipFile = new yazl.ZipFile();
    res.attachment(packageFileName(report.title, report.id));
    res.setHeader("X-Content-Type-Options", "nosniff");
    zipFile.addBuffer(pdf, "report.pdf");
    for (const file of storedFiles) {
      zipFile.addFile(file.filePath, file.archivePath);
    }
    streamZipFile(zipFile, res, next);
  }));

  router.post("/", reportUpload.fields([{ name: "files" }, { name: "file" }]), asyncRoute(async (req, res) => {
    if (req.identity.role === "admin") {
      throw new HttpError(403, "Appointed Admins can view reports but cannot upload or edit them.");
    }
    const uploads = [
      ...(req.files?.files || []),
      ...(req.files?.file || []),
    ];
    const parsed = reportFormSchema.safeParse(req.body);
    if (!parsed.success) {
      await cleanupUploads(uploads.map((file) => file.path));
      throw new HttpError(400, parsed.error.issues[0]?.message || "Invalid report details.");
    }
    if (uploads.length === 0) {
      throw new HttpError(400, "Choose at least one report file to upload.");
    }

    const files = uploads.map((file) => ({
      upload: file,
      fileName: sanitizeUploadFileName(file.originalname),
    }));
    const invalidFile = files.find(({ fileName }) =>
      !fileName || fileName.length > 255 || !isSupportedReportFile(fileName),
    );
    if (invalidFile) {
      await cleanupUploads(uploads.map((file) => file.path));
      throw new HttpError(
        400,
        "Choose supported image, PDF, Word, Excel, CSV, or text files with names up to 255 characters.",
      );
    }

    const committedFiles = [];
    let reportRow;
    try {
      for (const { upload } of files) {
        committedFiles.push(await commitUpload(upload));
      }

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
        if (!hasAdminAccess(req.identity.role)
          && req.identity.projectManagerProjectIds?.length
          && !req.identity.projectManagerProjectIds.includes(String(project.id))) {
          throw new HttpError(403, "You can only upload reports to your assigned projects.");
        }
        if (req.identity.role === "employee" && req.identity.projectId
          && req.identity.projectId !== String(project.id)) {
          throw new HttpError(403, "You can only upload reports to your assigned project.");
        }

        const firstFile = files[0];
        const firstCommittedFile = committedFiles[0];
        const [report] = await tx.insert(reports).values({
          projectId: project.id,
          uploadedBy: req.identity.id,
          uploaderName: req.identity.name,
          uploaderPunchId: req.identity.punchId,
          reportDate: parsed.data.reportDate,
          title: parsed.data.title,
          description: parsed.data.description,
          fileName: firstFile.fileName,
          storageKey: firstCommittedFile.storageKey,
          contentType: firstFile.upload.mimetype || "application/octet-stream",
          fileSizeBytes: firstFile.upload.size,
        }).returning();
        const attachments = await tx.insert(reportFiles).values(files.map(({ upload, fileName }, index) => ({
          reportId: report.id,
          fileName,
          storageKey: committedFiles[index].storageKey,
          contentType: upload.mimetype || "application/octet-stream",
          fileSizeBytes: upload.size,
        }))).returning();

        return {
          ...report,
          projectName: project.name,
          uploaderName: req.identity.name,
          files: attachments,
        };
      });
    } catch (error) {
      await cleanupUploads([
        ...committedFiles.map((file) => file.filePath),
        ...uploads.map((file) => file.path),
      ]);
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
        fileNames: reportRow.files.map((file) => file.fileName),
      });
    } catch (error) {
      notification = "failed";
      console.error("Report was saved, but its email notification failed:", error);
    }

    return res.status(201).json({
      success: true,
      data: toReport(reportRow, reportRow.files),
      notification,
    });
  }));

  router.patch("/:id", requireProjectReportManager, validate(idParamsSchema, "params"), reportUpload.fields([{ name: "files" }, { name: "file" }]), asyncRoute(async (req, res) => {
    const uploads = [
      ...(req.files?.files || []),
      ...(req.files?.file || []),
    ];
    let removeFileIds;
    try {
      removeFileIds = JSON.parse(req.body.removeFileIds || "[]");
    } catch {
      await cleanupUploads(uploads.map((file) => file.path));
      throw new HttpError(400, "Attachment removals must be a valid list.");
    }

    const parsed = reportEditSchema.safeParse({
      title: req.body.title,
      description: req.body.description,
      reportDate: req.body.reportDate,
      removeFileIds,
      removeLegacyFile: req.body.removeLegacyFile === "true",
    });
    if (!parsed.success) {
      await cleanupUploads(uploads.map((file) => file.path));
      throw new HttpError(400, parsed.error.issues[0]?.message || "Invalid report details.");
    }

    const files = uploads.map((file) => ({
      upload: file,
      fileName: sanitizeUploadFileName(file.originalname),
    }));
    const invalidFile = files.find(({ fileName }) =>
      !fileName || fileName.length > 255 || !isSupportedReportFile(fileName),
    );
    if (invalidFile) {
      await cleanupUploads(uploads.map((file) => file.path));
      throw new HttpError(
        400,
        "Choose supported image, PDF, Word, Excel, CSV, or text files with names up to 255 characters.",
      );
    }

    const committedFiles = [];
    let updatedReport;
    try {
      for (const { upload } of files) {
        committedFiles.push(await commitUpload(upload));
      }

      updatedReport = await db.transaction(async (tx) => {
        const [current] = await tx.select({
          id: reports.id,
          projectId: reports.projectId,
          projectName: projects.name,
          projectActive: projects.active,
          uploaderName: reports.uploaderName,
          title: reports.title,
          description: reports.description,
          reportDate: reports.reportDate,
          fileName: reports.fileName,
          storageKey: reports.storageKey,
          contentType: reports.contentType,
          fileSizeBytes: reports.fileSizeBytes,
          archivedAt: reports.archivedAt,
        })
          .from(reports)
          .innerJoin(projects, eq(projects.id, reports.projectId))
          .where(eq(reports.id, req.validated.params.id))
          .for("update");

        if (!current) throw new HttpError(404, "Report not found.");
        if (!current.projectActive || current.archivedAt) {
          throw new HttpError(409, "Archived or inactive-project reports cannot be edited.");
        }
        if (!canEditProjectReports(req.identity, current.projectId)) {
          throw new HttpError(403, "You can only edit reports in your assigned projects.");
        }

        let currentFiles = await tx.select({
          id: reportFiles.id,
          fileName: reportFiles.fileName,
          storageKey: reportFiles.storageKey,
          contentType: reportFiles.contentType,
          fileSizeBytes: reportFiles.fileSizeBytes,
        })
          .from(reportFiles)
          .where(eq(reportFiles.reportId, current.id))
          .orderBy(asc(reportFiles.id));

        let legacyAttachmentId = null;
        if (currentFiles.length === 0) {
          currentFiles = await tx.insert(reportFiles).values({
            reportId: current.id,
            fileName: current.fileName,
            storageKey: current.storageKey,
            contentType: current.contentType,
            fileSizeBytes: current.fileSizeBytes,
          }).returning();
          legacyAttachmentId = currentFiles[0].id;
        }

        const currentFileIds = new Set(currentFiles.map((file) => Number(file.id)));
        if (parsed.data.removeFileIds.some((id) => !currentFileIds.has(id))) {
          throw new HttpError(400, "One or more selected attachments do not belong to this report.");
        }

        const removeFileIdsSet = new Set(parsed.data.removeFileIds);
        if (parsed.data.removeLegacyFile && legacyAttachmentId !== null) {
          removeFileIdsSet.add(Number(legacyAttachmentId));
        }
        const removedFiles = currentFiles.filter((file) => removeFileIdsSet.has(Number(file.id)));
        const retainedFiles = currentFiles.filter((file) => !removeFileIdsSet.has(Number(file.id)));
        if (retainedFiles.length + committedFiles.length === 0) {
          throw new HttpError(409, "A report must keep at least one evidence attachment.");
        }

        const removedFilePaths = removedFiles.map((file) => getStoredFilePath(file.storageKey));
        if (removedFiles.length) {
          await tx.delete(reportFiles)
            .where(inArray(reportFiles.id, removedFiles.map((file) => file.id)));
        }

        const addedFiles = committedFiles.length
          ? await tx.insert(reportFiles).values(files.map(({ upload, fileName }, index) => ({
            reportId: current.id,
            fileName,
            storageKey: committedFiles[index].storageKey,
            contentType: upload.mimetype || "application/octet-stream",
            fileSizeBytes: upload.size,
          }))).returning()
          : [];
        const finalFiles = [...retainedFiles, ...addedFiles];
        const firstFile = finalFiles[0];
        const [report] = await tx.update(reports)
          .set({
            title: parsed.data.title,
            description: parsed.data.description,
            reportDate: parsed.data.reportDate,
            fileName: firstFile.fileName,
            storageKey: firstFile.storageKey,
            contentType: firstFile.contentType,
            fileSizeBytes: firstFile.fileSizeBytes,
          })
          .where(eq(reports.id, current.id))
          .returning();

        return {
          report: { ...report, projectName: current.projectName, uploaderName: current.uploaderName },
          files: finalFiles,
          removedFilePaths,
        };
      });
    } catch (error) {
      await cleanupUploads([
        ...committedFiles.map((file) => file.filePath),
        ...uploads.map((file) => file.path),
      ]);
      throw error;
    }

    let cleanupPendingCount = 0;
    for (const filePath of updatedReport.removedFilePaths) {
      try {
        await removeLocalFile(filePath);
      } catch (error) {
        cleanupPendingCount += 1;
        console.error("A report attachment was replaced, but its previous evidence file could not be removed:", error);
      }
    }

    return res.json({
      success: true,
      data: toReport(updatedReport.report, updatedReport.files),
      cleanupPendingCount,
    });
  }));

  router.get("/:id/files/:fileId/preview", validate(reportFileParamsSchema, "params"), asyncRoute(async (req, res, next) => {
    const [file] = await db.select({
      fileName: reportFiles.fileName,
      storageKey: reportFiles.storageKey,
    })
      .from(reportFiles)
      .innerJoin(reports, eq(reports.id, reportFiles.reportId))
      .where(and(
        eq(reportFiles.id, req.validated.params.fileId),
        eq(reportFiles.reportId, req.validated.params.id),
        isNull(reports.archivedAt),
        ...reportOwnerFilters(req.identity),
      ))
      .limit(1);

    if (!file) throw new HttpError(404, "Report file not found.");
    const extension = path.extname(file.fileName).toLowerCase();
    const previewTypes = new Map([
      [".bmp", "image/bmp"],
      [".gif", "image/gif"],
      [".jpeg", "image/jpeg"],
      [".jpg", "image/jpeg"],
      [".pdf", "application/pdf"],
      [".png", "image/png"],
      [".webp", "image/webp"],
    ]);
    const contentType = previewTypes.get(extension);
    if (!contentType) throw new HttpError(415, "This file type cannot be previewed inline.");

    const filePath = getStoredFilePath(file.storageKey);
    return res.sendFile(filePath, {
      headers: {
        "Content-Disposition": "inline",
        "Content-Security-Policy": "sandbox; default-src 'none'; frame-ancestors 'self'",
        "Content-Type": contentType,
        "X-Content-Type-Options": "nosniff",
      },
    }, (error) => {
      if (!error) return;
      if (error.code === "ENOENT") {
        return next(new HttpError(404, "The stored report file is missing."));
      }
      return next(error);
    });
  }));

  router.get("/:id/files/:fileId", validate(reportFileParamsSchema, "params"), asyncRoute(async (req, res, next) => {
    const [file] = await db.select({
      fileName: reportFiles.fileName,
      storageKey: reportFiles.storageKey,
    })
      .from(reportFiles)
      .innerJoin(reports, eq(reports.id, reportFiles.reportId))
      .where(and(
        eq(reportFiles.id, req.validated.params.fileId),
        eq(reportFiles.reportId, req.validated.params.id),
        isNull(reports.archivedAt),
        ...reportOwnerFilters(req.identity),
      ))
      .limit(1);

    if (!file) throw new HttpError(404, "Report file not found.");
    const filePath = getStoredFilePath(file.storageKey);
    return res.download(filePath, file.fileName, {
      headers: { "X-Content-Type-Options": "nosniff" },
    }, (error) => {
      if (!error) return;
      if (error.code === "ENOENT") {
        return next(new HttpError(404, "The stored report file is missing."));
      }
      return next(error);
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
        ...reportOwnerFilters(req.identity),
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

  router.post("/:id/archive", requireProjectReportManager, validate(idParamsSchema, "params"), asyncRoute(async (req, res) => {
    const reportId = req.validated.params.id;
    const archived = await db.transaction(async (tx) => {
      const [current] = await tx.select({
        id: reports.id,
        projectId: reports.projectId,
        archivedAt: reports.archivedAt,
      })
        .from(reports)
        .where(eq(reports.id, reportId))
        .for("update");

      if (!current) throw new HttpError(404, "Report not found.");
      assertReportTransition(current.archivedAt ? "archived" : "active", "archived", req.identity, current.projectId);

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
