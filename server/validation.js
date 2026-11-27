import { HttpError } from "./errors.js";

export function validate(schema, source = "body") {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const message = result.error.issues[0]?.message || "Invalid request.";
      return next(new HttpError(400, message));
    }

    req.validated ??= {};
    req.validated[source] = result.data;
    return next();
  };
}
