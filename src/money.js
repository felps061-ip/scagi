// Portal amounts use Brazilian decimal notation. Bound input before parsing.
export function isValidPortalAmount(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 32) return false;
  const unsigned = value.startsWith("-") ? value.slice(1) : value;
  const parts = unsigned.split(",");
  if (parts.length !== 2 || parts[1].length !== 2) return false;
  const digitsOnly = (text) => text.length > 0 && [...text].every((char) => char >= "0" && char <= "9");
  if (!digitsOnly(parts[1])) return false;
  const groups = parts[0].split(".");
  if (!groups.every(digitsOnly)) return false;
  return groups.length === 1 || (groups[0].length <= 3 && groups.slice(1).every((group) => group.length === 3));
}
