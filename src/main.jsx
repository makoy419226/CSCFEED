import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Archive,
  ArrowDownToLine,
  ArrowUpRight,
  Bell,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ChevronDown,
  CircleHelp,
  File,
  FileText,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Menu,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
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
  const [projectFilter, setProjectFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [reports, setReports] = useState([]);
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [maxUploadBytes, setMaxUploadBytes] = useState(512 * 1024 * 1024);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
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
  const [form, setForm] = useState({ projectId: "", date: today, title: "", description: "" });
  const [selectedFile, setSelectedFile] = useState(null);
  const fileInput = useRef(null);
  const currentUser = user.name;
  const userInitials = currentUser.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const isAdministrator = user.role === "admin";
  const projectColors = ["blue", "orange", "green", "purple"];
  const projectOptions = [{ id: "all", name: "All projects" }, ...projects];

  useEffect(() => {
    let active = true;
    const loadWorkspace = async () => {
      try {
        const [projectResult, reportResult, configResult] = await Promise.all([
          apiRequest("/api/projects"),
          apiRequest("/api/reports"),
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

  const filteredReports = useMemo(() => reports.filter((report) => {
    const projectMatches = projectFilter === "all" || report.projectId === projectFilter;
    const text = `${report.title} ${report.description} ${report.user} ${report.fileName}`.toLowerCase();
    return projectMatches && (!search || text.includes(search.toLowerCase())) && (!dateFilter || report.date === dateFilter);
  }), [reports, projectFilter, search, dateFilter]);

  const filteredManpower = useMemo(() => manpower.filter((person) =>
    `${person.punchId} ${person.name} ${person.designation}`.toLowerCase().includes(manpowerSearch.trim().toLowerCase()),
  ), [manpower, manpowerSearch]);

  const openUpload = () => {
    setForm({ projectId: projectFilter === "all" ? "" : projectFilter, date: today, title: "", description: "" });
    setSelectedFile(null);
    if (fileInput.current) fileInput.current.value = "";
    setIsUploadOpen(true);
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
        setProjects((items) => items.map((project) => project.id === editingProject.id ? result.data : project));
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

  const submitReport = async (event) => {
    event.preventDefault();
    if (!selectedFile) return;
    if (selectedFile.size > maxUploadBytes) {
      setNotice(`Choose a file smaller than ${formatUploadLimit(maxUploadBytes)}.`);
      return;
    }

    const body = new FormData();
    body.append("projectId", form.projectId);
    body.append("reportDate", form.date);
    body.append("title", form.title);
    body.append("description", form.description);
    body.append("file", selectedFile);

    setIsUploading(true);
    try {
      const result = await apiRequest("/api/reports", { method: "POST", body });
      setReports((items) => [result.data, ...items]);
      setProjectFilter(form.projectId);
      setIsUploadOpen(false);
      setSelectedFile(null);
      setNotice(result.notification === "failed"
        ? "Report was uploaded, but its email notification failed."
        : "Report uploaded and shared with the project.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to upload the report.");
    } finally {
      setIsUploading(false);
    }
    window.setTimeout(() => setNotice(""), 5000);
  };

  const downloadReport = (report) => {
    const link = document.createElement("a");
    link.href = `/api/reports/${encodeURIComponent(report.id)}/file`;
    link.download = report.fileName;
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

  const navigate = (page) => {
    if (page === "Manpower" && !isAdministrator) return;
    setActivePage(page);
    setMobileNavOpen(false);
    if (page === "Projects") setProjectFilter("all");
  };

  const projectsWithReports = projects;

  return (
    <div className="app-shell">
      {mobileNavOpen && <button className="mobile-backdrop" aria-label="Close menu" onClick={() => setMobileNavOpen(false)} />}
      <aside className={`sidebar ${mobileNavOpen ? "sidebar-open" : ""}`}>
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); navigate("Overview"); }}>
          <img className="brand-logo" src="/concord-logo.png" alt="Concord logo" />
          <span className="brand-name">CSC Feed</span>
        </a>

        <div className="workspace-switcher">
          <span className="workspace-avatar">CS</span>
          <span className="workspace-copy"><strong>Construction Studio</strong><small>Workspace</small></span>
          <ChevronDown size={16} className="workspace-chevron" />
        </div>

        <div className="nav-label">WORKSPACE</div>
        <nav className="main-nav" aria-label="Main navigation">
          <button className={`nav-item ${activePage === "Overview" ? "nav-active" : ""}`} onClick={() => navigate("Overview")}><LayoutDashboard size={18} /><span>Overview</span></button>
          <button className={`nav-item ${activePage === "Reports" ? "nav-active" : ""}`} onClick={() => navigate("Reports")}><FileText size={18} /><span>Reports</span><span className="nav-count">{reports.length}</span></button>
          <button className={`nav-item ${activePage === "Projects" ? "nav-active" : ""}`} onClick={() => navigate("Projects")}><FolderKanban size={18} /><span>Projects</span></button>
          {isAdministrator && <button className={`nav-item ${activePage === "Manpower" ? "nav-active" : ""}`} onClick={() => navigate("Manpower")}><UsersRound size={18} /><span>Manpower</span><span className="nav-count">{manpower.length}</span></button>}
        </nav>

        <div className="nav-label project-nav-label">YOUR PROJECTS {isAdministrator && <button aria-label="Add project" onClick={() => openProjectForm()}><Plus size={15} /></button>}</div>
        <nav className="project-nav" aria-label="Projects">
          {projectsWithReports.map((project) => (
            <button key={project.id} className={`nav-item project-nav-item ${projectFilter === project.id ? "nav-active" : ""}`} onClick={() => { setProjectFilter(project.id); navigate("Reports"); }}>
              <span className={`project-dot dot-${project.color}`} /><span>{project.shortName}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <button className="nav-item support-link" onClick={() => setNotice("Help center integration coming soon.")}><CircleHelp size={18} /><span>Help & support</span></button>
          <div className="sidebar-user">
            <div className="user-avatar">{userInitials}</div>
            <div className="user-details"><strong>{currentUser}</strong><small>{isAdministrator ? "Administrator" : `Punch ID ${user.punchId}`}</small></div>
            <button className="user-more" aria-label="Sign out" title="Sign out" onClick={() => {
              onLogout().catch((error) => {
                setNotice(error instanceof Error ? error.message : "Unable to sign out.");
                window.setTimeout(() => setNotice(""), 5000);
              });
            }}><LogOut size={16} /></button>
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
            <button className="top-user" title="Signed-in account"><span className="user-avatar small-avatar">{userInitials}</span><ChevronDown size={15} /></button>
          </div>
        </header>

        <div className="page-content">
          {isDataLoading ? (
            <div className="auth-loading" role="status">Loading workspace data…</div>
          ) : activePage === "Manpower" && isAdministrator ? (
            <ManpowerPage people={filteredManpower} total={manpower.length} query={manpowerSearch} onSearch={setManpowerSearch} onAdd={() => openManpowerForm()} onEdit={openManpowerForm} onToggleActive={toggleManpowerActive} />
          ) : activePage === "Projects" ? (
            <ProjectsPage
              projects={projectsWithReports}
              reports={reports}
              onSelect={(id) => { setProjectFilter(id); navigate("Reports"); }}
              onCreate={() => openProjectForm()}
              onEdit={openProjectForm}
              canManage={isAdministrator}
            />
          ) : (
            <>
              <section className="page-heading">
                <div>
                  <div className="eyebrow"><span className="eyebrow-dot" /> PROJECT REPORTS</div>
                  <h1>{activePage === "Overview" ? `Good morning, ${currentUser.split(/\s+/)[0]}` : "Reports"}</h1>
                  <p>{activePage === "Overview" ? "A clear view of updates across all your projects." : "Browse, filter, and download reports shared by your team."}</p>
                </div>
                <button className="button button-primary" onClick={openUpload}><Upload size={17} /> Upload report</button>
              </section>

              {activePage === "Overview" && <SummaryCards reports={reports} projects={projectsWithReports} />}

              <section className="report-section">
                <div className="section-heading">
                  <div>
                    <h2>{projectFilter === "all" ? "Recent reports" : projects.find((project) => project.id === projectFilter)?.name}</h2>
                    <p>{filteredReports.length} reports {projectFilter !== "all" ? "in this project" : "across your projects"}</p>
                  </div>
                  {activePage === "Overview" && <button className="text-button" onClick={() => navigate("Reports")}>View all reports <ArrowUpRight size={15} /></button>}
                </div>

                <div className="filters">
                  <label className="search-field"><Search size={17} /><input aria-label="Search reports" placeholder="Search reports..." value={search} onChange={(event) => setSearch(event.target.value)} /><kbd>⌘ K</kbd></label>
                  <label className="select-field"><BriefcaseBusiness size={16} /><select aria-label="Filter by project" value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}>{projectOptions.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select><ChevronDown size={15} /></label>
                  <label className="date-filter"><CalendarDays size={16} /><input aria-label="Filter by date" type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} />{dateFilter && <button aria-label="Clear date filter" onClick={() => setDateFilter("")}><X size={14} /></button>}</label>
                </div>

                <div className="table-wrap">
                  <table>
                    <thead><tr><th>REPORT</th><th>PROJECT</th><th>UPLOADED BY</th><th>DATE</th><th>FILE</th><th><span className="sr-only">Actions</span></th></tr></thead>
                    <tbody>
                      {filteredReports.map((report) => {
                        const project = projects.find((item) => item.id === report.projectId);
                        return <tr key={report.id}>
                          <td className="report-cell"><span className="file-icon"><FileText size={18} /></span><span className="report-copy"><strong>{report.title}</strong><small>{report.description}</small></span></td>
                          <td><span className={`project-tag tag-${project?.color}`}>{project?.shortName}</span></td>
                          <td><span className="uploader"><span className="mini-avatar">{report.user.split(" ").map((part) => part[0]).join("")}</span>{report.user}</span></td>
                          <td className="date-cell">{formatDate(report.date)}</td>
                          <td><span className="file-meta"><span>{report.type}</span>{report.fileSize}</span></td>
                          <td><div className="report-actions">
                            <button className="download-button" aria-label={`Download ${report.fileName}`} title="Download file" onClick={() => downloadReport(report)}><ArrowDownToLine size={17} /></button>
                            {isAdministrator && <button className="download-button" aria-label={`Archive ${report.title}`} title="Archive report" onClick={() => archiveReport(report)}><Archive size={16} /></button>}
                          </div></td>
                        </tr>;
                      })}
                      {filteredReports.length === 0 && <tr><td className="empty-state" colSpan="6"><span className="empty-icon"><File size={20} /></span><strong>No reports found</strong><span>Try changing your filters or upload a new report.</span><button className="button button-secondary" onClick={openUpload}><Plus size={16} /> Upload a report</button></td></tr>}
                    </tbody>
                  </table>
                </div>
                <div className="table-footer"><span>Showing <strong>{filteredReports.length}</strong> of <strong>{reports.length}</strong> reports</span><span className="table-footer-note"><UsersRound size={15} /> Shared workspace</span></div>
              </section>

              <div className="integration-note"><ShieldCheck size={17} /><span><strong>One login for every project.</strong> Reports are stored on this server and shared with authenticated project users.</span><button onClick={() => setNotice("Email notifications can be configured by the administrator.")}>Notifications <ArrowUpRight size={14} /></button></div>
            </>
          )}
        </div>
      </main>

      {notice && <div className="toast" role="status"><Check size={17} /><span>{notice}</span><button aria-label="Dismiss message" onClick={() => setNotice("")}><X size={16} /></button></div>}

      {isUploadOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setIsUploadOpen(false); }}>
        <section className="upload-modal" role="dialog" aria-modal="true" aria-labelledby="upload-title">
          <div className="modal-heading"><div><span className="modal-icon"><Upload size={19} /></span><div><h2 id="upload-title">Upload a report</h2><p>Share a file with everyone on the project.</p></div></div><button className="icon-button" aria-label="Close upload form" onClick={() => setIsUploadOpen(false)}><X size={19} /></button></div>
          <form onSubmit={submitReport}>
            <label className="form-label">Project <span className="required">*</span>
              <select required value={form.projectId} onChange={(event) => setForm({ ...form, projectId: event.target.value })}><option value="" disabled>Select a project</option>{projectsWithReports.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
            </label>
            <div className="form-grid">
              <label className="form-label">Report date <span className="required">*</span><input type="date" required value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></label>
              <label className="form-label">Uploaded by<input value={`${currentUser} · Punch ID`} readOnly /></label>
            </div>
            <label className="form-label">Report title <span className="required">*</span><input required maxLength="100" placeholder="e.g. Weekly site progress report" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
            <label className="form-label">Description <span className="optional">(optional)</span><textarea rows="3" maxLength="500" placeholder="Add a short note about this report..." value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
            <div className="form-label">Attach a file <span className="required">*</span>
              <div role="button" tabIndex="0" aria-label="Choose or drop a report file" className={`drop-zone ${selectedFile ? "drop-zone-selected" : ""}`} onClick={() => fileInput.current?.click()} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); fileInput.current?.click(); } }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); setSelectedFile(event.dataTransfer.files[0] || null); }}>
                <span className="drop-icon">{selectedFile ? <Check size={19} /> : <Upload size={19} />}</span>
                <strong>{selectedFile ? selectedFile.name : "Choose a file or drag it here"}</strong>
                <small>{selectedFile ? `${(selectedFile.size / (1024 * 1024)).toFixed(2)} MB · Ready to upload` : `Technical files supported · Max ${formatUploadLimit(maxUploadBytes)}`}</small>
              </div>
              <input ref={fileInput} className="sr-only" aria-label="Choose a report file" type="file" onChange={(event) => setSelectedFile(event.target.files?.[0] || null)} />
              {selectedFile && selectedFile.size > maxUploadBytes && <span className="field-error" role="alert">Please choose a file smaller than {formatUploadLimit(maxUploadBytes)}.</span>}
            </div>
            <div className="modal-footer"><span><ShieldCheck size={15} /> Visible to signed-in users</span><div><button type="button" className="button button-secondary" onClick={() => setIsUploadOpen(false)} disabled={isUploading}>Cancel</button><button type="submit" className="button button-primary" disabled={!selectedFile || selectedFile.size > maxUploadBytes || isUploading}><Upload size={16} /> {isUploading ? "Uploading…" : "Add report"}</button></div></div>
          </form>
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
              <input autoFocus required maxLength="80" placeholder="e.g. Harbor Point Residences" value={projectForm.name} onChange={(event) => { setProjectForm({ ...projectForm, name: event.target.value }); setProjectFormError(""); }} />
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

function SummaryCards({ reports, projects }) {
  const todayReports = reports.filter((report) => report.date === today).length;
  return <section className="summary-grid" aria-label="Workspace summary">
    <article className="summary-card"><span className="summary-icon summary-blue"><FileText size={18} /></span><span className="summary-copy"><small>Total reports</small><strong>{reports.length}</strong><em>Across all projects</em></span><span className="summary-trend"><ArrowUpRight size={15} /> All time</span></article>
    <article className="summary-card"><span className="summary-icon summary-green"><FolderKanban size={18} /></span><span className="summary-copy"><small>Active projects</small><strong>{projects.length}</strong><em>In your workspace</em></span><span className="summary-trend"><span className="trend-dot" /> Active</span></article>
    <article className="summary-card"><span className="summary-icon summary-purple"><CalendarDays size={18} /></span><span className="summary-copy"><small>Added today</small><strong>{todayReports}</strong><em>New project updates</em></span><span className="summary-trend">{formatDate(today)}</span></article>
  </section>;
}

function ProjectsPage({ projects: projectList, reports, onSelect, onCreate, onEdit, canManage }) {
  return <section className="projects-page">
    <div className="page-heading">
      <div><div className="eyebrow"><span className="eyebrow-dot" /> WORKSPACE</div><h1>Your projects</h1><p>Choose a project to see its reports and updates.</p></div>
      {canManage && <button className="button button-primary" onClick={onCreate}><Plus size={17} /> New project</button>}
    </div>
    <div className="project-cards">{projectList.map((project) => {
      const count = reports.filter((report) => report.projectId === project.id).length;
      return <article className="project-card" key={project.id}>
        <button className="project-card-open" onClick={() => onSelect(project.id)} aria-label={`Open ${project.name} reports`}>
          <span className={`project-card-icon card-${project.color}`}><FolderKanban size={20} /></span>
          <strong>{project.name}</strong><span className="project-card-location">{project.description || "Construction project"}</span>
          <span className="project-card-meta"><FileText size={15} /> {count} {count === 1 ? "report" : "reports"} <span className="project-card-status"><span className="trend-dot" /> Active</span></span>
        </button>
        {canManage && <button className="project-card-edit" aria-label={`Edit ${project.name}`} title="Edit project" onClick={() => onEdit(project)}><Pencil size={15} /></button>}
      </article>;
    })}</div>
    <div className="projects-help"><ShieldCheck size={17} /><span>Project membership and access will be managed through your organization’s Punch ID account.</span></div>
  </section>;
}

function ManpowerPage({ people, total, query, onSearch, onAdd, onEdit, onToggleActive }) {
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
              <td><button className="download-button" aria-label={`Edit ${person.name}`} title="Edit account" onClick={() => onEdit(person)}><Pencil size={15} /></button></td>
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
