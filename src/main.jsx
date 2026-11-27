import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Archive,
  ArrowDownToLine,
  ArrowUpRight,
  Bell,
  BriefcaseBusiness,
  CalendarDays,
  Camera,
  Check,
  ChevronDown,
  CircleHelp,
  File,
  FileText,
  FolderKanban,
  Info,
  LayoutDashboard,
  LogOut,
  Menu,
  Pencil,
  Plus,
  Search,
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
          throw new Error("The authentication service is unavailable. Reports remain locked.");
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
  return <Workspace user={user} onLogout={signOut} />;
}

function Workspace({ user, onLogout }) {
  const [activePage, setActivePage] = useState("Overview");
  const [projects, setProjects] = useState([]);
  const [manpower, setManpower] = useState([]);
  const [manpowerSearch, setManpowerSearch] = useState("");
  const [reportLogPerson, setReportLogPerson] = useState(null);
  const [employeeReports, setEmployeeReports] = useState([]);
  const [isEmployeeReportsLoading, setIsEmployeeReportsLoading] = useState(false);
  const [employeeReportsError, setEmployeeReportsError] = useState("");
  const [summaryPopover, setSummaryPopover] = useState(null);
  const [projectFilter, setProjectFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [reports, setReports] = useState([]);
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [maxUploadBytes, setMaxUploadBytes] = useState(512 * 1024 * 1024);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [selectedReport, setSelectedReport] = useState(null);
  const [isProjectFormOpen, setIsProjectFormOpen] = useState(false);
  const [isManpowerFormOpen, setIsManpowerFormOpen] = useState(false);
  const [editingProject, setEditingProject] = useState(null);
  const [editingManpower, setEditingManpower] = useState(null);
  const [projectForm, setProjectForm] = useState({ name: "", description: "", color: "blue" });
  const [manpowerForm, setManpowerForm] = useState({ punchId: "", name: "", designation: "" });
  const [projectFormError, setProjectFormError] = useState("");
  const [manpowerFormError, setManpowerFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [form, setForm] = useState({ projectId: "", date: today, title: "", description: "" });
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [previewingUploadFile, setPreviewingUploadFile] = useState(null);
  const [isUploadConfirming, setIsUploadConfirming] = useState(false);
  const fileInput = useRef(null);
  const cameraInput = useRef(null);
  const profileMenuRef = useRef(null);
  const currentUser = user.name;
  const userInitials = currentUser.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const isAdministrator = user.role === "admin";
  const projectColors = ["blue", "orange", "green", "purple"];
  const projectOptions = [{ id: "all", name: "All projects" }, ...projects];
  const isSigningOut = useRef(false);

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
          apiRequest(isAdministrator ? "/api/reports" : "/api/reports/mine"),
          apiRequest("/api/config"),
        ]);
        const manpowerResult = isAdministrator ? await apiRequest("/api/manpower") : null;
        if (!active) return;
        setProjects(projectResult.data);
        setReports(reportResult.data);
        setMaxUploadBytes(configResult.maxUploadBytes);
        if (manpowerResult) setManpower(manpowerResult.data);
      } catch (error) {
        if (active) setNotice(error instanceof Error ? error.message : "Unable to load project data.");
      } finally {
        if (active) setIsDataLoading(false);
      }
    };

    void loadWorkspace();
    return () => { active = false; };
  }, [isAdministrator]);

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

  const filteredReports = useMemo(() => reports.filter((report) => {
    const projectMatches = projectFilter === "all" || report.projectId === projectFilter;
    const fileNames = report.files?.map((file) => file.fileName).join(" ") || report.fileName;
    const text = `${report.title} ${report.description} ${report.user} ${fileNames}`.toLowerCase();
    return projectMatches && (!search || text.includes(search.toLowerCase())) && (!dateFilter || report.date === dateFilter);
  }), [reports, projectFilter, search, dateFilter]);

  const filteredManpower = useMemo(() => manpower.filter((person) =>
    `${person.punchId} ${person.name} ${person.designation}`.toLowerCase().includes(manpowerSearch.trim().toLowerCase()),
  ), [manpower, manpowerSearch]);

  const openUpload = () => {
    setForm({ projectId: projectFilter === "all" ? "" : projectFilter, date: today, title: "", description: "" });
    setSelectedFiles([]);
    setIsUploadConfirming(false);
    setPreviewingUploadFile(null);
    if (fileInput.current) fileInput.current.value = "";
    if (cameraInput.current) cameraInput.current.value = "";
    setIsUploadOpen(true);
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
      ? { name: project.name, description: project.description || "", color: project.color }
      : { name: "", description: "", color: projectColors[projects.length % projectColors.length] });
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

    try {
      const result = await apiRequest(
        editingProject ? `/api/projects/${editingProject.id}` : "/api/projects",
        {
          method: editingProject ? "PUT" : "POST",
          body: { ...projectForm, name },
        },
      );
      if (editingProject) {
        setProjects((items) => items.map((project) => project.id === editingProject.id
          ? { ...result.data, reportCount: project.reportCount }
          : project));
        setNotice("Project details updated.");
      } else {
        setProjects((items) => [...items, result.data].sort((a, b) => a.name.localeCompare(b.name)));
        setNotice("Project added. You can now upload reports to it.");
      }
      setIsProjectFormOpen(false);
    } catch (error) {
      setProjectFormError(error instanceof Error ? error.message : "Unable to save the project.");
    }
    window.setTimeout(() => setNotice(""), 5000);
  };

  const openManpowerForm = (person = null) => {
    if (!isAdministrator) return;
    setEditingManpower(person);
    setManpowerForm(person
      ? { punchId: person.punchId, name: person.name, designation: person.designation }
      : { punchId: "", name: "", designation: "" });
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
        setManpower((items) => items.map((person) => person.punchId === editingManpower.punchId ? result.data : person));
        setNotice("Manpower account updated.");
      } else {
        setManpower((items) => [...items, result.data].sort((a, b) => a.name.localeCompare(b.name)));
        setNotice("Manpower account added.");
      }
      setIsManpowerFormOpen(false);
    } catch (error) {
      setManpowerFormError(error instanceof Error ? error.message : "Unable to save the manpower account.");
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
      setManpower((items) => items.map((item) => item.punchId === person.punchId ? result.data : item));
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

  const downloadReport = (report, attachment = report.files?.[0] || report) => {
    const link = document.createElement("a");
    link.href = attachment.id
      ? `/api/reports/${encodeURIComponent(report.id)}/files/${encodeURIComponent(attachment.id)}`
      : `/api/reports/${encodeURIComponent(report.id)}/file`;
    link.download = attachment.fileName || report.fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const archiveReport = async (report) => {
    if (!isAdministrator || !window.confirm(`Archive "${report.title}"?`)) return;
    try {
      await apiRequest(`/api/reports/${encodeURIComponent(report.id)}/archive`, { method: "POST" });
      setReports((items) => items.filter((item) => item.id !== report.id));
      setNotice("Report archived.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to archive the report.");
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
      setProjectFilter((current) => current === project.id ? "all" : current);
      setNotice("Project deleted.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to delete the project.");
    }
    window.setTimeout(() => setNotice(""), 5000);
  };

  const navigate = (page) => {
    if (page === "Manpower" && !isAdministrator) return;
    if ((page === "Reports" || page === "Projects") && !isAdministrator) return;
    setActivePage(page);
    setMobileNavOpen(false);
    if (page === "Projects") setProjectFilter("all");
  };

  const openFullReportLog = () => {
    if (!summaryPopover) return;
    if (isAdministrator) setActivePage("Reports");
    setProjectFilter(summaryPopover.kind === "project" ? summaryPopover.projectId : "all");
    setSearch("");
    setDateFilter(summaryPopover.kind === "today" ? today : "");
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
          {isAdministrator && <button className={`nav-item ${activePage === "Manpower" ? "nav-active" : ""}`} onClick={() => navigate("Manpower")}><UsersRound size={18} /><span>Manpower</span><span className="nav-count">{manpower.length}</span></button>}
        </nav>

        {isAdministrator && <>
          <div className="nav-label project-nav-label">YOUR PROJECTS <button aria-label="Add project" onClick={() => openProjectForm()}><Plus size={15} /></button></div>
          <nav className="project-nav" aria-label="Projects">
            {projectsWithReports.map((project) => (
              <button key={project.id} className={`nav-item project-nav-item ${projectFilter === project.id ? "nav-active" : ""}`} onClick={() => { setProjectFilter(project.id); navigate("Reports"); }}>
                <span className={`project-dot dot-${project.color}`} /><span>{project.shortName}</span>
              </button>
            ))}
          </nav>
        </>}

        <div className="sidebar-bottom">
          <button className="nav-item support-link" onClick={() => setNotice("Help center integration coming soon.")}><CircleHelp size={18} /><span>Help & support</span></button>
          <div className="sidebar-user">
            <div className="user-avatar">{userInitials}</div>
            <div className="user-details"><strong>{currentUser}</strong><small>{isAdministrator ? "Administrator" : `Punch ID ${user.punchId}`}</small></div>
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
                <div className="top-profile-summary"><strong>{currentUser}</strong><small>{isAdministrator ? "Administrator" : `Punch ID ${user.punchId}`}</small></div>
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
            <ManpowerPage people={filteredManpower} total={manpower.length} query={manpowerSearch} onSearch={setManpowerSearch} onAdd={() => openManpowerForm()} onEdit={openManpowerForm} onToggleActive={toggleManpowerActive} onViewReports={openEmployeeReportLog} />
          ) : activePage === "Projects" ? (
            <ProjectsPage
              projects={projectsWithReports}
              reports={reports}
              onSelect={(id) => { setProjectFilter(id); navigate("Reports"); }}
              onCreate={() => openProjectForm()}
              onEdit={openProjectForm}
              onDelete={deleteProject}
              canManage={isAdministrator}
            />
          ) : (
            <>
              <section className="page-heading">
                <div>
                  <div className="eyebrow"><span className="eyebrow-dot" /> PROJECT REPORTS</div>
                  <h1>{!isAdministrator ? "My report log" : activePage === "Overview" ? `Good morning, ${currentUser.split(/\s+/)[0]}` : "Reports"}</h1>
                  <p>{!isAdministrator ? "Review your submitted reports, organized by report date." : activePage === "Overview" ? "A clear view of updates across all your projects." : "Browse, filter, and download reports shared by your team."}</p>
                </div>
                <button className="button button-primary" onClick={openUpload}><Upload size={17} /> Upload report</button>
              </section>

              {activePage === "Overview" && <SummaryCards reports={reports} projects={projectsWithReports} onSelect={(kind) => setSummaryPopover({ kind })} />}

              <section className="report-section" id="report-log">
                <div className="section-heading">
                  <div>
                    <h2>{!isAdministrator ? "Dated report log" : projectFilter === "all" ? "Recent reports" : projects.find((project) => project.id === projectFilter)?.name}</h2>
                    <p>{filteredReports.length} reports {!isAdministrator ? "in your history" : projectFilter !== "all" ? "in this project" : "across your projects"}</p>
                  </div>
                  {activePage === "Overview" && isAdministrator && <button className="text-button" onClick={() => navigate("Reports")}>View all reports <ArrowUpRight size={15} /></button>}
                </div>

                <div className="filters">
                  <label className="search-field"><Search size={17} /><input aria-label="Search reports" placeholder="Search reports..." value={search} onChange={(event) => setSearch(event.target.value)} /><kbd>⌘ K</kbd></label>
                  <label className="select-field"><BriefcaseBusiness size={16} /><select aria-label="Filter by project" value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}>{projectOptions.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select><ChevronDown size={15} /></label>
                  <label className="date-filter"><CalendarDays size={16} /><input aria-label="Filter by date" type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} />{dateFilter && <button aria-label="Clear date filter" onClick={() => setDateFilter("")}><X size={14} /></button>}</label>
                </div>

                <div className="table-wrap">
                  <table className="report-history-table">
                    <thead><tr><th>REPORT</th><th>PROJECT</th>{isAdministrator && <th>UPLOADED BY</th>}<th>DATE</th><th>FILE</th><th><span className="sr-only">Actions</span></th></tr></thead>
                    <tbody>
                      {filteredReports.map((report) => {
                        const project = projects.find((item) => item.id === report.projectId);
                        return <tr key={report.id}>
                          <td className="report-cell"><span className="file-icon"><FileText size={18} /></span><button className="report-copy report-open" onClick={() => setSelectedReport(report)} aria-label={`View details for ${report.title}`}><strong>{report.title}</strong><small>{report.description || "View report details"}</small></button></td>
                          <td data-label="Project"><span className={`project-tag tag-${project?.color}`}>{project?.shortName}</span></td>
                          {isAdministrator && <td data-label="Uploaded by"><span className="uploader"><span className="mini-avatar">{report.user.split(" ").map((part) => part[0]).join("")}</span>{report.user}</span></td>}
                          <td className="date-cell" data-label="Date">{formatDate(report.date)}</td>
                          <td data-label="Files"><span className="file-meta"><span>{report.files?.length > 1 ? `${report.files.length} files` : report.type}</span>{report.files?.length > 1 ? "Multiple" : report.fileSize}</span></td>
                          <td className="report-action-cell"><div className="report-actions">
                            <button className="download-button" aria-label={`Details for ${report.title}`} title="Report details" onClick={() => setSelectedReport(report)}><Info size={16} /></button>
                            <button className="download-button" aria-label={`Download ${report.fileName}`} title="Download file" onClick={() => downloadReport(report)}><ArrowDownToLine size={17} /></button>
                            {isAdministrator && <button className="download-button" aria-label={`Archive ${report.title}`} title="Archive report" onClick={() => archiveReport(report)}><Archive size={16} /></button>}
                          </div></td>
                        </tr>;
                      })}
                      {filteredReports.length === 0 && <tr><td className="empty-state" colSpan={isAdministrator ? 6 : 5}><span className="empty-icon"><File size={20} /></span><strong>{isAdministrator ? "No reports found" : "Your report log is empty"}</strong><span>{isAdministrator ? "Try changing your filters or upload a new report." : "Once you submit a report, it will appear here by date."}</span><button className="button button-secondary" onClick={openUpload}><Plus size={16} /> Upload a report</button></td></tr>}
                    </tbody>
                  </table>
                </div>
                <div className="table-footer"><span>Showing <strong>{filteredReports.length}</strong> of <strong>{reports.length}</strong> reports</span><span className="table-footer-note">{isAdministrator ? <><UsersRound size={15} /> Shared workspace</> : <><ShieldCheck size={15} /> Only you and administrators can see these reports</>}</span></div>
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
          <div className="modal-heading"><div><span className="modal-icon"><FileText size={19} /></span><div><h2 id="report-detail-title">{selectedReport.title}</h2><p>Report details and attached document</p></div></div><button className="icon-button" aria-label="Close report details" onClick={() => setSelectedReport(null)}><X size={19} /></button></div>
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
              <div><h2 id="manpower-form-title">{editingManpower ? "Edit manpower account" : "Add manpower account"}</h2><p>Manage the employee directory using Punch IDs.</p></div>
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
    </div>
  );
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

function ProjectsPage({ projects: projectList, reports, onSelect, onCreate, onEdit, onDelete, canManage }) {
  return <section className="projects-page">
    <div className="page-heading">
      <div><div className="eyebrow"><span className="eyebrow-dot" /> WORKSPACE</div><h1>Your projects</h1><p>Choose a project to see its reports and updates.</p></div>
      {canManage && <button className="button button-primary" onClick={onCreate}><Plus size={17} /> New project</button>}
    </div>
    <div className="project-cards">{projectList.map((project) => {
      const count = Number(project.reportCount ?? reports.filter((report) => report.projectId === project.id).length);
      return <article className="project-card" key={project.id}>
        <button className="project-card-open" onClick={() => onSelect(project.id)} aria-label={`Open ${project.name} reports`}>
          <span className={`project-card-icon card-${project.color}`}><FolderKanban size={20} /></span>
          <strong>{project.name}</strong><span className="project-card-location">{project.description || "Construction project"}</span>
          <span className="project-card-meta"><FileText size={15} /> {count} {count === 1 ? "report" : "reports"} <span className="project-card-status"><span className="trend-dot" /> Active</span></span>
        </button>
        {canManage && <>
          <button className="project-card-edit" aria-label={`Edit ${project.name}`} title="Edit project" onClick={() => onEdit(project)}><Pencil size={15} /></button>
          <button className="project-card-delete" aria-label={`Delete ${project.name}`} title="Delete project" onClick={() => onDelete(project)}><Trash2 size={15} /></button>
        </>}
      </article>;
    })}</div>
    <div className="projects-help"><ShieldCheck size={17} /><span>Project membership and access will be managed through your organization’s Punch ID account.</span></div>
  </section>;
}

function ManpowerPage({ people, total, query, onSearch, onAdd, onEdit, onToggleActive, onViewReports }) {
  return <section className="manpower-page">
    <div className="page-heading">
      <div>
        <div className="eyebrow"><span className="eyebrow-dot" /> ACCOUNT MANAGEMENT</div>
        <h1>Manpower accounts</h1>
        <p>Existing employees indexed by their Punch ID.</p>
      </div>
      <button className="button button-primary" onClick={onAdd}><Plus size={17} /> Add manpower</button>
    </div>
    <section className="report-section" aria-labelledby="manpower-list-heading">
      <div className="section-heading">
        <div><h2 id="manpower-list-heading">Employee directory</h2><p>{people.length} of {total} manpower accounts</p></div>
      </div>
      <div className="filters">
        <label className="search-field manpower-search"><Search size={17} /><input aria-label="Search manpower" placeholder="Search by Punch ID, name, or designation..." value={query} onChange={(event) => onSearch(event.target.value)} /></label>
      </div>
      <div className="table-wrap">
        <table className="manpower-table">
          <thead><tr><th>PUNCH ID</th><th>EMPLOYEE NAME</th><th>DESIGNATION</th><th>ACCOUNT</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {people.map((person) => <tr key={person.punchId}>
              <td><span className="punch-id">{person.punchId}</span></td>
              <td className="manpower-name">{person.name}</td>
              <td>{person.designation}</td>
              <td><button type="button" className={`directory-status ${person.active ? "" : "directory-status-inactive"}`} aria-label={`Mark ${person.name} ${person.active ? "inactive" : "active"}`} aria-pressed={person.active} onClick={() => onToggleActive(person)}><span />{person.active ? "Active" : "Inactive"}</button></td>
              <td><div className="report-actions"><button className="download-button" aria-label={`View ${person.name}'s report log`} title="View report log" onClick={() => onViewReports(person)}><FileText size={15} /></button><button className="download-button" aria-label={`Edit ${person.name}`} title="Edit account" onClick={() => onEdit(person)}><Pencil size={15} /></button></div></td>
            </tr>)}
            {people.length === 0 && <tr><td className="empty-state" colSpan="5"><span className="empty-icon"><UsersRound size={20} /></span><strong>No manpower found</strong><span>Try a different search or add a manpower account.</span><button className="button button-secondary" onClick={onAdd}><Plus size={16} /> Add manpower</button></td></tr>}
          </tbody>
        </table>
      </div>
      <div className="table-footer"><span>Showing <strong>{people.length}</strong> of <strong>{total}</strong> accounts</span><span className="table-footer-note"><ShieldCheck size={15} /> Status changes are temporary until connected to the server</span></div>
    </section>
  </section>;
}

createRoot(document.getElementById("root")).render(<App />);
