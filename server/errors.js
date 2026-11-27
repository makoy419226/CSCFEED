export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

export function handleError(error, _req, res, next) {
  if (res.headersSent) return next(error);

  if (error.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ success: false, message: "The uploaded file exceeds the configured size limit." });
  }
  if (error.type === "entity.too.large") {
    return res.status(413).json({ success: false, message: "The request body is too large." });
  }
  if (error.code === "LIMIT_UNEXPECTED_FILE" || error.code === "LIMIT_FIELD_COUNT") {
    return res.status(400).json({ success: false, message: "Unexpected upload fields." });
  }
  if (error.code === "23505") {
    return res.status(409).json({ success: false, message: "A record with those details already exists." });
  }
  if (error.code === "23503" || error.code === "23514" || error.code === "22023") {
    return res.status(400).json({ success: false, message: "The requested change violates a data rule." });
  }
  if (error instanceof HttpError) {
    return res.status(error.status).json({ success: false, message: error.message });
  }

  console.error("API request failed:", error);
  return res.status(500).json({ success: false, message: "The request could not be completed." });
}
