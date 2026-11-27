import React, { useState } from "react";
import { Eye, EyeOff, KeyRound, LoaderCircle, LogIn, UserRound } from "lucide-react";

function isJsonResponse(response) {
  return (response.headers.get("content-type") || "").toLowerCase().includes("application/json");
}

export default function Login({ onLogin, serviceMessage = "" }) {
  const [mode, setMode] = useState("employee");
  const [employeeId, setEmployeeId] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(serviceMessage);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(
          mode === "employee"
            ? { employeeId }
            : { username, password },
        ),
      });

      if (!isJsonResponse(response)) {
        throw new Error("The authentication service is unavailable. Reports remain locked.");
      }

      const result = await response.json();
      if (!response.ok || !result || result.success !== true) {
        setError(typeof result?.message === "string"
          ? result.message
          : typeof result?.error === "string"
            ? result.error
            : "Sign-in failed. Check your details and try again.");
        return;
      }

      const account = result.user;
      if (!account || typeof account.name !== "string" || typeof account.role !== "string") {
        throw new Error("The authentication service returned an invalid account.");
      }

      const role = account.role.toLowerCase();
      if ((mode === "administrator" && role !== "admin") || (mode === "employee" && role === "admin")) {
        setError(mode === "administrator"
          ? "This account does not have administrator access."
          : "Use administrator sign-in for this account.");
        return;
      }

      onLogin({
        name: account.name || account.username,
        role,
        punchId: account.punchId || account.username || employeeId,
      });
    } catch (requestError) {
      setError(requestError instanceof Error
        ? requestError.message
        : "Unable to complete sign-in. Reports remain locked.");
    } finally {
      setIsLoading(false);
    }
  };

  const isEmployee = mode === "employee";

  return (
    <main className="login-shell">
      <section className="login-card" aria-labelledby="login-title">
        <img className="login-logo" src="/concord-logo.png" alt="Concord logo" />
        <p className="login-company">CONCORD STARS CONTRACTING L.L.C.</p>
        <p className="login-product">PROJECT REPORTS</p>
        <div className="login-heading">
          <h1 id="login-title">{isEmployee ? "Welcome back" : "Administrator sign-in"}</h1>
          <p>{isEmployee ? "Sign in with your employee Punch ID." : "Use your administrator account to continue."}</p>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          {isEmployee ? (
            <label className="login-label" htmlFor="login-employee-id">
              Employee / Punch ID
              <span className="login-input-wrap">
                <UserRound size={17} aria-hidden="true" />
                <input
                  autoFocus
                  id="login-employee-id"
                  type="text"
                  inputMode="numeric"
                  autoComplete="username"
                  maxLength={10}
                  placeholder="Enter your employee ID"
                  value={employeeId}
                  onChange={(event) => {
                    setEmployeeId(event.target.value.replace(/\D/g, ""));
                    setError("");
                  }}
                  required
                />
              </span>
              <small>Only active employee accounts can sign in.</small>
            </label>
          ) : (
            <>
              <label className="login-label" htmlFor="login-admin-username">
                Administrator username
                <span className="login-input-wrap">
                  <UserRound size={17} aria-hidden="true" />
                  <input
                    autoFocus
                    id="login-admin-username"
                    type="text"
                    autoComplete="username"
                    placeholder="Enter username"
                    value={username}
                    onChange={(event) => {
                      setUsername(event.target.value);
                      setError("");
                    }}
                    required
                  />
                </span>
              </label>
              <label className="login-label" htmlFor="login-admin-password">
                Password
                <span className="login-input-wrap">
                  <KeyRound size={17} aria-hidden="true" />
                  <input
                    id="login-admin-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="Enter password"
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      setError("");
                    }}
                    required
                  />
                  <button
                    className="login-password-toggle"
                    type="button"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword((visible) => !visible)}
                  >
                    {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </span>
              </label>
            </>
          )}

          {error && <p className="login-error" role="alert">{error}</p>}

          <button className="button button-primary login-submit" type="submit" disabled={isLoading || (isEmployee ? !employeeId.trim() : !username.trim() || !password)}>
            {isLoading ? <LoaderCircle size={17} className="login-spinner" /> : <LogIn size={17} />}
            Sign in
          </button>
        </form>

        <button
          className="login-mode-toggle"
          type="button"
          onClick={() => {
            setMode(isEmployee ? "administrator" : "employee");
            setPassword("");
            setError("");
          }}
        >
          {isEmployee ? "Administrator sign-in" : "Employee sign-in"}
        </button>
        <p className="login-footnote">Your reports stay private until the server confirms your account.</p>
      </section>
    </main>
  );
}
