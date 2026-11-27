import { HttpError } from "../errors.js";
import { canManageProjectReports, hasAdminAccess } from "../identity.js";

export function assertReportTransition(currentState, nextState, identity, projectId = null) {
  if (!hasAdminAccess(identity?.role) && !canManageProjectReports(identity, projectId)) {
    throw new HttpError(403, "Administrator or assigned Project Manager access is required to archive this report.");
  }
  if (currentState !== "active" || nextState !== "archived") {
    throw new HttpError(409, "Only active reports can be archived.");
  }
}
