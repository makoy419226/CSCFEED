import { HttpError } from "../errors.js";

export function assertReportTransition(currentState, nextState, identity) {
  if (identity?.role !== "admin") {
    throw new HttpError(403, "Administrator access is required to archive reports.");
  }
  if (currentState !== "active" || nextState !== "archived") {
    throw new HttpError(409, "Only active reports can be archived.");
  }
}
