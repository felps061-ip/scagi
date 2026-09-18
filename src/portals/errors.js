export class PortalError extends Error {
  constructor(code, message, status = 500, details = {}) {
    super(message);
    this.name = "PortalError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
