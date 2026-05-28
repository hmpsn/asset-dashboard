import path from 'path';

const SALES_REPORT_ID_PATTERN = /^sr_[A-Za-z0-9_-]+$/;

export function sanitizeFileName(rawName: unknown, fallbackName: string): string {
  if (typeof rawName !== 'string') return fallbackName;
  const trimmed = rawName.trim();
  if (!trimmed) return fallbackName;
  const normalizedSlashes = trimmed.replace(/\\/g, '/');
  const baseName = path.basename(normalizedSlashes).trim();
  if (!baseName || baseName === '.' || baseName === '..') return fallbackName;
  return baseName;
}

export function resolveSalesReportPath(reportsDir: string, reportId: string): string | null {
  if (!SALES_REPORT_ID_PATTERN.test(reportId)) return null;
  const rootPath = path.resolve(reportsDir);
  const targetPath = path.resolve(reportsDir, `${reportId}.json`);
  if (targetPath === rootPath || !targetPath.startsWith(`${rootPath}${path.sep}`)) return null;
  return targetPath;
}
