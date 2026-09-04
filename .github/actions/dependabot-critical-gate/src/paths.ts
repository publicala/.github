export function repositoryPath(
  value: unknown,
  field: string,
  allowLeadingSlash = false,
): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`The ${field} is invalid.`);
  }

  if (!allowLeadingSlash && value.startsWith('/')) {
    throw new Error(`The ${field} is unsafe.`);
  }

  const path = allowLeadingSlash ? value.replace(/^\/+/, '') : value;

  if (path.length === 0 || path.length > 4_096 || path.includes('\\') || /[\u0000-\u001f\u007f]/.test(path)) {
    throw new Error(`The ${field} is unsafe.`);
  }

  if (path.split('/').some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error(`The ${field} is unsafe.`);
  }

  return path;
}
