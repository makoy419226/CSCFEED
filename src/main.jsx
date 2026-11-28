import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Archive,
  ArrowDownToLine,
  ArrowRightLeft,
  ArrowUpRight,
  Bell,
  BriefcaseBusiness,
  CalendarDays,
  Camera,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  File,
  FileText,
  Folder,
  FolderKanban,
  Info,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Pencil,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  Upload,
  UsersRound,
  X,
} from "lucide-react";
import Login from "./Login";
import "./styles.css";

function formatInputDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const today = formatInputDate(new Date());

function formatDate(value) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${value}T12:00:00`));
}

async function apiRequest(url, { method = "GET", body } = {}) {
  const headers = {};
  const options = { method, credentials: "include", headers };
  if (body instanceof FormData) {
    options.body = body;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  if (!(response.headers.get("content-type") || "").toLowerCase().includes("application/json")) {
    throw new Error("The application API is unavailable.");
  }
  const result = await response.json();
  if (!response.ok || result?.success !== true) {
    throw new Error(typeof result?.message === "string" ? result.message : "The request could not be completed.");
  }
  return result;
}

function formatUploadLimit(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

const reportFileAccept = ".bmp,.csv,.doc,.docx,.gif,.jpeg,.jpg,.pdf,.png,.rtf,.txt,.webp,.xls,.xlsx";
const previewSizeLimit = 32 * 1024 * 1024;
const supportedReportExtensions = new Set(reportFileAccept.split(","));

function getFileExtension(fileName) {
  return fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
}

function validateReportFiles(files, maxSize) {
  if (files.length === 0) return "Choose at least one attachment.";
  if (files.some((file) => !supportedReportExtensions.has(getFileExtension(file.name)))) {
    return "Choose image, PDF, Word, Excel, CSV, or text files.";
  }
  if (files.some((file) => file.size > maxSize)) {
    return `Each file must be smaller than ${formatUploadLimit(maxSize)}.`;
  }
  return "";
}

function validateAdditionalReportFiles(files, maxSize) {
  if (files.some((file) => !supportedReportExtensions.has(getFileExtension(file.name)))) {
    return "Choose image, PDF, Word, Excel, CSV, or text files.";
  }
  if (files.some((file) => file.size > maxSize)) {
    return `Each file must be smaller than ${formatUploadLimit(maxSize)}.`;
  }
  return "";
}

function ReportFilePreview({ file, fileName, fileSizeBytes, reportId, fileId }) {
  const [preview, setPreview] = useState({ kind: "loading" });

  useEffect(() => {
    let active = true;
    let objectUrl;
    const extension = getFileExtension(fileName);
    const remoteUrl = reportId
      ? fileId
        ? `/api/reports/${encodeURIComponent(reportId)}/files/${encodeURIComponent(fileId)}`
        : `/api/reports/${encodeURIComponent(reportId)}/file`
      : "";

    const load = async () => {
      try {
        if ([".bmp", ".gif", ".jpeg", ".jpg", ".png", ".webp"].includes(extension)) {
          objectUrl = file ? URL.createObjectURL(file) : `${remoteUrl}/preview`;
          if (active) setPreview({ kind: "image", url: objectUrl });
          return;
        }
        if (extension === ".pdf") {
          objectUrl = file ? URL.createObjectURL(file) : `${remoteUrl}/preview`;
          if (active) setPreview({ kind: "pdf", url: objectUrl });
          return;
        }
        if (!file && !remoteUrl) {
          if (active) setPreview({ kind: "notice", message: "Preview is not available for this older attachment." });
          return;
        }
        if ((file?.size ?? fileSizeBytes ?? 0) > previewSizeLimit) {
          if (active) setPreview({ kind: "notice", message: "This file is large; download it to view." });
          return;
        }

        const response = file
          ? null
          : await fetch(remoteUrl, { credentials: "include" });
        if (response && !response.ok) throw new Error("Could not load this file preview.");
        const blob = file || await response.blob();
        if (blob.size > previewSizeLimit) {
          if (active) setPreview({ kind: "notice", message: "This file is large; download it to view." });
          return;
        }
        const buffer = await blob.arrayBuffer();

        if (extension === ".docx") {
          const mammoth = await import("mammoth");
          const result = await mammoth.extractRawText({ arrayBuffer: buffer });
          if (active) setPreview({
            kind: "text",
            text: result.value.trim() || "This document contains no readable text.",
          });
          return;
        }
        if (extension === ".csv") {
          const { parseCsvPreview } = await import("./spreadsheet-preview.js");
          const text = new TextDecoder().decode(buffer).slice(0, previewSizeLimit);
          if (active) setPreview({ kind: "sheets", sheets: [{ name: fileName, rows: parseCsvPreview(text) }] });
          return;
        }
        if (extension === ".xlsx") {
          const { parseXlsxPreview } = await import("./spreadsheet-preview.js");
          const sheets = await parseXlsxPreview(buffer);
          if (active) setPreview({ kind: "sheets", sheets });
          return;
        }
        if (extension === ".txt" || extension === ".rtf") {
          const text = new TextDecoder().decode(buffer).slice(0, 100000);
          if (active) setPreview({
            kind: "text",
            text: extension === ".rtf"
              ? text.replace(/\\[a-z]+-?\d* ?|[{}]/gi, "").trim()
              : text,
          });
          return;
        }
        if (active) setPreview({
          kind: "notice",
          message: extension === ".xls"
            ? "Preview is not available for this older Excel format; download to open it."
            : "Preview is not available for this older Word format; download to open it.",
        });
      } catch {
        if (active) setPreview({ kind: "notice", message: "This file could not be previewed; try downloading it." });
      }
    };

    void load();
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file, fileName, fileSizeBytes, reportId, fileId]);

  if (preview.kind === "loading") return <div className="file-preview-message">Preparing preview…</div>;
  if (preview.kind === "notice") return <div className="file-preview-message">{preview.message}</div>;
  if (preview.kind === "image") return <img className="file-preview-image" src={preview.url} alt={`Preview of ${fileName}`} />;
  if (preview.kind === "pdf") return <iframe className="file-preview-pdf" title={`Preview of ${fileName}`} src={preview.url} />;
  if (preview.kind === "text") return <pre className="file-preview-text">{preview.text}</pre>;
  return <div className="file-preview-sheets">
    {preview.sheets.map((sheet) => <section key={sheet.name}>
      <strong>{sheet.name}</strong>
      <div className="file-preview-table-wrap"><table className="file-preview-table"><tbody>
        {sheet.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.slice(0, 12).map((cell, cellIndex) =>
          <td key={cellIndex}>{String(cell)}</td>,
        )}</tr>)}
      </tbody></table></div>
    </section>)}
  </div>;
}

function ReportAttachments({ report, onDownload }) {
  const files = report.files?.length ? report.files : [report];
  const [previewIndex, setPreviewIndex] = useState(0);
  const previewFile = files[previewIndex];

  return <div className="report-attachments">
    <div className="report-package-action">
      <div><strong>Report package</strong><small>PDF summary and all evidence files in one ZIP</small></div>
      <button type="button" className="button button-secondary" aria-label={`Download PDF and evidence ZIP for ${report.title}`} onClick={() => onDownload(report)}><ArrowDownToLine size={15} /> Download</button>
    </div>
    <div className="report-attachment-list">
      {files.map((file, index) => <div className="report-attachment-row" key={file.id || `${file.fileName}-${index}`}>
        <span className="file-icon"><FileText size={17} /></span>
        <div><strong>{file.fileName}</strong><small>{file.type} · {file.fileSize}</small></div>
        <button type="button" className="button button-secondary" onClick={() => setPreviewIndex(index)}>Preview</button>
        <button type="button" className="button button-secondary" aria-label={`Download ${file.fileName}`} onClick={() => onDownload(report, file)}><ArrowDownToLine size={15} /> Download</button>
      </div>)}
    </div>
    {previewFile && <div className="report-attachment-preview">
      <strong className="report-preview-title">{previewFile.fileName}</strong>
      <ReportFilePreview
        fileName={previewFile.fileName}
        fileSizeBytes={previewFile.fileSizeBytes}
        reportId={report.id}
        fileId={previewFile.id}
      />
    </div>}
  </div>;
}

function ReportEditModal({ report, maxUploadBytes, isSaving, onClose, onSave }) {
  const [title, setTitle] = useState(report.title);
  const [description, setDescription] = useState(report.description || "");
  const [reportDate, setReportDate] = useState(report.date);
  const [removedFileIds, setRemovedFileIds] = useState([]);
  const [removeLegacyFile, setRemoveLegacyFile] = useState(false);
  const [newFiles, setNewFiles] = useState([]);
  const [error, setError] = useState("");
  const fileInput = useRef(null);
  const attachments = report.files?.length ? report.files : [report];
  const retainedCount = attachments.filter((file) => file.id
    ? !removedFileIds.includes(file.id)
    : !removeLegacyFile).length;
  const evidenceCount = retainedCount + newFiles.length;

  const submit = async (event) => {
    event.preventDefault();
    const fileError = validateAdditionalReportFiles(newFiles, maxUploadBytes);
    if (fileError) {
      setError(fileError);
      return;
    }
    if (evidenceCount === 0) {
      setError("A report must keep at least one evidence attachment.");
      return;
    }
    const body = new FormData();
    body.append("title", title);
    body.append("description", description);
    body.append("reportDate", reportDate);
    body.append("removeFileIds", JSON.stringify(removedFileIds));
    body.append("removeLegacyFile", String(removeLegacyFile));
    for (const file of newFiles) body.append("files", file);
    setError(await onSave(report, body) || "");
  };

  const toggleRemoval = (file) => {
    if (!file.id) {
      setRemoveLegacyFile((current) => !current);
      setError("");
      return;
    }
    setRemovedFileIds((current) => current.includes(file.id)
      ? current.filter((id) => id !== file.id)
      : [...current, file.id]);
    setError("");
  };

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !isSaving) onClose(); }}>
    <section className="upload-modal report-edit-modal" role="dialog" aria-modal="true" aria-labelledby="report-edit-title">
      <div className="modal-heading">
        <div><span className="modal-icon"><Pencil size={18} /></span><div><h2 id="report-edit-title">Edit report</h2><p>Update report details and evidence attachments.</p></div></div>
        <button type="button" className="icon-button" aria-label="Close report editor" disabled={isSaving} onClick={onClose}><X size={19} /></button>
      </div>
      <form onSubmit={submit}>
        <label className="form-label">Report title <span className="required">*</span>
          <input required maxLength="160" value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label className="form-label">Description <span className="optional">(optional)</span>
          <textarea rows="3" maxLength="2000" value={description} onChange={(event) => setDescription(event.target.value)} />
        </label>
        <label className="form-label">Report date <span className="required">*</span>
          <input type="date" required value={reportDate} onChange={(event) => setReportDate(event.target.value)} />
        </label>
        <div className="form-label">Evidence attachments <span className="required">*</span></div>
        <div className="report-edit-files">
          {attachments.map((file, index) => {
            const removed = file.id ? removedFileIds.includes(file.id) : removeLegacyFile;
            return <div className={`report-edit-file ${removed ? "report-edit-file-removed" : ""}`} key={file.id || `${file.fileName}-${index}`}>
              <span className="file-icon"><FileText size={16} /></span>
              <div><strong>{file.fileName}</strong><small>{file.fileSize || report.fileSize}</small></div>
              <button type="button" className="button button-secondary" disabled={isSaving} onClick={() => toggleRemoval(file)}>{removed ? "Keep" : "Remove"}</button>
            </div>;
          })}
          {newFiles.map((file, index) => <div className="report-edit-file" key={`${file.name}-${file.size}-${file.lastModified}`}>
            <span className="file-icon"><Upload size={16} /></span>
            <div><strong>{file.name}</strong><small>New evidence · {(file.size / (1024 * 1024)).toFixed(2)} MB</small></div>
            <button type="button" className="button button-secondary" disabled={isSaving} onClick={() => setNewFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))}>Remove</button>
          </div>)}
        </div>
        <input ref={fileInput} className="sr-only" aria-label="Add evidence attachments" type="file" accept={reportFileAccept} multiple onChange={(event) => {
          setNewFiles((current) => [...current, ...Array.from(event.target.files || [])]);
          setError("");
          event.target.value = "";
        }} />
        <button type="button" className="button button-secondary report-edit-add-file" disabled={isSaving} onClick={() => fileInput.current?.click()}><Plus size={15} /> Add evidence</button>
        <p className="report-edit-evidence-count">{evidenceCount} evidence file{evidenceCount === 1 ? "" : "s"} will remain · {formatUploadLimit(maxUploadBytes)} max per new file</p>
        {error && <p className="field-error" role="alert">{error}</p>}
        <div className="modal-footer">
          <span><ShieldCheck size={15} /> At least one evidence file is required</span>
          <div>
            <button type="button" className="button button-secondary" disabled={isSaving} onClick={onClose}>Cancel</button>
            <button type="submit" className="button button-primary" disabled={isSaving || evidenceCount === 0}><Check size={16} /> {isSaving ? "Saving…" : "Save changes"}</button>
          </div>
        </div>
      </form>
    </section>
  </div>;
}

function ScreenTransition({ screenKey, children }) {
  const [screen, setScreen] = useState({ key: screenKey, children });
  const [phase, setPhase] = useState("enter");

  useEffect(() => {
    if (screen.key === screenKey) {
      setPhase((current) => current === "exit" ? "enter" : current);
      return undefined;
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setScreen({ key: screenKey, children });
      setPhase("stable");
      return undefined;
    }

    setPhase("exit");
    const timeout = window.setTimeout(() => {
      setScreen({ key: screenKey, children });
      setPhase("enter");
    }, 160);
    return () => window.clearTimeout(timeout);
  }, [screen.key, screenKey]);

  useEffect(() => {
    if (phase !== "enter") return undefined;
    const timeout = window.setTimeout(() => setPhase("stable"), 240);
    return () => window.clearTimeout(timeout);
  }, [phase]);

  return <div className={`screen-transition screen-transition-${phase}`}>
    {screen.key === screenKey ? children : screen.children}
  </div>;
}

function App() {
  const [user, setUser] = useState(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [authMessage, setAuthMessage] = useState("");

  useEffect(() => {
    let active = true;
    const restoreSession = async () => {
      try {
        const response = await fetch("/api/auth/session", { credentials: "include" });
        if (response.status === 401) return;
        if (!(response.headers.get("content-type") || "").toLowerCase().includes("application/json")) {
          throw new Error("The sign-in API returned a non-JSON response. Check /api/health and verify the Vite API proxy is connected.");
        }

        const result = await response.json();
        if (!response.ok || !result || result.success !== true || !result.user
          || typeof result.user.name !== "string" || typeof result.user.role !== "string") {
          throw new Error(result.message || "Unable to verify your sign-in. Reports remain locked.");
        }
        if (active) {
          setUser({
            name: result.user.name || result.user.username,
            role: result.user.role.toLowerCase(),
            punchId: result.user.punchId || result.user.username || "",
            projectManagerProjectIds: result.user.projectManagerProjectIds || [],
          });
        }
      } catch (error) {
        if (active) {
          setAuthMessage(error instanceof Error ? error.message : "Unable to verify your sign-in. Reports remain locked.");
        }
      } finally {
        if (active) setIsCheckingSession(false);
      }
    };

    void restoreSession();
    return () => { active = false; };
  }, []);

  const signOut = async () => {
    const response = await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
    });
    if (!(response.headers.get("content-type") || "").toLowerCase().includes("application/json")) {
      throw new Error("The authentication service did not confirm sign-out.");
    }
    const result = await response.json();
    if (!response.ok || !result || result.success !== true) {
      throw new Error(result.message || "Unable to sign out.");
    }
    setUser(null);
    setAuthMessage("");
  };

  if (isCheckingSession) {
    return <main className="auth-loading" role="status">Checking your sign-in…</main>;
  }
  if (!user) {
    return <Login onLogin={(account) => { setUser(account); setAuthMessage(""); }} serviceMessage={authMessage} />;
  }
  return <Workspace user={user} onLogout={signOut} onUserUpdated={(updatedUser) => setUser((current) => ({ ...current, ...updatedUser }))} />;
}

function Workspace({ user, onLogout, onUserUpdated }) {
  const [activePage, setActivePage] = useState(user.role === "project_manager" && user.projectManagerProjectIds?.length ? "Reports" : "Overview");
  const [clockNow, setClockNow] = useState(() => new Date());
  const [projects, setProjects] = useState([]);
  const [manpower, setManpower] = useState([]);
  const [manpowerTransferLog, setManpowerTransferLog] = useState([]);
  const [manpowerSearch, setManpowerSearch] = useState("");
  const [selectedManpowerPunchIds, setSelectedManpowerPunchIds] = useState([]);
  const [isDeletingManpowerSelection, setIsDeletingManpowerSelection] = useState(false);
  const [isBulkTransferOpen, setIsBulkTransferOpen] = useState(false);
  const [bulkTransferProjectId, setBulkTransferProjectId] = useState("");
  const [bulkTransferError, setBulkTransferError] = useState("");
  const [isBulkTransferringManpower, setIsBulkTransferringManpower] = useState(false);
  const [updatingProjectManagerAccessPunchId, setUpdatingProjectManagerAccessPunchId] = useState(null);
  const [deletingManpowerPunchId, setDeletingManpowerPunchId] = useState(null);
  const [transferringManpowerPunchId, setTransferringManpowerPunchId] = useState(null);
  const [transferPerson, setTransferPerson] = useState(null);
  const [transferProjectId, setTransferProjectId] = useState("");
  const [transferProjectError, setTransferProjectError] = useState("");
  const [projectManagerPerson, setProjectManagerPerson] = useState(null);
  const [projectManagerProjectId, setProjectManagerProjectId] = useState("");
  const [projectManagerError, setProjectManagerError] = useState("");
  const [assigningProjectManagerPunchId, setAssigningProjectManagerPunchId] = useState(null);
  const [reportLogPerson, setReportLogPerson] = useState(null);
  const [employeeReports, setEmployeeReports] = useState([]);
  const [isEmployeeReportsLoading, setIsEmployeeReportsLoading] = useState(false);
  const [employeeReportsError, setEmployeeReportsError] = useState("");
  const [summaryPopover, setSummaryPopover] = useState(null);
  const [projectFilter, setProjectFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [dateFromFilter, setDateFromFilter] = useState("");
  const [dateToFilter, setDateToFilter] = useState("");
  const [reports, setReports] = useState([]);
  const [selectedReportIds, setSelectedReportIds] = useState([]);
  const [isDeletingReports, setIsDeletingReports] = useState(false);
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [maxUploadBytes, setMaxUploadBytes] = useState(512 * 1024 * 1024);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [selectedReport, setSelectedReport] = useState(null);
  const [editingReport, setEditingReport] = useState(null);
  const [isSavingReport, setIsSavingReport] = useState(false);
  const [isProjectFormOpen, setIsProjectFormOpen] = useState(false);
  const [isManpowerFormOpen, setIsManpowerFormOpen] = useState(false);
  const [editingProject, setEditingProject] = useState(null);
  const [editingManpower, setEditingManpower] = useState(null);
  const [projectForm, setProjectForm] = useState({ name: "", description: "", color: "blue", managerPunchId: "" });
  const [manpowerForm, setManpowerForm] = useState({
    punchId: "",
    name: "",
    designation: "",
    projectId: "",
    projectManagerProjectIds: [],
  });
  const [projectFormError, setProjectFormError] = useState("");
  const [manpowerFormError, setManpowerFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [profileForm, setProfileForm] = useState({ displayName: user.name, currentPassword: "", newPassword: "", confirmPassword: "" });
  const [profileError, setProfileError] = useState("");
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [passwordDialog, setPasswordDialog] = useState(null);
  const [passwordForm, setPasswordForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [passwordDialogError, setPasswordDialogError] = useState("");
  const [isSavingManagedPassword, setIsSavingManagedPassword] = useState(false);
  const [form, setForm] = useState({ projectId: "", date: today, title: "", description: "" });
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [previewingUploadFile, setPreviewingUploadFile] = useState(null);
  const [isUploadConfirming, setIsUploadConfirming] = useState(false);
  const fileInput = useRef(null);
  const cameraInput = useRef(null);
  const profileMenuRef = useRef(null);
  const currentUser = user.name;
  const greetingName = currentUser.trim().split(/\s+/)[0];
  const currentHour = clockNow.getHours();
  const timeGreeting = currentHour >= 5 && currentHour < 12
    ? "Good morning"
    : currentHour >= 12 && currentHour < 17
      ? "Good afternoon"
      : "Good evening";
  const clockTime = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(clockNow);
  const clockDate = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(clockNow);
  const userInitials = currentUser.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const isAdministrator = user.role === "admin" || user.role === "super_admin";
  const isSuperUser = user.role === "super_admin";
  const isProjectManager = !isAdministrator && user.role === "project_manager" && Boolean(user.projectManagerProjectIds?.length);
  const canManageOwnPassword = ["employee", "project_manager"].includes(user.role);
  const canManageProjectReports = isAdministrator || isProjectManager;
  const projectColors = ["blue", "orange", "green", "purple"];
  const projectOptions = [
    { id: "all", name: isProjectManager ? "All assigned projects" : "All projects" },
    ...projects,
  ];
  const selectProjectFilter = (selectedProjectId) => {
    const selectedProject = projects.find((project) => String(project.id) === selectedProjectId);
    setProjectFilter(selectedProjectId === "all" ? "all" : selectedProject?.id ?? projectFilter);
  };
  const isSigningOut = useRef(false);

  useEffect(() => {
    const interval = window.setInterval(() => setClockNow(new Date()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const requestLogout = useCallback(() => {
    if (isSigningOut.current) return;
    isSigningOut.current = true;
    setIsProfileMenuOpen(false);
    onLogout().catch((error) => {
      isSigningOut.current = false;
      setNotice(error instanceof Error ? error.message : "Unable to sign out.");
      window.setTimeout(() => setNotice(""), 5000);
    });
  }, [onLogout]);

  useEffect(() => {
    let active = true;
    const loadWorkspace = async () => {
      try {
        const [projectResult, reportResult, configResult] = await Promise.all([
          apiRequest("/api/projects"),
          apiRequest(isAdministrator ? "/api/reports" : isProjectManager ? "/api/reports/managed" : "/api/reports/mine"),
          apiRequest("/api/config"),
        ]);
        const [manpowerResult, transferLogResult] = isAdministrator
          ? await Promise.all([apiRequest("/api/manpower"), apiRequest("/api/manpower/transfers")])
          : [null, null];
        if (!active) return;
        setProjects(projectResult.data);
        setReports(reportResult.data);
        if (isProjectManager) setProjectFilter("all");
        setMaxUploadBytes(configResult.maxUploadBytes);
        if (manpowerResult) setManpower(manpowerResult.data);
        if (transferLogResult) setManpowerTransferLog(transferLogResult.data);
      } catch (error) {
        if (active) setNotice(error instanceof Error ? error.message : "Unable to load project data.");
      } finally {
        if (active) setIsDataLoading(false);
      }
    };

    void loadWorkspace();
    return () => { active = false; };
  }, [isAdministrator, isProjectManager, user.projectManagerProjectIds]);

  useEffect(() => {
    const handleLogoutShortcut = (event) => {
      if ((!event.ctrlKey && !event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== "l") return;
      event.preventDefault();
      requestLogout();
    };

    window.addEventListener("keydown", handleLogoutShortcut, true);
    return () => window.removeEventListener("keydown", handleLogoutShortcut, true);
  }, [requestLogout]);

  useEffect(() => {
    const closeProfileMenu = (event) => {
      if (!profileMenuRef.current?.contains(event.target)) setIsProfileMenuOpen(false);
    };
    const handleProfileMenuKey = (event) => {
      if (event.key === "Escape") setIsProfileMenuOpen(false);
    };

    document.addEventListener("pointerdown", closeProfileMenu);
    window.addEventListener("keydown", handleProfileMenuKey);
    return () => {
      document.removeEventListener("pointerdown", closeProfileMenu);
      window.removeEventListener("keydown", handleProfileMenuKey);
    };
  }, []);

  const hasInvalidDateRange = Boolean(dateFromFilter && dateToFilter && dateFromFilter > dateToFilter);
  const matchingReports = useMemo(() => reports.filter((report) => {
    const fileNames = report.files?.map((file) => file.fileName).join(" ") || report.fileName;
    const text = `${report.title} ${report.description} ${report.user} ${report.projectName || ""} ${fileNames}`.toLowerCase();
    const searchMatches = !search.trim() || text.includes(search.trim().toLowerCase());
    const dateMatches = !hasInvalidDateRange
      && (!dateFromFilter || report.date >= dateFromFilter)
      && (!dateToFilter || report.date <= dateToFilter);
    return searchMatches && dateMatches;
  }), [reports, search, dateFromFilter, dateToFilter, hasInvalidDateRange]);
  const filteredReports = useMemo(() => matchingReports.filter((report) =>
    projectFilter === "all" || report.projectId === projectFilter,
  ), [matchingReports, projectFilter]);
  const allReportsSelected = reports.length > 0 && reports.every((report) => selectedReportIds.includes(report.id));
  const projectReportCounts = useMemo(() => {
    const counts = new Map(projects.map((project) => [project.id, 0]));
    matchingReports.forEach((report) => counts.set(report.projectId, (counts.get(report.projectId) || 0) + 1));
    return counts;
  }, [projects, matchingReports]);

  useEffect(() => {
    const handleSelectAllReports = (event) => {
      if ((!event.ctrlKey && !event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== "a") return;
      if (!isSuperUser || reports.length === 0 || !["Overview", "Reports"].includes(activePage) || document.querySelector('[role="dialog"]')) return;
      const target = event.target;
      if (target instanceof HTMLElement
        && (target.isContentEditable || target.closest('input:not([type="checkbox"]):not([type="radio"]), textarea, select, [role="textbox"]'))) {
        return;
      }

      event.preventDefault();
      setSelectedReportIds(reports.map((report) => report.id));
    };

    window.addEventListener("keydown", handleSelectAllReports);
    return () => window.removeEventListener("keydown", handleSelectAllReports);
  }, [activePage, isSuperUser, reports]);

  const filteredManpower = useMemo(() => manpower.filter((person) =>
    `${person.punchId} ${person.name} ${person.designation}`.toLowerCase().includes(manpowerSearch.trim().toLowerCase()),
  ), [manpower, manpowerSearch]);

  const openUpload = () => {
    setForm({
      projectId: isProjectManager
        ? String(user.projectManagerProjectIds[0])
        : projectFilter === "all" ? "" : projectFilter,
      date: today,
      title: "",
      description: "",
    });
    setSelectedFiles([]);
    setIsUploadConfirming(false);
    setPreviewingUploadFile(null);
    if (fileInput.current) fileInput.current.value = "";
    if (cameraInput.current) cameraInput.current.value = "";
    setIsUploadOpen(true);
  };

  const submitProfileSettings = async (event) => {
    event.preventDefault();
    if (!isSuperUser) return;
    setProfileError("");
    if (profileForm.newPassword !== profileForm.confirmPassword && (profileForm.newPassword || profileForm.confirmPassword)) {
      setProfileError("New password and confirmation do not match.");
      return;
    }

    setIsSavingProfile(true);
    try {
      const result = await apiRequest("/api/auth/profile", {
        method: "PATCH",
        body: {
          displayName: profileForm.displayName,
          currentPassword: profileForm.currentPassword,
          newPassword: profileForm.newPassword,
        },
      });
      onUserUpdated({ name: result.user.name });
      setProfileForm({ displayName: result.user.name, currentPassword: "", newPassword: "", confirmPassword: "" });
      setNotice("Administrator account updated.");
      window.setTimeout(() => setNotice(""), 5000);
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "Unable to update administrator account.");
    } finally {
      setIsSavingProfile(false);
    }
  };

  const openPasswordDialog = (person = null) => {
    setIsProfileMenuOpen(false);
    setPasswordDialog(person ? { kind: "managed", person } : { kind: "self" });
    setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
    setPasswordDialogError("");
  };

  const closePasswordDialog = () => {
    if (isSavingManagedPassword) return;
    setPasswordDialog(null);
    setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
    setPasswordDialogError("");
  };

  const submitPasswordDialog = async (event) => {
    event.preventDefault();
    if (!passwordDialog || isSavingManagedPassword) return;
    const isSelf = passwordDialog.kind === "self";
    if ((isSelf && !canManageOwnPassword) || (!isSelf && !isSuperUser)) return;
    setPasswordDialogError("");
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordDialogError("New password and confirmation do not match.");
      return;
    }

    setIsSavingManagedPassword(true);
    try {
      if (isSelf) {
        await apiRequest("/api/auth/password", {
          method: "PATCH",
          body: {
            currentPassword: passwordForm.currentPassword,
            newPassword: passwordForm.newPassword,
          },
        });
        setNotice("Your sign-in password has been updated. Other sessions were signed out.");
      } else {
        const { person } = passwordDialog;
        await apiRequest(`/api/manpower/${encodeURIComponent(person.punchId)}/password`, {
          method: "PATCH",
          body: { newPassword: passwordForm.newPassword },
        });
        setManpower((items) => items.map((item) => item.punchId === person.punchId ? { ...item, passwordSet: true } : item));
        setNotice(`${person.name}'s password was reset. Their existing sessions were signed out.`);
      }
      setPasswordDialog(null);
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      window.setTimeout(() => setNotice(""), 7000);
    } catch (error) {
      setPasswordDialogError(error instanceof Error ? error.message : "Unable to update this password.");
    } finally {
      setIsSavingManagedPassword(false);
    }
  };

  const addSelectedFiles = (fileList) => {
    const incoming = Array.from(fileList || []);
    if (incoming.length === 0) return;
    setSelectedFiles((current) => {
      const knownFiles = new Set(current.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
      const next = [...current];
      for (const file of incoming) {
        const key = `${file.name}:${file.size}:${file.lastModified}`;
        if (!knownFiles.has(key)) {
          knownFiles.add(key);
          next.push(file);
        }
      }
      return next;
    });
    setIsUploadConfirming(false);
  };

  const openProjectForm = (project = null) => {
    if (!isAdministrator) return;
    setEditingProject(project);
    setProjectForm(project
      ? { name: project.name, description: project.description || "", color: project.color, managerPunchId: project.managerPunchId || "" }
      : { name: "", description: "", color: projectColors[projects.length % projectColors.length], managerPunchId: "" });
    setProjectFormError("");
    setIsProjectFormOpen(true);
  };

  const submitProject = async (event) => {
    event.preventDefault();
    if (!isAdministrator) return;
    const name = projectForm.name.trim();
    if (!name) return;
    const alreadyExists = projects.some((project) =>
      project.id !== editingProject?.id && project.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
    );
    if (alreadyExists) {
      setProjectFormError("A project with this name already exists.");
      return;
    }

    const { managerPunchId, ...projectDetails } = projectForm;
    let savedProject = null;
    try {
      const result = await apiRequest(
        editingProject ? `/api/projects/${editingProject.id}` : "/api/projects",
        {
          method: editingProject ? "PUT" : "POST",
          body: { ...projectDetails, name },
        },
      );
      savedProject = result.data;
      if (editingProject) {
        setProjects((items) => items.map((project) => project.id === editingProject.id
          ? { ...result.data, reportCount: project.reportCount, managerName: project.managerName, managerPunchId: project.managerPunchId }
          : project));
      } else {
        setProjects((items) => [...items, result.data].sort((a, b) => a.name.localeCompare(b.name)));
      }

      if (isSuperUser && managerPunchId !== (editingProject?.managerPunchId || "")) {
        await appointProjectManager(savedProject, managerPunchId || null);
      }
      setNotice(editingProject ? "Project details updated." : "Project added. You can now upload reports to it.");
      setIsProjectFormOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save the project.";
      if (savedProject && !editingProject) {
        // The project was created but the manager appointment failed; switch to editing it.
        setEditingProject(savedProject);
      }
      setProjectFormError(savedProject ? `Project saved, but the Project Manager was not assigned: ${message}` : message);
    }
    window.setTimeout(() => setNotice(""), 5000);
  };

  const syncProjectManagerAssignment = (projectId, managerPunchId, managerName) => {
    const id = String(projectId);
    setProjects((items) => items.map((project) => project.id === id
      ? { ...project, managerName: managerPunchId ? managerName : null, managerPunchId }
      : project));
    setManpower((items) => items.map((person) => {
      const assignments = (person.projectManagerProjects || []).filter((project) => project.id !== id);
      if (person.punchId === managerPunchId) assignments.push({ id, name: managerName });
      return { ...person, projectManagerProjects: assignments };
    }));
  };

  const syncProjectManagerAssignments = (manager, previousAssignments, nextAssignments) => {
    const previousIds = new Set(previousAssignments.map((project) => String(project.id)));
    const nextById = new Map(nextAssignments.map((project) => [String(project.id), project]));
    const affectedIds = new Set([...previousIds, ...nextById.keys()]);
    setProjects((items) => items.map((project) => {
      if (!affectedIds.has(project.id)) return project;
      const assignment = nextById.get(project.id);
      return {
        ...project,
        managerName: assignment ? manager.name : null,
        managerPunchId: assignment ? manager.punchId : null,
      };
    }));
  };

  const toggleProjectManagerAccess = async (person) => {
    if (!isSuperUser || updatingProjectManagerAccessPunchId || person.adminAccess) return false;
    const appoint = !person.isProjectManager;
    const assignedProjects = person.projectManagerProjects || [];
    const prompt = appoint
      ? `Appoint ${person.name} as a Project Manager? You can then assign them to one or more projects.`
      : `Remove Project Manager appointment from ${person.name}? This also removes their assignments to ${assignedProjects.length} project${assignedProjects.length === 1 ? "" : "s"}.`;
    if (!window.confirm(prompt)) return false;

    setUpdatingProjectManagerAccessPunchId(person.punchId);
    let succeeded = false;
    try {
      const result = await apiRequest(`/api/manpower/${encodeURIComponent(person.punchId)}/project-manager-access`, {
        method: "PATCH",
        body: { projectManagerAccess: appoint },
      });
      setManpower((items) => items.map((item) => item.punchId === person.punchId
        ? { ...item, ...result.data, projectManagerProjects: result.data.projectManagerProjects || [] }
        : item));
      if (!appoint) {
        for (const project of assignedProjects) {
          syncProjectManagerAssignment(project.id, null, null);
        }
      }
      setNotice(`${person.name} ${appoint ? "appointed as Project Manager" : "Project Manager appointment removed"}.`);
      succeeded = true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to update Project Manager appointment.");
    } finally {
      setUpdatingProjectManagerAccessPunchId(null);
    }
    window.setTimeout(() => setNotice(""), 5000);
    return succeeded;
  };

  const appointProjectManager = async (project, managerPunchId) => {
    const result = await apiRequest(`/api/projects/${encodeURIComponent(project.id)}/manager`, {
      method: "PATCH",
      body: { punchId: managerPunchId },
    });
    syncProjectManagerAssignment(project.id, result.data.managerPunchId, result.data.managerName);
    return result.data;
  };

  const openManpowerForm = (person = null) => {
    if (!isAdministrator) return;
    setEditingManpower(person);
    setManpowerForm(person
      ? {
        punchId: person.punchId,
        name: person.name,
        designation: person.designation,
        projectId: person.projectId || "",
        projectManagerProjectIds: (person.projectManagerProjects || []).map((project) => String(project.id)),
      }
      : { punchId: "", name: "", designation: "", projectId: "", projectManagerProjectIds: [] });
    setManpowerFormError("");
    setIsManpowerFormOpen(true);
  };

  const submitManpower = async (event) => {
    event.preventDefault();
    if (!isAdministrator) return;
    const punchId = manpowerForm.punchId.trim();
    const name = manpowerForm.name.trim();
    const designation = manpowerForm.designation.trim();
    if (!/^\d{3,10}$/.test(punchId)) {
      setManpowerFormError("Punch ID must contain 3 to 10 digits.");
      return;
    }
    if (!name || !designation) return;
    const duplicateId = manpower.some((person) =>
      person.punchId !== editingManpower?.punchId && person.punchId === punchId,
    );
    if (duplicateId) {
      setManpowerFormError("That Punch ID is already in the manpower list.");
      return;
    }

    let profileSaved = false;
    let accountCreated = false;
    try {
      const result = await apiRequest(
        editingManpower
          ? `/api/manpower/${encodeURIComponent(editingManpower.punchId)}`
          : "/api/manpower",
        {
          method: editingManpower ? "PUT" : "POST",
          body: { punchId, name, designation },
        },
      );
      if (editingManpower) {
        profileSaved = true;
        setEditingManpower(result.data);
        setManpower((items) => items.map((person) => person.punchId === editingManpower.punchId ? result.data : person));
        if (editingManpower.isProjectManager) {
          syncProjectManagerAssignments(
            result.data,
            editingManpower.projectManagerProjects || [],
            result.data.projectManagerProjects || [],
          );
        }

        let updatedAccount = result.data;
        if (isSuperUser && editingManpower.isProjectManager && editingManpower.active) {
          const assignments = await apiRequest(`/api/manpower/${encodeURIComponent(updatedAccount.punchId)}/project-manager-assignments`, {
            method: "PUT",
            body: { projectIds: manpowerForm.projectManagerProjectIds.map(Number) },
          });
          updatedAccount = assignments.data;
          syncProjectManagerAssignments(
            updatedAccount,
            editingManpower.projectManagerProjects || [],
            updatedAccount.projectManagerProjects || [],
          );
        } else if (isSuperUser && !editingManpower.adminAccess
          && String(editingManpower.projectId || "") !== manpowerForm.projectId) {
          const assignment = await apiRequest(`/api/manpower/${encodeURIComponent(updatedAccount.punchId)}/project`, {
            method: "PATCH",
            body: { projectId: manpowerForm.projectId ? Number(manpowerForm.projectId) : null },
          });
          updatedAccount = { ...updatedAccount, ...assignment.data };
        }
        setEditingManpower(updatedAccount);
        setManpower((items) => items.map((person) => person.punchId === updatedAccount.punchId ? updatedAccount : person));
        setNotice(isSuperUser ? "Manpower account and project assignments updated." : "Manpower account updated.");
      } else {
        accountCreated = true;
        setManpower((items) => [...items, result.data].sort((a, b) => a.name.localeCompare(b.name)));
        if (isSuperUser && manpowerForm.projectId) {
          setEditingManpower(result.data);
          const assignment = await apiRequest(`/api/manpower/${encodeURIComponent(result.data.punchId)}/project`, {
            method: "PATCH",
            body: { projectId: Number(manpowerForm.projectId) },
          });
          const updatedAccount = { ...result.data, ...assignment.data };
          setManpower((items) => items.map((person) => person.punchId === updatedAccount.punchId ? updatedAccount : person));
          setNotice("Manpower account added and assigned to project.");
        } else {
          setNotice("Manpower account added.");
        }
      }
      setIsManpowerFormOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save the manpower account.";
      setManpowerFormError(accountCreated
        ? `Account was added, but its project assignment could not be updated: ${message}`
        : profileSaved
        ? `Account details were saved, but project assignments could not be updated: ${message}`
        : message);
    }
    window.setTimeout(() => setNotice(""), 5000);
  };

  const toggleManpowerActive = async (person) => {
    if (!isAdministrator) return;
    try {
      const result = await apiRequest(`/api/manpower/${encodeURIComponent(person.punchId)}/active`, {
        method: "PATCH",
        body: { active: !person.active },
      });
      setManpower((items) => items.map((item) => item.punchId === person.punchId ? { ...item, ...result.data } : item));
      if (person.active) {
        for (const project of person.projectManagerProjects || []) {
          syncProjectManagerAssignment(project.id, null, null);
        }
      }
      setNotice(`${person.name} marked ${person.active ? "inactive" : "active"}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to update the manpower account.");
    }
    window.setTimeout(() => setNotice(""), 5000);
  };

  const openEmployeeReportLog = async (person) => {
    if (!isAdministrator) return;
    setReportLogPerson(person);
    setEmployeeReports([]);
    setEmployeeReportsError("");
    setIsEmployeeReportsLoading(true);
    try {
      const result = await apiRequest(`/api/reports/by-uploader/${encodeURIComponent(person.punchId)}`);
      setEmployeeReports(result.data);
    } catch (error) {
      setEmployeeReportsError(error instanceof Error ? error.message : "Unable to load this employee's reports.");
    } finally {
      setIsEmployeeReportsLoading(false);
    }
  };

  const submitReport = (event) => {
    event.preventDefault();
    const error = validateReportFiles(selectedFiles, maxUploadBytes);
    if (error) {
      setNotice(error);
      return;
    }
    setIsUploadConfirming(true);
  };

  const confirmReportUpload = async () => {
    const error = validateReportFiles(selectedFiles, maxUploadBytes);
    if (error) {
      setIsUploadConfirming(false);
      setNotice(error);
      return;
    }
    const body = new FormData();
    body.append("projectId", form.projectId);
    body.append("reportDate", form.date);
    body.append("title", form.title);
    body.append("description", form.description);
    for (const file of selectedFiles) body.append("files", file);
    setIsUploading(true);
    try {
      const result = await apiRequest("/api/reports", { method: "POST", body });
      setReports((items) => [result.data, ...items]);
      setProjectFilter(form.projectId);
      setIsUploadOpen(false);
      setSelectedFiles([]);
      setIsUploadConfirming(false);
      setPreviewingUploadFile(null);
      setNotice(result.notification === "failed"
        ? "Report was uploaded, but its email notification failed."
        : isAdministrator
          ? "Report uploaded and shared with the project."
          : "Report uploaded and added to your report log.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to upload the report.");
    } finally {
      setIsUploading(false);
    }
    window.setTimeout(() => setNotice(""), 5000);
  };

  const saveReportEdit = async (report, body) => {
    if (!canManageProjectReports || isSavingReport) return "You do not have permission to edit this report.";
    setIsSavingReport(true);
    let resultMessage = "";
    try {
      const result = await apiRequest(`/api/reports/${encodeURIComponent(report.id)}`, { method: "PATCH", body });
      setReports((items) => items.map((item) => item.id === report.id ? result.data : item));
      setSelectedReport((current) => current?.id === report.id ? result.data : current);
      setEditingReport(null);
      setNotice(result.cleanupPendingCount
        ? "Report updated, but one or more previous evidence files could not be removed. Check server logs."
        : "Report updated.");
    } catch (error) {
      resultMessage = error instanceof Error ? error.message : "Unable to update the report.";
      setNotice(resultMessage);
    } finally {
      setIsSavingReport(false);
    }
    window.setTimeout(() => setNotice(""), 5000);
    return resultMessage;
  };

  const downloadReport = (report, attachment = null) => {
    const link = document.createElement("a");
    if (attachment) {
      link.href = attachment.id
        ? `/api/reports/${encodeURIComponent(report.id)}/files/${encodeURIComponent(attachment.id)}`
        : `/api/reports/${encodeURIComponent(report.id)}/file`;
      link.download = attachment.fileName || report.fileName;
    } else {
      link.href = `/api/reports/${encodeURIComponent(report.id)}/download`;
    }
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const exportProjectReports = (project) => {
    if (!canManageProjectReports) return;
    const link = document.createElement("a");
    link.href = `/api/reports/project/${encodeURIComponent(project.id)}/export`;
    link.download = `${project.name}-reports.zip`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const exportAllProjectReports = () => {
    if (!canManageProjectReports) return;
    const link = document.createElement("a");
    link.href = "/api/reports/projects/export";
    link.download = isProjectManager ? "assigned-projects-reports.zip" : "all-projects-reports.zip";
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const archiveReport = async (report) => {
    if (!canManageProjectReports || !window.confirm(`Archive "${report.title}"?`)) return;
    try {
      await apiRequest(`/api/reports/${encodeURIComponent(report.id)}/archive`, { method: "POST" });
      setReports((items) => items.filter((item) => item.id !== report.id));
      setSelectedReportIds((items) => items.filter((id) => id !== report.id));
      setNotice("Report archived.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to archive the report.");
    }
    window.setTimeout(() => setNotice(""), 5000);
  };

  const toggleReportSelection = (reportId, selected) => {
    if (!isSuperUser) return;
    setSelectedReportIds((current) => selected
      ? [...new Set([...current, reportId])]
      : current.filter((id) => id !== reportId));
  };

  const toggleSelectAllReports = () => {
    if (!isSuperUser) return;
    setSelectedReportIds(allReportsSelected ? [] : reports.map((report) => report.id));
  };

  const deleteSelectedReports = async () => {
    if (!isSuperUser || isDeletingReports || selectedReportIds.length === 0) return;
    const reportIds = [...selectedReportIds];
    if (!window.confirm(`Permanently delete ${reportIds.length} selected report${reportIds.length === 1 ? "" : "s"} and all attached evidence files? This cannot be undone.`)) return;

    setIsDeletingReports(true);
    let deletedCount = 0;
    let cleanupPendingCount = 0;
    let failureMessage = "";
    try {
      for (let offset = 0; offset < reportIds.length; offset += 100) {
        const batch = reportIds.slice(offset, offset + 100);
        try {
          const result = await apiRequest("/api/reports/selected", {
            method: "DELETE",
            body: { ids: batch },
          });
          const removedIds = new Set(batch);
          deletedCount += result.data.deletedCount;
          cleanupPendingCount += result.data.cleanupPendingCount;
          setReports((items) => items.filter((report) => !removedIds.has(report.id)));
          setSelectedReportIds((items) => items.filter((id) => !removedIds.has(id)));
          setSelectedReport((current) => current && removedIds.has(current.id) ? null : current);
        } catch (error) {
          failureMessage = error instanceof Error ? error.message : "Unable to delete the selected reports.";
          break;
        }
      }

      if (failureMessage) {
        setNotice(deletedCount
          ? `${deletedCount} reports were deleted before the remaining deletion failed: ${failureMessage}`
          : failureMessage);
      } else {
        setNotice(cleanupPendingCount
          ? `${deletedCount} report${deletedCount === 1 ? "" : "s"} deleted; ${cleanupPendingCount} evidence file${cleanupPendingCount === 1 ? "" : "s"} could not be removed. Check server logs.`
          : `${deletedCount} report${deletedCount === 1 ? "" : "s"} and attached evidence permanently deleted.`);
      }
    } finally {
      setIsDeletingReports(false);
    }
    window.setTimeout(() => setNotice(""), 7000);
  };

  const deleteManpowerAccount = async (person) => {
    if (!isSuperUser || deletingManpowerPunchId) return;
    const accountType = person.adminAccess ? "appointed administrator" : "employee";
    if (!window.confirm(`Permanently delete ${accountType} ${person.name} (Punch ID ${person.punchId})? Their submitted reports will remain with uploader attribution, but their account and sign-in sessions will be removed. This cannot be undone.`)) return;

    setDeletingManpowerPunchId(person.punchId);
    try {
      const result = await apiRequest(`/api/manpower/${encodeURIComponent(person.punchId)}`, { method: "DELETE" });
      setManpower((items) => items.filter((item) => item.punchId !== person.punchId));
      setSelectedManpowerPunchIds((ids) => ids.filter((id) => id !== person.punchId));
      for (const project of person.projectManagerProjects || []) {
        syncProjectManagerAssignment(project.id, null, null);
      }
      if (reportLogPerson?.punchId === person.punchId) {
        setReportLogPerson(null);
        setEmployeeReports([]);
      }
      setNotice(`${result.data.name} deleted. ${result.data.preservedReportCount} submitted report${result.data.preservedReportCount === 1 ? "" : "s"} and uploader attribution preserved.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to delete the manpower account.");
    } finally {
      setDeletingManpowerPunchId(null);
    }
    window.setTimeout(() => setNotice(""), 7000);
  };

  const toggleManpowerSelection = (punchId, selected) => {
    setSelectedManpowerPunchIds((ids) => selected
      ? ids.includes(punchId) ? ids : [...ids, punchId]
      : ids.filter((id) => id !== punchId));
  };

  const toggleVisibleManpowerSelection = (people, selected) => {
    const visiblePunchIds = new Set(people.map((person) => person.punchId));
    setSelectedManpowerPunchIds((ids) => selected
      ? [...new Set([...ids, ...visiblePunchIds])]
      : ids.filter((id) => !visiblePunchIds.has(id)));
  };

  const deleteSelectedManpowerAccounts = async () => {
    if (!isSuperUser || isDeletingManpowerSelection || deletingManpowerPunchId) return;
    const selectedPeople = manpower.filter((person) => selectedManpowerPunchIds.includes(person.punchId));
    if (!selectedPeople.length) return;
    if (!window.confirm(`Permanently delete ${selectedPeople.length} selected manpower account${selectedPeople.length === 1 ? "" : "s"}? Submitted reports and uploader attribution will be preserved. This cannot be undone.`)) return;

    setIsDeletingManpowerSelection(true);
    const deletedPeople = [];
    const failures = [];
    let preservedReportCount = 0;
    try {
      for (const person of selectedPeople) {
        try {
          const result = await apiRequest(`/api/manpower/${encodeURIComponent(person.punchId)}`, { method: "DELETE" });
          deletedPeople.push(person);
          preservedReportCount += result.data.preservedReportCount;
        } catch (error) {
          failures.push(`${person.name} (${person.punchId}): ${error instanceof Error ? error.message : "Unable to delete this account."}`);
        }
      }

      const deletedPunchIds = new Set(deletedPeople.map((person) => person.punchId));
      if (deletedPeople.length) {
        setManpower((items) => items.filter((person) => !deletedPunchIds.has(person.punchId)));
        setSelectedManpowerPunchIds((ids) => ids.filter((id) => !deletedPunchIds.has(id)));
        for (const person of deletedPeople) {
          for (const project of person.projectManagerProjects || []) {
            syncProjectManagerAssignment(project.id, null, null);
          }
        }
        if (reportLogPerson && deletedPunchIds.has(reportLogPerson.punchId)) {
          setReportLogPerson(null);
          setEmployeeReports([]);
        }
      }

      const summary = `${deletedPeople.length} account${deletedPeople.length === 1 ? "" : "s"} deleted; ${preservedReportCount} submitted report${preservedReportCount === 1 ? "" : "s"} preserved.`;
      setNotice(failures.length ? `${summary} ${failures.length} failed: ${failures.join(" ")}` : summary);
    } finally {
      setIsDeletingManpowerSelection(false);
    }
    window.setTimeout(() => setNotice(""), 7000);
  };

  const openProjectTransfer = (person) => {
    if (!isSuperUser) return;
    setTransferPerson(person);
    setTransferProjectId(person.projectId || "");
    setTransferProjectError("");
  };

  const transferManpower = async (event) => {
    event.preventDefault();
    if (!isSuperUser || !transferPerson || transferringManpowerPunchId) return;
    const projectId = transferProjectId ? Number(transferProjectId) : null;
    setTransferringManpowerPunchId(transferPerson.punchId);
    setTransferProjectError("");
    try {
      const result = await apiRequest(`/api/manpower/${encodeURIComponent(transferPerson.punchId)}/project`, {
        method: "PATCH",
        body: { projectId },
      });
      setManpower((items) => items.map((person) => person.punchId === result.data.punchId
        ? { ...person, projectId: result.data.projectId, projectName: result.data.projectName }
        : person));
      if (result.data.transferLog) setManpowerTransferLog((items) => [result.data.transferLog, ...items].slice(0, 100));
      setNotice(`${result.data.name} ${result.data.projectName ? `transferred to ${result.data.projectName}` : "removed from project assignment"}.`);
      setTransferPerson(null);
    } catch (error) {
      setTransferProjectError(error instanceof Error ? error.message : "Unable to transfer this employee.");
    } finally {
      setTransferringManpowerPunchId(null);
    }
    window.setTimeout(() => setNotice(""), 5000);
  };

  const openBulkProjectTransfer = () => {
    if (!isSuperUser || !selectedManpowerPunchIds.length || isBulkTransferringManpower || transferringManpowerPunchId) return;
    setBulkTransferProjectId("");
    setBulkTransferError("");
    setIsBulkTransferOpen(true);
  };

  const transferSelectedManpower = async (event) => {
    event.preventDefault();
    if (!isSuperUser || isBulkTransferringManpower || transferringManpowerPunchId) return;
    const selectedPeople = manpower.filter((person) => selectedManpowerPunchIds.includes(person.punchId));
    if (!selectedPeople.length) return;

    const projectId = bulkTransferProjectId ? Number(bulkTransferProjectId) : null;
    const unchangedPeople = selectedPeople.filter((person) => String(person.projectId || "") === String(projectId || ""));
    const peopleToTransfer = selectedPeople.filter((person) => !unchangedPeople.includes(person));
    if (!peopleToTransfer.length) {
      setNotice("All selected accounts already have that project assignment.");
      setSelectedManpowerPunchIds([]);
      setIsBulkTransferOpen(false);
      return;
    }

    setIsBulkTransferringManpower(true);
    setBulkTransferError("");
    const transferredPeople = [];
    const failures = [];
    try {
      for (const person of peopleToTransfer) {
        try {
          const result = await apiRequest(`/api/manpower/${encodeURIComponent(person.punchId)}/project`, {
            method: "PATCH",
            body: { projectId },
          });
          transferredPeople.push(result.data);
        } catch (error) {
          failures.push(`${person.name} (${person.punchId}): ${error instanceof Error ? error.message : "Unable to transfer this account."}`);
        }
      }

      const handledPunchIds = new Set([
        ...unchangedPeople.map((person) => person.punchId),
        ...transferredPeople.map((person) => person.punchId),
      ]);
      if (transferredPeople.length) {
        const newLogEntries = transferredPeople.map((person) => person.transferLog).filter(Boolean);
        if (newLogEntries.length) setManpowerTransferLog((items) => [...newLogEntries.reverse(), ...items].slice(0, 100));
        const transferredByPunchId = new Map(transferredPeople.map((person) => [person.punchId, person]));
        setManpower((items) => items.map((person) => {
          const updated = transferredByPunchId.get(person.punchId);
          return updated
            ? { ...person, projectId: updated.projectId, projectName: updated.projectName }
            : person;
        }));
      }
      setSelectedManpowerPunchIds((ids) => ids.filter((id) => !handledPunchIds.has(id)));
      if (!failures.length) setIsBulkTransferOpen(false);

      const destinationName = projects.find((project) => String(project.id) === String(projectId))?.name || "Unassigned";
      const summary = `${transferredPeople.length} account${transferredPeople.length === 1 ? "" : "s"} transferred to ${destinationName}.`;
      setNotice(failures.length ? `${summary} ${failures.length} failed; review the details in the transfer dialog.` : summary);
      setBulkTransferError(failures.length ? `${failures.length} transfer${failures.length === 1 ? "" : "s"} failed: ${failures.join(" ")}` : "");
    } finally {
      setIsBulkTransferringManpower(false);
    }
    window.setTimeout(() => setNotice(""), 7000);
  };

  const openProjectManagerAssignment = (person) => {
    if (!isSuperUser || !person.active || !person.isProjectManager) return;
    const availableProjects = projects.filter((project) =>
      !project.managerPunchId || project.managerPunchId === person.punchId,
    );
    setProjectManagerPerson(person);
    setProjectManagerProjectId(availableProjects[0]?.id || "");
    setProjectManagerError("");
  };

  const assignProjectManager = async (event) => {
    event.preventDefault();
    if (!isSuperUser || !projectManagerPerson || !projectManagerProjectId || assigningProjectManagerPunchId) return;

    setAssigningProjectManagerPunchId(projectManagerPerson.punchId);
    setProjectManagerError("");
    try {
      const result = await apiRequest(`/api/manpower/${encodeURIComponent(projectManagerPerson.punchId)}/project-manager`, {
        method: "PATCH",
        body: { projectId: Number(projectManagerProjectId) },
      });
      setManpower((items) => items.map((person) => person.punchId === result.data.punchId
        ? { ...person, ...result.data }
        : person));
      const assignedProject = projects.find((project) => project.id === projectManagerProjectId);
      syncProjectManagerAssignment(projectManagerProjectId, result.data.punchId, assignedProject?.name || "");
      setNotice(`${result.data.name} assigned as Project Manager for ${assignedProject?.name || "the project"}.`);
      setProjectManagerPerson(null);
    } catch (error) {
      setProjectManagerError(error instanceof Error ? error.message : "Unable to assign this Project Manager.");
    } finally {
      setAssigningProjectManagerPunchId(null);
    }
    window.setTimeout(() => setNotice(""), 5000);
  };

  const deleteProject = async (project) => {
    if (!isAdministrator) return;
    const reportCount = Number(project.reportCount ?? 0);
    const reportNote = reportCount > 0
      ? ` This project has ${reportCount} report${reportCount === 1 ? "" : "s"} (including archived reports) and cannot be deleted.`
      : " This project has no reports.";
    if (!window.confirm(`Delete "${project.name}"?${reportNote}`)) return;
    try {
      await apiRequest(`/api/projects/${encodeURIComponent(project.id)}`, { method: "DELETE" });
      setProjects((items) => items.filter((item) => item.id !== project.id));
      setManpower((items) => items.map((person) => ({
        ...person,
        projectManagerProjects: (person.projectManagerProjects || []).filter((item) => item.id !== project.id),
        ...(person.projectId === project.id ? { projectId: null, projectName: null } : {}),
      })));
      setProjectFilter((current) => current === project.id ? "all" : current);
      setNotice("Project deleted.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to delete the project.");
    }
    window.setTimeout(() => setNotice(""), 5000);
  };

  const navigate = (page) => {
    if (page === "Manpower" && !isAdministrator) return;
    if ((page === "Reports" || page === "Projects") && !canManageProjectReports) return;
    if (page === "Projects" && !isAdministrator) return;
    if (page === "Settings" && !isSuperUser) return;
    if (page === "Settings") {
      if (activePage !== "Settings") {
        setProfileForm({ displayName: currentUser, currentPassword: "", newPassword: "", confirmPassword: "" });
        setProfileError("");
      }
    } else if (activePage === "Settings") {
      setProfileForm({ displayName: currentUser, currentPassword: "", newPassword: "", confirmPassword: "" });
      setProfileError("");
    }
    setActivePage(page);
    setMobileNavOpen(false);
    setIsProfileMenuOpen(false);
    if (page === "Projects") setProjectFilter("all");
  };

  const openFullReportLog = () => {
    if (!summaryPopover) return;
    if (canManageProjectReports) setActivePage("Reports");
    setProjectFilter(isProjectManager
      ? "all"
      : summaryPopover.kind === "project" ? summaryPopover.projectId : "all");
    setSearch("");
    setDateFromFilter(summaryPopover.kind === "today" ? today : "");
    setDateToFilter(summaryPopover.kind === "today" ? today : "");
    setSummaryPopover(null);
    window.requestAnimationFrame(() => {
      const reportLog = document.getElementById("report-log");
      reportLog?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start",
      });
    });
  };

  const projectsWithReports = projects;
  const summaryPopoverReports = useMemo(() => {
    if (!summaryPopover || summaryPopover.kind === "projects") return [];
    if (summaryPopover.kind === "today") return reports.filter((report) => report.date === today);
    if (summaryPopover.kind === "project") return reports.filter((report) => report.projectId === summaryPopover.projectId);
    return reports;
  }, [reports, summaryPopover]);
  const summaryPopoverProject = summaryPopover?.kind === "project"
    ? projects.find((project) => project.id === summaryPopover.projectId)
    : null;

  return (
    <div className="app-shell">
      {mobileNavOpen && <button className="mobile-backdrop" aria-label="Close menu" onClick={() => setMobileNavOpen(false)} />}
      <aside className={`sidebar ${mobileNavOpen ? "sidebar-open" : ""}`}>
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); navigate("Overview"); }}>
          <img className="brand-logo" src="/concord-logo.png" alt="Concord logo" />
          <span className="brand-name">CSC Feed</span>
        </a>

        <div className="nav-label">WORKSPACE</div>
        <nav className="main-nav" aria-label="Main navigation">
          <button className={`nav-item ${activePage === "Overview" ? "nav-active" : ""}`} onClick={() => navigate("Overview")}><LayoutDashboard size={18} /><span>{isAdministrator ? "Overview" : "My report log"}</span>{!isAdministrator && <span className="nav-count">{reports.length}</span>}</button>
          {isAdministrator && <>
            <button className={`nav-item ${activePage === "Reports" ? "nav-active" : ""}`} onClick={() => navigate("Reports")}><FileText size={18} /><span>Reports</span><span className="nav-count">{reports.length}</span></button>
            <button className={`nav-item ${activePage === "Projects" ? "nav-active" : ""}`} onClick={() => navigate("Projects")}><FolderKanban size={18} /><span>Projects</span></button>
          </>}
          {isProjectManager && <button className={`nav-item ${activePage === "Reports" ? "nav-active" : ""}`} onClick={() => navigate("Reports")}><FileText size={18} /><span>Project reports</span><span className="nav-count">{reports.length}</span></button>}
          {isAdministrator && <button className={`nav-item ${activePage === "Manpower" ? "nav-active" : ""}`} onClick={() => navigate("Manpower")}><UsersRound size={18} /><span>Manpower</span><span className="nav-count">{manpower.length}</span></button>}
          {isSuperUser && <button className={`nav-item ${activePage === "Settings" ? "nav-active" : ""}`} onClick={() => navigate("Settings")}><Settings size={18} /><span>Settings</span></button>}
        </nav>

        {canManageProjectReports && <>
          <div className="nav-label project-nav-label">YOUR PROJECTS {isAdministrator && <button aria-label="Add project" onClick={() => openProjectForm()}><Plus size={15} /></button>}</div>
          <nav className="project-nav" aria-label="Projects">
            <label className="project-nav-select-wrap">
              <select
                className="project-nav-select"
                aria-label="Select a project"
                value={projectFilter}
                onChange={(event) => {
                  selectProjectFilter(event.target.value);
                  navigate("Reports");
                }}
              >
                <option value="all">{isProjectManager ? "All assigned projects" : "All projects"}</option>
                {projectsWithReports.length === 0 && <option value="" disabled>No projects available</option>}
                {projectsWithReports.map((project) => (
                  <option key={project.id} value={project.id}>{project.shortName}</option>
                ))}
              </select>
              <ChevronDown size={15} aria-hidden="true" />
            </label>
          </nav>
        </>}

        <div className="sidebar-bottom">
          <button className="nav-item support-link" onClick={() => setNotice("Help center integration coming soon.")}><CircleHelp size={18} /><span>Help & support</span></button>
          <div className="sidebar-user">
            <div className="user-avatar">{userInitials}</div>
            <div className="user-details"><strong>{currentUser}</strong><small>{isSuperUser ? "Super User" : isAdministrator ? "Appointed Admin" : user.role === "project_manager" ? "Project Manager" : `Punch ID ${user.punchId}`}</small></div>
            <button className="user-more" aria-label="Sign out" title="Sign out" onClick={requestLogout}><LogOut size={16} /></button>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <button className="mobile-menu" aria-label="Open menu" onClick={() => setMobileNavOpen(true)}><Menu size={21} /></button>
          <div className="breadcrumbs"><span>Workspace</span><span className="crumb-slash">/</span><strong>{activePage}</strong></div>
          <div className="topbar-actions">
            <span className="secure-label"><ShieldCheck size={15} /> Signed in</span>
            <button className="icon-button notification-button" aria-label="Notifications" onClick={() => setNotice("You’re all caught up.")}><Bell size={18} /><span className="notification-dot" /></button>
            <div className="top-profile-menu" ref={profileMenuRef}>
              <button
                className="top-user"
                type="button"
                aria-label={`Account options for ${currentUser}`}
                aria-haspopup="dialog"
                aria-expanded={isProfileMenuOpen}
                onClick={() => setIsProfileMenuOpen((open) => !open)}
              >
                <span className="user-avatar small-avatar">{userInitials}</span><ChevronDown size={15} />
              </button>
              {isProfileMenuOpen && <div className="top-profile-dropdown" role="dialog" aria-label="Account options">
                <div className="top-profile-summary"><strong>{currentUser}</strong><small>{isSuperUser ? "Super User" : isAdministrator ? "Appointed Admin" : user.role === "project_manager" ? "Project Manager" : `Punch ID ${user.punchId}`}</small></div>
                {canManageOwnPassword && <button className="top-profile-action" type="button" onClick={() => openPasswordDialog()}><KeyRound size={16} /> Password &amp; security</button>}
                {isSuperUser && <button className="top-profile-action" type="button" onClick={() => navigate("Settings")}><Settings size={16} /> Account settings</button>}
                <button className="top-profile-logout" type="button" onClick={requestLogout}><LogOut size={16} /> Sign out</button>
              </div>}
            </div>
          </div>
        </header>

        <div className="page-content">
          <ScreenTransition screenKey={isDataLoading ? "loading" : activePage}>
            {isDataLoading ? (
            <div className="auth-loading" role="status">Loading workspace data…</div>
          ) : activePage === "Manpower" && isAdministrator ? (
            <ManpowerPage
              people={filteredManpower}
              total={manpower.length}
              query={manpowerSearch}
              selectedPunchIds={selectedManpowerPunchIds}
              canEditProjectAssignments={isSuperUser}
              canDeleteAccounts={isSuperUser}
              canTransferProjects={isSuperUser}
              canManagePasswords={isSuperUser}
              isDeletingSelection={isDeletingManpowerSelection}
              isBulkTransferring={isBulkTransferringManpower}
              canAssignProjectManagers={isSuperUser}
              updatingProjectManagerAccessPunchId={updatingProjectManagerAccessPunchId}
              deletingManpowerPunchId={deletingManpowerPunchId}
              transferringManpowerPunchId={transferringManpowerPunchId}
              transferLog={manpowerTransferLog}
              onSearch={setManpowerSearch}
              onToggleSelection={toggleManpowerSelection}
              onToggleVisibleSelection={toggleVisibleManpowerSelection}
              onClearSelection={() => setSelectedManpowerPunchIds([])}
              onBulkDelete={deleteSelectedManpowerAccounts}
              onBulkTransfer={openBulkProjectTransfer}
              onSetPassword={openPasswordDialog}
              onAdd={() => openManpowerForm()}
              onEdit={openManpowerForm}
              onToggleActive={toggleManpowerActive}
              onToggleProjectManagerAccess={toggleProjectManagerAccess}
              onDeletePerson={deleteManpowerAccount}
              onTransferPerson={openProjectTransfer}
              onAssignProjectManager={openProjectManagerAssignment}
              onViewReports={openEmployeeReportLog}
            />
          ) : activePage === "Settings" && isSuperUser ? (
            <AdminSettingsPage
              profileForm={profileForm}
              setProfileForm={setProfileForm}
              profileError={profileError}
              isSaving={isSavingProfile}
              onSubmit={submitProfileSettings}
              onReset={() => {
                setProfileForm({ displayName: currentUser, currentPassword: "", newPassword: "", confirmPassword: "" });
                setProfileError("");
              }}
            />
          ) : activePage === "Projects" ? (
            <ProjectsPage
              projects={projectsWithReports}
              reports={reports}
              onSelect={(id) => { setProjectFilter(id); navigate("Reports"); }}
              onCreate={() => openProjectForm()}
              onEdit={openProjectForm}
              onDelete={deleteProject}
              canManage={isAdministrator}
              canExport={canManageProjectReports}
              onExport={exportProjectReports}
            />
          ) : (
            <>
              <section className="page-heading">
                <div>
                  <div className="eyebrow"><span className="eyebrow-dot" /> PROJECT REPORTS</div>
                  {isAdministrator && activePage === "Overview" ? <div className="overview-heading-title">
                    <h1>{timeGreeting}, {greetingName}</h1>
                    <span className="overview-clock"><Clock3 size={15} /><time dateTime={clockNow.toISOString()}>{clockTime}<span> · {clockDate}</span></time></span>
                  </div> : <h1>{isProjectManager
                    ? "Project reports"
                    : !isAdministrator ? "My report log" : activePage === "Overview" ? `Good morning, ${greetingName}` : "Reports"}</h1>}
                  <p>{isProjectManager
                    ? "Manage reports in your assigned projects."
                    : !isAdministrator ? "Review your submitted reports, organized by report date." : activePage === "Overview" ? "A clear view of updates across all your projects." : "Browse, filter, and download reports shared by your team."}</p>
                </div>
                <button className="button button-primary" onClick={openUpload}><Upload size={17} /> Upload report</button>
              </section>

              {activePage === "Overview" && <SummaryCards reports={reports} projects={projectsWithReports} onSelect={(kind) => setSummaryPopover({ kind })} />}

              {activePage === "Reports" && canManageProjectReports && <section className="project-report-folder-section" aria-labelledby="project-report-folders-title">
                <div className="section-heading">
                  <div>
                    <h2 id="project-report-folders-title">Project folders</h2>
                    <p>{isProjectManager ? "Your assigned project folders" : "Select a project folder to view its reports"}</p>
                  </div>
                  <div className="project-report-folder-actions">
                    {projectFilter !== "all" && isAdministrator && <button className="text-button" type="button" onClick={() => setProjectFilter("all")}>All project reports <ArrowUpRight size={15} /></button>}
                    {projectsWithReports.length > 0 && reports.length > 0 && <button className="button button-secondary" type="button" aria-label={isProjectManager ? "Export all assigned project reports as a ZIP" : "Export all project reports as a ZIP"} onClick={exportAllProjectReports}>
                      <ArrowDownToLine size={15} />{isProjectManager ? "Export all assigned ZIP" : "Export all ZIP"}
                    </button>}
                  </div>
                </div>
                {projectsWithReports.length ? <div className="project-report-folders">
                  {projectsWithReports.map((project) => (
                    <button
                      className={`project-report-folder ${projectFilter === project.id ? "project-report-folder-active" : ""}`}
                      key={project.id}
                      type="button"
                      aria-pressed={projectFilter === project.id}
                      aria-label={`${project.name}, ${projectReportCounts.get(project.id) || 0} reports`}
                      onClick={() => setProjectFilter(project.id)}
                    >
                      <span className={`project-report-folder-icon card-${project.color}`}><Folder size={19} /></span>
                      <span className="project-report-folder-copy"><strong>{project.name}</strong><small>{projectReportCounts.get(project.id) || 0} reports{project.managerName ? ` · Manager: ${project.managerName}` : ""}</small></span>
                    </button>
                  ))}
                </div> : <p className="project-report-folders-empty">Create a project to start organizing reports into folders.</p>}
              </section>}

              <section className="report-section" id="report-log">
                <div className="section-heading">
                  <div>
                    <h2>{!canManageProjectReports ? "Dated report log" : projectFilter === "all" ? "Recent reports" : projects.find((project) => project.id === projectFilter)?.name}</h2>
                    <p>{filteredReports.length} reports {!canManageProjectReports ? "in your history" : projectFilter !== "all" ? "in this project" : "across your projects"}</p>
                  </div>
                  {canManageProjectReports && projectFilter !== "all" && projects.find((project) => project.id === projectFilter) && <button className="button button-secondary" type="button" onClick={() => exportProjectReports(projects.find((project) => project.id === projectFilter))}><ArrowDownToLine size={15} /> Export project ZIP</button>}
                  {activePage === "Overview" && isAdministrator && <button className="text-button" onClick={() => navigate("Reports")}>View all reports <ArrowUpRight size={15} /></button>}
                </div>
                {isSuperUser && <div className="report-selection-toolbar">
                  <span>{selectedReportIds.length
                    ? `${selectedReportIds.length} selected across report filters`
                    : `Select reports to permanently clear them and their evidence files. Ctrl+A / ⌘A selects all ${reports.length} active reports.`}</span>
                  <button type="button" className="button button-secondary" onClick={toggleSelectAllReports} disabled={!reports.length || isDeletingReports}>
                    {allReportsSelected ? "Clear selection" : `Select all ${reports.length} reports`}
                  </button>
                  <button type="button" className="button button-danger" onClick={deleteSelectedReports} disabled={!selectedReportIds.length || isDeletingReports}>
                    <Trash2 size={15} />{isDeletingReports ? "Deleting…" : `Delete selected${selectedReportIds.length ? ` (${selectedReportIds.length})` : ""}`}
                  </button>
                </div>}

                <div className="filters">
                  <label className="search-field"><Search size={17} /><input aria-label="Search reports" placeholder="Search reports..." value={search} onChange={(event) => setSearch(event.target.value)} /><kbd>⌘ K</kbd></label>
                  {canManageProjectReports && <label className="select-field"><BriefcaseBusiness size={16} /><select aria-label={isProjectManager ? "Filter reports by assigned project" : "Filter by project"} value={projectFilter} onChange={(event) => selectProjectFilter(event.target.value)}>{projectOptions.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select><ChevronDown size={15} /></label>}
                  <label className="date-filter"><CalendarDays size={16} /><span>From</span><input aria-label="Filter reports from date" type="date" value={dateFromFilter} aria-invalid={hasInvalidDateRange} onChange={(event) => setDateFromFilter(event.target.value)} />{dateFromFilter && <button type="button" aria-label="Clear start date" onClick={() => setDateFromFilter("")}><X size={14} /></button>}</label>
                  <label className="date-filter"><CalendarDays size={16} /><span>To</span><input aria-label="Filter reports to date" type="date" value={dateToFilter} aria-invalid={hasInvalidDateRange} onChange={(event) => setDateToFilter(event.target.value)} />{dateToFilter && <button type="button" aria-label="Clear end date" onClick={() => setDateToFilter("")}><X size={14} /></button>}</label>
                  {hasInvalidDateRange && <p className="filter-validation" role="alert">Start date must be on or before end date.</p>}
                </div>

                <div className="mobile-report-cards">
                  {filteredReports.map((report) => <MobileReportCard
                    key={report.id}
                    report={report}
                    project={projects.find((item) => item.id === report.projectId)}
                    isAdministrator={canManageProjectReports}
                    canDelete={isSuperUser}
                    canManage={canManageProjectReports}
                    isSelected={selectedReportIds.includes(report.id)}
                    onOpen={() => setSelectedReport(report)}
                    onEdit={() => setEditingReport(report)}
                    onDownload={downloadReport}
                    onArchive={archiveReport}
                    onToggleSelection={(selected) => toggleReportSelection(report.id, selected)}
                  />)}
                  {filteredReports.length === 0 && <div className="mobile-report-empty"><FileText size={22} /><strong>{canManageProjectReports ? "No reports found" : "Your report log is empty"}</strong><span>{canManageProjectReports ? "Try changing your filters or upload a new report." : "Once you submit a report, it will appear here by date."}</span><button className="button button-secondary" onClick={openUpload}><Plus size={16} /> Upload a report</button></div>}
                </div>

                <div className="table-wrap desktop-report-table">
                  <table className="report-history-table">
                    <thead><tr>{isSuperUser && <th><span className="sr-only">Select report</span></th>}<th>TITLE</th><th>DESCRIPTION</th><th>PROJECT</th>{canManageProjectReports && <th>UPLOADED BY</th>}<th>DATE</th><th>FILE</th><th><span className="sr-only">Actions</span></th></tr></thead>
                    <tbody>
                      {filteredReports.map((report) => {
                        const project = projects.find((item) => item.id === report.projectId);
                        return <tr key={report.id}>
                          {isSuperUser && <td data-label="Select"><input
                            className="report-selection-checkbox"
                            type="checkbox"
                            aria-label={`Select ${report.title} for permanent deletion`}
                            checked={selectedReportIds.includes(report.id)}
                            onChange={(event) => toggleReportSelection(report.id, event.target.checked)}
                          /></td>}
                          <td className="report-cell" data-label="Title"><span className="file-icon"><FileText size={18} /></span><button className="report-copy report-open" onClick={() => setSelectedReport(report)} aria-label={`View details for ${report.title}`}><strong>{report.title}</strong></button></td>
                          <td className="report-description-cell" data-label="Description"><span>{report.description || "—"}</span></td>
                          <td data-label="Project"><span className={`project-tag tag-${project?.color}`}>{project?.shortName}</span></td>
                          {canManageProjectReports && <td data-label="Uploaded by"><span className="uploader"><span className="mini-avatar">{report.user.split(" ").map((part) => part[0]).join("")}</span>{report.user}</span></td>}
                          <td className="date-cell" data-label="Date">{formatDate(report.date)}</td>
                          <td data-label="Files"><span className="file-meta"><span>{report.files?.length > 1 ? `${report.files.length} files` : report.type}</span>{report.files?.length > 1 ? "Multiple" : report.fileSize}</span></td>
                          <td className="report-action-cell"><div className="report-actions">
                            <button className="download-button" aria-label={`Details for ${report.title}`} title="Report details" onClick={() => setSelectedReport(report)}><Info size={16} /></button>
                            <button className="download-button" aria-label={`Download PDF and evidence ZIP for ${report.title}`} title="Download PDF and evidence ZIP" onClick={() => downloadReport(report)}><ArrowDownToLine size={17} /></button>
                            {canManageProjectReports && <button className="download-button" aria-label={`Edit ${report.title}`} title="Edit report" onClick={() => setEditingReport(report)}><Pencil size={15} /></button>}
                            {canManageProjectReports && <button className="download-button" aria-label={`Archive ${report.title}`} title="Archive report" onClick={() => archiveReport(report)}><Archive size={16} /></button>}
                          </div></td>
                        </tr>;
                      })}
                      {filteredReports.length === 0 && <tr><td className="empty-state" colSpan={(canManageProjectReports ? 7 : 6) + (isSuperUser ? 1 : 0)}><span className="empty-icon"><File size={20} /></span><strong>{canManageProjectReports ? "No reports found" : "Your report log is empty"}</strong><span>{canManageProjectReports ? "Try changing your filters or upload a new report." : "Once you submit a report, it will appear here by date."}</span><button className="button button-secondary" onClick={openUpload}><Plus size={16} /> Upload a report</button></td></tr>}
                    </tbody>
                  </table>
                </div>
                <div className="table-footer"><span>Showing <strong>{filteredReports.length}</strong> of <strong>{reports.length}</strong> reports</span><span className="table-footer-note">{canManageProjectReports ? <><UsersRound size={15} /> {isProjectManager ? "Assigned project workspace" : "Shared workspace"}</> : <><ShieldCheck size={15} /> Only you and administrators can see these reports</>}</span></div>
              </section>

              <div className="integration-note"><ShieldCheck size={17} /><span><strong>One login for every project.</strong> Reports are stored on this server and shared with authenticated project users.</span><button onClick={() => setNotice("Email notifications can be configured by the administrator.")}>Notifications <ArrowUpRight size={14} /></button></div>
            </>
          )}
          </ScreenTransition>
        </div>
      </main>

      {notice && <div className="toast" role="status"><Check size={17} /><span>{notice}</span><button aria-label="Dismiss message" onClick={() => setNotice("")}><X size={16} /></button></div>}

      {summaryPopover && <div className="modal-backdrop summary-popover-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSummaryPopover(null); }}>
        <section className="upload-modal summary-popover" role="dialog" aria-modal="true" aria-labelledby="summary-popover-title">
          <div className="modal-heading">
            <div>
              <span className="modal-icon">{summaryPopover.kind === "projects" ? <FolderKanban size={19} /> : <FileText size={19} />}</span>
              <div>
                <h2 id="summary-popover-title">{summaryPopover.kind === "projects"
                  ? "Active projects"
                  : summaryPopover.kind === "today"
                    ? "Reports dated today"
                    : summaryPopoverProject?.name || "Total reports"}</h2>
                <p>{summaryPopover.kind === "projects"
                  ? "Choose a project to view its report log."
                  : `${summaryPopoverReports.length} report${summaryPopoverReports.length === 1 ? "" : "s"} in this log`}</p>
              </div>
            </div>
            <button className="icon-button" aria-label="Close smartcard details" onClick={() => setSummaryPopover(null)}><X size={19} /></button>
          </div>
          {summaryPopover.kind === "project" && <button type="button" className="text-button summary-popover-back" onClick={() => setSummaryPopover({ kind: "projects" })}>All active projects</button>}
          <div className="summary-popover-content">
            {summaryPopover.kind === "projects" ? (
              projects.length ? projects.map((project) => {
                const count = reports.filter((report) => report.projectId === project.id).length;
                return <button type="button" className="summary-popover-row" key={project.id} onClick={() => setSummaryPopover({ kind: "project", projectId: project.id })}>
                  <span className={`project-dot dot-${project.color}`} />
                  <span className="summary-popover-row-copy"><strong>{project.name}</strong><small>{count} report{count === 1 ? "" : "s"} in your log</small></span>
                  <ArrowUpRight size={16} />
                </button>;
              }) : <div className="summary-popover-empty"><FolderKanban size={22} /><strong>No active projects</strong><span>There are no active projects to show.</span></div>
            ) : summaryPopoverReports.length ? (
              summaryPopoverReports.map((report) => <button type="button" className="summary-popover-row" key={report.id} onClick={() => setSelectedReport(report)}>
                <CalendarDays size={17} className="summary-popover-row-icon" />
                <span className="summary-popover-row-copy"><strong>{report.title}</strong><small>{formatDate(report.date)} · {report.projectName || projects.find((project) => project.id === report.projectId)?.name || "Project"} · {report.files?.length || 1} file{(report.files?.length || 1) === 1 ? "" : "s"}</small></span>
                <Info size={16} />
              </button>)
            ) : (
              <div className="summary-popover-empty"><FileText size={22} /><strong>{summaryPopover.kind === "projects" ? "No active projects" : "No reports found"}</strong><span>{summaryPopover.kind === "today" ? "There are no reports dated today." : "Reports will appear here after they are submitted."}</span></div>
            )}
          </div>
          <div className="summary-popover-footer">
            <span>{summaryPopover.kind === "projects" ? `${projects.length} active projects` : `${summaryPopoverReports.length} reports`}</span>
            <button type="button" className="button button-primary" onClick={openFullReportLog}>Open full report log</button>
          </div>
        </section>
      </div>}

      {reportLogPerson && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setReportLogPerson(null); }}>
        <section className="upload-modal report-detail-modal employee-report-log-modal" role="dialog" aria-modal="true" aria-labelledby="employee-report-log-title">
          <div className="modal-heading">
            <div><span className="modal-icon"><FileText size={19} /></span><div><h2 id="employee-report-log-title">{reportLogPerson.name}'s report log</h2><p>Punch ID {reportLogPerson.punchId} · {employeeReports.length} reports</p></div></div>
            <button className="icon-button" aria-label={`Close ${reportLogPerson.name}'s report log`} onClick={() => setReportLogPerson(null)}><X size={19} /></button>
          </div>
          {isEmployeeReportsLoading ? <div className="file-preview-message" role="status">Loading report history…</div>
            : employeeReportsError ? <p className="field-error" role="alert">{employeeReportsError}</p>
              : employeeReports.length === 0 ? <div className="employee-report-log-empty"><FileText size={21} /><strong>No active reports</strong><span>This employee has no active reports in the current workspace.</span></div>
                : <div className="table-wrap">
                  <table className="employee-report-log-table">
                    <thead><tr><th>DATE</th><th>REPORT</th><th>PROJECT</th><th>FILES</th></tr></thead>
                    <tbody>{employeeReports.map((report) => <tr key={report.id}>
                      <td className="date-cell">{formatDate(report.date)}</td>
                      <td><button className="report-copy report-open employee-report-log-title" onClick={() => setSelectedReport(report)}><strong>{report.title}</strong><small>{report.description || "View report details"}</small></button></td>
                      <td>{report.projectName}</td>
                      <td><button className="text-button employee-report-log-files" onClick={() => setSelectedReport(report)}>{report.files?.length || 1} · View</button></td>
                    </tr>)}</tbody>
                  </table>
                </div>}
        </section>
      </div>}

      {isUploadOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setIsUploadOpen(false); }}>
        <section className="upload-modal" role="dialog" aria-modal="true" aria-labelledby="upload-title">
          <div className="modal-heading"><div><span className="modal-icon"><Upload size={19} /></span><div><h2 id="upload-title">Upload a report</h2><p>Share a file with everyone on the project.</p></div></div><button className="icon-button" aria-label="Close upload form" onClick={() => setIsUploadOpen(false)}><X size={19} /></button></div>
          <form onSubmit={submitReport}>
            {!isUploadConfirming ? <>
              <label className="form-label">Project <span className="required">*</span>
                <select required value={form.projectId} onChange={(event) => setForm({ ...form, projectId: event.target.value })}><option value="" disabled>Select a project</option>{projectsWithReports.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
              </label>
              <div className="form-grid">
                <label className="form-label">Report date <span className="required">*</span><input type="date" required value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></label>
                <label className="form-label">Uploaded by<input value={`${currentUser} · Punch ID`} readOnly /></label>
              </div>
              <label className="form-label">Report title <span className="required">*</span><input required maxLength="100" placeholder="e.g. Weekly site progress report" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
              <label className="form-label">Description <span className="optional">(optional)</span><textarea rows="3" maxLength="500" placeholder="Add a short note about this report..." value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
              <div className="form-label">Attach files <span className="required">*</span>
                <div className={`drop-zone ${selectedFiles.length ? "drop-zone-selected" : ""}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); addSelectedFiles(event.dataTransfer.files); }}>
                  <span className="drop-icon">{selectedFiles.length ? <Check size={19} /> : <Upload className="lucide-motion" size={19} />}</span>
                  <strong>{selectedFiles.length ? `${selectedFiles.length} file${selectedFiles.length === 1 ? "" : "s"} selected` : "Add documents, spreadsheets, PDFs, or photos"}</strong>
                  <small>{selectedFiles.length
                    ? `${(selectedFiles.reduce((total, file) => total + file.size, 0) / (1024 * 1024)).toFixed(2)} MB total · No file-count or combined-size limit`
                    : `Choose multiple files or drag them here · ${formatUploadLimit(maxUploadBytes)} max per file`}</small>
                  <div className="file-source-actions">
                    <button type="button" className="button button-secondary" onClick={() => fileInput.current?.click()}><FileText size={15} /> Upload files</button>
                    <button type="button" className="button button-secondary" onClick={() => cameraInput.current?.click()}><Camera className="lucide-motion" size={15} /> Take photo</button>
                  </div>
                </div>
                <input ref={fileInput} className="sr-only" aria-label="Upload files from your device" type="file" accept={reportFileAccept} multiple onChange={(event) => { addSelectedFiles(event.target.files); event.target.value = ""; }} />
                <input ref={cameraInput} className="sr-only" aria-label="Take a photo" type="file" accept="image/*" capture="environment" onChange={(event) => { addSelectedFiles(event.target.files); event.target.value = ""; }} />
                {selectedFiles.length > 0 && <div className="selected-files">
                  {selectedFiles.map((file, index) => <div className="selected-file" key={`${file.name}-${file.size}-${file.lastModified}`}>
                    <FileText size={15} />
                    <div><strong>{file.name}</strong><small>{(file.size / (1024 * 1024)).toFixed(2)} MB</small></div>
                    <button type="button" className="text-button" onClick={() => setPreviewingUploadFile(previewingUploadFile === file ? null : file)}>{previewingUploadFile === file ? "Hide preview" : "Preview"}</button>
                    <button type="button" className="icon-button" aria-label={`Remove ${file.name}`} onClick={() => { setSelectedFiles((items) => items.filter((_, fileIndex) => fileIndex !== index)); if (previewingUploadFile === file) setPreviewingUploadFile(null); }}><X size={15} /></button>
                    {previewingUploadFile === file && <div className="selected-file-preview"><ReportFilePreview file={file} fileName={file.name} /></div>}
                  </div>)}
                </div>}
                {selectedFiles.length > 0 && validateReportFiles(selectedFiles, maxUploadBytes) && <span className="field-error" role="alert">{validateReportFiles(selectedFiles, maxUploadBytes)}</span>}
              </div>
              <div className="modal-footer"><span><ShieldCheck size={15} /> Shared with administrators</span><div><button type="button" className="button button-secondary" onClick={() => setIsUploadOpen(false)} disabled={isUploading}>Cancel</button><button type="submit" className="button button-primary" disabled={!selectedFiles.length || Boolean(validateReportFiles(selectedFiles, maxUploadBytes)) || isUploading}><Upload size={16} /> Review upload</button></div></div>
            </> : <section className="upload-confirmation" aria-live="polite">
              <span className="drop-icon"><ShieldCheck size={19} /></span>
              <h3>Confirm report upload</h3>
              <p><strong>{form.title}</strong> will be shared with administrators and attached to {projects.find((project) => project.id === form.projectId)?.name || "the selected project"}.</p>
              <p>{selectedFiles.length} file{selectedFiles.length === 1 ? "" : "s"} · {(selectedFiles.reduce((total, file) => total + file.size, 0) / (1024 * 1024)).toFixed(2)} MB total</p>
              <div className="upload-confirmation-actions"><button type="button" className="button button-secondary" onClick={() => setIsUploadConfirming(false)} disabled={isUploading}>Back to edit</button><button type="button" className="button button-primary" onClick={confirmReportUpload} disabled={isUploading}><Upload size={16} /> {isUploading ? "Uploading…" : "Confirm and upload"}</button></div>
            </section>}
          </form>
        </section>
      </div>}

      {selectedReport && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedReport(null); }}>
        <section className="upload-modal report-detail-modal" role="dialog" aria-modal="true" aria-labelledby="report-detail-title">
          <div className="modal-heading"><div><span className="modal-icon"><FileText size={19} /></span><div><h2 id="report-detail-title">{selectedReport.title}</h2><p>Report details and attached document</p></div></div><div className="report-detail-heading-actions">{canManageProjectReports && <button type="button" className="button button-secondary" onClick={() => setEditingReport(selectedReport)}><Pencil size={15} /> Edit report</button>}<button className="icon-button" aria-label="Close report details" onClick={() => setSelectedReport(null)}><X size={19} /></button></div></div>
          <dl className="report-detail-grid">
            <div><dt>Project</dt><dd>{selectedReport.projectName || projects.find((item) => item.id === selectedReport.projectId)?.name || "Project"}</dd></div>
            <div><dt>Report date</dt><dd>{formatDate(selectedReport.date)}</dd></div>
            <div><dt>Uploaded by</dt><dd>{selectedReport.user}</dd></div>
            <div><dt>Attachments</dt><dd>{selectedReport.files?.length || 1} file{(selectedReport.files?.length || 1) === 1 ? "" : "s"}</dd></div>
            <div className="report-detail-description"><dt>Description</dt><dd>{selectedReport.description || "No description provided."}</dd></div>
          </dl>
          <ReportAttachments report={selectedReport} onDownload={downloadReport} />
        </section>
      </div>}
      {editingReport && <ReportEditModal
        key={editingReport.id}
        report={editingReport}
        maxUploadBytes={maxUploadBytes}
        isSaving={isSavingReport}
        onClose={() => setEditingReport(null)}
        onSave={saveReportEdit}
      />}

      {isProjectFormOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setIsProjectFormOpen(false); }}>
        <section className="upload-modal project-modal" role="dialog" aria-modal="true" aria-labelledby="project-form-title">
          <div className="modal-heading">
            <div>
              <span className="modal-icon"><FolderKanban size={19} /></span>
              <div><h2 id="project-form-title">{editingProject ? "Edit project" : "Add a project"}</h2><p>{editingProject ? "Update this project’s details." : "Create a project for your team’s reports."}</p></div>
            </div>
            <button className="icon-button" aria-label="Close project form" onClick={() => setIsProjectFormOpen(false)}><X size={19} /></button>
          </div>
          <form onSubmit={submitProject}>
            <label className="form-label">Project name <span className="required">*</span>
              <input autoFocus required maxLength="80" placeholder="Enter a project name" value={projectForm.name} onChange={(event) => { setProjectForm({ ...projectForm, name: event.target.value }); setProjectFormError(""); }} />
            </label>
            <label className="form-label">Description <span className="optional">(optional)</span>
              <textarea rows="3" maxLength="240" placeholder="What is this project about?" value={projectForm.description} onChange={(event) => setProjectForm({ ...projectForm, description: event.target.value })} />
            </label>
            <label className="form-label">Project color
              <select value={projectForm.color} onChange={(event) => setProjectForm({ ...projectForm, color: event.target.value })}>
                {projectColors.map((color) => <option key={color} value={color}>{color[0].toUpperCase() + color.slice(1)}</option>)}
              </select>
            </label>
            {isSuperUser ? <label className="form-label">Project Manager <span className="optional">(optional, one per project)</span>
              <select value={projectForm.managerPunchId} onChange={(event) => { setProjectForm({ ...projectForm, managerPunchId: event.target.value }); setProjectFormError(""); }}>
                <option value="">Not assigned</option>
                {manpower
                  .filter((person) => (person.active && person.isProjectManager) || person.punchId === projectForm.managerPunchId)
                  .map((person) => {
                    const managesOther = (person.projectManagerProjects || []).filter((item) => item.id !== editingProject?.id);
                    return <option key={person.punchId} value={person.punchId}>
                      {person.name} ({person.punchId}){managesOther.length ? ` — also manages ${managesOther.map((item) => item.name).join(", ")}` : ""}
                    </option>;
                  })}
              </select>
              {(() => {
                const selected = manpower.find((person) => person.punchId === projectForm.managerPunchId);
                return selected && editingProject?.managerPunchId && editingProject.managerPunchId !== selected.punchId
                  ? <small className="field-hint">{selected.name} will become this project's manager. They will keep their other project assignments.</small>
                    : <small className="field-hint">The Project Manager can upload, edit, archive, and export reports in this project only.</small>;
              })()}
            </label> : editingProject && <p className="field-hint">Project Manager: {editingProject.managerName || "Not assigned"} (only the Super User can change this).</p>}
            {projectFormError && <p className="field-error" role="alert">{projectFormError}</p>}
            <div className="modal-footer">
              <span><ShieldCheck size={15} /> Project members can share reports</span>
              <div>
                <button type="button" className="button button-secondary" onClick={() => setIsProjectFormOpen(false)}>Cancel</button>
                <button type="submit" className="button button-primary"><Check size={16} /> {editingProject ? "Save changes" : "Create project"}</button>
              </div>
            </div>
          </form>
        </section>
      </div>}

      {isManpowerFormOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setIsManpowerFormOpen(false); }}>
        <section className="upload-modal project-modal" role="dialog" aria-modal="true" aria-labelledby="manpower-form-title">
          <div className="modal-heading">
            <div>
              <span className="modal-icon"><UsersRound size={19} /></span>
              <div><h2 id="manpower-form-title">{editingManpower ? "Edit manpower account" : "Add manpower account"}</h2><p>{editingManpower ? "Update account details and project assignments." : "Manage the employee directory using Punch IDs."}</p></div>
            </div>
            <button className="icon-button" aria-label="Close manpower form" onClick={() => setIsManpowerFormOpen(false)}><X size={19} /></button>
          </div>
          <form onSubmit={submitManpower}>
            <label className="form-label">Punch ID <span className="required">*</span>
              <input autoFocus required inputMode="numeric" maxLength="10" placeholder="e.g. 4114" value={manpowerForm.punchId} onChange={(event) => { setManpowerForm({ ...manpowerForm, punchId: event.target.value.replace(/\D/g, "") }); setManpowerFormError(""); }} />
            </label>
            <label className="form-label">Employee name <span className="required">*</span>
              <input required maxLength="120" placeholder="Enter employee name" value={manpowerForm.name} onChange={(event) => setManpowerForm({ ...manpowerForm, name: event.target.value })} />
            </label>
            <label className="form-label">Designation <span className="required">*</span>
              <input required maxLength="100" placeholder="Enter designation" value={manpowerForm.designation} onChange={(event) => setManpowerForm({ ...manpowerForm, designation: event.target.value })} />
            </label>
            {!editingManpower && isSuperUser && <label className="form-label">Assigned project <span className="optional">(optional)</span>
              <select value={manpowerForm.projectId} onChange={(event) => { setManpowerForm({ ...manpowerForm, projectId: event.target.value }); setManpowerFormError(""); }}>
                <option value="">Unassigned</option>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </label>}
            {editingManpower && isSuperUser && !editingManpower.adminAccess && !editingManpower.isProjectManager && <label className="form-label">Assigned project
              <select value={manpowerForm.projectId} onChange={(event) => { setManpowerForm({ ...manpowerForm, projectId: event.target.value }); setManpowerFormError(""); }}>
                <option value="">Unassigned</option>
                {manpowerForm.projectId && !projects.some((project) => project.id === manpowerForm.projectId) && <option value={manpowerForm.projectId}>{editingManpower.projectName || "Current project"} (inactive)</option>}
                {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </label>}
            {editingManpower && isSuperUser && editingManpower.isProjectManager && <fieldset className="manager-project-selection" disabled={!editingManpower.active}>
              <legend>Projects managed</legend>
              <p>Choose one or more active projects. Each project can have one Project Manager.</p>
              {projects.length ? <div className="manager-project-options">
                {projects.map((project) => {
                  const selected = manpowerForm.projectManagerProjectIds.includes(project.id);
                  const assignedElsewhere = Boolean(project.managerPunchId && project.managerPunchId !== editingManpower.punchId);
                  return <label className={`manager-project-option ${assignedElsewhere ? "manager-project-option-disabled" : ""}`} key={project.id}>
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={assignedElsewhere}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        setManpowerFormError("");
                        setManpowerForm((current) => {
                          const selectedIds = new Set(current.projectManagerProjectIds);
                          if (checked) selectedIds.add(project.id);
                          else selectedIds.delete(project.id);
                          return { ...current, projectManagerProjectIds: [...selectedIds] };
                        });
                      }}
                      />
                      <span>{project.name}</span>
                      {assignedElsewhere && <small>Assigned to {project.managerName || "another manager"}</small>}
                    </label>;
                })}
              </div> : <span className="field-hint">There are no active projects.</span>}
              {!editingManpower.active && <span className="field-hint">Reactivate this account before assigning projects.</span>}
            </fieldset>}
            {editingManpower && isSuperUser && editingManpower.isProjectManager && <button
              type="button"
              className="button button-danger"
              disabled={Boolean(updatingProjectManagerAccessPunchId)}
              onClick={async () => {
                if (await toggleProjectManagerAccess(editingManpower)) {
                  setIsManpowerFormOpen(false);
                  setEditingManpower(null);
                }
              }}
            >Remove Project Manager appointment</button>}
            {manpowerFormError && <p className="field-error" role="alert">{manpowerFormError}</p>}
            <div className="modal-footer">
              <span><ShieldCheck size={15} /> Punch ID authentication requires server setup</span>
              <div>
                <button type="button" className="button button-secondary" onClick={() => setIsManpowerFormOpen(false)}>Cancel</button>
                <button type="submit" className="button button-primary"><Check size={16} /> {editingManpower ? "Save changes" : "Add account"}</button>
              </div>
            </div>
          </form>
        </section>
      </div>}

      {transferPerson && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !transferringManpowerPunchId) setTransferPerson(null); }}>
        <section className="upload-modal project-modal" role="dialog" aria-modal="true" aria-labelledby="project-transfer-title">
          <div className="modal-heading">
            <div>
              <span className="modal-icon"><ArrowRightLeft size={19} /></span>
              <div><h2 id="project-transfer-title">Transfer employee to project</h2><p>{transferPerson.name} · Punch ID {transferPerson.punchId}</p></div>
            </div>
            <button className="icon-button" aria-label="Close project transfer" disabled={Boolean(transferringManpowerPunchId)} onClick={() => setTransferPerson(null)}><X size={19} /></button>
          </div>
          <form onSubmit={transferManpower}>
            <label className="form-label">Project
              <select autoFocus value={transferProjectId} onChange={(event) => { setTransferProjectId(event.target.value); setTransferProjectError(""); }}>
                <option value="">Unassigned</option>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </label>
            <p className="field-hint">Only the Super User can change an employee’s project assignment.</p>
            {transferProjectError && <p className="field-error" role="alert">{transferProjectError}</p>}
            <div className="modal-footer">
              <span><ShieldCheck size={15} /> Project assignments do not change report history</span>
              <div>
                <button type="button" className="button button-secondary" disabled={Boolean(transferringManpowerPunchId)} onClick={() => setTransferPerson(null)}>Cancel</button>
                <button type="submit" className="button button-primary" disabled={Boolean(transferringManpowerPunchId) || String(transferPerson.projectId || "") === transferProjectId}>
                  <ArrowRightLeft size={16} /> {transferringManpowerPunchId ? "Transferring…" : "Transfer to project"}
                </button>
              </div>
            </div>
          </form>
        </section>
      </div>}
      {isBulkTransferOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !isBulkTransferringManpower) setIsBulkTransferOpen(false); }}>
        <section className="upload-modal project-modal" role="dialog" aria-modal="true" aria-labelledby="bulk-project-transfer-title">
          <div className="modal-heading">
            <div>
              <span className="modal-icon"><ArrowRightLeft size={19} /></span>
              <div><h2 id="bulk-project-transfer-title">Transfer selected accounts</h2><p>{selectedManpowerPunchIds.length} manpower account{selectedManpowerPunchIds.length === 1 ? "" : "s"} selected</p></div>
            </div>
            <button className="icon-button" aria-label="Close bulk project transfer" disabled={isBulkTransferringManpower} onClick={() => setIsBulkTransferOpen(false)}><X size={19} /></button>
          </div>
          <form onSubmit={transferSelectedManpower}>
            <label className="form-label">Destination project
              <select autoFocus value={bulkTransferProjectId} onChange={(event) => { setBulkTransferProjectId(event.target.value); setBulkTransferError(""); }}>
                <option value="">Unassigned</option>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </label>
            <p className="field-hint">Only the Super User can change project assignments. Existing report history is unchanged.</p>
            {bulkTransferError && <p className="field-error" role="alert">{bulkTransferError}</p>}
            <div className="modal-footer">
              <span><ShieldCheck size={15} /> Each selected account is updated individually</span>
              <div>
                <button type="button" className="button button-secondary" disabled={isBulkTransferringManpower} onClick={() => setIsBulkTransferOpen(false)}>Cancel</button>
                <button type="submit" className="button button-primary" disabled={isBulkTransferringManpower || !selectedManpowerPunchIds.length}>
                  <ArrowRightLeft size={16} /> {isBulkTransferringManpower ? "Transferring…" : "Transfer selected"}
                </button>
              </div>
            </div>
          </form>
        </section>
      </div>}
      {passwordDialog && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closePasswordDialog(); }}>
        <section className="upload-modal project-modal" role="dialog" aria-modal="true" aria-labelledby="password-dialog-title">
          <div className="modal-heading">
            <div>
              <span className="modal-icon"><KeyRound size={19} /></span>
              <div>
                <h2 id="password-dialog-title">{passwordDialog.kind === "self" ? "Manage sign-in password" : "Set or reset password"}</h2>
                <p>{passwordDialog.kind === "self"
                  ? `Your account · Punch ID ${user.punchId}`
                  : `${passwordDialog.person.name} · Punch ID ${passwordDialog.person.punchId}`}</p>
              </div>
            </div>
            <button type="button" className="icon-button" aria-label="Close password settings" disabled={isSavingManagedPassword} onClick={closePasswordDialog}><X size={19} /></button>
          </div>
          <form onSubmit={submitPasswordDialog}>
            {passwordDialog.kind === "self" && <label className="form-label">Current password <span className="optional">(required if one is already set)</span>
              <input
                type="password"
                autoComplete="current-password"
                autoFocus
                maxLength="72"
                value={passwordForm.currentPassword}
                onChange={(event) => setPasswordForm({ ...passwordForm, currentPassword: event.target.value })}
              />
            </label>}
            <label className="form-label">New password <span className="required">*</span>
              <input
                type="password"
                autoComplete="new-password"
                autoFocus={passwordDialog.kind !== "self"}
                minLength="12"
                maxLength="72"
                required
                value={passwordForm.newPassword}
                onChange={(event) => setPasswordForm({ ...passwordForm, newPassword: event.target.value })}
              />
              <span className="field-hint">Use 12 to 72 characters. This password is required at your next sign-in.</span>
            </label>
            <label className="form-label">Confirm new password <span className="required">*</span>
              <input
                type="password"
                autoComplete="new-password"
                minLength="12"
                maxLength="72"
                required
                value={passwordForm.confirmPassword}
                onChange={(event) => setPasswordForm({ ...passwordForm, confirmPassword: event.target.value })}
              />
            </label>
            {passwordDialogError && <p className="field-error" role="alert">{passwordDialogError}</p>}
            <div className="modal-footer">
              <span><ShieldCheck size={15} />{passwordDialog.kind === "self"
                ? "Other sessions are signed out after a change"
                : "This action signs the user out of existing sessions"}</span>
              <div>
                <button type="button" className="button button-secondary" disabled={isSavingManagedPassword} onClick={closePasswordDialog}>Cancel</button>
                <button type="submit" className="button button-primary" disabled={isSavingManagedPassword}>
                  <Check size={16} />{isSavingManagedPassword ? "Saving…" : "Save password"}
                </button>
              </div>
            </div>
          </form>
        </section>
      </div>}
      {projectManagerPerson && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !assigningProjectManagerPunchId) setProjectManagerPerson(null); }}>
        <section className="upload-modal project-modal" role="dialog" aria-modal="true" aria-labelledby="project-manager-assignment-title">
          <div className="modal-heading">
            <div>
              <span className="modal-icon"><ShieldCheck size={19} /></span>
              <div><h2 id="project-manager-assignment-title">Assign Project Manager</h2><p>{projectManagerPerson.name} · Punch ID {projectManagerPerson.punchId}</p></div>
            </div>
            <button className="icon-button" aria-label="Close Project Manager assignment" disabled={Boolean(assigningProjectManagerPunchId)} onClick={() => setProjectManagerPerson(null)}><X size={19} /></button>
          </div>
          <form onSubmit={assignProjectManager}>
            {(() => {
              const availableProjects = projects.filter((project) =>
                !project.managerPunchId || project.managerPunchId === projectManagerPerson.punchId,
              );
              return availableProjects.length ? <label className="form-label">Available project
                <select autoFocus required value={projectManagerProjectId} onChange={(event) => { setProjectManagerProjectId(event.target.value); setProjectManagerError(""); }}>
                  {availableProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select>
              </label> : <p className="field-hint">There are no active projects without an assigned Project Manager.</p>;
            })()}
            <p className="field-hint">Only active appointed Project Managers can manage projects. Each project has one manager, and a manager can manage multiple projects.</p>
            {projectManagerError && <p className="field-error" role="alert">{projectManagerError}</p>}
            <div className="modal-footer">
              <span><ShieldCheck size={15} /> Super User assignment</span>
              <div>
                <button type="button" className="button button-secondary" disabled={Boolean(assigningProjectManagerPunchId)} onClick={() => setProjectManagerPerson(null)}>Cancel</button>
                <button type="submit" className="button button-primary" disabled={Boolean(assigningProjectManagerPunchId) || !projectManagerProjectId}>
                  <Check size={16} /> {assigningProjectManagerPunchId ? "Assigning…" : "Assign to project"}
                </button>
              </div>
            </div>
          </form>
        </section>
      </div>}
    </div>
  );
}

function MobileReportCard({ report, project, isAdministrator, canDelete, canManage, isSelected, onOpen, onEdit, onDownload, onArchive, onToggleSelection }) {
  const attachments = report.files?.length ? report.files : [report];

  return <article className="mobile-report-card">
    {canDelete && <label className="report-selection-control">
      <input type="checkbox" checked={isSelected} onChange={(event) => onToggleSelection(event.target.checked)} />
      <span>Select for deletion</span>
    </label>}
    <div className="mobile-report-card-heading">
      <div className="mobile-report-card-title">
        <h3>{report.title}</h3>
        <span className={`project-tag tag-${project?.color}`}>{project?.name || report.projectName || "Project"}</span>
      </div>
      <time dateTime={report.date}>{formatDate(report.date)}</time>
    </div>
    <p className="mobile-report-description">{report.description || "No description provided."}</p>
    {isAdministrator && <p className="mobile-report-uploader"><span>Uploaded by</span><strong>{report.user}</strong></p>}
    <section className="mobile-report-attachments" aria-label="Report attachments">
      <div className="mobile-report-attachments-heading"><strong>Attachments</strong><span>{attachments.length} {attachments.length === 1 ? "file" : "files"}</span></div>
      <div className="mobile-report-attachment-list">
        {attachments.map((attachment, index) => <div className="mobile-report-attachment" key={attachment.id || `${attachment.fileName}-${index}`}>
          <span className="mobile-report-attachment-type">{attachment.type || "FILE"}</span>
          <span className="mobile-report-attachment-copy"><strong>{attachment.fileName}</strong><small>{attachment.fileSize || report.fileSize}</small></span>
          <button type="button" className="mobile-attachment-download" onClick={() => onDownload(report, attachment)} aria-label={`Download ${attachment.fileName}`}><ArrowDownToLine size={15} /> Download</button>
        </div>)}
      </div>
    </section>
    <div className="mobile-report-card-actions">
      <button type="button" className="button button-secondary" onClick={onOpen}><Info size={15} /> Details</button>
      <button type="button" className="button button-primary" title="ZIP contains report.pdf and all evidence attachments" aria-label={`Download PDF and evidence ZIP for ${report.title}`} onClick={() => onDownload(report)}><ArrowDownToLine size={15} /> PDF + evidence ZIP</button>
      {canManage && <button type="button" className="download-button" onClick={onEdit} aria-label={`Edit ${report.title}`} title="Edit report"><Pencil size={15} /></button>}
      {isAdministrator && <button type="button" className="download-button" onClick={() => onArchive(report)} aria-label={`Archive ${report.title}`} title="Archive report"><Archive size={16} /></button>}
    </div>
  </article>;
}

function SummaryCards({ reports, projects, onSelect }) {
  const todayReports = reports.filter((report) => report.date === today).length;
  return <section className="summary-grid" aria-label="Workspace summary">
    <button type="button" className="summary-card summary-card-clickable" onClick={() => onSelect("all")} aria-label={`View all ${reports.length} reports`}>
      <span className="summary-icon summary-blue"><FileText size={18} /></span><span className="summary-copy"><small>Total reports</small><strong>{reports.length}</strong><em>Across all projects</em></span><span className="summary-trend">View log <ArrowUpRight size={15} /></span>
    </button>
    <button type="button" className="summary-card summary-card-clickable" onClick={() => onSelect("projects")} aria-label={`Filter reports by one of ${projects.length} active projects`}>
      <span className="summary-icon summary-green"><FolderKanban size={18} /></span><span className="summary-copy"><small>Active projects</small><strong>{projects.length}</strong><em>In your workspace</em></span><span className="summary-trend">Choose project <ArrowUpRight size={15} /></span>
    </button>
    <button type="button" className="summary-card summary-card-clickable" onClick={() => onSelect("today")} aria-label={`View ${todayReports} reports dated today`}>
      <span className="summary-icon summary-purple"><CalendarDays size={18} /></span><span className="summary-copy"><small>Added today</small><strong>{todayReports}</strong><em>New project updates</em></span><span className="summary-trend">View today <ArrowUpRight size={15} /></span>
    </button>
  </section>;
}

function AdminSettingsPage({ profileForm, setProfileForm, profileError, isSaving, onSubmit, onReset }) {
  return <section className="admin-settings-page">
    <div className="page-heading">
      <div>
        <div className="eyebrow"><span className="eyebrow-dot" /> ADMINISTRATION</div>
        <h1>Settings</h1>
        <p>Manage your administrator display name and sign-in password.</p>
      </div>
    </div>
    <section className="report-section admin-settings-card" aria-labelledby="admin-account-settings-title">
      <div className="section-heading">
        <div><h2 id="admin-account-settings-title">Administrator account</h2><p>Confirm your current password before saving changes.</p></div>
      </div>
      <form className="admin-settings-form" onSubmit={onSubmit}>
        <label className="form-label">Display name <span className="required">*</span>
          <input autoFocus required minLength="2" maxLength="160" value={profileForm.displayName} onChange={(event) => setProfileForm({ ...profileForm, displayName: event.target.value })} />
        </label>
        <label className="form-label">Current password <span className="required">*</span>
          <input type="password" autoComplete="current-password" required value={profileForm.currentPassword} onChange={(event) => setProfileForm({ ...profileForm, currentPassword: event.target.value })} />
        </label>
        <label className="form-label">New password <span className="optional">(optional, at least 12 characters)</span>
          <input type="password" autoComplete="new-password" minLength="12" maxLength="72" value={profileForm.newPassword} onChange={(event) => setProfileForm({ ...profileForm, newPassword: event.target.value })} />
        </label>
        <label className="form-label">Confirm new password
          <input type="password" autoComplete="new-password" minLength="12" maxLength="72" value={profileForm.confirmPassword} onChange={(event) => setProfileForm({ ...profileForm, confirmPassword: event.target.value })} />
        </label>
        {profileError && <p className="field-error" role="alert">{profileError}</p>}
        <p className="admin-settings-security-note"><ShieldCheck size={16} /> Other signed-in sessions are revoked when you change your password.</p>
        <div className="admin-settings-actions">
          <button type="button" className="button button-secondary" disabled={isSaving} onClick={onReset}>Reset changes</button>
          <button type="submit" className="button button-primary" disabled={isSaving}>{isSaving ? "Saving…" : "Save changes"}</button>
        </div>
      </form>
    </section>
  </section>;
}

function ProjectsPage({ projects: projectList, reports, onSelect, onCreate, onEdit, onDelete, canManage, canExport, onExport }) {
  return <section className="projects-page">
    <div className="page-heading">
      <div><div className="eyebrow"><span className="eyebrow-dot" /> WORKSPACE</div><h1>Your projects</h1><p>Choose a project to see its reports and updates.</p></div>
      {canManage && <button className="button button-primary" onClick={onCreate}><Plus size={17} /> New project</button>}
    </div>
    <div className="report-section project-list-section">
      <div className="table-wrap">
        <table className="project-list-table">
          <thead><tr><th>PROJECT</th><th>DESCRIPTION</th><th>PROJECT MANAGER</th><th>REPORTS</th><th>STATUS</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {projectList.map((project) => {
              const count = Number(project.reportCount ?? reports.filter((report) => report.projectId === project.id).length);
              const openProject = () => onSelect(project.id);
              return <tr
                className="project-list-row"
                key={project.id}
                tabIndex={0}
                aria-label={`Open ${project.name} reports`}
                onClick={openProject}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openProject();
                  }
                }}
              >
                <td><button type="button" className="project-list-name" onClick={(event) => { event.stopPropagation(); openProject(); }}>
                  <span className={`project-list-icon card-${project.color}`}><FolderKanban size={16} /></span>
                  {project.name}
                </button></td>
                <td><span className="project-list-description">{project.description || "Construction project"}</span></td>
                <td>{project.managerName || <span className="project-manager-none">Unassigned</span>}</td>
                <td><span className="project-list-count"><FileText size={14} /> {count} {count === 1 ? "report" : "reports"}</span></td>
                <td><span className="project-list-status"><span className="trend-dot" /> Active</span></td>
                <td><div className="report-actions project-list-actions">
                  {canExport && <button type="button" className="download-button" aria-label={`Export ${project.name} reports`} title="Export reports ZIP" onClick={(event) => { event.stopPropagation(); onExport(project); }}><ArrowDownToLine size={15} /></button>}
                  {canManage && <>
                    <button type="button" className="download-button" aria-label={`Edit ${project.name}`} title="Edit project" onClick={(event) => { event.stopPropagation(); onEdit(project); }}><Pencil size={15} /></button>
                    <button type="button" className="download-button delete-account-button" aria-label={`Delete ${project.name}`} title="Delete project" onClick={(event) => { event.stopPropagation(); onDelete(project); }}><Trash2 size={15} /></button>
                  </>}
                </div></td>
              </tr>;
            })}
            {projectList.length === 0 && <tr><td className="empty-state" colSpan="6"><span className="empty-icon"><FolderKanban size={20} /></span><strong>No projects yet</strong><span>Create a project to start organizing reports.</span>{canManage && <button type="button" className="button button-secondary" onClick={onCreate}><Plus size={16} /> New project</button>}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
    <div className="projects-help"><ShieldCheck size={17} /><span>The Super User manages employee project assignments from the Manpower directory.</span></div>
  </section>;
}

function ManpowerPage({
  people,
  total,
  query,
  selectedPunchIds,
  canEditProjectAssignments,
  canDeleteAccounts,
  canTransferProjects,
  canManagePasswords,
  isDeletingSelection,
  isBulkTransferring,
  canAssignProjectManagers,
  updatingProjectManagerAccessPunchId,
  deletingManpowerPunchId,
  transferringManpowerPunchId,
  transferLog,
  onSearch,
  onToggleSelection,
  onToggleVisibleSelection,
  onClearSelection,
  onBulkDelete,
  onBulkTransfer,
  onAdd,
  onEdit,
  onToggleActive,
  onToggleProjectManagerAccess,
  onDeletePerson,
  onSetPassword,
  onTransferPerson,
  onAssignProjectManager,
  onViewReports,
}) {
  const canSelectAccounts = canDeleteAccounts || canTransferProjects;
  const selectedIds = new Set(selectedPunchIds);
  const allVisibleSelected = people.length > 0 && people.every((person) => selectedIds.has(person.punchId));

  return <section className="manpower-page">
    <div className="page-heading">
      <div>
        <div className="eyebrow"><span className="eyebrow-dot" /> ACCOUNT MANAGEMENT</div>
        <h1>Manpower accounts</h1>
        <p>Manage manpower accounts and Project Manager appointments. Existing Admin accounts retain separate administrator access.</p>
      </div>
      <button className="button button-primary" onClick={onAdd}><Plus size={17} /> Add manpower</button>
    </div>
    <aside className="admin-rights-note" aria-label="Administrator permissions">
      <ShieldCheck size={17} />
      <span><strong>Admins can view and download all reports, manage projects and manpower accounts, and archive reports.</strong> Unassigned employees can view all active projects and submit reports to any of them. Assigned employees can view and submit reports only to their assigned project; their existing reports stay in their personal report history after a transfer. The Super User appoints active employees as Project Managers, then assigns them to one or more projects. Each project can have one Project Manager; Project Managers can upload, edit, archive, and export reports only in their assigned projects. Project transfers are recorded below. Admin access remains separate from Project Manager appointments. Only the Super User can manage account settings and permanently delete employee or appointed admin accounts. Deleted users' reports and uploader attribution are preserved. The Super User cannot be changed by appointed admins. Appointed admins sign in with Punch ID only and should be trusted users.</span>
    </aside>
    <section className="report-section" aria-labelledby="manpower-transfer-log-heading">
      <div className="section-heading">
        <div><h2 id="manpower-transfer-log-heading">Recent project transfers</h2><p>Assignment changes for employee accounts</p></div>
      </div>
      {transferLog.length ? <div className="table-wrap"><table className="manpower-table">
        <thead><tr><th>DATE</th><th>EMPLOYEE</th><th>PUNCH ID</th><th>FROM</th><th>TO</th><th>UPDATED BY</th></tr></thead>
        <tbody>{transferLog.map((entry) => <tr key={entry.id}>
          <td>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(entry.transferredAt))}</td>
          <td className="manpower-name">{entry.employeeName}</td>
          <td>{entry.employeePunchId}</td>
          <td>{entry.fromProjectName || "Unassigned"}</td>
          <td>{entry.toProjectName || "Unassigned"}</td>
          <td>{entry.transferredByName}</td>
        </tr>)}</tbody>
      </table></div> : <p className="empty-state">No project transfers recorded yet.</p>}
    </section>
    <section className="report-section" aria-labelledby="manpower-list-heading">
      <div className="section-heading">
        <div><h2 id="manpower-list-heading">Employee directory</h2><p>{people.length} of {total} manpower accounts</p></div>
      </div>
      <div className="filters">
        <label className="search-field manpower-search"><Search size={17} /><input aria-label="Search manpower" placeholder="Search by Punch ID, name, or designation..." value={query} onChange={(event) => onSearch(event.target.value)} /></label>
      </div>
      {canSelectAccounts && <div className="manpower-selection-toolbar">
        <span><strong>{selectedPunchIds.length}</strong> account{selectedPunchIds.length === 1 ? "" : "s"} selected</span>
        <button type="button" className="button button-secondary" disabled={!people.length || isDeletingSelection || isBulkTransferring} onClick={() => onToggleVisibleSelection(people, !allVisibleSelected)}>
          {allVisibleSelected ? "Deselect visible" : "Select visible"}
        </button>
        <button type="button" className="button button-secondary" disabled={!selectedPunchIds.length || isDeletingSelection || isBulkTransferring} onClick={onClearSelection}>Clear selection</button>
        {canTransferProjects && <button type="button" className="button button-secondary" disabled={!selectedPunchIds.length || isDeletingSelection || isBulkTransferring || Boolean(transferringManpowerPunchId)} onClick={onBulkTransfer}>
          <ArrowRightLeft size={15} />{isBulkTransferring ? "Transferring…" : "Transfer selected"}
        </button>}
        {canDeleteAccounts && <button type="button" className="button button-danger" disabled={!selectedPunchIds.length || isDeletingSelection || isBulkTransferring || Boolean(deletingManpowerPunchId)} onClick={onBulkDelete}>
          <Trash2 size={15} />{isDeletingSelection ? "Deleting…" : "Delete selected"}
        </button>}
      </div>}
      <div className="table-wrap">
        <table className="manpower-table">
          <thead><tr>{canSelectAccounts && <th><span className="sr-only">Select account</span></th>}<th>PUNCH ID</th><th>EMPLOYEE NAME</th><th>DESIGNATION</th><th>ROLE</th><th>PROJECT</th><th>PROJECT MANAGER</th>{canManagePasswords && <th>PASSWORD</th>}<th>ACCOUNT</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {people.map((person) => <tr key={person.punchId}>
              {canSelectAccounts && <td><input
                type="checkbox"
                className="manpower-selection-checkbox"
                aria-label={`Select ${person.name}`}
                checked={selectedIds.has(person.punchId)}
                disabled={isDeletingSelection || isBulkTransferring}
                onChange={(event) => onToggleSelection(person.punchId, event.target.checked)}
              /></td>}
              <td><span className="punch-id">{person.punchId}</span></td>
              <td className="manpower-name">{person.name}</td>
              <td>{person.designation}</td>
              <td>{person.adminAccess
                ? <span>Admin</span>
                : person.isProjectManager
                  ? <span className="project-manager-badge" title="Appointed Project Manager">Project Manager</span>
                  : <span>Employee</span>}</td>
              <td>
                {person.projectName
                  ? <span className="project-manager-badge">{person.projectName}</span>
                  : <span className="project-manager-none">Unassigned</span>}
              </td>
              <td>
                <div className="project-manager-assignment-cell">
                  {person.projectManagerProjects?.length ? <details className="project-manager-project-dropdown">
                    <summary>
                      {person.projectManagerProjects.length} assigned project{person.projectManagerProjects.length === 1 ? "" : "s"}
                      <ChevronDown size={13} aria-hidden="true" />
                    </summary>
                    <div className="project-manager-project-options">
                      {person.projectManagerProjects.map((project) => <span className="project-manager-badge" key={project.id}>{project.name}</span>)}
                      {canAssignProjectManagers && person.isProjectManager && person.active && <button type="button" className="text-button project-manager-assign-button" aria-label={`Add project for ${person.name}`} onClick={() => onAssignProjectManager(person)}>Add project</button>}
                    </div>
                  </details> : canAssignProjectManagers && person.isProjectManager && person.active
                    ? <button type="button" className="text-button project-manager-assign-button" aria-label={`Assign ${person.name}`} onClick={() => onAssignProjectManager(person)}>Assign</button>
                    : canAssignProjectManagers && person.active && !person.adminAccess
                      ? <button
                        type="button"
                        className="text-button project-manager-assign-button"
                        aria-label={`Appoint ${person.name} as Project Manager`}
                        disabled={updatingProjectManagerAccessPunchId !== null}
                        onClick={() => onToggleProjectManagerAccess(person)}
                      >Appoint</button>
                      : <span className="project-manager-none">—</span>}
                </div>
              </td>
              {canManagePasswords && <td><div className="report-actions">
                {person.adminAccess ? <span className="directory-status directory-status-static">Punch ID only</span> : <span className={`directory-status directory-status-static ${person.passwordSet ? "" : "directory-status-inactive"}`}><span />{person.passwordSet ? "Set" : "Not set"}</span>}
                {!person.adminAccess && <button type="button" className="download-button" aria-label={`${person.passwordSet ? "Reset" : "Set"} password for ${person.name}`} title={`${person.passwordSet ? "Reset" : "Set"} password`} onClick={() => onSetPassword(person)}><KeyRound size={15} /></button>}
              </div></td>}
              <td>
                {person.adminAccess || (person.isProjectManager && !canEditProjectAssignments)
                  ? <span className={`directory-status directory-status-static ${person.active ? "" : "directory-status-inactive"}`}><span />{person.active ? "Active" : "Inactive"}</span>
                  : <button type="button" className={`directory-status ${person.active ? "" : "directory-status-inactive"}`} aria-label={`Mark ${person.name} ${person.active ? "inactive" : "active"}`} aria-pressed={person.active} onClick={() => onToggleActive(person)}><span />{person.active ? "Active" : "Inactive"}</button>}
              </td>
              <td><div className="report-actions">
                <button className="download-button" aria-label={`View ${person.name}'s report log`} title="View report log" onClick={() => onViewReports(person)}><FileText size={15} /></button>
                {canTransferProjects && <button
                  type="button"
                  className="button button-secondary manpower-transfer-button"
                  aria-label={`Transfer ${person.name} to a project`}
                  title="Transfer to project"
                  disabled={transferringManpowerPunchId !== null || isDeletingSelection || isBulkTransferring}
                  onClick={() => onTransferPerson(person)}
                ><ArrowRightLeft size={14} /> Transfer</button>}
                {!person.adminAccess && <button className="download-button" aria-label={`Edit ${person.name}`} title="Edit account" onClick={() => onEdit(person)}><Pencil size={15} /></button>}
                {canDeleteAccounts && <button
                  type="button"
                  className="download-button delete-account-button"
                  aria-label={`Delete ${person.adminAccess ? "administrator" : "employee"} ${person.name}`}
                  title={`Delete ${person.adminAccess ? "administrator" : "employee"} account`}
                  disabled={deletingManpowerPunchId !== null || isDeletingSelection || isBulkTransferring}
                  onClick={() => onDeletePerson(person)}
                ><Trash2 size={15} /></button>}
              </div></td>
            </tr>)}
            {people.length === 0 && <tr><td className="empty-state" colSpan={8 + Number(canSelectAccounts) + Number(canManagePasswords)}><span className="empty-icon"><UsersRound size={20} /></span><strong>No manpower found</strong><span>Try a different search or add a manpower account.</span><button className="button button-secondary" onClick={onAdd}><Plus size={16} /> Add manpower</button></td></tr>}
          </tbody>
        </table>
      </div>
      <div className="table-footer"><span>Showing <strong>{people.length}</strong> of <strong>{total}</strong> accounts</span></div>
    </section>
  </section>;
}

createRoot(document.getElementById("root")).render(<App />);
