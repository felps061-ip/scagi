const MANAGEMENT_ROLES = new Set(["admin", "supervisor"]);

export function canManageUsers(role) {
  return MANAGEMENT_ROLES.has(role);
}

export function canCreateUser(actorRole, requestedRole) {
  if (actorRole === "admin") return ["operator", "supervisor"].includes(requestedRole);
  return actorRole === "supervisor" && requestedRole === "operator";
}

export function canResetUserPassword(actorRole, targetRole) {
  return actorRole === "admin" || (actorRole === "supervisor" && targetRole === "operator");
}

export function canRemoveUser(actorRole) {
  return actorRole === "admin";
}

export function visibleUsersForRole(users, actorRole) {
  return actorRole === "supervisor"
    ? users.filter(({ role }) => role === "operator")
    : users;
}
