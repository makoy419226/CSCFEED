import { HttpError } from "../errors.js";
import { canEditProjectReports } from "../identity.js";

export function assertReportTransition(currentState, nextState, identity, projectId = null) {
  if (!canEditProjectReports(identity, projectId)) {
    throw new HttpError(403, "Administrator or assigned Project Manager access is required to archive this report.");
  }
  if (currentState !== "active" || nextState !== "archived") {
    throw new HttpError(409, "Only active reports can be archived.");
  }
}
