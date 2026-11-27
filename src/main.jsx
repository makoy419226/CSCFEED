import React, { useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Bell,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ChevronDown,
  CircleHelp,
  ClipboardList,
  File,
  FileText,
  FolderKanban,
  LayoutDashboard,
  Menu,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Upload,
  UsersRound,
  X,
} from "lucide-react";
import "./styles.css";

const initialProjects = [
  { id: "harbor", name: "Harbor Point Residences", shortName: "Harbor Point", color: "blue" },
  { id: "northline", name: "Northline Logistics Hub", shortName: "Northline Hub", color: "orange" },
  { id: "cedar", name: "Cedar Grove School", shortName: "Cedar Grove", color: "green" },
  { id: "metro", name: "Metro West Utilities", shortName: "Metro West", color: "purple" },
];

function formatInputDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const today = formatInputDate(new Date());
const currentUser = "Maya Santos";

function formatDate(value) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${value}T12:00:00`));
}

function App() {
  const [activePage, setActivePage] = useState("Overview");
  const [projects, setProjects] = useState(initialProjects);
  const [projectFilter, setProjectFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [reports, setReports] = useState([]);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isProjectFormOpen, setIsProjectFormOpen] = useState(false);
  const [editingProject, setEditingProject] = useState(null);
  const [projectForm, setProjectForm] = useState({ name: "", description: "", color: "blue" });
  const [projectFormError, setProjectFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [form, setForm] = useState({ projectId: "", date: today, title: "", description: "" });
  const [selectedFile, setSelectedFile] = useState(null);
  const [downloadableFiles, setDownloadableFiles] = useState({});
  const fileInput = useRef(null);
  const projectColors = ["blue", "orange", "green", "purple"];
  const projectOptions = [{ id: "all", name: "All projects" }, ...projects];

  const filteredReports = useMemo(() => reports.filter((report) => {
    const projectMatches = projectFilter === "all" || report.projectId === projectFilter;
    const text = `${report.title} ${report.description} ${report.user} ${report.fileName}`.toLowerCase();
    return projectMatches && (!search || text.includes(search.toLowerCase())) && (!dateFilter || report.date === dateFilter);
  }), [reports, projectFilter, search, dateFilter]);

  const openUpload = () => {
    setForm({ projectId: projectFilter === "all" ? "" : projectFilter, date: today, title: "", description: "" });
    setSelectedFile(null);
    if (fileInput.current) fileInput.current.value = "";
    setIsUploadOpen(true);
  };

  const openProjectForm = (project = null) => {
    setEditingProject(project);
    setProjectForm(project
      ? { name: project.name, description: project.description || "", color: project.color }
      : { name: "", description: "", color: projectColors[projects.length % projectColors.length] });
    setProjectFormError("");
    setIsProjectFormOpen(true);
  };

  const submitProject = (event) => {
    event.preventDefault();
    const name = projectForm.name.trim();
    if (!name) return;
    const alreadyExists = projects.some((project) =>
      project.id !== editingProject?.id && project.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
    );
    if (alreadyExists) {
      setProjectFormError("A project with this name already exists.");
      return;
    }

    const shortName = name.split(/\s+/).slice(0, 2).join(" ");
    if (editingProject) {
      setProjects((items) => items.map((project) => project.id === editingProject.id
        ? { ...project, ...projectForm, name, shortName }
        : project));
      setNotice("Project details updated.");
    } else {
      const newProject = {
        id: `project-${Date.now().toString(36)}`,
        ...projectForm,
        name,
        shortName,
      };
      setProjects((items) => [...items, newProject]);
      setNotice("Project added. You can now upload reports to it.");
    }

    setIsProjectFormOpen(false);
    window.setTimeout(() => setNotice(""), 5000);
  };

  const submitReport = (event) => {
    event.preventDefault();
    if (!selectedFile) return;
    const extension = selectedFile.name.split(".").pop()?.toUpperCase() || "FILE";
    const newReport = {
      id: Date.now(),
      ...form,
      user: currentUser,
      fileName: selectedFile.name,
      fileSize: `${(selectedFile.size / (1024 * 1024)).toFixed(1)} MB`,
      type: extension,
    };
    setReports((items) => [newReport, ...items]);
    setDownloadableFiles((items) => ({ ...items, [newReport.id]: selectedFile }));
    setProjectFilter(form.projectId);
    setIsUploadOpen(false);
    setNotice("Report added to this session. Connect storage to share it with your team.");
    window.setTimeout(() => setNotice(""), 5000);
  };

  const downloadReport = (report) => {
    const file = downloadableFiles[report.id];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = report.fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const navigate = (page) => {
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
          <span className="brand-mark"><ClipboardList size={20} /></span>
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
        </nav>

        <div className="nav-label project-nav-label">YOUR PROJECTS <button aria-label="Add project" onClick={() => openProjectForm()}><Plus size={15} /></button></div>
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
            <div className="user-avatar">MS</div>
            <div className="user-details"><strong>{currentUser}</strong><small>Punch ID · Demo</small></div>
            <button className="user-more" aria-label="Account options"><ChevronDown size={16} /></button>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <button className="mobile-menu" aria-label="Open menu" onClick={() => setMobileNavOpen(true)}><Menu size={21} /></button>
          <div className="breadcrumbs"><span>Workspace</span><span className="crumb-slash">/</span><strong>{activePage}</strong></div>
          <div className="topbar-actions">
            <span className="secure-label"><ShieldCheck size={15} /> Punch ID ready</span>
            <button className="icon-button notification-button" aria-label="Notifications" onClick={() => setNotice("You’re all caught up.")}><Bell size={18} /><span className="notification-dot" /></button>
            <button className="top-user" title="Punch ID account"><span className="user-avatar small-avatar">MS</span><ChevronDown size={15} /></button>
          </div>
        </header>

        <div className="page-content">
          {activePage === "Projects" ? (
            <ProjectsPage
              projects={projectsWithReports}
              reports={reports}
              onSelect={(id) => { setProjectFilter(id); navigate("Reports"); }}
              onCreate={() => openProjectForm()}
              onEdit={openProjectForm}
            />
          ) : (
            <>
              <section className="page-heading">
                <div>
                  <div className="eyebrow"><span className="eyebrow-dot" /> PROJECT REPORTS</div>
                  <h1>{activePage === "Overview" ? "Good morning, Maya" : "Reports"}</h1>
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
                          <td><button className="download-button" aria-label={`Download ${report.fileName}`} title={downloadableFiles[report.id] ? "Download file" : "File storage will be connected"} disabled={!downloadableFiles[report.id]} onClick={() => downloadReport(report)}><ArrowDownToLine size={17} /></button></td>
                        </tr>;
                      })}
                      {filteredReports.length === 0 && <tr><td className="empty-state" colSpan="6"><span className="empty-icon"><File size={20} /></span><strong>No reports found</strong><span>Try changing your filters or upload a new report.</span><button className="button button-secondary" onClick={openUpload}><Plus size={16} /> Upload a report</button></td></tr>}
                    </tbody>
                  </table>
                </div>
                <div className="table-footer"><span>Showing <strong>{filteredReports.length}</strong> of <strong>{reports.length}</strong> reports</span><span className="table-footer-note"><UsersRound size={15} /> Shared workspace</span></div>
              </section>

              <div className="integration-note"><ShieldCheck size={17} /><span><strong>One login for every project.</strong> Punch ID sign-in and shared cloud storage will be connected during setup.</span><button onClick={() => setNotice("Punch ID single sign-on will be configured for your organization.")}>Learn more <ArrowUpRight size={14} /></button></div>
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
                <small>{selectedFile ? `${(selectedFile.size / (1024 * 1024)).toFixed(2)} MB · Ready to upload` : "PDF, Word, Excel, CSV, or image · Max 25 MB"}</small>
              </div>
              <input ref={fileInput} className="sr-only" aria-label="Choose a report file" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.png,.jpg,.jpeg" onChange={(event) => setSelectedFile(event.target.files?.[0] || null)} />
              {selectedFile && selectedFile.size > 25 * 1024 * 1024 && <span className="field-error" role="alert">Please choose a file smaller than 25 MB.</span>}
            </div>
            <div className="modal-footer"><span><ShieldCheck size={15} /> Visible to project members</span><div><button type="button" className="button button-secondary" onClick={() => setIsUploadOpen(false)}>Cancel</button><button type="submit" className="button button-primary" disabled={!selectedFile || selectedFile.size > 25 * 1024 * 1024}><Upload size={16} /> Add report</button></div></div>
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

function ProjectsPage({ projects: projectList, reports, onSelect, onCreate, onEdit }) {
  return <section className="projects-page">
    <div className="page-heading">
      <div><div className="eyebrow"><span className="eyebrow-dot" /> WORKSPACE</div><h1>Your projects</h1><p>Choose a project to see its reports and updates.</p></div>
      <button className="button button-primary" onClick={onCreate}><Plus size={17} /> New project</button>
    </div>
    <div className="project-cards">{projectList.map((project) => {
      const count = reports.filter((report) => report.projectId === project.id).length;
      return <article className="project-card" key={project.id}>
        <button className="project-card-open" onClick={() => onSelect(project.id)} aria-label={`Open ${project.name} reports`}>
          <span className={`project-card-icon card-${project.color}`}><FolderKanban size={20} /></span>
          <strong>{project.name}</strong><span className="project-card-location">{project.description || "Construction project"}</span>
          <span className="project-card-meta"><FileText size={15} /> {count} {count === 1 ? "report" : "reports"} <span className="project-card-status"><span className="trend-dot" /> Active</span></span>
        </button>
        <button className="project-card-edit" aria-label={`Edit ${project.name}`} title="Edit project" onClick={() => onEdit(project)}><Pencil size={15} /></button>
      </article>;
    })}</div>
    <div className="projects-help"><ShieldCheck size={17} /><span>Project membership and access will be managed through your organization’s Punch ID account.</span></div>
  </section>;
}

createRoot(document.getElementById("root")).render(<App />);
